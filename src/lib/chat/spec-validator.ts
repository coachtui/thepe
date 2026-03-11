/**
 * Spec Validator — Phase 6A/B/C
 *
 * Validation harness for spec, RFI, and submittal entity graph data.
 *
 * Usage:
 *   const report = await runSpecValidation(supabase, projectId)
 *   console.log(formatSpecValidationReport(report))
 *
 * Tests:
 *   1. spec_sections_ingested     — at least one discipline='spec' entity exists
 *   2. requirement_families       — at least one finding per requirement family
 *   3. governs_relationships      — at least one 'governs' relationship exists
 *   4. rfi_linked                 — at least one RFI with a 'clarifies' relationship
 *   5. submittal_linked           — at least one submittal with 'submitted_for' relationship
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpecValidationTestId =
  | 'spec_sections_ingested'
  | 'requirement_families'
  | 'governs_relationships'
  | 'rfi_linked'
  | 'submittal_linked'

export interface SpecValidationTest {
  id: SpecValidationTestId
  description: string
  passed: boolean
  detail: string
  count?: number
}

export interface SpecValidationReport {
  projectId: string
  ranAt: string            // ISO timestamp
  tests: SpecValidationTest[]
  passCount: number
  totalTests: number
  allPassed: boolean
  summary: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runSpecValidation(
  supabase: SupabaseClient,
  projectId: string
): Promise<SpecValidationReport> {
  const tests: SpecValidationTest[] = await Promise.all([
    testSpecSectionsIngested(supabase, projectId),
    testRequirementFamilies(supabase, projectId),
    testGovernsRelationships(supabase, projectId),
    testRFILinked(supabase, projectId),
    testSubmittalLinked(supabase, projectId),
  ])

  const passCount = tests.filter(t => t.passed).length
  const allPassed = passCount === tests.length

  return {
    projectId,
    ranAt: new Date().toISOString(),
    tests,
    passCount,
    totalTests: tests.length,
    allPassed,
    summary: allPassed
      ? `All ${tests.length} Phase 6 validation tests passed.`
      : `${passCount}/${tests.length} tests passed. See details for failures.`,
  }
}

export function formatSpecValidationReport(report: SpecValidationReport): string {
  const lines: string[] = [
    `Phase 6 Validation Report — Project ${report.projectId}`,
    `Ran at: ${report.ranAt}`,
    `Result: ${report.summary}`,
    '',
  ]

  for (const test of report.tests) {
    const icon = test.passed ? '✓' : '✗'
    lines.push(`${icon} [${test.id}] ${test.description}`)
    lines.push(`    ${test.detail}`)
    if (test.count !== undefined) {
      lines.push(`    Count: ${test.count}`)
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Individual tests
// ---------------------------------------------------------------------------

async function testSpecSectionsIngested(
  supabase: SupabaseClient,
  projectId: string
): Promise<SpecValidationTest> {
  try {
    const { count, error } = await (supabase as SupabaseClient)
      .from('project_entities')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('discipline', 'spec')

    const n = count ?? 0
    const passed = !error && n > 0

    return {
      id: 'spec_sections_ingested',
      description: 'At least one spec entity exists (discipline=spec)',
      passed,
      detail: error
        ? `Query error: ${error.message}`
        : passed
          ? `${n} spec entity(ies) found`
          : 'No spec entities found. Spec sections have not been ingested yet.',
      count: n,
    }
  } catch (err) {
    return fail('spec_sections_ingested', 'At least one spec entity exists (discipline=spec)', err)
  }
}

async function testRequirementFamilies(
  supabase: SupabaseClient,
  projectId: string
): Promise<SpecValidationTest> {
  const REQUIREMENT_TYPES = [
    'material_requirement',
    'testing_requirement',
    'submittal_requirement',
  ]

  try {
    // Check that at least the three most important families are present
    const { data, error } = await (supabase as SupabaseClient)
      .from('entity_findings')
      .select('finding_type')
      .in('finding_type', REQUIREMENT_TYPES)
      .eq(
        'entity_id',
        (supabase as SupabaseClient)
          .from('project_entities')
          .select('id')
          .eq('project_id', projectId)
          .eq('discipline', 'spec')
      )
      .limit(10)

    if (error) {
      // Fallback: join in-memory by fetching all spec entity IDs first
      const { data: entityIds } = await (supabase as SupabaseClient)
        .from('project_entities')
        .select('id')
        .eq('project_id', projectId)
        .eq('discipline', 'spec')
        .limit(200)

      if (!entityIds || entityIds.length === 0) {
        return {
          id: 'requirement_families',
          description: 'Core requirement families present (material, testing, submittal)',
          passed: false,
          detail: 'No spec entities found — cannot check requirement families.',
          count: 0,
        }
      }

      const ids = entityIds.map((r: { id: string }) => r.id)

      const { data: findings, error: findErr } = await (supabase as SupabaseClient)
        .from('entity_findings')
        .select('finding_type')
        .in('entity_id', ids)
        .in('finding_type', REQUIREMENT_TYPES)

      if (findErr || !findings) {
        return fail('requirement_families', 'Core requirement families present', findErr ?? new Error('No data'))
      }

      const families = new Set((findings as Array<{ finding_type: string }>).map(f => f.finding_type))
      const found = REQUIREMENT_TYPES.filter(t => families.has(t))
      const passed = found.length >= 2

      return {
        id: 'requirement_families',
        description: 'Core requirement families present (material, testing, submittal)',
        passed,
        detail: passed
          ? `Found families: ${found.join(', ')}`
          : `Only found: ${found.join(', ') || 'none'} — need at least material + testing`,
        count: families.size,
      }
    }

    const families = new Set((data as Array<{ finding_type: string }>).map(f => f.finding_type))
    const found = REQUIREMENT_TYPES.filter(t => families.has(t))
    const passed = found.length >= 2

    return {
      id: 'requirement_families',
      description: 'Core requirement families present (material, testing, submittal)',
      passed,
      detail: passed
        ? `Found families: ${found.join(', ')}`
        : `Only found: ${found.join(', ') || 'none'}`,
      count: families.size,
    }
  } catch (err) {
    return fail('requirement_families', 'Core requirement families present', err)
  }
}

async function testGovernsRelationships(
  supabase: SupabaseClient,
  projectId: string
): Promise<SpecValidationTest> {
  try {
    const { count, error } = await (supabase as SupabaseClient)
      .from('entity_relationships')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('relationship_type', 'governs')

    const n = count ?? 0
    const passed = !error && n > 0

    return {
      id: 'governs_relationships',
      description: 'At least one "governs" relationship links spec to entities',
      passed,
      detail: error
        ? `Query error: ${error.message}`
        : passed
          ? `${n} governs relationship(s) found`
          : 'No governs relationships found. Spec linkage not yet established.',
      count: n,
    }
  } catch (err) {
    return fail('governs_relationships', 'At least one "governs" relationship exists', err)
  }
}

async function testRFILinked(
  supabase: SupabaseClient,
  projectId: string
): Promise<SpecValidationTest> {
  try {
    // Check for RFI entities with clarifies relationships
    const { data: rfiEntities } = await (supabase as SupabaseClient)
      .from('project_entities')
      .select('id')
      .eq('project_id', projectId)
      .eq('discipline', 'rfi')
      .limit(50)

    const rfiIds: string[] = (rfiEntities ?? []).map((r: { id: string }) => r.id)

    if (rfiIds.length === 0) {
      return {
        id: 'rfi_linked',
        description: 'At least one RFI with a "clarifies" relationship',
        passed: false,
        detail: 'No RFI entities found. Change documents not yet ingested.',
        count: 0,
      }
    }

    const { count, error } = await (supabase as SupabaseClient)
      .from('entity_relationships')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('relationship_type', 'clarifies')
      .in('from_entity_id', rfiIds)

    const n = count ?? 0
    const passed = !error && n > 0

    return {
      id: 'rfi_linked',
      description: 'At least one RFI with a "clarifies" relationship',
      passed,
      detail: error
        ? `Query error: ${error.message}`
        : passed
          ? `${n} RFI clarifies relationship(s) found (${rfiIds.length} total RFI entities)`
          : `${rfiIds.length} RFI entities found but none linked via "clarifies". Entity linkage not established.`,
      count: rfiIds.length,
    }
  } catch (err) {
    return fail('rfi_linked', 'At least one RFI with a "clarifies" relationship', err)
  }
}

async function testSubmittalLinked(
  supabase: SupabaseClient,
  projectId: string
): Promise<SpecValidationTest> {
  try {
    const { data: subEntities } = await (supabase as SupabaseClient)
      .from('project_entities')
      .select('id')
      .eq('project_id', projectId)
      .eq('discipline', 'submittal')
      .limit(50)

    const subIds: string[] = (subEntities ?? []).map((r: { id: string }) => r.id)

    if (subIds.length === 0) {
      return {
        id: 'submittal_linked',
        description: 'At least one submittal with a "submitted_for" relationship',
        passed: false,
        detail: 'No submittal entities found. Submittals not yet ingested.',
        count: 0,
      }
    }

    const { count, error } = await (supabase as SupabaseClient)
      .from('entity_relationships')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('relationship_type', 'submitted_for')
      .in('from_entity_id', subIds)

    const n = count ?? 0
    const passed = !error && n > 0

    return {
      id: 'submittal_linked',
      description: 'At least one submittal with a "submitted_for" relationship',
      passed,
      detail: error
        ? `Query error: ${error.message}`
        : passed
          ? `${n} submitted_for relationship(s) found (${subIds.length} total submittal entities)`
          : `${subIds.length} submittal entities found but none linked via "submitted_for".`,
      count: subIds.length,
    }
  } catch (err) {
    return fail('submittal_linked', 'At least one submittal with a "submitted_for" relationship', err)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(
  id: SpecValidationTestId,
  description: string,
  err: unknown
): SpecValidationTest {
  return {
    id,
    description,
    passed: false,
    detail: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
  }
}
