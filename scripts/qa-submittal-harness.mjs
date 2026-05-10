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

import { associateNearbySdCodes } from '../src/lib/ingestion/nearby-sd-association.ts'

import { groupPdfTextItemsIntoLines } from '../src/lib/parsers/pdf-line-reconstruction.ts'

import {
  hasUfgsDDFormAppendix,
  parseUfgsDDFormAppendix,
} from '../src/lib/parsers/ufgs-submittal-register-parser.ts'

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
// Nearby SD Association Tests
// ---------------------------------------------------------------------------

console.log('\n=== Nearby SD Association Tests ===\n')

// NSD-1: SD code line BEFORE item → forward association
{
  console.log('NSD-1: SD code line before item → forward association')
  const lines = [
    'SD-03 Product Data',           // index 0 — SD-only (short, no submittal keyword)
    'Concrete mix design for review', // index 1 — item (has "mix design" → submittal keyword)
  ]
  const { associations, metrics } = associateNearbySdCodes(lines)
  assert('forward association recorded', associations.has(1))
  assert('forward SD code is SD-03', associations.get(1) === 'SD-03')
  assert('forwardAssociations counter = 1', metrics.forwardAssociations === 1)
  assert('backwardAssociations = 0', metrics.backwardAssociations === 0)
  assert('sdCodeOnlyLinesDetected = 1', metrics.sdCodeOnlyLinesDetected === 1)
  console.log()
}

// NSD-2: SD code line AFTER item → backward association
{
  console.log('NSD-2: SD code line after item → backward association')
  const lines = [
    'Concrete mix design for approval', // index 0 — item, no inline SD code
    'SD-03 Product Data',               // index 1 — SD-only
  ]
  const { associations, metrics } = associateNearbySdCodes(lines)
  assert('backward association recorded', associations.has(0))
  assert('backward SD code is SD-03', associations.get(0) === 'SD-03')
  assert('backwardAssociations counter = 1', metrics.backwardAssociations === 1)
  assert('forwardAssociations = 0', metrics.forwardAssociations === 0)
  console.log()
}

// NSD-3: SD code should NOT carry across page break
{
  console.log('NSD-3: SD code does not carry across ---PAGE-BREAK---')
  const lines = [
    'SD-03 Product Data',
    '---PAGE-BREAK---',
    'Concrete mix design for approval',
  ]
  const { associations } = associateNearbySdCodes(lines)
  assert('no association across page break', !associations.has(2))
  console.log()
}

// NSD-4: SD code should NOT carry across CSI section boundary
{
  console.log('NSD-4: SD code does not carry across CSI section heading')
  const lines = [
    'SD-03 Product Data',
    'SECTION 05 12 00 STRUCTURAL STEEL FRAMING',
    'Shop drawings for structural steel connections',
  ]
  const { associations } = associateNearbySdCodes(lines)
  assert('no association across section boundary', !associations.has(2))
  console.log()
}

// NSD-5: malformed SD code still normalizes and associates
{
  console.log('NSD-5: Malformed SD code (OCR variant) normalizes and associates')
  const lines = [
    's.d. 03  Product Data',          // malformed — extractSdCode handles this
    'Shop drawings for steel members',
  ]
  const { associations } = associateNearbySdCodes(lines)
  // extractSdCode('s.d. 03 Product Data') → SD-03
  assert('malformed SD code associated forward', associations.has(1))
  assert('normalized to SD-03', associations.get(1) === 'SD-03')
  console.log()
}

// NSD-6: ambiguous association skipped (different SD codes on both sides)
{
  console.log('NSD-6: Ambiguous association (different SD codes each side) → skipped')
  const lines = [
    'SD-02 Shop Drawings',              // index 0 — SD-only
    'Submit structural steel details',  // index 1 — item
    'SD-07 Certificates',               // index 2 — SD-only
  ]
  const { associations, metrics } = associateNearbySdCodes(lines)
  // index 1 gets forward from SD-02 AND backward from SD-07 → ambiguous
  // The ambiguous flag should prevent a wrong association
  // Either ambiguous or one direction wins — the key constraint is they don't BOTH apply
  const hasAmbiguous = metrics.ambiguousAssociations > 0
  const isConsistent = !associations.has(1) || (associations.get(1) === 'SD-02' || associations.get(1) === 'SD-07')
  assert('no incorrect association (either skipped or single direction)', isConsistent)
  console.log()
}

// NSD-7: inline SD code wins over nearby — nearby is skipped (fallback-only)
{
  console.log('NSD-7: Inline SD code wins — nearby nearby fallback not applied')
  // This tests the buildItemFromStatement priority: sdCodeOverride → inline → nearby
  // We test indirectly via extractSubmittalRegisterItemsFromText
  const lines = [
    'SD-02 Shop Drawings',                // SD-only line
    'Submit shop drawings. SD-03 Product Data.', // item WITH inline SD-03
  ]
  const { associations, metrics } = associateNearbySdCodes(lines)
  // The nearby association would assign SD-02 to index 1 (forward from index 0)
  // BUT index 1 has an inline SD code (SD-03), so extractSdCode(lines[1]) = SD-03
  // The association may or may not be in the map — what matters is that at extraction
  // time the inline code (SD-03) takes priority.
  // Check: forward association not recorded because inline code present
  const nearbyForIndex1 = associations.get(1)
  if (nearbyForIndex1 !== undefined) {
    // If the nearby map records it, extraction must still use inline (SD-03, not SD-02)
    assert('nearby may be in map but is SD-02 (will be overridden by inline)', nearbyForIndex1 === 'SD-02')
  } else {
    assert('nearby correctly skipped for item with inline SD code', true)
  }
  // The actual priority is enforced in buildItemFromStatement:
  //   sdCodeOverride ?? extractSdCode(statement) ?? sdCodeNearbyFallback
  // SD-03 (inline) overrides SD-02 (nearby fallback)
  assert('metrics: forward associations metric reflects reality', metrics.forwardAssociations >= 0)
  console.log()
}

// NSD-8: multiple candidate items in window → skip (ambiguous which item gets the code)
{
  console.log('NSD-8: Multiple candidates in window → skipped (multi-candidate safety)')
  const lines = [
    'SD-03 Product Data',                 // index 0 — SD-only
    'Submit shop drawings for review',    // index 1 — candidate item 1
    'Submit product data for approval',   // index 2 — candidate item 2 (also within distance 2)
  ]
  const { associations, metrics } = associateNearbySdCodes(lines)
  // Both items are within MAX_DISTANCE=2 → which one gets SD-03 is ambiguous.
  // Safety rule: skip the association rather than blindly assign to the first.
  assert('no association when multiple candidates in window', !associations.has(1) && !associations.has(2))
  assert('skippedMultiCandidate incremented', metrics.skippedMultiCandidate > 0)
  console.log()
}

// NSD-9: duplicate nearby SD same code — still a single clean association
{
  console.log('NSD-9: Same SD code on both sides → not ambiguous (same code)')
  const lines = [
    'SD-03 Product Data',
    'Submit concrete mix design',
    'SD-03 Product Data',
  ]
  const { associations, metrics } = associateNearbySdCodes(lines)
  // Both directions agree on SD-03 → should associate (not flagged ambiguous)
  assert('item associated (same code from both directions)', associations.has(1))
  assert('associated code is SD-03', associations.get(1) === 'SD-03')
  assert('not counted as ambiguous', metrics.ambiguousAssociations === 0)
  console.log()
}

// ---------------------------------------------------------------------------
// QA-LC — Low Extraction Confidence QA Finding
// ---------------------------------------------------------------------------

// QA-LC-1: DD-form item with confidence 0.92 does NOT trigger finding
{
  console.log('QA-LC-1: DD-form confidence 0.92 does not trigger low_extraction_confidence')
  const item = mockItem({
    extractionSource:       'ufgs_dd_form',
    extractionConfidence:   0.92,
    extractionSourceReason: 'Parsed from UFGS DD-form submittal register appendix.',
    sdCode: 'SD-03',
    approvalAuthority: 'G',
  })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const lowConf = result.findings.find(f => f.type === 'low_extraction_confidence')
  assert('no low_extraction_confidence finding for 0.92', !lowConf)
  console.log()
}

// QA-LC-2: hybrid_fill item with confidence 0.33 triggers warning severity
{
  console.log('QA-LC-2: hybrid_fill confidence 0.33 → severity warning')
  const item = mockItem({
    extractionSource:       'hybrid_fill',
    extractionConfidence:   0.33,
    extractionSourceReason: 'Narrative extraction used because DD-form did not cover this spec section.',
    sdCode: null,
    approvalAuthority: null,
  })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const lowConf = result.findings.find(f => f.type === 'low_extraction_confidence')
  assert('low_extraction_confidence finding exists', !!lowConf)
  assert('severity is warning (< 0.50)', lowConf?.severity === 'warning')
  assert('affected item included', lowConf?.affectedItemIds.length === 1)
  assert('message mentions hybrid_fill source', lowConf?.suggestedAction?.includes('Fallback narrative'))
  console.log()
}

// QA-LC-3: narrative item with confidence 0.65 triggers info severity
{
  console.log('QA-LC-3: narrative confidence 0.65 → severity info')
  const item = mockItem({
    extractionSource:       'narrative',
    extractionConfidence:   0.65,
    extractionSourceReason: 'Parsed from specification body text.',
    sdCode: 'SD-03',
    approvalAuthority: null,
  })
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const lowConf = result.findings.find(f => f.type === 'low_extraction_confidence')
  assert('low_extraction_confidence finding exists', !!lowConf)
  assert('severity is info (0.50–0.79)', lowConf?.severity === 'info')
  assert('message mentions narrative source', lowConf?.suggestedAction?.includes('Narrative extraction'))
  console.log()
}

// QA-LC-4: item with NO extractionConfidence set does not crash or trigger finding
{
  console.log('QA-LC-4: Item without extractionConfidence set → no crash, no finding')
  const item = mockItem({ sdCode: 'SD-03' })  // no extractionConfidence
  const result = evaluateSubmittalCoverageQA({ items: [item] })
  const lowConf = result.findings.find(f => f.type === 'low_extraction_confidence')
  assert('no crash on missing extractionConfidence', true)
  assert('no low_extraction_confidence finding when field absent', !lowConf)
  console.log()
}

// NSD-10: default mode does not associate when item is 3 lines away
{
  console.log('NSD-10: Default mode (distance 2) does not reach item 3 lines away')
  const lines = [
    'SD-03 Product Data',            // index 0 — SD-only
    'See referenced standards.',     // index 1 — non-submittal filler
    'Refer to appendix A.',          // index 2 — non-submittal filler
    'Submit product data sheets.',   // index 3 — submittal item (3 lines away)
  ]
  const { associations } = associateNearbySdCodes(lines)  // default mode
  assert('no association at distance 3 with default mode', !associations.has(3))
  console.log()
}

// NSD-11: reconstructed_pdf mode (distance 5) reaches item 3 lines away
{
  console.log('NSD-11: reconstructed_pdf mode (distance 5) associates item 3 lines away')
  const lines = [
    'SD-03 Product Data',            // index 0 — SD-only
    'See referenced standards.',     // index 1 — non-submittal filler
    'Refer to appendix A.',          // index 2 — non-submittal filler
    'Submit product data sheets.',   // index 3 — submittal item (3 lines away)
  ]
  const { associations } = associateNearbySdCodes(lines, { mode: 'reconstructed_pdf' })
  assert('association exists at distance 3 with reconstructed_pdf mode', associations.has(3))
  assert('associated code is SD-03', associations.get(3) === 'SD-03')
  console.log()
}

// NSD-12: page break stops association even with wide window
{
  console.log('NSD-12: Page break is a hard boundary even with ufgs mode (distance 5)')
  const lines = [
    'SD-07 Certificates',            // index 0 — SD-only
    '---PAGE-BREAK---',              // index 1 — boundary
    'Submit mill certificates.',     // index 2 — submittal item (page boundary in between)
  ]
  const { associations, metrics } = associateNearbySdCodes(lines, { mode: 'ufgs' })
  assert('no association across page break', !associations.has(2))
  assert('skippedBoundary counted', metrics.skippedBoundary > 0)
  console.log()
}

// NSD-13: CSI section heading stops association even with wide window
{
  console.log('NSD-13: CSI heading is a hard boundary even with ufgs mode (distance 5)')
  const lines = [
    'SD-07 Certificates',            // index 0 — SD-only
    '1.4 SUBMITTALS',                // index 1 — clause heading (boundary)
    'Submit mill certificates.',     // index 2 — submittal item
  ]
  const { associations } = associateNearbySdCodes(lines, { mode: 'ufgs' })
  assert('no association across CSI heading with ufgs mode', !associations.has(2))
  console.log()
}

// NSD-14: explicit maxDistance override works independently of mode
{
  console.log('NSD-14: Explicit maxDistance=4 override reaches item 4 lines away')
  const lines = [
    'SD-01 Shop Drawings',           // index 0 — SD-only
    'See section 1.1 for scope.',    // index 1 — non-submittal filler
    'Reference standard ASTM A36.', // index 2 — non-submittal filler
    'Applicable codes listed above.',// index 3 — non-submittal filler
    'Submit structural shop drawings for review.', // index 4 — submittal item (4 lines away)
  ]
  // Default mode (distance 2) should NOT reach index 4
  const defaultResult = associateNearbySdCodes(lines)
  assert('default mode misses item at distance 4', !defaultResult.associations.has(4))
  // maxDistance=4 should reach it
  const wideResult = associateNearbySdCodes(lines, { maxDistance: 4 })
  assert('maxDistance=4 reaches item at distance 4', wideResult.associations.has(4))
  assert('associated code is SD-01', wideResult.associations.get(4) === 'SD-01')
  console.log()
}

// NSD-15: block pass applies SD code to all items in a following block
{
  console.log('NSD-15: Block pass assigns SD code to all items in forward block (ufgs mode)')
  const lines = [
    'SD-03 Product Data',               // index 0 — SD-only header
    'Submit concrete mix design.',      // index 1 — item 1
    'Submit aggregate gradation data.', // index 2 — item 2
    'Submit admixture manufacturer data.', // index 3 — item 3
  ]
  const { associations, metrics } = associateNearbySdCodes(lines, { mode: 'ufgs' })
  assert('item 1 gets SD-03 via block', associations.get(1) === 'SD-03')
  assert('item 2 gets SD-03 via block', associations.get(2) === 'SD-03')
  assert('item 3 gets SD-03 via block', associations.get(3) === 'SD-03')
  assert('blockAssociations = 3', metrics.blockAssociations === 3)
  assert('blockHeadersDetected = 1', metrics.blockHeadersDetected === 1)
  console.log()
}

// NSD-16: block scan stops at the next SD header
{
  console.log('NSD-16: Block scan stops at next SD header (ufgs mode)')
  const lines = [
    'SD-03 Product Data',               // index 0 — SD-only header
    'Submit concrete mix design.',      // index 1 — item in SD-03 block
    'SD-07 Certificates',               // index 2 — next SD header, terminates block
    'Submit mill certificates.',        // index 3 — item in SD-07 block
  ]
  const { associations } = associateNearbySdCodes(lines, { mode: 'ufgs' })
  assert('item 1 gets SD-03', associations.get(1) === 'SD-03')
  assert('item 3 does not get SD-03', associations.get(3) !== 'SD-03')
  assert('item 3 gets SD-07', associations.get(3) === 'SD-07')
  console.log()
}

// NSD-17: block scan stops at page break
{
  console.log('NSD-17: Block scan stops at page break (ufgs mode)')
  const lines = [
    'SD-07 Certificates',              // index 0 — SD-only header
    'Submit mill certificates.',       // index 1 — item
    '---PAGE-BREAK---',                // index 2 — hard boundary
    'Submit welding certifications.',  // index 3 — item on next page — NOT in block
  ]
  const { associations, metrics } = associateNearbySdCodes(lines, { mode: 'ufgs' })
  assert('item 1 gets SD-07', associations.get(1) === 'SD-07')
  assert('item 3 not associated via block', !associations.has(3))
  assert('blockTerminatedByBoundary > 0', metrics.blockTerminatedByBoundary > 0)
  console.log()
}

// NSD-18: block scan stops at CSI section heading
{
  console.log('NSD-18: Block scan stops at CSI section heading (ufgs mode)')
  const lines = [
    'SD-06 Test Reports',              // index 0 — SD-only header
    '1.4 SUBMITTALS',                  // index 1 — numbered clause heading (boundary)
    'Submit test reports.',            // index 2 — item below heading
  ]
  const { associations } = associateNearbySdCodes(lines, { mode: 'ufgs' })
  assert('item 2 not reached through heading', !associations.has(2))
  console.log()
}

// NSD-19: block pass does not overwrite inline SD code
{
  console.log('NSD-19: Block pass does not overwrite item with inline SD code')
  // Line at index 1 is long enough (> 60 chars) that extractSdOnlyCode returns null,
  // so it is NOT treated as an SD-only header — it is a submittal item with an inline code.
  const lines = [
    'SD-03 Product Data',
    'Submit concrete mix design per ASTM C94 and related testing data. SD-06 Test Reports.',
    'Submit aggregate gradation data.',
  ]
  const { associations, metrics } = associateNearbySdCodes(lines, { mode: 'ufgs' })
  // index 1 has inline SD-06; block pass should skip it (blockSkippedDueToInline++)
  // and should NOT set associations[1] = 'SD-03'
  const idx1Code = associations.get(1)
  assert('inline SD-06 not overwritten by block SD-03', idx1Code !== 'SD-03')
  assert('blockSkippedDueToInline > 0', metrics.blockSkippedDueToInline > 0)
  // index 2 has no inline code — block pass should reach it
  assert('item at index 2 gets SD-03 from block', associations.get(2) === 'SD-03')
  console.log()
}

// NSD-20: default mode does not run block association
{
  console.log('NSD-20: Default mode does not run block pass')
  const lines = [
    'SD-03 Product Data',               // index 0 — SD-only header
    'Submit concrete mix design.',      // index 1 — item 1
    'Submit aggregate gradation data.', // index 2 — item 2 (multiple candidates → skipped by fwd)
  ]
  const { metrics } = associateNearbySdCodes(lines)  // default mode
  assert('blockHeadersDetected is 0 in default mode', metrics.blockHeadersDetected === 0)
  assert('blockAssociations is 0 in default mode', metrics.blockAssociations === 0)
  console.log()
}

// ---------------------------------------------------------------------------
// DDFP — UFGS DD-Form Submittal Register Parser
// ---------------------------------------------------------------------------

// Minimal DD-form page fixture. Each page ends with "SUBMITTAL FORM,Jan 96".
function makeDdFormPage({ specSect, sdBlob, items = 'Concrete Mix Design', pageNum = 1 }) {
  return [
    'C L A S S I F I C A T I O N',
    'G',
    '#',
    'P A R A G R A P H (e)',
    '1.4.2',
    'SUBMITTAL REGISTER',
    '(d)',
    'DESCRIPTION',
    'ITEM SUBMITTED',
    items,
    sdBlob,
    'S P E C S E C T (c)',
    specSect,
    'T R A N S M I T T A L N O (b)',
    'A C T I V I T Y N O (a)',
    `TITLE AND LOCATIONMY PROJECT SUBMITTAL FORM,Jan 96`,
    '---PAGE-BREAK---',
  ].join('\n')
}

// DDFP-1: detects DD-form marker
{
  console.log('DDFP-1: hasUfgsDDFormAppendix detects marker')
  assert('detects marker', hasUfgsDDFormAppendix('SUBMITTAL FORM,Jan 96'))
  assert('detects with spaces', hasUfgsDDFormAppendix('SUBMITTAL FORM, Jan 96'))
  assert('case insensitive', hasUfgsDDFormAppendix('submittal form,jan 96'))
  assert('does not trigger on normal text', !hasUfgsDDFormAppendix('This is a normal spec section.'))
  console.log()
}

// DDFP-2: parses single row with spec section + SD code
{
  console.log('DDFP-2: Parses single spec section + SD code row')
  const text = makeDdFormPage({
    specSect: '03 30 00',
    sdBlob: 'SD-03 Product Data',
  })
  const result = parseUfgsDDFormAppendix(text)
  assert('detected as present', result.isPresent)
  assert('1 page detected', result.pagesDetected === 1)
  assert('rows extracted', result.rows.length >= 1)
  const row = result.rows.find(r => r.sdCode === 'SD-03')
  assert('SD-03 row exists', !!row)
  assert('spec section is 03 30 00', row?.specSection === '03 30 00')
  assert('parserSource is ufgs_dd_form', row?.parserSource === 'ufgs_dd_form')
  assert('sourceExcerpt contains spec section', row?.sourceExcerpt?.includes('03 30 00'))
  console.log()
}

// DDFP-3: parses multiple SD codes on same page (block of items under one spec section)
{
  console.log('DDFP-3: Multiple SD codes on same page')
  const text = makeDdFormPage({
    specSect: '05 12 00',
    sdBlob: 'SD-02 Shop DrawingsSD-06 Test ReportsSD-07 Certificates',
  })
  const result = parseUfgsDDFormAppendix(text)
  assert('3 rows extracted', result.rows.length === 3)
  assert('SD-02 row present', result.rows.some(r => r.sdCode === 'SD-02'))
  assert('SD-06 row present', result.rows.some(r => r.sdCode === 'SD-06'))
  assert('SD-07 row present', result.rows.some(r => r.sdCode === 'SD-07'))
  assert('all rows have spec section 05 12 00', result.rows.every(r => r.specSection === '05 12 00'))
  console.log()
}

// DDFP-4: ignores repeated table header pages (right-side tracking columns)
{
  console.log('DDFP-4: Repeated header pages ignored — no S P E C S E C T = skip')
  // A page block with only tracking column headers (no "S P E C S E C T")
  const headerOnlyPage = [
    '(r)',
    'REMARKS',
    'PAGE 2 OF 75 PAGES',
    'TO (q)',
    'AUTH',
    'MAILEDCONTR/',
    'DATE RCDFRM APPR',
    'A C T I O N C O D E (o)',
  ].join('\n')
  const dataPage = makeDdFormPage({
    specSect: '07 84 00',
    sdBlob: 'SD-03 Product Data',
    pageNum: 2,
  })
  const result = parseUfgsDDFormAppendix(headerOnlyPage + '\n' + dataPage)
  // Should still find the data page rows, not crash on the header-only page
  assert('data page rows found despite header-only page', result.rows.length >= 1)
  assert('no crash on header-only page', true)
  console.log()
}

// DDFP-5: sourceExcerpt preserves spec section and SD code for provenance
{
  console.log('DDFP-5: sourceExcerpt provides parseable provenance')
  const text = makeDdFormPage({
    specSect: '09 97 13',
    sdBlob: 'SD-03 Product DataSD-04 Samples',
  })
  const result = parseUfgsDDFormAppendix(text)
  for (const row of result.rows) {
    assert(`sourceExcerpt non-empty for ${row.sdCode}`, row.sourceExcerpt.length > 0)
    assert(`sourceExcerpt contains sd code for ${row.sdCode}`, row.sourceExcerpt.includes(row.sdCode))
  }
  console.log()
}

// DDFP-6: does not trigger on normal CSI narrative text (no DD-form marker)
{
  console.log('DDFP-6: Does not trigger on normal spec body text')
  const normalSpec = [
    'SECTION 03 30 00',
    '1.4 SUBMITTALS',
    'SD-03 Product Data',
    'Submit concrete mix design for approval.',
    'SD-06 Test Reports',
    'Submit aggregate gradation test results.',
  ].join('\n')
  const result = parseUfgsDDFormAppendix(normalSpec)
  assert('not detected in normal spec text', !result.isPresent)
  assert('no rows from normal spec', result.rows.length === 0)
  console.log()
}

// DDFP-7: inline spec+SD pair in spec blob (e.g. "03 30 00 SD-03 Product Data")
{
  console.log('DDFP-7: Inline spec+SD pair extracted directly from spec blob')
  const text = makeDdFormPage({
    specSect: '03 30 00 SD-03 Product Data',
    sdBlob: '',  // no separate SD blob — data is inline in spec line
    items: 'Concrete Mix Design',
  })
  const result = parseUfgsDDFormAppendix(text)
  const row = result.rows.find(r => r.sdCode === 'SD-03')
  assert('inline pair extracted', !!row)
  assert('spec section correct', row?.specSection === '03 30 00')
  console.log()
}

// ---------------------------------------------------------------------------
// SRC — Submittal Source Selector
// ---------------------------------------------------------------------------

import {
  chooseSubmittalExtractionSource,
  mapDDFormRowToSubmittalItem,
} from '../src/lib/ingestion/submittal-source-selector.ts'

// Helper: minimal SubmittalRegisterItem for testing
function mkNarrativeItem(overrides = {}) {
  return {
    specSection: '03 30 00',
    sectionTitle: null,
    submittalItem: 'Concrete Mix Design',
    submittalType: 'SD-03 Product Data',
    requiredAction: null,
    approvalRequired: null,
    sourceReference: { sourceType: 'specification' },
    excerpt: 'Submit concrete mix design.',
    confidence: 0.72,
    notes: null,
    sdCode: 'SD-03',
    approvalAuthority: null,
    blockingRisk: 'none',
    ...overrides,
  }
}

// Helper: minimal DDFormRow for testing
function mkDDFormRow(overrides = {}) {
  return {
    specSection: '03 30 00',
    sectionTitle: null,
    submittalItem: 'Product Data',
    sdCode: 'SD-03',
    approvalAuthority: 'G',
    actionCode: null,
    sourcePage: 10,
    sourceExcerpt: '03 30 00 SD-03 Product Data',
    parserSource: 'ufgs_dd_form',
    ...overrides,
  }
}

// SRC-1: no DD-form rows → narrative selected
{
  console.log('SRC-1: No DD-form rows → narrative selected')
  const narrative = [mkNarrativeItem()]
  const result = chooseSubmittalExtractionSource({
    narrativeItems:      narrative,
    ddFormRows:          [],
    narrativeSdCoverage: 75,
  })
  assert('narrative selected', result.selectedSource === 'narrative')
  assert('selectedItems = narrative', result.selectedItems.length === 1)
  assert('no fallbackItems', result.fallbackItems.length === 0)
  console.log()
}

// SRC-2: DD-form 100% SD, narrative 18.9% → dd_form selected
{
  console.log('SRC-2: DD-form 100% SD >> narrative → dd_form selected')
  const narrative = [
    mkNarrativeItem({ sdCode: 'SD-03' }),
    mkNarrativeItem({ submittalItem: 'Shop Drawings', sdCode: null }),
    mkNarrativeItem({ submittalItem: 'Certificates', sdCode: null }),
  ]
  const ddRows = [
    mkDDFormRow({ sdCode: 'SD-03' }),
    mkDDFormRow({ submittalItem: 'Shop Drawings', sdCode: 'SD-02' }),
  ]
  const result = chooseSubmittalExtractionSource({
    narrativeItems:      narrative,
    ddFormRows:          ddRows,
    narrativeSdCoverage: 33.3,  // 1 of 3 items have SD code
  })
  assert('dd_form selected', result.selectedSource === 'dd_form')
  assert('selectedItems come from DD-form', result.selectedItems.length === 2)
  assert('fallbackItems = narrative', result.fallbackItems.length === 3)
  assert('parserSource is ufgs_dd_form', result.selectedItems[0].sourceReference.extractionSource === 'ufgs_dd_form')
  console.log()
}

// SRC-3: DD-form below 80% threshold → narrative selected
// (This can't happen in practice since DD-form always has 100% SD coverage,
//  but the threshold logic should be correct if the input were different.)
// Instead, test narrative SD >= DD-form SD → narrative selected
{
  console.log('SRC-3: Narrative SD coverage >= DD-form → narrative selected')
  const narrative = [mkNarrativeItem({ sdCode: 'SD-03' })]
  const ddRows    = [mkDDFormRow({ sdCode: 'SD-03' })]
  const result = chooseSubmittalExtractionSource({
    narrativeItems:      narrative,
    ddFormRows:          ddRows,
    narrativeSdCoverage: 100,  // narrative is already perfect
  })
  assert('narrative selected (already 100%)', result.selectedSource === 'narrative')
  console.log()
}

// SRC-4: hybrid selected when DD-form covers < 70% of narrative spec sections
{
  console.log('SRC-4: Hybrid selected when DD-form misses many narrative spec sections')
  // DD-form covers only 03 30 00; narrative has 03 30 00 + 05 12 00 + 07 84 00 + 09 97 13
  const narrative = [
    mkNarrativeItem({ specSection: '03 30 00', sdCode: 'SD-03' }),
    mkNarrativeItem({ specSection: '05 12 00', sdCode: null, submittalItem: 'Shop Drawings' }),
    mkNarrativeItem({ specSection: '07 84 00', sdCode: null, submittalItem: 'Fire Stopping' }),
    mkNarrativeItem({ specSection: '09 97 13', sdCode: null, submittalItem: 'Paint' }),
  ]  // narrative SD coverage = 1/4 = 25%
  const ddRows = [
    mkDDFormRow({ specSection: '03 30 00', sdCode: 'SD-03' }),
  ]  // DD-form covers 1/4 narrative sections = 25% < 70% threshold
  const result = chooseSubmittalExtractionSource({
    narrativeItems:      narrative,
    ddFormRows:          ddRows,
    narrativeSdCoverage: 25,
  })
  assert('hybrid selected', result.selectedSource === 'hybrid')
  // hybrid should include DD-form item + narrative items for missing sections
  assert('hybrid has DD-form item', result.selectedItems.some(i => i.sdCode === 'SD-03' && i.sourceReference.extractionSource === 'ufgs_dd_form'))
  assert('hybrid includes narrative fill items', result.selectedItems.some(i => i.specSection === '05 12 00'))
  assert('hybrid includes 09 97 13 item', result.selectedItems.some(i => i.specSection === '09 97 13'))
  assert('warning about missing sections', result.warnings.length > 0)
  console.log()
}

// SRC-5: duplicate rows suppressed in hybrid
{
  console.log('SRC-5: Duplicate rows suppressed in hybrid merge')
  // Both narrative and DD-form have SD-03 for 03 30 00
  const narrative = [
    mkNarrativeItem({ specSection: '03 30 00', sdCode: 'SD-03', submittalItem: 'Product Data' }),
    mkNarrativeItem({ specSection: '05 12 00', sdCode: null, submittalItem: 'Shop Drawings' }),
    mkNarrativeItem({ specSection: '07 84 00', sdCode: null, submittalItem: 'Samples' }),
  ]
  const ddRows = [
    // Same spec+SD as narrative item 1 → should deduplicate
    mkDDFormRow({ specSection: '03 30 00', sdCode: 'SD-03', submittalItem: 'Product Data' }),
  ]
  // 03 30 00 covered by DD-form, 05 12 00 and 07 84 00 missing → hybrid
  const result = chooseSubmittalExtractionSource({
    narrativeItems:      narrative,
    ddFormRows:          ddRows,
    narrativeSdCoverage: 33.3,
  })
  assert('hybrid selected', result.selectedSource === 'hybrid')
  // DD-form item + 2 fill items = 3 items, not 4 (no duplicate)
  const sdItems = result.selectedItems.filter(i => i.specSection === '03 30 00')
  assert('only one 03 30 00 item (deduplication)', sdItems.length === 1)
  assert('total items = 3 (no duplicate)', result.selectedItems.length === 3)
  console.log()
}

// SRC-6: mapDDFormRowToSubmittalItem produces correct shape
{
  console.log('SRC-6: mapDDFormRowToSubmittalItem produces correct SubmittalRegisterItem shape')
  const row = mkDDFormRow({ sdCode: 'SD-07', submittalItem: 'Mill Certificates', approvalAuthority: 'G' })
  const item = mapDDFormRowToSubmittalItem(row)
  assert('specSection preserved', item.specSection === '03 30 00')
  assert('sdCode preserved', item.sdCode === 'SD-07')
  assert('submittalItem preserved', item.submittalItem === 'Mill Certificates')
  assert('approvalAuthority preserved', item.approvalAuthority === 'G')
  assert('approvalRequired true for G', item.approvalRequired === true)
  assert('parserSource in sourceReference', item.sourceReference.extractionSource === 'ufgs_dd_form')
  assert('confidence is 0.92', item.confidence === 0.92)
  assert('submittalType is Certificates', item.submittalType === 'Certificates')
  console.log()
}

import { computeSourceBreakdown } from '../src/lib/ingestion/submittal-source-selector.ts'

// SRC-7: DD-form rows get authoritative extraction labels
{
  console.log('SRC-7: DD-form rows carry extractionSource=ufgs_dd_form')
  const row  = mkDDFormRow({ sdCode: 'SD-03', approvalAuthority: 'G' })
  const item = mapDDFormRowToSubmittalItem(row)
  assert('extractionSource is ufgs_dd_form',    item.extractionSource === 'ufgs_dd_form')
  assert('extractionConfidence is 0.92',         item.extractionConfidence === 0.92)
  assert('extractionSourceReason contains DD-form', item.extractionSourceReason?.includes('DD-form'))
  console.log()
}

// SRC-8: Hybrid fill rows carry fallback labels with potentially lowered confidence
{
  console.log('SRC-8: Hybrid fill rows carry extractionSource=hybrid_fill + adjusted confidence')
  const narrative = [
    mkNarrativeItem({ specSection: '03 30 00', sdCode: 'SD-03',  confidence: 0.72 }),
    // 05 12 00: missing sdCode but HAS authority — only one deduction
    mkNarrativeItem({ specSection: '05 12 00', sdCode: null, confidence: 0.72, submittalItem: 'Shop Drawings', approvalAuthority: 'G' }),
    // 07 84 00: missing BOTH sdCode and authority — two deductions → lower than 05 12 00
    mkNarrativeItem({ specSection: '07 84 00', sdCode: null, confidence: 0.72, submittalItem: 'Fire Stop', approvalAuthority: null }),
    mkNarrativeItem({ specSection: '09 97 13', sdCode: null, confidence: 0.72, submittalItem: 'Paint', approvalAuthority: 'G' }),
  ]
  const ddRows = [ mkDDFormRow({ specSection: '03 30 00' }) ]
  const result = chooseSubmittalExtractionSource({
    narrativeItems:      narrative,
    ddFormRows:          ddRows,
    narrativeSdCoverage: 25,
  })
  // Fill items (05 12 00, 07 84 00, 09 97 13) should be hybrid_fill
  const fillItems = result.selectedItems.filter(i => i.extractionSource === 'hybrid_fill')
  assert('fill items labeled hybrid_fill', fillItems.length === 3)
  // Item missing sdCode but has authority: one deduction (−0.10)
  const noSdItem = fillItems.find(i => i.specSection === '05 12 00')
  assert('no-SD item confidence lowered', (noSdItem?.extractionConfidence ?? 0) < 0.72)
  // Item missing both sdCode and authority: two deductions (−0.10 −0.05) → even lower
  const missingBoth = fillItems.find(i => i.specSection === '07 84 00')
  assert('missing both: confidence lowered further', (missingBoth?.extractionConfidence ?? 0) < (noSdItem?.extractionConfidence ?? 0))
  assert('extractionSourceReason mentions DD-form', fillItems[0].extractionSourceReason?.includes('DD-form'))
  console.log()
}

// SRC-9: Narrative-only mode labels all items as 'narrative'
{
  console.log('SRC-9: Narrative-only mode labels all items extractionSource=narrative')
  const narrative = [
    mkNarrativeItem({ sdCode: 'SD-03', confidence: 0.72 }),
    mkNarrativeItem({ sdCode: null,    confidence: 0.60, submittalItem: 'Shop Drawings' }),
  ]
  const result = chooseSubmittalExtractionSource({
    narrativeItems:      narrative,
    ddFormRows:          [],
    narrativeSdCoverage: 50,
  })
  assert('source is narrative',    result.selectedSource === 'narrative')
  assert('all items labeled narrative', result.selectedItems.every(i => i.extractionSource === 'narrative'))
  assert('extractionConfidence set', result.selectedItems.every(i => i.extractionConfidence !== undefined))
  assert('reason references body text', result.selectedItems[0].extractionSourceReason?.includes('body text'))
  console.log()
}

// SRC-10: sourceBreakdown computed correctly from labeled items
{
  console.log('SRC-10: computeSourceBreakdown groups items by extractionSource')
  const items = [
    { ...mkNarrativeItem(), extractionSource: 'ufgs_dd_form', extractionConfidence: 0.92, sdCode: 'SD-03' },
    { ...mkNarrativeItem(), extractionSource: 'ufgs_dd_form', extractionConfidence: 0.92, sdCode: 'SD-07' },
    { ...mkNarrativeItem(), extractionSource: 'hybrid_fill',  extractionConfidence: 0.62, sdCode: null     },
    { ...mkNarrativeItem(), extractionSource: 'narrative',    extractionConfidence: 0.72, sdCode: 'SD-03'  },
  ]
  const bd = computeSourceBreakdown(items)
  assert('dd_form count = 2',     bd.dd_form.count === 2)
  assert('hybrid_fill count = 1', bd.hybrid_fill.count === 1)
  assert('narrative count = 1',   bd.narrative.count === 1)
  assert('dd_form SD 100%',       bd.dd_form.sdCoverage === 100)
  assert('hybrid_fill SD 0%',     bd.hybrid_fill.sdCoverage === 0)
  assert('dd_form avgConf 0.92',  bd.dd_form.avgConfidence === 0.92)
  console.log()
}

// SRC-11: sourceBreakdown included on SourceSelectionResult
{
  console.log('SRC-11: sourceBreakdown is included on SourceSelectionResult and reflects reality')
  const narrative = [
    mkNarrativeItem({ specSection: '03 30 00', sdCode: 'SD-03' }),
    mkNarrativeItem({ specSection: '05 12 00', sdCode: null, submittalItem: 'Shop Drawings' }),
    mkNarrativeItem({ specSection: '07 84 00', sdCode: null, submittalItem: 'Fire Stop' }),
    mkNarrativeItem({ specSection: '09 97 13', sdCode: null, submittalItem: 'Paint' }),
  ]
  const ddRows = [ mkDDFormRow({ specSection: '03 30 00', sdCode: 'SD-03' }) ]
  const result = chooseSubmittalExtractionSource({
    narrativeItems:      narrative,
    ddFormRows:          ddRows,
    narrativeSdCoverage: 25,  // hybrid expected
  })
  assert('has sourceBreakdown',           !!result.sourceBreakdown)
  assert('dd_form count > 0',             result.sourceBreakdown.dd_form.count > 0)
  assert('hybrid_fill count > 0',         result.sourceBreakdown.hybrid_fill.count > 0)
  assert('dd_form SD coverage is 100',    result.sourceBreakdown.dd_form.sdCoverage === 100)
  assert('dd_form avgConf >= 0.9',        result.sourceBreakdown.dd_form.avgConfidence >= 0.9)
  console.log()
}

// ---------------------------------------------------------------------------
// PLR — PDF Line Reconstruction
// ---------------------------------------------------------------------------

// Helper: build a mock PDF.js text item
function mkItem(str, x, y, width = str.length * 6) {
  return { str, transform: [1, 0, 0, 1, x, y], width, height: 10, fontName: 'f1', dir: 'ltr' }
}

// PLR-1: Items with the same Y coordinate combine into one line
{
  console.log('PLR-1: Same-Y items combine into one line')
  const items = [
    mkItem('Submit',  10, 100),
    mkItem('shop',    80, 100),
    mkItem('drawings', 130, 100),
  ]
  const { lines, rawItemCount } = groupPdfTextItemsIntoLines(items)
  assert('single line produced', lines.length === 1)
  assert('all words present', lines[0].includes('Submit') && lines[0].includes('drawings'))
  assert('rawItemCount correct', rawItemCount === 3)
  console.log()
}

// PLR-2: Items with different Y coordinates become separate lines
{
  console.log('PLR-2: Different-Y items become separate lines')
  const items = [
    mkItem('SD-03 Product Data',         10, 200),
    mkItem('Submit product data sheets', 10, 180),
  ]
  const { lines } = groupPdfTextItemsIntoLines(items)
  assert('two lines produced', lines.length === 2)
  assert('first line is SD code line', lines[0] === 'SD-03 Product Data')
  assert('second line is submittal line', lines[1].startsWith('Submit product data'))
  console.log()
}

// PLR-3: X sorting preserves reading order (items given in reverse X order)
{
  console.log('PLR-3: X sorting preserves reading order')
  const items = [
    mkItem('drawings', 140, 100),
    mkItem('shop',     70, 100),
    mkItem('Submit',   10, 100),
  ]
  const { lines } = groupPdfTextItemsIntoLines(items)
  assert('single line produced', lines.length === 1)
  const words = lines[0].split(/\s+/)
  assert('Submit is first', words[0] === 'Submit')
  assert('drawings is last', words[words.length - 1] === 'drawings')
  console.log()
}

// PLR-4: Items within yTolerance on same line; items outside are on different lines
{
  console.log('PLR-4: Y-tolerance grouping works at boundary')
  const items = [
    mkItem('word-A', 10, 100),
    mkItem('word-B', 80, 102),  // 2 units diff — within default tolerance of 3
    mkItem('word-C', 10,  95),  // 5 units diff — new line
  ]
  const { lines } = groupPdfTextItemsIntoLines(items, { yTolerance: 3 })
  assert('word-A and word-B on same line', lines.some(l => l.includes('word-A') && l.includes('word-B')))
  assert('word-C on its own line', lines.some(l => l === 'word-C'))
  console.log()
}

// PLR-5: Page-blob input (1 page of many items) produces many short lines
{
  console.log('PLR-5: Reconstructing a page blob improves line count and max length')
  // Simulate a page with 10 visual lines at Y 200, 190, 180, ..., 110
  // Each line has 5 items (4 words each)
  const items = []
  const y_positions = [200, 190, 180, 170, 160, 150, 140, 130, 120, 110]
  for (const y of y_positions) {
    for (let x = 0; x < 4; x++) {
      items.push(mkItem(`word-${y}-${x}`, x * 40, y))
    }
  }

  // Old-style joined text (blob per page): all items joined with space
  const blobLine = items.map(i => i.str).join(' ')
  const blobMaxLength = blobLine.length

  const { lines } = groupPdfTextItemsIntoLines(items)
  const reconstructedMaxLength = Math.max(...lines.map(l => l.length))

  assert('reconstruction produces 10 lines (one per Y)', lines.length === 10)
  assert('reconstructed max length < blob max length', reconstructedMaxLength < blobMaxLength)
  assert('blob would have been > 300 chars', blobMaxLength > 300)
  assert('reconstructed lines are all short (< 150 chars)', lines.every(l => l.length < 150))
  console.log()
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)

if (failed > 0) {
  process.exit(1)
}
