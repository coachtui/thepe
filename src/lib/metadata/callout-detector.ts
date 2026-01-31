/**
 * Callout Box Detection and Extraction
 *
 * Construction plans contain critical callout boxes with component lists.
 * These are typically formatted as:
 *
 * WATER LINE 'A' STA 13+00
 * - 1 - 12-IN GATE VALVE AND VALVE BOX
 * - 1 - 12-IN × 8-IN TEE
 * - 1 - 12-IN PLUG
 *
 * This module detects these patterns and extracts structured data.
 */

export interface CalloutBox {
  header: string;           // e.g., "WATER LINE 'A' STA 13+00"
  fullText: string;         // Complete callout box text
  systemName: string;       // e.g., "WATER LINE 'A'", "STORM DRAIN 'B'"
  station: string;          // e.g., "13+00", "STA 36+50.25"
  components: Component[];  // Parsed component list
  startIndex: number;       // Position in source text
  endIndex: number;         // End position in source text
  confidence: number;       // 0.0-1.0
}

export interface Component {
  quantity: number;         // e.g., 1, 2
  size?: string;           // e.g., "12-IN", "8-IN"
  name: string;            // e.g., "GATE VALVE", "TEE", "PLUG"
  fullDescription: string; // e.g., "12-IN GATE VALVE AND VALVE BOX"
}

export interface CalloutMetadata {
  isCalloutBox: boolean;
  containsComponents: boolean;
  componentList?: string[];    // Simple list of component names
  componentCount?: number;
  systemName?: string;
  station?: string;
}

/**
 * Patterns for detecting callout box headers
 */
const CALLOUT_HEADER_PATTERNS = [
  // Water line patterns
  /WATER\s+LINE\s+['"]?([A-Z\d-]+)['"]?\s+STA\s+([\d+.]+)/i,
  /WL[-_]([A-Z\d]+)\s+STA\s+([\d+.]+)/i,

  // Storm drain patterns
  /STORM\s+DRAIN\s+['"]?([A-Z\d-]+)['"]?\s+STA\s+([\d+.]+)/i,
  /SD[-_]([A-Z\d]+)\s+STA\s+([\d+.]+)/i,

  // Sewer patterns
  /(?:SANITARY\s+)?SEWER\s+(?:LINE\s+)?['"]?([A-Z\d-]+)['"]?\s+STA\s+([\d+.]+)/i,
  /SS[-_]([A-Z\d]+)\s+STA\s+([\d+.]+)/i,

  // Fire protection patterns
  /FIRE\s+(?:PROTECTION\s+)?LINE\s+['"]?([A-Z\d-]+)['"]?\s+STA\s+([\d+.]+)/i,
  /FP[-_]([A-Z\d]+)\s+STA\s+([\d+.]+)/i,

  // Generic utility patterns
  /(?:UTILITY\s+)?LINE\s+['"]?([A-Z\d-]+)['"]?\s+(?:AT\s+)?STA(?:TION)?\s+([\d+.]+)/i
];

/**
 * Patterns for detecting component lines (bulleted items)
 */
const COMPONENT_LINE_PATTERNS = [
  // Standard format: "1 - 12-IN GATE VALVE AND VALVE BOX"
  /^\s*[-•*]\s*(\d+)\s*[-–]\s*(.+)$/i,

  // Without bullet: "1 - 12-IN GATE VALVE"
  /^\s*(\d+)\s*[-–]\s*([A-Z\d-][^$]+)$/i,

  // With parentheses: "(1) 12-IN GATE VALVE"
  /^\s*\((\d+)\)\s*(.+)$/i,
];

/**
 * Size pattern for extracting dimensions from component descriptions
 */
const SIZE_PATTERN = /(\d+(?:\.\d+)?[-\s]?(?:IN|INCH|"|FT|FOOT|')(?:\s*[×xX]\s*\d+(?:\.\d+)?[-\s]?(?:IN|INCH|"|FT|FOOT|')?)?)/i;

/**
 * Detect callout boxes in text
 *
 * @param text - Source text (typically from a document chunk)
 * @returns Array of detected callout boxes
 */
export function detectCalloutBoxes(text: string): CalloutBox[] {
  const callouts: CalloutBox[] = [];
  const lines = text.split('\n');

  let currentCallout: Partial<CalloutBox> | null = null;
  let currentLineIndex = 0;
  let currentCharIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check if this line is a callout header
    const headerMatch = matchCalloutHeader(line);

    if (headerMatch) {
      // Save previous callout if exists
      if (currentCallout && currentCallout.header) {
        callouts.push(finalizeCallout(currentCallout));
      }

      // Start new callout
      currentCallout = {
        header: trimmedLine,
        systemName: headerMatch.systemName,
        station: headerMatch.station,
        components: [],
        startIndex: currentCharIndex,
        confidence: 0.8,
        fullText: line
      };
      currentLineIndex = i;
    }
    // Check if this line is a component (while in a callout)
    else if (currentCallout && trimmedLine.length > 0) {
      const component = parseComponentLine(trimmedLine);

      if (component) {
        currentCallout.components = currentCallout.components || [];
        currentCallout.components.push(component);
        currentCallout.fullText = (currentCallout.fullText || '') + '\n' + line;
        currentCallout.confidence = 0.9; // Higher confidence with components
      } else if (currentCallout.components && currentCallout.components.length > 0) {
        // End of callout (non-component line after components found)
        currentCallout.endIndex = currentCharIndex;
        callouts.push(finalizeCallout(currentCallout));
        currentCallout = null;
      }
    }

    currentCharIndex += line.length + 1; // +1 for newline
  }

  // Finalize last callout if exists
  if (currentCallout && currentCallout.header) {
    currentCallout.endIndex = currentCharIndex;
    callouts.push(finalizeCallout(currentCallout));
  }

  return callouts;
}

/**
 * Match callout header patterns
 */
function matchCalloutHeader(line: string): { systemName: string; station: string } | null {
  for (const pattern of CALLOUT_HEADER_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      const systemType = line.match(/(WATER\s+LINE|STORM\s+DRAIN|SEWER|FIRE.*LINE)/i)?.[1] || 'LINE';
      const identifier = match[1];
      const station = match[2];

      return {
        systemName: `${systemType} '${identifier}'`,
        station: station
      };
    }
  }

  return null;
}

/**
 * Parse a component line into structured data
 */
function parseComponentLine(line: string): Component | null {
  for (const pattern of COMPONENT_LINE_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      const quantity = parseInt(match[1], 10);
      const description = match[2].trim();

      // Extract size if present
      const sizeMatch = description.match(SIZE_PATTERN);
      const size = sizeMatch ? sizeMatch[1] : undefined;

      // Extract component name (remove size from description)
      let name = description;
      if (size) {
        name = description.replace(SIZE_PATTERN, '').trim();
        name = name.replace(/^[-–\s]+/, '').trim(); // Remove leading dashes
      }

      return {
        quantity,
        size,
        name,
        fullDescription: description
      };
    }
  }

  return null;
}

/**
 * Finalize callout box by calculating confidence and cleaning up
 */
function finalizeCallout(callout: Partial<CalloutBox>): CalloutBox {
  // Calculate confidence based on components found
  let confidence = 0.7; // Base confidence for header match

  if (callout.components && callout.components.length > 0) {
    confidence = 0.9; // High confidence with components

    // Extra confidence if multiple components
    if (callout.components.length >= 3) {
      confidence = 0.95;
    }
  }

  return {
    header: callout.header || '',
    fullText: callout.fullText || '',
    systemName: callout.systemName || '',
    station: callout.station || '',
    components: callout.components || [],
    startIndex: callout.startIndex || 0,
    endIndex: callout.endIndex || 0,
    confidence
  };
}

/**
 * Extract callout metadata for chunk tagging
 *
 * @param text - Chunk text
 * @returns Metadata about callouts in this chunk
 */
export function extractCalloutMetadata(text: string): CalloutMetadata {
  const callouts = detectCalloutBoxes(text);

  if (callouts.length === 0) {
    return {
      isCalloutBox: false,
      containsComponents: false
    };
  }

  // Get the primary callout (usually just one per chunk if chunked properly)
  const primaryCallout = callouts[0];
  const allComponents = callouts.flatMap(c => c.components);

  return {
    isCalloutBox: true,
    containsComponents: allComponents.length > 0,
    componentList: allComponents.map(c => c.name),
    componentCount: allComponents.length,
    systemName: primaryCallout.systemName,
    station: primaryCallout.station
  };
}

/**
 * Check if text contains callout box patterns
 *
 * Fast check without full parsing
 */
export function hasCalloutBoxPattern(text: string): boolean {
  // Quick pattern check
  const quickPatterns = [
    /(?:WATER|STORM|SEWER|FIRE).*STA\s+[\d+.]/i,
    /[-•*]\s*\d+\s*[-–]\s*\d+[-\s]?IN/i,
  ];

  return quickPatterns.some(pattern => pattern.test(text));
}

/**
 * Get callout box boundaries for chunking
 *
 * Returns indices where callout boxes start and end,
 * useful for chunk boundary detection
 */
export function getCalloutBoundaries(text: string): Array<{ start: number; end: number }> {
  const callouts = detectCalloutBoxes(text);

  return callouts.map(c => ({
    start: c.startIndex,
    end: c.endIndex
  }));
}

/**
 * Split text preserving callout boxes as complete units
 *
 * @param text - Source text
 * @param maxChunkSize - Maximum chunk size in characters
 * @returns Array of text chunks with callout boxes preserved
 */
export function splitPreservingCallouts(
  text: string,
  maxChunkSize: number = 1000
): Array<{ text: string; hasCallout: boolean; metadata?: CalloutMetadata }> {
  const callouts = detectCalloutBoxes(text);

  if (callouts.length === 0) {
    // No callouts, return original text as single chunk
    return [{
      text,
      hasCallout: false
    }];
  }

  const chunks: Array<{ text: string; hasCallout: boolean; metadata?: CalloutMetadata }> = [];
  let currentIndex = 0;

  for (const callout of callouts) {
    // Add text before callout if exists
    if (callout.startIndex > currentIndex) {
      const beforeText = text.slice(currentIndex, callout.startIndex).trim();
      if (beforeText.length > 0) {
        chunks.push({
          text: beforeText,
          hasCallout: false
        });
      }
    }

    // Add callout as its own chunk (never split)
    chunks.push({
      text: callout.fullText,
      hasCallout: true,
      metadata: extractCalloutMetadata(callout.fullText)
    });

    currentIndex = callout.endIndex;
  }

  // Add remaining text after last callout
  if (currentIndex < text.length) {
    const afterText = text.slice(currentIndex).trim();
    if (afterText.length > 0) {
      chunks.push({
        text: afterText,
        hasCallout: false
      });
    }
  }

  return chunks;
}
