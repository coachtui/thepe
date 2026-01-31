/**
 * Vision Processing API Endpoint
 *
 * Processes a document with Claude Vision to extract quantities from critical sheets.
 * This is an optional enhancement that improves quantity query accuracy.
 *
 * POST /api/documents/[id]/process-vision
 * Body: { projectId: string, maxSheets?: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db/supabase/server';
import { processDocumentWithVision } from '@/lib/processing/vision-processor';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();

    // Verify authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const documentId = params.id;
    const body = await request.json();
    const { projectId, maxSheets = 50 } = body; // Increased to 50 - identifyCriticalSheets handles smart selection

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    // Verify user has access to this project
    const { data: projectMember, error: memberError } = await supabase
      .from('project_members')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    if (memberError || !projectMember) {
      return NextResponse.json(
        { error: 'Access denied to this project' },
        { status: 403 }
      );
    }

    // Verify document exists and belongs to project
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, filename, project_id')
      .eq('id', documentId)
      .eq('project_id', projectId)
      .single();

    if (docError || !document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    console.log(`[Vision API] Processing document: ${document.filename}`);
    console.log(`[Vision API] Max sheets: ${maxSheets}`);

    // Process the document with vision
    // Process ALL pages to ensure we capture all material quantities
    const result = await processDocumentWithVision(documentId, projectId, {
      maxSheets,
      processAllSheets: true, // Process all pages for construction plans
      imageScale: 2.0,
      extractQuantities: true,
      storeVisionData: true
    });

    if (result.success) {
      console.log(`[Vision API] Success: Processed ${result.sheetsProcessed} sheets, extracted ${result.quantitiesExtracted} quantities`);
      console.log(`[Vision API] Cost: $${result.totalCost.toFixed(4)}`);

      return NextResponse.json({
        success: true,
        message: `Successfully processed ${result.sheetsProcessed} sheets`,
        data: {
          sheetsProcessed: result.sheetsProcessed,
          quantitiesExtracted: result.quantitiesExtracted,
          totalCost: result.totalCost,
          processingTimeMs: result.processingTimeMs
        }
      });
    } else {
      console.error('[Vision API] Processing failed:', result.errors);

      return NextResponse.json({
        success: false,
        message: 'Vision processing completed with errors',
        data: {
          sheetsProcessed: result.sheetsProcessed,
          quantitiesExtracted: result.quantitiesExtracted,
          errors: result.errors
        }
      }, { status: 207 }); // 207 Multi-Status (partial success)
    }

  } catch (error) {
    console.error('[Vision API] Error:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Get vision processing status for a document
 * GET /api/documents/[id]/process-vision
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();

    // Verify authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const documentId = params.id;

    // Get document and check access
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select(`
        id,
        filename,
        project_id,
        projects!inner (
          id,
          name,
          project_members!inner (
            user_id
          )
        )
      `)
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Check if any chunks have been vision processed
    const { data: chunks, error: chunksError } = await supabase
      .from('document_chunks')
      .select('id, vision_processed_at, sheet_type, is_critical_sheet')
      .eq('document_id', documentId)
      .not('vision_processed_at', 'is', null);

    if (chunksError) {
      throw chunksError;
    }

    // Count extracted quantities
    const { count: quantitiesCount, error: countError } = await supabase
      .from('project_quantities')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', documentId);

    if (countError) {
      throw countError;
    }

    const isProcessed = chunks && chunks.length > 0;

    return NextResponse.json({
      documentId,
      filename: document.filename,
      visionProcessed: isProcessed,
      sheetsProcessed: chunks?.length || 0,
      quantitiesExtracted: quantitiesCount || 0,
      lastProcessedAt: chunks?.[0]?.vision_processed_at || null,
      criticalSheets: chunks?.filter(c => c.is_critical_sheet).length || 0
    });

  } catch (error) {
    console.error('[Vision API] Error checking status:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
