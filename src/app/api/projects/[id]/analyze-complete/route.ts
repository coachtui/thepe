/**
 * API Route: Batch Project Analysis
 *
 * Processes ALL documents in a project with vision analysis for complete project understanding.
 * This is a ONE-TIME operation (typically run after uploading a new project).
 *
 * For 3000-sheet projects:
 * - Processes up to 200 sheets per document
 * - Runs vision extraction across all documents in parallel
 * - Populates project_quantities table with complete data
 * - Returns aggregated project summary
 *
 * Desktop only - NOT called from mobile (mobile only queries pre-processed data)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/db/supabase/server';
import { processDocumentWithVision } from '@/lib/processing/vision-processor';

/**
 * POST: Trigger complete project analysis
 *
 * Processes all documents in the project with vision extraction.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = params.id;
    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    console.log(`[Batch Analysis] Starting complete project analysis for project: ${projectId}`);

    // Get all documents for this project
    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('id, filename, page_count, vision_status')
      .eq('project_id', projectId)
      .order('filename');

    if (docsError || !documents || documents.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: docsError?.message || 'No documents found in project',
        },
        { status: 400 }
      );
    }

    console.log(`[Batch Analysis] Found ${documents.length} documents to process`);

    // Filter to documents that haven't been vision-processed yet (or allow reprocessing)
    const body = await request.json().catch(() => ({}));
    const forceReprocess = body.forceReprocess || false;

    const docsToProcess = forceReprocess
      ? documents
      : documents.filter(
          (doc) => !doc.vision_status || doc.vision_status === 'pending'
        );

    if (docsToProcess.length === 0) {
      console.log('[Batch Analysis] All documents already processed');

      // Return existing summary
      const { data: summary } = await supabase
        .from('project_quantity_summary')
        .select('*')
        .eq('project_id', projectId);

      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        projectId,
        documentsProcessed: 0,
        totalDocuments: documents.length,
        summary: summary || [],
      });
    }

    console.log(
      `[Batch Analysis] Processing ${docsToProcess.length} documents (${forceReprocess ? 'force reprocess' : 'new only'})`
    );

    // Process all documents in parallel (or with controlled concurrency)
    const maxConcurrency = body.maxConcurrency || 5; // Process 5 documents at a time
    const results = [];

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < docsToProcess.length; i += maxConcurrency) {
      const batch = docsToProcess.slice(i, i + maxConcurrency);

      console.log(
        `[Batch Analysis] Processing batch ${Math.floor(i / maxConcurrency) + 1} of ${Math.ceil(docsToProcess.length / maxConcurrency)}`
      );

      const batchResults = await Promise.all(
        batch.map(async (doc) => {
          try {
            const result = await processDocumentWithVision(doc.id, projectId, {
              maxSheets: 200, // Process up to 200 sheets per document
              processAllSheets: false, // Use smart critical sheet selection
              extractQuantities: true,
              storeVisionData: true,
            });

            return {
              documentId: doc.id,
              filename: doc.filename,
              ...result,
            };
          } catch (error) {
            console.error(
              `[Batch Analysis] Error processing ${doc.filename}:`,
              error
            );
            return {
              documentId: doc.id,
              filename: doc.filename,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        })
      );

      results.push(...batchResults);
    }

    // Calculate totals
    const totalSheetsProcessed = results.reduce(
      (sum, r) => sum + ((r as any).sheetsProcessed || 0),
      0
    );
    const totalQuantitiesExtracted = results.reduce(
      (sum, r) => sum + ((r as any).quantitiesExtracted || 0),
      0
    );
    const totalCost = results.reduce((sum, r) => sum + ((r as any).totalCost || 0), 0);
    const totalProcessingTime = results.reduce(
      (sum, r) => sum + ((r as any).processingTimeMs || 0),
      0
    );

    console.log(`[Batch Analysis] Complete! Processed ${totalSheetsProcessed} sheets, extracted ${totalQuantitiesExtracted} quantities`);
    console.log(`[Batch Analysis] Total cost: $${totalCost.toFixed(2)}, processing time: ${(totalProcessingTime / 1000).toFixed(1)}s`);

    // Query aggregated summary
    const { data: summary } = await supabase
      .from('project_quantity_summary')
      .select('*')
      .eq('project_id', projectId);

    return NextResponse.json({
      success: true,
      projectId,
      documentsProcessed: docsToProcess.length,
      totalDocuments: documents.length,
      totalSheetsProcessed,
      totalQuantitiesExtracted,
      totalCost,
      totalProcessingTimeMs: totalProcessingTime,
      summary: summary || [],
      documentResults: results.map((r) => ({
        filename: r.filename,
        success: r.success,
        sheetsProcessed: (r as any).sheetsProcessed || 0,
        quantitiesExtracted: (r as any).quantitiesExtracted || 0,
        cost: (r as any).totalCost || 0,
        error: (r as any).error,
      })),
    });
  } catch (error) {
    console.error('[Batch Analysis] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Analysis failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET: Check project analysis progress
 *
 * Returns the current vision processing status for all documents in the project.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = params.id;
    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Get all documents with their vision status
    const { data: documents, error } = await supabase
      .from('documents')
      .select(
        'id, filename, vision_status, vision_sheets_processed, vision_quantities_extracted, vision_cost_usd, vision_processed_at'
      )
      .eq('project_id', projectId)
      .order('filename');

    if (error || !documents) {
      return NextResponse.json(
        {
          success: false,
          error: error?.message || 'Failed to fetch documents',
        },
        { status: 400 }
      );
    }

    // Calculate aggregate stats
    const stats = {
      totalDocuments: documents.length,
      completed: documents.filter((d) => d.vision_status === 'completed').length,
      processing: documents.filter((d) => d.vision_status === 'processing')
        .length,
      pending: documents.filter(
        (d) => !d.vision_status || d.vision_status === 'pending'
      ).length,
      failed: documents.filter((d) => d.vision_status === 'error').length,
      totalSheetsProcessed: documents.reduce(
        (sum, d) => sum + (d.vision_sheets_processed || 0),
        0
      ),
      totalQuantitiesExtracted: documents.reduce(
        (sum, d) => sum + (d.vision_quantities_extracted || 0),
        0
      ),
      totalCostUsd: documents.reduce(
        (sum, d) => sum + (d.vision_cost_usd || 0),
        0
      ),
    };

    const isComplete = stats.completed === stats.totalDocuments;
    const isProcessing = stats.processing > 0;

    return NextResponse.json({
      success: true,
      projectId,
      isComplete,
      isProcessing,
      stats,
      documents: documents.map((d) => ({
        id: d.id,
        filename: d.filename,
        status: d.vision_status || 'pending',
        sheetsProcessed: d.vision_sheets_processed || 0,
        quantitiesExtracted: d.vision_quantities_extracted || 0,
        costUsd: d.vision_cost_usd || 0,
        processedAt: d.vision_processed_at,
      })),
    });
  } catch (error) {
    console.error('[Batch Analysis Status] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get status',
      },
      { status: 500 }
    );
  }
}
