#!/usr/bin/env node

import {
  evaluateSubmittalCoverageQA,
  getSubmittalItemKey,
} from '../src/lib/chat/submittal-coverage-qa.ts'

import {
  shouldSuppressSubmittalCandidate,
  extractSdCode,
} from '../src/lib/chat/submittal-register.ts'

import { evaluateRegisterPublishReadiness } from '../src/lib/chat/submittal-publish-readiness.ts'

import { normalizeDocumentText } from '../src/lib/ingestion/document-normalization.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`)
    failed++
  }
}

function mockItem(overrides = {}) {
  return {
    specSection: '03 30 00',
    sectionTitle: 'Cast-in-Place Concrete',
    submittalItem: 'Concrete Mix Design',
    submittalType: 'SD-03 Product Data',
    requiredAction: 'Submit for approval',
    approvalRequired: true,
    sourceReference: { pageNumber: 1, specSection: '03 30 00', sectionTitle: 'Cast-in-Place Concrete' },
    excerpt: 'Submit concrete mix design.',
    confidence: 0.9,
    notes: null,
    sdCode: 'SD-03',
    approvalAuthority: 'Government',
    sourceExcerpt: 'Submit concrete mix design for approval.',
    rawExcerpt: 'Submit concrete mix design for approval.',
    blockingRisk: 'none',
    lifecycleDueDate: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n=== QA Submittal Harness ===\n')

// Test 1: Missing SD code
{
  console.log('Test 1: Missing SD code')
  const item = mockItem({ sdCode: null })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'missing_sd_code')
  assert('finding exists', !!finding)
  assert('severity is warning', finding?.severity === 'warning')
  assert('1 affected item', finding?.affectedItemIds.length === 1)
  assert('affectedItemIds matches key', finding?.affectedItemIds[0] === getSubmittalItemKey(item, 0))
  console.log()
}

// Test 2: Missing approval authority
{
  console.log('Test 2: Missing approval authority')
  const item = mockItem({ approvalAuthority: null })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'missing_approval_authority')
  assert('finding exists', !!finding)
  assert('severity is warning', finding?.severity === 'warning')
  assert('1 affected item', finding?.affectedItemIds.length === 1)
  console.log()
}

// Test 3: Blocking risk (high) with no due date → critical
{
  console.log('Test 3: Blocking risk high + no due date → critical')
  const item = mockItem({ blockingRisk: 'high', lifecycleDueDate: null })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_no_due_date')
  assert('finding exists', !!finding)
  assert('severity is critical', finding?.severity === 'critical')
  assert('1 affected item', finding?.affectedItemIds.length === 1)
  console.log()
}

// Test 3b: Blocking risk (medium) with no due date → also critical
{
  console.log('Test 3b: Blocking risk medium + no due date → critical')
  const item = mockItem({ blockingRisk: 'medium', lifecycleDueDate: null })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_no_due_date')
  assert('finding exists', !!finding)
  assert('severity is critical', finding?.severity === 'critical')
  console.log()
}

// Test 3c: Low blocking risk with no due date → NOT flagged
{
  console.log('Test 3c: Blocking risk low + no due date → not flagged')
  const item = mockItem({ blockingRisk: 'low', lifecycleDueDate: null })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_no_due_date')
  assert('no finding for low risk', !finding)
  console.log()
}

// Test 3d: High risk WITH due date → not flagged
{
  console.log('Test 3d: Blocking risk high with due date → not flagged')
  const item = mockItem({ blockingRisk: 'high', lifecycleDueDate: '2026-06-01' })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_no_due_date')
  assert('no finding when due date present', !finding)
  console.log()
}

// Test 4: Missing source excerpt — info severity
{
  console.log('Test 4: Missing source excerpt (no blocking risk) → info')
  const item = mockItem({ sourceExcerpt: null, rawExcerpt: null, blockingRisk: 'none' })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'missing_source_excerpt')
  assert('finding exists', !!finding)
  assert('severity is info', finding?.severity === 'info')
  assert('1 affected item', finding?.affectedItemIds.length === 1)
  console.log()
}

// Test 4b: Missing source excerpt + high blocking risk → warning
{
  console.log('Test 4b: Missing source excerpt + high blocking risk → warning')
  const item = mockItem({ sourceExcerpt: null, rawExcerpt: null, blockingRisk: 'high' })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'missing_source_excerpt')
  assert('finding exists', !!finding)
  assert('severity bumped to warning', finding?.severity === 'warning')
  console.log()
}

// Test 5: Duplicate-looking submittals
{
  console.log('Test 5: Duplicate-looking submittals')
  const base = { submittalItem: 'Concrete Mix Design', specSection: '03 30 00', sdCode: 'SD-03' }
  const item1 = mockItem({ ...base, persistedItemId: 'id-001' })
  const item2 = mockItem({ ...base, persistedItemId: 'id-002' })
  const item3 = mockItem({ submittalItem: 'Rebar Shop Drawings', specSection: '03 20 00', sdCode: 'SD-02', persistedItemId: 'id-003' })
  const result = evaluateSubmittalCoverageQA({ items: [item1, item2, item3] })
  const finding = result.findings.find(f => f.type === 'duplicate_submittal')
  assert('finding exists', !!finding)
  assert('severity is warning', finding?.severity === 'warning')
  assert('2 affected items in group', finding?.affectedItemIds.length === 2)
  assert('item3 not in duplicates', !finding?.affectedItemIds.includes('id-003'))
  console.log()
}

// Test 5b: Case-insensitive name normalization
{
  console.log('Test 5b: Duplicate detection is case-insensitive')
  const item1 = mockItem({ submittalItem: 'CONCRETE MIX DESIGN', specSection: '03 30 00', sdCode: 'SD-03', persistedItemId: 'id-A' })
  const item2 = mockItem({ submittalItem: 'concrete mix design', specSection: '03 30 00', sdCode: 'SD-03', persistedItemId: 'id-B' })
  const result = evaluateSubmittalCoverageQA({ items: [item1, item2] })
  const finding = result.findings.find(f => f.type === 'duplicate_submittal')
  assert('case-insensitive match detected', !!finding)
  console.log()
}

// Test 6: Empty specSections → no crash, no spec_section_no_submittals finding
{
  console.log('Test 6: Empty specSections → no crash')
  const item = mockItem()
  let result
  try {
    result = evaluateSubmittalCoverageQA({ items: [item], specSections: [] })
    assert('no crash on empty specSections', true)
  } catch (e) {
    assert('no crash on empty specSections', false, String(e))
  }
  const finding = result?.findings.find(f => f.type === 'spec_section_no_submittals')
  assert('no spec_section_no_submittals finding', !finding)
  console.log()
}

// Test 6b: specSections provided — detects uncovered section
{
  console.log('Test 6b: specSections provided → detects uncovered section')
  const item = mockItem({ specSection: '03 30 00' })
  const result = evaluateSubmittalCoverageQA({
    items: [item],
    specSections: ['03 30 00', '05 12 00'],
  })
  const finding = result.findings.find(f => f.type === 'spec_section_no_submittals')
  assert('finding exists', !!finding)
  assert('severity is info', finding?.severity === 'info')
  assert('uncovered section in affectedItemIds', finding?.affectedItemIds.includes('05 12 00'))
  assert('covered section not in affectedItemIds', !finding?.affectedItemIds.includes('03 30 00'))
  console.log()
}

// Test 6c: Object-form specSections
{
  console.log('Test 6c: Object-form specSections')
  const item = mockItem({ specSection: '03 30 00' })
  const result = evaluateSubmittalCoverageQA({
    items: [item],
    specSections: [
      { sectionNumber: '03 30 00', title: 'Cast-in-Place Concrete' },
      { sectionNumber: '05 12 00', title: 'Structural Steel' },
    ],
  })
  const finding = result.findings.find(f => f.type === 'spec_section_no_submittals')
  assert('finding exists', !!finding)
  assert('only uncovered section listed', finding?.affectedItemIds.length === 1)
  console.log()
}

// Test 7: Empty items list → no crash
{
  console.log('Test 7: Empty items list → no crash, totalItems=0')
  let result
  try {
    result = evaluateSubmittalCoverageQA({ items: [] })
    assert('no crash on empty items', true)
  } catch (e) {
    assert('no crash on empty items', false, String(e))
  }
  assert('0 findings', result?.findings.length === 0)
  assert('totalItems is 0', result?.totalItems === 0)
  console.log()
}

// Test 8: All-clear item produces no findings
{
  console.log('Test 8: Complete item produces no findings')
  const item = mockItem({
    sdCode: 'SD-03',
    approvalAuthority: 'Government',
    blockingRisk: 'high',
    lifecycleDueDate: '2026-07-01',
    sourceExcerpt: 'Some excerpt',
    persistedItemId: 'clean-item',
    relatedFOW: 'Foundations',
    scheduleActivity: 'Pour Footings',
  })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  assert('0 findings', result.findings.length === 0)
  console.log()
}

// ---------------------------------------------------------------------------
// blocking_risk_missing_work_linkage tests
// ---------------------------------------------------------------------------

// Test WL-1: high-risk item with no FOW or activity → flagged
{
  console.log('Test WL-1: High-risk, no FOW or scheduleActivity → flagged')
  const item = mockItem({ blockingRisk: 'high', relatedFOW: null, scheduleActivity: null })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_missing_work_linkage')
  assert('finding exists', !!finding)
  assert('severity is warning', finding?.severity === 'warning')
  assert('one affected item', finding?.affectedItemIds.length === 1)
  console.log()
}

// Test WL-2: medium-risk item with no FOW or activity → flagged
{
  console.log('Test WL-2: Medium-risk, no FOW or scheduleActivity → flagged')
  const item = mockItem({ blockingRisk: 'medium', relatedFOW: null, scheduleActivity: null })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_missing_work_linkage')
  assert('finding exists', !!finding)
  console.log()
}

// Test WL-3: high-risk item with relatedFOW set → not flagged
{
  console.log('Test WL-3: High-risk with relatedFOW set → not flagged')
  const item = mockItem({ blockingRisk: 'high', relatedFOW: 'Foundations', scheduleActivity: null })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_missing_work_linkage')
  assert('no finding when relatedFOW is set', !finding)
  console.log()
}

// Test WL-4: high-risk item with scheduleActivity set → not flagged
{
  console.log('Test WL-4: High-risk with scheduleActivity set → not flagged')
  const item = mockItem({ blockingRisk: 'high', relatedFOW: null, scheduleActivity: 'Pour Footings' })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_missing_work_linkage')
  assert('no finding when scheduleActivity is set', !finding)
  console.log()
}

// Test WL-5: low-risk item with no FOW or activity → NOT flagged
{
  console.log('Test WL-5: Low-risk, no FOW or scheduleActivity → not flagged')
  const item = mockItem({ blockingRisk: 'low', relatedFOW: null, scheduleActivity: null })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_missing_work_linkage')
  assert('no finding for low-risk item', !finding)
  console.log()
}

// Test WL-6: none-risk item with no FOW or activity → NOT flagged
{
  console.log('Test WL-6: None-risk, no FOW or scheduleActivity → not flagged')
  const item = mockItem({ blockingRisk: 'none', relatedFOW: null, scheduleActivity: null })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_missing_work_linkage')
  assert('no finding for none-risk item', !finding)
  console.log()
}

// Test WL-7: mixed — 2 high-risk missing linkage, 1 high-risk with linkage
{
  console.log('Test WL-7: Mixed set — 2 missing linkage, 1 linked → only 2 flagged')
  const a = mockItem({ blockingRisk: 'high', persistedItemId: 'wl-a', relatedFOW: null, scheduleActivity: null })
  const b = mockItem({ blockingRisk: 'medium', persistedItemId: 'wl-b', relatedFOW: null, scheduleActivity: null })
  const c = mockItem({ blockingRisk: 'high', persistedItemId: 'wl-c', relatedFOW: 'Superstructure', scheduleActivity: null })
  const result = evaluateSubmittalCoverageQA({ items: [a, b, c] })
  const finding = result.findings.find(f => f.type === 'blocking_risk_missing_work_linkage')
  assert('finding exists', !!finding)
  assert('2 affected items', finding?.affectedItemIds.length === 2)
  assert('linked item not included', !finding?.affectedItemIds.includes('wl-c'))
  console.log()
}

// ---------------------------------------------------------------------------
// Acknowledgement tests
// ---------------------------------------------------------------------------

// Test A: acknowledged missing_source_excerpt → suppressed
{
  console.log('Test A: Acknowledged missing_source_excerpt → suppressed from finding')
  const item = mockItem({
    sourceExcerpt: null,
    rawExcerpt: null,
    qaAcknowledgements: {
      missing_source_excerpt: { acknowledgedAt: '2026-05-09T00:00:00Z', acknowledgedBy: 'test@example.com' },
    },
  })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'missing_source_excerpt')
  assert('no finding for acknowledged item', !finding)
  console.log()
}

// Test B: one unacknowledged item still flagged even alongside acknowledged one
{
  console.log('Test B: Mixed acknowledgement — unacknowledged item still flagged')
  const acked = mockItem({
    sourceExcerpt: null,
    rawExcerpt: null,
    persistedItemId: 'ack-001',
    qaAcknowledgements: {
      missing_source_excerpt: { acknowledgedAt: '2026-05-09T00:00:00Z' },
    },
  })
  const unacked = mockItem({
    sourceExcerpt: null,
    rawExcerpt: null,
    persistedItemId: 'unack-001',
  })
  const result = evaluateSubmittalCoverageQA({ items: [acked, unacked] })
  const finding = result.findings.find(f => f.type === 'missing_source_excerpt')
  assert('finding exists', !!finding)
  assert('only unacknowledged item in finding', finding?.affectedItemIds.length === 1)
  assert('unacknowledged item is the one flagged', finding?.affectedItemIds.includes('unack-001'))
  assert('acknowledged item not in finding', !finding?.affectedItemIds.includes('ack-001'))
  console.log()
}

// Test C: duplicate group — both acknowledged → suppressed
{
  console.log('Test C: Both duplicates acknowledged → suppressed')
  const base = { submittalItem: 'Concrete Mix Design', specSection: '03 30 00', sdCode: 'SD-03' }
  const ack = { duplicate_submittal: { acknowledgedAt: '2026-05-09T00:00:00Z' } }
  const item1 = mockItem({ ...base, persistedItemId: 'dup-001', qaAcknowledgements: ack })
  const item2 = mockItem({ ...base, persistedItemId: 'dup-002', qaAcknowledgements: ack })
  const result = evaluateSubmittalCoverageQA({ items: [item1, item2] })
  const finding = result.findings.find(f => f.type === 'duplicate_submittal')
  assert('no finding when all group members acknowledged', !finding)
  console.log()
}

// Test D: duplicate group — only one acknowledged → full group still visible
{
  console.log('Test D: One duplicate acknowledged → full group still visible')
  const base = { submittalItem: 'Concrete Mix Design', specSection: '03 30 00', sdCode: 'SD-03' }
  const item1 = mockItem({
    ...base,
    persistedItemId: 'dup-003',
    qaAcknowledgements: { duplicate_submittal: { acknowledgedAt: '2026-05-09T00:00:00Z' } },
  })
  const item2 = mockItem({ ...base, persistedItemId: 'dup-004' })
  const result = evaluateSubmittalCoverageQA({ items: [item1, item2] })
  const finding = result.findings.find(f => f.type === 'duplicate_submittal')
  assert('finding still present', !!finding)
  assert('both items in finding (context)', finding?.affectedItemIds.length === 2)
  assert('acknowledged item still visible for context', finding?.affectedItemIds.includes('dup-003'))
  assert('unacknowledged item still visible', finding?.affectedItemIds.includes('dup-004'))
  console.log()
}

// Test E: acknowledgements on other types do not suppress fixable issues
{
  console.log('Test E: qaAcknowledgements does not suppress fixable metadata issues')
  const item = mockItem({
    sdCode: null,
    approvalAuthority: null,
    // acknowledging excerpt/duplicate should NOT suppress sdCode or auth issues
    qaAcknowledgements: {
      missing_source_excerpt: { acknowledgedAt: '2026-05-09T00:00:00Z' },
      duplicate_submittal: { acknowledgedAt: '2026-05-09T00:00:00Z' },
    },
  })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const sdFinding = result.findings.find(f => f.type === 'missing_sd_code')
  const authFinding = result.findings.find(f => f.type === 'missing_approval_authority')
  assert('missing_sd_code still flagged', !!sdFinding)
  assert('missing_approval_authority still flagged', !!authFinding)
  console.log()
}

// Test F: three-item duplicate group — one acknowledged → group remains (2 unacked + 1 acked = all visible)
{
  console.log('Test F: Three-item duplicate group, one acknowledged → all three visible')
  const base = { submittalItem: 'Rebar Shop Drawings', specSection: '03 20 00', sdCode: 'SD-02' }
  const item1 = mockItem({ ...base, persistedItemId: 'tri-001' })
  const item2 = mockItem({ ...base, persistedItemId: 'tri-002' })
  const item3 = mockItem({
    ...base,
    persistedItemId: 'tri-003',
    qaAcknowledgements: { duplicate_submittal: { acknowledgedAt: '2026-05-09T00:00:00Z' } },
  })
  const result = evaluateSubmittalCoverageQA({ items: [item1, item2, item3] })
  const finding = result.findings.find(f => f.type === 'duplicate_submittal')
  assert('finding present', !!finding)
  assert('all 3 items visible for context', finding?.affectedItemIds.length === 3)
  console.log()
}

// ---------------------------------------------------------------------------
// Suppression filter tests
// ---------------------------------------------------------------------------

console.log('Test SUPP-1: Section heading suppressed')
assert('"1.2 SUBMITTALS" suppressed', shouldSuppressSubmittalCandidate('1.2 SUBMITTALS').suppress)
assert('"l.2 SUBMITTALS" (OCR) suppressed', shouldSuppressSubmittalCandidate('l.2 SUBMITTALS').suppress)
assert('"1.3 SUBMITTAL PROCEDURES" suppressed', shouldSuppressSubmittalCandidate('1.3 SUBMITTAL PROCEDURES').suppress)
assert('"SUBMITTALS" bare heading suppressed', shouldSuppressSubmittalCandidate('SUBMITTALS').suppress)
console.log()

console.log('Test SUPP-2: Preamble / intro text suppressed')
assert('Note: prefix suppressed', shouldSuppressSubmittalCandidate('Note: Some authorities differ.').suppress)
assert('"This section includes..." suppressed', shouldSuppressSubmittalCandidate('This section includes requirements for concrete.').suppress)
assert('"The following submittals are required" suppressed', shouldSuppressSubmittalCandidate('The following submittals are required. Submit per Section 01 33 00.').suppress)
assert('"Contractor shall submit the following" suppressed', shouldSuppressSubmittalCandidate('Contractor shall submit the following in accordance with Section 01 33 00:').suppress)
assert('"are required." fragment suppressed', shouldSuppressSubmittalCandidate('are required. Submit all items per Section 01 33 00.').suppress)
console.log()

console.log('Test SUPP-3: Valid items NOT suppressed')
assert('Product data item not suppressed', !shouldSuppressSubmittalCandidate('A. Product Data: Submit manufacturer data for concrete admixtures. SD-03.').suppress)
assert('Shop drawing item not suppressed', !shouldSuppressSubmittalCandidate('B. Shop Drawings: Submit fabrication drawings. SD-02. Government Approval Required.').suppress)
assert('Mix design not suppressed', !shouldSuppressSubmittalCandidate('C. Mix Designs: Submit concrete mix designs 30 days prior. SD-03. Government.').suppress)
assert('Certificates not suppressed', !shouldSuppressSubmittalCandidate('D. Mill Certificates: Submit certified mill test reports. SD-07.').suppress)
console.log()

// ---------------------------------------------------------------------------
// SD code normalization tests
// ---------------------------------------------------------------------------

console.log('Test SD-NORM: Malformed SD code normalization')
assert('SD-03 canonical', extractSdCode('SD-03 Product Data') === 'SD-03')
assert('SD-O3 (OCR letter O)', extractSdCode('SD-O3 Product Data') === 'SD-03')
assert('s.d. 03 (dots)', extractSdCode('s.d. 03 Product Data') === 'SD-03')
assert('SD07 (no separator)', extractSdCode('SD07 Certificates') === 'SD-07')
assert('SD- 07 (space after dash)', extractSdCode('SD- 07 Certificates') === 'SD-07')
assert('SD-8 (single digit)', extractSdCode('SD-8 Instructions') === 'SD-08')
assert('SD - 06 (space-dash-space)', extractSdCode('SD - 06 Test Reports') === 'SD-06')
assert('SD09 (no dash)', extractSdCode('SD09 Field Reports') === 'SD-09')
assert('s.d.8 (dots + single digit)', extractSdCode('s.d.8 Instructions') === 'SD-08')
assert('SD-12 out of range → null', extractSdCode('SD-12 Invalid') === null)
assert('SD-0 out of range → null', extractSdCode('SD-0 Invalid') === null)
console.log()

// ---------------------------------------------------------------------------
// Conditional approval authority QA finding
// ---------------------------------------------------------------------------

console.log('Test COND-1: Conditional authority flagged')
{
  const item = mockItem({
    approvalAuthorityCondition: 'if excavation exceeds 15 feet depth',
    approvalAuthority: 'GOV',
    persistedItemId: 'cond-001',
  })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'conditional_approval_authority')
  assert('conditional authority finding exists', !!finding)
  assert('severity is warning', finding?.severity === 'warning')
  assert('affected item included', finding?.affectedItemIds.includes('cond-001'))
}
console.log()

console.log('Test COND-2: No condition → no finding')
{
  const item = mockItem({ approvalAuthority: 'GOV', persistedItemId: 'cond-002' })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const finding = result.findings.find(f => f.type === 'conditional_approval_authority')
  assert('no conditional finding when clean', !finding)
}
console.log()

// ---------------------------------------------------------------------------
// Cross-section duplicate QA finding
// ---------------------------------------------------------------------------

console.log('Test XSD-1: Cross-section duplicate flagged')
{
  const item1 = mockItem({ submittalItem: 'Concrete Mix Design', specSection: '03 30 00', persistedItemId: 'xsd-001' })
  const item2 = mockItem({ submittalItem: 'Concrete Mix Design', specSection: '31 60 00', persistedItemId: 'xsd-002' })
  const result = evaluateSubmittalCoverageQA({ items: [item1, item2] })
  const finding = result.findings.find(f => f.type === 'cross_section_duplicate_submittal')
  assert('cross-section duplicate finding exists', !!finding)
  assert('severity is warning', finding?.severity === 'warning')
  assert('both items in finding', finding?.affectedItemIds.length === 2)
  assert('xsd-001 included', finding?.affectedItemIds.includes('xsd-001'))
  assert('xsd-002 included', finding?.affectedItemIds.includes('xsd-002'))
}
console.log()

console.log('Test XSD-2: Same section → not a cross-section duplicate')
{
  const item1 = mockItem({ submittalItem: 'Concrete Mix Design', specSection: '03 30 00', persistedItemId: 'xsd-003' })
  const item2 = mockItem({ submittalItem: 'Concrete Mix Design', specSection: '03 30 00', persistedItemId: 'xsd-004' })
  const result = evaluateSubmittalCoverageQA({ items: [item1, item2] })
  const finding = result.findings.find(f => f.type === 'cross_section_duplicate_submittal')
  assert('no cross-section finding for same-section items', !finding)
}
console.log()

console.log('Test XSD-3: Different item names → no cross-section finding')
{
  const item1 = mockItem({ submittalItem: 'Concrete Mix Design', specSection: '03 30 00', persistedItemId: 'xsd-005' })
  const item2 = mockItem({ submittalItem: 'Rebar Shop Drawings', specSection: '31 60 00', persistedItemId: 'xsd-006' })
  const result = evaluateSubmittalCoverageQA({ items: [item1, item2] })
  const finding = result.findings.find(f => f.type === 'cross_section_duplicate_submittal')
  assert('no cross-section finding for different items', !finding)
}
console.log()

// ---------------------------------------------------------------------------
// Publish Readiness Tests
// ---------------------------------------------------------------------------

console.log('\n=== Publish Readiness Tests ===\n')

// PRG-1: good ingestion + no QA findings → ready
{
  console.log('PRG-1: good ingestion + no QA findings → ready')
  const result = evaluateRegisterPublishReadiness({
    ingestionGrade: 'good',
    ingestionGradeReasons: [],
    qaResult: { findings: [], checkedAt: new Date().toISOString(), totalItems: 10 },
  })
  assert('status is ready', result.status === 'ready')
  assert('no reasons', result.reasons.length === 0)
  assert('no required actions', result.requiredActions.length === 0)
  console.log()
}

// PRG-2: needs_review ingestion → needs_review
{
  console.log('PRG-2: needs_review ingestion → needs_review')
  const result = evaluateRegisterPublishReadiness({
    ingestionGrade: 'needs_review',
    ingestionGradeReasons: ['SD coverage 55.0% < 70%'],
  })
  assert('status is needs_review', result.status === 'needs_review')
  assert('reason surfaces grade detail', result.reasons.includes('SD coverage 55.0% < 70%'))
  assert('required action present', result.requiredActions.length > 0)
  console.log()
}

// PRG-3: poor_extraction ingestion → blocked
{
  console.log('PRG-3: poor_extraction ingestion → blocked')
  const result = evaluateRegisterPublishReadiness({
    ingestionGrade: 'poor_extraction',
    ingestionGradeReasons: ['SD coverage 30.0% < 50%', '3 critical QA findings'],
  })
  assert('status is blocked', result.status === 'blocked')
  assert('reason includes SD coverage detail', result.reasons.includes('SD coverage 30.0% < 50%'))
  assert('required action present', result.requiredActions.length > 0)
  console.log()
}

// PRG-4: critical QA finding → blocked (regardless of ingestion grade)
{
  console.log('PRG-4: critical QA finding → blocked')
  const result = evaluateRegisterPublishReadiness({
    ingestionGrade: 'good',
    qaResult: {
      findings: [
        {
          id: 'blocking_risk_no_due_date',
          severity: 'critical',
          type: 'blocking_risk_no_due_date',
          message: '2 high/medium-risk items with no due date',
          affectedItemIds: ['a', 'b'],
          suggestedAction: 'Assign due dates.',
        },
      ],
      checkedAt: new Date().toISOString(),
      totalItems: 5,
    },
  })
  assert('status is blocked', result.status === 'blocked')
  assert('reason is QA finding message', result.reasons.includes('2 high/medium-risk items with no due date'))
  assert('required action is QA suggested action', result.requiredActions.includes('Assign due dates.'))
  console.log()
}

// PRG-5: warning QA finding → needs_review
{
  console.log('PRG-5: warning QA finding → needs_review')
  const result = evaluateRegisterPublishReadiness({
    ingestionGrade: 'good',
    qaResult: {
      findings: [
        {
          id: 'missing_sd_code',
          severity: 'warning',
          type: 'missing_sd_code',
          message: '3 items missing an SD code',
          affectedItemIds: ['a', 'b', 'c'],
          suggestedAction: 'Assign SD codes.',
        },
      ],
      checkedAt: new Date().toISOString(),
      totalItems: 5,
    },
  })
  assert('status is needs_review', result.status === 'needs_review')
  assert('reason is QA finding message', result.reasons.includes('3 items missing an SD code'))
  console.log()
}

// PRG-6: critical + warning → blocked (critical takes precedence)
{
  console.log('PRG-6: critical + warning → blocked (critical wins)')
  const result = evaluateRegisterPublishReadiness({
    qaResult: {
      findings: [
        {
          id: 'blocking_risk_no_due_date',
          severity: 'critical',
          type: 'blocking_risk_no_due_date',
          message: '1 high-risk item with no due date',
          affectedItemIds: ['a'],
          suggestedAction: 'Assign due date.',
        },
        {
          id: 'missing_sd_code',
          severity: 'warning',
          type: 'missing_sd_code',
          message: '2 items missing an SD code',
          affectedItemIds: ['b', 'c'],
          suggestedAction: 'Assign SD codes.',
        },
      ],
      checkedAt: new Date().toISOString(),
      totalItems: 3,
    },
  })
  assert('status is blocked', result.status === 'blocked')
  assert('both messages in reasons', result.reasons.length === 2)
  console.log()
}

// PRG-7: no grade + no QA → ready
{
  console.log('PRG-7: no grade, no QA result → ready')
  const result = evaluateRegisterPublishReadiness({})
  assert('status is ready', result.status === 'ready')
  assert('empty reasons', result.reasons.length === 0)
  console.log()
}

// ---------------------------------------------------------------------------
// Document Normalization Tests
// ---------------------------------------------------------------------------

console.log('\n=== Document Normalization Tests ===\n')

// Build a mock multi-page document with the West Loch DoD header format
const WEST_LOCH_PREFIX = 'FY22   MILCON PROJECT PN 080133 AMMUNITION   STORAGE   1644749 WEST   LOCH, HAWAII'

function makeDodPage(content) {
  return [
    `${WEST_LOCH_PREFIX} ${content}`,
    `${WEST_LOCH_PREFIX} continued text`,
    'Normal spec content line without header.',
  ].join('\n')
}

function makeMockDodDoc(pageContents) {
  return pageContents.map(makeDodPage).join('\f')
}

// NORM-1: Detect and strip the project identifier prefix
{
  console.log('NORM-1: DoD project identifier prefix detected and stripped')
  const doc = makeMockDodDoc([
    'SECTION 03 30 00 CAST-IN-PLACE CONCRETE',
    'SECTION 05 12 00 STRUCTURAL STEEL FRAMING',
    'SECTION 07 84 00 FIRESTOPPING',
    'SECTION 09 65 00 RESILIENT FLOORING',
    'SECTION 27 10 00 STRUCTURED CABLING',
  ])
  const result = normalizeDocumentText(doc)

  assert('prefix pattern detected', result.removedPatterns.some(p => p.startsWith('[PREFIX]')))
  assert('prefix stripped lines > 0', result.prefixStrippedLineCount > 0)
  assert('cleanedText does not start with FY22', !result.cleanedText.startsWith('FY22'))
  assert('section content preserved after stripping', result.cleanedText.includes('SECTION 03 30 00'))
  assert('warnings mention project identifier', result.normalizationWarnings.some(w => w.includes('Project identifier')))
  console.log()
}

// NORM-2: Pure-header lines (no content after prefix) are removed entirely
{
  console.log('NORM-2: Pure-header lines (no trailing content) are removed entirely')
  // Real-looking spec pages: each page starts with a pure header line, then header+content
  const specPages = [
    `${WEST_LOCH_PREFIX}\n${WEST_LOCH_PREFIX} SECTION 03 30 00 CAST-IN-PLACE CONCRETE\nA. Submit concrete mix design. SD-03 Product Data.\nB. Mix designs shall conform to ACI requirements.`,
    `${WEST_LOCH_PREFIX}\n${WEST_LOCH_PREFIX} SECTION 05 12 00 STRUCTURAL STEEL FRAMING\nA. Shop drawings for structural steel connections. SD-02 Shop Drawings.\nB. Mill certificates for all structural steel members.`,
    `${WEST_LOCH_PREFIX}\n${WEST_LOCH_PREFIX} SECTION 07 84 00 FIRESTOPPING\nA. Certificate of compliance for firestop systems. SD-06 Test Reports.\nB. Installation instructions from manufacturer.`,
    `${WEST_LOCH_PREFIX}\n${WEST_LOCH_PREFIX} SECTION 09 65 00 RESILIENT FLOORING\nA. Product data for resilient floor tile. SD-03 Product Data.\nB. Samples of flooring materials for approval.`,
    `${WEST_LOCH_PREFIX}\n${WEST_LOCH_PREFIX} SECTION 27 10 00 STRUCTURED CABLING\nA. System design drawings for cabling infrastructure. SD-02 Shop Drawings.\nB. Test reports for cable system performance.`,
  ]
  const doc = specPages.join('\f')
  const result = normalizeDocumentText(doc)

  assert('pure-header lines removed (removedLineCount > 0)', result.removedLineCount > 0)
  assert('prefix pattern detected', result.removedPatterns.some(p => p.startsWith('[PREFIX]')))
  assert('spec SD code content preserved', result.cleanedText.includes('SD-03') || result.cleanedText.includes('SD-02'))
  console.log()
}

// NORM-3: Repeated page headers are detected and removed
{
  console.log('NORM-3: Repeated page header detected via frequency analysis')
  const header = 'CONTRACT NO. W9128F-24-C-0042  WEST LOCH AMMUNITION STORAGE FACILITY'
  const makeSimplePage = (body) => [header, body, 'Footer line'].join('\n')
  const doc = [
    makeSimplePage('SECTION 03 30 00 CONCRETE 1.1 SUBMITTALS Product data required.'),
    makeSimplePage('SECTION 05 12 00 STRUCTURAL STEEL 1.1 SUBMITTALS Shop drawings required.'),
    makeSimplePage('SECTION 07 84 00 FIRESTOPPING 1.1 SUBMITTALS Certificate of compliance.'),
    makeSimplePage('SECTION 09 65 00 RESILIENT FLOOR 1.1 SUBMITTALS Material samples.'),
  ].join('\f')
  const result = normalizeDocumentText(doc)

  // The header appears in 4/4 pages → should be detected
  const hasHeaderPattern = result.removedPatterns.some(p => p.includes('[HEADER]'))
  assert('repeated header detected', hasHeaderPattern)
  assert('header lines removed from output', !result.cleanedText.includes(header))
  assert('spec content preserved', result.cleanedText.includes('SECTION 03 30 00'))
  console.log()
}

// NORM-4: Repeated footer detected and removed
{
  console.log('NORM-4: Repeated footer detected via frequency analysis')
  // Footer must survive normalization with ≥15 chars — use a realistic UFGS footer
  const footer = 'UFGS CONSTRUCTION SPECIFICATION GUIDE — NAVFAC STANDARD — CONTROLLED DISTRIBUTION'
  const makePageWithFooter = (body) => [body, footer].join('\n')
  const doc = [
    makePageWithFooter('SECTION 03 30 00 CONCRETE content here'),
    makePageWithFooter('SECTION 05 12 00 STRUCTURAL STEEL content'),
    makePageWithFooter('SECTION 07 84 00 FIRESTOPPING spec text'),
    makePageWithFooter('SECTION 09 65 00 RESILIENT FLOORING spec'),
  ].join('\f')
  const result = normalizeDocumentText(doc)

  const hasFooterPattern = result.removedPatterns.some(p => p.includes('[FOOTER]'))
  assert('repeated footer detected', hasFooterPattern)
  assert('spec content preserved', result.cleanedText.includes('CONCRETE content here'))
  assert('footer removed from output', !result.cleanedText.includes(footer))
  console.log()
}

// NORM-5: Clean doc with no repeated patterns passes through unchanged
{
  console.log('NORM-5: Clean document passes through with no removals')
  const cleanDoc = [
    'SECTION 03 30 00 CAST-IN-PLACE CONCRETE\n1.1 SUBMITTALS\nA. Submit mix design for approval. SD-03 Product Data.',
    'SECTION 05 12 00 STRUCTURAL STEEL FRAMING\n1.1 SUBMITTALS\nA. Shop drawings. SD-02 Shop Drawings.',
    'SECTION 07 84 00 FIRESTOPPING\n1.1 SUBMITTALS\nA. Certificate of compliance. SD-06 Test Reports.',
    'SECTION 09 65 00 RESILIENT FLOORING\n1.1 SUBMITTALS\nA. Material samples. SD-04 Samples.',
  ].join('\f')
  const result = normalizeDocumentText(cleanDoc)

  assert('no patterns removed from clean doc', result.removedPatterns.length === 0)
  assert('no lines removed from clean doc', result.removedLineCount === 0)
  assert('no lines prefix-stripped', result.prefixStrippedLineCount === 0)
  assert('text unchanged', result.cleanedText === cleanDoc)
  console.log()
}

// NORM-6: Single-page doc skips frequency detection (< MIN_PAGES)
{
  console.log('NORM-6: Single-page doc skips frequency detection gracefully')
  const singlePage = `${WEST_LOCH_PREFIX} SECTION 03 30 00 CONCRETE`
  const result = normalizeDocumentText(singlePage)
  // No crash; warnings mention short doc
  assert('no crash on single page', true)
  assert('warning about short doc', result.normalizationWarnings.some(w => w.includes('too short')))
  console.log()
}

// NORM-7: NormalizationResult shape is correct
{
  console.log('NORM-7: NormalizationResult has all required fields')
  const result = normalizeDocumentText('anything')
  assert('cleanedText is string', typeof result.cleanedText === 'string')
  assert('removedPatterns is array', Array.isArray(result.removedPatterns))
  assert('removedLineCount is number', typeof result.removedLineCount === 'number')
  assert('prefixStrippedLineCount is number', typeof result.prefixStrippedLineCount === 'number')
  assert('normalizationWarnings is array', Array.isArray(result.normalizationWarnings))
  console.log()
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)

if (failed > 0) {
  process.exit(1)
}
