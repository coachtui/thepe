/**
 * Auto Vision Processing
 *
 * Automatically triggers vision processing after document upload completes.
 * Runs asynchronously in the background to avoid blocking the upload flow.
 */

import { createClient as createServiceClient } from '@/lib/db/supabase/server';
import { processDocumentWithVision } from '@/lib/processing/vision-processor';
import { debug, logProduction } from '@/lib/utils/debug';
import { getDocumentSignedUrl } from '@/lib/db/queries/documents';
import { getPdfMetadata } from '@/lib/vision/pdf-to-image';
import { inngest } from '@/inngest/client';

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
    trigger?: string; // caller label for trace logging
  } = {}
): Promise<AutoProcessResult> {
  const { maxSheets = 200, skipIfAlreadyProcessed = true, trigger = 'unknown' } = options;

  const supabase = await createServiceClient();

  try {
    debug.vision(`Starting automatic vision processing for document: ${documentId}`);

    // Check if already processed
    if (skipIfAlreadyProcessed) {
      const { data: doc } = await supabase
        .from('documents')
        .select('vision_status, updated_at')
        .eq('id', documentId)
        .single();

      logProduction.info('Vision Lifecycle',
        `[START] document=${documentId} trigger=${trigger} prior_vision_status=${doc?.vision_status ?? 'unknown'}`
      );

      if (doc?.vision_status === 'completed') {
        logProduction.info('Vision Lifecycle',
          `[SKIP] document=${documentId} — already completed, skipping (trigger=${trigger})`
        );
        return {
          success: true,
          documentId,
          sheetsProcessed: 0,
          quantitiesExtracted: 0,
          totalCost: 0
        };
      }

      if (doc?.vision_status === 'processing') {
        const elapsedMin = doc.updated_at
          ? ((Date.now() - new Date(doc.updated_at).getTime()) / 60000).toFixed(1)
          : 'unknown';
        logProduction.info('Vision Lifecycle',
          `[WARN] document=${documentId} — already in processing (${elapsedMin} min), proceeding anyway (trigger=${trigger})`
        );
      }
    } else {
      logProduction.info('Vision Lifecycle',
        `[START] document=${documentId} trigger=${trigger} skipIfAlreadyProcessed=false`
      );
    }

    // Update status to processing
    await supabase
      .from('documents')
      .update({
        vision_status: 'processing',
        vision_error: null
      })
      .eq('id', documentId);

    logProduction.info('Vision Lifecycle',
      `[STATUS→processing] document=${documentId} trigger=${trigger}`
    );

    // Check document size to determine processing strategy
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id, file_path, file_type')
      .eq('id', documentId)
      .single();

    if (docError || !doc) {
      throw new Error(`Document not found: ${docError?.message || 'unknown error'}`);
    }

    // Download PDF and get metadata
    const signedUrl = await getDocumentSignedUrl(supabase, doc.file_path);
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error('Failed to download document');
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    const metadata = await getPdfMetadata(pdfBuffer);

    debug.vision(`Document has ${metadata.numPages} pages`);

    // Process all documents with direct vision processing
    debug.vision(`Processing document (${metadata.numPages} pages) with vision processor`);

    // Run vision processing
    // For construction plans, process ALL pages to ensure we don't miss any material quantities
    // Smart detection can miss pages with critical callout boxes
    const result = await processDocumentWithVision(documentId, projectId, {
      maxSheets, // Will use 200 by default
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

      logProduction.info('Vision Lifecycle',
        `[STATUS→completed] document=${documentId} trigger=${trigger} sheets=${result.sheetsProcessed} quantities=${result.quantitiesExtracted} cost=$${result.totalCost.toFixed(4)}`
      );
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

      logProduction.info('Vision Lifecycle',
        `[STATUS→failed] document=${documentId} trigger=${trigger} error="${errorMsg}" sheets=${result.sheetsProcessed}`
      );
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
      logProduction.info('Vision Lifecycle',
        `[STATUS→failed/exception] document=${documentId} trigger=${trigger} error="${errorMsg}"`
      );
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
 *
 * WARNING: On Vercel, background promises may be killed when the serverless
 * function exits. If this happens, vision_status is stuck at 'processing'.
 * shouldAutoProcessVision() includes stuck-state detection (15 min threshold)
 * to recover from this. The maxDuration export on the calling route should be
 * set as high as possible to give the background task time to complete.
 */
export function triggerVisionProcessingAsync(
  documentId: string,
  projectId: string,
  options?: { maxSheets?: number; trigger?: string }
): void {
  const triggerLabel = options?.trigger ?? 'async-background';
  logProduction.info('Vision Lifecycle',
    `[TRIGGER] document=${documentId} project=${projectId} trigger=${triggerLabel} maxSheets=${options?.maxSheets ?? 200}`
  );
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
 * Send a vision/document.process event to Inngest.
 *
 * Inngest runs the job durably outside the Vercel request lifecycle —
 * no timeouts, no fire-and-forget risk. Each page-range chunk is a
 * separate durable step with independent retry.
 *
 * The event is deduplicated by document ID (id=`vision-${documentId}`),
 * so calling this twice for the same document queues only one job.
 */
export async function triggerVisionWithInngest(
  documentId: string,
  projectId: string,
  options?: { maxPages?: number; trigger?: string }
): Promise<void> {
  const triggerLabel = options?.trigger ?? 'inngest-trigger';
  logProduction.info('Vision Lifecycle',
    `[TRIGGER→inngest] document=${documentId} project=${projectId} trigger=${triggerLabel}`
  );
  await inngest.send({
    // Deduplicate: same document within 24 h will not queue a second job.
    id: `vision-${documentId}`,
    name: 'vision/document.process',
    data: {
      documentId,
      projectId,
      trigger: triggerLabel,
      maxPages: options?.maxPages ?? 200,
    },
  });
}

// How long a document can stay in 'processing' before it is considered
// stuck (Vercel function was killed before completion could be written).
const STUCK_PROCESSING_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes

/**
 * Check if a document should be processed with vision
 * Criteria:
 * - Must be a PDF (vision works best on PDFs)
 * - Must have completed text processing
 * - Vision status must be 'pending' — OR stuck in 'processing' for >15 min
 *   (Vercel may kill the function before completion is written, leaving the
 *   status permanently at 'processing'. Detect and reset those.)
 */
export async function shouldAutoProcessVision(documentId: string): Promise<boolean> {
  const supabase = await createServiceClient();

  try {
    const { data: doc } = await supabase
      .from('documents')
      .select('file_type, processing_status, vision_status, updated_at')
      .eq('id', documentId)
      .single();

    if (!doc) return false;

    const isPdf = doc.file_type === 'application/pdf';
    const textComplete = doc.processing_status === 'completed';

    // Stuck-state recovery: if stuck in 'processing' longer than threshold,
    // the serverless function was almost certainly killed before it could write
    // 'completed'. Reset to 'pending' so the next trigger can retry.
    if (doc.vision_status === 'processing' && doc.updated_at) {
      const elapsedMs = Date.now() - new Date(doc.updated_at).getTime();
      const elapsedMin = (elapsedMs / 60000).toFixed(1);
      if (elapsedMs > STUCK_PROCESSING_THRESHOLD_MS) {
        logProduction.info('Vision Auto-Process',
          `[STUCK] document=${documentId} has been in 'processing' for ${elapsedMin} min — resetting to pending for retry`
        );
        await supabase
          .from('documents')
          .update({
            vision_status: 'pending',
            vision_error: `Reset from stuck processing state after ${elapsedMin} min (function timeout)`
          })
          .eq('id', documentId);
        logProduction.info('Vision Auto-Process',
          `[STUCK-RESET] document=${documentId} vision_status reset to pending — will re-trigger`
        );
        return isPdf && textComplete;
      }
      logProduction.info('Vision Auto-Process',
        `[SKIP] document=${documentId} already in processing (${elapsedMin} min elapsed, threshold ${STUCK_PROCESSING_THRESHOLD_MS / 60000} min)`
      );
      return false;
    }

    const visionPending = doc.vision_status === 'pending';
    const result = isPdf && textComplete && visionPending;

    logProduction.info('Vision Auto-Process',
      `[CHECK] document=${documentId} isPdf=${isPdf} textComplete=${textComplete} visionStatus=${doc.vision_status} → shouldProcess=${result}`
    );

    return result;

  } catch (error) {
    logProduction.error('Auto Vision', error, { context: 'Error checking if should process' });
    return false;
  }
}
