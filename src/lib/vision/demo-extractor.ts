/**
 * Demo Extractor — Phase 3
 *
 * Extraction infrastructure for demolition plan sheets.
 *
 * Role in the pipeline:
 *   When the vision processing pipeline (auto-process.ts) encounters a sheet
 *   classified as a demo type, it calls:
 *     1. classifyDemoSheet()      — confirm sheet type
 *     2. extractDemoStatusFromText() — apply status keywords to extracted text
 *     3. detectDemoEntityType()   — classify entity type from text labels
 *     4. DEMO_EXTRACTION_PROMPT  — passed to claude-sonnet for structured extraction
 *
 * Output of extraction is written directly to the universal entity model:
 *   project_entities  (discipline='demo')
 *   entity_locations  (room/level/area/sheet)
 *   entity_findings   (demo_scope, note, risk_note, requirement)
 *   entity_citations  (document_id, chunk_id, sheet_number)
 *
 * Design rules:
 *   - Deterministic extraction first (keyword / hatch pattern matching)
 *   - Status is assigned by rules, not by model inference
 *   - Unclear status → 'unknown' (honest over guessing)
 *   - Model is given the extraction prompt but asked to output structured JSON only
 */

// ---------------------------------------------------------------------------
// Sheet classification
// ---------------------------------------------------------------------------

export type DemoSheetType =
  | 'demo_plan'
  | 'demo_rcp'
  | 'demo_detail'
  | 'demo_schedule'
  | 'demo_notes'
  | null

/**
 * Regex patterns to identify each demo sheet type from sheet title or filename.
 * Order matters: more specific patterns listed first.
 */
export const DEMO_SHEET_PATTERNS: Record<NonNullable<DemoSheetType>, RegExp[]> = {
  demo_rcp: [
    /demolition\s+reflected\s+ceiling\s+plan/i,
    /demo(?:lition)?\s+rcp/i,
    /\bdrcp\b/i,
  ],
  demo_detail: [
    /demo(?:lition)?\s+detail/i,
    /detail.*demo(?:lition)?/i,
  ],
  demo_schedule: [
    /demo(?:lition)?\s+schedule/i,
  ],
  demo_notes: [
    /demo(?:lition)?\s+(?:general\s+)?notes?/i,
    /general\s+notes.*demo(?:lition)?/i,
  ],
  demo_plan: [
    /demolition\s+plan/i,
    /demo(?:lition)?\s+floor\s+plan/i,
    /demo\s+plan/i,
  ],
}

/**
 * Sheet number prefix patterns that are strong signals for demo sheets.
 */
export const DEMO_SHEET_NUMBER_PREFIXES = /^(?:D|DM|DD|DRCP|AD)-?\d+/i

/**
 * Classify a sheet as a demo sheet type.
 *
 * @param sheetTitle  Title text extracted from the sheet
 * @param sheetNumber Sheet number / label (e.g. "D-101", "DRCP-1")
 * @returns DemoSheetType if recognized, null otherwise
 */
export function classifyDemoSheet(
  sheetTitle: string,
  sheetNumber: string
): DemoSheetType {
  const titleNorm = sheetTitle.trim()

  // Check title patterns in specificity order
  for (const [sheetType, patterns] of Object.entries(DEMO_SHEET_PATTERNS) as Array<
    [NonNullable<DemoSheetType>, RegExp[]]
  >) {
    if (patterns.some(p => p.test(titleNorm))) {
      return sheetType
    }
  }

  // Fall back to sheet number prefix
  if (DEMO_SHEET_NUMBER_PREFIXES.test(sheetNumber.trim())) {
    // Guess type from prefix
    const upper = sheetNumber.toUpperCase()
    if (/DRCP/.test(upper)) return 'demo_rcp'
    if (/DD/.test(upper))   return 'demo_detail'
    if (/D-/.test(upper) || /DM-/.test(upper)) return 'demo_plan'
  }

  return null
}

// ---------------------------------------------------------------------------
// Status keyword extraction (deterministic, ordered by specificity)
// ---------------------------------------------------------------------------

export type DemoStatus =
  | 'to_remove'
  | 'to_remain'
  | 'to_protect'
  | 'to_relocate'
  | 'existing'
  | 'temporary'
  | 'unknown'

/**
 * Keyword patterns for each demo status.
 * Applied in priority order (higher index = lower priority).
 * First match wins.
 */
export const DEMO_STATUS_KEYWORDS: Array<{
  pattern: RegExp
  status: DemoStatus
  priority: number
}> = [
  // Highest priority — explicit protect in place
  { pattern: /protect\s+in\s+place/i,                   status: 'to_protect',  priority: 1 },
  { pattern: /p\.?i\.?p\.?\b/i,                         status: 'to_protect',  priority: 1 },

  // Relocate / remove and reinstall
  { pattern: /remove\s+and\s+(?:re)?install|r\s*&\s*r\b/i, status: 'to_relocate', priority: 1 },
  { pattern: /\brelocate\b|\brel\.\b/i,                 status: 'to_relocate', priority: 1 },

  // Remove and dispose
  { pattern: /remove\s+and\s+dispos/i,                  status: 'to_remove',   priority: 2 },
  { pattern: /\br\.?d\.?\b/i,                           status: 'to_remove',   priority: 2 },
  { pattern: /\bdemo(?:lish)?\b/i,                      status: 'to_remove',   priority: 2 },
  { pattern: /\bremove\b/i,                             status: 'to_remove',   priority: 2 },

  // Remain / protect (without "in place")
  { pattern: /(?:to\s+)?remain\b/i,                     status: 'to_remain',   priority: 2 },
  { pattern: /do\s+not\s+(?:demo|remove|disturb)/i,     status: 'to_remain',   priority: 2 },
  { pattern: /\bprotect\b/i,                            status: 'to_remain',   priority: 3 },

  // Existing (no action)
  { pattern: /\(e\)\s/i,                               status: 'existing',    priority: 3 },
  { pattern: /\bexist(?:ing)?\b/i,                     status: 'existing',    priority: 3 },

  // Temporary
  { pattern: /\btemp(?:orary)?\.?\b/i,                  status: 'temporary',   priority: 3 },
]

/**
 * Extract demo status from a text string (keynote text, callout label, etc.).
 *
 * @param text  Text to analyze
 * @returns Matched DemoStatus or 'unknown' if no pattern matches
 */
export function extractDemoStatusFromText(text: string): DemoStatus {
  // Apply patterns in priority order (sort by priority ascending, first match wins)
  const sorted = [...DEMO_STATUS_KEYWORDS].sort((a, b) => a.priority - b.priority)
  for (const { pattern, status } of sorted) {
    if (pattern.test(text)) return status
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Entity type detection
// ---------------------------------------------------------------------------

/**
 * Regex patterns for each demo entity type.
 * Applied to extracted text labels or drawing callout text.
 */
export const DEMO_ENTITY_PATTERNS: Record<string, RegExp[]> = {
  wall: [
    /\bwall\b/i,
    /\bpartition\b/i,
    /\bw-\d+\b/i,          // wall tag "W-104N"
    /\bcmu\b/i,
  ],
  ceiling: [
    /\bceiling\b/i,
    /\bact\b/i,             // Acoustical ceiling tile
    /\bdrop\s+ceiling\b/i,
    /\bsoffit\b/i,
  ],
  floor: [
    /\bfloor(?:ing)?\b/i,
    /\bslab\b/i,
    /\btopping\b/i,
    /\bpavers?\b/i,
  ],
  equipment: [
    /\bahu\b/i,             // Air Handling Unit
    /\bfcu\b/i,             // Fan Coil Unit
    /\bvav\b/i,             // Variable Air Volume
    /\bpanel\b/i,
    /\bunit\b/i,
    /\bequip(?:ment)?\b/i,
    /\bcasework\b/i,
    /\bfixture\b/i,
    /\bsink\b/i,
    /\btoilet\b/i,
    /\burinal\b/i,
  ],
  surface: [
    /\bflooring\b/i,
    /\bcarpet\b/i,
    /\bvct\b/i,             // Vinyl Composition Tile
    /\bcpt\b/i,             // Carpet
    /\btile\b/i,
    /\bmastic\b/i,
    /\bfinish\b/i,
    /\bwall\s+(?:tile|finish|cladding)\b/i,
  ],
  opening: [
    /\bopening\b/i,
    /\bdoor\s+opening\b/i,
    /\bwindow\s+opening\b/i,
    /\bpass.?through\b/i,
  ],
  keynote: [
    /\bkeynote\s+\d+\b/i,
    /^\d+\s*\./,            // "7." or "12."
    /\(kn[-\s]*\d+\)/i,
  ],
  note: [
    /\bnote\b/i,
    /\bgeneral\s+note\b/i,
    /\bcaution\b/i,
    /\bwarning\b/i,
  ],
}

/**
 * Detect entity type from a label or text description.
 *
 * @param text  Drawing label or callout text
 * @returns Entity type string or 'unknown'
 */
export function detectDemoEntityType(text: string): string {
  for (const [entityType, patterns] of Object.entries(DEMO_ENTITY_PATTERNS)) {
    if (patterns.some(p => p.test(text))) {
      return entityType
    }
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Entity subtype detection
// ---------------------------------------------------------------------------

/** Subtype patterns for walls. */
const WALL_SUBTYPE_PATTERNS: Array<{ pattern: RegExp; subtype: string }> = [
  { pattern: /load.?bearing|structural/i,   subtype: 'load_bearing' },
  { pattern: /\bcmu\b|masonry/i,             subtype: 'cmu' },
  { pattern: /curtain\s*wall/i,             subtype: 'curtain' },
  { pattern: /exterior/i,                   subtype: 'exterior' },
  { pattern: /gypsum|gypbd|gyp\s*bd/i,      subtype: 'partition' },
  { pattern: /partition/i,                  subtype: 'partition' },
]

/** Subtype patterns for equipment. */
const EQUIP_SUBTYPE_PATTERNS: Array<{ pattern: RegExp; subtype: string }> = [
  { pattern: /\bahu\b/i,                    subtype: 'hvac_unit' },
  { pattern: /\bfcu\b|\bvav\b/i,            subtype: 'hvac_unit' },
  { pattern: /\bpanel\b/i,                  subtype: 'electrical_panel' },
  { pattern: /sink|toilet|urinal|lavatory/i, subtype: 'plumbing_fixture' },
  { pattern: /casework|cabinet/i,           subtype: 'casework' },
]

/**
 * Detect entity subtype from a label or text description.
 *
 * @param entityType  Result of detectDemoEntityType()
 * @param text        Drawing label or callout text
 * @returns Subtype string or null
 */
export function detectDemoEntitySubtype(
  entityType: string,
  text: string
): string | null {
  if (entityType === 'wall') {
    for (const { pattern, subtype } of WALL_SUBTYPE_PATTERNS) {
      if (pattern.test(text)) return subtype
    }
  }
  if (entityType === 'equipment') {
    for (const { pattern, subtype } of EQUIP_SUBTYPE_PATTERNS) {
      if (pattern.test(text)) return subtype
    }
  }
  if (entityType === 'ceiling') {
    if (/\bact\b|acoust/i.test(text)) return 'suspended'
    if (/gypsum|gyp\s*bd/i.test(text)) return 'gypboard'
    if (/exposed/i.test(text))         return 'exposed'
  }
  if (entityType === 'floor') {
    if (/slab/i.test(text))     return 'slab'
    if (/topping/i.test(text))  return 'topping'
    if (/raised/i.test(text))   return 'raised_floor'
  }
  return null
}

// ---------------------------------------------------------------------------
// Canonical name generation
// ---------------------------------------------------------------------------

/**
 * Generate a stable canonical_name for a demo entity.
 *
 * Format: {TYPE}_{ROOM}_{ORIENTATION_OR_TAG}_{LAST8_OF_ID}
 *
 * Examples:
 *   WALL_104_NORTH_a3f2c1d8
 *   EQUIP_AHU4_MECH_b7e9f0a1
 *   KEYNOTE_D101_7
 */
export function buildDemoCanonicalName(params: {
  entityType: string
  label?: string | null
  room?: string | null
  sheetNumber?: string | null
  entityId: string
}): string {
  const { entityType, label, room, sheetNumber, entityId } = params

  // Keynotes: use sheet + keynote number (stable across re-runs)
  if (entityType === 'keynote' && label && sheetNumber) {
    const clean = label.replace(/\D/g, '') // extract digit from "Keynote 7" → "7"
    const sheet = sheetNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase()
    return `KEYNOTE_${sheet}_${clean || entityId.slice(-8)}`
  }

  const parts: string[] = [entityType.toUpperCase()]

  if (room) parts.push(room.toUpperCase().replace(/[^A-Z0-9]/g, ''))

  if (label) {
    const cleanLabel = label
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
    if (cleanLabel) parts.push(cleanLabel)
  }

  parts.push(entityId.replace(/-/g, '').slice(-8))

  return parts.join('_')
}

// ---------------------------------------------------------------------------
// Vision extraction prompt
// ---------------------------------------------------------------------------

/**
 * Prompt template passed to claude-sonnet when extracting demo entities from
 * a plan sheet. The model is asked to output structured JSON only — it does
 * NOT assign support levels or make reasoning judgments.
 *
 * Status is determined deterministically by extractDemoStatusFromText() AFTER
 * the model returns the raw extraction.
 */
export const DEMO_EXTRACTION_PROMPT = `
You are extracting demolition scope data from a construction drawing.
Output ONLY a JSON array. Do not include any prose or explanation.

For each item shown on this sheet, extract one object per item:

{
  "entity_type": "wall" | "ceiling" | "floor" | "equipment" | "surface" | "opening" | "keynote" | "note",
  "label": "<drawing tag if any, e.g. W-104N, Keynote 7, AHU-4>",
  "display_name": "<human-readable description of the item>",
  "status_text": "<verbatim text or symbol note that describes what to do with this item, e.g. REMOVE AND DISPOSE, TO REMAIN, PROTECT IN PLACE, RELOCATE>",
  "room": "<room number or name if determinable, else null>",
  "level": "<floor or level if stated, else null>",
  "subtype_hint": "<specific material or type if stated, e.g. partition, load-bearing, ACT, AHU, else null>",
  "notes": "<any keynote text or callout note verbatim, else null>",
  "confidence": <0.0 to 1.0 based on clarity of marking>
}

Rules:
- Include ONLY items with evidence on this sheet. Do not infer scope.
- For status_text: transcribe the exact text or symbol note (REMOVE, R.D., REMAIN, P.I.P., etc.).
  If no status text is visible, use null — do NOT guess.
- For keynotes: include the keynote number as label and the keynote text as notes.
- Confidence 1.0 = item clearly marked with explicit text.
  Confidence 0.5 = item visible but status marking is ambiguous.
  Confidence 0.3 = item inferred from context (no direct marking found).
- Return an empty array [] if no demo items are identifiable.
`.trim()

/**
 * Additional system context prepended before the extraction prompt.
 * Gives the model domain context without affecting the output contract.
 */
export const DEMO_EXTRACTION_SYSTEM_CONTEXT = `
You are analyzing a demolition plan sheet from a commercial construction project.
Common conventions:
- Cross-hatching (diagonal lines) typically indicates items to be removed.
- Clear/unhatched areas typically indicate items to remain.
- "P.I.P." or "PROTECT IN PLACE" means protect but do not remove.
- "(E)" means existing.
- "R.D." means remove and dispose.
- Keynote numbers (circled or in diamonds) reference a keynote legend on the same or adjacent sheet.
`.trim()
