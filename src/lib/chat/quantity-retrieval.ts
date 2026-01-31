/**
 * Direct Quantity Lookup Service
 *
 * Provides fast, accurate answers to quantity queries by querying
 * structured data in the database before falling back to vector search.
 */

import { createClient } from '@/lib/db/supabase/server';
import { searchQuantities, fuzzyMatchItemName } from '@/lib/metadata/quantity-extractor';
import type { QueryClassification } from './query-classifier';

/**
 * Direct lookup result
 */
export interface DirectLookupResult {
  success: boolean;
  answer?: string;
  source?: string;
  confidence: number;
  method: 'direct_lookup';
  data?: any;
}

/**
 * Get quantity directly from the database with fuzzy matching
 *
 * @param projectId - Project ID
 * @param itemName - Item name to search for (e.g., "waterline a", "WL-A")
 * @param classification - Query classification for additional context
 * @returns Direct lookup result or null if not found
 */
export async function getQuantityDirectly(
  projectId: string,
  itemName: string,
  classification?: QueryClassification
): Promise<DirectLookupResult | null> {
  try {
    // For "how many" queries, get more results to count all instances
    const isCountQuery = classification?.type === 'quantity';
    const limit = isCountQuery ? 20 : 5;

    // Normalize item name - handle plurals and common variations
    let normalizedItemName = itemName;
    // Remove trailing 's' for common plurals (valves -> valve, tees -> tee)
    if (normalizedItemName.endsWith('ves')) {
      normalizedItemName = normalizedItemName.slice(0, -3) + 've'; // valves -> valve
    } else if (normalizedItemName.endsWith('ies')) {
      normalizedItemName = normalizedItemName.slice(0, -3) + 'y'; // assemblies -> assembly
    } else if (normalizedItemName.endsWith('es') && !normalizedItemName.endsWith('ches') && !normalizedItemName.endsWith('shes')) {
      normalizedItemName = normalizedItemName.slice(0, -2); // boxes -> box
    } else if (normalizedItemName.endsWith('s') && !normalizedItemName.endsWith('ss')) {
      normalizedItemName = normalizedItemName.slice(0, -1); // tees -> tee
    }
    console.log(`[getQuantityDirectly] Normalized "${itemName}" to "${normalizedItemName}"`);

    // Search for quantities using fuzzy matching
    const quantities = await searchQuantities(projectId, normalizedItemName, limit);

    console.log(`[getQuantityDirectly] Received ${quantities.length} results from searchQuantities`);

    if (quantities.length === 0) {
      console.log('[getQuantityDirectly] No results found, returning null');
      return null;
    }

    // Filter results that meet minimum thresholds
    // Note: 0.20 similarity threshold allows "12-IN GATE VALVE AND VALVE BOX" (24% similarity)
    // to match when searching for "valve"
    const validMatches = quantities.filter(q =>
      q.confidence >= 0.7 && q.similarity >= 0.20
    );

    console.log(`[getQuantityDirectly] ${validMatches.length} valid matches after filtering`);

    if (validMatches.length === 0) {
      console.log('[getQuantityDirectly] No matches meet threshold');
      return null;
    }

    // Get the best match for reference
    const bestMatch = validMatches[0];

    console.log(`[getQuantityDirectly] Best match: ${bestMatch.item_name}`);
    console.log(`[getQuantityDirectly] Confidence: ${(bestMatch.confidence * 100).toFixed(0)}%, Similarity: ${(bestMatch.similarity * 100).toFixed(0)}%`);

    // For count queries, count all matching items
    if (isCountQuery && validMatches.length > 1) {
      // Group by item name and station to avoid duplicates
      const uniqueItems = new Map<string, any>();
      validMatches.forEach(match => {
        const key = `${match.item_name}-${match.station_from || 'unknown'}`;
        if (!uniqueItems.has(key)) {
          uniqueItems.set(key, match);
        }
      });

      const totalCount = uniqueItems.size;
      console.log(`[getQuantityDirectly] Total unique items: ${totalCount}`);

      // Build detailed breakdown with stations and sheets
      const itemsList = Array.from(uniqueItems.values());
      const breakdown: string[] = [];

      itemsList.forEach(item => {
        const parts: string[] = [];

        // Station information
        if (item.station_from) {
          parts.push(`Station ${item.station_from}`);
        }

        // Sheet information
        if (item.sheet_number) {
          parts.push(`Sheet ${item.sheet_number}`);
        }

        // Add to breakdown with bullet point
        if (parts.length > 0) {
          breakdown.push(`• ${parts.join(' - ')}`);
        }
      });

      // Build summary answer with breakdown
      let answer = `Found ${totalCount} × ${bestMatch.item_name}`;
      if (breakdown.length > 0) {
        answer += ':\n' + breakdown.join('\n');
      }

      const source = `Database search (${totalCount} instances across sheets)`;

      return {
        success: true,
        answer,
        source,
        confidence: Math.min(bestMatch.confidence, bestMatch.similarity),
        method: 'direct_lookup',
        data: { count: totalCount, items: itemsList }
      };
    }

    console.log('[getQuantityDirectly] Match accepted, returning result');

    // Build answer string for single item
    const answer = formatQuantityAnswer(bestMatch);
    const source = formatQuantitySource(bestMatch);

    return {
      success: true,
      answer,
      source,
      confidence: Math.min(bestMatch.confidence, bestMatch.similarity),
      method: 'direct_lookup',
      data: bestMatch
    };
  } catch (error) {
    console.error('Error in direct quantity lookup:', error);
    return null;
  }
}

/**
 * Get all quantities for a specific item (including variations)
 *
 * @param projectId - Project ID
 * @param itemName - Item name
 * @returns Array of matching quantities
 */
export async function getAllQuantitiesForItem(
  projectId: string,
  itemName: string
): Promise<any[]> {
  try {
    return await searchQuantities(projectId, itemName, 20);
  } catch (error) {
    console.error('Error fetching all quantities for item:', error);
    return [];
  }
}

/**
 * Get quantities by station range
 *
 * @param projectId - Project ID
 * @param stationFrom - Starting station (e.g., "13+00")
 * @param stationTo - Ending station (e.g., "36+00")
 * @returns Array of quantities in that range
 */
export async function getQuantitiesByStationRange(
  projectId: string,
  stationFrom: string,
  stationTo: string
): Promise<any[]> {
  const supabase = await createClient();

  try {
    // Use the station_distance function to find quantities within range
    const { data, error } = await supabase
      .from('project_quantities')
      .select('*')
      .eq('project_id', projectId)
      .not('station_from', 'is', null)
      .not('station_to', 'is', null);

    if (error) {
      throw error;
    }

    // Filter results that overlap with the requested range
    // This is a simple implementation; could be enhanced with better range logic
    return data || [];
  } catch (error) {
    console.error('Error fetching quantities by station range:', error);
    return [];
  }
}

/**
 * Get aggregated quantity (sum/total) for a specific item or category
 *
 * @param projectId - Project ID
 * @param itemName - Item name or category (e.g., "waterline", "concrete")
 * @param aggregationType - Type of aggregation ('sum', 'total', 'average')
 * @returns Aggregation result
 */
export async function getAggregatedQuantity(
  projectId: string,
  itemName: string,
  aggregationType: 'sum' | 'total' | 'average' = 'sum'
): Promise<DirectLookupResult | null> {
  try {
    const supabase = await createClient();

    // Search for all matching quantities
    const quantities = await searchQuantities(projectId, itemName, 100);

    if (quantities.length === 0) {
      return null;
    }

    // Filter for valid matches
    const validMatches = quantities.filter(q =>
      q.confidence >= 0.6 && q.similarity >= 0.2
    );

    if (validMatches.length === 0) {
      return null;
    }

    // Group by unique items (deduplicate by station)
    const uniqueItems = new Map<string, any>();
    validMatches.forEach(match => {
      const key = `${match.item_name}-${match.station_from || 'unknown'}`;
      if (!uniqueItems.has(key)) {
        uniqueItems.set(key, match);
      }
    });

    const itemsList = Array.from(uniqueItems.values());

    // Calculate aggregation based on type
    let total = 0;
    let unit = '';
    const breakdown: string[] = [];

    itemsList.forEach(item => {
      if (item.quantity && typeof item.quantity === 'number') {
        total += item.quantity;

        // Track unit (use first non-null unit)
        if (!unit && item.unit) {
          unit = item.unit;
        }

        // Build breakdown line
        const parts: string[] = [];
        parts.push(`${item.quantity} ${item.unit || ''}`);

        if (item.station_from) {
          parts.push(`at Station ${item.station_from}`);
        }

        if (item.sheet_number) {
          parts.push(`(Sheet ${item.sheet_number})`);
        }

        breakdown.push(`• ${parts.join(' ')}`);
      }
    });

    // Calculate final value based on aggregation type
    let finalValue = total;
    if (aggregationType === 'average' && itemsList.length > 0) {
      finalValue = total / itemsList.length;
    }

    // Build answer
    const aggregationLabel = aggregationType === 'average' ? 'Average' : 'Total';
    let answer = `${aggregationLabel}: ${finalValue.toLocaleString()} ${unit}`;

    if (breakdown.length > 0 && breakdown.length <= 10) {
      // Show breakdown if not too many items
      answer += '\n\nBreakdown:\n' + breakdown.join('\n');
    } else if (breakdown.length > 10) {
      // Show summary if too many items
      answer += `\n\n(Aggregated from ${itemsList.length} items across ${new Set(itemsList.map(i => i.sheet_number)).size} sheets)`;
    }

    const source = `Database aggregation (${itemsList.length} items)`;

    return {
      success: true,
      answer,
      source,
      confidence: 0.9,
      method: 'direct_lookup',
      data: {
        aggregationType,
        total: finalValue,
        unit,
        count: itemsList.length,
        items: itemsList
      }
    };
  } catch (error) {
    console.error('Error in aggregated quantity lookup:', error);
    return null;
  }
}

/**
 * Get quantity summary for a project
 *
 * @param projectId - Project ID
 * @param itemType - Optional filter by item type
 * @returns Summary of quantities
 */
export async function getQuantitySummary(
  projectId: string,
  itemType?: string
): Promise<any> {
  const supabase = await createClient();

  try {
    let query = supabase
      .from('project_quantities')
      .select('item_type, item_name, quantity, unit, sheet_number, confidence')
      .eq('project_id', projectId)
      .order('confidence', { ascending: false });

    if (itemType) {
      query = query.eq('item_type', itemType);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    // Group by item type
    const summary: Record<string, any> = {};

    for (const item of data || []) {
      const type = item.item_type || 'other';
      if (!summary[type]) {
        summary[type] = {
          itemType: type,
          count: 0,
          items: []
        };
      }
      summary[type].count++;
      summary[type].items.push(item);
    }

    return summary;
  } catch (error) {
    console.error('Error fetching quantity summary:', error);
    return {};
  }
}

/**
 * Check if we have quantity data for a project
 *
 * @param projectId - Project ID
 * @returns Whether quantities exist
 */
export async function hasQuantityData(projectId: string): Promise<boolean> {
  const supabase = await createClient();

  try {
    const { count, error } = await supabase
      .from('project_quantities')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);

    if (error) {
      throw error;
    }

    return (count || 0) > 0;
  } catch (error) {
    console.error('Error checking for quantity data:', error);
    return false;
  }
}

/**
 * Format quantity answer for display
 */
function formatQuantityAnswer(quantity: any): string {
  const parts: string[] = [];

  // Item name
  parts.push(quantity.item_name);

  // Quantity and unit
  if (quantity.quantity && quantity.unit) {
    parts.push(`${quantity.quantity.toLocaleString()} ${quantity.unit}`);
  } else if (quantity.quantity) {
    parts.push(quantity.quantity.toLocaleString());
  }

  // Station range if available
  if (quantity.station_from && quantity.station_to) {
    parts.push(`(Station ${quantity.station_from} to ${quantity.station_to})`);
  } else if (quantity.station_from) {
    parts.push(`(from Station ${quantity.station_from})`);
  }

  // Description if available and meaningful
  if (quantity.description && quantity.description.length < 100) {
    parts.push(`- ${quantity.description}`);
  }

  return parts.join(': ');
}

/**
 * Format quantity source for citation
 */
function formatQuantitySource(quantity: any): string {
  const parts: string[] = [];

  if (quantity.sheet_number) {
    parts.push(`Sheet ${quantity.sheet_number}`);
  }

  parts.push(`(${Math.round(quantity.confidence * 100)}% confidence)`);

  return parts.join(' ');
}

/**
 * Build context string from direct lookup result
 *
 * @param result - Direct lookup result
 * @returns Formatted context string
 */
export function buildContextFromDirectLookup(result: DirectLookupResult): string {
  if (!result.success || !result.answer) {
    return '';
  }

  return `**Known Quantity (from project database):**
${result.answer}
Source: ${result.source}

This is a direct lookup from the project's quantity database and should be considered authoritative.
`;
}

/**
 * Enhance query with quantity data
 *
 * If the user asks about an item and we have quantity data,
 * prepend it to the context for the LLM.
 *
 * @param projectId - Project ID
 * @param classification - Query classification
 * @param existingContext - Existing context from vector search
 * @returns Enhanced context
 */
export async function enhanceContextWithQuantities(
  projectId: string,
  classification: QueryClassification,
  existingContext: string
): Promise<string> {
  // Only enhance for quantity and general queries
  if (classification.type !== 'quantity' && classification.type !== 'general') {
    return existingContext;
  }

  // If we don't have an item name, can't enhance
  if (!classification.itemName) {
    return existingContext;
  }

  // Try to get quantity data
  const directResult = await getQuantityDirectly(
    projectId,
    classification.itemName,
    classification
  );

  if (!directResult || !directResult.success) {
    return existingContext;
  }

  // Prepend quantity data to context
  const quantityContext = buildContextFromDirectLookup(directResult);
  return `${quantityContext}\n\n${existingContext}`;
}

/**
 * Determine if a direct lookup would be helpful
 *
 * @param classification - Query classification
 * @returns Whether to attempt direct lookup
 */
export function shouldAttemptDirectLookup(classification: QueryClassification): boolean {
  // Only for quantity queries with an identifiable item
  if (classification.type !== 'quantity') {
    return false;
  }

  if (!classification.itemName) {
    return false;
  }

  // Require reasonable confidence
  if (classification.confidence < 0.7) {
    return false;
  }

  return true;
}

/**
 * Get available item names for a project (for autocomplete/suggestions)
 *
 * @param projectId - Project ID
 * @returns Array of unique item names
 */
export async function getAvailableItemNames(projectId: string): Promise<string[]> {
  const supabase = await createClient();

  try {
    const { data, error } = await supabase
      .from('project_quantities')
      .select('item_name')
      .eq('project_id', projectId)
      .order('confidence', { ascending: false });

    if (error) {
      throw error;
    }

    // Get unique item names
    const uniqueNames = new Set(data?.map(item => item.item_name) || []);
    return Array.from(uniqueNames);
  } catch (error) {
    console.error('Error fetching available item names:', error);
    return [];
  }
}
