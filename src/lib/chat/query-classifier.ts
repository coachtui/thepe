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
  | 'quantity'           // Asking for lengths, amounts, totals
  | 'location'           // Asking where something is
  | 'specification'      // Asking about specs, requirements, materials
  | 'detail'             // Asking about construction details
  | 'reference'          // Asking for cross-references, sheet numbers
  | 'utility_crossing'   // Asking about utility crossings, conflicts, intersections
  | 'project_summary'    // Asking for complete project overview/analysis
  | 'demo_scope'         // What gets demolished / what remains / what is protected
  | 'demo_constraint'    // Pre-demo verification, risk notes, protection requirements
  | 'arch_element_lookup' // What is Door D-14? What wall type WT-A?
  | 'arch_room_scope'    // What's in Room 105? Which rooms are affected?
  | 'arch_schedule_query' // What does the door schedule say for D-14?
  // Phase 5A
  | 'struct_element_lookup'  // What is column C-4? What footing at Grid A-3?
  | 'struct_area_scope'      // What structural elements are on Level 1?
  | 'mep_element_lookup'     // What panel is LP-1? What's AHU-1?
  | 'mep_area_scope'         // What MEP is in Room 105?
  // Phase 5B
  | 'trade_coordination'     // What trades touch Room 105?
  | 'coordination_sequence'  // What could hold this work up?
  | 'affected_area'          // What systems are affected on Level 1?
  // Phase 6A
  | 'spec_section_lookup'    // What does spec section 03 30 00 require?
  | 'spec_requirement_lookup' // What testing is required for concrete?
  // Phase 6B
  | 'rfi_lookup'             // Did an RFI address this detail?
  | 'change_impact_lookup'   // What changed in Addendum 1?
  // Phase 6C
  | 'submittal_lookup'       // What submittal covers LP-1?
  | 'governing_document_query' // What governs here: plan, spec, or RFI?
  | 'general';           // General question

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

  // Demo routing extras (only populated for demo_scope / demo_constraint types)
  demoRoom?: string;       // Extracted room number, e.g. "104"
  demoLevel?: string;      // Extracted level, e.g. "L1"
  demoStatusHint?: string; // Status filter hint: 'to_remain' | 'to_protect' | etc.

  // Arch routing extras (only populated for arch_element_lookup / arch_room_scope / arch_schedule_query)
  archTag?: string;        // Extracted drawing tag, e.g. "D-14", "W-3A", "WT-A"
  archTagType?: 'door' | 'window' | 'wall_type' | 'room' | 'keynote'; // Tag entity type
  archRoom?: string;       // Extracted room number for arch room queries, e.g. "105"
  archScheduleType?: 'door' | 'window' | 'room_finish'; // Schedule type for arch_schedule_query

  // Structural routing extras (Phase 5A)
  structMark?: string;     // Structural mark, e.g. "F-1", "C-4", "W12×26"
  structEntityType?: 'footing' | 'column' | 'beam' | 'foundation_wall' | 'grid_line';
  structGrid?: string;     // Grid reference, e.g. "A-3", "B/3-4"
  structLevel?: string;    // Level, e.g. "L1", "Level 2", "roof"

  // MEP routing extras (Phase 5A)
  mepTag?: string;         // Equipment tag, e.g. "LP-1", "AHU-1", "T-1"
  mepDiscipline?: 'electrical' | 'mechanical' | 'plumbing';

  // Coordination routing extras (Phase 5B)
  coordRoom?: string;      // Room for coordination queries
  coordLevel?: string;     // Level for coordination queries

  // Spec routing extras (Phase 6A)
  specSection?: string;    // CSI section number, e.g. "03 30 00"
  specRequirementType?: 'material' | 'execution' | 'testing' | 'submittal' | 'closeout' | 'inspection' | 'protection';

  // RFI routing extras (Phase 6B)
  rfiNumber?: string;      // RFI/change doc identifier, e.g. "RFI-023"
  changeDocType?: 'rfi' | 'asi' | 'bulletin' | 'addendum';

  // Submittal / governing routing extras (Phase 6C)
  submittalId?: string;    // Submittal identifier, e.g. "03-01"
  governingDocScope?: string; // Scope description for governing doc query

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
 * Patterns for DEMO SCOPE queries (what gets demolished / what remains)
 */
const DEMO_SCOPE_PATTERNS = [
  /what\s+(?:gets?|is|are|needs?\s+to\s+be)\s+(?:demo(?:lish)?e?d?|remov(?:ed?|al)|torn?\s+down)/i,
  /what\s+(?:to\s+)?remov(?:e|al)/i,
  /demolition\s+(?:scope|plan|work|items?|list)/i,
  /demo\s+(?:scope|plan|work|items?|list)/i,
  /remove\s+and\s+dispos/i,
  /what\s+(?:is|are)\s+(?:being\s+)?demo(?:lish)?e?d?/i,
  /what'?s?\s+(?:being\s+)?(?:demo(?:lish)?e?d?|remov(?:ed?|al))/i,
];

/**
 * Patterns for DEMO REMAIN queries (what stays / what is protected)
 */
const DEMO_REMAIN_PATTERNS = [
  /what\s+(?:needs?\s+to\s+|should\s+|must\s+)?remain/i,
  /what\s+stays?(?:\s+in\s+place)?/i,
  /existing\s+to\s+remain/i,
  /protect\s+in\s+place/i,
  /\bp\.?i\.?p\.?\b/i,
  /what\s+(?:is|are)\s+(?:being\s+)?protected?/i,
  /what\s+(?:do\s+(?:i|we)\s+)?(?:need\s+to\s+)?keep(?:\s+in\s+place)?/i,
];

/**
 * Patterns for DEMO CONSTRAINT queries (pre-demo checks, risks, verification)
 */
const DEMO_CONSTRAINT_PATTERNS = [
  /before\s+demo(?:lition)?(?:\s+starts?)?/i,
  /demo\s+(?:risk|hazard|caution|concern)/i,
  /verify\s+before/i,
  /(?:what|which|any)\s+(?:to\s+)?(?:verify|check|confirm)(?:\s+before)?/i,
  /protect(?:ion)?\s+(?:notes?|requirements?)/i,
  /coordinate\s+(?:before|with|for)\s+demo/i,
  /hazardous?\s+(?:material|waste|condition)/i,
  /asbestos|lead\s+paint/i,
  /pre[- ]?demo/i,
  /prior\s+to\s+demo(?:lition)?/i,
];

// ---------------------------------------------------------------------------
// Architectural query patterns
// ---------------------------------------------------------------------------

/**
 * Patterns for ARCH ELEMENT queries (single tag lookup).
 * Ordered most-specific first to avoid false positives.
 */
const ARCH_ELEMENT_PATTERNS = [
  /\bdoor\s+[A-Z]?\d+[A-Z]?\b/i,          // "door D-14", "door 12A"
  /\b(D-\d+[A-Z]?)\b/,                     // bare tag "D-14"
  /\bwindow\s+[A-Z]?\d+[A-Z]?\b/i,         // "window W-3A"
  /\b(W-\d+[A-Z]?)\b/,                     // bare tag "W-3A"
  /\bwall\s+type\s+[A-Z\d]+\b/i,           // "wall type A", "wall type WT-3"
  /\bWT-?[A-Z\d]+\b/,                      // "WT-A", "WT3"
  /what\s+(?:is|are)\s+(?:door|window|wall)\s+/i,
  /tell\s+me\s+about\s+(?:door|window|wall)\s+/i,
  /\bkeynote\s+\d+\b/i,                    // "keynote 7"
  /(?:door|window|wall\s+type)\s+tag\s+/i,
]

/**
 * Patterns for ARCH ROOM queries (room-based scope).
 */
const ARCH_ROOM_PATTERNS = [
  /what(?:'?s?|\s+(?:is|are))\s+in\s+room\s+\w+/i,
  /what\s+stands?\s+out\s+(?:about|in)\s+room\s+\w+/i,
  /room\s+\w+\s+(?:contents?|finishes?|schedule|description)/i,
  /which\s+rooms?\s+are\s+affected/i,
  /(?:list|show)\s+(?:all\s+)?rooms?\b/i,
  /\broom\s+\w+\b/i,  // generic "room 105" — kept last, low specificity
]

/**
 * Patterns for ARCH SCHEDULE queries (schedule-focused).
 */
const ARCH_SCHEDULE_PATTERNS = [
  /(?:door|window|room\s+finish)\s+schedule/i,
  /finish\s+schedule/i,
  /\bdoor\s+type\b/i,
  /\bwindow\s+type\b/i,
  /\bdoor\s+frame\b/i,
  /\bhardware\s+(?:group|set)\b/i,
  /what\s+(?:hardware|finish|type|size)\s+(?:for|is|applies?\s+to)\s+(?:door|window)\s+/i,
]

/**
 * Extract architectural drawing tag and type from a query.
 */
function extractArchTag(query: string): {
  tag: string | null
  tagType: 'door' | 'window' | 'wall_type' | 'keynote' | null
} {
  // Door: "Door D-14", "door 12A", bare "D-14"
  const doorFull = query.match(/\bdoor\s+([A-Z]?\d+[A-Z]?)\b/i)
  if (doorFull) return { tag: doorFull[1].toUpperCase(), tagType: 'door' }
  const doorBare = query.match(/\b(D-\d+[A-Z]?)\b/)
  if (doorBare) return { tag: doorBare[1].toUpperCase(), tagType: 'door' }

  // Window: "Window W-3A", bare "W-3A"
  const winFull = query.match(/\bwindow\s+([A-Z]?\d+[A-Z]?)\b/i)
  if (winFull) return { tag: winFull[1].toUpperCase(), tagType: 'window' }
  const winBare = query.match(/\b(W-\d+[A-Z]?)\b/)
  if (winBare) return { tag: winBare[1].toUpperCase(), tagType: 'window' }

  // Wall type: "WT-A", "WT3", "wall type A"
  const wtBare = query.match(/\b(WT-?[A-Z\d]+)\b/i)
  if (wtBare) return { tag: wtBare[1].toUpperCase(), tagType: 'wall_type' }
  const wtFull = query.match(/\bwall\s+type\s+([A-Z\d]+)\b/i)
  if (wtFull) return { tag: wtFull[1].toUpperCase(), tagType: 'wall_type' }

  // Keynote: "keynote 7"
  const kn = query.match(/\bkeynote\s+(\d+)\b/i)
  if (kn) return { tag: kn[1], tagType: 'keynote' }

  return { tag: null, tagType: null }
}

/**
 * Extract room number from an arch query (e.g. "Room 105", "in room 105").
 */
function extractArchRoom(query: string): string | null {
  const patterns = [
    /\broom\s+(\w+[-\w]*)/i,
    /\b(?:in|for|within|about)\s+room\s+(\w+[-\w]*)/i,
  ]
  for (const pattern of patterns) {
    const match = query.match(pattern)
    if (match) return match[1].toUpperCase()
  }
  return null
}

/**
 * Extract schedule type from an arch schedule query.
 */
function extractArchScheduleType(
  query: string
): 'door' | 'window' | 'room_finish' | null {
  if (/room\s+finish\s+schedule|finish\s+schedule/i.test(query)) return 'room_finish'
  if (/window\s+schedule|window\s+type/i.test(query))             return 'window'
  if (/door\s+schedule|door\s+type|door\s+frame|hardware/i.test(query)) return 'door'
  return null
}

/**
 * Extract room number from a demo query (e.g. "Room 104", "in 104")
 */
function extractDemoRoom(query: string): string | undefined {
  const patterns = [
    /\broom\s+(\w+[-\w]*)/i,
    /\b(?:in|for|within|inside)\s+room\s+(\w+[-\w]*)/i,
    /\bspace\s+(\w+[-\w]*)/i,
  ];
  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return undefined;
}

/**
 * Extract level/floor from a demo query (e.g. "Level 2", "2nd floor")
 */
function extractDemoLevel(query: string): string | undefined {
  const patterns = [
    /\b(?:floor|level)\s+([A-Z0-9]+)/i,
    /\b(\d+(?:st|nd|rd|th)\s+floor)\b/i,
  ];
  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return undefined;
}

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

// ---------------------------------------------------------------------------
// Structural query patterns (Phase 5A)
// ---------------------------------------------------------------------------

const STRUCTURAL_ELEMENT_PATTERNS = [
  /\b(footing|ftg)\s+[A-Z]?\d+[A-Z]?\b/i,
  /\b(column|col)\s+[A-Z]?\d+[A-Z]?\b/i,
  /\b(beam|bm|girder)\s+[A-Z\d-]+\b/i,
  /\bfoundation\s+wall\s+[A-Z\d]+\b/i,
  /\bgrid\s+(?:line\s+)?[A-Z]\d*\b/i,
  /\bgrid\s+[A-Z]-\d+\b/i,
  /what\s+(?:is|are)\s+(?:at\s+)?grid\s+[A-Z]/i,
  /structural\s+(?:element|member|system)\s+/i,
  /load[\s-]bearing/i,
  /what\s+(?:is|are)\s+(?:footing|column|beam|the\s+footing|the\s+column|the\s+beam)\s+/i,
]

const STRUCTURAL_AREA_PATTERNS = [
  /structural\s+(?:system|layout|plan)\s+(?:on|at|for)\s+/i,
  /structural\s+(?:elements?|members?)\s+(?:on|at|in)\s+/i,
  /(?:foundation|framing)\s+(?:plan|layout)/i,
  /what(?:'?s?|\s+(?:is|are))\s+(?:the\s+)?structural\s+/i,
]

// ---------------------------------------------------------------------------
// MEP query patterns (Phase 5A)
// ---------------------------------------------------------------------------

const MEP_ELEMENT_PATTERNS = [
  // Electrical
  /\bpanel\s+[A-Z]{0,3}[LP]?\d+[A-Z]?\b/i,
  /\b(LP|MDP|MCC|DP|PP|EP)-?\d*[A-Z]?\b/,
  /\btransformer\s+[TtXx][-\s]?\d+[A-Z]?\b/i,
  /\b(xfmr|transformer)\s+\w+/i,
  // Mechanical
  /\b(AHU|RTU|FCU|HVAC)\s*[-\s]?\d+[A-Z]?\b/i,
  /\b(VAV|VVT)\s*[-\s]?\d+[A-Z]?\b/i,
  /\bair\s+handler\s+\w+/i,
  /\b(EF|SF|RF)\s*-?\d+[A-Z]?\b/i,
  // Plumbing
  /\b(WC|WH|HB|DF|FD|CO)\s*-?\d+[A-Z]?\b/i,
  /\bwater\s+heater\s+\w+/i,
  /\bfloor\s+drain\s+\w+/i,
  /\bcleanout\s+\w+/i,
  /what\s+(?:is|are)\s+(?:panel|ahu|vav|rtu)\s+/i,
  /tell\s+me\s+about\s+(?:panel|ahu|vav|rtu|transformer)\s+/i,
]

const MEP_AREA_PATTERNS = [
  /what\s+(?:mep|mechanical|electrical|plumbing)\s+(?:is|are)\s+in\s+/i,
  /(?:mep|mechanical|electrical|plumbing)\s+(?:systems?|equipment)\s+in\s+(?:room|level)\s+/i,
  /what\s+(?:mep|m\/e\/p)\s+(?:runs?|serves?|feeds?)\s+/i,
  /(?:electrical|mechanical|plumbing)\s+in\s+this\s+(?:room|space|area)/i,
  /what\s+(?:hvac|mechanical|electrical|plumbing)\s+(?:is|are)\s+(?:on|in|at)\s+/i,
]

// ---------------------------------------------------------------------------
// Coordination patterns (Phase 5B)
// ---------------------------------------------------------------------------

const COORDINATION_SEQUENCE_PATTERNS = [
  /what\s+could\s+hold\s+(?:this|the)\s+work\s+up/i,
  /what\s+(?:needs?\s+to\s+be|should\s+be)\s+coordinated\s+(?:before|first)/i,
  /what\s+should\s+(?:happen|be\s+done)\s+(?:before|first)/i,
  /pre[\s-]?construction\s+coordination/i,
  /coordination\s+(?:checklist|requirements|issues?)/i,
  /what\s+(?:could|might|would)\s+(?:hold|delay|block)\s+/i,
  /what\s+(?:needs?\s+to\s+happen\s+first|should\s+come\s+first)/i,
]

const AFFECTED_AREA_PATTERNS = [
  /what\s+(?:systems?|work)\s+(?:is|are)\s+affected\s+(?:on|in)/i,
  /what\s+(?:is|are)\s+(?:involved|present|going\s+on)\s+(?:on|in|at)\s+(?:level|room|area)/i,
  /what\s+(?:disciplines?|trades?)\s+are\s+on\s+(?:level|this\s+floor)/i,
  /what\s+(?:systems?|trades?)\s+are\s+(?:present|involved)\s+(?:on|in)\s+/i,
]

const TRADE_COORDINATION_PATTERNS = [
  /what\s+trades?\s+(?:touch|work\s+in|are\s+in)\s+/i,
  /which\s+trades?\s+(?:touch|work\s+in|are\s+present)\s+/i,
  /what\s+systems?\s+(?:touch|are\s+in|run\s+through)\s+/i,
  /what\s+(?:needs?\s+to\s+be|should\s+be)\s+coordinated\s*(?:\?|$)/i,
  /coordinate\s+before\s+/i,
  /what\s+(?:contractors?|subs?|subcontractors?)\s+(?:are|work)\s+/i,
]

// ---------------------------------------------------------------------------
// Phase 6 — Spec / RFI / Submittal / Governing patterns
// ---------------------------------------------------------------------------

const SPEC_SECTION_PATTERNS = [
  /\bspec(?:ification)?\s+section\s+\d{2}\s*\d{2}\s*\d{2}\b/i,
  /\bsection\s+\d{2}\s*\d{2}\s*\d{2}\b/i,
  /\b\d{2}\s+\d{2}\s+\d{2}\b/,   // bare "03 30 00" format
  /\bdivision\s+\d+\s+(?:spec(?:ification)?|require)/i,
]

const SPEC_REQUIREMENT_PATTERNS = [
  /what\s+(?:does?\s+(?:the\s+)?spec|do\s+(?:the\s+)?specs?)\s+(?:say|require|call\s+for|specify)\b/i,
  /what\s+(?:testing|test(?:s)?|inspection|submittal|closeout|material|execution)\s+(?:is|are)\s+required\b/i,
  /what\s+(?:are\s+(?:the\s+)?)?(?:spec(?:ification)?\s+)?requirements?\s+for\b/i,
  /(?:spec(?:ification)?\s+)?requirements?\s+for\s+(?:concrete|masonry|steel|roofing|mechanical|electrical|plumbing)\b/i,
  /what\s+(?:materials?|products?)\s+(?:does?\s+)?the\s+spec\s+(?:require|allow|call\s+for)\b/i,
  /are\s+there\s+(?:any\s+)?(?:spec|specification)\s+requirements?\s+for\b/i,
]

const RFI_LOOKUP_PATTERNS = [
  /\bRFI\s*[-#]?\s*\d+\b/i,
  /\bdid\s+(?:an?\s+)?(?:rfi|request\s+for\s+information)\s+/i,
  /(?:is|was)\s+there\s+(?:an?\s+)?(?:rfi|change\s+order|clarification)\s+/i,
  /\b(?:rfi|request\s+for\s+information)\s+(?:address|cover|clarif|change)\b/i,
  /\bASI\s*[-#]?\s*\d+\b/i,
]

const CHANGE_IMPACT_PATTERNS = [
  /what\s+changed\s+(?:in|with|after|per)\s+(?:addendum|bulletin|rfi|asi|change\s+order)\b/i,
  /\baddendum\s+\d+\b.{0,40}\b(?:change|affect|modify|revise|update)/i,
  /what\s+(?:was|were)\s+(?:revised|changed|updated|superseded)\b/i,
  /\b(?:change\s+order|addendum|bulletin|asi)\b.{0,40}(?:what|which)\b/i,
  /what\s+(?:clarification|change)\s+(?:applies?|governs?|affects?)\b/i,
]

const SUBMITTAL_LOOKUP_PATTERNS = [
  /what\s+submittal\s+(?:covers?|is\s+for|applies?\s+to)\b/i,
  /(?:is|was)\s+there\s+a\s+submittal\s+for\b/i,
  /\bsubmittal\s+(?:log|schedule|register|status)\b/i,
  /\bshop\s+drawing\s+(?:for|of)\b/i,
  /\bproduct\s+data\s+(?:for|on)\b/i,
  /what\s+(?:products?|materials?)\s+(?:have\s+been\s+)?(?:approved|submitted)\b/i,
]

const GOVERNING_DOCUMENT_PATTERNS = [
  /what\s+(?:document\s+)?governs\b/i,
  /what\s+(?:should\s+I|do\s+I)\s+(?:rely|follow|use)\s+(?:on|for)\b/i,
  /(?:plan|spec(?:ification)?|rfi|drawing)\s+(?:vs\.?|versus|or)\s+(?:plan|spec(?:ification)?|rfi|drawing)\b/i,
  /which\s+(?:document|drawing|spec)\s+(?:controls?|governs?|takes?\s+precedence)\b/i,
  /(?:conflict|discrepancy)\s+between\s+(?:the\s+)?(?:plan|spec|drawing|rfi)\b/i,
  /what\s+takes?\s+precedence\b/i,
  /does\s+(?:the\s+)?(?:rfi|spec|plan|drawing)\s+(?:supersede|override|change)\b/i,
]

// ---------------------------------------------------------------------------
// Phase 6 extractors
// ---------------------------------------------------------------------------

function extractSpecSection(query: string): string | null {
  // "spec section 03 30 00", "Section 033000", "03 30 00"
  const patterns = [
    /\b(?:spec(?:ification)?|section)\s+(\d{2}\s*\d{2}\s*\d{2})\b/i,
    /\b(\d{2}\s+\d{2}\s+\d{2})\b/,
    /\b(\d{6})\b/,
  ]
  for (const p of patterns) {
    const m = query.match(p)
    if (m) {
      const raw = m[1].replace(/\s+/g, '')
      return `${raw.slice(0, 2)} ${raw.slice(2, 4)} ${raw.slice(4, 6)}`
    }
  }
  return null
}

function extractSpecRequirementType(
  query: string
): 'material' | 'execution' | 'testing' | 'submittal' | 'closeout' | 'inspection' | 'protection' | null {
  const q = query.toLowerCase()
  if (/\b(testing|test(?:s)?|laboratory|field\s+test|cylinder)\b/.test(q)) return 'testing'
  if (/\binspect(?:ion)?\b/.test(q)) return 'inspection'
  if (/\bsubmittal\b/.test(q)) return 'submittal'
  if (/\bcloseout|warranty|o&m|operation.*maintenance\b/.test(q)) return 'closeout'
  if (/\bprotect(?:ion)?\b/.test(q)) return 'protection'
  if (/\b(material|product|mix|strength|grade|type\s+of)\b/.test(q)) return 'material'
  if (/\b(install|place|execut|procedure|method|sequence)\b/.test(q)) return 'execution'
  return null
}

function extractRFINumber(query: string): string | null {
  const patterns = [
    /\bRFI\s*[-#]?\s*(\d+)\b/i,
    /\bASI\s*[-#]?\s*(\d+)\b/i,
    /\baddendum\s*(?:no\.?\s*)?(\d+)\b/i,
    /\bbulletin\s*(?:no\.?\s*)?(\d+)\b/i,
  ]
  for (const p of patterns) {
    const m = query.match(p)
    if (m) {
      const prefix = m[0].match(/^(RFI|ASI|ADDENDUM|BULLETIN)/i)?.[1]?.toUpperCase() ?? 'RFI'
      return `${prefix}-${m[1].padStart(3, '0')}`
    }
  }
  return null
}

function extractChangeDocType(
  query: string
): 'rfi' | 'asi' | 'bulletin' | 'addendum' | null {
  const q = query.toLowerCase()
  if (/\basi\b|\barchitect['\s]*s?\s+supplemental/.test(q)) return 'asi'
  if (/\baddendum\b/.test(q)) return 'addendum'
  if (/\bbulletin\b/.test(q)) return 'bulletin'
  if (/\brfi\b|\brequest\s+for\s+information/.test(q)) return 'rfi'
  return null
}

// ---------------------------------------------------------------------------
// Structural extractors (Phase 5A)
// ---------------------------------------------------------------------------

function extractStructMark(query: string): {
  mark: string | null
  entityType: 'footing' | 'column' | 'beam' | 'foundation_wall' | 'grid_line' | null
} {
  // Footing: "footing F-1", "ftg F2"
  const ftgFull = query.match(/\b(?:footing|ftg)\s+([A-Z]?\d+[A-Z]?)\b/i)
  if (ftgFull) return { mark: ftgFull[1].toUpperCase(), entityType: 'footing' }

  // Column: "column C-4", "col 1A"
  const colFull = query.match(/\b(?:column|col)\s+([A-Z]?\d+[A-Z]?)\b/i)
  if (colFull) return { mark: colFull[1].toUpperCase(), entityType: 'column' }

  // Beam: "beam W12×26", "bm L2"
  const beamFull = query.match(/\b(?:beam|bm|girder)\s+([\w×xX\d-]+)\b/i)
  if (beamFull) return { mark: beamFull[1].toUpperCase(), entityType: 'beam' }

  // Foundation wall: "foundation wall FW-1"
  const fwFull = query.match(/\bfoundation\s+wall\s+([A-Z\d-]+)\b/i)
  if (fwFull) return { mark: fwFull[1].toUpperCase(), entityType: 'foundation_wall' }

  // Grid line: "grid A-3", "grid A", "grid line 3"
  const gridFull = query.match(/\bgrid\s+(?:line\s+)?([A-Z]\d*)\b/i)
  if (gridFull) return { mark: gridFull[1].toUpperCase(), entityType: 'grid_line' }

  return { mark: null, entityType: null }
}

function extractStructGrid(query: string): string | null {
  const patterns = [
    /\bgrid\s+([A-Z]\d*)\b/i,
    /\bgrid\s+([A-Z]-\d+)\b/i,
    /\bgrid\s+([A-Z]\/\d+(?:-\d+)?)\b/i,
    /at\s+grid\s+([A-Z][-/\d]*)/i,
  ]
  for (const p of patterns) {
    const m = query.match(p)
    if (m) return m[1].toUpperCase()
  }
  return null
}

function extractStructLevel(query: string): string | null {
  const patterns = [
    /\blevel\s+([A-Z0-9]+)\b/i,
    /\bfloor\s+(\d+)\b/i,
    /\b(\d+(?:st|nd|rd|th)\s+floor)\b/i,
    /\b(roof)\s+(?:level|framing|deck)/i,
    /\bL(\d+)\b/,
  ]
  for (const p of patterns) {
    const m = query.match(p)
    if (m) return m[1].toUpperCase()
  }
  return null
}

// ---------------------------------------------------------------------------
// MEP extractors (Phase 5A)
// ---------------------------------------------------------------------------

function extractMEPTag(query: string): {
  tag: string | null
  discipline: 'electrical' | 'mechanical' | 'plumbing' | null
} {
  // Panel tags
  const panelFull = query.match(/\bpanel\s+([A-Z]{0,3}[LP]?\d+[A-Z]?)\b/i)
  if (panelFull) return { tag: panelFull[1].toUpperCase(), discipline: 'electrical' }
  const panelBare = query.match(/\b((?:LP|MDP|MCC|DP|PP|EP)-?\d*[A-Z]?)\b/)
  if (panelBare) return { tag: panelBare[1].toUpperCase(), discipline: 'electrical' }

  // Transformer
  const xfmr = query.match(/\b(?:transformer|xfmr)\s+([TtXx]\d+[A-Z]?)\b/i)
  if (xfmr) return { tag: xfmr[1].toUpperCase(), discipline: 'electrical' }
  const xfmrBare = query.match(/\b(T\d+[A-Z]?)\b/)
  if (xfmrBare) return { tag: xfmrBare[1].toUpperCase(), discipline: 'electrical' }

  // AHU/RTU/FCU
  const ahu = query.match(/\b((?:AHU|RTU|FCU)\s*[-\s]?\d+[A-Z]?)\b/i)
  if (ahu) return { tag: ahu[1].toUpperCase().replace(/\s+/g, ''), discipline: 'mechanical' }

  // VAV
  const vav = query.match(/\b(VAV\s*[-\s]?\d+[A-Z]?)\b/i)
  if (vav) return { tag: vav[1].toUpperCase().replace(/\s+/g, ''), discipline: 'mechanical' }

  // Exhaust/supply fans
  const fan = query.match(/\b((?:EF|SF|RF)-?\d+[A-Z]?)\b/i)
  if (fan) return { tag: fan[1].toUpperCase(), discipline: 'mechanical' }

  // Plumbing fixtures
  const plmbFull = query.match(/\b(?:water\s+closet|wc|lavatory|sink|urinal|shower)\s+(\w\d*[A-Z]?)\b/i)
  if (plmbFull) return { tag: plmbFull[1].toUpperCase(), discipline: 'plumbing' }
  const plmbBare = query.match(/\b((?:WC|WH|HB|DF|FD|CO)-?\d+[A-Z]?)\b/)
  if (plmbBare) return { tag: plmbBare[1].toUpperCase(), discipline: 'plumbing' }

  return { tag: null, discipline: null }
}

// ---------------------------------------------------------------------------
// Coordination extractors (Phase 5B)
// ---------------------------------------------------------------------------

function extractCoordRoom(query: string): string | null {
  // Reuse the same pattern as arch extractArchRoom
  const patterns = [
    /\broom\s+(\w+[-\w]*)/i,
    /\b(?:in|for|within|about)\s+room\s+(\w+[-\w]*)/i,
  ]
  for (const p of patterns) {
    const m = query.match(p)
    if (m) return m[1].toUpperCase()
  }
  return null
}

function extractCoordLevel(query: string): string | null {
  // Same as extractDemoLevel
  const patterns = [
    /\b(?:floor|level)\s+([A-Z0-9]+)/i,
    /\b(\d+(?:st|nd|rd|th)\s+floor)\b/i,
    /\bL(\d+)\b/,
  ]
  for (const p of patterns) {
    const m = query.match(p)
    if (m) return m[1].toUpperCase()
  }
  return null
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

  // Check for demo constraint queries (pre-demo checks, risks, verification)
  for (const pattern of DEMO_CONSTRAINT_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: 'demo_constraint',
        intent: 'informational',
        confidence: 0.85,
        demoRoom: extractDemoRoom(query),
        demoLevel: extractDemoLevel(query),
        needsDirectLookup: false,
        needsVectorSearch: true,
        needsVision: false,
        needsCompleteData: false,
        isAggregationQuery: false,
        searchHints: {
          preferredSheetTypes: ['demo_notes', 'demo_plan'],
          keywords: ['verify', 'protect', 'risk', 'coordinate', 'hazard'],
        },
      };
    }
  }

  // Check for demo scope queries (what gets removed / what remains)
  const hasDemoScope = DEMO_SCOPE_PATTERNS.some(p => p.test(normalized));
  const hasDemoRemain = DEMO_REMAIN_PATTERNS.some(p => p.test(normalized));
  if (hasDemoScope || hasDemoRemain) {
    return {
      type: 'demo_scope',
      intent: 'informational',
      confidence: 0.85,
      demoRoom: extractDemoRoom(query),
      demoLevel: extractDemoLevel(query),
      demoStatusHint: hasDemoRemain && !hasDemoScope ? 'to_remain' : undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['demo_plan', 'demo_rcp'],
        keywords: ['demolish', 'remove', 'remain', 'protect', 'relocate'],
      },
    };
  }

  // ── Phase 5B: Coordination queries (checked before structural/MEP) ─────

  // coordination_sequence — "what could hold this work up?" (most specific)
  if (COORDINATION_SEQUENCE_PATTERNS.some(p => p.test(normalized))) {
    return {
      type: 'coordination_sequence',
      intent: 'informational',
      confidence: 0.88,
      coordRoom:  extractCoordRoom(query) ?? undefined,
      coordLevel: extractCoordLevel(query) ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['demo_plan', 'arch_floor_plan', 'mechanical_floor_plan', 'electrical_power_plan'],
        keywords: ['coordinate', 'hold', 'delay', 'before', 'first'],
      },
    }
  }

  // affected_area — "what systems are affected on Level 1?"
  if (AFFECTED_AREA_PATTERNS.some(p => p.test(normalized))) {
    return {
      type: 'affected_area',
      intent: 'informational',
      confidence: 0.85,
      coordRoom:  extractCoordRoom(query) ?? undefined,
      coordLevel: extractCoordLevel(query) ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['arch_floor_plan', 'mechanical_floor_plan', 'electrical_power_plan', 'plumbing_plan'],
        keywords: ['affected', 'system', 'level', 'room'],
      },
    }
  }

  // trade_coordination — "what trades touch Room 105?"
  if (TRADE_COORDINATION_PATTERNS.some(p => p.test(normalized))) {
    return {
      type: 'trade_coordination',
      intent: 'informational',
      confidence: 0.85,
      coordRoom:  extractCoordRoom(query) ?? undefined,
      coordLevel: extractCoordLevel(query) ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['arch_floor_plan', 'mechanical_floor_plan', 'electrical_power_plan', 'plumbing_plan'],
        keywords: ['trades', 'systems', 'room', 'coordinate'],
      },
    }
  }

  // ── Phase 5A: Structural queries ────────────────────────────────────────

  // struct_element_lookup — "what is column C-4?" (requires a mark)
  if (STRUCTURAL_ELEMENT_PATTERNS.some(p => p.test(normalized))) {
    const { mark, entityType } = extractStructMark(query)
    if (mark) {
      return {
        type: 'struct_element_lookup',
        intent: 'informational',
        confidence: 0.88,
        structMark:       mark,
        structEntityType: entityType ?? undefined,
        structGrid:       extractStructGrid(query) ?? undefined,
        structLevel:      extractStructLevel(query) ?? undefined,
        needsDirectLookup: false,
        needsVectorSearch: true,
        needsVision: false,
        needsCompleteData: false,
        isAggregationQuery: false,
        searchHints: {
          preferredSheetTypes: ['structural_foundation_plan', 'structural_framing_plan'],
          keywords: [mark, entityType ?? 'structural'].filter(Boolean),
        },
      }
    }
  }

  // struct_area_scope — "what structural elements are on Level 1?"
  if (STRUCTURAL_AREA_PATTERNS.some(p => p.test(normalized))) {
    return {
      type: 'struct_area_scope',
      intent: 'informational',
      confidence: 0.85,
      structGrid:  extractStructGrid(query) ?? undefined,
      structLevel: extractStructLevel(query) ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['structural_foundation_plan', 'structural_framing_plan'],
        keywords: ['structural', 'footing', 'column', 'beam'],
      },
    }
  }

  // ── Phase 5A: MEP queries ───────────────────────────────────────────────

  // mep_element_lookup — "what panel is LP-1?" (requires a tag)
  if (MEP_ELEMENT_PATTERNS.some(p => p.test(normalized))) {
    const { tag, discipline } = extractMEPTag(query)
    if (tag) {
      return {
        type: 'mep_element_lookup',
        intent: 'informational',
        confidence: 0.88,
        mepTag:        tag,
        mepDiscipline: discipline ?? undefined,
        needsDirectLookup: false,
        needsVectorSearch: true,
        needsVision: false,
        needsCompleteData: false,
        isAggregationQuery: false,
        searchHints: {
          preferredSheetTypes: [
            discipline === 'mechanical' ? 'mechanical_floor_plan' :
            discipline === 'plumbing'   ? 'plumbing_plan'         :
            'electrical_power_plan',
            'equipment_schedule', 'panel_schedule',
          ],
          keywords: [tag, discipline ?? 'mep'].filter(Boolean),
        },
      }
    }
  }

  // mep_area_scope — "what MEP is in Room 105?"
  if (MEP_AREA_PATTERNS.some(p => p.test(normalized))) {
    const { discipline } = extractMEPTag(query)
    const coordRoom = extractCoordRoom(query)
    return {
      type: 'mep_area_scope',
      intent: 'informational',
      confidence: 0.85,
      mepDiscipline: discipline ?? undefined,
      coordRoom:     coordRoom  ?? undefined,
      coordLevel:    extractCoordLevel(query) ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['mechanical_floor_plan', 'electrical_power_plan', 'plumbing_plan'],
        keywords: ['mep', 'mechanical', 'electrical', 'plumbing'].concat(coordRoom ? [coordRoom] : []),
      },
    }
  }

  // ── Architectural queries ───────────────────────────────────────────────

  // Check for arch schedule queries (most specific arch type — check before element/room)
  if (ARCH_SCHEDULE_PATTERNS.some(p => p.test(normalized))) {
    const { tag, tagType } = extractArchTag(query);
    return {
      type: 'arch_schedule_query',
      intent: 'informational',
      confidence: 0.85,
      archTag: tag ?? undefined,
      archTagType: tagType ?? undefined,
      archScheduleType: extractArchScheduleType(query) ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['door_schedule', 'window_schedule', 'room_finish_schedule'],
        keywords: ['door', 'window', 'schedule', 'hardware', 'finish'],
      },
    };
  }

  // Check for arch element lookup (single door/window/wall/keynote by tag)
  if (ARCH_ELEMENT_PATTERNS.some(p => p.test(normalized))) {
    const { tag, tagType } = extractArchTag(query);
    if (tag) {  // Only fire if we actually extracted a tag — prevents false positives
      return {
        type: 'arch_element_lookup',
        intent: 'informational',
        confidence: 0.88,
        archTag: tag,
        archTagType: tagType ?? undefined,
        needsDirectLookup: false,
        needsVectorSearch: true,
        needsVision: false,
        needsCompleteData: false,
        isAggregationQuery: false,
        searchHints: {
          preferredSheetTypes: ['arch_floor_plan', 'door_schedule', 'window_schedule'],
          keywords: [tag, 'door', 'window', 'wall type'].filter(Boolean),
        },
      };
    }
  }

  // Check for arch room scope queries
  if (ARCH_ROOM_PATTERNS.some(p => p.test(normalized))) {
    const archRoom = extractArchRoom(query);
    return {
      type: 'arch_room_scope',
      intent: 'informational',
      confidence: 0.85,
      archRoom: archRoom ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['arch_floor_plan', 'room_finish_schedule'],
        keywords: ['room', 'finish', 'door', 'window'].concat(archRoom ? [archRoom] : []),
      },
    };
  }

  // ── Phase 6: Governing document (most specific — check before RFI/spec) ──

  if (GOVERNING_DOCUMENT_PATTERNS.some(p => p.test(normalized))) {
    return {
      type: 'governing_document_query',
      intent: 'informational',
      confidence: 0.88,
      governingDocScope: query,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['spec_section', 'rfi', 'submittal'],
        keywords: ['governs', 'precedence', 'spec', 'rfi', 'plan'],
      },
    }
  }

  // ── Phase 6: RFI lookup ──────────────────────────────────────────────────

  if (RFI_LOOKUP_PATTERNS.some(p => p.test(normalized))) {
    return {
      type: 'rfi_lookup',
      intent: 'informational',
      confidence: 0.88,
      rfiNumber:     extractRFINumber(query) ?? undefined,
      changeDocType: extractChangeDocType(query) ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['rfi', 'change_document'],
        keywords: ['rfi', 'clarification', 'change', 'supersede'],
      },
    }
  }

  // ── Phase 6: Change impact lookup ───────────────────────────────────────

  if (CHANGE_IMPACT_PATTERNS.some(p => p.test(normalized))) {
    return {
      type: 'change_impact_lookup',
      intent: 'informational',
      confidence: 0.85,
      rfiNumber:     extractRFINumber(query) ?? undefined,
      changeDocType: extractChangeDocType(query) ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['rfi', 'addendum', 'bulletin'],
        keywords: ['changed', 'revised', 'addendum', 'supersede'],
      },
    }
  }

  // ── Phase 6: Submittal lookup ────────────────────────────────────────────

  if (SUBMITTAL_LOOKUP_PATTERNS.some(p => p.test(normalized))) {
    return {
      type: 'submittal_lookup',
      intent: 'informational',
      confidence: 0.85,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['submittal_log', 'product_data'],
        keywords: ['submittal', 'approved', 'product data', 'shop drawing'],
      },
    }
  }

  // ── Phase 6: Spec section lookup ─────────────────────────────────────────

  if (SPEC_SECTION_PATTERNS.some(p => p.test(normalized))) {
    return {
      type: 'spec_section_lookup',
      intent: 'informational',
      confidence: 0.87,
      specSection:          extractSpecSection(query) ?? undefined,
      specRequirementType:  extractSpecRequirementType(query) ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['spec_section'],
        keywords: ['specification', 'section', 'require', 'shall'],
      },
    }
  }

  // ── Phase 6: Spec requirement lookup ─────────────────────────────────────

  if (SPEC_REQUIREMENT_PATTERNS.some(p => p.test(normalized))) {
    return {
      type: 'spec_requirement_lookup',
      intent: 'informational',
      confidence: 0.85,
      specSection:          extractSpecSection(query) ?? undefined,
      specRequirementType:  extractSpecRequirementType(query) ?? undefined,
      needsDirectLookup: false,
      needsVectorSearch: true,
      needsVision: false,
      needsCompleteData: false,
      isAggregationQuery: false,
      searchHints: {
        preferredSheetTypes: ['spec_section'],
        keywords: ['requirement', 'shall', 'required', 'testing', 'material'],
      },
    }
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
