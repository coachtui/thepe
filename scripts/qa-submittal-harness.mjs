#!/usr/bin/env node

import {
  evaluateSubmittalCoverageQA,
  getSubmittalItemKey,
} from '../src/lib/chat/submittal-coverage-qa.ts'

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
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)

if (failed > 0) {
  process.exit(1)
}
