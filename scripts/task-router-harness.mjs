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
