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
import {
  runSpecExtractionPipeline,
  buildSpecPersistenceRows,
  detectApprovalRequired,
  detectRecordOnly,
} from '../src/lib/chat/spec-extraction-pipeline.ts'

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

// ---------------------------------------------------------------------------
// Spec extraction pipeline (A3a) — pure orchestration with mocked llmCallers
// ---------------------------------------------------------------------------

const specChunks = [
  {
    id: 'chunk-0',
    chunk_index: 0,
    page_number: 1,
    content: 'AmmunitionStorageWL Project Manual\nVolume I — Specifications\n\nTable of Contents follows.',
    metadata: null,
  },
  {
    id: 'chunk-1',
    chunk_index: 1,
    page_number: 12,
    content: [
      'SECTION 03 30 00 - CAST-IN-PLACE CONCRETE',
      '',
      'PART 1 - GENERAL',
      '',
      '1.1 SUBMITTALS',
      'A. Submit product data for cast-in-place concrete mix designs prior to placement of any concrete. Approval required.',
      'B. Submit certified test reports for compressive strength at 7 and 28 days.',
      '',
      'PART 2 - PRODUCTS',
      '',
      '2.1 MATERIALS',
      "A. Concrete shall conform to ASTM C150 with f'c = 4000 psi minimum at 28 days.",
      '',
      'PART 3 - EXECUTION',
      '',
      '3.1 PLACEMENT',
      'A. Concrete shall be placed in accordance with ACI 301.',
    ].join('\n'),
    metadata: null,
  },
  {
    id: 'chunk-2',
    chunk_index: 2,
    page_number: 47,
    content: [
      'SECTION 33 05 00 - COMMON WORK RESULTS FOR UTILITIES',
      '',
      'PART 1 - GENERAL',
      '',
      '1.4 SUBMITTALS',
      'A. Submit shop drawings for utility crossings showing horizontal and vertical separation prior to trenching operations. Approval required.',
    ].join('\n'),
    metadata: null,
  },
  {
    id: 'chunk-3',
    chunk_index: 3,
    page_number: 89,
    content: [
      'SECTION 09 91 23 - INTERIOR PAINTING',
      '',
      '1.3 INFORMATIONAL SUBMITTALS',
      'A. Submit field test reports for record only.',
    ].join('\n'),
    metadata: null,
  },
]

const cannedSectionResponses = {
  '03 30 00': {
    sectionNumber: '03 30 00',
    sectionTitle: 'Cast-In-Place Concrete',
    divisionNumber: '03',
    parts: { general: true, products: true, execution: true },
    requirements: [
      {
        requirementType: 'submittal_requirement',
        statement: 'Submit product data for cast-in-place concrete mix designs prior to placement of any concrete.',
        partReference: 'PART 1, 1.1.A',
        confidence: 0.92,
      },
      {
        requirementType: 'submittal_requirement',
        statement: 'Submit certified test reports for compressive strength at 7 and 28 days.',
        partReference: 'PART 1, 1.1.B',
        confidence: 0.88,
      },
      {
        requirementType: 'material_requirement',
        statement: "Concrete shall conform to ASTM C150 with f'c = 4000 psi minimum at 28 days.",
        partReference: 'PART 2, 2.1.A',
        confidence: 0.95,
      },
      {
        requirementType: 'execution_requirement',
        statement: 'Concrete shall be placed in accordance with ACI 301.',
        partReference: 'PART 3, 3.1.A',
        confidence: 0.9,
      },
    ],
    referencedStandards: ['ASTM C150', 'ACI 301'],
    confidence: 0.91,
  },
  '33 05 00': {
    sectionNumber: '33 05 00',
    sectionTitle: 'Common Work Results for Utilities',
    parts: { general: true, products: false, execution: false },
    requirements: [
      {
        requirementType: 'submittal_requirement',
        statement: 'Submit shop drawings for utility crossings showing horizontal and vertical separation prior to trenching operations.',
        partReference: 'PART 1, 1.4.A',
        confidence: 0.85,
      },
    ],
    referencedStandards: [],
    confidence: 0.85,
  },
  '09 91 23': {
    sectionNumber: '09 91 23',
    sectionTitle: 'Interior Painting',
    parts: { general: true, products: false, execution: false },
    requirements: [
      {
        requirementType: 'submittal_requirement',
        statement: 'Submit field test reports for record only.',
        partReference: '1.3.A',
        confidence: 0.7,
      },
    ],
    referencedStandards: [],
    confidence: 0.75,
  },
}

const happyLlmCaller = async ({ sectionContext }) => {
  const canned = cannedSectionResponses[sectionContext.sectionNumber]
  if (!canned) {
    return { rawText: '', modelUsed: 'mock-haiku', error: 'no canned response' }
  }
  return {
    rawText: JSON.stringify(canned),
    modelUsed: 'mock-haiku-4-5',
    costUsd: 0.0008,
  }
}

const happyResult = await runSpecExtractionPipeline({
  projectId: 'sample-project',
  documentId: 'sample-doc',
  documentMeta: {
    title: 'AmmunitionStorageWL Project Manual',
    filename: 'AmmunitionStorageWL_Amendment0002_Specifications.pdf',
  },
  chunks: specChunks,
  llmCaller: happyLlmCaller,
})

console.log('')
console.log('Spec extraction — happy path (CSI sections + parts + submittal requirements + approval/record-only):')
console.log(JSON.stringify({
  documentClassification: happyResult.documentClassification,
  totalSections: happyResult.totalSections,
  sectionsAttempted: happyResult.sectionsAttempted,
  sectionsSucceeded: happyResult.sectionsSucceeded,
  totalCostUsd: happyResult.totalCostUsd,
  topLevelWarnings: happyResult.warnings,
  sections: happyResult.sections.map(s => ({
    section: s.sectionNumber,
    title: s.sectionTitle,
    canonicalName: s.canonicalName,
    divisionNumber: s.divisionNumber,
    parts: s.parts,
    requirementCount: s.requirements.length,
    submittalCount: s.requirements.filter(r => r.requirementType === 'submittal_requirement').length,
    approvalRequiredCount: s.requirements.filter(r => r.approvalRequired).length,
    recordOnlyCount: s.requirements.filter(r => r.recordOnly).length,
    requirements: s.requirements.map(r => ({
      type: r.requirementType,
      regexFamily: r.regexFamily,
      regexAgreesWithModel: r.regexFamily === r.requirementType,
      approvalRequired: r.approvalRequired,
      recordOnly: r.recordOnly,
      canonicalName: r.canonicalName,
    })),
    referencedStandards: s.referencedStandards,
    sourceChunkIds: s.sourceChunkIds,
    sourcePageNumbers: s.sourcePageNumbers,
    confidence: s.confidence,
    validationFailed: s.validationFailed,
    sectionCharCount: s.sectionCharCount,
    regexFirstPassTotal: s.regexFirstPassTotal,
    regexSubmittalCount: s.regexFirstPassByFamily.submittal_requirement?.length ?? 0,
    warnings: s.warnings,
  })),
}, null, 2))

const malformedLlmCaller = async () => ({
  rawText: 'Sure, here you go: { not_valid_json: see notes }',
  modelUsed: 'mock-haiku-4-5',
})

const malformedResult = await runSpecExtractionPipeline({
  projectId: 'sample-project',
  documentId: 'sample-doc',
  documentMeta: { filename: 'specs.pdf' },
  chunks: [
    {
      id: 'chunk-bad',
      chunk_index: 0,
      page_number: 1,
      content: 'SECTION 03 30 00 - CAST-IN-PLACE CONCRETE\nPART 1 - GENERAL\nA. Concrete shall be placed in accordance with ACI 301.',
    },
  ],
  llmCaller: malformedLlmCaller,
})

console.log('')
console.log('Spec extraction — malformed JSON case:')
console.log(JSON.stringify({
  validationFailed: malformedResult.sections[0]?.validationFailed,
  requirementCount: malformedResult.sections[0]?.requirements.length ?? 0,
  warnings: malformedResult.sections[0]?.warnings,
  regexFirstPassTotal: malformedResult.sections[0]?.regexFirstPassTotal,
}, null, 2))

const oversizeBody =
  'SECTION 99 99 99 GIANT SECTION PART 1 GENERAL\n' +
  Array.from({ length: 800 }, (_, i) => `${i + 1}. The contractor shall comply with the requirements of this section.`).join('\n')

const oversizeResult = await runSpecExtractionPipeline({
  projectId: 'sample-project',
  documentId: 'sample-doc',
  documentMeta: { filename: 'specs.pdf' },
  chunks: [{ id: 'chunk-big', chunk_index: 0, page_number: 1, content: oversizeBody }],
  llmCaller: async () => {
    throw new Error('LLM caller should not have been invoked for oversize section')
  },
  options: { maxSectionChars: 1000 },
})

console.log('')
console.log('Spec extraction — oversize section guardrail:')
console.log(JSON.stringify({
  sectionCharCount: oversizeResult.sections[0]?.sectionCharCount,
  validationFailed: oversizeResult.sections[0]?.validationFailed,
  costUsd: oversizeResult.sections[0]?.costUsd,
  warnings: oversizeResult.sections[0]?.warnings,
  regexFirstPassTotal: oversizeResult.sections[0]?.regexFirstPassTotal,
}, null, 2))

console.log('')
console.log('Approval / record-only phrase detection:')
console.log(JSON.stringify({
  approvalSamples: [
    'Submit product data for approval prior to installation.',
    'Obtain engineer’s written approval before fabrication.',
    'Submit shop drawings for review.',
  ].map(s => ({ s, approvalRequired: detectApprovalRequired(s), recordOnly: detectRecordOnly(s) })),
  recordOnlySamples: [
    'Submit field test reports for record only.',
    'Informational submittal: provide manufacturer cut sheets.',
    'Submit for information.',
  ].map(s => ({ s, approvalRequired: detectApprovalRequired(s), recordOnly: detectRecordOnly(s) })),
  ambiguousSamples: [
    'Concrete shall be placed in accordance with ACI 301.',
    'The contractor shall maintain the work area.',
  ].map(s => ({ s, approvalRequired: detectApprovalRequired(s), recordOnly: detectRecordOnly(s) })),
}, null, 2))

// ---------------------------------------------------------------------------
// Spec extraction persistence row builder (A3b) — pure transform coverage
// ---------------------------------------------------------------------------

const persistenceRowSet = buildSpecPersistenceRows(
  'sample-project',
  'sample-doc',
  happyResult
)

console.log('')
console.log('Spec persistence row builder — happy path:')
console.log(JSON.stringify({
  projectId: persistenceRowSet.projectId,
  documentId: persistenceRowSet.documentId,
  totalSectionCount: persistenceRowSet.totalSectionCount,
  totalRequirementCount: persistenceRowSet.totalRequirementCount,
  skippedSectionCount: persistenceRowSet.skippedSectionCount,
  firstSection: persistenceRowSet.sections[0] && {
    sectionEntityKeys: Object.keys(persistenceRowSet.sections[0].sectionEntity),
    sectionCanonical: persistenceRowSet.sections[0].sectionEntity.canonical_name,
    sectionDisplayName: persistenceRowSet.sections[0].sectionEntity.display_name,
    sectionSubtype: persistenceRowSet.sections[0].sectionEntity.subtype,
    sectionDiscipline: persistenceRowSet.sections[0].sectionEntity.discipline,
    sectionEntityType: persistenceRowSet.sections[0].sectionEntity.entity_type,
    sectionExtractionSource: persistenceRowSet.sections[0].sectionEntity.extraction_source,
    sectionMetadataKeys: Object.keys(persistenceRowSet.sections[0].sectionEntity.metadata),
    requirementCount: persistenceRowSet.sections[0].requirements.length,
    firstRequirement: persistenceRowSet.sections[0].requirements[0] && {
      entityCanonical: persistenceRowSet.sections[0].requirements[0].requirementEntity.canonical_name,
      entitySubtype: persistenceRowSet.sections[0].requirements[0].requirementEntity.subtype,
      entityDisplayName: persistenceRowSet.sections[0].requirements[0].requirementEntity.display_name,
      entityMetadataParent: persistenceRowSet.sections[0].requirements[0].requirementEntity.metadata.parentSectionCanonical,
      citationKeys: Object.keys(persistenceRowSet.sections[0].requirements[0].citation),
      citationSheetNumber: persistenceRowSet.sections[0].requirements[0].citation.sheet_number,
      citationDocumentId: persistenceRowSet.sections[0].requirements[0].citation.document_id,
      citationExtractionSource: persistenceRowSet.sections[0].requirements[0].citation.extraction_source,
      findingKeys: Object.keys(persistenceRowSet.sections[0].requirements[0].finding),
      findingType: persistenceRowSet.sections[0].requirements[0].finding.finding_type,
      findingSupportLevel: persistenceRowSet.sections[0].requirements[0].finding.support_level,
      findingMetadataApprovalRequired: persistenceRowSet.sections[0].requirements[0].finding.metadata.approvalRequired,
    },
  },
  citationsHaveNoEntityIdYet: persistenceRowSet.sections.every(s =>
    s.requirements.every(r => !('entity_id' in r.citation) && !('finding_id' in r.citation))
  ),
  findingsHaveNoEntityIdOrCitationIdYet: persistenceRowSet.sections.every(s =>
    s.requirements.every(r => !('entity_id' in r.finding) && !('citation_id' in r.finding))
  ),
  allRequirementCanonicalsAreUnique:
    new Set(persistenceRowSet.sections.flatMap(s => s.requirements.map(r => r.requirementEntity.canonical_name))).size ===
    persistenceRowSet.totalRequirementCount,
}, null, 2))

const failedSectionResult = {
  ...malformedResult,
  // mark as obviously empty + failed for the skip path
}
const skipRowSet = buildSpecPersistenceRows('sample-project', 'sample-doc', failedSectionResult)

console.log('')
console.log('Spec persistence row builder — skips validationFailed sections with zero requirements:')
console.log(JSON.stringify({
  totalSectionCount: skipRowSet.totalSectionCount,
  totalRequirementCount: skipRowSet.totalRequirementCount,
  skippedSectionCount: skipRowSet.skippedSectionCount,
}, null, 2))

const oversizeRowSet = buildSpecPersistenceRows('sample-project', 'sample-doc', oversizeResult)

console.log('')
console.log('Spec persistence row builder — oversize section preserved as section entity (no requirements, regex evidence in metadata):')
console.log(JSON.stringify({
  totalSectionCount: oversizeRowSet.totalSectionCount,
  totalRequirementCount: oversizeRowSet.totalRequirementCount,
  skippedSectionCount: oversizeRowSet.skippedSectionCount,
  oversizeSectionMetadataKeys: oversizeRowSet.sections[0]
    ? Object.keys(oversizeRowSet.sections[0].sectionEntity.metadata)
    : null,
  oversizeSectionWarnings: oversizeRowSet.sections[0]?.sectionEntity.metadata.warnings,
  oversizeRegexFirstPassTotal:
    oversizeRowSet.sections[0]?.sectionEntity.metadata.regexFirstPassTotal,
}, null, 2))
