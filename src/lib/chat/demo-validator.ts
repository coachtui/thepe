/**
 * Demo Validator — Phase 3
 *
 * Validation harness for the demo entity graph. Mirrors the pattern of
 * graph-validator.ts (Phase 2) but targets discipline='demo' entities.
 *
 * Used to verify that demo extraction is producing correct, complete,
 * well-formed entity data before relying on it for chat responses.
 *
 * Usage:
 *   const report = await runDemoValidation(projectId)
 *   console.log(formatDemoValidationReport(report))
 */

import { createClient } from '@/lib/db/supabase/server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DemoValidationTest {
  name:        string
  passed:      boolean
  actual:      number | string
  expected:    string
  details:     string
}

export interface DemoValidationReport {
  projectId:            string
  passed:               boolean
  testsPassed:          number
  testsTotal:           number
  tests:                DemoValidationTest[]
  demoEntityCount:      number
  statusDistribution:   Record<string, number>
  entityTypeDistribution: Record<string, number>
  sheetsCovered:        string[]
  summary:              string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all 5 validation tests against demo entities for the given project.
 *
 * Tests:
 *   1. demo_entities_exist       — At least one demo entity in the graph
 *   2. findings_coverage         — Every demo entity has ≥ 1 finding
 *   3. location_coverage         — Every demo entity has ≥ 1 location
 *   4. status_variety            — At least 2 distinct status values
 *   5. citation_coverage         — ≥ 50% of demo entities have source_document_id
 */
export async function runDemoValidation(
  projectId: string
): Promise<DemoValidationReport> {
  const supabase = await createClient()
  const db = supabase as any

  console.log(`[Demo Validator] Running validation for project=${projectId}`)

  // ── Fetch demo entities ──────────────────────────────────────────────────

  const { data: entities, error: entitiesError } = await db
    .from('project_entities')
    .select(`
      id,
      entity_type,
      status,
      confidence,
      source_document_id,
      entity_findings ( id ),
      entity_locations ( id )
    `)
    .eq('project_id', projectId)
    .eq('discipline', 'demo')

  if (entitiesError) {
    return buildErrorReport(projectId, `Failed to query demo entities: ${entitiesError.message}`)
  }

  const entityList: any[] = entities ?? []
  const demoEntityCount = entityList.length

  // ── Compute distributions ────────────────────────────────────────────────

  const statusDistribution: Record<string, number> = {}
  const entityTypeDistribution: Record<string, number> = {}

  for (const e of entityList) {
    const status     = e.status     ?? 'unknown'
    const entityType = e.entity_type ?? 'unknown'
    statusDistribution[status]     = (statusDistribution[status]     ?? 0) + 1
    entityTypeDistribution[entityType] = (entityTypeDistribution[entityType] ?? 0) + 1
  }

  // ── Fetch sheets covered ─────────────────────────────────────────────────

  const { data: locationRows } = await db
    .from('entity_locations')
    .select('sheet_number')
    .eq('project_id', projectId)
    .in(
      'entity_id',
      entityList.map((e: any) => e.id)
    )

  const sheetsCovered = Array.from(
    new Set(
      (locationRows ?? [])
        .map((l: any) => l.sheet_number)
        .filter(Boolean)
    )
  ).sort() as string[]

  // ── Run tests ────────────────────────────────────────────────────────────

  const tests: DemoValidationTest[] = []

  // Test 1: Demo entities exist
  tests.push({
    name:     'demo_entities_exist',
    passed:   demoEntityCount > 0,
    actual:   demoEntityCount,
    expected: '> 0',
    details:
      demoEntityCount > 0
        ? `${demoEntityCount} demo entities found`
        : 'No demo entities found — demo sheets may not have been processed',
  })

  // Test 2: Findings coverage
  const entitiesWithFindings = entityList.filter(
    (e: any) => (e.entity_findings ?? []).length > 0
  ).length
  const findingsCoverageOk =
    demoEntityCount === 0 || entitiesWithFindings === demoEntityCount
  tests.push({
    name:     'findings_coverage',
    passed:   findingsCoverageOk,
    actual:   `${entitiesWithFindings}/${demoEntityCount}`,
    expected: 'all entities have ≥ 1 finding',
    details:
      findingsCoverageOk
        ? `All ${demoEntityCount} entities have findings`
        : `${demoEntityCount - entitiesWithFindings} entities have no findings`,
  })

  // Test 3: Location coverage
  const entitiesWithLocations = entityList.filter(
    (e: any) => (e.entity_locations ?? []).length > 0
  ).length
  const locationCoverageOk =
    demoEntityCount === 0 || entitiesWithLocations === demoEntityCount
  tests.push({
    name:     'location_coverage',
    passed:   locationCoverageOk,
    actual:   `${entitiesWithLocations}/${demoEntityCount}`,
    expected: 'all entities have ≥ 1 location',
    details:
      locationCoverageOk
        ? `All ${demoEntityCount} entities have locations`
        : `${demoEntityCount - entitiesWithLocations} entities have no location data`,
  })

  // Test 4: Status variety
  const distinctStatuses = Object.keys(statusDistribution).length
  const statusVarietyOk  = demoEntityCount === 0 || distinctStatuses >= 2
  tests.push({
    name:     'status_variety',
    passed:   statusVarietyOk,
    actual:   distinctStatuses,
    expected: '≥ 2 distinct status values',
    details:
      statusVarietyOk
        ? `${distinctStatuses} distinct statuses: ${Object.keys(statusDistribution).join(', ')}`
        : `Only 1 status value found (${Object.keys(statusDistribution)[0]}) — extraction may be incomplete`,
  })

  // Test 5: Citation coverage (≥ 50% have source_document_id)
  const entitiesWithCitation = entityList.filter(
    (e: any) => e.source_document_id != null
  ).length
  const citationRate    = demoEntityCount > 0 ? entitiesWithCitation / demoEntityCount : 0
  const citationOk      = demoEntityCount === 0 || citationRate >= 0.5
  tests.push({
    name:     'citation_coverage',
    passed:   citationOk,
    actual:   `${Math.round(citationRate * 100)}%`,
    expected: '≥ 50% of entities have a source document',
    details:
      citationOk
        ? `${entitiesWithCitation}/${demoEntityCount} entities cited`
        : `Only ${entitiesWithCitation}/${demoEntityCount} entities have source_document_id`,
  })

  // ── Build report ─────────────────────────────────────────────────────────

  const testsPassed = tests.filter(t => t.passed).length
  const passed      = testsPassed === tests.length

  const report: DemoValidationReport = {
    projectId,
    passed,
    testsPassed,
    testsTotal: tests.length,
    tests,
    demoEntityCount,
    statusDistribution,
    entityTypeDistribution,
    sheetsCovered,
    summary: buildSummary(passed, testsPassed, tests.length, demoEntityCount),
  }

  console.log(`[Demo Validator] ${testsPassed}/${tests.length} tests passed`)
  return report
}

/**
 * Format a DemoValidationReport into a human-readable summary string.
 */
export function formatDemoValidationReport(report: DemoValidationReport): string {
  const lines: string[] = []

  lines.push(`Demo Validation Report — Project ${report.projectId}`)
  lines.push(`Overall: ${report.passed ? 'PASSED' : 'FAILED'} (${report.testsPassed}/${report.testsTotal} tests)`)
  lines.push('')

  lines.push('Test Results:')
  for (const test of report.tests) {
    const icon = test.passed ? '✓' : '✗'
    lines.push(`  ${icon} ${test.name}`)
    lines.push(`      actual:   ${test.actual}`)
    lines.push(`      expected: ${test.expected}`)
    if (!test.passed) {
      lines.push(`      issue:    ${test.details}`)
    }
  }

  lines.push('')
  lines.push(`Entity count:    ${report.demoEntityCount}`)

  if (Object.keys(report.statusDistribution).length > 0) {
    lines.push('Status breakdown:')
    for (const [status, count] of Object.entries(report.statusDistribution)) {
      lines.push(`  ${status}: ${count}`)
    }
  }

  if (Object.keys(report.entityTypeDistribution).length > 0) {
    lines.push('Entity types:')
    for (const [type, count] of Object.entries(report.entityTypeDistribution)) {
      lines.push(`  ${type}: ${count}`)
    }
  }

  if (report.sheetsCovered.length > 0) {
    lines.push(`Sheets covered:  ${report.sheetsCovered.join(', ')}`)
  }

  lines.push('')
  lines.push(report.summary)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildSummary(
  passed: boolean,
  testsPassed: number,
  testsTotal: number,
  entityCount: number
): string {
  if (entityCount === 0) {
    return (
      'No demo entities found. Upload and process demo plan sheets (D-xxx, DM-xxx, DRCP-xxx) ' +
      'to populate the demo entity graph.'
    )
  }

  if (passed) {
    return (
      `All ${testsTotal} validation tests passed. Demo entity graph is complete and ready for ` +
      `chat queries. ${entityCount} entities extracted.`
    )
  }

  return (
    `${testsPassed}/${testsTotal} tests passed. ` +
    'Review failed tests above. Common causes: incomplete sheet processing, ' +
    'missing location data, or all entities assigned the same status.'
  )
}

function buildErrorReport(
  projectId: string,
  errorMessage: string
): DemoValidationReport {
  return {
    projectId,
    passed:      false,
    testsPassed: 0,
    testsTotal:  5,
    tests: [
      {
        name:     'query_succeeded',
        passed:   false,
        actual:   'error',
        expected: 'query returns data',
        details:  errorMessage,
      },
    ],
    demoEntityCount:          0,
    statusDistribution:       {},
    entityTypeDistribution:   {},
    sheetsCovered:            [],
    summary: `Validation failed: ${errorMessage}`,
  }
}
