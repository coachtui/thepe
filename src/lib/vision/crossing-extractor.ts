/**
 * Utility Crossing Extractor
 *
 * Extracts and stores utility crossing data from vision analysis results.
 * Utility crossings are found primarily on profile views showing where different utilities intersect.
 */

import { createClient } from '@/lib/db/supabase/server';
import type { VisionAnalysisResult } from './claude-vision';

/**
 * Normalize station string to numeric value for calculations
 * e.g., "5+23.50" -> 523.50
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
 * Store utility crossings from vision analysis in the database
 *
 * @param projectId - Project ID
 * @param documentId - Document ID
 * @param chunkId - Chunk ID (optional)
 * @param sheetNumber - Sheet number where crossing was found
 * @param visionResult - Vision analysis result
 * @returns Number of crossings stored
 */
export async function storeUtilityCrossings(
  projectId: string,
  documentId: string,
  chunkId: string | null,
  sheetNumber: string | null,
  visionResult: VisionAnalysisResult
): Promise<number> {
  const supabase = await createClient();

  if (!visionResult.utilityCrossings || visionResult.utilityCrossings.length === 0) {
    return 0;
  }

  try {
    // Map to DB records
    const crossingRecords = visionResult.utilityCrossings.map((crossing) => {
      const stationNumeric = crossing.station ? stationToNumeric(crossing.station) : null;

      return {
        project_id: projectId,
        document_id: documentId,
        chunk_id: chunkId,
        crossing_utility: crossing.crossingUtility,
        utility_full_name: crossing.utilityFullName,
        station: crossing.station || null,
        station_numeric: stationNumeric,
        elevation: crossing.elevation || null,
        is_existing: crossing.isExisting,
        is_proposed: crossing.isProposed,
        size: crossing.size || null,
        sheet_number: sheetNumber,
        notes: crossing.notes || null,
        source_type: 'vision',
        confidence: crossing.confidence,
        vision_data: {
          rawAnalysis: visionResult.rawAnalysis,
          sheetMetadata: visionResult.sheetMetadata,
          utilityCrossing: crossing
        }
      };
    });

    const { data, error } = await (supabase as any)
      .from('utility_crossings')
      .insert(crossingRecords)
      .select();

    if (error) {
      console.error('Error storing utility crossings:', error);
      throw error;
    }

    console.log(`[Crossing Extractor] Stored ${data.length} utility crossings for project ${projectId}`);
    return data.length;
  } catch (error) {
    console.error('Error in storeUtilityCrossings:', error);
    throw error;
  }
}

/**
 * Get all utility crossings for a project
 *
 * @param projectId - Project ID
 * @param utilityFilter - Optional utility name filter (supports fuzzy matching)
 * @returns Array of utility crossings
 */
export async function getUtilityCrossings(
  projectId: string,
  utilityFilter?: string
): Promise<any[]> {
  const supabase = await createClient();

  try {
    const { data, error } = await (supabase as any).rpc('search_utility_crossings', {
      p_project_id: projectId,
      p_utility_search: utilityFilter || null,
      p_sheet_number: null,
      p_existing_only: null,
      p_limit: 100
    });

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching utility crossings:', error);
    return [];
  }
}

/**
 * Count utility crossings by type for a project
 *
 * @param projectId - Project ID
 * @returns Summary of crossings by utility type
 */
export async function countCrossingsByType(
  projectId: string
): Promise<Array<{
  crossingUtility: string;
  utilityFullName: string;
  totalCount: number;
  existingCount: number;
  proposedCount: number;
}>> {
  const supabase = await createClient();

  try {
    const { data, error } = await (supabase as any).rpc('count_utility_crossings_by_type', {
      p_project_id: projectId
    });

    if (error) {
      throw error;
    }

    return (data || []).map((item: any) => ({
      crossingUtility: item.crossing_utility,
      utilityFullName: item.utility_full_name,
      totalCount: parseInt(item.total_count),
      existingCount: parseInt(item.existing_count),
      proposedCount: parseInt(item.proposed_count)
    }));
  } catch (error) {
    console.error('Error counting crossings by type:', error);
    return [];
  }
}

/**
 * Delete utility crossings for a document (useful when reprocessing)
 *
 * @param documentId - Document ID
 * @returns Number of deleted records
 */
export async function deleteCrossingsForDocument(
  documentId: string
): Promise<number> {
  const supabase = await createClient();

  try {
    const { data, error } = await (supabase as any)
      .from('utility_crossings')
      .delete()
      .eq('document_id', documentId)
      .select();

    if (error) {
      throw error;
    }

    return data?.length || 0;
  } catch (error) {
    console.error('Error deleting utility crossings:', error);
    return 0;
  }
}

/**
 * Format utility crossings for display
 */
export function formatCrossingSummary(
  crossings: any[]
): string {
  if (crossings.length === 0) {
    return 'No utility crossings found.';
  }

  const lines: string[] = [];

  // Group by utility type
  const grouped: Record<string, any[]> = {};
  for (const crossing of crossings) {
    const key = crossing.utility_full_name || crossing.crossing_utility;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(crossing);
  }

  for (const [utilityName, utilityCrossings] of Object.entries(grouped)) {
    lines.push(`\n**${utilityName}:** ${utilityCrossings.length} crossing(s)`);

    for (const crossing of utilityCrossings) {
      const details: string[] = [];

      if (crossing.station) {
        details.push(`Station ${crossing.station}`);
      }
      if (crossing.elevation) {
        details.push(`Elev ${crossing.elevation.toFixed(2)} ft`);
      }
      if (crossing.size) {
        details.push(crossing.size);
      }
      if (crossing.is_existing) {
        details.push('Existing');
      }
      if (crossing.is_proposed) {
        details.push('Proposed');
      }
      if (crossing.sheet_number) {
        details.push(`Sheet ${crossing.sheet_number}`);
      }

      lines.push(`  - ${details.join(', ')}`);
    }
  }

  return lines.join('\n');
}
