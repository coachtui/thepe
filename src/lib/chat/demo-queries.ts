/**
 * Demo Queries — Phase 3
 *
 * Read-only retrieval helpers for demo discipline entities from the universal
 * entity model. Called by retrieval-orchestrator when answerMode is
 * 'demo_scope' or 'demo_constraint'.
 *
 * All functions return failure-safe results (empty arrays, success=false)
 * rather than throwing — the retrieval-orchestrator falls through to
 * vector_search when no demo entities exist (sheets not yet processed).
 *
 * Entity graph tables are cast via `supabase as any` because project_entities
 * and related tables are not yet in the generated Supabase TypeScript types.
 */

import { createClient } from '@/lib/db/supabase/server'
import type { DemoEntity, DemoFinding, DemoQueryResult, SupportLevel } from './types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert a raw project_entities DB row (with nested arrays) to DemoEntity. */
function toDemoEntity(raw: any): DemoEntity {
  // Pick primary location first, fall back to first location, then null
  const locations: any[] = raw.entity_locations ?? []
  const primaryLoc = locations.find((l: any) => l.is_primary) ?? locations[0] ?? null

  const findings: DemoFinding[] = (raw.entity_findings ?? []).map(
    (f: any): DemoFinding => ({
      findingType:  f.finding_type  ?? 'note',
      statement:    f.statement     ?? '',
      supportLevel: (f.support_level ?? 'unknown') as SupportLevel,
      textValue:    f.text_value    ?? null,
      confidence:   f.confidence    ?? 0.5,
    })
  )

  return {
    id:            raw.id,
    entityType:    raw.entity_type,
    subtype:       raw.subtype      ?? null,
    canonicalName: raw.canonical_name,
    displayName:   raw.display_name ?? raw.canonical_name,
    label:         raw.label        ?? null,
    status:        raw.status       ?? 'unknown',
    confidence:    raw.confidence   ?? 0.5,
    room:          primaryLoc?.room_number ?? null,
    level:         primaryLoc?.level       ?? null,
    area:          primaryLoc?.area        ?? null,
    sheetNumber:   primaryLoc?.sheet_number ?? null,
    findings,
  }
}

/** Bucket entities into status groups. notes/keynotes go in the notes bucket. */
function groupByStatus(entities: DemoEntity[]): {
  toRemove:      DemoEntity[]
  toRemain:      DemoEntity[]
  toProtect:     DemoEntity[]
  toRelocate:    DemoEntity[]
  notes:         DemoEntity[]
  unknownStatus: DemoEntity[]
} {
  const toRemove:      DemoEntity[] = []
  const toRemain:      DemoEntity[] = []
  const toProtect:     DemoEntity[] = []
  const toRelocate:    DemoEntity[] = []
  const notes:         DemoEntity[] = []
  const unknownStatus: DemoEntity[] = []

  for (const e of entities) {
    if (e.entityType === 'keynote' || e.entityType === 'note') {
      notes.push(e)
      continue
    }
    switch (e.status) {
      case 'to_remove':   toRemove.push(e);   break
      case 'to_remain':   toRemain.push(e);   break
      case 'to_protect':  toProtect.push(e);  break
      case 'to_relocate': toRelocate.push(e); break
      default:            unknownStatus.push(e)
    }
  }

  return { toRemove, toRemain, toProtect, toRelocate, notes, unknownStatus }
}

function collectSheets(entities: DemoEntity[]): string[] {
  const sheets = new Set<string>()
  for (const e of entities) {
    if (e.sheetNumber) sheets.add(e.sheetNumber)
  }
  return Array.from(sheets).sort()
}

function avgConfidence(entities: DemoEntity[]): number {
  if (entities.length === 0) return 0
  const sum = entities.reduce((acc, e) => acc + e.confidence, 0)
  return Math.round((sum / entities.length) * 100) / 100
}

function emptyDemoResult(
  projectId: string,
  roomFilter?: string | null,
  statusFilter?: string | null
): DemoQueryResult {
  return {
    success:      false,
    projectId,
    filterRoom:   roomFilter   ?? null,
    filterStatus: statusFilter ?? null,
    toRemove:      [],
    toRemain:      [],
    toProtect:     [],
    toRelocate:    [],
    notes:         [],
    unknownStatus: [],
    totalCount:    0,
    sheetsCited:   [],
    confidence:    0,
    formattedAnswer:
      'No demo entities found. Demo sheets may not yet have been processed.',
  }
}

const VERIFY_KEYWORDS =
  /verify|confirm|check|coordinate|ensure|prior\s+to|before/i

// ---------------------------------------------------------------------------
// Public: queryDemoScope
// ---------------------------------------------------------------------------

/**
 * Query all demo entities for a project.
 *
 * @param projectId   Supabase project UUID
 * @param roomFilter  Room number to scope results (e.g. "104"). Null = all rooms.
 * @param statusFilter  Status to filter on (e.g. "to_remain"). Null = all statuses.
 */
export async function queryDemoScope(
  projectId: string,
  roomFilter?: string | null,
  statusFilter?: string | null
): Promise<DemoQueryResult> {
  const supabase = await createClient()
  // Cast to any: project_entities is not yet in generated Supabase TS types
  const db = supabase as any

  console.log(
    `[Demo Queries] queryDemoScope project=${projectId}` +
    ` room=${roomFilter ?? 'all'} status=${statusFilter ?? 'all'}`
  )

  try {
    let query = db
      .from('project_entities')
      .select(`
        id,
        entity_type,
        subtype,
        canonical_name,
        display_name,
        label,
        status,
        confidence,
        entity_locations ( room_number, level, area, sheet_number, is_primary ),
        entity_findings ( finding_type, statement, support_level, text_value, confidence )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'demo')

    // Status filter can be applied server-side
    if (statusFilter) {
      query = query.eq('status', statusFilter)
    }

    const { data: rawEntities, error } = await query

    if (error) throw error
    if (!rawEntities || rawEntities.length === 0) {
      return emptyDemoResult(projectId, roomFilter, statusFilter)
    }

    let entities: DemoEntity[] = rawEntities.map(toDemoEntity)

    // Room filter is applied in TypeScript because room_number lives in the
    // nested entity_locations table, not directly on project_entities.
    if (roomFilter) {
      const upper = roomFilter.toUpperCase()
      entities = entities.filter(e => e.room === upper)
    }

    if (entities.length === 0) {
      return emptyDemoResult(projectId, roomFilter, statusFilter)
    }

    const grouped    = groupByStatus(entities)
    const allEntities = [
      ...grouped.toRemove, ...grouped.toRemain,
      ...grouped.toProtect, ...grouped.toRelocate,
      ...grouped.notes, ...grouped.unknownStatus,
    ]
    const sheetsCited = collectSheets(allEntities)
    const confidence  = avgConfidence(entities)

    const result: DemoQueryResult = {
      success:      true,
      projectId,
      filterRoom:   roomFilter   ?? null,
      filterStatus: statusFilter ?? null,
      ...grouped,
      totalCount:   entities.length - grouped.notes.length,
      sheetsCited,
      confidence,
      formattedAnswer: '',
    }

    result.formattedAnswer = formatDemoAnswer(result, 'scope')
    return result
  } catch (err) {
    console.error('[Demo Queries] queryDemoScope error:', err)
    return emptyDemoResult(projectId, roomFilter, statusFilter)
  }
}

// ---------------------------------------------------------------------------
// Public: queryDemoByRoom
// ---------------------------------------------------------------------------

/**
 * Return all demo entities located in a specific room.
 */
export async function queryDemoByRoom(
  projectId: string,
  roomNumber: string
): Promise<DemoQueryResult> {
  return queryDemoScope(projectId, roomNumber, null)
}

// ---------------------------------------------------------------------------
// Public: queryDemoProtectInPlace
// ---------------------------------------------------------------------------

/**
 * Return all protect-in-place demo entities.
 */
export async function queryDemoProtectInPlace(
  projectId: string
): Promise<DemoQueryResult> {
  return queryDemoScope(projectId, null, 'to_protect')
}

// ---------------------------------------------------------------------------
// Public: queryDemoConstraints
// ---------------------------------------------------------------------------

/**
 * Return all risk notes, requirements, and verify items from demo entity findings.
 * Used for "what to verify before demo starts" queries.
 *
 * Two-step query:
 *   1. Get entity IDs for demo discipline in this project.
 *   2. Get findings for those entity IDs filtered to constraint finding types.
 */
export async function queryDemoConstraints(
  projectId: string
): Promise<{ riskNotes: DemoFinding[], requirements: DemoFinding[], verifyItems: string[] }> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(`[Demo Queries] queryDemoConstraints project=${projectId}`)

  try {
    // Step 1: Get demo entity IDs for this project
    const { data: demoEntityRows, error: entityError } = await db
      .from('project_entities')
      .select('id')
      .eq('project_id', projectId)
      .eq('discipline', 'demo')

    if (entityError || !demoEntityRows || demoEntityRows.length === 0) {
      return { riskNotes: [], requirements: [], verifyItems: [] }
    }

    const entityIds: string[] = demoEntityRows.map((e: any) => e.id)

    // Step 2: Get constraint-relevant findings for those entities
    const { data: rawFindings, error } = await db
      .from('entity_findings')
      .select('finding_type, statement, support_level, text_value, confidence')
      .in('entity_id', entityIds)
      .in('finding_type', ['risk_note', 'requirement', 'note'])

    if (error) throw error

    const riskNotes:    DemoFinding[] = []
    const requirements: DemoFinding[] = []
    const verifyItems:  string[]      = []

    for (const f of (rawFindings ?? [])) {
      const finding: DemoFinding = {
        findingType:  f.finding_type,
        statement:    f.statement   ?? '',
        supportLevel: (f.support_level ?? 'unknown') as SupportLevel,
        textValue:    f.text_value  ?? null,
        confidence:   f.confidence  ?? 0.5,
      }

      if (f.finding_type === 'risk_note') {
        riskNotes.push(finding)
      } else if (f.finding_type === 'requirement') {
        requirements.push(finding)
        if (f.statement) verifyItems.push(f.statement as string)
      } else if (
        f.finding_type === 'note' &&
        VERIFY_KEYWORDS.test(f.statement ?? '')
      ) {
        verifyItems.push(f.statement as string)
      }
    }

    return { riskNotes, requirements, verifyItems }
  } catch (err) {
    console.error('[Demo Queries] queryDemoConstraints error:', err)
    return { riskNotes: [], requirements: [], verifyItems: [] }
  }
}

// ---------------------------------------------------------------------------
// Public: formatDemoAnswer
// ---------------------------------------------------------------------------

/**
 * Format a DemoQueryResult into a structured context string for the LLM.
 *
 * @param result  DemoQueryResult from queryDemoScope / queryDemoByRoom
 * @param mode    'scope' = full scope breakdown  |  'remain' = remain/protect focus
 */
export function formatDemoAnswer(
  result: DemoQueryResult,
  mode: 'scope' | 'remain' | 'constraint'
): string {
  const parts: string[] = []

  const roomLabel   = result.filterRoom ? ` in Room ${result.filterRoom}` : ''
  const sheetsLabel =
    result.sheetsCited.length > 0
      ? `Demo Plans (${result.sheetsCited.join(', ')})`
      : 'Demo Plans'

  if (mode === 'remain') {
    parts.push(`Based on ${sheetsLabel}:\n`)

    if (result.toRemain.length > 0) {
      parts.push(`TO REMAIN${roomLabel} (${result.toRemain.length}):`)
      result.toRemain.forEach(e => parts.push(formatEntityLine(e)))
      parts.push('')
    }

    if (result.toProtect.length > 0) {
      parts.push(`PROTECT IN PLACE${roomLabel} (${result.toProtect.length}):`)
      result.toProtect.forEach(e => parts.push(formatEntityLine(e)))
      parts.push('')
    }

    if (result.toRemain.length === 0 && result.toProtect.length === 0) {
      parts.push(
        `No explicit "to remain" or "protect in place" entities found${roomLabel}.`
      )
    }
  } else {
    // Full scope breakdown
    parts.push(`Based on ${sheetsLabel}:\n`)

    if (result.toRemove.length > 0) {
      parts.push(`REMOVE AND DISPOSE${roomLabel} (${result.toRemove.length}):`)
      result.toRemove.forEach(e => parts.push(formatEntityLine(e)))
      parts.push('')
    }

    if (result.toRelocate.length > 0) {
      parts.push(`TO RELOCATE${roomLabel} (${result.toRelocate.length}):`)
      result.toRelocate.forEach(e => parts.push(formatEntityLine(e)))
      parts.push('')
    }

    if (result.toRemain.length > 0) {
      parts.push(`TO REMAIN${roomLabel} (${result.toRemain.length}):`)
      result.toRemain.forEach(e => parts.push(formatEntityLine(e)))
      parts.push('')
    }

    if (result.toProtect.length > 0) {
      parts.push(`PROTECT IN PLACE${roomLabel} (${result.toProtect.length}):`)
      result.toProtect.forEach(e => parts.push(formatEntityLine(e)))
      parts.push('')
    }

    if (result.unknownStatus.length > 0) {
      parts.push(
        `STATUS UNKNOWN${roomLabel} (${result.unknownStatus.length} — verify in field):`
      )
      result.unknownStatus.forEach(e => parts.push(formatEntityLine(e)))
      parts.push('')
    }

    if (result.totalCount === 0) {
      parts.push(
        `No demo entities found${roomLabel}. Demo sheets may not yet have been processed.`
      )
    }
  }

  if (result.notes.length > 0) {
    parts.push(`NOTES / KEYNOTES (${result.notes.length}):`)
    result.notes.forEach(e => parts.push(formatEntityLine(e)))
    parts.push('')
  }

  return parts.join('\n')
}

/**
 * Format a demo constraint result (from queryDemoConstraints) as a context string.
 */
export function formatDemoConstraintsAsContext(result: {
  riskNotes:    DemoFinding[]
  requirements: DemoFinding[]
  verifyItems:  string[]
}): string {
  const parts: string[] = ['Demo Constraint Data:\n']

  if (result.riskNotes.length > 0) {
    parts.push('RISK NOTES (explicit from drawings):')
    result.riskNotes.forEach(n => parts.push(`• ${n.statement}`))
    parts.push('')
  }

  if (result.requirements.length > 0) {
    parts.push('PRE-DEMO REQUIREMENTS (explicit):')
    result.requirements.forEach(r => parts.push(`• ${r.statement}`))
    parts.push('')
  }

  if (result.verifyItems.length > 0) {
    parts.push('VERIFY BEFORE DEMO:')
    result.verifyItems.forEach(v => parts.push(`• ${v}`))
  }

  if (
    result.riskNotes.length === 0 &&
    result.requirements.length === 0 &&
    result.verifyItems.length === 0
  ) {
    parts.push(
      'No explicit constraint notes found. Demo sheets may not yet have been processed.'
    )
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Internal: entity line formatter
// ---------------------------------------------------------------------------

function formatEntityLine(entity: DemoEntity): string {
  let line = `• ${entity.displayName}`

  if (entity.label && entity.label !== entity.displayName) {
    line += ` (${entity.label})`
  }

  if (entity.room) line += ` — Room ${entity.room}`

  // Prefer demo_scope finding, fall back to note
  const scopeFinding = entity.findings.find(
    f => f.findingType === 'demo_scope' && f.textValue
  )
  const noteFinding = entity.findings.find(
    f => f.findingType === 'note' && f.statement
  )

  if (scopeFinding?.textValue) {
    line += `. ${scopeFinding.textValue}`
  } else if (noteFinding?.statement) {
    line += `. ${noteFinding.statement}`
  }

  return line
}
