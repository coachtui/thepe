/**
 * Component Callout Extractor
 *
 * Stores abbreviated fitting/component callout text captured from plan views
 * into the component_callouts table.  These are short labels like "HORIZ DEFL",
 * "DEFL COUPLING", "MJ BEND", "RED" that appear near fitting symbols and are
 * NOT captured by profile-view quantity extraction.
 *
 * The table is append-only per page: on re-index, existing rows for the
 * (document_id, page_number) pair are deleted before re-insertion.
 */

import { createServiceRoleClient } from '@/lib/db/supabase/service'
import type { VisionAnalysisResult } from './claude-vision'

/**
 * Store component callouts from a vision analysis result.
 *
 * @param projectId       - Project ID
 * @param documentId      - Document ID
 * @param documentPageId  - document_pages.id for this page (may be null before indexing)
 * @param pageNumber      - PDF page number (1-based)
 * @param sheetNumber     - Sheet number string (e.g., "CU-101")
 * @param visionResult    - Full vision analysis result
 * @returns Number of callouts stored
 */
export async function storeComponentCallouts(
  projectId: string,
  documentId: string,
  documentPageId: string | null,
  pageNumber: number,
  sheetNumber: string | null,
  visionResult: VisionAnalysisResult
): Promise<number> {
  const callouts = visionResult.componentCallouts
  if (!callouts || callouts.length === 0) return 0

  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  try {
    // Delete existing callouts for this page to make re-indexing idempotent
    await sb
      .from('component_callouts')
      .delete()
      .eq('document_id', documentId)
      .eq('page_number', pageNumber)

    const rows = callouts
      .filter(c => c.rawText && c.rawText.trim().length > 0)
      .map(c => ({
        project_id: projectId,
        document_id: documentId,
        document_page_id: documentPageId,
        page_number: pageNumber,
        sheet_number: sheetNumber,
        raw_callout_text: c.rawText.trim().toUpperCase(),
        normalized_component: c.normalizedComponent ?? null,
        component_family: c.componentFamily ?? 'unknown_fitting',
        associated_system: c.associatedSystem ?? null,
        station: c.station ?? null,
        source_view: c.sourceView ?? 'unknown',
        confidence: c.confidence ?? 0.8,
      }))

    if (rows.length === 0) return 0

    const { data, error } = await sb
      .from('component_callouts')
      .insert(rows)
      .select('id')

    if (error) {
      console.error('[CalloutExtractor] Failed to insert component_callouts:', error)
      return 0
    }

    console.log(
      `[CalloutExtractor] Stored ${data?.length ?? 0} callouts for page ${pageNumber}` +
      (sheetNumber ? ` (${sheetNumber})` : '')
    )
    return data?.length ?? 0
  } catch (err) {
    console.error('[CalloutExtractor] Unexpected error:', err)
    return 0
  }
}

/**
 * Query component callouts for a project, optionally filtered by system or sheet.
 * Used by the chat pipeline to answer fitting questions.
 */
export async function queryComponentCallouts(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    associatedSystem?: string
    sheetNumber?: string
    searchText?: string
    minConfidence?: number
    limit?: number
  } = {}
): Promise<Array<{
  raw_callout_text: string
  normalized_component: string | null
  component_family: string | null
  associated_system: string | null
  station: string | null
  sheet_number: string | null
  confidence: number
}>> {
  const { associatedSystem, sheetNumber, searchText, minConfidence = 0.5, limit = 50 } = opts

  let query = supabase
    .from('component_callouts')
    .select('raw_callout_text, normalized_component, component_family, associated_system, station, sheet_number, confidence')
    .eq('project_id', projectId)
    .gte('confidence', minConfidence)
    .order('confidence', { ascending: false })
    .limit(limit)

  if (associatedSystem) {
    query = query.ilike('associated_system', `%${associatedSystem}%`)
  }
  if (sheetNumber) {
    query = query.eq('sheet_number', sheetNumber)
  }
  if (searchText) {
    query = query.ilike('raw_callout_text', `%${searchText}%`)
  }

  const { data, error } = await query
  if (error) {
    console.error('[CalloutExtractor] queryComponentCallouts error:', error)
    return []
  }
  return data ?? []
}
