/**
 * Query Classification System
 *
 * Analyzes user queries to determine intent and route to appropriate retrieval strategy.
 * Supports quantity, location, specification, detail, utility_crossing, and general queries.
 */

import { containsCrossingKeywords } from '@/lib/metadata/utility-abbreviations';

/**
 * Query type classification
 */
export type QueryType =
  | 'quantity'         // Asking for lengths, amounts, totals
  | 'location'         // Asking where something is
  | 'specification'    // Asking about specs, requirements, materials
  | 'detail'           // Asking about construction details
  | 'reference'        // Asking for cross-references, sheet numbers
  | 'utility_crossing' // Asking about utility crossings, conflicts, intersections
  | 'project_summary'  // Asking for complete project overview/analysis
  | 'general';         // General question

/**
 * Query intent classification (new - for retrieval strategy)
 */
export type QueryIntent =
  | 'quantitative'   // Requires COMPLETE data (counts, takeoffs, totals)
  | 'informational'  // Can use RAG (explanations, descriptions)
  | 'locational';    // Needs specific sheets/stations

/**
 * Classification result with extracted entities
 */
export interface QueryClassification {
  type: QueryType;
  confidence: number; // 0.0 to 1.0

  // NEW: Query intent for retrieval strategy
  intent: QueryIntent;  // quantitative, informational, or locational

  // Extracted entities
  itemName?: string;        // e.g., "Water Line A", "Storm Drain B"
  station?: string;         // e.g., "15+00", "STA 36+00"
  sheetNumber?: string;     // e.g., "C-001", "Sheet 5"
  material?: string;        // e.g., "PVC", "concrete"
  detailNumber?: string;    // e.g., "Detail 3/C-003"

  // Flags for retrieval strategy
  needsDirectLookup: boolean;  // Should try database lookup first
  needsVectorSearch: boolean;  // Should use semantic search
  needsVision: boolean;        // Might need vision analysis
  needsCompleteData: boolean;  // NEW: For quantitative queries, retrieve ALL relevant chunks
  isAggregationQuery: boolean; // NEW: For sum/total/aggregate queries (vs count queries)

  // Search hints
  searchHints: {
    preferredSheetTypes?: string[];  // ['title', 'summary', 'plan']
    stationRange?: { from: string; to: string };
    keywords?: string[];
    systemName?: string;  // NEW: e.g., "Water Line A" for retrieving all related sheets
  };
}

/**
 * Patterns for AGGREGATION queries (sum/total/aggregate)
 */
const AGGREGATION_PATTERNS = [
  /(?:total|sum|aggregate|combined)\s+(?:length|amount|quantity|footage|volume|area)\s+(?:of|for)\s+(.+?)(?:\?|$)/i,
  /(?:what|how much)\s+(?:is|are)?\s*(?:the)?\s+(?:total|sum|aggregate)\s+(.+?)(?:\?|$)/i,
  /(?:add up|sum up|total up)\s+(?:all)?\s*(.+?)(?:\?|$)/i,
  /(?:sum|total)\s+all\s+(.+?)(?:\?|$)/i
];

/**
 * Patterns for QUANTITATIVE queries (require complete data)
 */
const QUANTITATIVE_PATTERNS = [
  // Direct count/takeoff questions
  /(?:how\s+many|count|total|quantity|takeoff|list\s+all)\s+(.+?)(?:\?|$)/i,
  /(?:give\s+me\s+a\s+takeoff|provide\s+a\s+takeoff)\s+(?:of|for)?\s*(.+?)(?:\?|$)/i,
  /(?:count\s+all|list\s+all|enumerate)\s+(.+?)(?:\?|$)/i,

  // Length/quantity totals
  /(?:total|entire|complete)\s+(?:length|amount|quantity|footage)\s+(?:of|for)\s+(.+?)(?:\?|$)/i,
  /(?:what|how much)\s+(?:is|of)?\s*(?:the)?\s+(?:total|complete)\s+(.+?)(?:\?|$)/i,
  /(?:linear\s+feet|lf|footage)\s+(?:of|for|in)\s+(.+?)(?:\?|$)/i,

  // Length questions (how long is X)
  /how\s+long\s+(?:is|are)?\s*(?:the)?\s*(.+?)(?:\?|$)/i,
  /(?:what|what's)\s+(?:is)?\s*(?:the)?\s*length\s+(?:of|for)\s+(.+?)(?:\?|$)/i,

  // Specific component counts (valves, fittings, etc.)
  /how\s+many\s+(cubic\s+yards|cy|tons?|square\s+feet|sf|linear\s+feet|lf|valves?|hydrants?|tees?|fittings?|manholes?|cleanouts?|meters?|boxes?|couplings?|elbows?|bends?|reducers?|caps?|plugs?)/i,
  /how\s+many\s+(gate\s+valves?|butterfly\s+valves?|air\s+valves?|check\s+valves?|ball\s+valves?|prv|fire\s+hydrants?|valve\s+boxes?|meter\s+boxes?)/i,

  // Material takeoffs
  /(?:length|footage|amount|sum)\s+of\s+(.+?)(?:\?|$)/i
];

/**
 * Patterns for INFORMATIONAL queries (can use RAG)
 */
const INFORMATIONAL_PATTERNS = [
  /(?:what\s+is|what\s+does|explain|describe|tell\s+me\s+about)\s+(.+?)(?:\?|$)/i,
  /(?:show\s+me\s+detail\s+of|show\s+me\s+the\s+detail|explain\s+the)\s+(.+?)(?:\?|$)/i,
  /(?:what\s+are\s+the\s+requirements|what\s+are\s+the\s+specs)\s+(?:for|of)?\s*(.+?)(?:\?|$)/i,
  /(?:how\s+does|why\s+does|when\s+should)\s+(.+?)(?:\?|$)/i
];

/**
 * Patterns for location queries
 */
const LOCATION_PATTERNS = [
  /(?:where|location|position)\s+(?:is|are|of)\s+(.+?)(?:\?|$)/i,
  /(?:at|near|around)\s+(?:station|sta)\s+([\d+.]+)/i,
  /(?:show|find)\s+(?:me)?\s*(?:the)?\s+(?:location|position)\s+(?:of)\s+(.+?)(?:\?|$)/i,
  /what\s+(?:is|are)\s+(?:at|near)\s+(?:station|sta)\s+([\d+.]+)/i
];

/**
 * Patterns for specification queries
 */
const SPECIFICATION_PATTERNS = [
  /(?:spec|specification|requirement|standard)(?:s)?\s+(?:for|of)\s+(.+?)(?:\?|$)/i,
  /what\s+(?:material|type|size|diameter|class)\s+(?:of|is|for)\s+(.+?)(?:\?|$)/i,
  /(?:shall|must|required|minimum|maximum)\s+(.+?)(?:\?|$)/i,
  /(?:material|bedding|backfill|installation)\s+(?:for|requirement|spec)/i
];

/**
 * Patterns for detail queries
 */
const DETAIL_PATTERNS = [
  /(?:detail|section|typical)\s+([\w\d/-]+)/i,
  /(?:how|what)\s+(?:to|do|does)\s+(?:install|construct|build)\s+(.+?)(?:\?|$)/i,
  /(?:show|find)\s+(?:me)?\s*(?:the)?\s+detail\s+(?:for|of)\s+(.+?)(?:\?|$)/i,
  /(?:construction|installation)\s+(?:detail|method|procedure)/i
];

/**
 * Patterns for reference queries
 */
const REFERENCE_PATTERNS = [
  /(?:sheet|drawing)\s+([\w\d-]+)/i,
  /(?:see|refer to|reference)\s+sheet\s+([\w\d-]+)/i,
  /(?:what|which)\s+sheet(?:s)?\s+(?:show|contain|have)\s+(.+?)(?:\?|$)/i
];

/**
 * Patterns for project summary queries (complete project analysis)
 */
const PROJECT_SUMMARY_PATTERNS = [
  /(?:analyze|overview|understand|summarize|review)\s+(?:the|this|entire|complete|whole)?\s*project/i,
  /(?:complete|full|entire)\s+project\s+(?:takeoff|analysis|overview|summary)/i,
  /what'?s\s+in\s+(?:the|this)\s+project/i,
  /(?:project|plan|set)\s+(?:overview|summary|analysis)/i,
  /(?:show|tell|give)\s+(?:me)?\s*(?:a|the)?\s*project\s+(?:overview|summary)/i,
];

/**
 * Patterns for utility crossing queries
 */
const UTILITY_CROSSING_PATTERNS = [
  // Direct crossing questions
  /(?:what|which|list|show|find)\s+(?:utilities?|lines?|systems?)\s+(?:cross|crosses|crossing|intersect|intersects)/i,
  /(?:cross|crosses|crossing|intersect|intersects)\s+(?:the)?\s*(?:water|sewer|storm|electrical|gas|telecom|fiber|line)/i,

  // Conflict/interference questions
  /(?:any|what|which|list)\s+(?:conflicts?|interferences?)\s+(?:with)?\s*(?:existing)?\s*(?:utilities?|lines?)/i,
  /(?:existing|proposed)\s+(?:utilities?|lines?)\s+(?:that)?\s*(?:cross|conflict|interfere)/i,

  // Location-based crossing questions
  /where\s+(?:does|do)\s+(?:the)?\s*(?:\w+\s+)?(?:utility|utilities|line|lines)\s+cross/i,
  /(?:crossing|conflict)\s+(?:at|near)?\s*(?:station|sta)/i,

  // General crossing/conflict inquiries
  /(?:list|show|find|identify)\s+(?:all)?\s*(?:utility)?\s*(?:crossings?|conflicts?|interferences?)/i,
  /(?:crossings?|conflicts?)\s+(?:with|along|at)\s+(?:the)?\s*(?:\w+\s+)?(?:line|alignment)/i
];

/**
 * Extract station numbers from query
 */
function extractStation(query: string): string | undefined {
  const patterns = [
    /(?:station|sta)\s+([\d+.]+)/i,
    /\b(\d{1,3}\+\d{2}(?:\.\d+)?)\b/,  // e.g., "13+00", "15+50.25"
    /\bat\s+(\d+)\+(\d+)/i               // e.g., "at 13+00"
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      // Normalize format
      if (match[1].includes('+')) {
        return match[1];
      } else if (match[2]) {
        return `${match[1]}+${match[2]}`;
      }
      return match[1];
    }
  }

  return undefined;
}

/**
 * Extract sheet number from query
 */
function extractSheetNumber(query: string): string | undefined {
  const patterns = [
    /(?:sheet|drawing|page)\s+([\w\d-]+)/i,
    /\b([A-Z]{1,2}-?\d{1,3})\b/,  // e.g., "C-001", "SD1", "S-5"
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return undefined;
}

/**
 * Extract item name from query
 */
function extractItemName(query: string, type: QueryType): string | undefined {
  // For quantity queries, try to extract the item being asked about
  if (type === 'quantity') {
    for (const pattern of QUANTITATIVE_PATTERNS) {
      const match = query.match(pattern);
      if (match && match[1]) {
        // Clean up the extracted item name
        let itemName = match[1].trim();

        // Remove common trailing phrases that don't help with matching
        itemName = itemName.replace(/\s+(are\s+there|is\s+there|do\s+we\s+have|do\s+I\s+need|in\s+the\s+project|on\s+the\s+plan|in\s+total)$/i, '');

        // Remove trailing question marks and punctuation
        itemName = itemName.replace(/[?.,;]$/, '');

        // Remove trailing articles and prepositions
        itemName = itemName.replace(/\b(the|a|an|is|are|in|of|for|at|on|to)\b\s*$/i, '');

        // Normalize spacing
        itemName = itemName.replace(/\s+/g, ' ').trim();

        return itemName || undefined;
      }
    }
  }

  // For location queries
  if (type === 'location') {
    for (const pattern of LOCATION_PATTERNS) {
      const match = query.match(pattern);
      if (match && match[1] && !match[1].match(/^\d/)) {
        return match[1].trim();
      }
    }
  }

  // Try to extract any quoted text
  const quotedMatch = query.match(/"([^"]+)"|'([^']+)'/);
  if (quotedMatch) {
    return quotedMatch[1] || quotedMatch[2];
  }

  return undefined;
}

/**
 * Determine query intent based on patterns
 */
function determineQueryIntent(query: string): QueryIntent {
  const normalized = query.toLowerCase().trim();

  // Check for quantitative patterns (highest priority)
  for (const pattern of QUANTITATIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      return 'quantitative';
    }
  }

  // Check for informational patterns
  for (const pattern of INFORMATIONAL_PATTERNS) {
    if (pattern.test(normalized)) {
      return 'informational';
    }
  }

  // Check for locational patterns
  if (extractStation(query) || /(?:at|near|around)\s+(?:station|sta)/i.test(normalized)) {
    return 'locational';
  }

  // Default to informational
  return 'informational';
}

/**
 * Extract system name for complete data retrieval
 */
function extractSystemName(query: string): string | undefined {
  // Match patterns like "Water Line A", "Storm Drain B", "Line WL-A"
  // ORDER MATTERS: More specific patterns first!
  const patterns = [
    // Full system names (most specific) - handles both "water line" and "waterline"
    /(?:water\s*line|waterline|storm\s*drain|stormdrain|sewer\s*line|sanitary\s*sewer|fire\s*line)\s+['"]?([A-Z\d-]+)['"]?/i,

    // Abbreviated codes
    /(WL|SD|SS|FP)-[A-Z\d]+/i,

    // Generic "line X" or "drain X" (least specific - last resort)
    /\b(?:line|drain)\s+['"]?([A-Z])['"]?\b/i,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      // Normalize "waterline" → "water line" in the result
      let result = match[0].trim();
      result = result.replace(/^waterline/i, 'Water Line');
      result = result.replace(/^stormdrain/i, 'Storm Drain');
      return result;
    }
  }

  // Generic utility type without letter designation (e.g., "waterline work", "all waterline")
  if (/waterline|water\s*line/i.test(query)) return 'WATER LINE';
  if (/stormdrain|storm\s*drain/i.test(query)) return 'STORM DRAIN';
  if (/sewer/i.test(query)) return 'SEWER';
  if (/fire\s*line/i.test(query)) return 'FIRE LINE';

  return undefined;
}

/**
 * Extract material from query
 */
function extractMaterial(query: string): string | undefined {
  const materials = [
    'pvc', 'hdpe', 'ductile iron', 'di', 'concrete', 'steel', 'copper',
    'aggregate', 'asphalt', 'ac', 'class 2', 'class 3', 'bedding', 'backfill'
  ];

  const normalized = query.toLowerCase();

  for (const material of materials) {
    if (normalized.includes(material)) {
      return material;
    }
  }

  return undefined;
}

/**
 * Classify a user query into type and extract entities
 *
 * @param query - User's question
 * @returns Classification result
 */
export function classifyQuery(query: string): QueryClassification {
  const normalized = query.toLowerCase().trim();

  // Determine query intent first
  const intent = determineQueryIntent(query);

  // Check for aggregation queries first (more specific than general quantity)
  const isAggregation = AGGREGATION_PATTERNS.some(pattern => pattern.test(normalized));

  // Check for quantity queries (highest priority for this system)
  for (const pattern of QUANTITATIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      const itemName = extractItemName(query, 'quantity');
      const systemName = extractSystemName(query);
      return {
        type: 'quantity',
        intent: 'quantitative',  // Quantitative queries need complete data
        confidence: 0.9,
        itemName,
        station: extractStation(query),
        sheetNumber: extractSheetNumber(query),
        needsDirectLookup: true,     // Try database first
        needsVectorSearch: true,     // Fallback to vector search
        needsVision: false,          // Not needed for quantities
        needsCompleteData: true,     // NEW: Retrieve ALL relevant chunks
        isAggregationQuery: isAggregation, // NEW: Flag for sum/total queries
        searchHints: {
          preferredSheetTypes: ['plan', 'profile', 'title'],  // Changed: prefer actual drawings over index
          keywords: itemName ? [itemName] : [],
          systemName: systemName      // NEW: For filtering to specific system
        }
      };
    }
  }

  // Check for location queries
  for (const pattern of LOCATION_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: 'location',
        intent: 'locational',
        confidence: 0.85,
        itemName: extractItemName(query, 'location'),
        station: extractStation(query),
        sheetNumber: extractSheetNumber(query),
        needsDirectLookup: false,
        needsVectorSearch: true,
        needsVision: true,           // Location queries benefit from vision
        needsCompleteData: false,
        isAggregationQuery: false,
        searchHints: {
          preferredSheetTypes: ['plan', 'profile'],
          keywords: []
        }
      };
    }
  }

  // Check for specification queries
  for (const pattern of SPECIFICATION_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: 'specification',
        intent: 'informational',
        confidence: 0.8,
        material: extractMaterial(query),
        sheetNumber: extractSheetNumber(query),
        needsDirectLookup: false,
        needsVectorSearch: true,
        needsVision: false,
        needsCompleteData: false,
        isAggregationQuery: false,
        searchHints: {
          preferredSheetTypes: ['summary', 'legend'],
          keywords: []
        }
      };
    }
  }

  // Check for detail queries
  for (const pattern of DETAIL_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: 'detail',
        intent: 'informational',
        confidence: 0.8,
        detailNumber: query.match(/detail\s+([\w\d/-]+)/i)?.[1],
        sheetNumber: extractSheetNumber(query),
        needsDirectLookup: false,
        needsVectorSearch: true,
        needsVision: true,           // Details benefit from vision
        needsCompleteData: false,
        isAggregationQuery: false,
        searchHints: {
          preferredSheetTypes: ['detail'],
          keywords: []
        }
      };
    }
  }

  // Check for reference queries
  for (const pattern of REFERENCE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: 'reference',
        intent: 'informational',
        confidence: 0.75,
        sheetNumber: extractSheetNumber(query),
        needsDirectLookup: false,
        needsVectorSearch: true,
        needsVision: false,
        needsCompleteData: false,
        isAggregationQuery: false,
        searchHints: {
          keywords: []
        }
      };
    }
  }

  // Check for project summary queries FIRST (before crossing, as they're more specific)
  for (const pattern of PROJECT_SUMMARY_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: 'project_summary',
        intent: 'quantitative',
        confidence: 0.9,
        needsDirectLookup: true,     // Query project_quantity_summary view
        needsVectorSearch: false,    // Don't need vector search for summaries
        needsVision: false,          // Vision data already in database
        needsCompleteData: true,     // Need aggregated project data
        isAggregationQuery: true,    // This is an aggregation across entire project
        searchHints: {
          preferredSheetTypes: ['summary', 'title', 'index'],
          keywords: []
        }
      };
    }
  }

  // Check for utility crossing queries
  const hasCrossingPatterns = UTILITY_CROSSING_PATTERNS.some(pattern => pattern.test(normalized));
  const hasCrossingKeywords = containsCrossingKeywords(query);

  if (hasCrossingPatterns || hasCrossingKeywords) {
    const systemName = extractSystemName(query);
    return {
      type: 'utility_crossing',
      intent: 'quantitative',  // Needs complete profile data
      confidence: 0.85,
      itemName: systemName,
      station: extractStation(query),
      sheetNumber: extractSheetNumber(query),
      needsDirectLookup: false,     // Crossings aren't in structured tables
      needsVectorSearch: false,     // Use vision instead of text search
      needsVision: true,            // VISION-based detection (like valves/fittings)
      needsCompleteData: false,     // Vision analyzes individual sheets
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['profile', 'plan'],  // Profile views show crossings
        keywords: ['ELEC', 'SS', 'STM', 'GAS', 'TEL', 'W', 'FO', 'EXIST', 'EXISTING'],
        systemName: systemName
      }
    };
  }

  // Default to general query
  return {
    type: 'general',
    intent: intent,  // Use determined intent
    confidence: 0.5,
    station: extractStation(query),
    sheetNumber: extractSheetNumber(query),
    needsDirectLookup: false,
    needsVectorSearch: true,
    needsVision: false,
    needsCompleteData: false,
    isAggregationQuery: false,
    searchHints: {
      keywords: []
    }
  };
}

/**
 * Get search strategy recommendations based on classification
 *
 * @param classification - Query classification result
 * @returns Recommended search strategy
 */
export function getSearchStrategy(classification: QueryClassification): {
  steps: string[];
  priorityOrder: ('direct_lookup' | 'vector_search' | 'vision')[];
} {
  const steps: string[] = [];
  const priorityOrder: ('direct_lookup' | 'vector_search' | 'vision')[] = [];

  if (classification.needsDirectLookup) {
    steps.push('Try direct database lookup for structured data');
    priorityOrder.push('direct_lookup');
  }

  if (classification.needsVectorSearch) {
    steps.push('Perform semantic vector search');
    priorityOrder.push('vector_search');
  }

  if (classification.needsVision) {
    steps.push('Consider vision analysis for visual/spatial queries');
    priorityOrder.push('vision');
  }

  return { steps, priorityOrder };
}

/**
 * Build optimized search parameters based on classification
 *
 * @param classification - Query classification result
 * @param projectId - Project ID
 * @returns Search parameters
 */
export function buildSearchParameters(
  classification: QueryClassification,
  projectId: string
): {
  directLookupParams?: {
    projectId: string;
    searchTerm: string;
  };
  vectorSearchParams: {
    projectId: string;
    query: string;
    similarityThreshold: number;
    limit: number;
    filters?: Record<string, any>;
  };
} {
  const result: any = {};

  // Direct lookup parameters (for quantities)
  if (classification.needsDirectLookup && classification.itemName) {
    result.directLookupParams = {
      projectId,
      searchTerm: classification.itemName
    };
  }

  // Vector search parameters
  const similarityThreshold = classification.type === 'quantity' ? 0.2 : 0.3;
  const limit = classification.type === 'quantity' ? 20 : 15;

  result.vectorSearchParams = {
    projectId,
    query: '', // Will be filled by caller
    similarityThreshold,
    limit,
    filters: {}
  };

  // Add filters based on hints
  if (classification.sheetNumber) {
    result.vectorSearchParams.filters.sheetNumber = classification.sheetNumber;
  }

  if (classification.searchHints.preferredSheetTypes) {
    result.vectorSearchParams.filters.sheetTypes = classification.searchHints.preferredSheetTypes;
  }

  return result;
}
