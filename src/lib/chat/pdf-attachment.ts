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
  sheet_number?: string;
  document_type?: string;
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
 * Get project documents as PDF attachments for Claude
 *
 * @param projectId - Project ID
 * @param maxDocuments - Maximum number of documents (default: 8)
 * @param systemFilter - Optional filter for utility system (e.g., "Water Line A")
 * @returns PDF attachments ready for Claude
 */
export async function getProjectPdfAttachments(
  projectId: string,
  maxDocuments: number = 8,
  systemFilter?: string
): Promise<PdfAttachmentResult> {
  const supabase = await createClient();

  try {
    // Get documents for this project
    let query = supabase
      .from('documents')
      .select('id, filename, file_path, sheet_number, document_type')
      .eq('project_id', projectId)
      .order('filename');

    // Apply system filter if provided (search in filename or metadata)
    if (systemFilter) {
      query = query.ilike('filename', `%${systemFilter}%`);
    }

    const { data: documents, error } = await query;

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

    // Limit to maxDocuments
    const docsToProcess = pdfDocuments.slice(0, maxDocuments);

    console.log(
      `[PDF Attachment] Processing ${docsToProcess.length} PDF documents for project ${projectId}`
    );

    // Download and convert each document
    const attachments: PdfAttachment[] = [];
    let totalSizeBytes = 0;

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
