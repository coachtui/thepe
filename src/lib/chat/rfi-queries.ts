/**
 * RFI Queries — Phase 6B
 *
 * DB query layer for RFI and change-document entities (discipline='rfi').
 *
 * Provides:
 *   queryRFIByNumber()    — look up a specific RFI/ASI/Addendum by identifier
 *   queryRFIsByEntity()   — find change docs linked to a drawing entity/tag
 *   queryRecentChanges()  — all change docs for a project, optionally filtered
 *   formatRFIAnswer()     — format for response-writer context
 *
 * Design rules:
 *   - RFI identifiers stored as label: "RFI-023", "ASI-002", "ADDENDUM-001"
 *   - Status: 'new'=open, 'existing'=answered, 'to_remove'=voided
 *   - Clarification text stored in finding_type='clarification_statement'
 *   - Entity linkage via entity_relationships (clarifies, applies_to, references)
 *   - Support level: explicit for answered RFIs; inferred for open/unanswered
 */

import type {
  RFIEntity,
  RFIFinding,
  RFIReference,
  RFIQueryResult,
  SupportLevel,
} from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a specific RFI/ASI/Addendum by identifier.
 *
 * @param identifier  "RFI-023", "RFI 23", "ASI-002", "Addendum 1"
 */
export async function queryRFIByNumber(
  supabase: SupabaseClient,
  projectId: string,
  identifier: string
): Promise<RFIQueryResult> {
  const empty = buildEmptyResult(projectId, 'by_number', identifier, null)

  try {
    const normLabel = normalizeRFILabel(identifier)

    const { data: rows, error } = await (supabase as SupabaseClient)
      .from('project_entities')
      .select(`
        id, entity_type, subtype, canonical_name, display_name, label,
        status, confidence, metadata,
        entity_citations ( sheet_number, document_id ),
        entity_findings (
          id, finding_type, statement, support_level, text_value, metadata
        ),
        entity_relationships_from: entity_relationships!entity_relationships_from_entity_id_fkey (
          id, relationship_type, to_entity_id, metadata
        )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'rfi')
      .ilike('label', `%${normLabel}%`)
      .limit(10)

    if (error || !rows || rows.length === 0) return empty

    const entities = rows.map((r: unknown) => hydrateRFIEntity(r))
    return buildQueryResult(projectId, 'by_number', identifier, null, entities)
  } catch (err) {
    console.error('[RFIQueries] queryRFIByNumber error:', err)
    return empty
  }
}

/**
 * Find all change documents that reference a specific drawing entity.
 *
 * Matches via entity_relationships (clarifies / applies_to / references)
 * where to_entity_id corresponds to an entity with the given tag or label.
 *
 * @param entityTag  e.g. "F-1", "D-14", "S-201"
 */
export async function queryRFIsByEntity(
  supabase: SupabaseClient,
  projectId: string,
  entityTag: string
): Promise<RFIQueryResult> {
  const empty = buildEmptyResult(projectId, 'by_entity', null, entityTag)

  try {
    // Step 1: find the entity ID for the tag
    const { data: entityRows } = await (supabase as SupabaseClient)
      .from('project_entities')
      .select('id')
      .eq('project_id', projectId)
      .or(`label.ilike.%${entityTag}%,canonical_name.ilike.%${entityTag.toUpperCase()}%`)
      .limit(5)

    const entityIds: string[] = (entityRows ?? []).map((r: { id: string }) => r.id)

    // Step 2: find RFI entities that have a relationship to these entity IDs
    let rfiIds: string[] = []

    if (entityIds.length > 0) {
      const { data: relRows } = await (supabase as SupabaseClient)
        .from('entity_relationships')
        .select('from_entity_id')
        .eq('project_id', projectId)
        .in('relationship_type', ['clarifies', 'applies_to', 'references'])
        .in('to_entity_id', entityIds)

      rfiIds = (relRows ?? []).map((r: { from_entity_id: string }) => r.from_entity_id)
    }

    // Also search by text match on finding statements (for tags mentioned in clarification text)
    const { data: textRows } = await (supabase as SupabaseClient)
      .from('entity_findings')
      .select('entity_id')
      .in('finding_type', ['clarification_statement', 'superseding_language', 'revision_metadata'])
      .ilike('statement', `%${entityTag}%`)
      .limit(20)

    const textEntityIds: string[] = (textRows ?? []).map((r: { entity_id: string }) => r.entity_id)
    const allRFIIds = Array.from(new Set([...rfiIds, ...textEntityIds]))

    if (allRFIIds.length === 0) return empty

    const { data: rows, error } = await (supabase as SupabaseClient)
      .from('project_entities')
      .select(`
        id, entity_type, subtype, canonical_name, display_name, label,
        status, confidence, metadata,
        entity_citations ( sheet_number, document_id ),
        entity_findings (
          id, finding_type, statement, support_level, text_value, metadata
        ),
        entity_relationships_from: entity_relationships!entity_relationships_from_entity_id_fkey (
          id, relationship_type, to_entity_id, metadata
        )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'rfi')
      .in('id', allRFIIds)
      .order('label')
      .limit(20)

    if (error || !rows || rows.length === 0) return empty

    const entities = rows.map((r: unknown) => hydrateRFIEntity(r))
    return buildQueryResult(projectId, 'by_entity', null, entityTag, entities)
  } catch (err) {
    console.error('[RFIQueries] queryRFIsByEntity error:', err)
    return empty
  }
}

/**
 * Return all change documents for a project, optionally filtered by type.
 */
export async function queryRecentChanges(
  supabase: SupabaseClient,
  projectId: string,
  docType?: 'rfi' | 'asi' | 'addendum' | 'bulletin' | null
): Promise<RFIQueryResult> {
  const empty = buildEmptyResult(projectId, 'recent_changes', null, null)

  try {
    let query = (supabase as SupabaseClient)
      .from('project_entities')
      .select(`
        id, entity_type, subtype, canonical_name, display_name, label,
        status, confidence, metadata,
        entity_citations ( sheet_number, document_id ),
        entity_findings (
          id, finding_type, statement, support_level, text_value, metadata
        ),
        entity_relationships_from: entity_relationships!entity_relationships_from_entity_id_fkey (
          id, relationship_type, to_entity_id, metadata
        )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'rfi')

    if (docType) {
      query = query.eq('entity_type', docType)
    }

    const { data: rows, error } = await query.order('label').limit(50)

    if (error || !rows || rows.length === 0) return empty

    const entities = rows.map((r: unknown) => hydrateRFIEntity(r))
    return buildQueryResult(projectId, 'recent_changes', null, null, entities)
  } catch (err) {
    console.error('[RFIQueries] queryRecentChanges error:', err)
    return empty
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatRFIAnswer(result: RFIQueryResult): string {
  if (!result.success || result.totalCount === 0) {
    const ctx = result.rfiFilter ?? result.entityFilter
    return ctx
      ? `No change documents found for "${ctx}". No RFIs, ASIs, or addenda have been ingested for this project.`
      : 'No change documents found for this project.'
  }

  const parts: string[] = []

  if (result.hasOpenItems) {
    parts.push(`⚠️ ${result.open.length} open / unanswered change document(s) found.`)
    parts.push('')
  }

  const allDocs = [...result.answered, ...result.open, ...result.voided]

  for (const doc of allDocs) {
    const statusLabel =
      doc.status === 'existing' ? 'Answered' :
      doc.status === 'new'      ? 'OPEN / Unanswered' :
      doc.status === 'to_remove'? 'Voided' : doc.status

    parts.push(`**${doc.label ?? doc.displayName}** — ${statusLabel}`)

    if (doc.dateAnswered) parts.push(`  Answered: ${doc.dateAnswered}`)
    else if (doc.dateIssued) parts.push(`  Issued: ${doc.dateIssued}`)

    // Primary clarification finding
    const clarif = doc.findings.find(f => f.findingType === 'clarification_statement')
    if (clarif) {
      const supportTag = clarif.supportLevel === 'explicit' ? '[explicit]' : '[inferred]'
      parts.push(`  Clarification: ${clarif.statement} ${supportTag}`)
    }

    // Superseding language
    const supersedes = doc.findings.find(f => f.findingType === 'superseding_language')
    if (supersedes) {
      parts.push(`  Supersedes: ${supersedes.statement}`)
    }

    // References
    if (doc.references.length > 0) {
      const refList = doc.references.map(r => r.ref).join(', ')
      parts.push(`  References: ${refList}`)
    }

    parts.push('')
  }

  return parts.join('\n').trim()
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hydrateRFIEntity(row: any): RFIEntity {
  const findings: RFIFinding[] = (row.entity_findings ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f: any): RFIFinding => ({
      findingType: f.finding_type,
      statement: f.statement ?? '',
      supportLevel: deriveRFISupportLevel(row.status, f.support_level),
      textValue: f.text_value ?? null,
      confidence: f.confidence ?? 0.85,
    })
  )

  // Build references from relationships
  const references: RFIReference[] = (row.entity_relationships_from ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rel: any): RFIReference => ({
      refType: deriveRefType(rel.relationship_type, rel.metadata),
      ref: rel.metadata?.ref_label ?? rel.to_entity_id ?? '',
      entityId: rel.to_entity_id ?? null,
    })
  )

  const citation = row.entity_citations?.[0]

  return {
    id: row.id,
    entityType: row.entity_type,
    subtype: row.subtype ?? null,
    canonicalName: row.canonical_name,
    displayName: row.display_name ?? row.canonical_name,
    label: row.label ?? null,
    status: row.status ?? 'existing',
    confidence: row.confidence ?? 0.85,
    dateIssued: row.metadata?.date_issued ?? null,
    dateAnswered: row.metadata?.date_answered ?? null,
    sheetNumber: citation?.sheet_number ?? null,
    findings,
    references,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildQueryResult(
  projectId: string,
  queryType: RFIQueryResult['queryType'],
  rfiFilter: string | null,
  entityFilter: string | null,
  entities: RFIEntity[]
): RFIQueryResult {
  const answered = entities.filter(e => e.status === 'existing')
  const open = entities.filter(e => e.status === 'new')
  const voided = entities.filter(e => e.status === 'to_remove')

  const result: RFIQueryResult = {
    success: true,
    projectId,
    queryType,
    rfiFilter,
    entityFilter,
    answered,
    open,
    voided,
    totalCount: entities.length,
    hasOpenItems: open.length > 0,
    confidence: computeRFIConfidence(entities),
    formattedAnswer: '',
  }
  result.formattedAnswer = formatRFIAnswer(result)
  return result
}

function buildEmptyResult(
  projectId: string,
  queryType: RFIQueryResult['queryType'],
  rfiFilter: string | null,
  entityFilter: string | null
): RFIQueryResult {
  const ctx = rfiFilter ?? entityFilter
  return {
    success: false,
    projectId,
    queryType,
    rfiFilter,
    entityFilter,
    answered: [],
    open: [],
    voided: [],
    totalCount: 0,
    hasOpenItems: false,
    confidence: 0,
    formattedAnswer: ctx
      ? `No change documents found for "${ctx}".`
      : 'No change documents found.',
  }
}

function computeRFIConfidence(entities: RFIEntity[]): number {
  if (entities.length === 0) return 0
  const avg = entities.reduce((s, e) => s + (e.confidence ?? 0.85), 0) / entities.length
  return Math.round(avg * 100) / 100
}

/**
 * Support level assignment for RFI findings:
 * - 'explicit' when RFI is answered (status='existing')
 * - 'inferred' when RFI is open (status='new') — resolution not confirmed
 */
function deriveRFISupportLevel(
  entityStatus: string,
  findingLevel: string | null
): SupportLevel {
  if (findingLevel === 'explicit' || findingLevel === 'inferred' || findingLevel === 'unknown') {
    return findingLevel as SupportLevel
  }
  return entityStatus === 'existing' ? 'explicit' : 'inferred'
}

function deriveRefType(
  relationshipType: string,
  metadata: Record<string, unknown> | null
): RFIReference['refType'] {
  const hint = metadata?.ref_type as string | undefined
  if (hint === 'sheet') return 'sheet'
  if (hint === 'detail') return 'detail'
  if (hint === 'spec_section') return 'spec_section'
  if (hint === 'entity') return 'entity'
  if (relationshipType === 'clarifies') return 'entity'
  if (relationshipType === 'references') return 'sheet'
  return 'entity'
}

// ---------------------------------------------------------------------------
// Label normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an RFI identifier for label matching.
 * "RFI-23" → "RFI-023" (but label search uses ilike so exact form matters less)
 * "ASI 2" → "ASI-002"
 * "Addendum 1" → "ADDENDUM-001"
 */
export function normalizeRFILabel(s: string): string {
  const clean = s.trim().toUpperCase()

  // Extract type prefix and number
  const m = clean.match(/^(RFI|ASI|ADDENDUM|BULLETIN|CLARIF)\D*(\d+)/)
  if (m) {
    const prefix = m[1]
    const num = m[2].padStart(3, '0')
    return `${prefix}-${num}`
  }

  return clean
}
