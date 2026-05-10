import { parseDocumentWithLineReconstruction } from '../parsers/pdf-line-reconstruction.ts'
import { parseUfgsDDFormAppendix } from '../parsers/ufgs-submittal-register-parser.ts'
import { chooseSubmittalExtractionSource, computeSourceBreakdown } from '../ingestion/submittal-source-selector.ts'
import {
  extractSubmittalRegisterItemsFromText,
  isLikelySubmittalRequirement,
  shouldSuppressSubmittalCandidate,
  extractSdCode,
} from '../chat/submittal-register.ts'
import { extractSpecSections } from '../vision/spec-extractor.ts'
import { evaluateSubmittalCoverageQA, getSubmittalItemKey } from '../chat/submittal-coverage-qa.ts'
import { normalizeDocumentText } from '../ingestion/document-normalization.ts'
import { associateNearbySdCodes } from '../ingestion/nearby-sd-association.ts'
import { readFile } from 'fs/promises'
import path from 'path'
import { computeIngestionGrade } from './ingestion-types.ts'
import type { IngestionHarnessResult, IngestionSuspiciousRow, IngestionQABreakdown, NormalizationMetrics, NearbySdMetrics, LineReconstructionMetrics, DDFormHarnessResult, SourceSelectionHarnessResult } from './ingestion-types.ts'

// ---------------------------------------------------------------------------
// Per-file evaluation — no DB writes, no Supabase dependency
// ---------------------------------------------------------------------------

export async function evaluateIngestionFile(filePath: string): Promise<IngestionHarnessResult> {
  const fileName = path.basename(filePath)
  const t0 = Date.now()

  try {
    let text: string
    let pagesProcessed: number | null

    let normalization: NormalizationMetrics | undefined
    let nearbySd: NearbySdMetrics | undefined
    let lineReconstruction: LineReconstructionMetrics | undefined
    let ddForm: DDFormHarnessResult | undefined
    let sourceSelection: SourceSelectionHarnessResult | undefined
    let ddFormRowsForSelection: import('../parsers/ufgs-submittal-register-parser.ts').DDFormRow[] = []

    if (path.extname(filePath).toLowerCase() === '.txt') {
      text = await readFile(filePath, 'utf-8')
      pagesProcessed = null
    } else {
      // Visual line reconstruction: groups PDF.js text items by Y coordinate
      // so downstream line-level logic sees individual lines, not page blobs.
      const parsed = await parseDocumentWithLineReconstruction(filePath, fileName)
      pagesProcessed = parsed.pageCount
      lineReconstruction = parsed.lineMetrics

      // Normalize BEFORE extraction — strip repeated headers/footers/prefixes
      const norm = normalizeDocumentText(parsed.text)
      text = norm.cleanedText
      normalization = {
        removedLineCount:        norm.removedLineCount,
        prefixStrippedLineCount: norm.prefixStrippedLineCount,
        patternsDetected:        norm.removedPatterns.length,
        warnings:                norm.normalizationWarnings,
      }
    }

    // DD-form appendix parser (UFGS only, PDF files only).
    // Runs on normalized text so headers/footers are stripped first.
    if (lineReconstruction !== undefined) {
      const ddResult = parseUfgsDDFormAppendix(text)
      if (ddResult.isPresent) {
        ddFormRowsForSelection = ddResult.rows
        const uniqueSpecs = new Set(ddResult.rows.map(r => r.specSection).filter(Boolean)).size
        ddForm = {
          detected:            true,
          pagesDetected:       ddResult.pagesDetected,
          rowsExtracted:       ddResult.rows.length,
          rowsWithSpecSection: ddResult.rows.filter(r => r.specSection).length,
          uniquePairs:         ddResult.uniquePairs,
          sdCoverage:          100,
          uniqueSpecSections:  uniqueSpecs,
          parseWarnings:       ddResult.parseWarnings.length,
          recommendedSource:   ddResult.rows.length > 0 ? 'dd_form' : 'narrative',
        }
      } else {
        ddForm = {
          detected: false, pagesDetected: 0, rowsExtracted: 0,
          rowsWithSpecSection: 0, uniquePairs: 0, sdCoverage: 0,
          uniqueSpecSections: 0, parseWarnings: 0, recommendedSource: 'narrative',
        }
      }
    }

    // Nearby SD code association metrics (for harness reporting).
    // Use wider distance when text came from visual line reconstruction.
    {
      const allLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      const nearbyOpts = lineReconstruction !== undefined
        ? { mode: 'reconstructed_pdf' as const }
        : undefined
      const { associations, metrics } = associateNearbySdCodes(allLines, nearbyOpts)
      let skippedDueToInline = 0
      for (const [idx, _code] of associations) {
        const line = allLines[idx]
        if (line && extractSdCode(line) !== null) skippedDueToInline++
      }
      nearbySd = {
        sdCodeOnlyLinesDetected:   metrics.sdCodeOnlyLinesDetected,
        forwardAssociations:       metrics.forwardAssociations,
        backwardAssociations:      metrics.backwardAssociations,
        ambiguousAssociations:     metrics.ambiguousAssociations,
        skippedDueToInline,
        skippedMultiCandidate:     metrics.skippedMultiCandidate,
        skippedBoundary:           metrics.skippedBoundary,
        blockHeadersDetected:      metrics.blockHeadersDetected,
        blockAssociations:         metrics.blockAssociations,
        blockSkippedDueToInline:   metrics.blockSkippedDueToInline,
        blockTerminatedByBoundary: metrics.blockTerminatedByBoundary,
      }
    }

    // Count suppressed candidates (full-text approximation)
    const suppressedCandidateCount = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && isLikelySubmittalRequirement(l) && shouldSuppressSubmittalCandidate(l).suppress)
      .length

    // CSI section detection
    const specSections = extractSpecSections(text)
    const specSectionsDetected = specSections.length

    // Extract submittal items — per-section with context if sections found, otherwise full text.
    // Use wider nearby-SD window when text came from visual line reconstruction.
    const extractNearbyOpts = lineReconstruction !== undefined
      ? { mode: 'reconstructed_pdf' as const }
      : undefined

    let items: ReturnType<typeof extractSubmittalRegisterItemsFromText>

    if (specSections.length > 0) {
      const allItems: typeof items = []
      const seen = new Set<string>()

      for (let i = 0; i < specSections.length; i++) {
        const section = specSections[i]
        const nextStart = specSections[i + 1]?.startIndex ?? text.length
        const sectionText = text.slice(section.startIndex, nextStart)

        const sectionItems = extractSubmittalRegisterItemsFromText(
          sectionText,
          { specSection: section.sectionNumber, sectionTitle: section.sectionTitle },
          extractNearbyOpts
        )

        for (const item of sectionItems) {
          const key = item.dedupeKey ?? `${item.submittalItem}|${item.specSection ?? ''}`
          if (!seen.has(key)) {
            seen.add(key)
            allItems.push(item)
          }
        }
      }
      items = allItems
    } else {
      items = extractSubmittalRegisterItemsFromText(text, {}, extractNearbyOpts)
    }

    const extractedSubmittalCount = items.length

    // QA evaluation
    const qaResult = evaluateSubmittalCoverageQA({ items })

    // Map item key → finding types for suspicious row ranking
    const findingsByItemKey = new Map<string, string[]>()
    for (const finding of qaResult.findings) {
      for (const itemId of finding.affectedItemIds) {
        const arr = findingsByItemKey.get(itemId) ?? []
        arr.push(finding.type)
        findingsByItemKey.set(itemId, arr)
      }
    }

    const total = items.length

    const sdCodeCoverage =
      total === 0 ? 0 : (items.filter(i => i.sdCode).length / total) * 100

    const approvalAuthorityCoverage =
      total === 0 ? 0 : (items.filter(i => i.approvalAuthority).length / total) * 100

    // Source selection: choose between narrative and DD-form for PDF files
    if (lineReconstruction !== undefined) {
      const selResult = chooseSubmittalExtractionSource({
        narrativeItems:       items,
        ddFormRows:           ddFormRowsForSelection,
        narrativeSdCoverage:  round1(sdCodeCoverage),
      })
      const sel = selResult.selectedItems
      const selTotal = sel.length
      sourceSelection = {
        selectedSource:            selResult.selectedSource,
        reason:                    selResult.reason,
        selectedItemCount:         selTotal,
        selectedSdCoverage:        selTotal === 0 ? 0 : round1(sel.filter(i => i.sdCode).length / selTotal * 100),
        selectedAuthorityCoverage: selTotal === 0 ? 0 : round1(sel.filter(i => i.approvalAuthority).length / selTotal * 100),
        ddFormItemCount:           ddFormRowsForSelection.length,
        narrativeItemCount:        items.length,
        warnings:                  selResult.warnings,
        sourceBreakdown:           selResult.sourceBreakdown,
      }
    }

    const sourceExcerptCoverage =
      total === 0 ? 0 : (items.filter(i => i.sourceExcerpt || i.excerpt).length / total) * 100

    const duplicateCount = qaResult.findings
      .filter(f => f.type === 'duplicate_submittal')
      .reduce((sum, f) => sum + f.affectedItemIds.length, 0)

    const blockingRiskCount = items.filter(
      i => i.blockingRisk === 'medium' || i.blockingRisk === 'high'
    ).length

    const qaFindings: IngestionQABreakdown = {
      critical: qaResult.findings.filter(f => f.severity === 'critical').length,
      warning:  qaResult.findings.filter(f => f.severity === 'warning').length,
      info:     qaResult.findings.filter(f => f.severity === 'info').length,
      byType:   {},
    }
    for (const finding of qaResult.findings) {
      qaFindings.byType[finding.type] = (qaFindings.byType[finding.type] ?? 0) + 1
    }

    // Top 5 rows with highest finding density
    const topSuspiciousRows: IngestionSuspiciousRow[] = items
      .map((item, idx) => {
        const key = getSubmittalItemKey(item, idx)
        const findingTypes = findingsByItemKey.get(key) ?? []
        return { item, findingTypes }
      })
      .filter(({ findingTypes }) => findingTypes.length > 0)
      .sort((a, b) => b.findingTypes.length - a.findingTypes.length)
      .slice(0, 5)
      .map(({ item, findingTypes }) => ({
        submittalItem:  item.submittalItem,
        specSection:    item.specSection,
        sdCode:         item.sdCode ?? null,
        qaFindingTypes: findingTypes,
        reason:         findingTypes.join(', '),
      }))

    return {
      fileName,
      filePath,
      pagesProcessed,
      specSectionsDetected,
      extractedSubmittalCount,
      sdCodeCoverage:            round1(sdCodeCoverage),
      approvalAuthorityCoverage: round1(approvalAuthorityCoverage),
      sourceExcerptCoverage:     round1(sourceExcerptCoverage),
      duplicateCount,
      blockingRiskCount,
      qaFindings,
      suppressedCandidateCount,
      ...gradeFields({
        sdCodeCoverage:            round1(sdCodeCoverage),
        approvalAuthorityCoverage: round1(approvalAuthorityCoverage),
        suppressedCandidateCount,
        extractedSubmittalCount,
        qaFindingsCritical:        qaFindings.critical,
      }),
      parseDurationMs: Date.now() - t0,
      topSuspiciousRows,
      ...(normalization      !== undefined ? { normalization }      : {}),
      ...(nearbySd           !== undefined ? { nearbySd }           : {}),
      ...(lineReconstruction !== undefined ? { lineReconstruction } : {}),
      ...(ddForm             !== undefined ? { ddForm }             : {}),
      ...(sourceSelection    !== undefined ? { sourceSelection }    : {}),
    }
  } catch (err) {
    return {
      fileName,
      filePath,
      pagesProcessed:            null,
      specSectionsDetected:      0,
      extractedSubmittalCount:   0,
      sdCodeCoverage:            0,
      approvalAuthorityCoverage: 0,
      sourceExcerptCoverage:     0,
      duplicateCount:            0,
      blockingRiskCount:         0,
      qaFindings:                { critical: 0, warning: 0, info: 0, byType: {} },
      suppressedCandidateCount:  0,
      grade:                     'poor_extraction' as const,
      gradeReasons:              ['file failed to process'],
      parseDurationMs:           Date.now() - t0,
      topSuspiciousRows:         [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function gradeFields(metrics: Parameters<typeof computeIngestionGrade>[0]) {
  const { grade, reasons } = computeIngestionGrade(metrics)
  return { grade, gradeReasons: reasons }
}
