/**
 * Auto Vision Processing
 *
 * Automatically triggers vision processing after document upload completes.
 * Runs asynchronously in the background to avoid blocking the upload flow.
 */

import { createClient as createServiceClient } from '@/lib/db/supabase/server';
import { processDocumentWithVision } from '@/lib/processing/vision-processor';
import { debug, logProduction } from '@/lib/utils/debug';

interface AutoProcessResult {
  success: boolean;
  documentId: string;
  sheetsProcessed: number;
  quantitiesExtracted: number;
  totalCost: number;
  error?: string;
}

/**
 * Automatically processes a document with vision analysis
 * This function should be called AFTER text processing completes
 * It runs asynchronously and updates the document's vision_status
 */
export async function autoProcessDocumentVision(
  documentId: string,
  projectId: string,
  options: {
    maxSheets?: number;
    skipIfAlreadyProcessed?: boolean;
  } = {}
): Promise<AutoProcessResult> {
  const { maxSheets = 200, skipIfAlreadyProcessed = true } = options;

  const supabase = await createServiceClient();

  try {
    debug.vision(`Starting automatic vision processing for document: ${documentId}`);

    // Check if already processed
    if (skipIfAlreadyProcessed) {
      const { data: doc } = await supabase
        .from('documents')
        .select('vision_status')
        .eq('id', documentId)
        .single();

      if (doc?.vision_status === 'completed') {
        debug.vision('Document already processed, skipping');
        return {
          success: true,
          documentId,
          sheetsProcessed: 0,
          quantitiesExtracted: 0,
          totalCost: 0
        };
      }
    }

    // Update status to processing
    await supabase
      .from('documents')
      .update({
        vision_status: 'processing',
        vision_error: null
      })
      .eq('id', documentId);

    debug.vision('Status updated to "processing"');

    // Run vision processing
    // For construction plans, process ALL pages to ensure we don't miss any material quantities
    // Smart detection can miss pages with critical callout boxes
    const result = await processDocumentWithVision(documentId, projectId, {
      maxSheets, // Will use 50 by default
      processAllSheets: true, // Process ALL pages for construction plans
      imageScale: 2.0,
      extractQuantities: true,
      storeVisionData: true
    });

    // Update document with results
    if (result.success) {
      await supabase
        .from('documents')
        .update({
          vision_status: 'completed',
          vision_processed_at: new Date().toISOString(),
          vision_sheets_processed: result.sheetsProcessed,
          vision_quantities_extracted: result.quantitiesExtracted,
          vision_cost_usd: result.totalCost,
          vision_error: null
        })
        .eq('id', documentId);

      logProduction.info('Auto Vision Success',
        `Processed ${result.sheetsProcessed} sheets, ${result.quantitiesExtracted} quantities`,
        { documentId, totalCost: `$${result.totalCost.toFixed(4)}` }
      );

      return {
        success: true,
        documentId,
        sheetsProcessed: result.sheetsProcessed,
        quantitiesExtracted: result.quantitiesExtracted,
        totalCost: result.totalCost
      };
    } else {
      // Partial success or failure
      const errorMsg = result.errors?.join(', ') || 'Vision processing failed';

      await supabase
        .from('documents')
        .update({
          vision_status: 'failed',
          vision_error: errorMsg,
          vision_sheets_processed: result.sheetsProcessed,
          vision_quantities_extracted: result.quantitiesExtracted,
          vision_cost_usd: result.totalCost
        })
        .eq('id', documentId);

      logProduction.error('Auto Vision Failed', errorMsg, { documentId });

      return {
        success: false,
        documentId,
        sheetsProcessed: result.sheetsProcessed,
        quantitiesExtracted: result.quantitiesExtracted,
        totalCost: result.totalCost,
        error: errorMsg
      };
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logProduction.error('Auto Vision Fatal Error', error, { documentId });

    // Mark as failed
    try {
      await supabase
        .from('documents')
        .update({
          vision_status: 'failed',
          vision_error: errorMsg
        })
        .eq('id', documentId);
    } catch (updateError) {
      logProduction.error('Auto Vision', updateError, { context: 'Failed to update error status' });
    }

    return {
      success: false,
      documentId,
      sheetsProcessed: 0,
      quantitiesExtracted: 0,
      totalCost: 0,
      error: errorMsg
    };
  }
}

/**
 * Non-blocking version that triggers vision processing in the background
 * Use this in API routes to avoid blocking the response
 */
export function triggerVisionProcessingAsync(
  documentId: string,
  projectId: string,
  options?: { maxSheets?: number }
): void {
  // Fire and forget - don't await
  autoProcessDocumentVision(documentId, projectId, options)
    .then(result => {
      if (result.success) {
        debug.vision(`Background processing completed for ${documentId}`);
      } else {
        logProduction.error('Auto Vision', `Background processing failed for ${documentId}`, { error: result.error });
      }
    })
    .catch(error => {
      logProduction.error('Auto Vision', error, { context: 'Background processing threw error', documentId });
    });
}

/**
 * Check if a document should be processed with vision
 * Criteria:
 * - Must be a PDF (vision works best on PDFs)
 * - Must have completed text processing
 * - Vision status must be 'pending'
 */
export async function shouldAutoProcessVision(documentId: string): Promise<boolean> {
  const supabase = await createServiceClient();

  try {
    const { data: doc } = await supabase
      .from('documents')
      .select('file_type, processing_status, vision_status')
      .eq('id', documentId)
      .single();

    if (!doc) return false;

    // Only process PDFs automatically
    const isPdf = doc.file_type === 'application/pdf';

    // Text processing must be complete
    const textComplete = doc.processing_status === 'completed';

    // Vision must be pending
    const visionPending = doc.vision_status === 'pending';

    return isPdf && textComplete && visionPending;

  } catch (error) {
    logProduction.error('Auto Vision', error, { context: 'Error checking if should process' });
    return false;
  }
}
