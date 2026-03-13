/**
 * Evaluation harness types — test case schema, scoring, and reporting.
 *
 * Disciplines covered: civil, structural, architectural, demolition, MEP
 * Question classes:    simple_retrieval, enumeration, measurement, global
 *
 * Pipeline:
 *   benchmark-cases → runner → scorer → reporter
 */

import type { AiTrace } from '@/lib/chat/types'

// ---------------------------------------------------------------------------
// Question classification
// ---------------------------------------------------------------------------

/**
 * Mirrors the Type A/B/C/D classification used in sheet-verifier, but
 * names them semantically for human-readable test authoring.
 *
 *   simple_retrieval  = Type A  — single-fact lookup, skip verification
 *   enumeration       = Type B  — "list all X" across sheets
 *   measurement       = Type C  — dimension / quantity with units
 *   global            = Type D  — cross-sheet reasoning / scope summary
 */
export type QuestionClass =
  | 'simple_retrieval'
  | 'enumeration'
  | 'measurement'
  | 'global'

/** Construction document discipline being tested. */
export type EvalDiscipline =
  | 'civil'
  | 'structural'
  | 'architectural'
  | 'demolition'
  | 'mep'

// ---------------------------------------------------------------------------
// Test case
// ---------------------------------------------------------------------------

/**
 * A single evaluation test case.
 *
 * `expectedAnswer` is intentionally flexible — the scorer checks
 * `answerContains` / `answerExcludes` patterns rather than exact match.
 */
export interface EvalTestCase {
  /** Unique stable identifier (e.g. "civil-B-001"). */
  id: string
  /** Human-readable description of what this case tests. */
  description: string
  discipline: EvalDiscipline
  questionClass: QuestionClass

  /** The question as a user would type it. */
  question: string

  /**
   * Project fixture to run this test against.
   * If null, the test runner uses the default configured project.
   */
  projectId: string | null

  // --- Expected answer characteristics ---

  /** Substrings / patterns that MUST appear in the answer (case-insensitive). */
  answerContains: string[]
  /** Substrings / patterns that MUST NOT appear in the answer (hallucination check). */
  answerExcludes: string[]

  /**
   * Sheet numbers that should be cited in the answer.
   * Evaluated as "at least one of these must appear".
   */
  expectedCitations: string[]

  /**
   * Minimum expected citation count.
   * Useful for enumeration queries ("list all storm drain structures").
   */
  minCitationCount?: number

  // --- Verification behavior ---

  /**
   * Expected query type classification (A/B/C/D).
   * If provided, the harness checks that the pipeline classified it correctly.
   */
  expectedQueryType?: 'A' | 'B' | 'C' | 'D'

  /**
   * Expected coverage status after verification.
   * If provided, the harness checks that this matched.
   */
  expectedCoverageStatus?: 'complete' | 'partial' | 'insufficient'

  /**
   * Whether it is acceptable for the AI to refuse or heavily hedge.
   * Set true when the expected answer is "we don't have enough data".
   */
  guardedRefusalAcceptable: boolean

  /**
   * When true, a hallucinated answer (invents data not in documents)
   * is treated as a critical failure rather than a regular failure.
   */
  hallucinationIsCritical: boolean

  // --- Metadata ---

  /** Tags for grouping and filtering (e.g. "cross-sheet", "match-line"). */
  tags: string[]

  /** Brief note explaining the tricky aspect of this test. */
  traps?: string
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** The five scoring dimensions. */
export type ScoreDimension =
  | 'factual_correctness'
  | 'citation_correctness'
  | 'coverage_behavior'
  | 'hallucination_avoidance'
  | 'refusal_appropriateness'

export interface DimensionScore {
  dimension: ScoreDimension
  passed: boolean
  score: number        // 0.0 – 1.0
  details: string      // human-readable explanation of why pass/fail
  critical: boolean    // true for hallucination critical cases
}

/** Composite score for one test case run. */
export interface EvalScore {
  testId: string
  passed: boolean          // true only if ALL non-waived dimensions pass
  totalScore: number       // average of dimension scores
  dimensions: DimensionScore[]
  /**
   * Whether the model issued a guarded refusal.
   * Inferred from presence of hedging language in the response.
   */
  issuedGuardedRefusal: boolean
}

// ---------------------------------------------------------------------------
// Failure mode taxonomy
// ---------------------------------------------------------------------------

/**
 * Root-cause category for a failed test case.
 * Used by the reporter to bucket failures and surface systemic issues.
 */
export type FailureRootCause =
  | 'indexing'          // Data wasn't in DB — extraction / ingest problem
  | 'narrowing'         // Candidate sheet selection missed the right sheets
  | 'page_reading'      // Plan reader ran but misread the sheet
  | 'synthesis'         // Evidence was present but LLM drew wrong conclusion
  | 'citation'          // Answer was correct but citations were wrong / missing
  | 'hallucination'     // Model invented data not present in documents
  | 'over_refusal'      // Model refused when sufficient evidence was available
  | 'under_refusal'     // Model answered when it should have refused
  | 'classification'    // Query was mis-classified (wrong answer mode / type)
  | 'unknown'

export interface FailureMode {
  testId: string
  dimension: ScoreDimension
  rootCause: FailureRootCause
  description: string
  /** Pipeline stage where the failure likely originated. */
  failureStage: 'query_analyzer' | 'retrieval' | 'verification' | 'plan_reader' | 'reasoning' | 'response_writer' | 'unknown'
}

// ---------------------------------------------------------------------------
// Instrumentation
// ---------------------------------------------------------------------------

/**
 * Per-test-case instrumentation snapshot captured from the pipeline trace.
 * Populated by the runner after each test.
 */
export interface EvalInstrumentation {
  testId: string
  /** Pipeline trace from X-AI-Trace header (if debugAi=true). */
  trace: AiTrace | null
  /** Was verifyBeforeAnswering() triggered? */
  verificationRan: boolean
  /** Type A/B/C/D classification the pipeline assigned. */
  pipelineQueryType: 'A' | 'B' | 'C' | 'D' | null
  /** Candidate sheet count from verifier. */
  candidateSheetCount: number
  /** Inspected sheet count from verifier. */
  inspectedSheetCount: number
  /** Coverage status from verifier. */
  coverageStatus: string | null
  /** Did the plan reader run? */
  planReaderRan: boolean
  /** Pages inspected by plan reader. */
  planReaderPages: string[]
  /** Plan reader findings count. */
  planReaderFindingCount: number
  /** Final sufficiency level. */
  sufficiencyLevel: string
  /** Raw response text (first 2000 chars). */
  responseSnippet: string
  /** Full response text for detailed analysis. */
  responseText: string
  /** Response latency in ms. */
  latencyMs: number
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * A single execution of one test case — combines the score, instrumentation,
 * and any detected failure mode.
 */
export interface EvalResult {
  testCase: EvalTestCase
  score: EvalScore
  instrumentation: EvalInstrumentation
  failureModes: FailureMode[]
  runAt: string  // ISO timestamp
}

/** Configuration for a complete evaluation run. */
export interface EvalRunConfig {
  /** Optional name for this run (e.g. "main-branch-pre-release"). */
  name?: string
  /** Subset of test IDs to run. If omitted, all tests are run. */
  testIds?: string[]
  /** Disciplines to include. If omitted, all disciplines are run. */
  disciplines?: EvalDiscipline[]
  /** Question classes to include. If omitted, all classes are run. */
  questionClasses?: QuestionClass[]
  /** Project ID to use when test case has null projectId. */
  defaultProjectId: string
  /** Whether to enable debug AI trace. */
  debugAi?: boolean
  /** Concurrency limit (default: 3 to avoid rate limits). */
  concurrency?: number
}

/** A complete evaluation run summary. */
export interface EvalRun {
  runId: string
  config: EvalRunConfig
  results: EvalResult[]
  startedAt: string
  completedAt: string
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Per-discipline breakdown for the summary report. */
export interface DisciplineBreakdown {
  discipline: EvalDiscipline
  totalCases: number
  passed: number
  failed: number
  passRate: number
  avgScore: number
  /** Most common failure root cause in this discipline. */
  dominantFailureCause: FailureRootCause | null
  failedCaseIds: string[]
}

/** Per-question-class breakdown. */
export interface ClassBreakdown {
  questionClass: QuestionClass
  totalCases: number
  passed: number
  passRate: number
  avgScore: number
}

/** Per-dimension breakdown. */
export interface DimensionBreakdown {
  dimension: ScoreDimension
  passRate: number
  avgScore: number
  failedCaseIds: string[]
}

/** Failure root cause frequency. */
export interface RootCauseBreakdown {
  rootCause: FailureRootCause
  count: number
  affectedCaseIds: string[]
}

/** Complete evaluation report generated by reporter. */
export interface EvalSummary {
  runId: string
  generatedAt: string

  // --- Top-line metrics ---
  totalCases: number
  passed: number
  failed: number
  passRate: number
  avgScore: number
  criticalFailures: number  // hallucination_critical failures

  // --- Breakdowns ---
  byDiscipline: DisciplineBreakdown[]
  byClass: ClassBreakdown[]
  byDimension: DimensionBreakdown[]
  byRootCause: RootCauseBreakdown[]

  // --- Narrative findings ---
  mostCommonFailureMode: FailureRootCause | null
  disciplineWithMostFailures: EvalDiscipline | null
  /** Top 5 failure summaries for the report header. */
  topFailures: Array<{
    testId: string
    discipline: EvalDiscipline
    questionClass: QuestionClass
    failureDimension: ScoreDimension
    rootCause: FailureRootCause
    description: string
  }>
  /** Actionable recommendations derived from failure patterns. */
  recommendations: string[]
}
