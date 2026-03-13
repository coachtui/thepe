/**
 * Scorer — evaluates a test case result against expected outcomes.
 *
 * Five scoring dimensions:
 *   1. factual_correctness     — required substrings present, excluded substrings absent
 *   2. citation_correctness    — expected sheet citations appeared
 *   3. coverage_behavior       — verification coverage matched expectation
 *   4. hallucination_avoidance — excluded substrings, model didn't invent data
 *   5. refusal_appropriateness — guarded refusal when required / not refused when not
 */

import type {
  EvalTestCase,
  EvalScore,
  DimensionScore,
  EvalInstrumentation,
  FailureMode,
  FailureRootCause,
  ScoreDimension,
} from './types'

// ---------------------------------------------------------------------------
// Patterns used to detect guarded refusals
// ---------------------------------------------------------------------------

const REFUSAL_PATTERNS = [
  /i (cannot|can't|am unable to) (find|confirm|verify|determine|answer)/i,
  /not (enough|sufficient) (information|evidence|data)/i,
  /no (information|data|evidence) (available|found|present)/i,
  /based on (the|available) documents.{0,60}(cannot|unable)/i,
  /the (documents|plans|sheets) do not (contain|show|include)/i,
  /i (don't|do not) have (enough|sufficient|the)/i,
  /i (would|can't) (recommend|advise) (verifying|checking)/i,
  /field verification (is|would be) (required|recommended)/i,
  /please (verify|confirm) (on site|in the field)/i,
  /insufficient (evidence|data|information)/i,
]

// Phrases that indicate the model invented data rather than citing documents
const HALLUCINATION_RISK_PATTERNS = [
  /typically (is|are|would be)/i,
  /standard(ly)? (requires|specifies|uses)/i,
  /commonly (used|specified|required)/i,
  /in (most|typical) (cases|projects)/i,
  /generally (speaking|required|used)/i,
  /industry (standard|practice) (is|requires)/i,
  /based on (best practices|industry standards)/i,
  /assumes?.*not shown/i,
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score one test case execution against the expected outcomes.
 * Returns a composite `EvalScore` and any `FailureMode` objects detected.
 */
export function scoreResult(
  testCase: EvalTestCase,
  instrumentation: EvalInstrumentation,
): { score: EvalScore; failureModes: FailureMode[] } {
  const response = instrumentation.responseText.toLowerCase()
  const issuedGuardedRefusal = detectGuardedRefusal(instrumentation.responseText)

  const dimensions: DimensionScore[] = [
    scoreFactualCorrectness(testCase, instrumentation, response),
    scoreCitationCorrectness(testCase, instrumentation, response),
    scoreCoverageBehavior(testCase, instrumentation),
    scoreHallucinationAvoidance(testCase, instrumentation, response),
    scoreRefusalAppropriateness(testCase, issuedGuardedRefusal),
  ]

  const totalScore = dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length
  const passed = dimensions.every(d => d.passed)

  const score: EvalScore = {
    testId: testCase.id,
    passed,
    totalScore: Math.round(totalScore * 100) / 100,
    dimensions,
    issuedGuardedRefusal,
  }

  const failureModes = deriveFailureModes(testCase, dimensions, instrumentation)

  return { score, failureModes }
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

function scoreFactualCorrectness(
  tc: EvalTestCase,
  instr: EvalInstrumentation,
  responseLower: string,
): DimensionScore {
  const missingRequired: string[] = []
  const presentExcluded: string[] = []

  for (const required of tc.answerContains) {
    if (!responseLower.includes(required.toLowerCase())) {
      missingRequired.push(required)
    }
  }

  for (const excluded of tc.answerExcludes) {
    if (responseLower.includes(excluded.toLowerCase())) {
      presentExcluded.push(excluded)
    }
  }

  // If the model issued a guarded refusal and that's acceptable, required
  // substrings are waived (the response is intentionally sparse).
  const refusalIssued = detectGuardedRefusal(instr.responseText)
  const requiredWaived = refusalIssued && tc.guardedRefusalAcceptable

  const requiredScore = requiredWaived || tc.answerContains.length === 0
    ? 1.0
    : 1.0 - (missingRequired.length / tc.answerContains.length)

  const excludedScore = tc.answerExcludes.length === 0
    ? 1.0
    : 1.0 - (presentExcluded.length / tc.answerExcludes.length)

  const score = (requiredScore + excludedScore) / 2
  const passed = missingRequired.length === 0 && presentExcluded.length === 0 || requiredWaived && presentExcluded.length === 0

  const details: string[] = []
  if (missingRequired.length > 0 && !requiredWaived) {
    details.push(`Missing required terms: ${missingRequired.join(', ')}`)
  }
  if (presentExcluded.length > 0) {
    details.push(`Contains excluded terms: ${presentExcluded.join(', ')}`)
  }
  if (passed) {
    details.push(requiredWaived ? 'Guarded refusal accepted — required terms waived' : 'All required terms present, no excluded terms')
  }

  return {
    dimension: 'factual_correctness',
    passed,
    score: Math.round(score * 100) / 100,
    details: details.join(' | ') || 'ok',
    critical: false,
  }
}

function scoreCitationCorrectness(
  tc: EvalTestCase,
  instr: EvalInstrumentation,
  responseLower: string,
): DimensionScore {
  if (tc.expectedCitations.length === 0 && (tc.minCitationCount ?? 0) === 0) {
    return {
      dimension: 'citation_correctness',
      passed: true,
      score: 1.0,
      details: 'No citation requirements specified',
      critical: false,
    }
  }

  // Check expected citation sheets
  const missingCitations: string[] = []
  for (const sheet of tc.expectedCitations) {
    if (!responseLower.includes(sheet.toLowerCase())) {
      missingCitations.push(sheet)
    }
  }

  // Check minimum citation count by looking for sheet-number-like patterns
  const citationMatches = responseLower.match(/\b([a-z]{1,3}-?\d{2,4}[a-z]?)\b/gi) ?? []
  const uniqueCitations = new Set(citationMatches.map(s => s.toUpperCase()))
  const minCitation = tc.minCitationCount ?? 0

  const hasMinCitations = uniqueCitations.size >= minCitation
  const hasExpectedCitations = missingCitations.length === 0

  const citationScore = tc.expectedCitations.length === 0
    ? (hasMinCitations ? 1.0 : 0.0)
    : (1.0 - (missingCitations.length / tc.expectedCitations.length)) * (hasMinCitations ? 1.0 : 0.5)

  const passed = hasExpectedCitations && hasMinCitations

  const details: string[] = []
  if (missingCitations.length > 0) details.push(`Missing citations: ${missingCitations.join(', ')}`)
  if (!hasMinCitations) details.push(`Expected ≥${minCitation} citations, found ${uniqueCitations.size}`)
  if (passed) details.push(`Citations ok (${uniqueCitations.size} sheet refs found)`)

  return {
    dimension: 'citation_correctness',
    passed,
    score: Math.round(citationScore * 100) / 100,
    details: details.join(' | ') || 'ok',
    critical: false,
  }
}

function scoreCoverageBehavior(
  tc: EvalTestCase,
  instr: EvalInstrumentation,
): DimensionScore {
  if (!tc.expectedQueryType && !tc.expectedCoverageStatus) {
    return {
      dimension: 'coverage_behavior',
      passed: true,
      score: 1.0,
      details: 'No coverage behavior requirements specified',
      critical: false,
    }
  }

  const issues: string[] = []

  // Query type classification check
  if (tc.expectedQueryType && instr.pipelineQueryType !== null) {
    if (instr.pipelineQueryType !== tc.expectedQueryType) {
      issues.push(`Query classified as Type ${instr.pipelineQueryType}, expected Type ${tc.expectedQueryType}`)
    }
  }

  // Coverage status check
  if (tc.expectedCoverageStatus && instr.coverageStatus !== null) {
    if (instr.coverageStatus !== tc.expectedCoverageStatus) {
      issues.push(`Coverage status was "${instr.coverageStatus}", expected "${tc.expectedCoverageStatus}"`)
    }
  }

  const passed = issues.length === 0
  const score = passed ? 1.0 : Math.max(0, 1.0 - (issues.length * 0.4))

  return {
    dimension: 'coverage_behavior',
    passed,
    score: Math.round(score * 100) / 100,
    details: passed ? 'Coverage behavior matched expectations' : issues.join(' | '),
    critical: false,
  }
}

function scoreHallucinationAvoidance(
  tc: EvalTestCase,
  _instr: EvalInstrumentation,
  responseLower: string,
): DimensionScore {
  const hallucinationSignals: string[] = []

  for (const pattern of HALLUCINATION_RISK_PATTERNS) {
    const match = responseLower.match(pattern)
    if (match) {
      hallucinationSignals.push(match[0])
    }
  }

  // Check if excluded terms appear (second pass for hallucination-specific check)
  for (const excluded of tc.answerExcludes) {
    if (responseLower.includes(excluded.toLowerCase())) {
      hallucinationSignals.push(`invented term: "${excluded}"`)
    }
  }

  const passed = hallucinationSignals.length === 0
  const score = passed ? 1.0 : Math.max(0, 1.0 - (hallucinationSignals.length * 0.25))

  return {
    dimension: 'hallucination_avoidance',
    passed,
    score: Math.round(score * 100) / 100,
    details: passed
      ? 'No hallucination signals detected'
      : `Hallucination signals: ${hallucinationSignals.slice(0, 3).join('; ')}`,
    critical: tc.hallucinationIsCritical && !passed,
  }
}

function scoreRefusalAppropriateness(
  tc: EvalTestCase,
  issuedGuardedRefusal: boolean,
): DimensionScore {
  if (tc.guardedRefusalAcceptable) {
    // Any outcome is fine — refusal or answer both acceptable
    return {
      dimension: 'refusal_appropriateness',
      passed: true,
      score: 1.0,
      details: 'Guarded refusal acceptable for this case',
      critical: false,
    }
  }

  // Refusal not acceptable: model should have answered
  if (issuedGuardedRefusal) {
    return {
      dimension: 'refusal_appropriateness',
      passed: false,
      score: 0.0,
      details: 'Model issued a guarded refusal but an answer was expected',
      critical: false,
    }
  }

  return {
    dimension: 'refusal_appropriateness',
    passed: true,
    score: 1.0,
    details: 'Model provided an answer as expected',
    critical: false,
  }
}

// ---------------------------------------------------------------------------
// Failure mode derivation
// ---------------------------------------------------------------------------

function deriveFailureModes(
  tc: EvalTestCase,
  dimensions: DimensionScore[],
  instr: EvalInstrumentation,
): FailureMode[] {
  const modes: FailureMode[] = []

  for (const dim of dimensions) {
    if (dim.passed) continue

    const rootCause = inferRootCause(tc, dim, instr)
    const stage = inferFailureStage(tc, dim, instr)

    modes.push({
      testId: tc.id,
      dimension: dim.dimension,
      rootCause,
      description: dim.details,
      failureStage: stage,
    })
  }

  return modes
}

function inferRootCause(
  tc: EvalTestCase,
  dim: DimensionScore,
  instr: EvalInstrumentation,
): FailureRootCause {
  if (dim.dimension === 'hallucination_avoidance') return 'hallucination'
  if (dim.dimension === 'refusal_appropriateness') {
    return detectGuardedRefusal(instr.responseText) ? 'over_refusal' : 'under_refusal'
  }
  if (dim.dimension === 'citation_correctness') return 'citation'

  if (dim.dimension === 'coverage_behavior') {
    if (tc.expectedQueryType && instr.pipelineQueryType !== tc.expectedQueryType) {
      return 'classification'
    }
    return 'narrowing'
  }

  // factual_correctness — try to infer deeper cause
  if (instr.sufficiencyLevel === 'insufficient') return 'indexing'
  if (instr.planReaderRan && instr.planReaderFindingCount === 0) return 'page_reading'
  if (instr.candidateSheetCount === 0) return 'narrowing'
  if (instr.sufficiencyLevel === 'partial') return 'synthesis'

  return 'unknown'
}

function inferFailureStage(
  _tc: EvalTestCase,
  dim: DimensionScore,
  instr: EvalInstrumentation,
): FailureMode['failureStage'] {
  if (dim.dimension === 'coverage_behavior') {
    if (instr.pipelineQueryType === null) return 'query_analyzer'
    return 'verification'
  }
  if (dim.dimension === 'hallucination_avoidance') return 'response_writer'
  if (dim.dimension === 'refusal_appropriateness') return 'reasoning'
  if (dim.dimension === 'citation_correctness') return 'response_writer'

  // factual_correctness
  if (instr.candidateSheetCount === 0) return 'retrieval'
  if (instr.planReaderRan && instr.planReaderFindingCount === 0) return 'plan_reader'
  if (instr.sufficiencyLevel === 'insufficient') return 'retrieval'
  return 'reasoning'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function detectGuardedRefusal(responseText: string): boolean {
  return REFUSAL_PATTERNS.some(p => p.test(responseText))
}
