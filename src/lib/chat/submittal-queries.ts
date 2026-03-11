/**
 * Submittal Queries — Phase 6C
 *
 * DB query layer for submittal entities (discipline='submittal') and
 * governing-document resolution.
 *
 * Provides:
 *   querySubmittalByEntity()  — find submittals linked to a drawing entity/tag
 *   querySubmittalBySection() — find submittals for a spec section
 *   resolveGoverningDocument()— apply precedence hierarchy to answer "what governs?"
 *   formatSubmittalAnswer()   — format for response-writer context
 *
 * Governing document hierarchy (conservative, evidence-based):
 *   1. Explicit contractual precedence clause (from project documents)
 *   2. Answered RFIs/ASIs/Addenda — supersede drawings/specs in their scope
 *   3. Specifications — govern material and execution
 *   4. Construction Drawings — govern geometry, location, quantity
 *   5. Approved Submittals — confirm what was ordered/installed
 *
 * IMPORTANT: Hierarchy is only asserted when explicit evidence supports it.
 * Conflicts are surfaced, not silently resolved.
 */

import type {
  SubmittalEntity,
  SubmittalFinding,
  SubmittalQueryResult,
  GoverningDocResult,
  GoverningAuthority,
  SupportLevel,
  StructuredCitation,
} from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find submittals linked to a specific drawing entity or tag.
 *
 * Matches via entity_relationships (applies_to) and via product_tag findings.
 */
export async function querySubmittalByEntity(
  supabase: SupabaseClient,
  projectId: string,
  entityTag: string
): Promise<SubmittalQueryResult> {
  const empty = buildEmptyResult(projectId, 'by_entity', null, entityTag)

  try {
    // Step 1: find matching entity IDs
    const { data: entityRows } = await (supabase as SupabaseClient)
      .from('project_entities')
      .select('id')
      .eq('project_id', projectId)
      .or(`label.ilike.%${entityTag}%,canonical_name.ilike.%${entityTag.toUpperCase()}%`)
      .limit(5)

    const entityIds: string[] = (entityRows ?? []).map((r: { id: string }) => r.id)

    // Step 2: find submittal entity IDs via relationships
    let submittalIds: string[] = []
    if (entityIds.length > 0) {
      const { data: relRows } = await (supabase as SupabaseClient)
        .from('entity_relationships')
        .select('from_entity_id')
        .eq('project_id', projectId)
        .in('relationship_type', ['applies_to', 'submitted_for'])
        .in('to_entity_id', entityIds)

      submittalIds = (relRows ?? []).map((r: { from_entity_id: string }) => r.from_entity_id)
    }

    // Step 3: also find via product_tag finding matching the tag
    const { data: tagRows } = await (supabase as SupabaseClient)
      .from('entity_findings')
      .select('entity_id')
      .eq('finding_type', 'product_tag')
      .ilike('text_value', `%${entityTag}%`)
      .limit(10)

    const tagEntityIds: string[] = (tagRows ?? []).map((r: { entity_id: string }) => r.entity_id)
    const allIds = Array.from(new Set([...submittalIds, ...tagEntityIds]))

    if (allIds.length === 0) return empty

    const { data: rows, error } = await (supabase as SupabaseClient)
      .from('project_entities')
      .select(`
        id, entity_type, subtype, canonical_name, display_name, label,
        status, confidence, metadata,
        entity_citations ( sheet_number, document_id ),
        entity_findings (
          id, finding_type, statement, support_level, text_value, metadata
        )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'submittal')
      .in('id', allIds)
      .order('label')
      .limit(20)

    if (error || !rows || rows.length === 0) return empty

    const entities = rows.map((r: unknown) => hydrateSubmittalEntity(r))
    return buildSubmittalResult(projectId, 'by_entity', null, entityTag, entities)
  } catch (err) {
    console.error('[SubmittalQueries] querySubmittalByEntity error:', err)
    return empty
  }
}

/**
 * Find submittals for a specific spec section.
 */
export async function querySubmittalBySection(
  supabase: SupabaseClient,
  projectId: string,
  sectionNumber: string
): Promise<SubmittalQueryResult> {
  const empty = buildEmptyResult(projectId, 'by_spec_section', sectionNumber, null)

  try {
    const { data: rows, error } = await (supabase as SupabaseClient)
      .from('project_entities')
      .select(`
        id, entity_type, subtype, canonical_name, display_name, label,
        status, confidence, metadata,
        entity_citations ( sheet_number, document_id ),
        entity_findings (
          id, finding_type, statement, support_level, text_value, metadata
        )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'submittal')
      .ilike('canonical_name', `SUB_${sectionNumber.replace(/[\s.]/g, '_').toUpperCase()}%`)
      .order('label')
      .limit(20)

    if (error || !rows || rows.length === 0) return empty

    const entities = rows.map((r: unknown) => hydrateSubmittalEntity(r))
    return buildSubmittalResult(projectId, 'by_spec_section', sectionNumber, null, entities)
  } catch (err) {
    console.error('[SubmittalQueries] querySubmittalBySection error:', err)
    return empty
  }
}

/**
 * Resolve governing document hierarchy for a given scope.
 *
 * Queries all relevant disciplines and applies the conservative precedence model:
 *   answered RFIs → specs → drawings → approved submittals
 *
 * Returns explicit vs inferred support for each authority.
 */
export async function resolveGoverningDocument(
  supabase: SupabaseClient,
  projectId: string,
  scope: string,            // e.g. "Footing F-1 at Grid A-3", "Door D-14"
  entityTag?: string | null // optional specific entity tag to anchor the query
): Promise<GoverningDocResult> {
  const empty: GoverningDocResult = {
    success: false,
    projectId,
    scope,
    authorities: [],
    conflicts: [],
    hasUnresolvedConflicts: false,
    confidence: 0,
    formattedAnswer: `No governing document data found for "${scope}".`,
  }

  try {
    const authorities: GoverningAuthority[] = []
    const conflicts: GoverningDocResult['conflicts'] = []

    // --- 1. Check for answered RFIs related to scope ---
    if (entityTag) {
      const { data: entityRows } = await (supabase as SupabaseClient)
        .from('project_entities')
        .select('id, label, entity_type, discipline')
        .eq('project_id', projectId)
        .or(`label.ilike.%${entityTag}%`)
        .neq('discipline', 'rfi')
        .limit(5)

      const entityIds: string[] = (entityRows ?? []).map((r: { id: string }) => r.id)

      if (entityIds.length > 0) {
        const { data: relRows } = await (supabase as SupabaseClient)
          .from('entity_relationships')
          .select(`
            from_entity_id, relationship_type,
            from_entity: project_entities!entity_relationships_from_entity_id_fkey (
              id, discipline, entity_type, label, display_name, status,
              entity_findings ( finding_type, statement, support_level )
            )
          `)
          .eq('project_id', projectId)
          .in('relationship_type', ['clarifies', 'governs'])
          .in('to_entity_id', entityIds)

        for (const rel of (relRows ?? [])) {
          const doc = rel.from_entity
          if (!doc) continue

          if (doc.discipline === 'rfi' && doc.status !== 'to_remove') {
            const clarif = (doc.entity_findings ?? []).find(
              (f: { finding_type: string }) => f.finding_type === 'clarification_statement'
            )
            authorities.push({
              document: doc.label ?? doc.display_name,
              discipline: 'rfi',
              governs: clarif?.statement ?? `Changes to ${entityTag}`,
              supportLevel: doc.status === 'existing' ? 'explicit' : 'inferred',
              citation: null,
              conflictsWith: null,
            })
          }

          if (doc.discipline === 'spec') {
            const firstReq = (doc.entity_findings ?? [])[0]
            authorities.push({
              document: doc.label ?? doc.display_name,
              discipline: 'spec',
              governs: firstReq?.statement ?? `Specification requirements for ${entityTag}`,
              supportLevel: 'explicit',
              citation: null,
              conflictsWith: null,
            })
          }
        }
      }
    }

    // --- 2. Check for spec coverage ---
    const { data: specRows } = await (supabase as SupabaseClient)
      .from('project_entities')
      .select(`
        id, discipline, entity_type, label, display_name, status,
        entity_findings ( finding_type, statement, support_level )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'spec')
      .eq('entity_type', 'spec_section')
      .limit(10)

    for (const spec of (specRows ?? [])) {
      // Only add if not already added via relationship
      const alreadyAdded = authorities.some(a => a.document === (spec.label ?? spec.display_name))
      if (!alreadyAdded) {
        const matReq = (spec.entity_findings ?? []).find(
          (f: { finding_type: string }) => f.finding_type === 'material_requirement'
        )
        if (matReq) {
          authorities.push({
            document: spec.label ?? spec.display_name,
            discipline: 'spec',
            governs: 'Material and execution requirements',
            supportLevel: 'explicit',
            citation: null,
            conflictsWith: null,
          })
        }
      }
    }

    // --- 3. Check for approved submittals ---
    if (entityTag) {
      const submittalResult = await querySubmittalByEntity(supabase, projectId, entityTag)
      for (const sub of submittalResult.approved) {
        authorities.push({
          document: sub.label ?? sub.displayName,
          discipline: 'submittal',
          governs: `Approved product/installation for ${entityTag}`,
          supportLevel: 'explicit',
          citation: sub.sheetNumber ? { sheetNumber: sub.sheetNumber } : null,
          conflictsWith: null,
        })
      }
    }

    // --- 4. Detect conflicts ---
    const rfiAuthorities = authorities.filter(a => a.discipline === 'rfi')
    const specAuthorities = authorities.filter(a => a.discipline === 'spec')

    // Open RFI (inferred) alongside spec = potential conflict
    const openRFIs = rfiAuthorities.filter(a => a.supportLevel === 'inferred')
    if (openRFIs.length > 0 && specAuthorities.length > 0) {
      for (const rfi of openRFIs) {
        conflicts.push({
          descr: `Open RFI "${rfi.document}" may affect spec requirements — resolution pending`,
          between: [rfi.document, specAuthorities[0].document],
          resolution: null,
        })
      }
    }

    if (authorities.length === 0) return empty

    const hasUnresolved = conflicts.some(c => c.resolution === null)

    const result: GoverningDocResult = {
      success: true,
      projectId,
      scope,
      authorities,
      conflicts,
      hasUnresolvedConflicts: hasUnresolved,
      confidence: hasUnresolved ? 0.65 : 0.85,
      formattedAnswer: '',
    }
    result.formattedAnswer = formatGoverningDocAnswer(result)
    return result
  } catch (err) {
    console.error('[SubmittalQueries] resolveGoverningDocument error:', err)
    return empty
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatSubmittalAnswer(result: SubmittalQueryResult): string {
  if (!result.success || result.totalCount === 0) {
    const ctx = result.submittalFilter ?? result.entityFilter
    return ctx
      ? `No submittals found for "${ctx}".`
      : 'No submittals found for this project.'
  }

  const parts: string[] = []
  parts.push(`**Submittals — ${result.totalCount} found**`)
  parts.push('')

  const renderGroup = (label: string, items: SubmittalEntity[]) => {
    if (items.length === 0) return
    parts.push(`**${label}:**`)
    for (const sub of items) {
      parts.push(`- ${sub.label ?? sub.displayName} — ${sub.displayName}`)
      const mfr = sub.findings.find(f => f.findingType === 'manufacturer_info')
      if (mfr) parts.push(`  Product: ${mfr.statement}`)
      const approval = sub.findings.find(f => f.findingType === 'approval_status')
      if (approval) parts.push(`  Status: ${approval.statement}`)
      const tag = sub.findings.find(f => f.findingType === 'product_tag')
      if (tag) parts.push(`  Tag: ${tag.statement}`)
    }
    parts.push('')
  }

  renderGroup('Approved', result.approved)
  renderGroup('Pending Review', result.pending)
  renderGroup('Rejected / Resubmit', result.rejected)

  return parts.join('\n').trim()
}

export function formatGoverningDocAnswer(result: GoverningDocResult): string {
  if (!result.success || result.authorities.length === 0) {
    return `No governing document data found for "${result.scope}".`
  }

  const parts: string[] = []
  parts.push(`**Governing Document Analysis — ${result.scope}**`)
  parts.push('')

  // Group by discipline in precedence order
  const order = ['rfi', 'spec', 'architectural', 'structural', 'mep', 'utility', 'submittal']
  const sorted = [...result.authorities].sort(
    (a, b) => order.indexOf(a.discipline) - order.indexOf(b.discipline)
  )

  for (const auth of sorted) {
    const supportTag = `[${auth.supportLevel}]`
    parts.push(`**${auth.document}** governs: ${auth.governs} ${supportTag}`)
    if (auth.conflictsWith) {
      parts.push(`  ⚠️ Conflicts with: ${auth.conflictsWith}`)
    }
  }

  if (result.conflicts.length > 0) {
    parts.push('')
    parts.push('**Unresolved Issues:**')
    for (const c of result.conflicts) {
      parts.push(`- ${c.descr}`)
      if (c.resolution) parts.push(`  Resolution: ${c.resolution}`)
      else parts.push('  Resolution: Not yet determined — verify with project team')
    }
  }

  if (!result.hasUnresolvedConflicts) {
    parts.push('')
    parts.push(
      '_No document conflicts detected in available evidence. ' +
      'Verify precedence clause in project contract for final determination._'
    )
  }

  return parts.join('\n').trim()
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hydrateSubmittalEntity(row: any): SubmittalEntity {
  const findings: SubmittalFinding[] = (row.entity_findings ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f: any): SubmittalFinding => ({
      findingType: f.finding_type,
      statement: f.statement ?? '',
      supportLevel: (f.support_level ?? 'explicit') as SupportLevel,
      textValue: f.text_value ?? null,
      confidence: f.confidence ?? 0.85,
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
    status: row.status ?? 'new',
    specSection: row.metadata?.spec_section ?? null,
    confidence: row.confidence ?? 0.85,
    sheetNumber: citation?.sheet_number ?? null,
    findings,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildSubmittalResult(
  projectId: string,
  queryType: SubmittalQueryResult['queryType'],
  submittalFilter: string | null,
  entityFilter: string | null,
  entities: SubmittalEntity[]
): SubmittalQueryResult {
  const approved = entities.filter(e => e.status === 'to_remain')
  const pending  = entities.filter(e => e.status === 'new' || e.status === 'proposed')
  const rejected = entities.filter(e => e.status === 'to_remove')

  const result: SubmittalQueryResult = {
    success: true,
    projectId,
    queryType,
    submittalFilter,
    entityFilter,
    approved,
    pending,
    rejected,
    totalCount: entities.length,
    confidence: computeConfidence(entities),
    formattedAnswer: '',
  }
  result.formattedAnswer = formatSubmittalAnswer(result)
  return result
}

function buildEmptyResult(
  projectId: string,
  queryType: SubmittalQueryResult['queryType'],
  submittalFilter: string | null,
  entityFilter: string | null
): SubmittalQueryResult {
  const ctx = submittalFilter ?? entityFilter
  return {
    success: false,
    projectId,
    queryType,
    submittalFilter,
    entityFilter,
    approved: [],
    pending: [],
    rejected: [],
    totalCount: 0,
    confidence: 0,
    formattedAnswer: ctx
      ? `No submittals found for "${ctx}".`
      : 'No submittals found.',
  }
}

function computeConfidence(entities: SubmittalEntity[]): number {
  if (entities.length === 0) return 0
  return Math.round(
    (entities.reduce((s, e) => s + (e.confidence ?? 0.85), 0) / entities.length) * 100
  ) / 100
}
