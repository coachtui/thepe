/**
 * API Route: Visual Analysis for Chat
 *
 * This endpoint handles on-demand visual analysis of construction plan sheets.
 * When a query requires visual inspection (e.g., counting valves, finding crossings),
 * this endpoint:
 * 1. Converts relevant PDF sheets to images
 * 2. Sends images to Claude Vision for analysis
 * 3. Returns structured visual analysis results
 *
 * This provides more accurate answers than pre-extracted database data
 * by letting the AI "see" the actual plans.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db/supabase/server';
import {
  performVisualAnalysis,
  formatVisualAnalysisForChat,
  type VisualAnalysisRequest,
  type VisualAnalysisTask,
} from '@/lib/chat/visual-analysis';

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get request parameters
    const body = await request.json();
    const {
      projectId,
      query,
      task,
      componentType,
      sizeFilter,
      utilityName,
      sheetNumbers,
    } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    console.log(`[Visual Analysis API] Processing request for project ${projectId}`);
    console.log(`[Visual Analysis API] Query: "${query}"`);
    console.log(`[Visual Analysis API] Task: ${task || 'auto-detect'}`);

    // Build visual analysis request
    const analysisRequest: VisualAnalysisRequest = {
      projectId,
      task: (task as VisualAnalysisTask) || 'general_inspection',
      query,
      componentType,
      sizeFilter,
      utilityName,
      sheetNumbers,
    };

    // Perform visual analysis
    const result = await performVisualAnalysis(analysisRequest);

    console.log(`[Visual Analysis API] Analysis complete:`, {
      success: result.success,
      sheetsAnalyzed: result.sheetsAnalyzed.length,
      findingsCount: result.findings.length,
      totalCount: result.totalCount,
      confidence: result.confidence,
      costUsd: result.costUsd.toFixed(4),
    });

    // Return result
    return NextResponse.json({
      success: result.success,
      sheetsAnalyzed: result.sheetsAnalyzed,
      findings: result.findings,
      summary: result.summary,
      totalCount: result.totalCount,
      confidence: result.confidence,
      reasoning: result.reasoning,
      costUsd: result.costUsd,
      formattedForChat: formatVisualAnalysisForChat(result),
    });
  } catch (error) {
    console.error('[Visual Analysis API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Visual analysis failed',
        success: false,
      },
      { status: 500 }
    );
  }
}
