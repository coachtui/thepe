/**
 * PDF to Image Conversion Utility
 *
 * Converts PDF pages to PNG images for Claude Vision API analysis.
 * Optimized for construction plans with configurable resolution.
 */

// Polyfill for Promise.withResolvers (needed for pdfjs-dist on Node < 22)
if (typeof Promise.withResolvers === 'undefined') {
  // @ts-ignore
  Promise.withResolvers = function <T>() {
    let resolve: (value: T | PromiseLike<T>) => void;
    let reject: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve: resolve!, reject: reject! };
  };
}

// Use PDF.js with @napi-rs/canvas (its native Node.js canvas support)
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';

// Lazy-load @napi-rs/canvas to avoid webpack bundling issues
let napiCanvas: any = null;
async function getCanvas() {
  if (!napiCanvas) {
    // Dynamic import to avoid webpack bundling the native module
    napiCanvas = await import('@napi-rs/canvas');
  }
  return napiCanvas;
}

// Configure PDF.js worker for Node.js
const workerPath = path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;

/**
 * Configuration for PDF to image conversion
 */
export interface PdfToImageOptions {
  /**
   * Scale factor for rendering (1.0 = 72 DPI, 2.0 = 144 DPI, 3.0 = 216 DPI)
   * Higher values = better quality but larger file size and more processing time
   * Default: 2.0 (good balance for Claude Vision)
   */
  scale?: number;

  /**
   * Maximum width in pixels (will scale down if larger)
   * Claude Vision recommends max 2048px for cost optimization
   * Default: 2048
   */
  maxWidth?: number;

  /**
   * Maximum height in pixels (will scale down if larger)
   * Default: 2048
   */
  maxHeight?: number;

  /**
   * Output format
   * Default: 'png'
   */
  format?: 'png' | 'jpeg';

  /**
   * JPEG quality (0-100), only applies if format is 'jpeg'
   * Default: 90
   */
  quality?: number;
}

/**
 * Result of PDF page conversion
 */
export interface PdfPageImage {
  pageNumber: number;
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
}

/**
 * Convert a single PDF page to an image
 *
 * @param pdfBuffer - PDF file as Buffer
 * @param pageNumber - Page number (1-indexed)
 * @param options - Conversion options
 * @returns Image buffer and metadata
 */
export async function convertPdfPageToImage(
  pdfBuffer: Buffer,
  pageNumber: number,
  options: PdfToImageOptions = {}
): Promise<PdfPageImage> {
  const {
    scale = 2.0,
    maxWidth = 2048,
    maxHeight = 2048,
    format = 'png',
    quality = 90
  } = options;

  try {
    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      verbosity: 0 // Suppress console logs
    });

    const pdfDocument = await loadingTask.promise;

    // Validate page number
    if (pageNumber < 1 || pageNumber > pdfDocument.numPages) {
      throw new Error(`Invalid page number ${pageNumber}. PDF has ${pdfDocument.numPages} pages.`);
    }

    // Get the page
    const page = await pdfDocument.getPage(pageNumber);

    // Get viewport with scale
    let viewport = page.getViewport({ scale });

    // Check if we need to scale down to meet max dimensions
    let actualScale = scale;
    if (viewport.width > maxWidth || viewport.height > maxHeight) {
      const widthScale = maxWidth / viewport.width;
      const heightScale = maxHeight / viewport.height;
      const constraintScale = Math.min(widthScale, heightScale);
      actualScale = scale * constraintScale;
      viewport = page.getViewport({ scale: actualScale });
    }

    // Create canvas - ensure dimensions are valid integers
    const canvasWidth = Math.floor(viewport.width);
    const canvasHeight = Math.floor(viewport.height);

    if (canvasWidth <= 0 || canvasHeight <= 0) {
      throw new Error(`Invalid canvas dimensions: ${canvasWidth}x${canvasHeight}`);
    }

    // Lazy-load canvas module to avoid webpack bundling issues
    const canvasModule = await getCanvas();
    const canvas = canvasModule.createCanvas(canvasWidth, canvasHeight);
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Failed to get 2D context from canvas');
    }

    // Render PDF page to canvas - let PDF.js use its native Node.js support
    const renderContext = {
      canvasContext: context as any,
      viewport: viewport
    };

    try {
      await page.render(renderContext).promise;
    } catch (renderError) {
      console.error(`[PDF Render] Error rendering page ${pageNumber}:`, renderError);
      throw new Error(`Render failed: ${renderError instanceof Error ? renderError.message : 'Unknown render error'}`);
    }

    // Convert canvas to buffer
    let buffer: Buffer;
    if (format === 'jpeg') {
      buffer = canvas.toBuffer('image/jpeg', { quality: quality / 100 });
    } else {
      buffer = canvas.toBuffer('image/png');
    }

    // Clean up
    page.cleanup();
    await pdfDocument.destroy();

    return {
      pageNumber,
      buffer,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      format,
      sizeBytes: buffer.length
    };
  } catch (error) {
    throw new Error(`Failed to convert PDF page ${pageNumber} to image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert multiple PDF pages to images
 *
 * @param pdfBuffer - PDF file as Buffer
 * @param pageNumbers - Array of page numbers (1-indexed), or 'all' for all pages
 * @param options - Conversion options
 * @returns Array of image buffers and metadata
 */
export async function convertPdfPagesToImages(
  pdfBuffer: Buffer,
  pageNumbers: number[] | 'all',
  options: PdfToImageOptions = {}
): Promise<PdfPageImage[]> {
  try {
    // Load PDF to get page count
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      verbosity: 0
    });

    const pdfDocument = await loadingTask.promise;
    const totalPages = pdfDocument.numPages;
    await pdfDocument.destroy();

    // Determine which pages to convert
    const pagesToConvert = pageNumbers === 'all'
      ? Array.from({ length: totalPages }, (_, i) => i + 1)
      : pageNumbers;

    // Convert pages in parallel (with concurrency limit)
    const concurrency = 3; // Process 3 pages at a time to avoid memory issues
    const results: PdfPageImage[] = [];

    for (let i = 0; i < pagesToConvert.length; i += concurrency) {
      const batch = pagesToConvert.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(pageNum => convertPdfPageToImage(pdfBuffer, pageNum, options))
      );
      results.push(...batchResults);
    }

    return results;
  } catch (error) {
    throw new Error(`Failed to convert PDF pages to images: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Identify critical sheets in a PDF that should be processed with vision
 *
 * @param pdfBuffer - PDF file as Buffer
 * @param sheetNames - Array of sheet names/titles (extracted from PDF metadata or filenames)
 * @returns Array of page numbers that are likely critical sheets
 */
export async function identifyCriticalSheets(
  pdfBuffer: Buffer,
  sheetNames?: string[],
  maxSheets: number = 200
): Promise<number[]> {
  // Get PDF metadata to determine page count
  const metadata = await getPdfMetadata(pdfBuffer);
  const totalPages = metadata.numPages;

  // For small PDFs (<= 20 pages), process ALL pages
  if (totalPages <= 20) {
    console.log(`[Critical Sheets] PDF has ${totalPages} pages - processing ALL pages`);
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  // For medium PDFs (<= 100 pages), process ALL sheets (affordable and comprehensive)
  if (totalPages <= 100) {
    console.log(`[Critical Sheets] PDF has ${totalPages} pages - processing ALL pages (medium project)`);
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  // For MEGA PDFs (>100 pages), use strategic sampling
  console.log(`[Critical Sheets] PDF has ${totalPages} pages - using strategic sampling (max ${maxSheets} sheets)`);

  const criticalPages: Set<number> = new Set();

  // Always include first 10 and last 10 pages (index, summary, details, specs)
  for (let i = 1; i <= Math.min(10, totalPages); i++) {
    criticalPages.add(i);
  }
  for (let i = Math.max(totalPages - 9, 11); i <= totalPages; i++) {
    criticalPages.add(i);
  }

  // Sample every Nth page to get coverage across entire project
  // For 3000 pages with maxSheets=200: sample every ~15th page
  const remainingBudget = maxSheets - 20; // Reserve 20 for first/last pages
  const sampleInterval = Math.max(1, Math.floor((totalPages - 20) / remainingBudget));

  console.log(`[Critical Sheets] Sampling every ${sampleInterval} pages across middle section`);

  for (let i = 11; i < totalPages - 9; i += sampleInterval) {
    criticalPages.add(i);
    if (criticalPages.size >= maxSheets) break; // Don't exceed budget
  }

  // Prioritize sheets matching construction trade patterns (if sheet names provided)
  if (sheetNames && sheetNames.length > 0) {
    const tradePatterns = [
      /^CU\d+/i,   // Water line (CU = Construction Utilities)
      /^E-?\d+/i,  // Electrical
      /^S-?\d+/i,  // Structural or Sewer
      /^SD\d+/i,   // Storm Drain
      /^SS\d+/i,   // Sanitary Sewer
      /^STM\d+/i,  // Storm
      /^GR\d+/i,   // Grading
      /^FP\d+/i,   // Fire Protection
      /^W\d+/i,    // Water
      /^M-?\d+/i,  // Mechanical
      /^P-?\d+/i,  // Plumbing
      /^A-?\d+/i,  // Architectural
    ];

    sheetNames.forEach((name, index) => {
      const pageNum = index + 1;
      // Check if sheet matches any trade pattern
      if (tradePatterns.some(pattern => pattern.test(name))) {
        criticalPages.add(pageNum);
      }
    });
  }

  // Convert to sorted array and limit to maxSheets
  const sortedPages = Array.from(criticalPages).sort((a, b) => a - b).slice(0, maxSheets);

  console.log(`[Critical Sheets] Selected ${sortedPages.length} sheets for vision processing`);
  return sortedPages;
}

/**
 * Estimate cost of processing pages with Claude Vision
 *
 * Now uses Claude Haiku 4.5 by default (87% cheaper than Sonnet!)
 * @param images - Array of image metadata
 * @param useHaiku - Whether to use Haiku pricing (default: true for 87% cost savings)
 * @returns Estimated cost in USD
 */
export function estimateVisionCost(images: PdfPageImage[], useHaiku: boolean = true): number {
  // Claude Vision pricing (as of 2026):
  // Haiku 4.5: Input $0.40 per million tokens, Output $2.00 per million (DEFAULT - 87% cheaper!)
  // Sonnet 4.5: Input $3.00 per million tokens, Output $15.00 per million

  // Images are tokenized based on size:
  // - Images up to 200k pixels (e.g., 512x384): ~85 tokens
  // - Images 200k-500k pixels: ~170 tokens
  // - Images 500k-1M pixels: ~340 tokens
  // - Images 1M-2M pixels: ~680 tokens

  const INPUT_COST_PER_MILLION_TOKENS = useHaiku ? 0.40 : 3.0;
  const OUTPUT_COST_PER_MILLION_TOKENS = useHaiku ? 2.0 : 15.0;

  let totalInputTokens = 0;

  for (const image of images) {
    const pixels = image.width * image.height;
    let imageTokens: number;

    if (pixels <= 200_000) {
      imageTokens = 85;
    } else if (pixels <= 500_000) {
      imageTokens = 170;
    } else if (pixels <= 1_000_000) {
      imageTokens = 340;
    } else {
      imageTokens = 680;
    }

    totalInputTokens += imageTokens;
  }

  // Add estimated text tokens for the prompt (~1500 tokens for comprehensive extraction)
  totalInputTokens += 1500;

  // Estimate output tokens (~2000 tokens for structured JSON response)
  const totalOutputTokens = 2000 * images.length;

  const inputCost = (totalInputTokens / 1_000_000) * INPUT_COST_PER_MILLION_TOKENS;
  const outputCost = (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION_TOKENS;
  const totalCost = inputCost + outputCost;

  return totalCost;
}

/**
 * Helper to get PDF metadata (page count, etc.)
 *
 * @param pdfBuffer - PDF file as Buffer
 * @returns PDF metadata
 */
export async function getPdfMetadata(pdfBuffer: Buffer): Promise<{
  numPages: number;
  title?: string;
  author?: string;
  subject?: string;
}> {
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      verbosity: 0
    });

    const pdfDocument = await loadingTask.promise;
    const metadata = await pdfDocument.getMetadata();

    const info = metadata.info as any;
    const result = {
      numPages: pdfDocument.numPages,
      title: info?.Title,
      author: info?.Author,
      subject: info?.Subject
    };

    await pdfDocument.destroy();

    return result;
  } catch (error) {
    throw new Error(`Failed to get PDF metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Detect sheet type based on page content
 * Uses text extraction to identify key patterns
 *
 * @param pdfBuffer - PDF file as Buffer
 * @param pageNumber - Page number (1-indexed)
 * @returns Detected sheet type: 'title', 'summary', 'plan', 'profile', or 'unknown'
 */
export async function detectSheetType(
  pdfBuffer: Buffer,
  pageNumber: number
): Promise<'title' | 'summary' | 'plan' | 'profile' | 'unknown'> {
  try {
    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      verbosity: 0
    });

    const pdfDocument = await loadingTask.promise;

    // Validate page number
    if (pageNumber < 1 || pageNumber > pdfDocument.numPages) {
      await pdfDocument.destroy();
      return 'unknown';
    }

    // Get the page
    const page = await pdfDocument.getPage(pageNumber);

    // Extract text content
    const textContent = await page.getTextContent();
    const textItems = textContent.items as any[];

    // Concatenate all text into a single string (first 3000 chars for performance)
    const fullText = textItems
      .map(item => item.str || '')
      .join(' ')
      .toUpperCase()
      .slice(0, 3000);

    // Clean up
    page.cleanup();
    await pdfDocument.destroy();

    // Page 1 is usually title sheet
    if (pageNumber === 1) {
      return 'title';
    }

    // Detect based on keywords
    const patterns = {
      profile: /\b(PROFILE|ELEVATION|UTILITY\s+CROSSING|VERTICAL\s+ALIGNMENT|INVERT|RIM\s+ELEV)\b/i,
      plan: /\b(PLAN\s+VIEW|PLAN\s+SHEET|HORIZONTAL\s+ALIGNMENT|LAYOUT|SITE\s+PLAN)\b/i,
      summary: /\b(SUMMARY|QUANTITIES|GENERAL\s+NOTES|PROJECT\s+DATA|LEGEND|INDEX)\b/i
    };

    // Check patterns in order of priority
    if (patterns.profile.test(fullText)) {
      return 'profile';
    }
    if (patterns.plan.test(fullText)) {
      return 'plan';
    }
    if (patterns.summary.test(fullText)) {
      return 'summary';
    }

    // Default: pages 2-3 are likely summary, pages 4+ are likely plan/profile
    if (pageNumber <= 3) {
      return 'summary';
    }

    return 'unknown';

  } catch (error) {
    console.error(`[Sheet Type Detection] Error detecting sheet type for page ${pageNumber}:`, error);
    // Fallback to page-based heuristic
    if (pageNumber === 1) return 'title';
    if (pageNumber <= 3) return 'summary';
    return 'unknown';
  }
}
