/**
 * Graph Validator — Phase 2
 *
 * Compares legacy (project_quantities / utility_termination_points /
 * utility_crossings) retrieval results against graph-backed results for the
 * same project. Intended for offline validation, not production request paths.
 *
 * Usage (e.g., from a one-off API route or test script):
 *
 *   import { runValidation } from '@/lib/chat/graph-validator';
 *   const report = await runValidation(projectId);
 *   console.log(JSON.stringify(report, null, 2));
 *
 * Test suite (5 core utility queries):
 *   1. Utility line length     — BEGIN→END station delta
 *   2. Crossing count          — total and per-utility type
 *   3. Component count         — valve count
 *   4. Termination points      — station values for a specific utility
 *   5. Quantity summary        — entity counts vs legacy row counts
 */

import { createClient } from '@/lib/db/supabase/server';
import {
  queryComponentCount,
  queryCrossings,
  queryUtilityLength,
  getVisionDataSummary,
} from './vision-queries';
import { getTerminationPointsForUtility } from '@/lib/vision/termination-extractor';
import {
  queryGraphComponentCount,
  queryGraphCrossings,
  queryGraphUtilityLength,
  queryGraphTerminations,
  queryGraphEntitySummary,
} from './graph-queries';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ValidationTestResult {
  /** Short label for this test */
  testName: string;
  /** True when legacy and graph results agree within tolerance */
  passed: boolean;
  /** Raw legacy result */
  legacyResult: unknown;
  /** Raw graph result */
  graphResult: unknown;
  /** Human-readable explanation when passed=false */
  mismatchReason?: string;
  /**
   * 0–1 approximate agreement score.
   * 1.0 = exact match, 0.0 = complete disagreement.
   */
  matchScore: number;
}

export interface ValidationReport {
  projectId:        string;
  timestamp:        string;
  /** Name of the utility used for line-length and termination tests */
  testUtilityName:  string | null;
  tests:            ValidationTestResult[];
  overallPassRate:  number;
  /** Test names that failed — useful for quick triage */
  failedTests:      string[];
}

// ---------------------------------------------------------------------------
// Auto-discovery helpers
// ---------------------------------------------------------------------------

/**
 * Find the first utility that has both a linear_asset entity and at least one
 * junction entity with BEGIN and END termination types.
 * Falls back to any utility that has at least two junction entities.
 */
async function discoverTestUtility(projectId: string): Promise<string | null> {
  const supabase = await createClient();
  // Cast to any: entity graph tables not in generated Supabase types
  const db = supabase as any;

  // Look for junction entities that have BEGIN type
  const { data: beginJunctions } = await db
    .from('project_entities')
    .select('metadata, display_name')
    .eq('project_id', projectId)
    .eq('discipline', 'utility')
    .eq('entity_type', 'junction')
    .limit(20);

  if (!beginJunctions || beginJunctions.length === 0) {
    // Fall back to project_quantities if no junctions backfilled yet
    const { data: quantities } = await supabase
      .from('project_quantities')
      .select('item_name')
      .eq('project_id', projectId)
      .limit(1);
    return (quantities as any[])?.[0]?.item_name ?? null;
  }

  // Group by utility_name, prefer ones that have both BEGIN and END
  const byUtility: Record<string, Set<string>> = {};
  for (const j of beginJunctions as any[]) {
    const meta = (j.metadata as Record<string, unknown>) ?? {};
    const utilName = (meta.utility_name as string) ?? (j.display_name as string) ?? '';
    const termType = (meta.termination_type as string) ?? '';
    if (!utilName) continue;
    if (!byUtility[utilName]) byUtility[utilName] = new Set();
    byUtility[utilName].add(termType);
  }

  // Prefer utility with both BEGIN and END
  for (const [name, types] of Object.entries(byUtility)) {
    if (types.has('BEGIN') && types.has('END')) return name;
  }

  // Fall back to any utility with junctions
  return Object.keys(byUtility)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Individual test implementations
// ---------------------------------------------------------------------------

/**
 * TEST 1: Utility line length
 *
 * Legacy:  calculateLengthFromTerminations via queryUtilityLength()
 * Graph:   queryGraphUtilityLength()
 *
 * Pass criterion: |legacy.lengthLf - graph.lengthLf| < 0.1 LF
 */
async function testUtilityLength(
  projectId: string,
  utilityName: string
): Promise<ValidationTestResult> {
  const [legacy, graph] = await Promise.all([
    queryUtilityLength(projectId, utilityName),
    queryGraphUtilityLength(projectId, utilityName),
  ]);

  if (!legacy.success && !graph.success) {
    return {
      testName: 'utility_line_length',
      passed: true,   // Both agree: no data
      legacyResult: legacy,
      graphResult:  graph,
      matchScore: 1.0,
    };
  }

  if (!legacy.success || !graph.success) {
    return {
      testName: 'utility_line_length',
      passed: false,
      legacyResult: legacy,
      graphResult:  graph,
      mismatchReason:
        `One side returned no result. Legacy success=${legacy.success}, graph success=${graph.success}.`,
      matchScore: 0.0,
    };
  }

  const diff = Math.abs(legacy.lengthLf - graph.lengthLf);
  const passed = diff < 0.1;

  return {
    testName:     'utility_line_length',
    passed,
    legacyResult: { lengthLf: legacy.lengthLf, begin: legacy.beginStation, end: legacy.endStation },
    graphResult:  { lengthLf: graph.lengthLf,  begin: graph.beginStation,  end: graph.endStation  },
    mismatchReason: passed ? undefined
      : `Length delta ${diff.toFixed(3)} LF exceeds tolerance. Legacy=${legacy.lengthLf.toFixed(2)}, graph=${graph.lengthLf.toFixed(2)}.`,
    matchScore: passed ? 1.0 : Math.max(0, 1 - diff / Math.max(legacy.lengthLf, 1)),
  };
}

/**
 * TEST 2: Crossing count
 *
 * Legacy:  queryCrossings()
 * Graph:   queryGraphCrossings()
 *
 * Pass criteria:
 *   - Total crossing count matches exactly.
 *   - Per-utility-type counts all match (existing + proposed).
 */
async function testCrossings(projectId: string): Promise<ValidationTestResult> {
  const [legacy, graph] = await Promise.all([
    queryCrossings(projectId),
    queryGraphCrossings(projectId),
  ]);

  const legacyTotal = legacy.totalCrossings;
  const graphTotal  = graph.totalCrossings;

  if (legacyTotal === 0 && graphTotal === 0) {
    return {
      testName:    'crossing_count',
      passed:       true,
      legacyResult: { total: 0 },
      graphResult:  { total: 0 },
      matchScore:   1.0,
    };
  }

  if (legacyTotal !== graphTotal) {
    return {
      testName:    'crossing_count',
      passed:       false,
      legacyResult: { total: legacyTotal, summary: legacy.summary },
      graphResult:  { total: graphTotal,  summary: graph.summary  },
      mismatchReason: `Total crossing count mismatch: legacy=${legacyTotal}, graph=${graphTotal}.`,
      matchScore: Math.min(legacyTotal, graphTotal) / Math.max(legacyTotal, graphTotal),
    };
  }

  // Check per-utility-type counts
  const mismatches: string[] = [];
  for (const ls of legacy.summary) {
    const gs = graph.summary.find((s) => s.crossingUtility === ls.crossingUtility);
    if (!gs) {
      mismatches.push(`${ls.crossingUtility}: missing from graph`);
    } else if (ls.totalCount !== gs.totalCount) {
      mismatches.push(`${ls.crossingUtility}: legacy=${ls.totalCount}, graph=${gs.totalCount}`);
    }
  }

  const passed = mismatches.length === 0;
  return {
    testName:    'crossing_count',
    passed,
    legacyResult: { total: legacyTotal, summary: legacy.summary },
    graphResult:  { total: graphTotal,  summary: graph.summary  },
    mismatchReason: passed ? undefined : `Per-utility mismatches: ${mismatches.join('; ')}`,
    matchScore: passed ? 1.0
      : 1 - mismatches.length / Math.max(legacy.summary.length, 1),
  };
}

/**
 * TEST 3: Component count (valve)
 *
 * Legacy:  queryComponentCount(projectId, 'valve')
 * Graph:   queryGraphComponentCount(projectId, 'valve')
 *
 * Pass criterion: totalCount matches exactly.
 */
async function testComponentCount(projectId: string): Promise<ValidationTestResult> {
  const componentType = 'valve';
  const [legacy, graph] = await Promise.all([
    queryComponentCount(projectId, componentType),
    queryGraphComponentCount(projectId, componentType),
  ]);

  const lCount = legacy.totalCount;
  const gCount = graph.totalCount;

  const passed = lCount === gCount;
  return {
    testName:    'component_count_valve',
    passed,
    legacyResult: { totalCount: lCount, items: legacy.items.length },
    graphResult:  { totalCount: gCount, items: graph.items.length  },
    mismatchReason: passed ? undefined
      : `Valve count mismatch: legacy=${lCount}, graph=${gCount}.`,
    matchScore: lCount === 0 && gCount === 0 ? 1.0
      : Math.min(lCount, gCount) / Math.max(lCount, gCount, 1),
  };
}

/**
 * TEST 4: Termination points
 *
 * Legacy:  getTerminationPointsForUtility()
 * Graph:   queryGraphTerminations()
 *
 * Pass criteria:
 *   - Same count of termination points.
 *   - Same set of termination_types (BEGIN, END, etc.).
 *   - Station values agree within 0.01 ft (numeric) for matched types.
 */
async function testTerminations(
  projectId: string,
  utilityName: string
): Promise<ValidationTestResult> {
  const [legacyRaw, graph] = await Promise.all([
    getTerminationPointsForUtility(projectId, utilityName),
    queryGraphTerminations(projectId, utilityName),
  ]);

  const legacy = Array.isArray(legacyRaw) ? legacyRaw : [];

  if (legacy.length === 0 && graph.terminations.length === 0) {
    return {
      testName:    'termination_points',
      passed:       true,
      legacyResult: [],
      graphResult:  [],
      matchScore:   1.0,
    };
  }

  if (legacy.length !== graph.terminations.length) {
    return {
      testName:    'termination_points',
      passed:       false,
      legacyResult: legacy.map((p: any) => ({ type: p.termination_type, station: p.station })),
      graphResult:  graph.terminations.map((t) => ({ type: t.terminationType, station: t.station })),
      mismatchReason:
        `Count mismatch: legacy=${legacy.length}, graph=${graph.terminations.length}.`,
      matchScore: Math.min(legacy.length, graph.terminations.length) /
                  Math.max(legacy.length, graph.terminations.length),
    };
  }

  // Compare station values per termination_type
  const mismatches: string[] = [];
  for (const lp of legacy as any[]) {
    const gp = graph.terminations.find(
      (t) => t.terminationType === lp.termination_type
    );
    if (!gp) {
      mismatches.push(`${lp.termination_type}: not found in graph`);
      continue;
    }
    // Compare station_numeric
    const lNum = lp.station_numeric ?? null;
    const gNum = gp.stationNumeric ?? null;
    if (lNum !== null && gNum !== null && Math.abs(lNum - gNum) > 0.01) {
      mismatches.push(
        `${lp.termination_type}: station_numeric legacy=${lNum}, graph=${gNum}`
      );
    }
  }

  const passed = mismatches.length === 0;
  return {
    testName:    'termination_points',
    passed,
    legacyResult: legacy.map((p: any) => ({ type: p.termination_type, station: p.station, stationNumeric: p.station_numeric })),
    graphResult:  graph.terminations.map((t) => ({ type: t.terminationType, station: t.station, stationNumeric: t.stationNumeric })),
    mismatchReason: passed ? undefined : mismatches.join('; '),
    matchScore: passed ? 1.0 : 1 - mismatches.length / Math.max(legacy.length, 1),
  };
}

/**
 * TEST 5: Quantity summary
 *
 * Legacy:  getVisionDataSummary() — raw row counts from legacy tables
 * Graph:   queryGraphEntitySummary() — entity counts from graph tables
 *
 * Pass criteria (approximate — graph may deduplicate):
 *   - Graph junction count  ≥ legacy termination_point_count (exact match expected)
 *   - Graph crossing count  ≥ legacy crossing_count          (exact match expected)
 *   - Graph entity count    ≥ 1                              (at least something backfilled)
 *
 * Note: The graph may have FEWER entities than legacy rows because project_quantities
 * rows are deduplicated by item_name. This is expected and NOT a failure.
 * A strict count equality is only enforced for junctions and crossings (1:1 mapping).
 */
async function testQuantitySummary(projectId: string): Promise<ValidationTestResult> {
  const [legacy, graph] = await Promise.all([
    getVisionDataSummary(projectId),
    queryGraphEntitySummary(projectId),
  ]);

  const mismatches: string[] = [];

  // 1:1 mapping: each termination point → one junction entity
  if (graph.junctionCount !== legacy.terminationPointCount) {
    mismatches.push(
      `Junctions: legacy rows=${legacy.terminationPointCount}, graph entities=${graph.junctionCount}`
    );
  }

  // 1:1 mapping: each crossing → one crossing entity
  if (graph.crossingCount !== legacy.crossingCount) {
    mismatches.push(
      `Crossings: legacy rows=${legacy.crossingCount}, graph entities=${graph.crossingCount}`
    );
  }

  // Graph entities should be > 0 when legacy has data
  if (legacy.hasVisionData && graph.totalEntities === 0) {
    mismatches.push('No graph entities found despite legacy data existing — backfill may not have run.');
  }

  const passed = mismatches.length === 0;

  return {
    testName:    'quantity_summary',
    passed,
    legacyResult: {
      quantityRows:        legacy.quantityCount,
      terminationRows:     legacy.terminationPointCount,
      crossingRows:        legacy.crossingCount,
    },
    graphResult: {
      totalEntities:       graph.totalEntities,
      linearAssets:        graph.linearAssetCount,
      components:          graph.componentCount,
      junctions:           graph.junctionCount,
      crossings:           graph.crossingCount,
      findings:            graph.findingCount,
      citations:           graph.citationCount,
      relationships:       graph.relationshipCount,
    },
    mismatchReason: passed ? undefined : mismatches.join('; '),
    matchScore: passed ? 1.0 : 1 - mismatches.length / 3,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run all 5 Phase 2 validation tests for a project.
 *
 * @param projectId - The project to validate.
 * @returns ValidationReport with per-test results and overall pass rate.
 */
export async function runValidation(projectId: string): Promise<ValidationReport> {
  const timestamp      = new Date().toISOString();
  const testUtilityName = await discoverTestUtility(projectId);

  console.log(`[Graph Validator] Starting validation for project ${projectId}`);
  console.log(`[Graph Validator] Test utility: "${testUtilityName ?? 'none found'}"`);

  const tests: ValidationTestResult[] = [];

  // Test 1: Line length (skipped if no test utility found)
  if (testUtilityName) {
    tests.push(await testUtilityLength(projectId, testUtilityName));
  } else {
    tests.push({
      testName:    'utility_line_length',
      passed:       true,
      legacyResult: null,
      graphResult:  null,
      mismatchReason: 'Skipped — no test utility found in project.',
      matchScore:   1.0,
    });
  }

  // Tests 2–5 run unconditionally
  const [crossingResult, componentResult, summaryResult] = await Promise.all([
    testCrossings(projectId),
    testComponentCount(projectId),
    testQuantitySummary(projectId),
  ]);
  tests.push(crossingResult, componentResult);

  // Test 4: Terminations (skipped if no test utility)
  if (testUtilityName) {
    tests.push(await testTerminations(projectId, testUtilityName));
  } else {
    tests.push({
      testName:    'termination_points',
      passed:       true,
      legacyResult: null,
      graphResult:  null,
      mismatchReason: 'Skipped — no test utility found in project.',
      matchScore:   1.0,
    });
  }

  tests.push(summaryResult);

  const passedCount    = tests.filter((t) => t.passed).length;
  const overallPassRate = passedCount / tests.length;
  const failedTests    = tests.filter((t) => !t.passed).map((t) => t.testName);

  console.log(
    `[Graph Validator] Results: ${passedCount}/${tests.length} passed (${(overallPassRate * 100).toFixed(0)}%)`
  );
  if (failedTests.length > 0) {
    console.warn(`[Graph Validator] Failed tests: ${failedTests.join(', ')}`);
    for (const t of tests.filter((t) => !t.passed)) {
      console.warn(`  ${t.testName}: ${t.mismatchReason}`);
    }
  }

  return {
    projectId,
    timestamp,
    testUtilityName,
    tests,
    overallPassRate,
    failedTests,
  };
}

// ---------------------------------------------------------------------------
// Convenience: log a human-readable report summary
// ---------------------------------------------------------------------------

export function formatValidationReport(report: ValidationReport): string {
  const lines: string[] = [
    `═══════════════════════════════════════════════════════`,
    `  Phase 2 Graph Validation Report`,
    `  Project:  ${report.projectId}`,
    `  Utility:  ${report.testUtilityName ?? '(none)'}`,
    `  At:       ${report.timestamp}`,
    `  Result:   ${(report.overallPassRate * 100).toFixed(0)}% passed (${report.tests.filter((t) => t.passed).length}/${report.tests.length})`,
    `───────────────────────────────────────────────────────`,
  ];

  for (const t of report.tests) {
    const icon = t.passed ? '✓' : '✗';
    lines.push(`  ${icon} ${t.testName.padEnd(30)} score=${t.matchScore.toFixed(2)}`);
    if (!t.passed && t.mismatchReason) {
      lines.push(`      → ${t.mismatchReason}`);
    }
  }

  lines.push(`═══════════════════════════════════════════════════════`);
  return lines.join('\n');
}
