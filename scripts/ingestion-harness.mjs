#!/usr/bin/env node
/**
 * Ingestion Quality Harness
 *
 * Walks a folder of PDF/text spec fixtures, runs extraction + QA on each file,
 * and reports quality metrics per file plus an aggregate summary.
 *
 * No database writes. No Supabase dependency.
 *
 * Usage:
 *   npm run ingestion:harness
 *   npm run ingestion:harness -- --dir ./path/to/fixtures
 *   npm run ingestion:harness -- --csv
 */

import { evaluateIngestionFile } from '../src/lib/eval/ingestion-runner.ts'
import { computeIngestionGrade } from '../src/lib/eval/ingestion-types.ts'
import { readdir, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dirFlagIdx = args.indexOf('--dir')
const fixtureDir = dirFlagIdx !== -1 ? args[dirFlagIdx + 1] : './test-fixtures/specs'
const csvMode = args.includes('--csv')
const outputDir = './reports/ingestion-harness'

const HARNESS_VERSION = '1.0.0'

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

async function discoverFiles(dir) {
  if (!existsSync(dir)) {
    return []
  }
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && /\.(pdf|txt)$/i.test(e.name))
    .map(e => path.resolve(dir, e.name))
    .sort()
}

// ---------------------------------------------------------------------------
// Aggregate report builder
// ---------------------------------------------------------------------------

function buildReport(results) {
  const ok = results.filter(r => !r.error)
  const avg = arr => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length

  const totalQaFindings = ok.reduce(
    (sum, r) => sum + r.qaFindings.critical + r.qaFindings.warning + r.qaFindings.info,
    0
  )

  return {
    runAt:    new Date().toISOString(),
    fixtureDir: path.resolve(fixtureDir),
    version:  HARNESS_VERSION,

    totalFiles:           results.length,
    totalFilesWithErrors: results.filter(r => r.error).length,
    totalSubmittals:      ok.reduce((sum, r) => sum + r.extractedSubmittalCount, 0),

    avgSdCodeCoverage:            r1(avg(ok.map(r => r.sdCodeCoverage))),
    avgApprovalAuthorityCoverage: r1(avg(ok.map(r => r.approvalAuthorityCoverage))),
    avgSourceExcerptCoverage:     r1(avg(ok.map(r => r.sourceExcerptCoverage))),

    avgQaFindingsPerSpec: ok.length === 0 ? 0 : r1(totalQaFindings / ok.length),
    totalBlockingRiskCount:        ok.reduce((sum, r) => sum + r.blockingRiskCount, 0),
    totalDuplicateCount:           ok.reduce((sum, r) => sum + r.duplicateCount, 0),
    totalSuppressedCandidateCount: results.reduce((sum, r) => sum + (r.suppressedCandidateCount ?? 0), 0),

    avgParseDurationMs:   Math.round(avg(results.map(r => r.parseDurationMs))),
    totalParseDurationMs: results.reduce((sum, r) => sum + r.parseDurationMs, 0),

    ...runGradeFields(ok, results),

    results,
  }
}

function runGradeFields(ok, all) {
  const avg = arr => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length
  const totalSuppressed = all.reduce((sum, r) => sum + (r.suppressedCandidateCount ?? 0), 0)
  const totalItems      = ok.reduce((sum, r) => sum + r.extractedSubmittalCount, 0)
  const { grade, reasons } = computeIngestionGrade({
    sdCodeCoverage:            r1(avg(ok.map(r => r.sdCodeCoverage))),
    approvalAuthorityCoverage: r1(avg(ok.map(r => r.approvalAuthorityCoverage))),
    suppressedCandidateCount:  totalSuppressed,
    extractedSubmittalCount:   totalItems,
    qaFindingsCritical:        ok.reduce((sum, r) => sum + r.qaFindings.critical, 0),
  })
  return { runGrade: grade, runGradeReasons: reasons }
}

function r1(n) {
  return Math.round(n * 10) / 10
}

// ---------------------------------------------------------------------------
// Console table
// ---------------------------------------------------------------------------

const W = { file: 30, pg: 5, sect: 6, items: 7, supp: 6, norm: 8, sd: 7, auth: 7, src: 7, dup: 5, risk: 5, qa: 12, grade: 8, ms: 8 }

const GRADE_LABEL = {
  good:             'GOOD   ',
  needs_review:     'REVIEW ',
  poor_extraction:  'POOR   ',
}
const TOTAL_W = Object.values(W).reduce((a, b) => a + b, 0)
const HR = '─'.repeat(TOTAL_W)

function col(v, w) {
  return String(v ?? '').padEnd(w).slice(0, w)
}

function pct(n) { return `${Number(n).toFixed(1)}%` }

function normRmStr(norm) {
  if (!norm) return '—'
  const total = (norm.removedLineCount ?? 0) + (norm.prefixStrippedLineCount ?? 0)
  return total === 0 ? '—' : `${total}`
}

function printTable(report) {
  console.log('\n=== Ingestion Quality Harness ===\n')

  console.log(
    col('File',     W.file) +
    col('Pgs',      W.pg)   +
    col('Sects',    W.sect) +
    col('Items',    W.items)+
    col('Supp',     W.supp) +
    col('Norm-Rm',  W.norm) +
    col('SD%',      W.sd)   +
    col('Auth%',    W.auth) +
    col('Src%',     W.src)  +
    col('Dups',     W.dup)  +
    col('Risk',     W.risk) +
    col('QA C/W/I', W.qa)   +
    col('Grade',    W.grade)+
    col('ms',       W.ms)
  )
  console.log(HR)

  for (const r of report.results) {
    if (r.error) {
      console.log(col(r.fileName, W.file) + col('ERROR', W.pg + W.sect + W.items + W.supp + W.norm + W.sd + W.auth + W.src + W.dup + W.risk + W.qa + W.ms))
      console.log(`  ⚠ ${r.error.slice(0, 100)}`)
      continue
    }

    const qaStr = `${r.qaFindings.critical}/${r.qaFindings.warning}/${r.qaFindings.info}`

    console.log(
      col(r.fileName,                         W.file) +
      col(r.pagesProcessed ?? '—',            W.pg)   +
      col(r.specSectionsDetected,             W.sect) +
      col(r.extractedSubmittalCount,          W.items)+
      col(r.suppressedCandidateCount ?? 0,    W.supp) +
      col(normRmStr(r.normalization),         W.norm) +
      col(pct(r.sdCodeCoverage),              W.sd)   +
      col(pct(r.approvalAuthorityCoverage),   W.auth) +
      col(pct(r.sourceExcerptCoverage),       W.src)  +
      col(r.duplicateCount,                   W.dup)  +
      col(r.blockingRiskCount,                W.risk) +
      col(qaStr,                              W.qa)   +
      col(GRADE_LABEL[r.grade] ?? r.grade,   W.grade)+
      col(r.parseDurationMs + 'ms',           W.ms)
    )

    if (r.gradeReasons?.length > 0 && r.grade !== 'good') {
      console.log(`  → ${r.gradeReasons.join(' · ')}`)
    }
    if (r.normalization) {
      const { removedLineCount: rm, prefixStrippedLineCount: ps, patternsDetected: pd } = r.normalization
      if (pd > 0) {
        console.log(`  ✂ norm: ${pd} pattern(s) detected · ${rm} lines removed · ${ps} lines prefix-stripped`)
        for (const w of r.normalization.warnings) console.log(`    · ${w}`)
      }
    }
    for (const row of r.topSuspiciousRows.slice(0, 2)) {
      console.log(`  ⚑ ${row.submittalItem.slice(0, 65)} [${row.reason}]`)
    }
  }

  console.log(HR)

  const ok = report.results.filter(r => !r.error)
  if (ok.length > 0) {
    const label = `TOTAL (${report.totalFiles} files, ${report.totalFilesWithErrors} err)`
    console.log(
      col(label,                                       W.file) +
      col('',                                          W.pg)   +
      col('',                                          W.sect) +
      col(report.totalSubmittals,                      W.items)+
      col(report.totalSuppressedCandidateCount ?? 0,   W.supp) +
      col('',                                          W.norm) +
      col(pct(report.avgSdCodeCoverage),               W.sd)   +
      col(pct(report.avgApprovalAuthorityCoverage),    W.auth) +
      col(pct(report.avgSourceExcerptCoverage),        W.src)  +
      col(report.totalDuplicateCount,                  W.dup)  +
      col(report.totalBlockingRiskCount,               W.risk) +
      col(`avg ${report.avgQaFindingsPerSpec}`,        W.qa)   +
      col(GRADE_LABEL[report.runGrade] ?? report.runGrade, W.grade) +
      col(report.avgParseDurationMs + 'ms',            W.ms)
    )
  }

  console.log()

  // Run verdict banner
  const verdictMap = {
    good:            '✓  Run grade: GOOD — extraction quality looks solid.',
    needs_review:    '⚠  Run grade: NEEDS REVIEW — some metrics below target.',
    poor_extraction: '✗  Run grade: POOR EXTRACTION — spec set needs review before publishing the register.',
  }
  console.log(verdictMap[report.runGrade] ?? `Grade: ${report.runGrade}`)
  if (report.runGradeReasons?.length > 0) {
    for (const r of report.runGradeReasons) console.log(`   · ${r}`)
  }
  console.log()
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function buildCsv(report) {
  const headers = [
    'File Name', 'Pages', 'Spec Sections', 'Submittals',
    'SD Code %', 'Authority %', 'Source Excerpt %',
    'Duplicates', 'Blocking Risks',
    'QA Critical', 'QA Warning', 'QA Info',
    'Duration (ms)', 'Error',
  ]

  const rows = report.results.map(r => [
    r.fileName,
    r.pagesProcessed ?? '',
    r.specSectionsDetected,
    r.extractedSubmittalCount,
    r.error ? '' : r.sdCodeCoverage.toFixed(1),
    r.error ? '' : r.approvalAuthorityCoverage.toFixed(1),
    r.error ? '' : r.sourceExcerptCoverage.toFixed(1),
    r.error ? '' : r.duplicateCount,
    r.error ? '' : r.blockingRiskCount,
    r.error ? '' : r.qaFindings.critical,
    r.error ? '' : r.qaFindings.warning,
    r.error ? '' : r.qaFindings.info,
    r.parseDurationMs,
    r.error ?? '',
  ])

  const escape = cell => `"${String(cell).replace(/"/g, '""')}"`
  return [headers, ...rows].map(row => row.map(escape).join(',')).join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const files = await discoverFiles(fixtureDir)

  if (files.length === 0) {
    console.log(`[harness] No PDF or text files found in: ${path.resolve(fixtureDir)}`)
    console.log('[harness] Drop spec PDFs into that directory and rerun.')
    process.exit(0)
  }

  console.log(`[harness] ${files.length} file(s) found in ${fixtureDir}\n`)

  const results = []
  for (const filePath of files) {
    const name = path.basename(filePath)
    process.stdout.write(`  ${name} ... `)
    const result = await evaluateIngestionFile(filePath)
    if (result.error) {
      process.stdout.write(`ERROR: ${result.error.slice(0, 60)}\n`)
    } else {
      process.stdout.write(
        `${result.extractedSubmittalCount} items | ` +
        `${result.specSectionsDetected} sections | ` +
        `${result.parseDurationMs}ms\n`
      )
    }
    results.push(result)
  }

  const report = buildReport(results)

  printTable(report)

  await mkdir(outputDir, { recursive: true })

  const ts = new Date().toISOString().replace(/:/g, '-').slice(0, 19)
  const jsonPath    = path.join(outputDir, `${ts}.json`)
  const latestPath  = path.join(outputDir, 'latest.json')

  await writeFile(jsonPath,   JSON.stringify(report, null, 2))
  await writeFile(latestPath, JSON.stringify(report, null, 2))

  console.log(`[harness] Report: ${latestPath}`)

  if (csvMode) {
    const csvPath = path.join(outputDir, 'latest.csv')
    await writeFile(csvPath, buildCsv(report))
    console.log(`[harness] CSV:    ${csvPath}`)
  }

  console.log()
}

main().catch(err => {
  console.error('[harness] Fatal:', err)
  process.exit(1)
})
