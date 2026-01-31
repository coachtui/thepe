/**
 * Station Range Parser and Calculator
 *
 * Parses construction station notation (e.g., "13+00", "STA 15+50")
 * and calculates lengths between stations.
 *
 * Station Math:
 * - 1 station = 100 feet
 * - "13+00" = Station 13, offset 0 = 1,300 feet from origin
 * - "15+50" = Station 15, offset 50 = 1,550 feet from origin
 * - Length from 13+00 to 15+50 = 1,550 - 1,300 = 250 LF
 */

export interface ParsedStation {
  original: string;
  station: number;      // Major station number
  offset: number;       // Offset within station (0-99.99)
  totalFeet: number;    // Total feet from origin
  normalized: string;   // Normalized format: "0013+50.00"
}

export interface StationRange {
  from: ParsedStation;
  to: ParsedStation | 'end';
  lengthFeet?: number;  // Calculated length (if not "to end")
  description: string;
}

/**
 * Parse a station string into structured data
 *
 * Handles formats:
 * - "13+00"
 * - "STA 13+00"
 * - "Station 13+00"
 * - "13+68.83"
 * - "0013+50"
 */
export function parseStation(input: string): ParsedStation | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // Clean input: remove "STA", "Station", extra spaces
  let cleaned = input.trim();
  cleaned = cleaned.replace(/^(STA|Station)\s*/i, '');
  cleaned = cleaned.trim();

  // Match pattern: digits + optional "+" + optional digits
  const regex = /^(\d+)\+?(\d+(?:\.\d+)?)?$/;
  const match = cleaned.match(regex);

  if (!match) {
    return null;
  }

  const station = parseInt(match[1], 10);
  const offset = match[2] ? parseFloat(match[2]) : 0;

  // Validate offset is within 0-99.99
  if (offset < 0 || offset >= 100) {
    return null;
  }

  const totalFeet = (station * 100) + offset;
  const normalized = `${station.toString().padStart(4, '0')}+${offset.toFixed(2).padStart(5, '0')}`;

  return {
    original: input.trim(),
    station,
    offset,
    totalFeet,
    normalized
  };
}

/**
 * Parse a station range string
 *
 * Handles formats:
 * - "13+00 to 36+00"
 * - "Sta 13+00 to Sta 36+00"
 * - "13+00 to End"
 * - "13+00 to end"
 * - "From 13+00 to 36+00"
 */
export function parseStationRange(input: string): StationRange | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const cleaned = input.trim();

  // Match pattern: "station TO station" or "station TO end"
  const rangeRegex = /(?:from\s+)?(.+?)\s+to\s+(.+?)$/i;
  const match = cleaned.match(rangeRegex);

  if (!match) {
    return null;
  }

  const [, fromStr, toStr] = match;

  // Parse "from" station
  const from = parseStation(fromStr);
  if (!from) {
    return null;
  }

  // Check if "to" is "end"
  if (toStr.trim().toLowerCase() === 'end') {
    return {
      from,
      to: 'end',
      description: `${from.normalized} to End`
    };
  }

  // Parse "to" station
  const to = parseStation(toStr);
  if (!to) {
    return null;
  }

  // Calculate length
  const lengthFeet = to.totalFeet - from.totalFeet;

  // Validate length is positive
  if (lengthFeet <= 0) {
    return null;
  }

  return {
    from,
    to,
    lengthFeet,
    description: `${from.normalized} to ${to.normalized}`
  };
}

/**
 * Calculate length between two stations
 */
export function calculateStationLength(
  from: string | ParsedStation,
  to: string | ParsedStation
): number | null {
  const fromStation = typeof from === 'string' ? parseStation(from) : from;
  const toStation = typeof to === 'string' ? parseStation(to) : to;

  if (!fromStation || !toStation) {
    return null;
  }

  const length = toStation.totalFeet - fromStation.totalFeet;
  return length > 0 ? length : null;
}

/**
 * Format feet as station notation
 *
 * @param feet - Total feet from origin
 * @returns Station notation (e.g., "0013+50.00")
 */
export function feetToStation(feet: number): string {
  const station = Math.floor(feet / 100);
  const offset = feet % 100;
  return `${station.toString().padStart(4, '0')}+${offset.toFixed(2).padStart(5, '0')}`;
}

/**
 * Estimate "end" station from document context
 *
 * When a range says "Sta 13+00 to End", we need to estimate
 * the end station. Common heuristics:
 * 1. Look for maximum station in document
 * 2. Use typical project length (e.g., 25 stations = 2,500 LF)
 * 3. Use station from other items
 *
 * @param fromStation - Starting station
 * @param maxStationInDoc - Maximum station found in document (if known)
 * @returns Estimated end station in feet
 */
export function estimateEndStation(
  fromStation: ParsedStation,
  maxStationInDoc?: number
): number {
  // If we know the max station from the document, use it
  if (maxStationInDoc !== undefined && maxStationInDoc > fromStation.totalFeet) {
    return maxStationInDoc;
  }

  // Default heuristic: assume project is at least 20 stations long
  // This is conservative - better to underestimate than overestimate
  const typicalProjectLength = 2000; // 20 stations = 2,000 LF
  const estimatedEnd = fromStation.totalFeet + typicalProjectLength;

  return estimatedEnd;
}

/**
 * Calculate quantity from station range
 *
 * @param range - Station range (from parser)
 * @param maxStationInDoc - Maximum station in document (for "to end" cases)
 * @returns Quantity in linear feet
 */
export function calculateQuantityFromRange(
  range: StationRange,
  maxStationInDoc?: number
): number | null {
  // If range has explicit "to" station, use it
  if (range.to !== 'end') {
    return range.lengthFeet || null;
  }

  // Handle "to end" case
  const endFeet = estimateEndStation(range.from, maxStationInDoc);
  return endFeet - range.from.totalFeet;
}

/**
 * Extract all station numbers from text
 *
 * Useful for finding maximum station in a document.
 *
 * @param text - Text to search
 * @returns Array of parsed stations, sorted by totalFeet
 */
export function extractStationsFromText(text: string): ParsedStation[] {
  if (!text) return [];

  const stations: ParsedStation[] = [];

  // Match patterns like "13+00", "STA 15+50", etc.
  const regex = /(?:STA|Station)?\s*(\d{1,4})\+(\d{1,2}(?:\.\d+)?)/gi;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const parsed = parseStation(match[0]);
    if (parsed) {
      stations.push(parsed);
    }
  }

  // Sort by total feet and deduplicate
  const uniqueStations = Array.from(
    new Map(stations.map(s => [s.totalFeet, s])).values()
  );

  return uniqueStations.sort((a, b) => a.totalFeet - b.totalFeet);
}

/**
 * Find maximum station in an array of stations
 */
export function findMaxStation(stations: ParsedStation[]): ParsedStation | null {
  if (!stations || stations.length === 0) {
    return null;
  }

  return stations.reduce((max, current) =>
    current.totalFeet > max.totalFeet ? current : max
  );
}

// =============================================================================
// EXAMPLES AND TESTS
// =============================================================================

/*
Example Usage:

1. Parse a single station:
```typescript
const station = parseStation("13+50");
// { station: 13, offset: 50, totalFeet: 1350, normalized: "0013+50.00" }
```

2. Parse a station range:
```typescript
const range = parseStationRange("Sta 13+00 to 36+00");
// {
//   from: { station: 13, offset: 0, totalFeet: 1300 },
//   to: { station: 36, offset: 0, totalFeet: 3600 },
//   lengthFeet: 2300
// }
```

3. Handle "to end":
```typescript
const range = parseStationRange("13+00 to End");
const maxStation = 3750; // From document analysis
const length = calculateQuantityFromRange(range, maxStation);
// 3750 - 1300 = 2450 LF
```

4. Extract all stations from text:
```typescript
const text = "Water Line A runs from Sta 13+00 through Sta 20+00 to Sta 36+50";
const stations = extractStationsFromText(text);
// [
//   { station: 13, offset: 0, totalFeet: 1300 },
//   { station: 20, offset: 0, totalFeet: 2000 },
//   { station: 36, offset: 50, totalFeet: 3650 }
// ]
```

5. Calculate length:
```typescript
const length = calculateStationLength("13+00", "36+00");
// 2300 LF
```
*/
