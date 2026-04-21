/**
 * Termination Point Extractor
 *
 * Extracts and stores BEGIN/END termination points from vision analysis results.
 * These termination points are THE MOST ACCURATE source for utility length calculations.
 */

import { createServiceRoleClient } from '@/lib/db/supabase/service';
import type { VisionAnalysisResult } from './claude-vision';
import {
  analyzeSheetWithVision,
  buildFocusedEndStationPrompt,
  parseFocusedEndStationResult,
} from './claude-vision';

/**
 * Normalize station string to numeric value for calculations
 * e.g., "32+62.01" -> 3262.01
 */
function stationToNumeric(station: string): number | null {
  try {
    // Remove "STA" prefix and spaces
    let normalized = station.replace(/^\s*STA\s*/i, '').trim();
    normalized = normalized.replace(/\s+/g, '');

    // Handle format "13+68.83"
    if (normalized.includes('+')) {
      const parts = normalized.split('+');
      const major = parseFloat(parts[0]);
      const minor = parseFloat(parts[1] || '0');
      return major * 100 + minor;
    }

    // Handle direct numeric format
    return parseFloat(normalized);
  } catch {
    return null;
  }
}

/**
 * Normalize utility name by stripping quotes and collapsing whitespace
 * e.g., "Water Line 'A'" -> "Water Line A"
 */
function normalizeUtilityName(name: string): string {
  return name
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Infer utility type from utility name
 */
function inferUtilityType(utilityName: string): string | null {
  const nameLower = utilityName.toLowerCase();

  if (nameLower.includes('water') || nameLower.includes('wl')) {
    return 'water';
  }
  if (nameLower.includes('storm') || nameLower.includes('sd')) {
    return 'storm';
  }
  if (nameLower.includes('sewer') || nameLower.includes('ss')) {
    return 'sewer';
  }
  if (nameLower.includes('gas')) {
    return 'gas';
  }
  if (nameLower.includes('electric') || nameLower.includes('power')) {
    return 'electric';
  }
  if (nameLower.includes('telecom') || nameLower.includes('fiber')) {
    return 'telecom';
  }

  return null;
}

/**
 * Store termination points from vision analysis in the database
 *
 * @param projectId - Project ID
 * @param documentId - Document ID
 * @param chunkId - Chunk ID (optional)
 * @param sheetNumber - Sheet number where termination was found
 * @param visionResult - Vision analysis result
 * @returns Number of termination points stored
 */
export async function storeTerminationPoints(
  projectId: string,
  documentId: string,
  chunkId: string | null,
  sheetNumber: string | null,
  visionResult: VisionAnalysisResult
): Promise<number> {
  const supabase = createServiceRoleClient();

  if (!visionResult.terminationPoints || visionResult.terminationPoints.length === 0) {
    return 0;
  }

  try {
    // Verify document exists before attempting to store related data
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id')
      .eq('id', documentId)
      .single();

    if (docError || !doc) {
      console.warn(`[Termination Extractor] Document not found: ${documentId} (may be processing race condition, skipping)`);
      return 0;
    }
    // Filter out termination points with null/empty stations and map to DB records
    const terminationRecords = visionResult.terminationPoints
      .filter((point) => {
        if (!point.station || point.station.trim() === '') {
          console.warn(
            `[Termination Extractor] Skipping termination point with null/empty station:`,
            { utilityName: point.utilityName, terminationType: point.terminationType }
          );
          return false;
        }
        return true;
      })
      .map((point) => {
        const stationNumeric = stationToNumeric(point.station);
        const utilityType = inferUtilityType(point.utilityName);

        return {
          project_id: projectId,
          document_id: documentId,
          chunk_id: chunkId,
          utility_name: normalizeUtilityName(point.utilityName),
          utility_type: utilityType,
          termination_type: point.terminationType,
          station: point.station,
          station_numeric: stationNumeric,
          sheet_number: sheetNumber,
          notes: point.notes || null,
          source_type: 'vision',
          confidence: point.confidence,
          vision_data: {
            rawAnalysis: visionResult.rawAnalysis,
            sheetMetadata: visionResult.sheetMetadata,
            terminationPoint: point
          }
        };
      });

    // Only insert if we have valid records
    if (terminationRecords.length === 0) {
      console.log(`[Termination Extractor] No valid termination points to store (all had null/empty stations)`);
      return 0;
    }

    const { data, error } = await (supabase as any)
      .from('utility_termination_points')
      .insert(terminationRecords)
      .select();

    if (error) {
      console.error('Error storing termination points:', error);
      throw error;
    }

    console.log(`[Termination Extractor] Stored ${data.length} termination points for project ${projectId}`);
    return data.length;
  } catch (error) {
    console.error('Error in storeTerminationPoints:', error);
    throw error;
  }
}

/**
 * Get all termination points for a utility in a project
 *
 * @param projectId - Project ID
 * @param utilityName - Utility name (supports fuzzy matching)
 * @returns Array of termination points
 */
export async function getTerminationPointsForUtility(
  projectId: string,
  utilityName: string
): Promise<any[]> {
  const supabase = createServiceRoleClient();

  try {
    const { data, error } = await (supabase as any).rpc('search_termination_points', {
      p_project_id: projectId,
      p_utility_search: utilityName,
      p_termination_type: null,
      p_limit: 100
    });

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching termination points:', error);
    return [];
  }
}

/**
 * Calculate utility length from termination points
 *
 * @param projectId - Project ID
 * @param utilityName - Utility name
 * @returns Length calculation result or null
 */
export async function calculateLengthFromTerminations(
  projectId: string,
  utilityName: string
): Promise<{
  utilityName: string;
  beginStation: string;
  endStation: string;
  beginSheet: string;
  endSheet: string;
  lengthLf: number;
  confidence: number;
  method: string;
} | null> {
  const supabase = createServiceRoleClient();
  const normalizedName = normalizeUtilityName(utilityName);

  // 1. Try canonical table first (most accurate — populated by consolidateUtilityLengths)
  try {
    const { data: canonical } = await supabase
      .from('utility_length_canonical')
      .select('*')
      .eq('project_id', projectId)
      .ilike('utility_name', normalizedName)
      .maybeSingle();

    if (canonical) {
      return {
        utilityName: (canonical as any).utility_name,
        beginStation: (canonical as any).begin_station ?? '0+00',
        endStation: (canonical as any).end_station,
        beginSheet: (canonical as any).begin_sheet ?? '',
        endSheet: (canonical as any).end_sheet ?? '',
        lengthLf: parseFloat((canonical as any).length_lf),
        confidence: parseFloat((canonical as any).confidence),
        method: (canonical as any).method,
      };
    }
  } catch (err) {
    console.warn('[calculateLengthFromTerminations] Canonical lookup failed, falling back:', err);
  }

  // 2. Fall back to existing RPC (unscoped — lower accuracy)
  try {
    const { data, error } = await (supabase as any).rpc('calculate_utility_length', {
      p_project_id: projectId,
      p_utility_name: utilityName,
    });

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return {
      utilityName: data[0].utility_name,
      beginStation: data[0].begin_station,
      endStation: data[0].end_station,
      beginSheet: data[0].begin_sheet,
      endSheet: data[0].end_sheet,
      lengthLf: parseFloat(data[0].length_lf),
      confidence: parseFloat(data[0].confidence),
      method: data[0].method,
    };
  } catch (error) {
    console.error('Error calculating length from terminations:', error);
    return null;
  }
}

/**
 * Get all utilities with termination points in a project
 *
 * @param projectId - Project ID
 * @returns Array of utility names with termination data
 */
export async function getUtilitiesWithTerminations(
  projectId: string
): Promise<Array<{
  utilityName: string;
  utilityType: string | null;
  hasBegin: boolean;
  hasEnd: boolean;
  beginStation: string | null;
  endStation: string | null;
  calculatedLength: number | null;
}>> {
  const supabase = createServiceRoleClient();

  try {
    const { data, error } = await (supabase as any)
      .from('utility_length_summary')
      .select('*')
      .eq('project_id', projectId);

    if (error) {
      throw error;
    }

    return (data || []).map((item: any) => ({
      utilityName: item.utility_name,
      utilityType: item.utility_type,
      hasBegin: true,
      hasEnd: true,
      beginStation: item.begin_station,
      endStation: item.end_station,
      calculatedLength: parseFloat(item.length_lf)
    }));
  } catch (error) {
    console.error('Error fetching utilities with terminations:', error);
    return [];
  }
}

/**
 * Delete termination points for a document (useful when reprocessing)
 *
 * @param documentId - Document ID
 * @returns Number of deleted records
 */
export async function deleteTerminationPointsForDocument(
  documentId: string
): Promise<number> {
  const supabase = createServiceRoleClient();

  try {
    const { data, error } = await (supabase as any)
      .from('utility_termination_points')
      .delete()
      .eq('document_id', documentId)
      .select();

    if (error) {
      throw error;
    }

    return data?.length || 0;
  } catch (error) {
    console.error('Error deleting termination points:', error);
    return 0;
  }
}

/**
 * Format termination points for display
 */
export function formatTerminationSummary(
  terminationPoints: any[]
): string {
  if (terminationPoints.length === 0) {
    return 'No termination points found.';
  }

  const grouped: Record<string, any[]> = {};

  for (const point of terminationPoints) {
    if (!grouped[point.utility_name]) {
      grouped[point.utility_name] = [];
    }
    grouped[point.utility_name].push(point);
  }

  const lines: string[] = [];

  for (const [utilityName, points] of Object.entries(grouped)) {
    lines.push(`\n**${utilityName}:**`);

    const beginPoints = points.filter((p) => p.termination_type === 'BEGIN');
    const endPoints = points.filter((p) => p.termination_type === 'END');

    if (beginPoints.length > 0) {
      beginPoints.forEach((p) => {
        lines.push(`  - BEGIN at ${p.station} (Sheet ${p.sheet_number})`);
      });
    }

    if (endPoints.length > 0) {
      endPoints.forEach((p) => {
        lines.push(`  - END at ${p.station} (Sheet ${p.sheet_number})`);
      });
    }

    // Calculate length if we have both
    if (beginPoints.length > 0 && endPoints.length > 0) {
      const begin = beginPoints[0];
      const end = endPoints[0];

      if (begin.station_numeric && end.station_numeric) {
        const length = end.station_numeric - begin.station_numeric;
        lines.push(`  - **Calculated Length: ${length.toFixed(2)} LF**`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Validate termination points (check for missing BEGIN or END)
 */
export async function validateTerminationPoints(
  projectId: string
): Promise<{
  complete: Array<{ utilityName: string; lengthLf: number }>;
  missingBegin: string[];
  missingEnd: string[];
}> {
  const supabase = createServiceRoleClient();

  try {
    // Get all termination points
    const { data, error } = await (supabase as any)
      .from('utility_termination_points')
      .select('utility_name, termination_type, station_numeric')
      .eq('project_id', projectId);

    if (error) {
      throw error;
    }

    const utilities: Record<
      string,
      { begin: number | null; end: number | null }
    > = {};

    for (const point of data || []) {
      if (!utilities[point.utility_name]) {
        utilities[point.utility_name] = { begin: null, end: null };
      }

      if (point.termination_type === 'BEGIN' && point.station_numeric) {
        utilities[point.utility_name].begin = point.station_numeric;
      } else if (point.termination_type === 'END' && point.station_numeric) {
        utilities[point.utility_name].end = point.station_numeric;
      }
    }

    const complete: Array<{ utilityName: string; lengthLf: number }> = [];
    const missingBegin: string[] = [];
    const missingEnd: string[] = [];

    for (const [utilityName, points] of Object.entries(utilities)) {
      if (points.begin !== null && points.end !== null) {
        complete.push({
          utilityName,
          lengthLf: points.end - points.begin
        });
      } else if (points.begin === null) {
        missingBegin.push(utilityName);
      } else if (points.end === null) {
        missingEnd.push(utilityName);
      }
    }

    return { complete, missingBegin, missingEnd };
  } catch (error) {
    console.error('Error validating termination points:', error);
    return { complete: [], missingBegin: [], missingEnd: [] };
  }
}

async function runFocusedEndStationExtraction(
  projectId: string,
  pageNumber: number,
  utilityName: string
): Promise<{ endStation: string | null; confidence: number }> {
  const supabase = createServiceRoleClient();

  const { data: page } = await supabase
    .from('document_pages')
    .select('page_image_url, sheet_number')
    .eq('project_id', projectId)
    .eq('page_number', pageNumber)
    .maybeSingle();

  if (!page?.page_image_url) {
    console.warn(`[Consolidate] No page_image_url for project ${projectId} page ${pageNumber}`);
    return { endStation: null, confidence: 0 };
  }

  try {
    const response = await fetch(page.page_image_url);
    if (!response.ok) {
      console.warn(`[Consolidate] Failed to fetch image: ${response.status}`);
      return { endStation: null, confidence: 0 };
    }
    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const customPrompt = buildFocusedEndStationPrompt(utilityName);
    const result = await analyzeSheetWithVision(imageBuffer, {
      customPrompt,
      taskType: 'extraction',
    });

    return parseFocusedEndStationResult(result.rawAnalysis ?? '');
  } catch (err) {
    console.error(`[Consolidate] Vision error for page ${pageNumber}:`, err);
    return { endStation: null, confidence: 0 };
  }
}

export async function consolidateUtilityLengths(projectId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  // 1. Get all distinct normalized utility names for this project
  const { data: nameRows } = await supabase
    .from('utility_termination_points')
    .select('utility_name')
    .eq('project_id', projectId);

  const uniqueNames = [...new Set((nameRows ?? []).map((r: any) => r.utility_name as string))];
  console.log(`[Consolidate] Processing ${uniqueNames.length} utilities for project ${projectId}`);

  for (const utilityName of uniqueNames) {
    // 2. Find dedicated sheets via sheet_title loose ILIKE match
    const words = utilityName.split(' ').filter((w) => w.length > 1);
    const likePattern = `%${words.join('%')}%`;

    const { data: pages } = await supabase
      .from('document_pages')
      .select('page_number, sheet_number')
      .eq('project_id', projectId)
      .ilike('sheet_title', likePattern)
      .order('page_number', { ascending: false });

    const dedicatedSheets = pages ?? [];
    // utility_termination_points.sheet_number stores "Page N" (page_number as text)
    // document_pages.sheet_number stores "CU109" (the drawing sheet label)
    // Join via page_number, not sheet_number
    const dedicatedPageRefs = dedicatedSheets.map((p: any) => `Page ${p.page_number}`);

    // 3. Find begin station: min BEGIN from dedicated sheets
    let beginStation = '0+00';
    let beginStationNumeric = 0;
    let beginSheet: string | null =
      dedicatedSheets[dedicatedSheets.length - 1]?.sheet_number ?? null;

    if (dedicatedPageRefs.length > 0) {
      const { data: begins } = await supabase
        .from('utility_termination_points')
        .select('station, station_numeric, sheet_number')
        .eq('project_id', projectId)
        .eq('utility_name', utilityName)
        .eq('termination_type', 'BEGIN')
        .in('sheet_number', dedicatedPageRefs)
        .order('station_numeric', { ascending: true })
        .limit(1);

      if (begins && begins[0]) {
        beginStation = (begins[0] as any).station;
        beginStationNumeric = parseFloat((begins[0] as any).station_numeric) || 0;
        beginSheet = (begins[0] as any).sheet_number;
      }
    }

    // 4. Focused re-extraction on the last dedicated sheet (sorted desc, so index 0)
    let endStation: string | null = null;
    let endStationNumeric: number | null = null;
    let endSheet: string | null = null;
    let confidence = 0.6;
    let method: 'focused_reextraction' | 'sheet_scoped' | 'unscoped' = 'unscoped';

    const lastPage = dedicatedSheets[0];
    if (lastPage) {
      const focusedResult = await runFocusedEndStationExtraction(
        projectId,
        (lastPage as any).page_number,
        utilityName
      );
      if (focusedResult.endStation) {
        endStation = focusedResult.endStation;
        endStationNumeric = stationToNumeric(focusedResult.endStation);
        endSheet = (lastPage as any).sheet_number;
        confidence = focusedResult.confidence;
        method = 'focused_reextraction';
      }
    }

    // 5. Fallback: max END station from dedicated sheets
    if (!endStation && dedicatedPageRefs.length > 0) {
      const { data: ends } = await supabase
        .from('utility_termination_points')
        .select('station, station_numeric, sheet_number')
        .eq('project_id', projectId)
        .eq('utility_name', utilityName)
        .eq('termination_type', 'END')
        .in('sheet_number', dedicatedPageRefs)
        .order('station_numeric', { ascending: false })
        .limit(1);

      if (ends && ends[0]) {
        endStation = (ends[0] as any).station;
        endStationNumeric = parseFloat((ends[0] as any).station_numeric) || null;
        endSheet = (ends[0] as any).sheet_number;
        confidence = 0.65;
        method = 'sheet_scoped';
      }
    }

    // 6. Skip if no end station found (stationToNumeric returns NaN, not null, on parse failure)
    if (!endStation || endStationNumeric === null || isNaN(endStationNumeric)) {
      console.warn(`[Consolidate] No end station found for "${utilityName}" — skipping`);
      continue;
    }

    const lengthLf = endStationNumeric - beginStationNumeric;
    const utilityType = inferUtilityType(utilityName);

    // 7. Upsert one authoritative row
    const { error: upsertError } = await supabase
      .from('utility_length_canonical')
      .upsert(
        {
          project_id: projectId,
          utility_name: utilityName,
          utility_type: utilityType,
          begin_station: beginStation,
          begin_station_numeric: beginStationNumeric,
          begin_sheet: beginSheet,
          end_station: endStation,
          end_station_numeric: endStationNumeric,
          end_sheet: endSheet,
          length_lf: lengthLf,
          confidence,
          method,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'project_id,utility_name' }
      );

    if (upsertError) {
      console.error(`[Consolidate] Upsert error for "${utilityName}":`, upsertError);
    } else {
      console.log(
        `[Consolidate] ${utilityName}: ${lengthLf.toFixed(2)} LF (${method}, confidence ${confidence})`
      );
    }
  }
}
