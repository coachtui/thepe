import type { SourceReference } from './source-references'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

export interface SubmittalRegisterItem {
  specSection: string | null
  sectionTitle: string | null
  submittalItem: string
  submittalType: string | null
  requiredAction: string | null
  approvalRequired: boolean | null
  sourceReference: SourceReference
  excerpt: string | null
  rawExcerpt?: string | null
  confidence: number
  notes: string | null
  dedupeKey?: string
  duplicateCount?: number
  citationCompleteness?: number
  sourceQuality?: 'high' | 'medium' | 'low'
  confidenceReason?: string
}

export interface SubmittalRegisterResult {
  success: boolean
  projectId?: string
  source: 'spec_entity_graph' | 'sample_text'
  items: SubmittalRegisterItem[]
  confidence: number
  notes: string[]
}

export interface BuildSubmittalRegisterOptions {
  projectId: string
  supabase: SupabaseClient
  sectionFilter?: string | null
  keyword?: string | null
  limit?: number
}

export async function buildSubmittalRegisterFromSpecs(
  opts: BuildSubmittalRegisterOptions
): Promise<SubmittalRegisterResult> {
  const { projectId, supabase, sectionFilter, keyword, limit = 200 } = opts

  try {
    let query = (supabase as SupabaseClient)
      .from('project_entities')
      .select(`
        id, entity_type, subtype, canonical_name, display_name, label,
        status, confidence, metadata,
        entity_citations (
          sheet_number, document_id, chunk_id, page_number,
          detail_ref, extraction_source, excerpt, context
        ),
        entity_findings (
          id, finding_type, statement, support_level,
          text_value, metadata
        )
      `)
      .eq('project_id', projectId)
      .eq('discipline', 'spec')
      .in('entity_type', ['spec_section', 'spec_requirement'])
      .order('canonical_name')
      .limit(limit)

    if (sectionFilter) {
      query = query.ilike('canonical_name', `SPEC_${normalizeForCanonical(sectionFilter)}%`)
    }

    const { data: rows, error } = await query

    if (error || !rows || rows.length === 0) {
      return emptyResult(projectId, ['No spec entity graph rows found for submittal register extraction.'])
    }

    const items = dedupeSubmittalRegisterItems((rows as unknown[])
      .flatMap(row => extractItemsFromSpecEntity(row, keyword ?? null))
      .slice(0, limit))

    if (items.length === 0) {
      return emptyResult(projectId, [
        'No submittal_requirement findings found in available spec entity graph data.',
        'Fallback remains the existing chat retrieval/tool loop.',
      ])
    }

    return {
      success: true,
      projectId,
      source: 'spec_entity_graph',
      items,
      confidence: averageConfidence(items),
      notes: [
        'Extracted from existing spec entity findings only.',
        'No submittal register table was created.',
      ],
    }
  } catch (err) {
    console.error('[SubmittalRegister] buildSubmittalRegisterFromSpecs error:', err)
    return emptyResult(projectId, [
      `Submittal register extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    ])
  }
}

export function extractSubmittalRegisterItemsFromText(
  text: string,
  sourceReference: SourceReference = {}
): SubmittalRegisterItem[] {
  const section = sourceReference.specSection ?? null
  const sectionTitle = sourceReference.sectionTitle ?? null
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  return lines
    .filter(isLikelySubmittalRequirement)
    .map(line => buildItemFromStatement(line, {
      specSection: section,
      sectionTitle,
      sourceReference,
      excerpt: line,
      baseConfidence: 0.72,
      extractionMethod: 'sample_text',
      isExplicitFinding: false,
      notes: 'Parsed from sample/spec-like text; not live project retrieval.',
    }))
    .reduce<SubmittalRegisterItem[]>(dedupeReducer, [])
}

export function formatSubmittalRegisterAsJson(result: SubmittalRegisterResult): string {
  return JSON.stringify({
    success: result.success,
    source: result.source,
    confidence: result.confidence,
    notes: result.notes,
    items: result.items,
  }, null, 2)
}

export interface SubmittalRegisterGroup {
  specSection: string | null
  sectionTitle: string | null
  itemCount: number
  averageConfidence: number
  confidenceBreakdown: {
    high: number
    medium: number
    low: number
  }
  citationBreakdown: {
    fullyCited: number
    partiallyCited: number
    uncited: number
  }
  submittalTypeCounts: Record<string, number>
  approvalRequiredCount: number
  reviewFlags: string[]
  items: SubmittalRegisterItem[]
}

export interface SubmittalRegisterReview {
  success: boolean
  projectId?: string
  source: SubmittalRegisterResult['source']
  totalItemCount: number
  groupCount: number
  averageConfidence: number
  groups: SubmittalRegisterGroup[]
  ungrouped: SubmittalRegisterItem[]
  globalNotes: string[]
  reviewFlags: string[]
}

export function groupSubmittalRegisterForReview(
  result: SubmittalRegisterResult
): SubmittalRegisterReview {
  const groupMap = new Map<string, SubmittalRegisterItem[]>()
  const ungrouped: SubmittalRegisterItem[] = []

  for (const item of result.items) {
    if (!item.specSection) {
      ungrouped.push(item)
      continue
    }
    const key = normalizeKeyPart(item.specSection)
    const list = groupMap.get(key) ?? []
    list.push(item)
    groupMap.set(key, list)
  }

  const groups = Array.from(groupMap.values())
    .map(buildSubmittalRegisterGroup)
    .sort(compareGroupsBySection)

  const reviewFlags: string[] = []
  if (ungrouped.length > 0) {
    reviewFlags.push(`${ungrouped.length} item(s) lack a spec section and could not be grouped.`)
  }
  if (groups.length === 0 && ungrouped.length === 0) {
    reviewFlags.push('No submittal register items available for review.')
  }

  return {
    success: result.success,
    projectId: result.projectId,
    source: result.source,
    totalItemCount: result.items.length,
    groupCount: groups.length,
    averageConfidence: result.confidence,
    groups,
    ungrouped,
    globalNotes: result.notes,
    reviewFlags,
  }
}

export function formatSubmittalRegisterReviewAsJson(review: SubmittalRegisterReview): string {
  return JSON.stringify(review, null, 2)
}

export function formatSubmittalRegisterToolPayload(result: SubmittalRegisterResult): string {
  const review = groupSubmittalRegisterForReview(result)
  return JSON.stringify({
    success: result.success,
    source: result.source,
    confidence: result.confidence,
    notes: result.notes,
    items: result.items,
    summary: {
      totalItemCount: review.totalItemCount,
      groupCount: review.groupCount,
      averageConfidence: review.averageConfidence,
      ungroupedCount: review.ungrouped.length,
      reviewFlags: review.reviewFlags,
    },
    groupedSections: review.groups,
    ungrouped: review.ungrouped,
  }, null, 2)
}

export interface SubmittalRegisterOutputSummary {
  totalItemCount: number
  groupCount: number
  averageConfidence: number
  ungroupedCount: number
  reviewFlags: string[]
}

export interface SubmittalRegisterItemRow {
  project_id: string
  workflow_run_id: string
  dedupe_key: string
  spec_section: string | null
  section_title: string | null
  submittal_item: string
  submittal_type: string | null
  required_action: string | null
  approval_required: boolean | null
  confidence: number | null
  source_quality: 'high' | 'medium' | 'low' | null
  citation_completeness: number | null
  source_finding_id: string | null
  source_citation_id: string | null
  item_payload: SubmittalRegisterItem
}

export function buildOutputSummary(result: SubmittalRegisterResult): SubmittalRegisterOutputSummary {
  const review = groupSubmittalRegisterForReview(result)
  return {
    totalItemCount: review.totalItemCount,
    groupCount: review.groupCount,
    averageConfidence: review.averageConfidence,
    ungroupedCount: review.ungrouped.length,
    reviewFlags: review.reviewFlags,
  }
}

export function buildSubmittalRegisterItemRows(
  workflowRunId: string,
  projectId: string,
  items: SubmittalRegisterItem[]
): SubmittalRegisterItemRow[] {
  return items.map((item, index) => ({
    project_id: projectId,
    workflow_run_id: workflowRunId,
    dedupe_key: item.dedupeKey ?? `${index}:${item.submittalItem}`,
    spec_section: item.specSection,
    section_title: item.sectionTitle,
    submittal_item: item.submittalItem,
    submittal_type: item.submittalType,
    required_action: item.requiredAction,
    approval_required: item.approvalRequired,
    confidence: item.confidence ?? null,
    source_quality: item.sourceQuality ?? null,
    citation_completeness: item.citationCompleteness ?? null,
    source_finding_id: null,
    source_citation_id: null,
    item_payload: item,
  }))
}

export function buildSubmittalRegisterPersistedPayload(
  result: SubmittalRegisterResult,
  summary: SubmittalRegisterOutputSummary
) {
  const review = groupSubmittalRegisterForReview(result)
  return {
    success: result.success,
    source: result.source,
    confidence: result.confidence,
    notes: result.notes,
    items: result.items,
    summary,
    groupedSections: review.groups,
    ungrouped: review.ungrouped,
  }
}

function buildSubmittalRegisterGroup(items: SubmittalRegisterItem[]): SubmittalRegisterGroup {
  const first = items[0]
  const confidenceBreakdown = { high: 0, medium: 0, low: 0 }
  const citationBreakdown = { fullyCited: 0, partiallyCited: 0, uncited: 0 }
  const submittalTypeCounts: Record<string, number> = {}
  let approvalRequiredCount = 0

  for (const item of items) {
    const quality = item.sourceQuality ?? 'low'
    confidenceBreakdown[quality] += 1

    const completeness = item.citationCompleteness ?? 0
    if (completeness >= 4) citationBreakdown.fullyCited += 1
    else if (completeness >= 1) citationBreakdown.partiallyCited += 1
    else citationBreakdown.uncited += 1

    if (item.submittalType) {
      submittalTypeCounts[item.submittalType] = (submittalTypeCounts[item.submittalType] ?? 0) + 1
    }
    if (item.approvalRequired) approvalRequiredCount += 1
  }

  const reviewFlags: string[] = []
  if (citationBreakdown.uncited > 0) {
    reviewFlags.push(`${citationBreakdown.uncited} item(s) lack citation metadata.`)
  }
  if (confidenceBreakdown.low > 0 && confidenceBreakdown.high === 0 && confidenceBreakdown.medium === 0) {
    reviewFlags.push('All items in this group are low confidence; manual review required.')
  } else if (confidenceBreakdown.low > 0) {
    reviewFlags.push(`${confidenceBreakdown.low} low-confidence item(s) — verify against spec source.`)
  }
  if (approvalRequiredCount > 0) {
    reviewFlags.push(`${approvalRequiredCount} item(s) require approval — confirm submittal routing.`)
  }

  const averageConfidence = roundConfidence(
    items.reduce((sum, item) => sum + item.confidence, 0) / items.length
  )

  return {
    specSection: first.specSection,
    sectionTitle: first.sectionTitle,
    itemCount: items.length,
    averageConfidence,
    confidenceBreakdown,
    citationBreakdown,
    submittalTypeCounts,
    approvalRequiredCount,
    reviewFlags,
    items,
  }
}

function compareGroupsBySection(a: SubmittalRegisterGroup, b: SubmittalRegisterGroup): number {
  const aKey = a.specSection ?? ''
  const bKey = b.specSection ?? ''
  return aKey.localeCompare(bKey)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractItemsFromSpecEntity(row: any, keyword: string | null): SubmittalRegisterItem[] {
  const citation = row.entity_citations?.[0]
  const specSection = row.label ?? extractSectionFromCanonical(row.canonical_name)
  const sectionTitle = row.display_name ?? row.canonical_name ?? null
  const baseSourceReference = buildSourceReference({
    source_type: 'specification',
    document_id: citation?.document_id,
    chunk_id: citation?.chunk_id,
    page_number: citation?.page_number,
    sheet_number: citation?.sheet_number,
    detail_ref: citation?.detail_ref,
    extraction_source: citation?.extraction_source,
    spec_section: specSection,
    section_title: sectionTitle,
    document_type: 'specification',
    // TODO: Join documents when needed to populate filename/document title.
  })

  const findings = row.entity_findings ?? []

  return findings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((finding: any) => {
      const statement = String(finding.statement ?? finding.text_value ?? '')
      const isSubmittalFinding =
        finding.finding_type === 'submittal_requirement' ||
        isLikelySubmittalRequirement(statement)

      if (!isSubmittalFinding) return false
      if (!keyword) return true

      const haystack = [
        statement,
        row.display_name,
        row.label,
        row.canonical_name,
        finding.metadata?.part_reference,
      ].filter(Boolean).join(' ').toLowerCase()

      return keywordTerms(keyword).some(term => haystack.includes(term))
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((finding: any) => {
      const statement = String(finding.statement ?? finding.text_value ?? '').trim()
      return buildItemFromStatement(statement, {
        specSection,
        sectionTitle,
        sourceReference: mergeSourceReference(baseSourceReference, {
          partReference: finding.metadata?.part_reference,
          paragraphReference: finding.metadata?.paragraph_reference,
        }),
        excerpt: citation?.excerpt ?? statement,
        baseConfidence: finding.confidence ?? row.confidence ?? 0.82,
        extractionMethod: 'spec_entity_graph',
        isExplicitFinding: finding.finding_type === 'submittal_requirement',
        notes: finding.metadata?.notes ?? null,
      })
    })
}

function buildItemFromStatement(
  statement: string,
  context: {
    specSection: string | null
    sectionTitle: string | null
    sourceReference: SourceReference
    excerpt: string | null
    baseConfidence: number
    extractionMethod: 'spec_entity_graph' | 'sample_text'
    isExplicitFinding: boolean
    notes: string | null
  }
): SubmittalRegisterItem {
  const submittalItem = cleanSubmittalItem(statement)
  const submittalType = detectSubmittalType(statement)
  const quality = assessSourceQuality({
    sourceReference: context.sourceReference,
    extractionMethod: context.extractionMethod,
    isExplicitFinding: context.isExplicitFinding,
    baseConfidence: context.baseConfidence,
  })

  const item: SubmittalRegisterItem = {
    specSection: context.specSection,
    sectionTitle: context.sectionTitle,
    submittalItem,
    submittalType,
    requiredAction: detectRequiredAction(statement),
    approvalRequired: detectApprovalRequired(statement),
    sourceReference: context.sourceReference,
    excerpt: context.excerpt,
    rawExcerpt: context.excerpt,
    confidence: quality.confidence,
    notes: context.notes,
    citationCompleteness: quality.citationCompleteness,
    sourceQuality: quality.sourceQuality,
    confidenceReason: quality.confidenceReason,
  }

  item.dedupeKey = buildDedupeKey(item)
  item.duplicateCount = 1
  return item
}

function isLikelySubmittalRequirement(value: string): boolean {
  return /\b(?:submit|submittals?|product\s+data|shop\s+drawings?|samples?|certificates?|certifications?|test\s+reports?|mix\s+design|calculations?|warrant(?:y|ies)|O&M|operation\s+and\s+maintenance)\b/i
    .test(value)
}

function cleanSubmittalItem(statement: string): string {
  return statement
    .replace(/^\s*(?:submit|provide|furnish)\s+/i, '')
    .replace(/^\s*(?:the\s+following\s+)?submittals?:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectSubmittalType(statement: string): string | null {
  const checks: Array<[RegExp, string]> = [
    [/\bSD[-\s]?01\b/i, 'SD-01 Preconstruction Submittal'],
    [/\bSD[-\s]?02\b/i, 'SD-02 Shop Drawings'],
    [/\bSD[-\s]?03\b/i, 'SD-03 Product Data'],
    [/\bSD[-\s]?04\b/i, 'SD-04 Samples'],
    [/\bSD[-\s]?05\b/i, 'SD-05 Design Data'],
    [/\bSD[-\s]?06\b/i, 'SD-06 Test Reports'],
    [/\bSD[-\s]?07\b/i, 'SD-07 Certificates'],
    [/\bSD[-\s]?10\b/i, 'SD-10 Operation and Maintenance Data'],
    [/\bshop\s+drawings?\b/i, 'Shop Drawing'],
    [/\bproduct\s+data\b/i, 'Product Data'],
    [/\bsamples?\b/i, 'Sample'],
    [/\bcertificates?|certifications?\b/i, 'Certificate'],
    [/\btest\s+reports?\b/i, 'Test Report'],
    [/\bmix\s+design\b/i, 'Mix Design'],
    [/\bcalculations?\b/i, 'Calculation'],
    [/\bwarrant(?:y|ies)\b/i, 'Warranty'],
    [/\bO&M|operation\s+and\s+maintenance\b/i, 'O&M Manual'],
  ]

  return checks.find(([pattern]) => pattern.test(statement))?.[1] ?? null
}

function detectRequiredAction(statement: string): string | null {
  if (/\bfor\s+approval\b|\bapproval\s+(?:by|required|from)\b/i.test(statement)) return 'Submit for approval'
  if (/\bfor\s+review\b|\breview\s+by\b/i.test(statement)) return 'Submit for review'
  if (/\bfor\s+record\b|\bfor\s+information\b/i.test(statement)) return 'Submit for record'
  if (/\bcertif(?:y|ication|icate)\b/i.test(statement)) return 'Provide certification'
  if (/\bsubmit\b/i.test(statement)) return 'Submit'
  if (/\bprovide|furnish\b/i.test(statement)) return 'Provide'
  return null
}

function detectApprovalRequired(statement: string): boolean | null {
  if (/\bfor\s+approval\b|\bapproval\s+(?:by|required|from)\b|\bapproved\s+by\b/i.test(statement)) return true
  if (/\bfor\s+record\b|\bfor\s+information\b/i.test(statement)) return false
  return null
}

function normalizeForCanonical(section: string): string {
  return section.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
}

function extractSectionFromCanonical(canonicalName: string | null | undefined): string | null {
  if (!canonicalName) return null
  const match = canonicalName.match(/SPEC_(\d{2})[_ ]?(\d{2})?[_ ]?(\d{2})?/)
  if (!match) return null
  return [match[1], match[2], match[3]].filter(Boolean).join(' ')
}

function keywordTerms(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length >= 3 && !['what', 'are', 'the', 'for', 'from', 'required'].includes(term))
}

function averageConfidence(items: SubmittalRegisterItem[]): number {
  if (items.length === 0) return 0
  return roundConfidence(items.reduce((sum, item) => sum + item.confidence, 0) / items.length)
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100
}

function emptyResult(projectId: string, notes: string[]): SubmittalRegisterResult {
  return {
    success: false,
    projectId,
    source: 'spec_entity_graph',
    items: [],
    confidence: 0,
    notes,
  }
}

function buildSourceReference(input: {
  source_type?: string | null
  document_id?: string | null
  chunk_id?: string | null
  page_number?: number | null
  sheet_number?: string | null
  detail_ref?: string | null
  extraction_source?: string | null
  spec_section?: string | null
  section_title?: string | null
  document_type?: string | null
  part_reference?: string | null
  paragraph_reference?: string | null
}): SourceReference {
  return removeEmpty({
    sourceType: input.source_type?.includes('spec') ? 'specification' : undefined,
    documentType: input.document_type ?? undefined,
    documentId: input.document_id ?? undefined,
    pageNumber: input.page_number ?? undefined,
    chunkId: input.chunk_id ?? undefined,
    specSection: input.spec_section ?? undefined,
    sectionTitle: input.section_title ?? undefined,
    partReference: input.part_reference ?? undefined,
    paragraphReference: input.paragraph_reference ?? undefined,
    sheetNumber: input.sheet_number ?? undefined,
    detailReference: input.detail_ref ?? undefined,
    extractionSource: input.extraction_source ?? undefined,
  })
}

function dedupeSubmittalRegisterItems(items: SubmittalRegisterItem[]): SubmittalRegisterItem[] {
  return items.reduce<SubmittalRegisterItem[]>(dedupeReducer, [])
}

function dedupeReducer(
  acc: SubmittalRegisterItem[],
  item: SubmittalRegisterItem
): SubmittalRegisterItem[] {
  const dedupeKey = item.dedupeKey ?? buildDedupeKey(item)
  const existingIndex = acc.findIndex(existing => (existing.dedupeKey ?? buildDedupeKey(existing)) === dedupeKey)

  if (existingIndex === -1) {
    acc.push({ ...item, dedupeKey, duplicateCount: item.duplicateCount ?? 1 })
    return acc
  }

  acc[existingIndex] = mergeDuplicateItems(acc[existingIndex], item)
  return acc
}

function buildDedupeKey(item: SubmittalRegisterItem): string {
  const sourcePart = item.sourceReference.partReference ?? item.sourceReference.paragraphReference ?? ''
  return [
    normalizeKeyPart(item.specSection),
    normalizeKeyPart(item.submittalItem),
    normalizeKeyPart(item.submittalType),
    normalizeKeyPart(sourcePart),
  ].join('|')
}

function mergeDuplicateItems(
  existing: SubmittalRegisterItem,
  incoming: SubmittalRegisterItem
): SubmittalRegisterItem {
  const existingRefScore = scoreSourceReference(existing.sourceReference)
  const incomingRefScore = scoreSourceReference(incoming.sourceReference)
  const strongerReference = incomingRefScore > existingRefScore
    ? incoming.sourceReference
    : existing.sourceReference
  const stronger = incoming.confidence > existing.confidence ? incoming : existing
  const duplicateCount = (existing.duplicateCount ?? 1) + (incoming.duplicateCount ?? 1)
  const notes = Array.from(new Set([
    existing.notes,
    incoming.notes,
    `Deduplicated ${duplicateCount} matching submittal requirement rows.`,
  ].filter(Boolean))).join(' ')

  return {
    ...existing,
    sourceReference: strongerReference,
    excerpt: stronger.excerpt ?? existing.excerpt,
    rawExcerpt: stronger.rawExcerpt ?? stronger.excerpt ?? existing.rawExcerpt ?? existing.excerpt,
    confidence: Math.max(existing.confidence, incoming.confidence),
    notes,
    duplicateCount,
    citationCompleteness: Math.max(existing.citationCompleteness ?? 0, incoming.citationCompleteness ?? 0),
    sourceQuality: strongerSourceQuality(existing.sourceQuality, incoming.sourceQuality),
    confidenceReason: stronger.confidenceReason ?? existing.confidenceReason,
    dedupeKey: existing.dedupeKey ?? incoming.dedupeKey ?? buildDedupeKey(existing),
  }
}

function assessSourceQuality(input: {
  sourceReference: SourceReference
  extractionMethod: 'spec_entity_graph' | 'sample_text'
  isExplicitFinding: boolean
  baseConfidence: number
}): {
  confidence: number
  citationCompleteness: number
  sourceQuality: 'high' | 'medium' | 'low'
  confidenceReason: string
} {
  const citationCompleteness = scoreSourceReference(input.sourceReference)
  const hasSection = Boolean(input.sourceReference.specSection)
  const hasCitation = hasSection && citationCompleteness >= 2
  const hasSectionAndPage = hasSection && Boolean(input.sourceReference.pageNumber)

  if (input.isExplicitFinding && hasCitation) {
    return {
      confidence: roundConfidence(Math.max(input.baseConfidence, 0.9)),
      citationCompleteness,
      sourceQuality: 'high',
      confidenceReason: 'Explicit submittal_requirement finding with section and citation metadata.',
    }
  }

  if (input.extractionMethod === 'sample_text' && hasSectionAndPage) {
    return {
      confidence: 0.72,
      citationCompleteness,
      sourceQuality: 'medium',
      confidenceReason: 'Parsed spec-like text with section and page metadata.',
    }
  }

  if (input.extractionMethod === 'spec_entity_graph' && hasSection) {
    return {
      confidence: roundConfidence(Math.min(Math.max(input.baseConfidence, 0.68), 0.82)),
      citationCompleteness,
      sourceQuality: citationCompleteness > 0 ? 'medium' : 'low',
      confidenceReason: 'Spec entity finding found, but citation metadata is incomplete.',
    }
  }

  return {
    confidence: 0.45,
    citationCompleteness,
    sourceQuality: 'low',
    confidenceReason: 'Parsed text without enough citation metadata.',
  }
}

function scoreSourceReference(ref: SourceReference): number {
  const fields = [
    ref.specSection,
    ref.partReference ?? ref.paragraphReference,
    ref.pageNumber,
    ref.documentId,
    ref.chunkId,
    ref.filename ?? ref.documentTitle ?? ref.documentName,
    ref.sheetNumber,
    ref.detailReference,
  ]
  return fields.filter(value => value !== undefined && value !== null && value !== '').length
}

function strongerSourceQuality(
  a: SubmittalRegisterItem['sourceQuality'],
  b: SubmittalRegisterItem['sourceQuality']
): SubmittalRegisterItem['sourceQuality'] {
  const rank = { low: 1, medium: 2, high: 3 }
  if (!a) return b
  if (!b) return a
  return rank[b] > rank[a] ? b : a
}

function normalizeKeyPart(value: string | null | undefined): string {
  return (value ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function mergeSourceReference(base: SourceReference, extra: SourceReference): SourceReference {
  return removeEmpty({
    ...base,
    ...extra,
  })
}

function removeEmpty(ref: SourceReference): SourceReference {
  return Object.fromEntries(
    Object.entries(ref).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ) as SourceReference
}
