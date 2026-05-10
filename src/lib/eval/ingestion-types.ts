export type IngestionGrade = 'good' | 'needs_review' | 'poor_extraction'

export interface IngestionGradeResult {
  grade: IngestionGrade
  reasons: string[]
}

/**
 * Pure threshold classifier. Apply to per-file metrics or aggregate run metrics.
 * Thresholds:
 *   poor_extraction — any of: SD% < 50, Auth% < 25, suppressed rate > 20%, critical QA > 0
 *   good            — SD% ≥ 70, Auth% ≥ 40, no criticals, suppressed rate ≤ 20%
 *   needs_review    — everything else
 */
export function computeIngestionGrade(metrics: {
  sdCodeCoverage: number
  approvalAuthorityCoverage: number
  suppressedCandidateCount: number
  extractedSubmittalCount: number
  qaFindingsCritical: number
}): IngestionGradeResult {
  const totalCandidates = metrics.extractedSubmittalCount + metrics.suppressedCandidateCount
  const suppressedRatio = totalCandidates > 0 ? metrics.suppressedCandidateCount / totalCandidates : 0
  const reasons: string[] = []

  if (metrics.sdCodeCoverage < 50)
    reasons.push(`SD coverage ${metrics.sdCodeCoverage.toFixed(1)}% < 50%`)
  if (metrics.approvalAuthorityCoverage < 25)
    reasons.push(`authority coverage ${metrics.approvalAuthorityCoverage.toFixed(1)}% < 25%`)
  if (suppressedRatio > 0.20)
    reasons.push(`suppressed rate ${(suppressedRatio * 100).toFixed(1)}% > 20%`)
  if (metrics.qaFindingsCritical > 0)
    reasons.push(`${metrics.qaFindingsCritical} critical QA finding${metrics.qaFindingsCritical === 1 ? '' : 's'}`)

  if (reasons.length > 0) return { grade: 'poor_extraction', reasons }

  if (metrics.sdCodeCoverage >= 70 && metrics.approvalAuthorityCoverage >= 40)
    return { grade: 'good', reasons: [] }

  return { grade: 'needs_review', reasons: [] }
}

export interface IngestionSuspiciousRow {
  submittalItem: string
  specSection: string | null
  sdCode: string | null
  qaFindingTypes: string[]
  reason: string
}

export interface IngestionQABreakdown {
  critical: number
  warning: number
  info: number
  byType: Record<string, number>
}

export interface IngestionHarnessResult {
  // File identity
  fileName: string
  filePath: string

  // Extraction
  pagesProcessed: number | null
  specSectionsDetected: number
  extractedSubmittalCount: number

  // Coverage percentages (0–100)
  sdCodeCoverage: number
  approvalAuthorityCoverage: number
  sourceExcerptCoverage: number

  // Quality
  duplicateCount: number
  blockingRiskCount: number
  qaFindings: IngestionQABreakdown

  // Hygiene
  suppressedCandidateCount: number

  // Grade
  grade: IngestionGrade
  gradeReasons: string[]

  // Performance
  parseDurationMs: number

  // Top rows with highest QA finding density
  topSuspiciousRows: IngestionSuspiciousRow[]

  // Set when file failed to process
  error?: string
}

// Shape-stable for future hybrid mode — this is the row written to test_runs table.
export interface IngestionHarnessReport {
  runAt: string           // ISO 8601
  fixtureDir: string
  version: string         // harness semver

  totalFiles: number
  totalFilesWithErrors: number
  totalSubmittals: number

  // Averages across non-error files
  avgSdCodeCoverage: number
  avgApprovalAuthorityCoverage: number
  avgSourceExcerptCoverage: number

  avgQaFindingsPerSpec: number
  totalBlockingRiskCount: number
  totalDuplicateCount: number
  totalSuppressedCandidateCount: number

  avgParseDurationMs: number
  totalParseDurationMs: number

  // Overall run grade derived from aggregate metrics
  runGrade: IngestionGrade
  runGradeReasons: string[]

  results: IngestionHarnessResult[]
}
