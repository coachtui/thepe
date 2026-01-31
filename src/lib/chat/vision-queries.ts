/**
 * Vision Data Queries
 *
 * Provides consolidated access to all vision-extracted data for chat queries.
 * This module queries the structured tables populated by vision processing:
 * - project_quantities: Individual components (valves, fittings, etc.)
 * - utility_termination_points: BEGIN/END labels for length calculations
 * - utility_crossings: Utility crossing data from profile views
 */

import { createClient } from '@/lib/db/supabase/server';
import {
  getUtilityCrossings,
  countCrossingsByType,
  formatCrossingSummary
} from '@/lib/vision/crossing-extractor';
import {
  calculateLengthFromTerminations,
  getTerminationPointsForUtility,
  formatTerminationSummary
} from '@/lib/vision/termination-extractor';

/**
 * Component query result
 */
export interface ComponentQueryResult {
  success: boolean;
  componentType: string;
  totalCount: number;
  items: Array<{
    itemName: string;
    quantity: number;
    size?: string;
    station?: string;
    sheetNumber?: string;
    confidence: number;
  }>;
  source: string;
  confidence: number;
  formattedAnswer: string;
}

/**
 * Crossing query result
 */
export interface CrossingQueryResult {
  success: boolean;
  totalCrossings: number;
  crossings: Array<{
    crossingUtility: string;
    utilityFullName: string;
    station?: string;
    elevation?: number;
    isExisting: boolean;
    isProposed: boolean;
    size?: string;
    sheetNumber?: string;
    confidence: number;
  }>;
  summary: Array<{
    crossingUtility: string;
    utilityFullName: string;
    totalCount: number;
    existingCount: number;
    proposedCount: number;
  }>;
  source: string;
  confidence: number;
  formattedAnswer: string;
}

/**
 * Length query result
 */
export interface LengthQueryResult {
  success: boolean;
  utilityName: string;
  lengthLf: number;
  beginStation: string;
  endStation: string;
  beginSheet?: string;
  endSheet?: string;
  confidence: number;
  source: string;
  formattedAnswer: string;
}

/**
 * Common component patterns for detection
 */
const COMPONENT_PATTERNS: Record<string, RegExp[]> = {
  valve: [/valve/i, /gate\s*valve/i, /butterfly\s*valve/i, /ball\s*valve/i, /check\s*valve/i, /air\s*valve/i, /prv/i],
  hydrant: [/hydrant/i, /fire\s*hydrant/i],
  fitting: [/fitting/i, /tee/i, /elbow/i, /bend/i, /reducer/i, /cap/i, /plug/i],
  manhole: [/manhole/i, /mh/i, /junction\s*structure/i],
  cleanout: [/cleanout/i, /c\.?o\.?/i],
  meter: [/meter/i, /metering/i],
  box: [/valve\s*box/i, /meter\s*box/i, /box/i],
  coupling: [/coupling/i, /connect/i, /adaptor/i, /adapter/i],
  pipe: [/pipe/i, /main/i, /lateral/i, /service/i, /line/i],
};

/**
 * Detect component type from query
 */
export function detectComponentType(query: string): string | null {
  const normalized = query.toLowerCase();

  for (const [componentType, patterns] of Object.entries(COMPONENT_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return componentType;
      }
    }
  }

  return null;
}

/**
 * Extract size from user query (e.g., "12 inch valves" -> "12-IN")
 */
export function extractSizeFromQuery(query: string): string | null {
  const sizePatterns = [
    /\b(\d+)\s*[-]?\s*inch/i,     // "12 inch", "12-inch"
    /\b(\d+)\s*[-]?\s*in\b/i,     // "12 in", "12-in"
    /\b(\d+)["\u201d]\s*/,        // "12"" (inch mark)
    /\b(\d+)\s*[-]?in\b/i,        // "12in", "12-in"
  ];

  for (const pattern of sizePatterns) {
    const match = query.match(pattern);
    if (match) {
      return `${match[1]}-IN`; // Normalize to "12-IN" format
    }
  }

  return null;
}

/**
 * Query for component counts (valves, fittings, etc.)
 *
 * @param projectId - Project ID
 * @param componentType - Type of component to search for (e.g., "valve", "hydrant")
 * @param utilityFilter - Optional utility name filter (e.g., "Water Line A")
 * @param sizeFilter - Optional size filter (e.g., "12-IN" for 12-inch only)
 * @returns Component query result with counts and details
 */
export async function queryComponentCount(
  projectId: string,
  componentType: string,
  utilityFilter?: string,
  sizeFilter?: string
): Promise<ComponentQueryResult> {
  const supabase = await createClient();

  console.log(`[Vision Queries] Querying ${componentType} counts for project ${projectId}${sizeFilter ? ` (size: ${sizeFilter})` : ''}`);

  try {
    // Build the search patterns for this component type
    const patterns = COMPONENT_PATTERNS[componentType.toLowerCase()] || [];
    if (patterns.length === 0) {
      // If no predefined pattern, use the component type directly
      patterns.push(new RegExp(componentType, 'i'));
    }

    // Query project_quantities table
    let query = supabase
      .from('project_quantities')
      .select('*')
      .eq('project_id', projectId)
      .order('sheet_number', { ascending: true });

    const { data: quantities, error } = await query;

    if (error) {
      console.error('[Vision Queries] Error querying quantities:', error);
      throw error;
    }

    // First, filter out items with suspicious station numbers
    const { valid: validQuantities, filtered: suspiciousQuantities } = filterSuspiciousEntries(quantities || []);

    if (suspiciousQuantities.length > 0) {
      console.log(`[Vision Queries] Excluded ${suspiciousQuantities.length} items with suspicious stations`);
    }

    // Filter by component type, optional utility filter, and optional size filter
    const matchingItems = validQuantities.filter(qty => {
      const itemName = (qty.item_name || '').toLowerCase();
      const description = (qty.description || '').toLowerCase();

      // Check if matches component type
      const matchesComponent = patterns.some(pattern =>
        pattern.test(itemName) || pattern.test(description)
      );

      if (!matchesComponent) return false;

      // Apply size filter if provided (e.g., "12-IN" for 12-inch only)
      if (sizeFilter) {
        // Check both the extracted size and the size field if it exists
        const extractedSize = extractSize(qty.item_name || '');
        const storedSize = qty.size ? qty.size.toUpperCase() : null;
        const normalizedFilter = sizeFilter.toUpperCase().replace(/\s+/g, '-');

        // Extract just the number from the filter
        const filterNum = normalizedFilter.match(/(\d+)/)?.[1];

        // Check stored size first (more reliable), then extracted
        const sizeToCheck = storedSize || extractedSize;
        const sizeNum = sizeToCheck?.match(/(\d+)/)?.[1];

        if (!sizeNum || !filterNum || sizeNum !== filterNum) {
          return false;
        }

        console.log(`[Vision Queries] Size match: ${qty.item_name} -> size=${sizeToCheck}, filter=${sizeFilter}`);
      }

      // Apply utility filter if provided
      if (utilityFilter) {
        const utilityNorm = utilityFilter.toLowerCase();
        // Check if item is associated with the specified utility
        const metadata = qty.metadata as Record<string, any> | null;
        return itemName.includes(utilityNorm) ||
               (metadata?.systemName || '').toLowerCase().includes(utilityNorm);
      }

      return true;
    });

    // Aggregate counts
    const itemsBySize: Record<string, { count: number; items: any[] }> = {};
    let totalCount = 0;

    for (const item of matchingItems) {
      const size = extractSize(item.item_name) || 'Unknown';
      const qty = item.quantity || 1;

      if (!itemsBySize[size]) {
        itemsBySize[size] = { count: 0, items: [] };
      }

      itemsBySize[size].count += qty;
      itemsBySize[size].items.push({
        itemName: item.item_name,
        quantity: qty,
        size,
        station: item.station_from,
        sheetNumber: item.sheet_number,
        confidence: item.confidence || 0.8
      });

      totalCount += qty;
    }

    // Format the answer
    const formattedAnswer = formatComponentAnswer(
      componentType,
      totalCount,
      itemsBySize,
      utilityFilter,
      sizeFilter
    );

    // Calculate average confidence
    const avgConfidence = matchingItems.length > 0
      ? matchingItems.reduce((sum, item) => sum + (item.confidence || 0.8), 0) / matchingItems.length
      : 0;

    console.log(`[Vision Queries] Found ${totalCount} ${componentType}(s) across ${matchingItems.length} records`);

    return {
      success: totalCount > 0,
      componentType,
      totalCount,
      items: Object.values(itemsBySize).flatMap(v => v.items),
      source: 'Vision-extracted data from project_quantities table',
      confidence: avgConfidence,
      formattedAnswer
    };

  } catch (error) {
    console.error('[Vision Queries] Error in queryComponentCount:', error);
    return {
      success: false,
      componentType,
      totalCount: 0,
      items: [],
      source: 'Error querying vision data',
      confidence: 0,
      formattedAnswer: `Error querying ${componentType} data: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Extract size from item name (e.g., "12-IN GATE VALVE" -> "12-IN")
 */
function extractSize(itemName: string): string | null {
  const match = itemName.match(/(\d+[\-"]?\s*(?:IN|INCH|")?)/i);
  if (match) {
    return match[1].toUpperCase().replace(/\s+/g, '-');
  }
  return null;
}

/**
 * Validate station number format
 * Valid: "0+00", "5+23.50", "24+93.06", "32+62.01"
 * Invalid: "2+16-27 RT", "Q/S 24-FT RT", "ROAD 'A' B STA 40+45.77"
 */
function isValidStationFormat(station: string | null | undefined): boolean {
  if (!station) return true; // Allow null/undefined stations

  // Valid format: digits + "+" + digits (optionally .digits)
  // Examples: "0+00", "24+93.06", "32+62.01"
  const validStationPattern = /^\d{1,3}\+\d{2}(\.\d{1,2})?$/;

  // Check for invalid patterns (offset measurements, road references, etc.)
  const invalidPatterns = [
    /RT$/i,           // Ends with "RT" (offset: "27+10.47 RT")
    /LT$/i,           // Ends with "LT" (offset)
    /Q\/S/i,          // Offset measurement
    /O\/S/i,          // Offset measurement
    /DEFL/i,          // Deflection annotation
    /-\d+-/,          // Pattern like "2+16-27" (malformed)
    /ROAD/i,          // Road reference
    /MATCH\s*LINE/i,  // Match line reference
  ];

  // If it matches any invalid pattern, reject
  for (const pattern of invalidPatterns) {
    if (pattern.test(station)) {
      return false;
    }
  }

  // Must match valid format
  return validStationPattern.test(station);
}

/**
 * Filter out items with suspicious station numbers
 */
function filterSuspiciousEntries(items: any[]): { valid: any[], filtered: any[] } {
  const valid: any[] = [];
  const filtered: any[] = [];

  for (const item of items) {
    const station = item.station_from || item.station;

    if (!isValidStationFormat(station)) {
      console.warn(`[Vision Queries] Filtering suspicious station: "${station}" for item ${item.item_name}`);
      filtered.push(item);
    } else {
      valid.push(item);
    }
  }

  if (filtered.length > 0) {
    console.warn(`[Vision Queries] Filtered ${filtered.length} items with suspicious stations`);
  }

  return { valid, filtered };
}

/**
 * Format component count answer
 */
function formatComponentAnswer(
  componentType: string,
  totalCount: number,
  itemsBySize: Record<string, { count: number; items: any[] }>,
  utilityFilter?: string,
  sizeFilter?: string
): string {
  const filterDesc = [
    sizeFilter ? `${sizeFilter}` : null,
    utilityFilter ? `for ${utilityFilter}` : null
  ].filter(Boolean).join(' ');

  if (totalCount === 0) {
    return `No ${sizeFilter ? `${sizeFilter} ` : ''}${componentType}s found${utilityFilter ? ` for ${utilityFilter}` : ''} in the vision-extracted data.`;
  }

  const lines: string[] = [];

  // Build title
  const sizeDesc = sizeFilter ? `${sizeFilter} ` : '';
  const utilityDesc = utilityFilter ? ` for ${utilityFilter}` : '';
  lines.push(`**${sizeDesc}${componentType.charAt(0).toUpperCase() + componentType.slice(1)} Count${utilityDesc}:**\n`);

  // Summary by size
  const sizes = Object.keys(itemsBySize).sort();
  if (sizes.length > 1 || sizes[0] !== 'Unknown') {
    lines.push('| Size | Count |');
    lines.push('|------|-------|');
    for (const size of sizes) {
      lines.push(`| ${size} | ${itemsBySize[size].count} |`);
    }
    lines.push('');
  }

  // Detail table (limit to 20 rows for readability)
  const allItems = Object.values(itemsBySize).flatMap(v => v.items);
  if (allItems.length <= 20) {
    lines.push('**Detail:**');
    lines.push('| Sheet | Station | Size | Qty | Item |');
    lines.push('|-------|---------|------|-----|------|');
    for (const item of allItems) {
      lines.push(`| ${item.sheetNumber || '-'} | ${item.station || '-'} | ${item.size || '-'} | ${item.quantity} | ${item.itemName} |`);
    }
    lines.push('');
  }

  lines.push(`**TOTAL: ${totalCount} ${componentType}(s)**`);
  lines.push(`\nSource: Vision-extracted data from construction plans`);

  return lines.join('\n');
}

/**
 * Query for utility crossings
 *
 * @param projectId - Project ID
 * @param utilityFilter - Optional filter for specific utility type
 * @returns Crossing query result
 */
export async function queryCrossings(
  projectId: string,
  utilityFilter?: string
): Promise<CrossingQueryResult> {
  console.log(`[Vision Queries] Querying crossings for project ${projectId}`);

  try {
    // Get all crossings
    const crossings = await getUtilityCrossings(projectId, utilityFilter);

    // Get summary by type
    const summary = await countCrossingsByType(projectId);

    // Format the answer
    const formattedAnswer = formatCrossingAnswer(crossings, summary, utilityFilter);

    console.log(`[Vision Queries] Found ${crossings.length} crossings`);

    // Calculate average confidence
    const avgConfidence = crossings.length > 0
      ? crossings.reduce((sum: number, c: any) => sum + (c.confidence || 0.8), 0) / crossings.length
      : 0;

    return {
      success: crossings.length > 0,
      totalCrossings: crossings.length,
      crossings: crossings.map(c => ({
        crossingUtility: c.crossing_utility,
        utilityFullName: c.utility_full_name,
        station: c.station,
        elevation: c.elevation,
        isExisting: c.is_existing,
        isProposed: c.is_proposed,
        size: c.size,
        sheetNumber: c.sheet_number,
        confidence: c.confidence || 0.8
      })),
      summary,
      source: 'Vision-extracted data from utility_crossings table',
      confidence: avgConfidence,
      formattedAnswer
    };

  } catch (error) {
    console.error('[Vision Queries] Error in queryCrossings:', error);
    return {
      success: false,
      totalCrossings: 0,
      crossings: [],
      summary: [],
      source: 'Error querying crossing data',
      confidence: 0,
      formattedAnswer: `Error querying crossing data: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Format crossing answer
 */
function formatCrossingAnswer(
  crossings: any[],
  summary: any[],
  utilityFilter?: string
): string {
  if (crossings.length === 0) {
    return `No utility crossings found${utilityFilter ? ` for ${utilityFilter}` : ''} in the vision-extracted data.`;
  }

  const lines: string[] = [];

  lines.push(`**Utility Crossings${utilityFilter ? ` (filtered: ${utilityFilter})` : ''}:**\n`);

  // Summary by utility type
  if (summary.length > 0) {
    lines.push('**Summary by Utility Type:**');
    lines.push('| Utility | Total | Existing | Proposed |');
    lines.push('|---------|-------|----------|----------|');
    for (const s of summary) {
      lines.push(`| ${s.utilityFullName} (${s.crossingUtility}) | ${s.totalCount} | ${s.existingCount} | ${s.proposedCount} |`);
    }
    lines.push('');
  }

  // Detail table
  lines.push('**Crossing Details:**');
  lines.push('| Station | Utility | Elevation | Type | Size | Sheet |');
  lines.push('|---------|---------|-----------|------|------|-------|');
  for (const c of crossings.slice(0, 30)) { // Limit to 30 rows
    const type = c.is_existing ? 'Existing' : (c.is_proposed ? 'Proposed' : 'Unknown');
    const elevation = c.elevation ? `${c.elevation.toFixed(2)} ft` : '-';
    lines.push(`| ${c.station || '-'} | ${c.utility_full_name} (${c.crossing_utility}) | ${elevation} | ${type} | ${c.size || '-'} | ${c.sheet_number || '-'} |`);
  }

  if (crossings.length > 30) {
    lines.push(`\n*... and ${crossings.length - 30} more crossings*`);
  }

  lines.push(`\n**TOTAL: ${crossings.length} utility crossing(s)**`);
  lines.push(`\nSource: Vision analysis of profile views`);

  return lines.join('\n');
}

/**
 * Query for utility length from termination points
 *
 * @param projectId - Project ID
 * @param utilityName - Utility name to search for
 * @returns Length query result
 */
export async function queryUtilityLength(
  projectId: string,
  utilityName: string
): Promise<LengthQueryResult> {
  console.log(`[Vision Queries] Querying length for "${utilityName}" in project ${projectId}`);

  try {
    // Try to calculate from termination points
    const lengthResult = await calculateLengthFromTerminations(projectId, utilityName);

    if (lengthResult) {
      const formattedAnswer = formatLengthAnswer(lengthResult);

      console.log(`[Vision Queries] Found length: ${lengthResult.lengthLf.toFixed(2)} LF`);

      return {
        success: true,
        utilityName: lengthResult.utilityName,
        lengthLf: lengthResult.lengthLf,
        beginStation: lengthResult.beginStation,
        endStation: lengthResult.endStation,
        beginSheet: lengthResult.beginSheet,
        endSheet: lengthResult.endSheet,
        confidence: lengthResult.confidence,
        source: 'Calculated from vision-extracted BEGIN/END termination points',
        formattedAnswer
      };
    }

    // Check for partial termination data
    const terminationPoints = await getTerminationPointsForUtility(projectId, utilityName);

    if (terminationPoints.length > 0) {
      const hasBegin = terminationPoints.some((p: any) => p.termination_type === 'BEGIN');
      const hasEnd = terminationPoints.some((p: any) => p.termination_type === 'END');

      let message = `Found partial termination data for "${utilityName}":\n`;
      message += formatTerminationSummary(terminationPoints);
      message += `\n\n⚠️ Cannot calculate length: Missing ${!hasBegin ? 'BEGIN' : ''} ${!hasBegin && !hasEnd ? 'and ' : ''}${!hasEnd ? 'END' : ''} termination point(s).`;

      return {
        success: false,
        utilityName,
        lengthLf: 0,
        beginStation: hasBegin ? terminationPoints.find((p: any) => p.termination_type === 'BEGIN')?.station : '',
        endStation: hasEnd ? terminationPoints.find((p: any) => p.termination_type === 'END')?.station : '',
        confidence: 0,
        source: 'Partial termination data found',
        formattedAnswer: message
      };
    }

    return {
      success: false,
      utilityName,
      lengthLf: 0,
      beginStation: '',
      endStation: '',
      confidence: 0,
      source: 'No termination points found',
      formattedAnswer: `No termination points (BEGIN/END labels) found for "${utilityName}" in the vision-extracted data.`
    };

  } catch (error) {
    console.error('[Vision Queries] Error in queryUtilityLength:', error);
    return {
      success: false,
      utilityName,
      lengthLf: 0,
      beginStation: '',
      endStation: '',
      confidence: 0,
      source: 'Error querying length data',
      formattedAnswer: `Error querying length data: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Format length answer
 */
function formatLengthAnswer(lengthResult: {
  utilityName: string;
  beginStation: string;
  endStation: string;
  beginSheet: string;
  endSheet: string;
  lengthLf: number;
  confidence: number;
}): string {
  const lines: string[] = [];

  lines.push(`**${lengthResult.utilityName} Length:**\n`);

  lines.push('| | Station | Sheet |');
  lines.push('|--|---------|-------|');
  lines.push(`| BEGIN | ${lengthResult.beginStation} | ${lengthResult.beginSheet} |`);
  lines.push(`| END | ${lengthResult.endStation} | ${lengthResult.endSheet} |`);
  lines.push('');

  lines.push(`**Calculation:**`);
  lines.push(`${lengthResult.endStation} - ${lengthResult.beginStation} = **${lengthResult.lengthLf.toFixed(2)} LF**`);
  lines.push('');

  lines.push(`Confidence: ${(lengthResult.confidence * 100).toFixed(0)}%`);
  lines.push(`Source: Vision-extracted termination points from actual drawings`);

  return lines.join('\n');
}

/**
 * Get vision data summary for a project
 *
 * @param projectId - Project ID
 * @returns Summary of all vision-extracted data
 */
export async function getVisionDataSummary(projectId: string): Promise<{
  quantityCount: number;
  terminationPointCount: number;
  crossingCount: number;
  hasVisionData: boolean;
}> {
  const supabase = await createClient();

  try {
    // Count quantities
    const { count: quantityCount } = await supabase
      .from('project_quantities')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);

    // Count termination points (cast to any to handle table not in generated types)
    const { count: terminationPointCount } = await (supabase as any)
      .from('utility_termination_points')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);

    // Count crossings (cast to any to handle table not in generated types)
    const { count: crossingCount } = await (supabase as any)
      .from('utility_crossings')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);

    const hasVisionData = (quantityCount || 0) > 0 ||
                          (terminationPointCount || 0) > 0 ||
                          (crossingCount || 0) > 0;

    console.log(`[Vision Queries] Project ${projectId} vision data summary:`, {
      quantities: quantityCount || 0,
      terminationPoints: terminationPointCount || 0,
      crossings: crossingCount || 0
    });

    return {
      quantityCount: quantityCount || 0,
      terminationPointCount: terminationPointCount || 0,
      crossingCount: crossingCount || 0,
      hasVisionData
    };

  } catch (error) {
    console.error('[Vision Queries] Error getting vision data summary:', error);
    return {
      quantityCount: 0,
      terminationPointCount: 0,
      crossingCount: 0,
      hasVisionData: false
    };
  }
}

/**
 * Determine the best data source for a query
 */
export function determineVisionQueryType(query: string): 'component' | 'crossing' | 'length' | 'none' {
  const normalized = query.toLowerCase();

  // Check for component count queries
  const componentType = detectComponentType(query);
  if (componentType) {
    // Check if asking "how many" or similar
    if (/how\s+many|count|total|number\s+of|list\s+all/i.test(normalized)) {
      return 'component';
    }
  }

  // Check for crossing queries
  if (/cross|crossing|conflict|intersect|interference|what\s+utilities/i.test(normalized)) {
    return 'crossing';
  }

  // Check for length queries
  if (/how\s+long|length|footage|total\s+feet|linear\s+feet|lf|begin.*end|end.*begin/i.test(normalized)) {
    return 'length';
  }

  return 'none';
}
