/**
 * Quantity Extraction and Storage
 *
 * Processes vision analysis results and stores structured quantities in the database
 * for fast lookup during chat queries.
 */

import { createClient } from '@/lib/db/supabase/server';
import type { VisionAnalysisResult } from '@/lib/vision/claude-vision';

/**
 * Extracted quantity ready for database storage
 */
export interface ExtractedQuantity {
  itemName: string;
  itemType?: string;
  itemNumber?: string;
  quantity?: number;
  unit?: string;
  description?: string;
  stationFrom?: string;
  stationTo?: string;
  locationDescription?: string;
  sheetNumber?: string;
  sourceType: 'vision' | 'text' | 'calculated' | 'manual';
  confidence: number;
  metadata?: Record<string, any>;
}

/**
 * Categorize item type from item name
 */
function categorizeItemType(itemName: string): string | undefined {
  const normalized = itemName.toLowerCase();

  // Water/sewer/storm patterns
  if (normalized.match(/water.*line|wl-|potable|domestic water/i)) {
    return 'waterline';
  }
  if (normalized.match(/storm.*drain|sd-|storm.*sewer|storm.*water/i)) {
    return 'storm_drain';
  }
  if (normalized.match(/sanitary.*sewer|ss-|sewer.*line|wastewater/i)) {
    return 'sewer';
  }

  // Paving
  if (normalized.match(/paving|pavement|asphalt|ac|concrete|pcc/i)) {
    return 'paving';
  }

  // Curb and gutter
  if (normalized.match(/curb|gutter|c&g/i)) {
    return 'curb_gutter';
  }

  // Sidewalk
  if (normalized.match(/sidewalk|pedestrian|walkway/i)) {
    return 'sidewalk';
  }

  // Grading
  if (normalized.match(/grading|earthwork|excavation|fill|cut/i)) {
    return 'grading';
  }

  // Drainage
  if (normalized.match(/drain|drainage|culvert/i)) {
    return 'drainage';
  }

  // Utilities
  if (normalized.match(/electric|power|gas|telecom|fiber/i)) {
    return 'utility';
  }

  return undefined;
}

/**
 * Extract item number from item name (e.g., "Water Line A" -> "WL-A")
 */
function extractItemNumber(itemName: string): string | undefined {
  // Look for patterns like "WL-A", "SD-B", "SS-1"
  const match = itemName.match(/\b([A-Z]{1,3}[-_]?[A-Z0-9]{1,3})\b/);
  if (match) {
    return match[1];
  }

  // Try to extract from full name "Water Line A" -> "A"
  const suffixMatch = itemName.match(/\b([A-Z])\s*$/);
  if (suffixMatch) {
    return suffixMatch[1];
  }

  return undefined;
}

/**
 * Process vision analysis result and extract quantities
 *
 * @param visionResult - Result from Claude Vision analysis
 * @param sheetNumber - Sheet number for reference
 * @returns Array of extracted quantities ready for storage
 */
export function processVisionForQuantities(
  visionResult: VisionAnalysisResult,
  sheetNumber?: string
): ExtractedQuantity[] {
  const quantities: ExtractedQuantity[] = [];

  // Process quantities from vision result
  for (const visionQty of visionResult.quantities) {
    const itemName = visionQty.itemName.trim();
    if (!itemName) continue;

    const extracted: ExtractedQuantity = {
      itemName,
      itemType: categorizeItemType(itemName),
      itemNumber: visionQty.itemNumber || extractItemNumber(itemName),
      quantity: visionQty.quantity,
      unit: visionQty.unit,
      description: visionQty.description,
      stationFrom: visionQty.stationFrom,
      stationTo: visionQty.stationTo,
      sheetNumber: sheetNumber || visionResult.sheetMetadata.sheetNumber,
      sourceType: 'vision',
      confidence: visionQty.confidence,
      metadata: {
        extractedFrom: 'vision_analysis',
        sheetTitle: visionResult.sheetMetadata.sheetTitle,
        discipline: visionResult.sheetMetadata.discipline
      }
    };

    quantities.push(extracted);
  }

  return quantities;
}

/**
 * Normalize station for comparison (handles variations like "13+00" vs "13+00.00")
 */
function normalizeStationForComparison(station: string | undefined): string {
  if (!station) return '';
  // Remove spaces and convert to lowercase
  let normalized = station.trim().toLowerCase();
  // Remove "sta" prefix
  normalized = normalized.replace(/^sta\s*/i, '');
  // Ensure consistent format: pad to XX+XX.XX
  const match = normalized.match(/(\d+)\+(\d+(?:\.\d+)?)/);
  if (match) {
    const major = match[1].padStart(2, '0');
    const minor = parseFloat(match[2]).toFixed(2);
    return `${major}+${minor}`;
  }
  return normalized;
}

/**
 * Check if two stations are approximately equal (within 1 foot tolerance)
 */
function stationsApproximatelyEqual(sta1: string | undefined | null, sta2: string | undefined | null): boolean {
  if (!sta1 && !sta2) return true;
  if (!sta1 || !sta2) return false;

  const norm1 = normalizeStationForComparison(sta1);
  const norm2 = normalizeStationForComparison(sta2);

  // Parse to numeric for comparison
  const parse = (s: string): number => {
    const match = s.match(/(\d+)\+(\d+(?:\.\d+)?)/);
    if (match) {
      return parseFloat(match[1]) * 100 + parseFloat(match[2]);
    }
    return 0;
  };

  const val1 = parse(norm1);
  const val2 = parse(norm2);

  // Within 1 foot tolerance
  return Math.abs(val1 - val2) <= 1;
}

/**
 * Store extracted quantities in the database with deduplication
 *
 * @param projectId - Project ID
 * @param documentId - Document ID
 * @param chunkId - Chunk ID (optional)
 * @param quantities - Array of quantities to store
 * @returns Number of quantities stored
 */
export async function storeQuantitiesInDatabase(
  projectId: string,
  documentId: string,
  chunkId: string | null,
  quantities: ExtractedQuantity[]
): Promise<number> {
  if (quantities.length === 0) {
    return 0;
  }

  const supabase = await createClient();

  // Step 1: Fetch existing quantities for this project to check for duplicates
  const { data: existingQuantities } = await supabase
    .from('project_quantities')
    .select('item_name, station_from')
    .eq('project_id', projectId);

  const existing = existingQuantities || [];

  // Step 2: Filter out duplicates
  const uniqueQuantities = quantities.filter(qty => {
    const normalizedName = qty.itemName.toLowerCase().trim();

    // Check if this item+station combo already exists
    const isDuplicate = existing.some(ex => {
      const exName = (ex.item_name || '').toLowerCase().trim();
      const nameMatch = exName === normalizedName ||
                       exName.includes(normalizedName) ||
                       normalizedName.includes(exName);
      const stationMatch = stationsApproximatelyEqual(qty.stationFrom, ex.station_from);
      return nameMatch && stationMatch;
    });

    if (isDuplicate) {
      console.log(`[Dedup] Skipping duplicate: ${qty.itemName} at ${qty.stationFrom || 'unknown'}`);
    }
    return !isDuplicate;
  });

  console.log(`[Dedup] ${quantities.length} quantities received, ${uniqueQuantities.length} unique (${quantities.length - uniqueQuantities.length} duplicates skipped)`);

  if (uniqueQuantities.length === 0) {
    return 0;
  }

  // Step 3: Prepare records for insertion
  const records = uniqueQuantities.map(qty => ({
    project_id: projectId,
    document_id: documentId,
    chunk_id: chunkId,
    item_name: qty.itemName,
    item_type: qty.itemType,
    item_number: qty.itemNumber,
    quantity: qty.quantity,
    unit: qty.unit,
    description: qty.description,
    station_from: qty.stationFrom,
    station_to: qty.stationTo,
    location_description: qty.locationDescription,
    sheet_number: qty.sheetNumber,
    source_type: qty.sourceType,
    confidence: qty.confidence,
    metadata: qty.metadata
  }));

  // Step 4: Insert into database
  const { data, error } = await supabase
    .from('project_quantities')
    .insert(records)
    .select();

  if (error) {
    console.error('Error storing quantities in database:', error);
    throw new Error(`Failed to store quantities: ${error.message}`);
  }

  return data?.length || 0;
}

/**
 * Update document chunk with vision data
 *
 * @param chunkId - Chunk ID to update
 * @param visionResult - Vision analysis result
 * @param sheetType - Type of sheet
 * @param isCritical - Whether this is a critical sheet
 * @returns Success status
 */
export async function updateChunkWithVisionData(
  chunkId: string,
  visionResult: VisionAnalysisResult,
  sheetType?: string,
  isCritical?: boolean
): Promise<boolean> {
  const supabase = await createClient();

  // Extract station numbers for easy querying
  const stations = visionResult.stations.map(s => s.station);

  // Prepare quantities for storage in JSONB
  const extractedQuantities = visionResult.quantities.map(q => ({
    itemName: q.itemName,
    itemNumber: q.itemNumber,
    quantity: q.quantity,
    unit: q.unit,
    description: q.description,
    confidence: q.confidence
  }));

  const { error } = await supabase
    .from('document_chunks')
    .update({
      vision_data: visionResult.rawAnalysis,
      is_critical_sheet: isCritical,
      extracted_quantities: extractedQuantities.length > 0 ? extractedQuantities : null,
      stations: stations.length > 0 ? stations : null,
      sheet_type: sheetType || visionResult.sheetMetadata.sheetType,
      vision_processed_at: new Date().toISOString(),
      vision_model_version: 'claude-sonnet-4-5-20250929'
    })
    .eq('id', chunkId);

  if (error) {
    console.error('Error updating chunk with vision data:', error);
    return false;
  }

  return true;
}

/**
 * Search for quantities by item name with fuzzy matching
 *
 * @param projectId - Project ID
 * @param searchTerm - Search term (e.g., "waterline a", "WL-A")
 * @param limit - Maximum results to return
 * @returns Array of matching quantities
 */
export async function searchQuantities(
  projectId: string,
  searchTerm: string,
  limit: number = 10
): Promise<any[]> {
  const supabase = await createClient();

  console.log(`[searchQuantities] Searching for "${searchTerm}" in project ${projectId}`);

  // Use the database function for fuzzy search
  const { data, error } = await supabase
    .rpc('search_quantities', {
      p_project_id: projectId,
      p_search_term: searchTerm,
      p_limit: limit
    });

  if (error) {
    console.error('[searchQuantities] Error:', error);
    throw new Error(`Failed to search quantities: ${error.message}`);
  }

  console.log(`[searchQuantities] Found ${data?.length || 0} results`);
  if (data && data.length > 0) {
    const topResult = data[0];
    console.log(`[searchQuantities] Top result: ${topResult.item_name} (similarity: ${((topResult.similarity ?? 0) * 100).toFixed(0)}%, confidence: ${((topResult.confidence ?? 0) * 100).toFixed(0)}%)`);
  }

  return data || [];
}

/**
 * Get all quantities for a project
 *
 * @param projectId - Project ID
 * @param filters - Optional filters
 * @returns Array of quantities
 */
export async function getProjectQuantities(
  projectId: string,
  filters?: {
    itemType?: string;
    minConfidence?: number;
    sheetNumber?: string;
  }
): Promise<any[]> {
  const supabase = await createClient();

  let query = supabase
    .from('project_quantities')
    .select('*')
    .eq('project_id', projectId)
    .order('confidence', { ascending: false });

  if (filters?.itemType) {
    query = query.eq('item_type', filters.itemType);
  }

  if (filters?.minConfidence !== undefined) {
    query = query.gte('confidence', filters.minConfidence);
  }

  if (filters?.sheetNumber) {
    query = query.eq('sheet_number', filters.sheetNumber);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching project quantities:', error);
    throw new Error(`Failed to fetch quantities: ${error.message}`);
  }

  return data || [];
}

/**
 * Get quantity summary by item type for a project
 *
 * @param projectId - Project ID
 * @returns Summary grouped by item type
 */
export async function getQuantitySummary(projectId: string): Promise<any[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('project_quantity_summary')
    .select('*')
    .eq('project_id', projectId);

  if (error) {
    console.error('Error fetching quantity summary:', error);
    throw new Error(`Failed to fetch quantity summary: ${error.message}`);
  }

  return data || [];
}

/**
 * Fuzzy match item names for query preprocessing
 *
 * Uses Levenshtein distance for matching
 *
 * @param query - User's query text
 * @param itemNames - Array of known item names
 * @param threshold - Maximum distance (default: 3)
 * @returns Best matching item name or null
 */
export function fuzzyMatchItemName(
  query: string,
  itemNames: string[],
  threshold: number = 3
): string | null {
  const normalizeForComparison = (str: string) =>
    str.toLowerCase().replace(/[^a-z0-9]/g, '');

  const normalizedQuery = normalizeForComparison(query);

  let bestMatch: string | null = null;
  let bestScore = Infinity;

  for (const itemName of itemNames) {
    const normalized = normalizeForComparison(itemName);

    // Calculate Levenshtein distance
    const distance = levenshteinDistance(normalizedQuery, normalized);

    if (distance < bestScore && distance <= threshold) {
      bestScore = distance;
      bestMatch = itemName;
    }

    // Also check if query is contained in item name
    if (normalized.includes(normalizedQuery)) {
      return itemName;
    }
  }

  return bestMatch;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,    // deletion
          matrix[i][j - 1] + 1,    // insertion
          matrix[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }

  return matrix[len1][len2];
}
