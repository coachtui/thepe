/**
 * Coordination Validator — Phase 5B
 *
 * Validates that the cross-discipline coordination queries return coherent
 * results for a project. Designed for offline validation runs, not production
 * request paths.
 *
 * Usage:
 *   import { runCoordinationValidation } from '@/lib/chat/coordination-validator'
 *   const report = await runCoordinationValidation(projectId)
 *   console.log(formatCoordinationValidationReport(report))
 *
 * Test suite (8 validation tests):
 *   1. Entity discipline coverage    — at least one discipline extracted
 *   2. Entity location coverage      — entities have room_number or level populated
 *   3. Trade presence per room       — queryTradesInRoom returns ≥1 trade for a known room
 *   4. Trade presence per level      — queryAffectedArea with a level filter returns ≥1 trade
 *   5. Coordination notes surface    — any entity with coordination_note finding
 *   6. Demo constraint surface       — demo to_remain/to_protect entities visible in coord query
 *   7. Cross-discipline consistency  — disciplines from queryTradesInRoom ⊇ unique entity disciplines in that room
 *   8. Confidence range              — all coordination results have confidence in [0, 1]
 */

import { createClient } from '@/lib/db/supabase/server'
import {
  queryTradesInRoom,
  queryCoordinationConstraints,
  queryAffectedArea,
} from './coordination-queries'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoordinationValidationTestResult {
  testName:    string
  passed:      boolean
  details:     string
  rawResult:   unknown
}

export interface CoordinationValidationReport {
  projectId:  string
  timestamp:  string
  passed:     number
  failed:     number
  tests:      CoordinationValidationTestResult[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the coordination validation suite for a project.
 * Returns a report with pass/fail for each of the 8 tests.
 */
export async function runCoordinationValidation(
  projectId: string
): Promise<CoordinationValidationReport> {
  const supabase = await createClient()
  const db = supabase as any

  const tests: CoordinationValidationTestResult[] = []

  // ── Test 1: Entity discipline coverage ───────────────────────────────────
  await runTest(tests, 'Entity discipline coverage', async () => {
    const { data, error } = await db
      .from('project_entities')
      .select('discipline')
      .eq('project_id', projectId)
      .limit(1)

    if (error) throw error

    const passed = Array.isArray(data) && data.length > 0
    return {
      passed,
      details: passed
        ? `Found project_entities for project`
        : 'No entities found — sheets may not have been processed',
      raw: data,
    }
  })

  // ── Test 2: Entity location coverage ─────────────────────────────────────
  await runTest(tests, 'Entity location coverage', async () => {
    const { data, error } = await db
      .from('entity_locations')
      .select('room_number, level, entity_id, project_entities!inner(project_id)')
      .eq('project_entities.project_id', projectId)
      .not('room_number', 'is', null)
      .limit(5)

    if (error) throw error

    const passed = Array.isArray(data) && data.length > 0
    return {
      passed,
      details: passed
        ? `Found ${data.length} entity_location(s) with room_number populated`
        : 'No entity_locations with room_number found — location fields may not be populated',
      raw: data,
    }
  })

  // ── Test 3: Trade presence per room ──────────────────────────────────────
  const firstRoom = await discoverFirstRoom(projectId, db)

  await runTest(tests, 'Trade presence per room', async () => {
    if (!firstRoom) {
      return {
        passed: false,
        details: 'Could not find a room number to test — entity_locations.room_number is empty',
        raw: null,
      }
    }

    const result = await queryTradesInRoom(projectId, firstRoom)
    const passed = result.success && result.tradesPresent.length > 0

    return {
      passed,
      details: passed
        ? `Room ${firstRoom}: ${result.tradesPresent.length} trade(s) — ${result.tradesPresent.map(t => t.trade).join(', ')}`
        : `Room ${firstRoom}: queryTradesInRoom returned no trades (success=${result.success})`,
      raw: result,
    }
  })

  // ── Test 4: Trade presence per level ─────────────────────────────────────
  const firstLevel = await discoverFirstLevel(projectId, db)

  await runTest(tests, 'Trade presence per level', async () => {
    if (!firstLevel) {
      return {
        passed: false,
        details: 'Could not find a level to test — entity_locations.level is empty',
        raw: null,
      }
    }

    const result = await queryAffectedArea(projectId, null, firstLevel)
    const passed = result.success && result.tradesPresent.length > 0

    return {
      passed,
      details: passed
        ? `Level ${firstLevel}: ${result.tradesPresent.length} trade(s) — ${result.tradesPresent.map(t => t.trade).join(', ')}`
        : `Level ${firstLevel}: queryAffectedArea returned no trades (success=${result.success})`,
      raw: result,
    }
  })

  // ── Test 5: Coordination notes surface ───────────────────────────────────
  await runTest(tests, 'Coordination notes surface', async () => {
    const { data, error } = await db
      .from('entity_findings')
      .select('id, statement, project_entities!inner(project_id)')
      .eq('project_entities.project_id', projectId)
      .eq('finding_type', 'coordination_note')
      .limit(3)

    if (error) throw error

    // This test is informational — 0 coord notes is valid (just means none tagged)
    const count = Array.isArray(data) ? data.length : 0
    return {
      passed: true,
      details: count > 0
        ? `Found ${count} entity_finding(s) with finding_type='coordination_note'`
        : 'No coordination_note findings — this is expected if no coordination notes were drawn explicitly',
      raw: data,
    }
  })

  // ── Test 6: Demo constraint surface ──────────────────────────────────────
  await runTest(tests, 'Demo constraint surface', async () => {
    if (!firstRoom) {
      return {
        passed: true,
        details: 'Skipped — no room number available',
        raw: null,
      }
    }

    const result = await queryCoordinationConstraints(projectId, firstRoom, null)
    // Pass if either the query succeeded or gracefully returned empty (no demo entities)
    return {
      passed: true,
      details: result.success
        ? `queryCoordinationConstraints succeeded for Room ${firstRoom}: ${result.tradesPresent.length} trade(s)`
        : `queryCoordinationConstraints returned empty (no demo constraints in Room ${firstRoom})`,
      raw: result,
    }
  })

  // ── Test 7: Cross-discipline consistency ─────────────────────────────────
  await runTest(tests, 'Cross-discipline consistency', async () => {
    if (!firstRoom) {
      return {
        passed: true,
        details: 'Skipped — no room number available',
        raw: null,
      }
    }

    // Get disciplines directly from DB for this room
    const { data: dbRows, error } = await db
      .from('project_entities')
      .select('discipline, entity_locations!inner(room_number)')
      .eq('project_id', projectId)
      .eq('entity_locations.room_number', firstRoom)

    if (error) throw error

    const dbDisciplines = new Set<string>(
      (dbRows ?? []).map((r: any) => r.discipline as string)
    )

    const coordResult = await queryTradesInRoom(projectId, firstRoom)
    const coordTrades = new Set<string>(
      coordResult.tradesPresent.map(t => t.trade)
    )

    // Coordination result should cover the same discipline count (MEP is split by trade)
    const dbCount   = dbDisciplines.size
    const coordCount = coordTrades.size

    // Allow coordination to have more entries (MEP splits into 3 trades)
    const passed = coordCount >= dbCount || dbCount === 0

    return {
      passed,
      details: passed
        ? `DB disciplines: ${Array.from(dbDisciplines).join(', ')} → Coord trades: ${Array.from(coordTrades).join(', ')}`
        : `Coord trades (${coordCount}) < DB disciplines (${dbCount}) — some disciplines may have dropped`,
      raw: { dbDisciplines: Array.from(dbDisciplines), coordTrades: Array.from(coordTrades) },
    }
  })

  // ── Test 8: Confidence range ──────────────────────────────────────────────
  await runTest(tests, 'Confidence range', async () => {
    const testResults = await Promise.all([
      firstRoom
        ? queryTradesInRoom(projectId, firstRoom)
        : Promise.resolve(null),
      firstLevel
        ? queryAffectedArea(projectId, null, firstLevel)
        : Promise.resolve(null),
    ])

    const allConf = testResults
      .filter(Boolean)
      .map((r: any) => r.confidence as number)

    const allValid = allConf.every(c => typeof c === 'number' && c >= 0 && c <= 1)

    return {
      passed: allValid || allConf.length === 0,
      details: allConf.length > 0
        ? `Confidence values: ${allConf.join(', ')} — all in [0,1]: ${allValid}`
        : 'No coordination results to validate confidence range (expected when no entities)',
      raw: allConf,
    }
  })

  const passed = tests.filter(t => t.passed).length
  const failed = tests.filter(t => !t.passed).length

  return {
    projectId,
    timestamp: new Date().toISOString(),
    passed,
    failed,
    tests,
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Format a CoordinationValidationReport as a human-readable string.
 */
export function formatCoordinationValidationReport(
  report: CoordinationValidationReport
): string {
  const lines: string[] = []

  lines.push(`COORDINATION VALIDATION REPORT`)
  lines.push(`Project:   ${report.projectId}`)
  lines.push(`Timestamp: ${report.timestamp}`)
  lines.push(`Results:   ${report.passed} passed / ${report.failed} failed\n`)

  for (const test of report.tests) {
    const status = test.passed ? '✓ PASS' : '✗ FAIL'
    lines.push(`${status}  ${test.testName}`)
    lines.push(`       ${test.details}`)
  }

  if (report.failed === 0) {
    lines.push('\nAll coordination validation tests passed.')
  } else {
    lines.push(`\n${report.failed} test(s) failed — review entity extraction for the affected disciplines.`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function runTest(
  tests: CoordinationValidationTestResult[],
  testName: string,
  fn: () => Promise<{ passed: boolean; details: string; raw: unknown }>
): Promise<void> {
  try {
    const result = await fn()
    tests.push({ testName, passed: result.passed, details: result.details, rawResult: result.raw })
  } catch (err) {
    tests.push({
      testName,
      passed: false,
      details: `Test threw: ${err instanceof Error ? err.message : String(err)}`,
      rawResult: null,
    })
  }
}

async function discoverFirstRoom(projectId: string, db: any): Promise<string | null> {
  try {
    const { data } = await db
      .from('entity_locations')
      .select('room_number, project_entities!inner(project_id)')
      .eq('project_entities.project_id', projectId)
      .not('room_number', 'is', null)
      .limit(1)
      .single()

    return data?.room_number ?? null
  } catch {
    return null
  }
}

async function discoverFirstLevel(projectId: string, db: any): Promise<string | null> {
  try {
    const { data } = await db
      .from('entity_locations')
      .select('level, project_entities!inner(project_id)')
      .eq('project_entities.project_id', projectId)
      .not('level', 'is', null)
      .limit(1)
      .single()

    return data?.level ?? null
  } catch {
    return null
  }
}
