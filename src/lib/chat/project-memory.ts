/**
 * Project Memory — load and apply per-project learned facts at query time.
 *
 * Provides three functions consumed by the chat pipeline:
 *
 *   loadProjectMemory()  — Step 0: fetch all accepted memory items for a project
 *   resolveAliases()     — Step 0.5: expand extracted entity strings via aliases
 *   getSourceQuality()   — Step 4: retrieve confidence cap/modifier for a source
 *
 * Every item is strictly scoped to its project_id.
 * Only items with validation_status = 'accepted' are applied at query time.
 *
 * SECURITY NOTE: alias values injected into prompts MUST go through
 * sanitizeForPrompt() before use — see G4 risk in phase7 architecture doc.
 */

import { createServiceRoleClient } from '@/lib/db/supabase/service'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MemoryItem {
  id: string
  item_type: string
  discipline: string | null
  system_context: string | null
  sheet_numbers: string[] | null
  original_text: string | null
  normalized_value: string
  pattern_regex: string | null
  confidence_modifier: number | null
  submitted_by_role: string | null
  submitted_at: string
  source_type: string
  validation_status: string
  confirmed_by_count: number
  rejected_by_count: number
}

export interface SourceQualityItem {
  id: string
  source_name: string
  discipline: string | null
  system_context: string | null
  confidence_cap: number | null
  confidence_modifier: number | null
}

/**
 * All accepted project memory data for one project, bucketed by purpose.
 * Loaded once per chat request in Step 0 of the pipeline.
 */
export interface ProjectMemoryContext {
  /** item_type IN ('alias', 'system_alias') — abbreviation expansions */
  aliases: MemoryItem[]
  /** item_type = 'callout_pattern' — project-specific callout text patterns */
  calloutPatterns: MemoryItem[]
  /** item_type = 'sheet_hint' — hints that a sheet is relevant to a system */
  sheetHints: MemoryItem[]
  /** Per-source confidence caps and modifiers */
  sourceQuality: SourceQualityItem[]
}

const EMPTY_CONTEXT: ProjectMemoryContext = {
  aliases: [],
  calloutPatterns: [],
  sheetHints: [],
  sourceQuality: [],
}

// ---------------------------------------------------------------------------
// loadProjectMemory
// ---------------------------------------------------------------------------

/**
 * Load all accepted project memory items for a project.
 *
 * Returns an empty context (never throws) if the tables don't exist yet
 * or if no items have been accepted — this keeps the pipeline robust before
 * any corrections have been submitted.
 */
export async function loadProjectMemory(
  projectId: string
): Promise<ProjectMemoryContext> {
  try {
    const supabase = createServiceRoleClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabaseAny = supabase as any

    const [itemsResult, qualityResult] = await Promise.all([
      supabaseAny
        .from('project_memory_items')
        .select(
          'id, item_type, discipline, system_context, sheet_numbers, ' +
          'original_text, normalized_value, pattern_regex, confidence_modifier, ' +
          'submitted_by_role, submitted_at, source_type, validation_status, ' +
          'confirmed_by_count, rejected_by_count'
        )
        .eq('project_id', projectId)
        .eq('validation_status', 'accepted'),

      supabaseAny
        .from('project_source_quality')
        .select(
          'id, source_name, discipline, system_context, ' +
          'confidence_cap, confidence_modifier'
        )
        .eq('project_id', projectId),
    ])

    if (itemsResult.error || qualityResult.error) {
      console.warn(
        '[ProjectMemory] DB error loading memory:',
        itemsResult.error?.message ?? qualityResult.error?.message
      )
      return EMPTY_CONTEXT
    }

    const items = (itemsResult.data ?? []) as unknown as MemoryItem[]

    return {
      aliases:         items.filter(i => i.item_type === 'alias' || i.item_type === 'system_alias'),
      calloutPatterns: items.filter(i => i.item_type === 'callout_pattern'),
      sheetHints:      items.filter(i => i.item_type === 'sheet_hint'),
      sourceQuality:   (qualityResult.data ?? []) as unknown as SourceQualityItem[],
    }
  } catch (err) {
    // Tables may not exist in older environments — degrade gracefully
    console.warn('[ProjectMemory] loadProjectMemory failed, using empty context:', err)
    return EMPTY_CONTEXT
  }
}

// ---------------------------------------------------------------------------
// resolveAliases
// ---------------------------------------------------------------------------

/**
 * Expand a list of entity strings against accepted aliases.
 *
 * Returns a map of original entity → expanded canonical values.
 * Only returns expansions that are unambiguous for the given discipline;
 * if discipline is unknown, returns all matches ranked by confirmed_by_count.
 *
 * Example:
 *   resolveAliases(['WLA', 'HORIZ DEFL'], ctx)
 *   → { 'WLA': ['WATER LINE A'], 'HORIZ DEFL': ['horizontal deflection fitting'] }
 *
 * Keys are upper-cased for consistent lookup — callers should look up with
 * entity.toUpperCase().
 */
export function resolveAliases(
  entities: string[],
  ctx: ProjectMemoryContext,
  discipline?: string | null
): Record<string, string[]> {
  if (ctx.aliases.length === 0 || entities.length === 0) return {}

  const result: Record<string, string[]> = {}

  for (const entity of entities) {
    if (!entity) continue
    const key = entity.toUpperCase()

    // Find all aliases whose original_text matches this entity (case-insensitive)
    const matches = ctx.aliases.filter(a => {
      if (!a.original_text) return false
      return a.original_text.toUpperCase() === key
    })

    if (matches.length === 0) continue

    // Filter by discipline if known
    const disciplineFiltered = discipline
      ? matches.filter(a => !a.discipline || a.discipline === discipline)
      : matches

    const candidates = disciplineFiltered.length > 0 ? disciplineFiltered : matches

    // Sort by confirmed_by_count desc, then by submitted_at asc (older = more trusted)
    const sorted = [...candidates].sort((a, b) => {
      const countDiff = b.confirmed_by_count - a.confirmed_by_count
      if (countDiff !== 0) return countDiff
      return a.submitted_at.localeCompare(b.submitted_at)
    })

    // Deduplicate expanded values
    const expanded = [...new Set(sorted.map(a => a.normalized_value))]
    if (expanded.length > 0) {
      result[key] = expanded
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// getSourceQuality
// ---------------------------------------------------------------------------

/**
 * Look up the confidence cap and modifier for a given source + context.
 *
 * Precedence: most-specific match wins.
 *   (source + discipline + system) > (source + discipline) > (source only)
 */
export function getSourceQuality(
  source: string,
  discipline: string | null,
  system: string | null,
  ctx: ProjectMemoryContext
): { cap: number | null; modifier: number | null } {
  const candidates = ctx.sourceQuality.filter(q => q.source_name === source)
  if (candidates.length === 0) return { cap: null, modifier: null }

  // Score each candidate by specificity
  const scored = candidates.map(q => {
    let score = 0
    if (q.discipline) {
      if (q.discipline === discipline) score += 2
      else return null // discipline mismatch — skip
    }
    if (q.system_context) {
      if (q.system_context === system) score += 4
      else return null // system mismatch — skip
    }
    return { q, score }
  }).filter((x): x is { q: SourceQualityItem; score: number } => x !== null)

  if (scored.length === 0) return { cap: null, modifier: null }

  // Pick the most specific match
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0].q

  return {
    cap:      best.confidence_cap      ?? null,
    modifier: best.confidence_modifier ?? null,
  }
}

// ---------------------------------------------------------------------------
// Prompt injection helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize an alias value before injecting it into a prompt.
 * Strips anything that could be used for prompt injection.
 * Max 200 chars; only alphanumeric + spaces + basic punctuation allowed.
 */
export function sanitizeForPrompt(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9 .,\-'"/()[\]#@+:=]/g, '')
    .slice(0, 200)
    .trim()
}

/**
 * Format callout patterns for injection into a plan reader prompt.
 * Returns null when there are no patterns (caller should skip injection).
 */
export function formatCalloutPatternsForPrompt(
  patterns: MemoryItem[]
): string | null {
  if (patterns.length === 0) return null

  const lines = patterns
    .filter(p => p.original_text && p.normalized_value)
    .map(p => `  - "${sanitizeForPrompt(p.original_text!)}" = ${sanitizeForPrompt(p.normalized_value)}`)

  if (lines.length === 0) return null

  return [
    'KNOWN PROJECT ABBREVIATIONS (use these to interpret callout labels on this drawing):',
    ...lines,
  ].join('\n')
}
