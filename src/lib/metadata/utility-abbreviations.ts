/**
 * Utility Crossing Detection - Abbreviation Reference Dictionary
 *
 * This module contains utility abbreviations and patterns used in construction plans,
 * specifically for detecting utility crossings in profile views.
 *
 * Profile views show utility crossings with small labels (ELEC, SS, STM, etc.) and
 * elevation numbers, rather than explicit text like "crossing" or "conflict".
 */

/**
 * Standard utility abbreviations found in construction profile views
 */
export const UTILITY_ABBREVIATIONS = {
  // Electrical
  ELEC: { fullName: 'Electrical', category: 'power', aliases: ['E', 'ELECTRIC', 'ELECTRICAL'] },

  // Sanitary Sewer
  SS: { fullName: 'Sanitary Sewer', category: 'sewer', aliases: ['S', 'SAN SEWER', 'SANITARY', 'SANITARY SEWER'] },

  // Storm Drain
  STM: { fullName: 'Storm Drain', category: 'storm', aliases: ['SD', 'D', 'STORM', 'STORM DRAIN', 'STORM SEWER'] },

  // Water Line
  W: { fullName: 'Water Line', category: 'water', aliases: ['WL', 'WATER', 'WATER LINE', 'WATER MAIN'] },

  // Gas
  GAS: { fullName: 'Gas Line', category: 'gas', aliases: ['G', 'GAS LINE', 'NAT GAS', 'NATURAL GAS'] },

  // Telephone/Telecom
  TEL: { fullName: 'Telephone/Telecom', category: 'telecom', aliases: ['T', 'TELEPHONE', 'TELECOM', 'TEL/CATV', 'CATV', 'CABLE'] },

  // Fiber Optic
  FO: { fullName: 'Fiber Optic', category: 'telecom', aliases: ['FIBER', 'FIBER OPTIC', 'FIB OPT'] },

  // Additional common utilities
  EXIST: { fullName: 'Existing Utility', category: 'modifier', aliases: ['EX', 'EXISTING'] },
  PROP: { fullName: 'Proposed Utility', category: 'modifier', aliases: ['NEW', 'PROPOSED'] },

  // Other utilities
  OHE: { fullName: 'Overhead Electric', category: 'power', aliases: ['OH ELEC', 'OVERHEAD ELEC'] },
  UGE: { fullName: 'Underground Electric', category: 'power', aliases: ['UG ELEC', 'UNDERGROUND ELEC'] },
  IRR: { fullName: 'Irrigation', category: 'water', aliases: ['IRRIGATION', 'IRR LINE'] },
  RW: { fullName: 'Reclaimed Water', category: 'water', aliases: ['RECLAIMED', 'RECLAIMED WATER'] },
  FM: { fullName: 'Force Main', category: 'sewer', aliases: ['FORCE MAIN', 'F.M.'] },
} as const;

/**
 * All utility abbreviations as a flat list for searching
 */
export const UTILITY_CODES = Object.keys(UTILITY_ABBREVIATIONS);

/**
 * All aliases mapped back to standard codes
 */
export const UTILITY_ALIAS_MAP: Record<string, string> = Object.entries(UTILITY_ABBREVIATIONS).reduce(
  (map, [code, info]) => {
    map[code] = code; // Standard code maps to itself
    info.aliases.forEach(alias => {
      map[alias] = code;
    });
    return map;
  },
  {} as Record<string, string>
);

/**
 * Keywords that indicate a utility crossing query
 */
export const CROSSING_KEYWORDS = {
  primary: [
    'cross',
    'crossing',
    'crosses',
    'intersect',
    'intersects',
    'intersection',
    'conflict',
    'conflicts',
    'interference',
    'interferes',
  ],
  utilityTypes: [
    'electrical',
    'elec',
    'sewer',
    'sanitary',
    'storm',
    'water',
    'gas',
    'telecom',
    'telephone',
    'fiber',
    'cable',
    'utility',
    'utilities',
  ],
  questions: [
    'what utilities',
    'which utilities',
    'what lines',
    'which lines',
    'other systems',
    'existing utilities',
    'what crosses',
    'what intersects',
    'any conflicts',
    'any crossings',
    'list crossings',
    'show crossings',
    'find crossings',
  ],
};

/**
 * Regex patterns for detecting utility crossing indicators in extracted text
 */
export const CROSSING_PATTERNS = {
  // Utility code with elevation: "ELEC 35.73±" or "SS INV 28.50"
  utilityWithElevation: /\b(ELEC|E|SS|S|STM|SD|D|W|WL|GAS|G|TEL|T|FO|OHE|UGE|IRR|RW|FM)\b\s+(?:INV\s+)?(?:ELEV\s*=?\s*)?(\d+\.?\d*)\s*[±]?/gi,

  // Station numbers: "STA 15+20", "15+20.50", etc.
  station: /\b(?:STA\.?\s*)?(\d{1,3}\+\d{2}(?:\.\d{2})?)\b/gi,

  // Elevation numbers with ± symbol
  elevation: /\b(\d+\.?\d*)\s*[±]\s*(?:ft|')?/gi,

  // Invert elevation: "INV ELEV = 28.50"
  invertElevation: /\bINV(?:ERT)?\s+ELEV(?:ATION)?\s*=?\s*(\d+\.?\d*)/gi,

  // Existing utility indicator
  existingUtility: /\b(EXIST(?:ING)?|EX)\s+(ELEC|SS|STM|SD|W|WL|GAS|TEL|FO|WATER|SEWER|STORM|ELECTRIC|GAS LINE|WATER LINE)/gi,

  // Proposed utility indicator
  proposedUtility: /\b(PROP(?:OSED)?|NEW)\s+(ELEC|SS|STM|SD|W|WL|GAS|TEL|FO|WATER|SEWER|STORM|ELECTRIC)/gi,

  // Sized utility: "12-IN W", "8-IN SS"
  sizedUtility: /\b(\d+)\s*-?\s*(?:IN|INCH|")\s+(ELEC|E|SS|S|STM|SD|D|W|WL|GAS|G|TEL|T|FO)/gi,
};

/**
 * Normalize a utility abbreviation to its standard code
 * @param text - Utility text from profile view
 * @returns Standard utility code or null if not found
 */
export function normalizeUtilityCode(text: string): string | null {
  const upper = text.trim().toUpperCase();
  return UTILITY_ALIAS_MAP[upper] || null;
}

/**
 * Get full utility name from abbreviation
 * @param code - Utility abbreviation code
 * @returns Full utility name or the original code if not found
 */
export function getUtilityFullName(code: string): string {
  const normalized = normalizeUtilityCode(code);
  if (normalized && normalized in UTILITY_ABBREVIATIONS) {
    return UTILITY_ABBREVIATIONS[normalized as keyof typeof UTILITY_ABBREVIATIONS].fullName;
  }
  return code;
}

/**
 * Check if text contains any utility crossing keywords
 * @param text - Query text to check
 * @returns true if crossing keywords are detected
 */
export function containsCrossingKeywords(text: string): boolean {
  const lower = text.toLowerCase();

  // Check primary keywords
  const hasPrimary = CROSSING_KEYWORDS.primary.some(kw => lower.includes(kw));

  // Check question patterns
  const hasQuestion = CROSSING_KEYWORDS.questions.some(pattern => lower.includes(pattern));

  // Check utility type mentions
  const hasUtilityType = CROSSING_KEYWORDS.utilityTypes.some(type => lower.includes(type));

  // Crossing query if:
  // - Has primary keyword + utility type mention, OR
  // - Has specific question pattern
  return (hasPrimary && hasUtilityType) || hasQuestion;
}

/**
 * Extract utility crossing indicators from text
 * @param text - Extracted text from profile view
 * @returns Array of detected crossing indicators
 */
export interface CrossingIndicator {
  utilityCode: string;
  utilityFullName: string;
  elevation?: number;
  station?: string;
  isExisting: boolean;
  isProposed: boolean;
  size?: string;
  rawMatch: string;
}

export function extractCrossingIndicators(text: string): CrossingIndicator[] {
  const indicators: CrossingIndicator[] = [];

  // Find all utility mentions with elevations
  const utilityElevMatches = Array.from(text.matchAll(CROSSING_PATTERNS.utilityWithElevation));
  for (const match of utilityElevMatches) {
    const code = normalizeUtilityCode(match[1]);
    if (!code) continue;

    const elevation = parseFloat(match[2]);

    indicators.push({
      utilityCode: code,
      utilityFullName: getUtilityFullName(code),
      elevation: isNaN(elevation) ? undefined : elevation,
      isExisting: false,
      isProposed: false,
      rawMatch: match[0],
    });
  }

  // Find existing utility mentions
  const existingMatches = Array.from(text.matchAll(CROSSING_PATTERNS.existingUtility));
  for (const match of existingMatches) {
    const code = normalizeUtilityCode(match[2]);
    if (!code) continue;

    indicators.push({
      utilityCode: code,
      utilityFullName: getUtilityFullName(code),
      isExisting: true,
      isProposed: false,
      rawMatch: match[0],
    });
  }

  // Find sized utilities
  const sizedMatches = Array.from(text.matchAll(CROSSING_PATTERNS.sizedUtility));
  for (const match of sizedMatches) {
    const code = normalizeUtilityCode(match[2]);
    if (!code) continue;

    indicators.push({
      utilityCode: code,
      utilityFullName: getUtilityFullName(code),
      size: `${match[1]}-IN`,
      isExisting: false,
      isProposed: false,
      rawMatch: match[0],
    });
  }

  // Extract station numbers from text
  const stations: string[] = [];
  const stationMatches = Array.from(text.matchAll(CROSSING_PATTERNS.station));
  for (const match of stationMatches) {
    stations.push(match[1]);
  }

  // Associate stations with indicators (simple proximity heuristic)
  // If we have N indicators and M stations, associate closest ones
  if (stations.length > 0) {
    indicators.forEach((indicator, idx) => {
      if (idx < stations.length) {
        indicator.station = stations[idx];
      }
    });
  }

  return indicators;
}

/**
 * Format crossing indicators as a markdown table
 * @param indicators - Array of crossing indicators
 * @param systemName - Name of the system being queried
 * @returns Formatted markdown table
 */
export function formatCrossingTable(indicators: CrossingIndicator[], systemName?: string): string {
  if (indicators.length === 0) {
    return 'No utility crossing indicators found in extracted text.';
  }

  const header = systemName ? `## Utility Crossings - ${systemName}\n\n` : '## Utility Crossings\n\n';

  const table = [
    '| Station | Crossing Utility | Elevation/Depth | Type | Size | Notes |',
    '|---------|------------------|-----------------|------|------|-------|',
  ];

  indicators.forEach(ind => {
    const station = ind.station || 'Not specified';
    const utility = `${ind.utilityFullName} (${ind.utilityCode})`;
    const elevation = ind.elevation !== undefined ? `${ind.elevation}± ft` : 'Not specified';
    const type = ind.isExisting ? 'Existing' : ind.isProposed ? 'Proposed' : 'Unknown';
    const size = ind.size || '-';
    const notes = ind.rawMatch || '-';

    table.push(`| ${station} | ${utility} | ${elevation} | ${type} | ${size} | ${notes} |`);
  });

  return header + table.join('\n') + `\n\n**Total:** ${indicators.length} utility crossing(s) identified`;
}
