/**
 * Arch Validator — Phase 4
 *
 * Validation harness for the architectural entity graph.
 * Runs 6 deterministic tests to verify extraction quality.
 *
 * Mirror pattern from graph-validator.ts and demo-validator.ts.
 */

import { createClient } from '@/lib/db/supabase/server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchValidationTest {
  name: string
  passed: boolean
  detail: string
}

export interface ArchValidationReport {
  projectId: string
  passed: boolean
  tests: ArchValidationTest[]
  summary: string
  archEntityCount: number
  entityTypeDistribution: Record<string, number>
  scheduleEntriesCount: number
  tagLinkageCount: number    // entities with a described_by → schedule_entry relationship
  sheetsCovered: string[]
}

// ---------------------------------------------------------------------------
// Public: runArchValidation
// ---------------------------------------------------------------------------

/**
 * Run the 6-test architectural entity graph validation suite.
 *
 * Tests:
 *   1. arch_entities_exist   — at least one architectural entity extracted
 *   2. schedules_parsed      — at least one schedule_entry entity exists
 *   3. tag_linkage           — at least one described_by relationship to a schedule_entry
 *   4. location_coverage     — ≥ 80% of physical arch entities have a location
 *   5. findings_coverage     — ≥ 50% of schedule_entry entities have a schedule_row finding
 *   6. citation_coverage     — at least one arch entity has source_document_id set
 */
export async function runArchValidation(
  projectId: string
): Promise<ArchValidationReport> {
  const supabase = await createClient()
  const db = supabase as any

  const tests: ArchValidationTest[] = []
  const entityTypeDistribution: Record<string, number> = {}

  try {
    // ── Fetch all arch entities ─────────────────────────────────────────────
    const { data: entities, error: entityErr } = await db
      .from('project_entities')
      .select('id, entity_type, subtype, source_document_id, entity_locations(id)')
      .eq('project_id', projectId)
      .eq('discipline', 'architectural')

    if (entityErr) throw entityErr

    const allEntities: any[] = entities ?? []
    const archEntityCount = allEntities.length

    // Build entity type distribution
    for (const e of allEntities) {
      const t = e.entity_type ?? 'unknown'
      entityTypeDistribution[t] = (entityTypeDistribution[t] ?? 0) + 1
    }

    const entityIds = allEntities.map((e: any) => e.id)

    // ── Test 1: arch_entities_exist ─────────────────────────────────────────
    tests.push({
      name: 'arch_entities_exist',
      passed: archEntityCount > 0,
      detail: archEntityCount > 0
        ? `${archEntityCount} architectural entities found`
        : 'No architectural entities found — process A-xxx sheets first',
    })

    // ── Fetch schedule entries ──────────────────────────────────────────────
    const scheduleEntities = allEntities.filter(
      (e: any) => e.entity_type === 'schedule_entry'
    )
    const scheduleEntriesCount = scheduleEntities.length

    // ── Test 2: schedules_parsed ────────────────────────────────────────────
    tests.push({
      name: 'schedules_parsed',
      passed: scheduleEntriesCount > 0,
      detail: scheduleEntriesCount > 0
        ? `${scheduleEntriesCount} schedule entries parsed (door / window / room finish)`
        : 'No schedule entries found — process door / window / room finish schedule sheets',
    })

    // ── Fetch described_by relationships ────────────────────────────────────
    let tagLinkageCount = 0
    if (entityIds.length > 0) {
      const { data: relRows, error: relErr } = await db
        .from('entity_relationships')
        .select('from_entity_id')
        .eq('project_id', projectId)
        .eq('relationship_type', 'described_by')
        .in('from_entity_id', entityIds)

      if (!relErr && relRows) {
        tagLinkageCount = (relRows as any[]).length
      }
    }

    // ── Test 3: tag_linkage ─────────────────────────────────────────────────
    tests.push({
      name: 'tag_linkage',
      passed: tagLinkageCount > 0,
      detail: tagLinkageCount > 0
        ? `${tagLinkageCount} tag-to-schedule described_by relationship(s) found`
        : 'No tag linkage found — schedule entries may not have been linked to floor plan tags',
    })

    // ── Test 4: location_coverage ───────────────────────────────────────────
    // Physical entities: doors, windows, rooms, walls, finish_tags
    const physicalEntities = allEntities.filter((e: any) =>
      ['door', 'window', 'room', 'wall', 'finish_tag'].includes(e.entity_type)
    )
    const physicalWithLocation = physicalEntities.filter(
      (e: any) => (e.entity_locations ?? []).length > 0
    )
    const locationCoverage =
      physicalEntities.length > 0
        ? physicalWithLocation.length / physicalEntities.length
        : 0

    tests.push({
      name: 'location_coverage',
      passed: physicalEntities.length === 0 || locationCoverage >= 0.8,
      detail:
        physicalEntities.length === 0
          ? 'No physical entities to check'
          : `${physicalWithLocation.length}/${physicalEntities.length} physical entities have a location (${Math.round(locationCoverage * 100)}%)`,
    })

    // ── Test 5: findings_coverage ───────────────────────────────────────────
    // Check that schedule entries have schedule_row findings
    let schedWithFindings = 0
    if (scheduleEntities.length > 0) {
      const schedIds = scheduleEntities.map((e: any) => e.id)
      const { data: findingRows, error: findErr } = await db
        .from('entity_findings')
        .select('entity_id')
        .in('entity_id', schedIds)
        .eq('finding_type', 'schedule_row')

      if (!findErr && findingRows) {
        const coveredIds = new Set((findingRows as any[]).map((r: any) => r.entity_id))
        schedWithFindings = coveredIds.size
      }
    }

    const findingsCoverage =
      scheduleEntriesCount > 0
        ? schedWithFindings / scheduleEntriesCount
        : 0

    tests.push({
      name: 'findings_coverage',
      passed: scheduleEntriesCount === 0 || findingsCoverage >= 0.5,
      detail:
        scheduleEntriesCount === 0
          ? 'No schedule entries to check'
          : `${schedWithFindings}/${scheduleEntriesCount} schedule entries have a schedule_row finding (${Math.round(findingsCoverage * 100)}%)`,
    })

    // ── Test 6: citation_coverage ───────────────────────────────────────────
    const entitiesWithCitation = allEntities.filter(
      (e: any) => e.source_document_id != null
    )

    tests.push({
      name: 'citation_coverage',
      passed: entitiesWithCitation.length > 0,
      detail: entitiesWithCitation.length > 0
        ? `${entitiesWithCitation.length} arch entities have source_document_id set`
        : 'No arch entities have a source citation — extraction may have run without document context',
    })

    // ── Sheets covered ──────────────────────────────────────────────────────
    let sheetsCovered: string[] = []
    if (entityIds.length > 0) {
      const { data: locRows, error: locErr } = await db
        .from('entity_locations')
        .select('sheet_number')
        .in('entity_id', entityIds)
        .not('sheet_number', 'is', null)

      if (!locErr && locRows) {
        const sheets = new Set((locRows as any[]).map((r: any) => r.sheet_number as string))
        sheetsCovered = Array.from(sheets).sort()
      }
    }

    const passed = tests.every(t => t.passed)

    return {
      projectId,
      passed,
      tests,
      summary: buildSummary(passed, tests, archEntityCount, scheduleEntriesCount, tagLinkageCount),
      archEntityCount,
      entityTypeDistribution,
      scheduleEntriesCount,
      tagLinkageCount,
      sheetsCovered,
    }
  } catch (err) {
    console.error('[Arch Validator] runArchValidation error:', err)
    return {
      projectId,
      passed: false,
      tests: [{
        name: 'validation_error',
        passed: false,
        detail: `Validation failed with error: ${err instanceof Error ? err.message : String(err)}`,
      }],
      summary: 'Validation could not be completed — see error above.',
      archEntityCount: 0,
      entityTypeDistribution: {},
      scheduleEntriesCount: 0,
      tagLinkageCount: 0,
      sheetsCovered: [],
    }
  }
}

// ---------------------------------------------------------------------------
// Public: formatArchValidationReport
// ---------------------------------------------------------------------------

export function formatArchValidationReport(report: ArchValidationReport): string {
  const lines: string[] = []

  lines.push(`Arch Entity Graph Validation — Project ${report.projectId}`)
  lines.push(`Overall: ${report.passed ? 'PASS ✓' : 'FAIL ✗'}`)
  lines.push('')
  lines.push(report.summary)
  lines.push('')

  lines.push('Test Results:')
  for (const test of report.tests) {
    lines.push(`  ${test.passed ? '✓' : '✗'} ${test.name}: ${test.detail}`)
  }

  lines.push('')
  lines.push('Entity Type Distribution:')
  const sorted = Object.entries(report.entityTypeDistribution).sort((a, b) => b[1] - a[1])
  for (const [type, count] of sorted) {
    lines.push(`  ${type}: ${count}`)
  }

  if (report.sheetsCovered.length > 0) {
    lines.push('')
    lines.push(`Sheets Covered (${report.sheetsCovered.length}): ${report.sheetsCovered.join(', ')}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildSummary(
  passed: boolean,
  tests: ArchValidationTest[],
  entityCount: number,
  schedCount: number,
  linkCount: number
): string {
  if (passed) {
    return (
      `Architectural entity graph is valid. ` +
      `${entityCount} entities extracted, ${schedCount} schedule entries, ` +
      `${linkCount} tag-to-schedule linkage(s).`
    )
  }

  const failedNames = tests.filter(t => !t.passed).map(t => t.name)
  return (
    `Validation failed: ${failedNames.join(', ')}. ` +
    `${entityCount} entities found. ` +
    (entityCount === 0
      ? 'Run vision processing on architectural floor plan (A-xxx) and schedule sheets to populate the graph.'
      : 'Review the failed tests above for actionable details.')
  )
}
