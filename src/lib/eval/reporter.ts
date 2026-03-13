/**
 * Reporter — generates human-readable evaluation reports from run results.
 *
 * Produces:
 *   - EvalSummary object (structured, suitable for JSON serialization)
 *   - Console-formatted text report block
 *   - Failure mode analysis with root cause breakdown
 */

import type {
  EvalRun,
  EvalSummary,
  EvalResult,
  DisciplineBreakdown,
  ClassBreakdown,
  DimensionBreakdown,
  RootCauseBreakdown,
  EvalDiscipline,
  QuestionClass,
  ScoreDimension,
  FailureRootCause,
} from './types'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build a complete EvalSummary from a finished EvalRun. */
export function buildSummary(run: EvalRun): EvalSummary {
  const { results } = run

  const passed = results.filter(r => r.score.passed).length
  const failed = results.length - passed
  const avgScore = results.reduce((s, r) => s + r.score.totalScore, 0) / results.length
  const criticalFailures = results.filter(r =>
    r.score.dimensions.some(d => d.critical && !d.passed)
  ).length

  return {
    runId: run.runId,
    generatedAt: new Date().toISOString(),
    totalCases: results.length,
    passed,
    failed,
    passRate: Math.round((passed / results.length) * 1000) / 10,
    avgScore: Math.round(avgScore * 100) / 100,
    criticalFailures,
    byDiscipline: buildDisciplineBreakdowns(results),
    byClass: buildClassBreakdowns(results),
    byDimension: buildDimensionBreakdowns(results),
    byRootCause: buildRootCauseBreakdowns(results),
    mostCommonFailureMode: findMostCommonRootCause(results),
    disciplineWithMostFailures: findWeakestDiscipline(results),
    topFailures: buildTopFailures(results),
    recommendations: buildRecommendations(results),
  }
}

/** Emit a human-readable report block to the console. */
export function printReport(summary: EvalSummary): void {
  const lines = formatReport(summary)
  console.log(lines.join('\n'))
}

/** Format the report as an array of lines (useful for saving to file). */
export function formatReport(summary: EvalSummary): string[] {
  const lines: string[] = []
  const bar = '═'.repeat(66)
  const thin = '─'.repeat(66)

  lines.push('')
  lines.push(`╔${bar}╗`)
  lines.push(`║${'  EVALUATION REPORT'.padEnd(66)}║`)
  lines.push(`╚${bar}╝`)
  lines.push('')

  lines.push(`  Run ID     : ${summary.runId}`)
  lines.push(`  Generated  : ${summary.generatedAt}`)
  lines.push('')
  lines.push(thin)

  // Top-line
  lines.push('')
  lines.push('  ── Overall ──')
  lines.push(`  Cases      : ${summary.totalCases}  (passed: ${summary.passed}  failed: ${summary.failed})`)
  lines.push(`  Pass rate  : ${summary.passRate}%`)
  lines.push(`  Avg score  : ${summary.avgScore}`)
  lines.push(`  Critical   : ${summary.criticalFailures} hallucination failures`)
  lines.push('')

  // By discipline
  lines.push(thin)
  lines.push('')
  lines.push('  ── By Discipline ──')
  lines.push(`  ${'Discipline'.padEnd(16)} ${'Cases'.padEnd(7)} ${'Pass'.padEnd(7)} ${'Rate'.padEnd(8)} ${'AvgScore'.padEnd(10)} Dominant Failure`)
  for (const d of summary.byDiscipline) {
    lines.push(
      `  ${d.discipline.padEnd(16)} ${String(d.totalCases).padEnd(7)} ${String(d.passed).padEnd(7)} ` +
      `${`${d.passRate}%`.padEnd(8)} ${String(d.avgScore).padEnd(10)} ${d.dominantFailureCause ?? '—'}`
    )
  }
  lines.push('')

  // By question class
  lines.push(thin)
  lines.push('')
  lines.push('  ── By Question Class ──')
  lines.push(`  ${'Class'.padEnd(20)} ${'Cases'.padEnd(7)} ${'Pass'.padEnd(7)} ${'Rate'.padEnd(8)} AvgScore`)
  for (const c of summary.byClass) {
    lines.push(
      `  ${c.questionClass.padEnd(20)} ${String(c.totalCases).padEnd(7)} ${String(c.passed).padEnd(7)} ` +
      `${`${c.passRate}%`.padEnd(8)} ${c.avgScore}`
    )
  }
  lines.push('')

  // By dimension
  lines.push(thin)
  lines.push('')
  lines.push('  ── By Scoring Dimension ──')
  lines.push(`  ${'Dimension'.padEnd(28)} ${'Pass rate'.padEnd(12)} Avg score`)
  for (const d of summary.byDimension) {
    lines.push(`  ${d.dimension.padEnd(28)} ${`${d.passRate}%`.padEnd(12)} ${d.avgScore}`)
  }
  lines.push('')

  // Root cause breakdown
  lines.push(thin)
  lines.push('')
  lines.push('  ── Failure Root Causes ──')
  for (const rc of summary.byRootCause) {
    if (rc.count === 0) continue
    lines.push(`  ${rc.rootCause.padEnd(22)} ${rc.count} failures   cases: ${rc.affectedCaseIds.join(', ')}`)
  }
  lines.push('')

  // Top failures
  if (summary.topFailures.length > 0) {
    lines.push(thin)
    lines.push('')
    lines.push('  ── Top Failures ──')
    for (const f of summary.topFailures) {
      lines.push(`  [${f.testId}] ${f.discipline}/${f.questionClass} — ${f.rootCause} — ${f.description}`)
    }
    lines.push('')
  }

  // Recommendations
  if (summary.recommendations.length > 0) {
    lines.push(thin)
    lines.push('')
    lines.push('  ── Recommendations ──')
    for (const rec of summary.recommendations) {
      lines.push(`  ▸  ${rec}`)
    }
    lines.push('')
  }

  lines.push(`${'═'.repeat(68)}`)
  lines.push('')

  return lines
}

// ---------------------------------------------------------------------------
// Breakdown builders
// ---------------------------------------------------------------------------

function buildDisciplineBreakdowns(results: EvalResult[]): DisciplineBreakdown[] {
  const disciplines: EvalDiscipline[] = ['civil', 'structural', 'architectural', 'demolition', 'mep']
  return disciplines.map(discipline => {
    const group = results.filter(r => r.testCase.discipline === discipline)
    if (group.length === 0) {
      return { discipline, totalCases: 0, passed: 0, failed: 0, passRate: 0, avgScore: 0, dominantFailureCause: null, failedCaseIds: [] }
    }

    const passed = group.filter(r => r.score.passed).length
    const failed = group.length - passed
    const avgScore = Math.round(group.reduce((s, r) => s + r.score.totalScore, 0) / group.length * 100) / 100
    const failedCaseIds = group.filter(r => !r.score.passed).map(r => r.testCase.id)
    const dominantFailureCause = findMostCommonRootCause(group)

    return {
      discipline,
      totalCases: group.length,
      passed,
      failed,
      passRate: Math.round((passed / group.length) * 1000) / 10,
      avgScore,
      dominantFailureCause,
      failedCaseIds,
    }
  })
}

function buildClassBreakdowns(results: EvalResult[]): ClassBreakdown[] {
  const classes: QuestionClass[] = ['simple_retrieval', 'enumeration', 'measurement', 'global']
  return classes.map(questionClass => {
    const group = results.filter(r => r.testCase.questionClass === questionClass)
    if (group.length === 0) {
      return { questionClass, totalCases: 0, passed: 0, passRate: 0, avgScore: 0 }
    }

    const passed = group.filter(r => r.score.passed).length
    const avgScore = Math.round(group.reduce((s, r) => s + r.score.totalScore, 0) / group.length * 100) / 100

    return {
      questionClass,
      totalCases: group.length,
      passed,
      passRate: Math.round((passed / group.length) * 1000) / 10,
      avgScore,
    }
  })
}

function buildDimensionBreakdowns(results: EvalResult[]): DimensionBreakdown[] {
  const dimensions: ScoreDimension[] = [
    'factual_correctness',
    'citation_correctness',
    'coverage_behavior',
    'hallucination_avoidance',
    'refusal_appropriateness',
  ]

  return dimensions.map(dimension => {
    const dimScores = results.map(r => r.score.dimensions.find(d => d.dimension === dimension)).filter(Boolean)
    if (dimScores.length === 0) {
      return { dimension, passRate: 0, avgScore: 0, failedCaseIds: [] }
    }

    const passed = dimScores.filter(d => d!.passed).length
    const avgScore = Math.round(dimScores.reduce((s, d) => s + d!.score, 0) / dimScores.length * 100) / 100
    const failedCaseIds = results
      .filter(r => r.score.dimensions.find(d => d.dimension === dimension && !d.passed))
      .map(r => r.testCase.id)

    return {
      dimension,
      passRate: Math.round((passed / dimScores.length) * 1000) / 10,
      avgScore,
      failedCaseIds,
    }
  })
}

function buildRootCauseBreakdowns(results: EvalResult[]): RootCauseBreakdown[] {
  const causes: FailureRootCause[] = [
    'indexing', 'narrowing', 'page_reading', 'synthesis',
    'citation', 'hallucination', 'over_refusal', 'under_refusal',
    'classification', 'unknown',
  ]

  return causes.map(rootCause => {
    const affected = results.filter(r =>
      r.failureModes.some(f => f.rootCause === rootCause)
    )
    return {
      rootCause,
      count: affected.length,
      affectedCaseIds: affected.map(r => r.testCase.id),
    }
  }).filter(rc => rc.count > 0)
}

function findMostCommonRootCause(results: EvalResult[]): FailureRootCause | null {
  const counts: Record<string, number> = {}
  for (const r of results) {
    for (const f of r.failureModes) {
      counts[f.rootCause] = (counts[f.rootCause] ?? 0) + 1
    }
  }

  let max = 0
  let dominant: FailureRootCause | null = null
  for (const [cause, count] of Object.entries(counts)) {
    if (count > max) {
      max = count
      dominant = cause as FailureRootCause
    }
  }

  return dominant
}

function findWeakestDiscipline(results: EvalResult[]): EvalDiscipline | null {
  const disciplines: EvalDiscipline[] = ['civil', 'structural', 'architectural', 'demolition', 'mep']
  let lowestPassRate = Infinity
  let weakest: EvalDiscipline | null = null

  for (const discipline of disciplines) {
    const group = results.filter(r => r.testCase.discipline === discipline)
    if (group.length === 0) continue

    const passed = group.filter(r => r.score.passed).length
    const passRate = passed / group.length
    if (passRate < lowestPassRate) {
      lowestPassRate = passRate
      weakest = discipline
    }
  }

  return weakest
}

function buildTopFailures(results: EvalResult[]) {
  const failures = results.filter(r => !r.score.passed)
  return failures.slice(0, 5).map(r => {
    const worstDim = r.score.dimensions.filter(d => !d.passed).sort((a, b) => a.score - b.score)[0]
    const worstMode = r.failureModes[0]

    return {
      testId: r.testCase.id,
      discipline: r.testCase.discipline,
      questionClass: r.testCase.questionClass,
      failureDimension: worstDim?.dimension ?? 'factual_correctness',
      rootCause: worstMode?.rootCause ?? 'unknown',
      description: worstMode?.description ?? worstDim?.details ?? '',
    }
  })
}

function buildRecommendations(results: EvalResult[]): string[] {
  const recs: string[] = []
  const allModes = results.flatMap(r => r.failureModes)

  const countByCause = (cause: FailureRootCause) =>
    allModes.filter(m => m.rootCause === cause).length

  if (countByCause('indexing') >= 2) {
    recs.push('Multiple indexing failures detected — review vision extraction pipeline for missing entity types')
  }
  if (countByCause('narrowing') >= 2) {
    recs.push('Sheet narrower is missing candidate sheets — review signal weights and expansion strategy')
  }
  if (countByCause('page_reading') >= 2) {
    recs.push('Plan reader misread pages — consider increasing image scale or narrowing inspection prompt scope')
  }
  if (countByCause('hallucination') >= 1) {
    recs.push('Hallucination detected — review response-writer system prompt authority hierarchy')
  }
  if (countByCause('over_refusal') >= 2) {
    recs.push('Model over-refusing — check coverage status upgrade path in chat-handler.ts and evidence-evaluator hard gate thresholds')
  }
  if (countByCause('classification') >= 2) {
    recs.push('Query mis-classification — review query-classifier patterns for affected question types')
  }
  if (countByCause('citation') >= 2) {
    recs.push('Citation failures — ensure response-writer is injecting verification footer for Type B/C/D queries')
  }

  const worstClass = results
    .filter(r => !r.score.passed)
    .reduce((acc, r) => {
      acc[r.testCase.questionClass] = (acc[r.testCase.questionClass] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

  const worstClassName = Object.entries(worstClass).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (worstClassName === 'enumeration') {
    recs.push('Enumeration queries performing poorly — verify sheet-verifier covers all relevant sheets for Type B queries')
  }
  if (worstClassName === 'measurement') {
    recs.push('Measurement queries performing poorly — check quantity aggregation logic and unit handling in evidence formatting')
  }
  if (worstClassName === 'global') {
    recs.push('Global queries performing poorly — consider increasing candidate sheet limit for Type D queries')
  }

  if (recs.length === 0) {
    recs.push('No systemic issues detected — continue monitoring individual failure cases')
  }

  return recs
}
