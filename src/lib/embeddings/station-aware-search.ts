/**
 * Station-Aware Vector Search Enhancement
 *
 * Enhances semantic search with station proximity awareness and sheet type boosting
 * for more accurate results on construction plan queries.
 */

import { createClient } from '@/lib/db/supabase/server';
import type { QueryClassification } from '@/lib/chat/query-classifier';

/**
 * Enhanced search result with boosted scoring
 */
export interface EnhancedSearchResult {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  page_number: number | null;
  similarity: number;           // Original cosine similarity
  boosted_score: number;        // Similarity + boost factors
  document_filename: string;
  sheet_number: string | null;
  project_id: string;

  // Additional metadata from enhancement
  sheet_type?: string;
  stations?: string[];
  is_critical_sheet?: boolean;
  boost_factors?: {
    station_proximity?: number;
    sheet_type_match?: number;
    critical_sheet?: number;
    index_sheet_penalty?: number;
    total?: number;
  };
}

/**
 * Normalize station number for comparison
 */
function normalizeStation(station: string): string {
  // Remove "STA" prefix and spaces
  let normalized = station.replace(/^\s*STA\s*/i, '').trim();
  normalized = normalized.replace(/\s+/g, '');

  // Convert "13+68.83" to "001368.83" for numeric comparison
  if (normalized.includes('+')) {
    const parts = normalized.split('+');
    const major = parts[0].padStart(4, '0');
    const minor = parts[1] || '00';
    return major + minor;
  }

  return normalized;
}

/**
 * Calculate distance between two stations
 */
function calculateStationDistance(sta1: string, sta2: string): number | null {
  try {
    const norm1 = normalizeStation(sta1);
    const norm2 = normalizeStation(sta2);

    if (!norm1 || !norm2) {
      return null;
    }

    const val1 = parseFloat(norm1);
    const val2 = parseFloat(norm2);

    if (isNaN(val1) || isNaN(val2)) {
      return null;
    }

    return Math.abs(val1 - val2);
  } catch {
    return null;
  }
}

/**
 * Check if two stations are close (within threshold)
 */
function stationsAreClose(
  sta1: string,
  sta2: string,
  thresholdFeet: number = 500
): boolean {
  const distance = calculateStationDistance(sta1, sta2);
  if (distance === null) {
    return false;
  }

  // Station numbers are typically in 100-foot increments
  // Distance of 5.0 = 500 feet
  return distance <= (thresholdFeet / 100);
}

/**
 * Extract stations from query text
 */
function extractStationsFromQuery(query: string): string[] {
  const stations: string[] = [];

  // Pattern 1: "STA 13+00" or "Station 13+00"
  const pattern1 = /(?:STA|STATION)\s+([\d+.]+)/gi;
  let match;
  while ((match = pattern1.exec(query)) !== null) {
    stations.push(match[1]);
  }

  // Pattern 2: Direct format "13+00"
  const pattern2 = /\b(\d{1,3}\+\d{2}(?:\.\d+)?)\b/g;
  while ((match = pattern2.exec(query)) !== null) {
    stations.push(match[1]);
  }

  return stations;
}

/**
 * Calculate station proximity boost
 */
function calculateStationBoost(
  queryStations: string[],
  chunkStations: string[] | null,
  maxBoost: number = 0.2
): number {
  if (!queryStations.length || !chunkStations || !chunkStations.length) {
    return 0;
  }

  let maxProximityBoost = 0;

  for (const queryStation of queryStations) {
    for (const chunkStation of chunkStations) {
      if (stationsAreClose(queryStation, chunkStation, 500)) {
        // Closer = higher boost
        const distance = calculateStationDistance(queryStation, chunkStation);
        if (distance !== null) {
          // Inverse relationship: closer = higher boost
          // 0 feet = maxBoost, 500 feet = 0
          const proximityBoost = maxBoost * (1 - distance / 5.0);
          maxProximityBoost = Math.max(maxProximityBoost, proximityBoost);
        }
      }
    }
  }

  return maxProximityBoost;
}

/**
 * Calculate sheet type match boost
 *
 * CRITICAL: For length/quantity queries, DEPRIORITIZE index sheets
 * and PRIORITIZE actual drawings (plan/profile sheets)
 */
function calculateSheetTypeBoost(
  queryClassification: QueryClassification,
  chunkSheetType: string | null,
  maxBoost: number = 0.3
): number {
  if (!chunkSheetType || !queryClassification.searchHints.preferredSheetTypes) {
    return 0;
  }

  const preferredTypes = queryClassification.searchHints.preferredSheetTypes;

  // CRITICAL FIX: Deprioritize index sheets for quantity queries
  // Index sheets list what's in the plan set but often have incomplete data
  if (queryClassification.type === 'quantity') {
    // PENALIZE index/table of contents sheets heavily
    if (chunkSheetType === 'index' || chunkSheetType === 'toc') {
      return -0.4; // Strong negative boost
    }

    // BOOST actual drawings (plan/profile) where real data lives
    if (chunkSheetType === 'plan' || chunkSheetType === 'profile') {
      return maxBoost * 1.5; // Extra boost for actual drawings
    }

    // Title/summary sheets are still valuable for totals
    if (chunkSheetType === 'title' || chunkSheetType === 'summary') {
      return maxBoost;
    }
  }

  if (preferredTypes.includes(chunkSheetType)) {
    // Other query types get moderate boost
    return maxBoost * 0.7;
  }

  return 0;
}

/**
 * Calculate critical sheet boost
 */
function calculateCriticalSheetBoost(
  isCriticalSheet: boolean | null,
  queryClassification: QueryClassification,
  maxBoost: number = 0.15
): number {
  if (!isCriticalSheet) {
    return 0;
  }

  // Quantity queries benefit most from critical sheets
  if (queryClassification.type === 'quantity') {
    return maxBoost;
  }

  // Other queries get smaller boost
  return maxBoost * 0.5;
}

/**
 * Detect if a sheet is likely an index/table of contents based on sheet number or metadata
 */
function isLikelyIndexSheet(
  sheetNumber: string | null,
  sheetType: string | null,
  content: string | null
): boolean {
  // Check sheet type first
  if (sheetType === 'index' || sheetType === 'toc') {
    return true;
  }

  // Check sheet number patterns
  if (sheetNumber) {
    const sheetLower = sheetNumber.toLowerCase();
    if (
      sheetLower.includes('index') ||
      sheetLower.includes('toc') ||
      sheetLower.includes('table of contents') ||
      sheetLower === 'i-1' ||
      sheetLower === 'idx-1'
    ) {
      return true;
    }
  }

  // Check content for index indicators
  if (content) {
    const contentLower = content.toLowerCase();
    // Look for phrases like "sheet index", "table of contents", or tables listing multiple sheets
    if (
      contentLower.includes('sheet index') ||
      contentLower.includes('table of contents') ||
      contentLower.includes('index of sheets') ||
      (contentLower.includes('sheet') && contentLower.includes('description') && contentLower.match(/\bsheet\b.*\bdescription\b/i))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate index sheet penalty for quantity queries
 */
function calculateIndexSheetPenalty(
  result: any,
  queryClassification: QueryClassification,
  maxPenalty: number = 0.5
): number {
  // Only apply to quantity and location queries where we want actual drawings
  if (queryClassification.type !== 'quantity' && queryClassification.type !== 'location') {
    return 0;
  }

  // Check if this looks like an index sheet
  if (isLikelyIndexSheet(result.sheet_number, result.sheet_type, result.content)) {
    return -maxPenalty; // Apply strong penalty
  }

  return 0;
}

/**
 * Perform station-aware vector search with boosting
 *
 * @param query - User's query text
 * @param projectId - Project ID
 * @param classification - Query classification
 * @param embedding - Query embedding vector
 * @param limit - Number of results (default: 20, will be re-ranked)
 * @returns Enhanced and re-ranked search results
 */
export async function performStationAwareSearch(
  query: string,
  projectId: string,
  classification: QueryClassification,
  embedding: number[],
  limit: number = 20
): Promise<EnhancedSearchResult[]> {
  const supabase = await createClient();

  try {
    // Extract stations from query
    const queryStations = classification.station
      ? [classification.station]
      : extractStationsFromQuery(query);

    // Base similarity threshold (lower for quantity queries)
    const similarityThreshold = classification.type === 'quantity' ? 0.2 : 0.3;

    // Perform base vector search with higher limit to allow for re-ranking
    const { data, error } = await supabase.rpc('search_documents', {
      query_embedding: embedding,
      match_count: limit * 2, // Get extra results to re-rank
      similarity_threshold: similarityThreshold,
      filter_project_id: projectId
    });

    if (error) {
      console.error('Error in vector search:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Enhance results with metadata
    const enhancedResults: EnhancedSearchResult[] = await Promise.all(
      data.map(async (result: any) => {
        // Fetch chunk metadata
        const { data: chunkData } = await supabase
          .from('document_chunks')
          .select('sheet_type, stations, is_critical_sheet')
          .eq('id', result.chunk_id)
          .single();

        // Calculate boost factors
        const stationBoost = calculateStationBoost(
          queryStations,
          (chunkData?.stations as string[] | null) ?? null,
          0.2
        );

        const sheetTypeBoost = calculateSheetTypeBoost(
          classification,
          chunkData?.sheet_type ?? null,
          0.3
        );

        const criticalSheetBoost = calculateCriticalSheetBoost(
          chunkData?.is_critical_sheet ?? false,
          classification,
          0.15
        );

        // CRITICAL: Apply index sheet penalty for quantity/location queries
        const indexSheetPenalty = calculateIndexSheetPenalty(
          result,
          classification,
          0.5
        );

        const totalBoost = stationBoost + sheetTypeBoost + criticalSheetBoost + indexSheetPenalty;

        return {
          ...result,
          sheet_type: chunkData?.sheet_type,
          stations: chunkData?.stations,
          is_critical_sheet: chunkData?.is_critical_sheet,
          boosted_score: result.similarity + totalBoost,
          boost_factors: {
            station_proximity: stationBoost,
            sheet_type_match: sheetTypeBoost,
            critical_sheet: criticalSheetBoost,
            index_sheet_penalty: indexSheetPenalty,
            total: totalBoost
          }
        };
      })
    );

    // Re-rank by boosted score
    const reranked = enhancedResults.sort((a, b) => b.boosted_score - a.boosted_score);

    // Return top results
    return reranked.slice(0, limit);
  } catch (error) {
    console.error('Error in station-aware search:', error);
    throw error;
  }
}

/**
 * Perform hybrid search: combine direct lookup with station-aware vector search
 *
 * @param query - User's query text
 * @param projectId - Project ID
 * @param classification - Query classification
 * @param embedding - Query embedding vector
 * @param directLookupResult - Optional direct lookup result to include
 * @param limit - Number of results
 * @returns Combined and deduplicated results
 */
export async function performHybridSearch(
  query: string,
  projectId: string,
  classification: QueryClassification,
  embedding: number[],
  directLookupResult: any | null,
  limit: number = 15
): Promise<{
  results: EnhancedSearchResult[];
  directLookup: any | null;
  stats: {
    directLookupUsed: boolean;
    vectorResults: number;
    totalBoost: number;
    avgBoost: number;
  };
}> {
  // Perform station-aware vector search
  const vectorResults = await performStationAwareSearch(
    query,
    projectId,
    classification,
    embedding,
    limit
  );

  // Calculate stats
  const totalBoost = vectorResults.reduce(
    (sum, r) => sum + (r.boost_factors?.total || 0),
    0
  );
  const avgBoost = vectorResults.length > 0 ? totalBoost / vectorResults.length : 0;

  return {
    results: vectorResults,
    directLookup: directLookupResult,
    stats: {
      directLookupUsed: !!directLookupResult,
      vectorResults: vectorResults.length,
      totalBoost,
      avgBoost
    }
  };
}

/**
 * Build context string from hybrid search results
 *
 * @param hybridResults - Results from hybrid search
 * @param includeMetadata - Whether to include boost metadata
 * @returns Formatted context string
 */
export function buildContextFromHybridSearch(
  hybridResults: {
    results: EnhancedSearchResult[];
    directLookup: any | null;
  },
  includeMetadata: boolean = false
): string {
  const contextParts: string[] = [];

  // Add direct lookup result first (highest confidence)
  if (hybridResults.directLookup) {
    contextParts.push(`**Direct Quantity Lookup:**\n${hybridResults.directLookup.answer}\nSource: ${hybridResults.directLookup.source}\n`);
  }

  // Add vector search results
  if (hybridResults.results.length > 0) {
    contextParts.push('**Relevant Document Sections:**\n');

    hybridResults.results.forEach((result, index) => {
      let entry = `[${index + 1}] ${result.document_filename}`;

      if (result.sheet_number) {
        entry += ` - Sheet ${result.sheet_number}`;
      }

      if (result.page_number) {
        entry += ` (Page ${result.page_number})`;
      }

      if (includeMetadata && result.boost_factors) {
        entry += ` [Score: ${result.boosted_score.toFixed(2)}, Boost: +${(result.boost_factors.total ?? 0).toFixed(2)}]`;
      }

      entry += `:\n${result.content}\n`;

      contextParts.push(entry);
    });
  }

  return contextParts.join('\n');
}

/**
 * Get chunks near a specific station
 *
 * @param projectId - Project ID
 * @param station - Station number
 * @param radiusFeet - Search radius in feet (default: 500)
 * @param limit - Max results
 * @returns Chunks near the station
 */
export async function getChunksNearStation(
  projectId: string,
  station: string,
  radiusFeet: number = 500,
  limit: number = 10
): Promise<any[]> {
  const supabase = await createClient();

  try {
    // Get all chunks with station data for the project
    const { data, error } = await supabase
      .from('document_chunks')
      .select('*, documents!inner(id, filename, sheet_number)')
      .eq('documents.project_id', projectId)
      .not('stations', 'is', null);

    if (error) {
      throw error;
    }

    // Filter for chunks with nearby stations
    const nearbyChunks = data?.filter(chunk => {
      if (!chunk.stations || !Array.isArray(chunk.stations)) {
        return false;
      }

      const stations = chunk.stations as string[];
      return stations.some((chunkStation: string) =>
        stationsAreClose(station, chunkStation, radiusFeet)
      );
    });

    // Sort by closest station
    const sorted = nearbyChunks?.sort((a, b) => {
      const stationsA = a.stations as string[];
      const stationsB = b.stations as string[];
      const distA = Math.min(
        ...stationsA.map((s: string) => calculateStationDistance(station, s) || Infinity)
      );
      const distB = Math.min(
        ...stationsB.map((s: string) => calculateStationDistance(station, s) || Infinity)
      );
      return distA - distB;
    });

    return sorted?.slice(0, limit) || [];
  } catch (error) {
    console.error('Error getting chunks near station:', error);
    return [];
  }
}

/**
 * Generate search variations for a system name
 *
 * Examples:
 * "waterline a" → ["waterline a", "water line a", "WATER LINE 'A'", "WATER LINE A"]
 * "water line a" → ["water line a", "waterline a", "WATER LINE 'A'", "WATER LINE A"]
 * "line a" → ["line a", "LINE 'A'", "LINE A"]
 */
function generateSystemNameVariations(systemName: string): string[] {
  const variations = new Set<string>();
  const normalized = systemName.toLowerCase().trim();

  // Add original
  variations.add(normalized);

  // Add with spaces
  const withSpaces = normalized.replace(/([a-z])([A-Z])/g, '$1 $2');
  variations.add(withSpaces);

  // Add uppercase versions
  variations.add(systemName.toUpperCase());
  variations.add(withSpaces.toUpperCase());

  // Add versions with quotes around letter
  const letterMatch = normalized.match(/\b([a-z])\s*$/i);
  if (letterMatch) {
    const baseName = normalized.substring(0, letterMatch.index).trim();
    const letter = letterMatch[1].toUpperCase();

    variations.add(`${baseName} '${letter}'`);
    variations.add(`${baseName} "${letter}"`);
    variations.add(`${baseName.toUpperCase()} '${letter}'`);
    variations.add(`${baseName.toUpperCase()} "${letter}"`);
  }

  // Handle "waterline" vs "water line"
  if (normalized.includes('waterline')) {
    variations.add(normalized.replace('waterline', 'water line'));
    variations.add(normalized.replace('waterline', 'water line').toUpperCase());
  } else if (normalized.includes('water line')) {
    variations.add(normalized.replace('water line', 'waterline'));
    variations.add(normalized.replace('water line', 'waterline').toUpperCase());
  }

  // Handle "stormdrain" vs "storm drain"
  if (normalized.includes('stormdrain')) {
    variations.add(normalized.replace('stormdrain', 'storm drain'));
    variations.add(normalized.replace('stormdrain', 'storm drain').toUpperCase());
  } else if (normalized.includes('storm drain')) {
    variations.add(normalized.replace('storm drain', 'stormdrain'));
    variations.add(normalized.replace('storm drain', 'stormdrain').toUpperCase());
  }

  return Array.from(variations);
}

/**
 * Check if a chunk contains ONLY match line references and sheet navigation text
 * with no actual component or construction data.
 *
 * Match-line-only chunks look like:
 * "MATCH LINE - WATER LINE 'A' STA 4+38.83 SEE SHEET CU102 PLAN - WATER LINE 'A' PROFILE - WATER LINE 'A'"
 *
 * These are useless for material takeoffs and should be filtered out.
 */
function isMatchLineOnlyChunk(content: string): boolean {
  const upper = content.toUpperCase();

  // Must contain match line indicator
  const hasMatchLine = /MATCH\s*LINE/i.test(upper);

  // Check for actual component data (these indicate useful content)
  const componentIndicators = [
    /\d+\s*-\s*\d+.*(?:VALVE|TEE|BEND|CAP|COUPLING|REDUCER|HYDRANT|ARV|SLEEVE|PLUG)/i,
    /GATE\s*VALVE/i,
    /FIRE\s*HYDRANT/i,
    /AIR\s*RELEASE/i,
    /TAPPING\s*SLEEVE/i,
    /THRUST\s*BLOCK/i,
    /BLOW.?OFF/i,
    /SERVICE\s*(?:CONNECTION|LATERAL)/i,
    /\d+-IN\s+(?:DI|PVC|HDPE|STEEL|CI)\s+PIPE/i,
    /ELEC\s+\d/i,    // Utility crossing with elevation
    /\bSS\b.*\d+\.\d+/i,  // Sewer crossing with elevation
    /\bSTM\b.*\d+\.\d+/i, // Storm crossing with elevation
  ];

  const hasComponentData = componentIndicators.some(pattern => pattern.test(content));

  // If it has match line text but NO component data, it's noise
  if (hasMatchLine && !hasComponentData) {
    // Further check: is the content mostly navigation text?
    const navPatterns = /(?:MATCH\s*LINE|SEE\s+SHEET|PLAN\s*-|PROFILE\s*-|KEY\s*PLAN|STA\s+\d)/gi;
    const navMatches = content.match(navPatterns) || [];
    const words = content.split(/\s+/).length;

    // If >40% of content is navigation patterns, it's noise
    if (navMatches.length > 0 && (navMatches.length * 5) > words * 0.4) {
      return true;
    }
  }

  return false;
}

/**
 * Get COMPLETE dataset for a system (for quantitative queries)
 *
 * Instead of top-k semantic search, this retrieves ALL relevant chunks
 * for a specific system to ensure complete data for material takeoffs.
 *
 * Strategy:
 * 1. Find all sheets containing the system name
 * 2. Get ALL callout box chunks from those sheets
 * 3. Sort by sheet number and station
 * 4. Return complete dataset
 *
 * @param projectId - Project ID
 * @param systemName - System name (e.g., "Water Line A", "Storm Drain B")
 * @param options - Additional filtering options
 * @returns Complete dataset of chunks for the system
 */
export async function getCompleteSystemData(
  projectId: string,
  systemName: string,
  options: {
    includeNonCallouts?: boolean;  // Include non-callout chunks
    sheetNumberFilter?: string[];  // Specific sheets to include
    chunkTypes?: string[];         // Specific chunk types
  } = {}
): Promise<{
  chunks: any[];
  sheets: string[];
  totalChunks: number;
  calloutChunks: number;
  coverage: {
    hasCallouts: boolean;
    sheetCount: number;
    stationRange?: { min: string; max: string };
  };
}> {
  const supabase = await createClient();

  const {
    includeNonCallouts = false,
    sheetNumberFilter,
    chunkTypes = ['callout_box']
  } = options;

  try {
    console.log('[Complete System Data] Fetching for:', systemName || '(all systems)');

    // Handle empty string: fetch ALL callout boxes in project
    let matchingChunks: any[];
    let searchError: any;

    if (!systemName || systemName.trim() === '') {
      console.log('[Complete System Data] No system specified - fetching ALL chunks with callouts');

      // First, get all document IDs for this project
      const { data: projectDocs, error: docsError } = await supabase
        .from('documents')
        .select('id, filename, sheet_number')
        .eq('project_id', projectId);

      if (docsError) {
        console.error('[Complete System Data] Error fetching documents:', docsError);
        searchError = docsError;
        matchingChunks = [];
      } else if (!projectDocs || projectDocs.length === 0) {
        console.log('[Complete System Data] No documents found for project');
        matchingChunks = [];
      } else {
        console.log(`[Complete System Data] Found ${projectDocs.length} documents in project`);
        console.log('[Complete System Data] Document sample:', projectDocs[0]);
        const docIds = projectDocs.map(d => d.id);

        // Try to fetch callout_box chunks first
        let result = await supabase
          .from('document_chunks')
          .select('*')
          .in('document_id', docIds)
          .eq('chunk_type', 'callout_box')
          .limit(500);

        // If no callout_box chunks found, fall back to all chunks
        if (!result.data || result.data.length === 0) {
          console.log('[Complete System Data] No callout_box chunks found, fetching ALL chunks (legacy mode)');
          result = await supabase
            .from('document_chunks')
            .select('*')
            .in('document_id', docIds)
            .limit(500);

          if (result.data && result.data.length > 0) {
            console.log('[Complete System Data] Chunk sample:', {
              document_id: result.data[0].document_id,
              content_preview: result.data[0].content?.substring(0, 100)
            });
          }
        }

        // Add document metadata to chunks
        matchingChunks = (result.data || []).map(chunk => ({
          ...chunk,
          documents: projectDocs.find(d => d.id === chunk.document_id)
        }));

        searchError = result.error;
        console.log('[Complete System Data] Total chunks fetched:', matchingChunks.length);

        if (matchingChunks.length > 0) {
          console.log('[Complete System Data] Chunk with doc metadata sample:', {
            has_documents: !!matchingChunks[0].documents,
            sheet_number: matchingChunks[0].documents?.sheet_number,
            filename: matchingChunks[0].documents?.filename
          });
        }
      }
    } else {
      // Create flexible search patterns for specific system
      // "waterline a" → ["waterline a", "water line a", "WATER LINE 'A'", "WL-A", etc.]
      const searchVariations = generateSystemNameVariations(systemName);
      console.log('[Complete System Data] Search variations:', searchVariations);

      // Step 1: Find all sheets containing any variation of the system name
      // Build OR condition for all variations
      const contentConditions = searchVariations.map((variant: string) => `content.ilike.%${variant}%`).join(',');

      const result = await supabase
        .from('document_chunks')
        .select(`
          *,
          documents!inner(
            id,
            filename,
            sheet_number,
            project_id
          )
        `)
        .eq('documents.project_id', projectId)
        .or(contentConditions);

      matchingChunks = result.data || [];
      searchError = result.error;
    }

    if (searchError) {
      console.error('[Complete System Data] Search error:', searchError);
      throw searchError;
    }

    if (!matchingChunks || matchingChunks.length === 0) {
      console.log('[Complete System Data] No chunks found for system');
      return {
        chunks: [],
        sheets: [],
        totalChunks: 0,
        calloutChunks: 0,
        coverage: {
          hasCallouts: false,
          sheetCount: 0
        }
      };
    }

    // Step 2: Extract unique sheet numbers from matching chunks
    const relevantSheets = new Set<string>();
    matchingChunks.forEach(chunk => {
      const doc = chunk.documents as any;
      if (doc && doc.sheet_number) {
        relevantSheets.add(doc.sheet_number);
      }
    });

    const sheetNumbers = Array.from(relevantSheets);
    console.log('[Complete System Data] Found sheets:', sheetNumbers);

    // If no sheets found (sheet_number is null in documents), use all chunks directly
    if (sheetNumbers.length === 0 && matchingChunks.length > 0) {
      console.log('[Complete System Data] No sheet numbers in documents - using all fetched chunks');

      // Count callout chunks
      const calloutCount = matchingChunks.filter((c: any) => c.chunk_type === 'callout_box').length;

      return {
        chunks: matchingChunks,
        sheets: [],
        totalChunks: matchingChunks.length,
        calloutChunks: calloutCount,
        coverage: {
          hasCallouts: calloutCount > 0,
          sheetCount: 1 // One document
        }
      };
    }

    // Apply sheet filter if provided
    const targetSheets = sheetNumberFilter && sheetNumberFilter.length > 0
      ? sheetNumbers.filter(s => sheetNumberFilter.includes(s))
      : sheetNumbers;

    if (targetSheets.length === 0) {
      console.log('[Complete System Data] No target sheets after filtering');
      return {
        chunks: [],
        sheets: [],
        totalChunks: 0,
        calloutChunks: 0,
        coverage: {
          hasCallouts: false,
          sheetCount: 0
        }
      };
    }

    // Step 3: Get ALL chunks from the relevant sheets
    let query = supabase
      .from('document_chunks')
      .select(`
        *,
        documents!inner(
          id,
          filename,
          sheet_number,
          project_id,
          document_type,
          discipline
        )
      `)
      .eq('documents.project_id', projectId)
      .in('documents.sheet_number', targetSheets);

    // Filter by chunk type if callouts only
    if (!includeNonCallouts) {
      query = query.eq('chunk_type', 'callout_box');
    }

    const { data: allChunks, error: chunksError } = await query;

    if (chunksError) {
      console.error('[Complete System Data] Error fetching chunks:', chunksError);
      throw chunksError;
    }

    // Step 4: Filter out noise chunks (match lines, sheet references with no component data)
    const filteredChunks = (allChunks || []).filter((chunk: any) => {
      const content = (chunk.content || '').trim();

      // Skip very short chunks (likely just headers or match line refs)
      if (content.length < 30) return false;

      // Check if chunk is ONLY match line references with no component data
      const isMatchLineOnly = isMatchLineOnlyChunk(content);
      if (isMatchLineOnly) {
        return false;
      }

      return true;
    });

    console.log(`[Complete System Data] Filtered ${(allChunks?.length || 0) - filteredChunks.length} noise chunks (match lines, empty refs)`);

    const calloutChunks = filteredChunks.filter((c: any) => c.chunk_type === 'callout_box') || [];
    const processedChunks = filteredChunks.map((chunk: any) => ({
      ...chunk,
      document_filename: chunk.documents?.filename || 'Unknown',
      sheet_number: chunk.documents?.sheet_number || null
    }));

    // Sort by sheet number, then by station (if available)
    const sortedChunks = processedChunks.sort((a: any, b: any) => {
      // First, sort by sheet number
      const sheetA = a.sheet_number || '';
      const sheetB = b.sheet_number || '';
      if (sheetA !== sheetB) {
        return sheetA.localeCompare(sheetB);
      }

      // Then, sort by station (if available)
      const stationA = a.stations?.[0] || '';
      const stationB = b.stations?.[0] || '';
      if (stationA && stationB) {
        const normA = normalizeStation(stationA);
        const normB = normalizeStation(stationB);
        return normA.localeCompare(normB);
      }

      // Finally, by chunk index
      return (a.chunk_index || 0) - (b.chunk_index || 0);
    });

    // Calculate station range
    const allStations = sortedChunks
      .flatMap((c: any) => c.stations || [])
      .filter(Boolean);

    let stationRange;
    if (allStations.length > 0) {
      const sortedStations = allStations.sort((a, b) =>
        normalizeStation(a).localeCompare(normalizeStation(b))
      );
      stationRange = {
        min: sortedStations[0],
        max: sortedStations[sortedStations.length - 1]
      };
    }

    console.log('[Complete System Data] Results:', {
      totalChunks: sortedChunks.length,
      calloutChunks: calloutChunks.length,
      sheets: targetSheets.length,
      stationRange
    });

    return {
      chunks: sortedChunks,
      sheets: targetSheets,
      totalChunks: sortedChunks.length,
      calloutChunks: calloutChunks.length,
      coverage: {
        hasCallouts: calloutChunks.length > 0,
        sheetCount: targetSheets.length,
        stationRange
      }
    };
  } catch (error) {
    console.error('[Complete System Data] Error:', error);
    throw error;
  }
}

/**
 * Build context from complete system data
 *
 * Formats the complete dataset for Claude with instructions for accurate counting
 */
export function buildContextFromCompleteData(
  systemData: {
    chunks: any[];
    sheets: string[];
    totalChunks: number;
    calloutChunks: number;
    coverage: any;
  },
  systemName: string
): string {
  const parts: string[] = [];

  // Add header with instructions
  parts.push(`**COMPLETE DATASET FOR ${systemName.toUpperCase()}**\n`);
  parts.push(`You have ALL component data for this system. Count accurately.\n`);
  parts.push(`Reviewed sheets: ${systemData.sheets.join(', ')}`);
  parts.push(`Total callout boxes: ${systemData.calloutChunks}`);

  if (systemData.coverage.stationRange) {
    parts.push(
      `Station range: ${systemData.coverage.stationRange.min} to ${systemData.coverage.stationRange.max}\n`
    );
  }

  parts.push('\n**CALLOUT BOXES WITH COMPONENT LISTS:**\n');

  // Add all chunks with clear labeling
  systemData.chunks.forEach((chunk: any, index: number) => {
    let header = `[${index + 1}] Sheet ${chunk.sheet_number || 'Unknown'}`;

    if (chunk.stations && chunk.stations.length > 0) {
      header += ` - STA ${chunk.stations[0]}`;
    }

    // Parse JSON content if needed
    let content = chunk.content;
    if (typeof content === 'string' && content.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(content);
        content = parsed.markdown || parsed.text || content;
      } catch (e) {
        // If parsing fails, use raw content
      }
    }

    parts.push(`${header}:\n${content}\n`);
  });

  return parts.join('\n');
}
