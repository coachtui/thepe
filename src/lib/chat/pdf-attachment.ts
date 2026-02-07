/**
 * PDF Attachment Helper for Direct Document Analysis
 *
 * Instead of converting PDFs to images, this module prepares PDFs
 * for direct attachment to Claude. Claude can read PDFs natively,
 * which is more reliable than image conversion for construction plans.
 */

import { createClient } from '@/lib/db/supabase/server';

/**
 * Document info from database
 */
interface DocumentInfo {
  id: string;
  filename: string;
  file_path: string;
  sheet_number?: string | null;
  document_type?: string | null;
}

/**
 * PDF attachment ready for Claude
 */
export interface PdfAttachment {
  filename: string;
  sheetNumber: string;
  base64: string;
  sizeBytes: number;
}

/**
 * Result of getting PDF attachments
 */
export interface PdfAttachmentResult {
  success: boolean;
  attachments: PdfAttachment[];
  documentsIncluded: string[];
  error?: string;
  totalSizeBytes: number;
}

/**
 * Sheet number patterns for common utility disciplines
 * Used to intelligently select relevant documents for a query
 */
const UTILITY_SHEET_PATTERNS: Record<string, RegExp[]> = {
  'water': [/^CU/i, /^W/i, /^WL/i, /water/i, /^DW/i],
  'sewer': [/^SS/i, /^S-/i, /sewer/i, /sanitary/i],
  'storm': [/^SD/i, /^STM/i, /storm/i, /drain/i],
  'fire': [/^FP/i, /^FL/i, /fire/i],
  'electrical': [/^E-/i, /^EL/i, /elec/i],
  'grading': [/^GR/i, /^EW/i, /grad/i, /earthwork/i],
  'structural': [/^S-/i, /^STR/i, /struct/i, /footings?/i, /found/i, /^F-/i],
  'architectural': [/^A-/i, /^ARCH/i, /floor.*plan/i, /building/i, /^B-/i],
  'mechanical': [/^M-/i, /^MECH/i, /hvac/i, /^H-/i],
  'plumbing': [/^P-/i, /^PLB/i, /plumb/i],
  'site': [/^C-/i, /^SITE/i, /civil/i, /demo/i, /site.*work/i],
  'landscape': [/^L-/i, /^LS/i, /^LNDS/i, /landscape/i, /irrigation/i],
};

/**
 * Score a document's relevance to a query based on filename/sheet patterns
 */
function scoreDocumentRelevance(
  doc: DocumentInfo,
  utilityName?: string,
  sheetHints?: string[]
): number {
  let score = 0;
  const filename = doc.filename.toLowerCase();
  const sheetNum = (doc.sheet_number || doc.filename.replace('.pdf', '')).toLowerCase();

  // If we have specific sheet hints (e.g., ["CU102", "CU103"]), match those
  if (sheetHints && sheetHints.length > 0) {
    for (const hint of sheetHints) {
      if (sheetNum.includes(hint.toLowerCase()) || filename.includes(hint.toLowerCase())) {
        score += 100; // Exact sheet match - highest priority
      }
    }
  }

  // Match utility type from name
  if (utilityName) {
    const utilLower = utilityName.toLowerCase();

    // Determine which utility type patterns to use
    for (const [utilType, patterns] of Object.entries(UTILITY_SHEET_PATTERNS)) {
      if (utilLower.includes(utilType)) {
        for (const pattern of patterns) {
          if (pattern.test(sheetNum) || pattern.test(filename)) {
            score += 50; // Utility type match
            break;
          }
        }
      }
    }

    // Direct name match in filename
    if (filename.includes(utilLower.replace(/\s+/g, '')) ||
        filename.includes(utilLower)) {
      score += 30;
    }
  }

  // Deprioritize general/non-utility sheets
  const generalPatterns = [/^GC/i, /^GN/i, /^G-/i, /^T-/i, /^TC/i, /^INDEX/i, /^TOC/i, /^COVER/i];
  for (const pattern of generalPatterns) {
    if (pattern.test(sheetNum) || pattern.test(filename)) {
      score -= 20; // Penalty for general sheets
    }
  }

  // Small boost for construction/utility sheets in general
  const constructionPatterns = [/^C-/i, /^CU/i, /^CP/i];
  for (const pattern of constructionPatterns) {
    if (pattern.test(sheetNum)) {
      score += 5;
    }
  }

  return score;
}

/**
 * Extract sheet number hints from a user query
 * e.g., "sheets CU102 through CU109" → ["CU102", "CU103", ..., "CU109"]
 */
function extractSheetHintsFromQuery(query: string): string[] {
  const hints: string[] = [];

  // Match explicit sheet references like "CU102-CU109" or "CU102 through CU109"
  const rangeMatch = query.match(/([A-Z]{1,3}\d{1,4})\s*(?:-|to|through)\s*([A-Z]{1,3}\d{1,4})/i);
  if (rangeMatch) {
    const prefix = rangeMatch[1].replace(/\d+$/, '');
    const startNum = parseInt(rangeMatch[1].replace(/^[A-Z]+/i, ''));
    const endNum = parseInt(rangeMatch[2].replace(/^[A-Z]+/i, ''));
    if (!isNaN(startNum) && !isNaN(endNum) && endNum >= startNum && (endNum - startNum) < 50) {
      for (let i = startNum; i <= endNum; i++) {
        hints.push(`${prefix}${i}`);
      }
    }
  }

  // Match individual sheet references like "sheet CU102" or "CU102"
  const sheetMatches = query.matchAll(/\b([A-Z]{1,3}\d{2,4})\b/gi);
  for (const match of sheetMatches) {
    if (!hints.includes(match[1].toUpperCase())) {
      hints.push(match[1].toUpperCase());
    }
  }

  return hints;
}

/**
 * Get project documents as PDF attachments for Claude
 *
 * Uses intelligent document selection based on query context:
 * 1. Scores each document by relevance to the utility/system being queried
 * 2. Prioritizes utility-specific sheets (CU* for water, SS* for sewer, etc.)
 * 3. Deprioritizes general notes, title sheets, etc.
 *
 * @param projectId - Project ID
 * @param maxDocuments - Maximum number of documents (default: 8)
 * @param systemFilter - Optional filter for utility system (e.g., "Water Line A")
 * @param userQuery - Optional user query for intelligent sheet selection
 * @returns PDF attachments ready for Claude
 */
export async function getProjectPdfAttachments(
  projectId: string,
  maxDocuments: number = 8,
  systemFilter?: string,
  userQuery?: string
): Promise<PdfAttachmentResult> {
  const supabase = await createClient();

  try {
    // Get ALL documents for this project (we'll score and filter ourselves)
    const { data: documents, error } = await supabase
      .from('documents')
      .select('id, filename, file_path, sheet_number, document_type')
      .eq('project_id', projectId)
      .order('filename');

    if (error) {
      console.error('[PDF Attachment] Error fetching documents:', error);
      return {
        success: false,
        attachments: [],
        documentsIncluded: [],
        error: `Failed to fetch documents: ${error.message}`,
        totalSizeBytes: 0
      };
    }

    if (!documents || documents.length === 0) {
      return {
        success: false,
        attachments: [],
        documentsIncluded: [],
        error: 'No documents found for this project',
        totalSizeBytes: 0
      };
    }

    // Filter to PDF documents only
    const pdfDocuments = documents.filter(
      (doc) => doc.filename.toLowerCase().endsWith('.pdf')
    );

    if (pdfDocuments.length === 0) {
      return {
        success: false,
        attachments: [],
        documentsIncluded: [],
        error: 'No PDF documents found',
        totalSizeBytes: 0
      };
    }

    // Extract sheet hints from the user query
    const sheetHints = userQuery ? extractSheetHintsFromQuery(userQuery) : [];

    // Score and rank documents by relevance
    const scoredDocs = pdfDocuments.map(doc => ({
      doc,
      score: scoreDocumentRelevance(doc, systemFilter, sheetHints)
    }));

    // Sort by score descending, then by filename for stable ordering
    scoredDocs.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.doc.filename.localeCompare(b.doc.filename);
    });

    // Take top N documents
    const docsToProcess = scoredDocs.slice(0, maxDocuments).map(s => s.doc);

    console.log(`[PDF Attachment] Document selection (${pdfDocuments.length} total, ${docsToProcess.length} selected):`);

    // Warn if we're truncating relevant documents
    if (pdfDocuments.length > maxDocuments) {
      const skippedDocs = pdfDocuments.length - maxDocuments;
      const relevantSkipped = scoredDocs.slice(maxDocuments).filter(s => s.score > 0).length;
      if (relevantSkipped > 0) {
        console.warn(`⚠️ [PDF Attachment] Large plan set: ${skippedDocs} sheets not analyzed (${relevantSkipped} appear relevant)`);
        console.warn(`   Consider increasing maxDocuments or narrowing query scope`);
      }
    }

    scoredDocs.slice(0, maxDocuments).forEach(s => {
      console.log(`  ${s.doc.filename} → score: ${s.score}`);
    });

    console.log(
      `[PDF Attachment] Processing ${docsToProcess.length} PDF documents for project ${projectId}`
    );

    // Download and convert each document
    const attachments: PdfAttachment[] = [];
    let totalSizeBytes = 0;
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file (Anthropic limit)
    const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25 MB total (safe limit for 32MB API max)

    for (const doc of docsToProcess) {
      try {
        // Download PDF from storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('documents')
          .download(doc.file_path);

        if (downloadError || !fileData) {
          console.error(
            `[PDF Attachment] Error downloading ${doc.filename}:`,
            downloadError
          );
          continue;
        }

        // Convert to base64
        const arrayBuffer = await fileData.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Check individual file size
        if (buffer.length > MAX_FILE_SIZE) {
          console.warn(
            `[PDF Attachment] Skipping ${doc.filename} - too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB > 5 MB limit)`
          );
          console.warn(
            `   Large multi-page PDFs should be split into individual sheets for accurate analysis`
          );
          continue;
        }

        // Check total size budget
        if (totalSizeBytes + buffer.length > MAX_TOTAL_SIZE) {
          console.warn(
            `[PDF Attachment] Stopping at ${attachments.length} PDFs - reached ${(totalSizeBytes / 1024 / 1024).toFixed(1)} MB size budget`
          );
          break;
        }

        const base64 = buffer.toString('base64');

        attachments.push({
          filename: doc.filename,
          sheetNumber: doc.sheet_number || doc.filename.replace('.pdf', ''),
          base64,
          sizeBytes: buffer.length
        });

        totalSizeBytes += buffer.length;

        console.log(
          `[PDF Attachment] Added ${doc.filename} (${(buffer.length / 1024).toFixed(0)} KB)`
        );
      } catch (err) {
        console.error(`[PDF Attachment] Error processing ${doc.filename}:`, err);
      }
    }

    if (attachments.length === 0) {
      return {
        success: false,
        attachments: [],
        documentsIncluded: [],
        error: 'Failed to process any PDF documents',
        totalSizeBytes: 0
      };
    }

    console.log(
      `[PDF Attachment] Ready: ${attachments.length} PDFs, total ${(totalSizeBytes / 1024 / 1024).toFixed(2)} MB`
    );

    return {
      success: true,
      attachments,
      documentsIncluded: attachments.map((a) => a.sheetNumber),
      totalSizeBytes
    };
  } catch (error) {
    console.error('[PDF Attachment] Error:', error);
    return {
      success: false,
      attachments: [],
      documentsIncluded: [],
      error: error instanceof Error ? error.message : 'Unknown error',
      totalSizeBytes: 0
    };
  }
}

/**
 * Build message content with PDF attachments for Claude
 *
 * Creates a message array with PDFs attached as documents and the user query.
 * Claude can read these PDFs directly without image conversion.
 *
 * @param attachments - PDF attachments from getProjectPdfAttachments
 * @param userQuery - User's question
 * @returns Message content array for Claude API
 */
export function buildMessageWithPdfAttachments(
  attachments: PdfAttachment[],
  userQuery: string
): Array<
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
> {
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  > = [];

  // Add each PDF as a document attachment
  for (const attachment of attachments) {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: attachment.base64
      }
    });
  }

  // Add document labels and the user query
  const docLabels = attachments
    .map((a, i) => `Document ${i + 1}: ${a.sheetNumber}`)
    .join('\n');

  content.push({
    type: 'text',
    text: `**Construction Plan Documents Attached:**\n${docLabels}\n\n**Your Question:** ${userQuery}`
  });

  return content;
}

/**
 * Identify relevant documents for a query
 *
 * Uses query analysis to determine which documents are most relevant.
 * For "valves on water line A" → find water line sheets
 *
 * @param query - User's question
 * @param projectId - Project ID
 * @returns Array of document IDs to include
 */
export async function identifyRelevantDocuments(
  query: string,
  projectId: string
): Promise<string[]> {
  const supabase = await createClient();

  // Extract system name from query
  const systemPatterns = [
    /water\s*line\s*['"]?([a-z])?['"]?/i,
    /sewer\s*['"]?([a-z])?['"]?/i,
    /storm\s*drain\s*['"]?([a-z])?['"]?/i,
    /electric(al)?\s*['"]?([a-z])?['"]?/i
  ];

  let systemFilter: string | undefined;

  for (const pattern of systemPatterns) {
    const match = query.match(pattern);
    if (match) {
      if (/water/i.test(query)) {
        systemFilter = match[1] ? `Water Line ${match[1].toUpperCase()}` : 'Water';
      } else if (/sewer/i.test(query)) {
        systemFilter = match[1] ? `Sewer ${match[1].toUpperCase()}` : 'Sewer';
      } else if (/storm/i.test(query)) {
        systemFilter = match[1] ? `Storm Drain ${match[1].toUpperCase()}` : 'Storm';
      }
      break;
    }
  }

  // Get documents, optionally filtered by system
  let query_builder = supabase
    .from('documents')
    .select('id, filename')
    .eq('project_id', projectId);

  if (systemFilter) {
    // Search for system name in filename
    query_builder = query_builder.ilike('filename', `%${systemFilter}%`);
  }

  const { data: docs, error } = await query_builder;

  if (error || !docs) {
    console.error('[PDF Attachment] Error identifying relevant docs:', error);
    return [];
  }

  return docs.map((d) => d.id);
}
