#!/usr/bin/env node

// Pure-module harness for Phase 8A FOW graph logic.

import {
  computeFowReadiness,
  rankFowByReadiness,
  groupSubmittalsByFowSpecSections,
  normalizeFowName,
  normalizeSpecSectionForFow,
  getCsiDivision,
  csiDivisionName,
  suggestFowsFromSubmittals,
} from '../src/lib/graph/fow-readiness.ts'

let passed = 0
let failed = 0

function assert(label, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(name) {
  console.log(`\n── ${name} ──`)
}

function fow(id, displayName, specSections = [], opts = {}) {
  return {
    id,
    projectId: 'proj-1',
    canonicalName: normalizeFowName(displayName),
    displayName,
    discipline: opts.discipline ?? 'general',
    status: opts.status ?? 'active',
    sequence: opts.sequence ?? 0,
    specSections,
    trade: opts.trade ?? null,
    subcontractor: opts.subcontractor ?? null,
  }
}

function submittal(id, status, specSection = null) {
  return {
    submittalItem: `Item ${id}`,
    persistedItemId: id,
    lifecycleStatus: status,
    specSection,
  }
}

// ---------------------------------------------------------------------------
section('FOW-1: normalizeFowName')

assert('FOW-1a: trims', normalizeFowName('  Slab on Grade  ') === 'slab on grade')
assert('FOW-1b: collapses whitespace', normalizeFowName('Slab   on   Grade') === 'slab on grade')
assert('FOW-1c: lowercases', normalizeFowName('SLAB ON GRADE') === 'slab on grade')

// ---------------------------------------------------------------------------
section('FOW-2: spec section + CSI normalization')

assert('FOW-2a: pads short sections', normalizeSpecSectionForFow('3 30 00') === '033000')
assert('FOW-2b: strips sub-section', normalizeSpecSectionForFow('03 30 00.01') === '033000')
assert('FOW-2c: handles dashes', normalizeSpecSectionForFow('03-30-00') === '033000')
assert('FOW-2d: getCsiDivision', getCsiDivision('03 30 00') === '03')
assert('FOW-2e: getCsiDivision handles padding', getCsiDivision('3 30 00') === '03')
assert('FOW-2f: csiDivisionName known', csiDivisionName('03').name === 'Concrete')
assert('FOW-2g: csiDivisionName unknown', csiDivisionName('99').name === 'Division 99')

// ---------------------------------------------------------------------------
section('FOW-3: computeFowReadiness')

const fowConcrete = fow('fow-concrete', 'Concrete', ['03 30 00'])

const allApproved = [
  submittal('a1', 'approved'),
  submittal('a2', 'approved_as_noted'),
  submittal('a3', 'closed'),
]
const r1 = computeFowReadiness(fowConcrete, allApproved)
assert('FOW-3a: 100% all approved', r1.readinessPercent === 100)
assert('FOW-3b: no blockers when all approved', r1.blockers.length === 0)

const mixed = [
  submittal('m1', 'approved'),
  submittal('m2', 'submitted'),
  submittal('m3', 'pending_review'),
  submittal('m4', 'revise_resubmit'),
  submittal('m5', 'rejected'),
]
const r2 = computeFowReadiness(fowConcrete, mixed)
assert('FOW-3c: mixed = 20%', r2.readinessPercent === 20)
assert('FOW-3d: 2 blocked', r2.blockedCount === 2)
assert('FOW-3e: 2 pending', r2.pendingCount === 2)
assert('FOW-3f: all non-approved listed as blockers', r2.blockers.length === 4)

const r3 = computeFowReadiness(fowConcrete, [])
assert('FOW-3g: empty list = 100% vacuous', r3.readinessPercent === 100)

// ---------------------------------------------------------------------------
section('FOW-4: rankFowByReadiness')

const readinesses = [
  computeFowReadiness(fow('a', 'A', ['03 30 00']), [submittal('1', 'approved')]),
  computeFowReadiness(fow('b', 'B', ['26 05 00']), [submittal('2', 'rejected'), submittal('3', 'rejected')]),
  computeFowReadiness(fow('c', 'C', ['23 00 00']), [submittal('4', 'rejected'), submittal('5', 'rejected'), submittal('6', 'rejected')]),
]
const ranked = rankFowByReadiness(readinesses)
assert('FOW-4a: worst first (most blockers tiebreak)', ranked[0].fow.id === 'c')
assert('FOW-4b: 100% sorted last', ranked[2].fow.id === 'a')
assert('FOW-4c: rank does not mutate', readinesses[0].fow.id === 'a')

// ---------------------------------------------------------------------------
section('FOW-5: groupSubmittalsByFowSpecSections')

const fows = [
  fow('fConc', 'Concrete', ['03 30 00', '03 11 00']),
  fow('fHvac', 'HVAC', ['23 00 00']),
  fow('fElec', 'Electrical', ['26 05 00']),
]
const subs = [
  submittal('s1', 'approved', '03 30 00'),       // → Concrete
  submittal('s2', 'submitted', '03 11 00'),      // → Concrete
  submittal('s3', 'pending_review', '23 00 00'), // → HVAC
  submittal('s4', 'approved', '99 99 99'),       // → no FOW
  submittal('s5', 'approved', null),             // → no spec section
]
const grouped = groupSubmittalsByFowSpecSections(fows, subs)

assert('FOW-5a: Concrete picks up 2', grouped.get('fConc')?.length === 2)
assert('FOW-5b: HVAC picks up 1', grouped.get('fHvac')?.length === 1)
assert('FOW-5c: Electrical picks up 0', grouped.get('fElec')?.length === 0)
assert('FOW-5d: unmatched spec section ignored',
  grouped.get('fConc').concat(grouped.get('fHvac'), grouped.get('fElec')).length === 3)

// Overlap test — submittal can belong to multiple FOWs
const overlap = [
  fow('fAll', 'All Concrete', ['03 30 00']),
  fow('fSlab', 'Slab on Grade — Bldg 2', ['03 30 00']),
]
const overlapSubs = [submittal('s1', 'approved', '03 30 00')]
const overlapGrouped = groupSubmittalsByFowSpecSections(overlap, overlapSubs)
assert('FOW-5e: submittal in multiple FOWs',
  overlapGrouped.get('fAll').length === 1 && overlapGrouped.get('fSlab').length === 1)

// Normalization match — "3 30 00" should match FOW's "03 30 00"
const normFow = [fow('fN', 'N', ['03 30 00'])]
const normSubs = [submittal('s1', 'approved', '3 30 00')]
const normGrouped = groupSubmittalsByFowSpecSections(normFow, normSubs)
assert('FOW-5f: spec normalization matches across formats',
  normGrouped.get('fN').length === 1)

// ---------------------------------------------------------------------------
section('FOW-6: suggestFowsFromSubmittals')

const projSubs = [
  submittal('s1', 'approved', '03 30 00'),
  submittal('s2', 'submitted', '03 11 00'),
  submittal('s3', 'pending_review', '23 00 00'),
  submittal('s4', 'draft', '26 05 00'),
  submittal('s5', 'draft', '26 05 13'),
  submittal('s6', 'draft', null),
]
const suggestions = suggestFowsFromSubmittals(projSubs)
assert('FOW-6a: produces one suggestion per division (3 divs)', suggestions.length === 3)

const concrete = suggestions.find(s => s.division === '03')
assert('FOW-6b: concrete has 2 spec sections', concrete?.specSections.length === 2)
assert('FOW-6c: concrete name is "Concrete"', concrete?.name === 'Concrete')
assert('FOW-6d: concrete trade is "Concrete"', concrete?.trade === 'Concrete')

const electrical = suggestions.find(s => s.division === '26')
assert('FOW-6e: electrical has 2 spec sections', electrical?.specSections.length === 2)
assert('FOW-6f: electrical name is "Electrical"', electrical?.name === 'Electrical')

assert('FOW-6g: sorted by division', suggestions[0].division === '03' && suggestions[2].division === '26')

const empty = suggestFowsFromSubmittals([submittal('s1', 'draft', null)])
assert('FOW-6h: empty when no spec sections', empty.length === 0)

// ---------------------------------------------------------------------------
console.log('\n──────────────────────────────────────────────────')
console.log(`fow-graph:harness: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
