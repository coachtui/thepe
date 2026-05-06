#!/usr/bin/env node

import {
  classifyTaskRoute,
  getRetrievalStrategyForTask,
} from '../src/lib/chat/task-router.ts'
import {
  formatSourceReference,
  normalizeSourceReference,
} from '../src/lib/chat/source-references.ts'
import {
  extractSubmittalRegisterItemsFromText,
  groupSubmittalRegisterForReview,
  formatSubmittalRegisterToolPayload,
  buildOutputSummary,
  buildSubmittalRegisterItemRows,
  reconstructLatestSubmittalRegisterRun,
  validateSubmittalRegisterReviewUpdate,
  ALLOWED_REVIEW_STATUSES,
} from '../src/lib/chat/submittal-register.ts'

const examples = [
  {
    input: 'What spec section covers concrete curing?',
    expected: ['spec_lookup'],
  },
  {
    input: 'What are the compaction requirements?',
    expected: ['spec_lookup'],
  },
  {
    input: 'What does the spec say about pipe bedding?',
    expected: ['spec_lookup'],
  },
  {
    input: 'Draft an RFI for the conflict between sheet C-204 and spec 33 05 00.',
    expected: ['rfi_draft'],
  },
  {
    input: 'Build a submittal register from the project specs.',
    expected: ['submittal_register'],
  },
  {
    input: 'Create a submittal log from section 03 30 00.',
    expected: ['submittal_register'],
  },
  {
    input: 'What submittals are required for earthwork?',
    expected: ['submittal_register'],
  },
  {
    input: 'Review this rebar submittal against section 03 20 00.',
    expected: ['submittal_review'],
  },
  {
    input: 'Can we pour this wall on Friday?',
    expected: ['field_question', 'schedule_question'],
  },
  {
    input: 'What sheet shows the storm drain crossing?',
    expected: ['plan_lookup'],
  },
  {
    input: 'Generate a QC plan section for earthwork.',
    expected: ['qc_plan'],
  },
  {
    input: 'What equipment is down today?',
    expected: ['equipment_question'],
  },
]

for (const example of examples) {
  const result = classifyTaskRoute(example.input)
  const strategy = getRetrievalStrategyForTask(result.route)
  const pass = example.expected.includes(result.route)
  const reason = result.matchedSignals.length > 0
    ? `matched signals: ${result.matchedSignals.join(', ')}`
    : 'no route-specific signals matched'

  console.log(`Input: ${example.input}`)
  console.log(`taskType: ${result.route}`)
  console.log(`confidence: ${result.confidence.toFixed(2)}`)
  console.log(`reason: ${reason}`)
  console.log(
    `retrieval: mode=${strategy.retrievalMode}, topK=${strategy.defaultTopK}, ` +
    `docs=${strategy.preferredDocumentTypes.join(', ') || 'generic'}, ` +
    `citations=${strategy.citationRequired ? 'required' : 'optional'}, ` +
    `structured=${strategy.structuredOutputRequired ? 'yes' : 'no'}`
  )
  console.log(`strategyNotes: ${strategy.notes}`)
  console.log(`expected: ${example.expected.join(' or ')} (${pass ? 'PASS' : 'FAIL'})`)
  console.log('')
}

const sampleSources = [
  {
    sampleLabel: 'Spec entity citation',
    source_type: 'specification',
    document_id: 'doc_03_30_00',
    chunk_id: 'chunk_concrete_curing',
    page_number: 42,
    spec_section: '03 30 00',
    section_title: 'Cast-in-Place Concrete',
    part_reference: 'PART 3 - EXECUTION, 3.7',
  },
  {
    sampleLabel: 'Vector drawing result',
    document_id: 'doc_c_204',
    document_filename: 'C-204 Storm Drain Plan.pdf',
    chunk_id: 'chunk_storm_crossing',
    page_number: 7,
    sheet_number: 'C-204',
    detail_ref: '3/C-501',
    document_type: 'drawing',
  },
]

console.log('Normalized source references:')
for (const sample of sampleSources) {
  const normalized = normalizeSourceReference(sample)
  console.log(`${sample.sampleLabel}: ${formatSourceReference(normalized)}`)
}

const sampleSpecText = `
Submit product data for curing compounds for approval prior to use.
Submit product data for curing compounds for approval prior to use.
Submit SD-03 product data for admixtures for record.
Submit concrete mix design and supporting test reports for review.
Provide SD-07 certificates for reinforcing steel.
`

const sampleRegisterItems = extractSubmittalRegisterItemsFromText(
  sampleSpecText,
  normalizeSourceReference({
    source_type: 'specification',
    spec_section: '03 30 00',
    section_title: 'Cast-in-Place Concrete',
    page_number: 12,
    document_id: 'doc_sample_spec',
  })
)

console.log('')
console.log('Sample submittal register items:')
for (const item of sampleRegisterItems) {
  console.log(JSON.stringify({
    specSection: item.specSection,
    sectionTitle: item.sectionTitle,
    submittalItem: item.submittalItem,
    submittalType: item.submittalType,
    requiredAction: item.requiredAction,
    approvalRequired: item.approvalRequired,
    sourceReference: item.sourceReference,
    excerpt: item.excerpt,
    rawExcerpt: item.rawExcerpt,
    confidence: item.confidence,
    dedupeKey: item.dedupeKey,
    duplicateCount: item.duplicateCount,
    citationCompleteness: item.citationCompleteness,
    sourceQuality: item.sourceQuality,
    confidenceReason: item.confidenceReason,
    notes: item.notes,
  }, null, 2))
}

const uncitedRegisterItems = extractSubmittalRegisterItemsFromText(
  'Submit samples for aggregate source approval.'
)

console.log('')
console.log('Uncited submittal register sample:')
for (const item of uncitedRegisterItems) {
  console.log(JSON.stringify({
    specSection: item.specSection,
    submittalItem: item.submittalItem,
    submittalType: item.submittalType,
    approvalRequired: item.approvalRequired,
    confidence: item.confidence,
    citationCompleteness: item.citationCompleteness,
    sourceQuality: item.sourceQuality,
    confidenceReason: item.confidenceReason,
  }, null, 2))
}

const earthworkSampleItems = extractSubmittalRegisterItemsFromText(
  `
  Submit product data for geotextile separator fabric for approval.
  Submit SD-06 test reports for compaction testing.
  Provide SD-07 certificates for imported borrow material.
  `,
  normalizeSourceReference({
    source_type: 'specification',
    spec_section: '31 23 00',
    section_title: 'Earthwork',
    page_number: 8,
    document_id: 'doc_sample_earthwork',
  })
)

const reviewSource = {
  success: true,
  projectId: 'sample-project',
  source: 'sample_text',
  items: [...sampleRegisterItems, ...earthworkSampleItems, ...uncitedRegisterItems],
  confidence: 0.65,
  notes: ['Combined sample register for grouped review demonstration.'],
}

const groupedReview = groupSubmittalRegisterForReview(reviewSource)

console.log('')
console.log('Grouped submittal register review:')
console.log(JSON.stringify({
  totalItemCount: groupedReview.totalItemCount,
  groupCount: groupedReview.groupCount,
  averageConfidence: groupedReview.averageConfidence,
  reviewFlags: groupedReview.reviewFlags,
  ungroupedCount: groupedReview.ungrouped.length,
  groups: groupedReview.groups.map(group => ({
    specSection: group.specSection,
    sectionTitle: group.sectionTitle,
    itemCount: group.itemCount,
    averageConfidence: group.averageConfidence,
    confidenceBreakdown: group.confidenceBreakdown,
    citationBreakdown: group.citationBreakdown,
    submittalTypeCounts: group.submittalTypeCounts,
    approvalRequiredCount: group.approvalRequiredCount,
    reviewFlags: group.reviewFlags,
  })),
}, null, 2))

const toolPayload = JSON.parse(formatSubmittalRegisterToolPayload(reviewSource))

console.log('')
console.log('Tool-facing submittal register payload (structure check):')
console.log(JSON.stringify({
  topLevelKeys: Object.keys(toolPayload),
  flatItemCount: toolPayload.items.length,
  groupedSectionCount: toolPayload.groupedSections.length,
  ungroupedCount: toolPayload.ungrouped.length,
  summary: toolPayload.summary,
  firstGroupKeys: Object.keys(toolPayload.groupedSections[0] ?? {}),
}, null, 2))

const fallbackPayload = JSON.parse(formatSubmittalRegisterToolPayload({
  success: false,
  projectId: 'sample-project',
  source: 'spec_entity_graph',
  items: [],
  confidence: 0,
  notes: ['No spec entity graph rows found for submittal register extraction.'],
}))

console.log('')
console.log('Tool-facing submittal register fallback payload:')
console.log(JSON.stringify({
  success: fallbackPayload.success,
  flatItemCount: fallbackPayload.items.length,
  groupedSectionCount: fallbackPayload.groupedSections.length,
  ungroupedCount: fallbackPayload.ungrouped.length,
  summary: fallbackPayload.summary,
  notes: fallbackPayload.notes,
}, null, 2))

const persistenceSummary = buildOutputSummary(reviewSource)
const persistenceRows = buildSubmittalRegisterItemRows(
  '00000000-0000-0000-0000-000000000001',
  'sample-project',
  reviewSource.items
)

console.log('')
console.log('Persistence pure-transform check:')
console.log(JSON.stringify({
  outputSummary: persistenceSummary,
  itemRowCount: persistenceRows.length,
  firstRowKeys: Object.keys(persistenceRows[0] ?? {}),
  firstRowSample: persistenceRows[0] && {
    project_id: persistenceRows[0].project_id,
    workflow_run_id: persistenceRows[0].workflow_run_id,
    dedupe_key: persistenceRows[0].dedupe_key,
    spec_section: persistenceRows[0].spec_section,
    submittal_item: persistenceRows[0].submittal_item,
    submittal_type: persistenceRows[0].submittal_type,
    confidence: persistenceRows[0].confidence,
    source_quality: persistenceRows[0].source_quality,
    citation_completeness: persistenceRows[0].citation_completeness,
    source_finding_id: persistenceRows[0].source_finding_id,
    source_citation_id: persistenceRows[0].source_citation_id,
    item_payload_present: persistenceRows[0].item_payload !== undefined,
  },
}, null, 2))

const fallbackPersistenceSummary = buildOutputSummary({
  success: false,
  projectId: 'sample-project',
  source: 'spec_entity_graph',
  items: [],
  confidence: 0,
  notes: ['No spec entity graph rows found.'],
})
const fallbackPersistenceRows = buildSubmittalRegisterItemRows(
  '00000000-0000-0000-0000-000000000002',
  'sample-project',
  []
)

console.log('')
console.log('Persistence fallback transform check:')
console.log(JSON.stringify({
  outputSummary: fallbackPersistenceSummary,
  itemRowCount: fallbackPersistenceRows.length,
}, null, 2))

const persistedRunRow = {
  id: '00000000-0000-0000-0000-0000000000aa',
  project_id: 'sample-project',
  workflow_type: 'submittal_register',
  status: 'completed',
  source_type: 'chat_tool',
  started_at: '2026-05-05T20:00:00.000Z',
  completed_at: '2026-05-05T20:00:01.500Z',
  duration_ms: 1500,
  triggered_by_user_id: '00000000-0000-0000-0000-0000000000bb',
  triggered_by_role: null,
  inputs: { sectionFilter: null, keyword: null, limit: 200, taskType: 'submittal_register' },
  error: null,
}
const persistedItemRows = reviewSource.items.map((item, idx) => ({
  id: `00000000-0000-0000-0000-${String(idx + 1).padStart(12, '0')}`,
  item_payload: item,
  review_status: idx === 0 ? 'approved' : idx === 1 ? 'rejected' : 'pending',
  review_notes: idx === 0 ? 'Looks good.' : idx === 1 ? 'Wrong section.' : null,
  reviewed_at: idx < 2 ? '2026-05-05T20:30:00.000Z' : null,
  reviewed_by_role: idx < 2 ? 'editor' : null,
}))
const reconstructedRun = reconstructLatestSubmittalRegisterRun(persistedRunRow, persistedItemRows)

console.log('')
console.log('Latest submittal register reconstruction (pure transform):')
console.log(JSON.stringify({
  workflowRunKeys: Object.keys(reconstructedRun.workflowRun),
  workflowRunId: reconstructedRun.workflowRun.id,
  itemCount: reconstructedRun.items.length,
  groupedSectionCount: reconstructedRun.groupedSections.length,
  ungroupedCount: reconstructedRun.ungrouped.length,
  summary: reconstructedRun.summary,
  firstGroupSection: reconstructedRun.groupedSections[0]?.specSection ?? null,
  firstGroupItemCount: reconstructedRun.groupedSections[0]?.itemCount ?? 0,
  liveGroupedSectionCount: groupedReview.groups.length,
  groupCountMatchesLive:
    reconstructedRun.groupedSections.length === groupedReview.groups.length,
  firstItemPersistedId: reconstructedRun.items[0]?.persistedItemId,
  firstItemReviewStatus: reconstructedRun.items[0]?.reviewStatus,
  firstItemReviewNotes: reconstructedRun.items[0]?.reviewNotes,
  secondItemReviewStatus: reconstructedRun.items[1]?.reviewStatus,
  thirdItemReviewedAt: reconstructedRun.items[2]?.reviewedAt,
  liveItemHasNoPersistedFields:
    reviewSource.items[0].persistedItemId === undefined &&
    reviewSource.items[0].reviewStatus === undefined,
}, null, 2))

const emptyReconstruction = reconstructLatestSubmittalRegisterRun(
  { ...persistedRunRow, id: '00000000-0000-0000-0000-0000000000cc' },
  []
)

console.log('')
console.log('Latest submittal register reconstruction (empty items):')
console.log(JSON.stringify({
  itemCount: emptyReconstruction.items.length,
  groupedSectionCount: emptyReconstruction.groupedSections.length,
  ungroupedCount: emptyReconstruction.ungrouped.length,
  summary: emptyReconstruction.summary,
}, null, 2))

const malformedItemRows = [
  { item_payload: null },
  { item_payload: { foo: 'bar' } },
  { item_payload: reviewSource.items[0] },
]
const filteredReconstruction = reconstructLatestSubmittalRegisterRun(
  { ...persistedRunRow, id: '00000000-0000-0000-0000-0000000000dd' },
  malformedItemRows
)

console.log('')
console.log('Latest submittal register reconstruction (skips malformed payloads):')
console.log(JSON.stringify({
  inputRowCount: malformedItemRows.length,
  itemCount: filteredReconstruction.items.length,
  expectedItemCount: 1,
  matches: filteredReconstruction.items.length === 1,
}, null, 2))

const reviewFixedAt = new Date('2026-05-05T20:30:00.000Z')
const reviewValidatorCases = [
  {
    label: 'valid: approved + notes',
    input: {
      reviewStatus: 'approved',
      reviewNotes: '  Looks good, approved as submitted.  ',
      reviewedByUserId: '00000000-0000-0000-0000-0000000000bb',
      reviewedByRole: 'editor',
      reviewedAt: reviewFixedAt,
    },
  },
  {
    label: 'valid: rejected + null notes',
    input: {
      reviewStatus: 'rejected',
      reviewNotes: null,
      reviewedByUserId: '00000000-0000-0000-0000-0000000000bb',
      reviewedByRole: 'owner',
      reviewedAt: reviewFixedAt,
    },
  },
  {
    label: 'valid: empty-string notes normalized to null',
    input: {
      reviewStatus: 'needs_clarification',
      reviewNotes: '   ',
      reviewedByUserId: null,
      reviewedByRole: null,
      reviewedAt: reviewFixedAt,
    },
  },
  {
    label: 'valid: missing reviewedAt defaults to now',
    input: {
      reviewStatus: 'pending',
      reviewedByUserId: null,
      reviewedByRole: null,
    },
  },
  {
    label: 'invalid: unknown status',
    input: { reviewStatus: 'maybe', reviewedAt: reviewFixedAt },
  },
  {
    label: 'invalid: empty status string',
    input: { reviewStatus: '', reviewedAt: reviewFixedAt },
  },
  {
    label: 'invalid: numeric status',
    input: { reviewStatus: 1, reviewedAt: reviewFixedAt },
  },
  {
    label: 'invalid: notes is a number',
    input: { reviewStatus: 'approved', reviewNotes: 42, reviewedAt: reviewFixedAt },
  },
]

const reviewValidatorOutputs = reviewValidatorCases.map(c => {
  const result = validateSubmittalRegisterReviewUpdate(c.input)
  return {
    label: c.label,
    ok: result.ok,
    update: result.ok
      ? {
          reviewStatus: result.update.reviewStatus,
          reviewNotes: result.update.reviewNotes,
          reviewedByUserId: result.update.reviewedByUserId,
          reviewedByRole: result.update.reviewedByRole,
          reviewedAtIsIsoString:
            typeof result.update.reviewedAt === 'string' &&
            !Number.isNaN(Date.parse(result.update.reviewedAt)),
        }
      : null,
    error: result.ok ? null : result.error,
  }
})

console.log('')
console.log('Review-status validator cases:')
console.log(JSON.stringify({
  allowedReviewStatuses: ALLOWED_REVIEW_STATUSES,
  cases: reviewValidatorOutputs,
}, null, 2))
