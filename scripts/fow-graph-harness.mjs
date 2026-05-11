#!/usr/bin/env node

// Pure-module harness for Phase 8A FOW graph logic.

import {
  computeFowReadiness,
  rankFowByReadiness,
  groupSubmittalsByFowEntity,
  normalizeFowName,
  extractUniqueFowsFromSubmittals,
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

function fow(id, displayName, opts = {}) {
  return {
    id,
    projectId: 'proj-1',
    canonicalName: normalizeFowName(displayName),
    displayName,
    discipline: opts.discipline ?? 'general',
    status: opts.status ?? 'planned',
  }
}

function submittal(id, status, opts = {}) {
  return {
    submittalItem: `Item ${id}`,
    persistedItemId: id,
    lifecycleStatus: status,
    relatedFOW: opts.relatedFOW ?? null,
    fowEntityId: opts.fowEntityId ?? null,
  }
}

// ---------------------------------------------------------------------------
section('FOW-1: normalizeFowName')

assert('FOW-1a: trims whitespace', normalizeFowName('  Slab on Grade  ') === 'slab on grade')
assert('FOW-1b: collapses internal whitespace', normalizeFowName('Slab   on   Grade') === 'slab on grade')
assert('FOW-1c: lowercases', normalizeFowName('SLAB ON GRADE') === 'slab on grade')
assert('FOW-1d: handles tabs and newlines', normalizeFowName('Slab\ton\nGrade') === 'slab on grade')
assert('FOW-1e: empty string stays empty', normalizeFowName('') === '')

// ---------------------------------------------------------------------------
section('FOW-2: extractUniqueFowsFromSubmittals')

const subs1 = [
  submittal('s1', 'approved', { relatedFOW: 'Slab on Grade' }),
  submittal('s2', 'submitted', { relatedFOW: 'SLAB ON GRADE' }),
  submittal('s3', 'draft', { relatedFOW: '  Slab on   Grade  ' }),
  submittal('s4', 'approved', { relatedFOW: 'Concrete Walls' }),
  submittal('s5', 'pending_review', { relatedFOW: null }),
  submittal('s6', 'draft', { relatedFOW: '' }),
]
const fows1 = extractUniqueFowsFromSubmittals(subs1)

assert('FOW-2a: dedupes 3 SOG variants into one entity', fows1.filter(f => f.canonicalName === 'slab on grade').length === 1)
assert('FOW-2b: produces 2 unique FOWs total', fows1.length === 2)

const sog = fows1.find(f => f.canonicalName === 'slab on grade')
assert('FOW-2c: SOG has 3 submittal IDs', sog?.submittalIds.length === 3)
assert('FOW-2d: SOG preserves first display name', sog?.displayName === 'Slab on Grade')

const cw = fows1.find(f => f.canonicalName === 'concrete walls')
assert('FOW-2e: Concrete Walls has 1 submittal', cw?.submittalIds.length === 1)

assert('FOW-2f: ignores submittals without persistedItemId',
  extractUniqueFowsFromSubmittals([{ submittalItem: 'x', relatedFOW: 'FOW X' }]).length === 0)

// ---------------------------------------------------------------------------
section('FOW-3: computeFowReadiness')

const fowSOG = fow('fow-sog', 'Slab on Grade')

const allApproved = [
  submittal('a1', 'approved'),
  submittal('a2', 'approved_as_noted'),
  submittal('a3', 'closed'),
]
const r1 = computeFowReadiness(fowSOG, allApproved)
assert('FOW-3a: 100% when all approved variants', r1.readinessPercent === 100)
assert('FOW-3b: approved count counts all 3', r1.approvedCount === 3)
assert('FOW-3c: pending count is 0', r1.pendingCount === 0)
assert('FOW-3d: blocked count is 0', r1.blockedCount === 0)
assert('FOW-3e: no blockers when all approved', r1.blockers.length === 0)

const mixed = [
  submittal('m1', 'approved'),
  submittal('m2', 'submitted'),
  submittal('m3', 'pending_review'),
  submittal('m4', 'revise_resubmit'),
  submittal('m5', 'rejected'),
]
const r2 = computeFowReadiness(fowSOG, mixed)
assert('FOW-3f: mixed readiness is 20% (1/5)', r2.readinessPercent === 20)
assert('FOW-3g: mixed approved count is 1', r2.approvedCount === 1)
assert('FOW-3h: mixed pending count is 2', r2.pendingCount === 2)
assert('FOW-3i: mixed blocked count is 2', r2.blockedCount === 2)
assert('FOW-3j: blockers include 2 blocked + 2 pending = 4', r2.blockers.length === 4)

const r3 = computeFowReadiness(fowSOG, [])
assert('FOW-3k: empty submittal list = 100% (vacuous)', r3.readinessPercent === 100)
assert('FOW-3l: empty list total is 0', r3.totalCount === 0)

const r4 = computeFowReadiness(fowSOG, [submittal('d1', undefined)])
assert('FOW-3m: missing lifecycleStatus is pending (treated as draft)', r4.pendingCount === 1 && r4.approvedCount === 0)

// ---------------------------------------------------------------------------
section('FOW-4: rankFowByReadiness')

const readinesses = [
  computeFowReadiness(fow('a', 'A'), [submittal('1', 'approved'), submittal('2', 'approved')]),
  computeFowReadiness(fow('b', 'B'), [submittal('3', 'rejected'), submittal('4', 'rejected')]),
  computeFowReadiness(fow('c', 'C'), [submittal('5', 'rejected'), submittal('6', 'rejected'), submittal('7', 'rejected')]),
  computeFowReadiness(fow('d', 'D'), [submittal('8', 'approved'), submittal('9', 'submitted')]),
]
const ranked = rankFowByReadiness(readinesses)

assert('FOW-4a: worst readiness first', ranked[0].fow.id === 'c' || ranked[0].fow.id === 'b')
assert('FOW-4b: among ties, more blockers first', ranked[0].fow.id === 'c' && ranked[1].fow.id === 'b')
assert('FOW-4c: 100% readiness sorted last', ranked[3].fow.id === 'a')
assert('FOW-4d: 50% in middle', ranked[2].fow.id === 'd')
assert('FOW-4e: rankFowByReadiness does not mutate input', readinesses[0].fow.id === 'a')

// ---------------------------------------------------------------------------
section('FOW-5: groupSubmittalsByFowEntity')

const fowsList = [fow('fA', 'A'), fow('fB', 'B'), fow('fC', 'C')]
const subsList = [
  submittal('s1', 'approved', { fowEntityId: 'fA' }),
  submittal('s2', 'submitted', { fowEntityId: 'fA' }),
  submittal('s3', 'rejected', { fowEntityId: 'fB' }),
  submittal('s4', 'draft', { fowEntityId: null }),       // unlinked — skipped
  submittal('s5', 'draft', { fowEntityId: 'fX' }),       // links to unknown FOW — skipped
]
const grouped = groupSubmittalsByFowEntity(fowsList, subsList)

assert('FOW-5a: returns a Map', grouped instanceof Map)
assert('FOW-5b: every FOW has an entry (even empty)', grouped.has('fC') && grouped.get('fC').length === 0)
assert('FOW-5c: A has 2 submittals', grouped.get('fA')?.length === 2)
assert('FOW-5d: B has 1 submittal', grouped.get('fB')?.length === 1)
assert('FOW-5e: unlinked + unknown-FOW submittals are skipped',
  grouped.get('fA').length + grouped.get('fB').length + grouped.get('fC').length === 3)

// ---------------------------------------------------------------------------
console.log('\n──────────────────────────────────────────────────')
console.log(`fow-graph:harness: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
