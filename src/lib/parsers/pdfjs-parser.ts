/**
 * PDF.js-based PDF text extraction
 * Alternative to LlamaParse for construction drawings with small text
 *
 * PDF.js extracts ALL text regardless of font size, making it ideal
 * for construction plans with small callout boxes.
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createRequire } from 'module'

// Configure worker (Node.js environment)
// PDF.js requires a worker to parse PDFs
if (typeof window === 'undefined') {
  // Server-side: point to the actual worker file
  const require = createRequire(import.meta.url)
  pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs'
  )
}

export interface ParsedDocument {
  text: string
  pageCount: number
  metadata: {
    filename: string
    fileType: string
    parsingTime: number
  }
}

/**
 * Extract text from PDF using PDF.js
 * Extracts ALL text including small fonts in callout boxes
 */
export async function parseDocumentWithPdfJs(
  filePath: string,
  fileName: string
): Promise<ParsedDocument> {
  const startTime = Date.now()

  try {
    // Read file
    const fs = await import('fs')
    const { promisify } = await import('util')
    const readFile = promisify(fs.readFile)

    const fileBuffer = await readFile(filePath)
    const uint8Array = new Uint8Array(fileBuffer)

    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      verbosity: 0, // Suppress warnings
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    })

    const pdfDocument = await loadingTask.promise
    const pageCount = pdfDocument.numPages

    console.log(`[PDF.js] Extracting text from ${pageCount} pages...`)

    // Extract text from all pages
    const pageTexts: string[] = []

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDocument.getPage(pageNum)
      const textContent = await page.getTextContent()

      // Extract all text items
      // PDF.js returns text in reading order with position info
      const textItems = textContent.items
        .filter((item: any) => 'str' in item)
        .map((item: any) => item.str)

      const pageText = textItems.join(' ')

      pageTexts.push(pageText)

      console.log(`[PDF.js] Page ${pageNum}: ${pageText.length} characters, ${textItems.length} text items`)
    }

    // Combine all pages with page breaks
    const fullText = pageTexts.join('\n\n---PAGE-BREAK---\n\n')

    const parsingTime = Date.now() - startTime

    console.log(`[PDF.js] ✅ Extraction complete: ${fullText.length} characters in ${parsingTime}ms`)

    return {
      text: fullText,
      pageCount,
      metadata: {
        filename: fileName,
        fileType: 'pdf',
        parsingTime,
      },
    }
  } catch (error) {
    console.error('[PDF.js] Error:', error)
    throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Extract text from PDF URL
 */
export async function parseDocumentFromUrlWithPdfJs(
  url: string,
  fileName: string
): Promise<ParsedDocument> {
  const startTime = Date.now()

  try {
    // Download file
    console.log('[PDF.js] Downloading PDF from URL...')
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)

    console.log(`[PDF.js] Downloaded ${uint8Array.length} bytes`)

    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      verbosity: 0,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    })

    const pdfDocument = await loadingTask.promise
    const pageCount = pdfDocument.numPages

    console.log(`[PDF.js] PDF loaded: ${pageCount} pages`)

    // Extract text from all pages
    const pageTexts: string[] = []

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDocument.getPage(pageNum)
      const textContent = await page.getTextContent()

      // Extract all text items preserving order
      const textItems = textContent.items
        .filter((item: any) => 'str' in item)
        .map((item: any) => item.str)

      const pageText = textItems.join(' ')

      pageTexts.push(pageText)

      console.log(`[PDF.js] Page ${pageNum}: ${pageText.length} characters, ${textItems.length} text items`)

      // Log first page sample
      if (pageNum === 1) {
        console.log(`[PDF.js] First page sample: ${pageText.substring(0, 500)}...`)
      }
    }

    // Combine all pages
    const fullText = pageTexts.join('\n\n---PAGE-BREAK---\n\n')

    const parsingTime = Date.now() - startTime

    console.log(`[PDF.js] ✅ Extraction complete: ${fullText.length} characters in ${parsingTime}ms`)

    return {
      text: fullText,
      pageCount,
      metadata: {
        filename: fileName,
        fileType: 'pdf',
        parsingTime,
      },
    }
  } catch (error) {
    console.error('[PDF.js] Error:', error)
    throw new Error(`Failed to parse PDF from URL: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
