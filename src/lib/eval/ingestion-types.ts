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

export interface NormalizationMetrics {
  removedLineCount: number
  prefixStrippedLineCount: number
  patternsDetected: number
  warnings: string[]
}

export interface SourceBreakdownEntry {
  count: number
  sdCoverage: number
  avgConfidence: number
}

export interface SourceSelectionHarnessResult {
  selectedSource: 'narrative' | 'dd_form' | 'hybrid'
  reason: string
  selectedItemCount: number
  selectedSdCoverage: number
  selectedAuthorityCoverage: number
  ddFormItemCount: number
  narrativeItemCount: number
  warnings: string[]
  sourceBreakdown: {
    dd_form:     SourceBreakdownEntry
    narrative:   SourceBreakdownEntry
    hybrid_fill: SourceBreakdownEntry
  }
}

export interface DDFormHarnessResult {
  detected: boolean
  pagesDetected: number
  rowsExtracted: number
  rowsWithSpecSection: number
  uniquePairs: number
  sdCoverage: number            // always 100% since we only create rows when SD code found
  uniqueSpecSections: number
  parseWarnings: number
  recommendedSource: 'dd_form' | 'narrative'
}

export interface LineReconstructionMetrics {
  pagesProcessed: number
  rawTextItemCount: number
  reconstructedLineCount: number
  averageLineLength: number
  maxLineLength: number
  longLineCount: number
  beforeMaxLineLength: number
  beforeLongLineCount: number
}

export interface NearbySdMetrics {
  sdCodeOnlyLinesDetected: number
  forwardAssociations: number
  backwardAssociations: number
  ambiguousAssociations: number
  skippedDueToInline: number     // nearby found but inline code already present — inline kept
  skippedMultiCandidate: number  // window had multiple candidate items — association skipped
  skippedBoundary: number        // scan terminated by page-break / heading before any candidate
  // Block association (populated for reconstructed_pdf / ufgs mode)
  blockHeadersDetected: number
  blockAssociations: number
  blockSkippedDueToInline: number
  blockTerminatedByBoundary: number
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

  // Normalization metrics (populated when normalization was applied)
  normalization?: NormalizationMetrics

  // Nearby SD code association metrics (populated for PDF files)
  nearbySd?: NearbySdMetrics

  // Line reconstruction metrics (populated when visual line reconstruction was applied)
  lineReconstruction?: LineReconstructionMetrics

  // DD-form appendix parse result (populated when UFGS submittal register detected)
  ddForm?: DDFormHarnessResult

  // Source selection result (populated for PDF files)
  sourceSelection?: SourceSelectionHarnessResult

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
