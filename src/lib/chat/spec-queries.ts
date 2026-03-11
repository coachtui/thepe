/**
 * Spec Queries — Phase 6A
 *
 * DB query layer for specification entities (discipline='spec').
 *
 * Provides:
 *   querySpecSection()      — look up a specific CSI section by number
 *   querySpecRequirements() — look up requirements by family type
 *   formatSpecAnswer()      — format for response-writer context
 *
 * All queries return null / empty results gracefully when no spec entities
 * have been ingested yet. The retrieval-orchestrator falls through to
 * vector search in that case.
 *
 * Design rules:
 *   - Section numbers are stored normalized in `label` (e.g. "03 30 00")
 *   - canonical_name contains the machine ID form (e.g. "SPEC_03_30_00")
 *   - findings.part_reference holds "PART 2 - PRODUCTS, 2.1.A" context
 *   - Support level for all entity-graph results is 'explicit'
 *   - supabase typed as `any` — entity tables not yet in generated TS types
 */

import type {
  SpecEntity,
  SpecFinding,
  SpecRequirementGroup,
  SpecQueryResult,
  SupportLevel,
} from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Requirement finding types — grouped under spec discipline */
export const SPEC_REQUIREMENT_TYPES = [
  'material_requirement',
  'execution_requirement',
  'testing_requirement',
  'submittal_requirement',
  'closeout_requirement',
  'protection_requirement',
  'inspection_requirement',
] as const

export type SpecRequirementType = typeof SPEC_REQUIREMENT_TYPES[number]

/** Human-readable labels for each requirement family */
const REQUIREMENT_FAMILY_LABELS: Record<SpecRequirementType, string> = {
  material_requirement:    'Material Requirements',
  execution_requirement:   'Execution Requirements',
  testing_requirement:     'Testing & Inspection Requirements',
  submittal_requirement:   'Submittal Requirements',
  closeout_requirement:    'Closeout Requirements',
  protection_requirement:  'Protection Requirements',
  inspection_requirement:  'Inspection Requirements',
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query spec entities for a specific section number.
 *
 * Matches on normalized section number stored in `label` or `canonical_name`.
 * E.g.: "03 30 00", "03300", "Division 3 - Concrete" all match SPEC_03_30_00.
 */
export async function querySpecSection(
  supabase: SupabaseClient,
  projectId: string,
  sectionNumber: string | null | undefined
): Promise<SpecQueryResult> {
  const empty = buildEmptyResult(projectId, 'section', sectionNumber ?? null)

  try {
    const normSection = sectionNumber ? normalizeSectionNumber(sectionNumber) : null

    // Build base query: all spec entities for project
    let entityQuery = (supabase as SupabaseClient)
      .from('project_entities')
      .select(`
        id, entity_type, subtype, canonical_name, display_name, label,
        status, confidence, metadata,
        entity_citations ( sheet_number, document_id ),
        entity_findings (
          id, finding_type, statement, support_level,
          text_value, metadata
        )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'spec')

    if (normSection) {
      // Match label (stored as "03 30 00") or canonical_name prefix
      entityQuery = entityQuery.or(
        `label.ilike.%${normSection}%,canonical_name.ilike.%${normalizeForCanonical(normSection)}%`
      )
    }

    entityQuery = entityQuery.order('canonical_name').limit(50)

    const { data: rows, error } = await entityQuery

    if (error || !rows || rows.length === 0) return empty

    const entities = rows.map(hydrateSpecEntity)
    const requirementGroups = groupByRequirementFamily(entities)
    const sectionsCited = deduplicateSections(entities)

    const totalReqs = requirementGroups.reduce((s, g) => s + g.requirements.length, 0)
    const confidence = computeSpecConfidence(entities)

    return {
      success: true,
      projectId,
      queryType: 'section',
      sectionFilter: sectionNumber ?? null,
      requirementTypeFilter: null,
      sections: entities.filter((e: SpecEntity) => e.entityType === 'spec_section'),
      requirementGroups,
      totalRequirements: totalReqs,
      sectionsCited,
      confidence,
      formattedAnswer: formatSpecAnswer({
        success: true,
        projectId,
        queryType: 'section',
        sectionFilter: sectionNumber ?? null,
        requirementTypeFilter: null,
        sections: entities.filter((e: SpecEntity) => e.entityType === 'spec_section'),
        requirementGroups,
        totalRequirements: totalReqs,
        sectionsCited,
        confidence,
        formattedAnswer: '',
      }),
    }
  } catch (err) {
    console.error('[SpecQueries] querySpecSection error:', err)
    return empty
  }
}

/**
 * Query spec requirements by family type across all sections.
 *
 * E.g.: requirementType='testing_requirement' returns all testing requirements
 * for the project, across all spec sections.
 */
export async function querySpecRequirements(
  supabase: SupabaseClient,
  projectId: string,
  requirementType: SpecRequirementType | null,
  sectionFilter?: string | null
): Promise<SpecQueryResult> {
  const empty = buildEmptyResult(projectId, 'requirement_family', sectionFilter ?? null)

  try {
    // Get entities, then filter findings by type in TS (simpler than nested SQL filter)
    let entityQuery = (supabase as SupabaseClient)
      .from('project_entities')
      .select(`
        id, entity_type, subtype, canonical_name, display_name, label,
        status, confidence, metadata,
        entity_citations ( sheet_number, document_id ),
        entity_findings (
          id, finding_type, statement, support_level,
          text_value, metadata
        )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'spec')
      .in('entity_type', ['spec_section', 'spec_requirement'])

    if (sectionFilter) {
      const norm = normalizeForCanonical(sectionFilter)
      entityQuery = entityQuery.ilike('canonical_name', `SPEC_${norm}%`)
    }

    entityQuery = entityQuery.order('canonical_name').limit(100)

    const { data: rows, error } = await entityQuery

    if (error || !rows || rows.length === 0) return empty

    const entities = rows.map(hydrateSpecEntity)

    // Filter findings to the requested type
    if (requirementType) {
      entities.forEach((e: SpecEntity) => {
        e.findings = e.findings.filter((f: SpecFinding) => f.findingType === requirementType)
      })
    }

    const requirementGroups = requirementType
      ? [buildGroup(requirementType, entities)]
      : groupByRequirementFamily(entities)

    const totalReqs = requirementGroups.reduce((s, g) => s + g.requirements.length, 0)
    const confidence = computeSpecConfidence(entities)

    const result: SpecQueryResult = {
      success: true,
      projectId,
      queryType: 'requirement_family',
      sectionFilter: sectionFilter ?? null,
      requirementTypeFilter: requirementType,
      sections: entities.filter((e: SpecEntity) => e.entityType === 'spec_section'),
      requirementGroups,
      totalRequirements: totalReqs,
      sectionsCited: deduplicateSections(entities),
      confidence,
      formattedAnswer: '',
    }
    result.formattedAnswer = formatSpecAnswer(result)
    return result
  } catch (err) {
    console.error('[SpecQueries] querySpecRequirements error:', err)
    return empty
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatSpecAnswer(result: SpecQueryResult): string {
  if (!result.success || result.totalRequirements === 0) {
    const msg = result.sectionFilter
      ? `No spec requirements found for section "${result.sectionFilter}". The section may not have been ingested yet.`
      : 'No spec requirements found. Spec sections may not have been ingested yet.'
    return msg
  }

  const parts: string[] = []

  // Header
  if (result.sections.length > 0) {
    const sectionHeaders = result.sections.map(s =>
      `${s.label ?? s.canonicalName} — ${s.displayName}`
    )
    parts.push(`**Specification: ${sectionHeaders.join(', ')}**`)
  } else if (result.sectionFilter) {
    parts.push(`**Specification Section: ${result.sectionFilter}**`)
  } else {
    parts.push(`**Specification Requirements**`)
  }

  if (result.sectionsCited.length > 0) {
    parts.push(`Source: Spec ${result.sectionsCited.join(', ')} (explicit)`)
  }
  parts.push('')

  // Requirements grouped by family
  for (const group of result.requirementGroups) {
    if (group.requirements.length === 0) continue
    const label = REQUIREMENT_FAMILY_LABELS[group.family as SpecRequirementType] ?? group.family
    parts.push(`**${label}:**`)
    for (const req of group.requirements) {
      const citation = req.partReference ? ` [${req.partReference}]` : ''
      parts.push(`- ${req.statement}${citation}`)
    }
    parts.push('')
  }

  return parts.join('\n').trim()
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hydrateSpecEntity(row: any): SpecEntity {
  const findings: SpecFinding[] = (row.entity_findings ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f: any): SpecFinding => ({
      findingType: f.finding_type,
      statement: f.statement ?? '',
      supportLevel: (f.support_level ?? 'explicit') as SupportLevel,
      textValue: f.text_value ?? null,
      partReference: f.metadata?.part_reference ?? null,
      confidence: f.confidence ?? 0.9,
    })
  )

  const citation = row.entity_citations?.[0]
  const sectionNumber = row.label ?? extractSectionFromCanonical(row.canonical_name)

  return {
    id: row.id,
    entityType: row.entity_type,
    subtype: row.subtype ?? null,
    canonicalName: row.canonical_name,
    displayName: row.display_name ?? row.canonical_name,
    label: row.label ?? null,
    status: row.status ?? 'existing',
    confidence: row.confidence ?? 0.9,
    sectionNumber,
    divisionNumber: sectionNumber ? sectionNumber.split(' ')[0] : null,
    sheetNumber: citation?.sheet_number ?? null,
    findings,
  }
}

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

function groupByRequirementFamily(entities: SpecEntity[]): SpecRequirementGroup[] {
  const groups = new Map<string, SpecFinding[]>()

  for (const family of SPEC_REQUIREMENT_TYPES) {
    groups.set(family, [])
  }

  for (const entity of entities) {
    for (const finding of entity.findings) {
      if (SPEC_REQUIREMENT_TYPES.includes(finding.findingType as SpecRequirementType)) {
        const arr = groups.get(finding.findingType) ?? []
        arr.push(finding)
        groups.set(finding.findingType, arr)
      }
    }
  }

  return SPEC_REQUIREMENT_TYPES
    .filter(family => (groups.get(family) ?? []).length > 0)
    .map(family => ({ family, requirements: groups.get(family) ?? [] }))
}

function buildGroup(family: string, entities: SpecEntity[]): SpecRequirementGroup {
  const requirements: SpecFinding[] = []
  for (const entity of entities) {
    requirements.push(...entity.findings.filter(f => f.findingType === family))
  }
  return { family, requirements }
}

function deduplicateSections(entities: SpecEntity[]): string[] {
  const seen = new Set<string>()
  for (const e of entities) {
    if (e.sectionNumber) seen.add(e.sectionNumber)
  }
  return Array.from(seen).sort()
}

function computeSpecConfidence(entities: SpecEntity[]): number {
  if (entities.length === 0) return 0
  const avg = entities.reduce((s, e) => s + (e.confidence ?? 0.9), 0) / entities.length
  return Math.round(avg * 100) / 100
}

function buildEmptyResult(
  projectId: string,
  queryType: SpecQueryResult['queryType'],
  sectionFilter: string | null
): SpecQueryResult {
  return {
    success: false,
    projectId,
    queryType,
    sectionFilter,
    requirementTypeFilter: null,
    sections: [],
    requirementGroups: [],
    totalRequirements: 0,
    sectionsCited: [],
    confidence: 0,
    formattedAnswer:
      sectionFilter
        ? `No spec data found for section "${sectionFilter}".`
        : 'No spec data found. Specification sections may not have been ingested yet.',
  }
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a CSI section number to a consistent display form.
 * "03300" → "03 30 00"
 * "03 30 00" → "03 30 00"
 * "Division 3" → "Division 3"
 */
export function normalizeSectionNumber(s: string): string {
  const clean = s.trim()
  // If already formatted with spaces (e.g. "03 30 00"), return as-is
  if (/^\d{2}\s+\d{2}\s+\d{2}$/.test(clean)) return clean
  // If 6 digits without spaces (e.g. "033000"), add spaces
  if (/^\d{6}$/.test(clean)) {
    return `${clean.slice(0, 2)} ${clean.slice(2, 4)} ${clean.slice(4, 6)}`
  }
  return clean
}

/**
 * Convert section number to canonical_name-safe form.
 * "03 30 00" → "03_30_00"
 */
export function normalizeForCanonical(s: string): string {
  return s.trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
}

/**
 * Extract section number from canonical_name.
 * "SPEC_03_30_00_REQ_MATERIAL_001" → "03 30 00"
 */
function extractSectionFromCanonical(name: string): string | null {
  const m = name.match(/^SPEC_(\d{2}_\d{2}_\d{2})/)
  if (m) {
    return m[1].replace(/_/g, ' ')
  }
  return null
}
