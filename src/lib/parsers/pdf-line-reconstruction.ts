/**
 * Visual line reconstruction for PDF.js text extraction.
 *
 * PDF.js returns text as flat arrays of positioned items. The default join
 * (items.join(' ')) collapses each page into a single blob line of 1000–3000
 * characters, which breaks downstream line-level extraction logic.
 *
 * groupPdfTextItemsIntoLines() reconstructs visual lines from item X/Y
 * coordinates — same Y = same line, sort by X = reading order.
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'
import path from 'path'

if (typeof window === 'undefined') {
  const workerPath = path.join(
    process.cwd(),
    'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
  )
  pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${workerPath}`
}

export interface LineReconstructionMetrics {
  pagesProcessed: number
  rawTextItemCount: number
  reconstructedLineCount: number
  averageLineLength: number
  // After reconstruction
  maxLineLength: number
  longLineCount: number       // lines > 300 chars
  // Before reconstruction (old blob-per-page behavior for comparison)
  beforeMaxLineLength: number
  beforeLongLineCount: number // pages with blob > 300 chars
}

export interface LineReconstructedDocument {
  text: string
  pageCount: number
  metadata: {
    filename: string
    fileType: string
    parsingTime: number
  }
  lineMetrics: LineReconstructionMetrics
}

interface PositionedItem {
  str: string
  x: number
  y: number
  width: number
}

/**
 * Group raw PDF.js textContent.items into visual lines.
 *
 * Items on the same visual line share similar Y coordinates (within yTolerance).
 * Within each line, items are sorted left-to-right by X position.
 * A space is inserted between items where there is a visible gap.
 *
 * Returns reconstructed lines and the raw item count (for metrics).
 */
export function groupPdfTextItemsIntoLines(
  textItems: any[],
  options: { yTolerance?: number } = {}
): { lines: string[]; rawItemCount: number } {
  const yTolerance = options.yTolerance ?? 3

  // Filter to real text items and extract position data
  // PDF.js transform matrix: [sx, shy, shx, sy, tx, ty]
  //   tx = transform[4] = x position (left edge)
  //   ty = transform[5] = y position (baseline, PDF coords: bottom-up, so higher = higher on page)
  const positioned: PositionedItem[] = []
  for (const item of textItems) {
    if (
      typeof item !== 'object' ||
      !('str' in item) ||
      !Array.isArray(item.transform) ||
      item.transform.length < 6 ||
      item.str.length === 0
    ) {
      continue
    }
    positioned.push({
      str: item.str,
      x: item.transform[4] as number,
      y: item.transform[5] as number,
      width: typeof item.width === 'number' ? item.width : 0,
    })
  }

  if (positioned.length === 0) {
    return { lines: [], rawItemCount: 0 }
  }

  // Sort top-to-bottom (higher PDF y = higher on page = sort descending)
  positioned.sort((a, b) => b.y - a.y)

  // Group consecutive items where |y - groupBaseline| <= yTolerance
  const lineGroups: PositionedItem[][] = []
  let currentGroup: PositionedItem[] = []
  let groupBaselineY = 0

  for (const item of positioned) {
    if (currentGroup.length === 0) {
      currentGroup = [item]
      groupBaselineY = item.y
    } else if (Math.abs(item.y - groupBaselineY) <= yTolerance) {
      currentGroup.push(item)
    } else {
      lineGroups.push(currentGroup)
      currentGroup = [item]
      groupBaselineY = item.y
    }
  }
  if (currentGroup.length > 0) lineGroups.push(currentGroup)

  // Within each group, sort by X ascending, then build the line string
  const lines: string[] = []
  for (const group of lineGroups) {
    group.sort((a, b) => a.x - b.x)

    let line = ''
    for (let i = 0; i < group.length; i++) {
      const item = group[i]
      if (i === 0) {
        line = item.str
        continue
      }
      const prev = group[i - 1]
      const prevEndX = prev.x + prev.width
      const gap = item.x - prevEndX

      // Insert a space when there is a visible gap and no existing whitespace border
      const needsSpace =
        gap > 1 &&
        !line.endsWith(' ') &&
        !item.str.startsWith(' ')

      line += (needsSpace ? ' ' : '') + item.str
    }

    const trimmed = line.trim()
    if (trimmed.length > 0) lines.push(trimmed)
  }

  return { lines, rawItemCount: positioned.length }
}

/**
 * Parse a PDF file using visual line reconstruction instead of per-page blob joining.
 *
 * Returns the same page-break format as parseDocumentWithPdfJs
 * (pages separated by '\n\n---PAGE-BREAK---\n\n') so downstream
 * normalization and extraction logic is unchanged.
 *
 * lineMetrics includes before/after comparison values.
 */
export async function parseDocumentWithLineReconstruction(
  filePath: string,
  fileName: string,
  options: { yTolerance?: number } = {}
): Promise<LineReconstructedDocument> {
  const startTime = Date.now()

  const { readFile } = await import('fs/promises')
  const fileBuffer = await readFile(filePath)
  const uint8Array = new Uint8Array(fileBuffer)

  const loadingTask = pdfjsLib.getDocument({
    data: uint8Array,
    verbosity: 0,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  })

  const pdfDocument = await loadingTask.promise
  const pageCount = pdfDocument.numPages

  let totalRawItems = 0
  let beforeMaxLineLength = 0
  let beforeLongLineCount = 0
  const pageTexts: string[] = []

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdfDocument.getPage(pageNum)
    const textContent = await page.getTextContent()

    // "Before" metric: what the old join would produce for this page
    const oldJoinedLine = textContent.items
      .filter((item: any) => 'str' in item)
      .map((item: any) => item.str)
      .join(' ')
    if (oldJoinedLine.length > beforeMaxLineLength) beforeMaxLineLength = oldJoinedLine.length
    if (oldJoinedLine.length > 300) beforeLongLineCount++

    const { lines, rawItemCount } = groupPdfTextItemsIntoLines(textContent.items, options)
    totalRawItems += rawItemCount
    pageTexts.push(lines.join('\n'))
  }

  const fullText = pageTexts.join('\n\n---PAGE-BREAK---\n\n')

  // Compute after-metrics from reconstructed text
  const allLines = fullText
    .split('\n')
    .filter(l => l.trim().length > 0 && l.trim() !== '---PAGE-BREAK---')
  const lineLengths = allLines.map(l => l.length)
  const maxLineLength = lineLengths.length > 0 ? Math.max(...lineLengths) : 0
  const longLineCount = lineLengths.filter(l => l > 300).length
  const totalLen = lineLengths.reduce((s, l) => s + l, 0)
  const averageLineLength =
    lineLengths.length > 0 ? Math.round(totalLen / lineLengths.length) : 0
  const reconstructedLineCount = lineLengths.length

  return {
    text: fullText,
    pageCount,
    metadata: {
      filename: fileName,
      fileType: 'pdf',
      parsingTime: Date.now() - startTime,
    },
    lineMetrics: {
      pagesProcessed: pageCount,
      rawTextItemCount: totalRawItems,
      reconstructedLineCount,
      averageLineLength,
      maxLineLength,
      longLineCount,
      beforeMaxLineLength,
      beforeLongLineCount,
    },
  }
}
