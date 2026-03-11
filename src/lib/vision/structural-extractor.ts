/**
 * Structural Extractor — Phase 5A
 *
 * Extraction infrastructure for structural plan and detail sheets.
 *
 * Role in the pipeline:
 *   When the vision processing pipeline encounters a sheet classified as a
 *   structural type, it calls:
 *     1. classifyStructuralSheet()         — confirm sheet type
 *     2. extractStructuralMarkFromText()   — extract marks (F-1, C-4, W12×26) from labels
 *     3. detectStructuralEntityType()      — classify entity type from text
 *     4. STRUCTURAL_FOUNDATION_EXTRACTION_PROMPT or STRUCTURAL_FRAMING_EXTRACTION_PROMPT
 *        — passed to claude-sonnet for structured extraction
 *
 * Output is written to the universal entity model:
 *   project_entities  (discipline='structural')
 *   entity_locations  (level, grid_ref, area, sheet_number)
 *   entity_findings   (load_bearing, dimension, material, capacity, note)
 *   entity_citations  (document_id, sheet_number)
 *
 * Design rules:
 *   - Sheet classification is deterministic (regex patterns)
 *   - Mark extraction is deterministic (normalize uppercase + strip non-alphanumeric)
 *   - Status assigned by rules: 'existing' or 'new' from plan notes, else 'unknown'
 *   - Model outputs structured JSON only — no support levels assigned by model
 */

// ---------------------------------------------------------------------------
// Sheet classification
// ---------------------------------------------------------------------------

export type StructuralSheetType =
  | 'structural_foundation_plan'
  | 'structural_framing_plan'
  | 'structural_roof_plan'
  | 'structural_section'
  | 'structural_detail'
  | 'structural_schedule'
  | 'structural_notes'
  | null

/**
 * Regex patterns to identify structural sheet type from sheet title or filename.
 * Order matters: more specific first.
 */
export const STRUCTURAL_SHEET_PATTERNS: Record<NonNullable<StructuralSheetType>, RegExp[]> = {
  structural_foundation_plan: [
    /foundation\s+plan/i,
    /found(?:ation)?\s+layout/i,
    /footing\s+plan/i,
    /\bS[-_]?[12]\b/i,                    // S-1, S-2 are typically foundation plans
  ],
  structural_framing_plan: [
    /framing\s+plan/i,
    /floor\s+framing/i,
    /roof\s+framing/i,
    /structural\s+floor\s+plan/i,
    /\bS[-_]?[3-9]\b/i,
  ],
  structural_roof_plan: [
    /roof\s+framing/i,
    /roof\s+structure/i,
    /structural\s+roof/i,
  ],
  structural_section: [
    /structural\s+section/i,
    /building\s+section.*struct/i,
    /cross.?section.*struct/i,
  ],
  structural_detail: [
    /structural\s+detail/i,
    /connection\s+detail/i,
    /footing\s+detail/i,
    /column\s+detail/i,
    /beam\s+detail/i,
    /\bS[-_]?\d{3}\b/i,                   // S-101, S-201 are typically detail sheets
  ],
  structural_schedule: [
    /column\s+schedule/i,
    /footing\s+schedule/i,
    /beam\s+schedule/i,
    /structural\s+schedule/i,
  ],
  structural_notes: [
    /structural\s+(?:general\s+)?notes/i,
    /structural\s+specifications/i,
  ],
}

/**
 * Classify a structural sheet by matching the title or filename against patterns.
 * Returns null when the sheet is not a structural type.
 */
export function classifyStructuralSheet(titleOrFilename: string): StructuralSheetType {
  for (const [type, patterns] of Object.entries(STRUCTURAL_SHEET_PATTERNS) as Array<
    [NonNullable<StructuralSheetType>, RegExp[]]
  >) {
    if (patterns.some(p => p.test(titleOrFilename))) return type
  }
  return null
}

// ---------------------------------------------------------------------------
// Entity type detection
// ---------------------------------------------------------------------------

export type StructuralEntityType =
  | 'footing'
  | 'column'
  | 'beam'
  | 'foundation_wall'
  | 'slab_edge'
  | 'structural_opening'
  | 'grid_line'
  | 'structural_note'

/** Patterns to detect structural entity type from label text. */
export const STRUCTURAL_ENTITY_PATTERNS: Record<StructuralEntityType, RegExp[]> = {
  footing: [
    /\bF[-_]?\d/i,
    /\bCF[-_]?\d/i,                       // continuous footing
    /footing\b/i,
    /\bPAD\s+FTG\b/i,
  ],
  column: [
    /\b[A-Z]{1,2}[-_]?\d+\s*(?:COL|COLUMN)?\b/,
    /\bHSS\s*\d/i,                         // HSS sections
    /\bW\d+[×x]\d+\s*COL/i,
    /\bTS\s*\d/i,                          // tube steel
    /column\b/i,
    /\bCOL\b/,
  ],
  beam: [
    /\bW\d+[×x]\d+\b/i,                    // W-sections e.g. W12×26
    /\bLVL\b/,                             // laminated veneer lumber
    /\bGLB\b/,                             // glulam beam
    /\bPSL\b/,                             // parallel strand lumber
    /beam\b/i,
    /\bBM\b/,
    /\bGIRDER\b/i,
  ],
  foundation_wall: [
    /foundation\s+wall/i,
    /\bFW[-_]?\d/i,
    /\bFDN\s+WALL/i,
  ],
  slab_edge: [
    /slab\s+edge/i,
    /\bSOG\b/,                             // slab-on-grade
    /\bSOD\b/,                             // slab-on-deck
    /\bT\.O\.S\b/i,                        // top of slab
  ],
  structural_opening: [
    /structural\s+opening/i,
    /\bSO[-_]?\d/i,
    /header\b/i,
  ],
  grid_line: [
    /grid\s+line/i,
    /\bGRID\s+[A-Z\d]/i,
    /^[A-Z]\d?\.?\d?$/,                   // Single letter or simple alphanumeric: A, B, C, 1, 2
  ],
  structural_note: [
    /\bTYPICAL\b/i,
    /\bNOTE:\b/i,
    /\bGENERAL\s+NOTE\b/i,
  ],
}

/**
 * Detect the structural entity type from a text label.
 * Returns 'structural_note' as default when no specific type matches.
 */
export function detectStructuralEntityType(text: string): StructuralEntityType {
  for (const [type, patterns] of Object.entries(STRUCTURAL_ENTITY_PATTERNS) as Array<
    [StructuralEntityType, RegExp[]]
  >) {
    if (type === 'structural_note') continue       // Skip default — checked last
    if (patterns.some(p => p.test(text))) return type
  }
  return 'structural_note'
}

/** Detect structural subtype from label (e.g. 'continuous', 'spread', 'W12x26'). */
export function detectStructuralSubtype(entityType: StructuralEntityType, text: string): string | null {
  if (entityType === 'footing') {
    if (/CF[-_]?\d|continuous/i.test(text)) return 'continuous'
    if (/\bSF\b|\bspread\b/i.test(text)) return 'spread'
    if (/\bPILE\b/i.test(text)) return 'pile_cap'
    return null
  }

  if (entityType === 'beam') {
    const wSection = text.match(/W\d+[×x]\d+/i)
    if (wSection) return wSection[0].toUpperCase()

    if (/LVL/i.test(text)) return 'LVL'
    if (/GLB/i.test(text)) return 'glulam'
    if (/PSL/i.test(text)) return 'PSL'
    return null
  }

  if (entityType === 'column') {
    const hss = text.match(/HSS\s*[\d.]+[×x][\d.]+[×x][\d.]+/i)
    if (hss) return hss[0].replace(/\s+/g, '')

    const wide = text.match(/W\d+[×x]\d+/i)
    if (wide) return wide[0].toUpperCase()

    if (/ROUND|PIPE/i.test(text)) return 'round'
    return null
  }

  return null
}

// ---------------------------------------------------------------------------
// Mark extraction
// ---------------------------------------------------------------------------

/**
 * Extract the structural mark from a label string.
 * Normalizes to uppercase with hyphens preserved.
 *
 * Examples: "F-1", "f1" → "F-1", "W12×26" → "W12x26", "C-4A" → "C-4A"
 */
export function extractStructuralMarkFromText(text: string): string | null {
  // Footing marks: F-1, CF-2, SF-3
  const footingMatch = text.match(/\b(C?F|SF|PC?F)[-_]?\s*(\d+[A-Z]?)\b/i)
  if (footingMatch) {
    return `${footingMatch[1].toUpperCase()}-${footingMatch[2].toUpperCase()}`
  }

  // W-section marks: W12×26, W12x26
  const wSection = text.match(/\bW(\d+)[×x](\d+)\b/i)
  if (wSection) return `W${wSection[1]}x${wSection[2]}`

  // HSS sections: HSS6×6×1/4
  const hssMatch = text.match(/\bHSS\s*([\d.]+[×x][\d.]+[×x][\d.]+)\b/i)
  if (hssMatch) return `HSS${hssMatch[1].replace(/\s/g, '')}`

  // Column marks: C-4, C4A
  const colMatch = text.match(/\b([A-Z]{1,2})[-_]?(\d+[A-Z]?)\b/)
  if (colMatch) return `${colMatch[1]}-${colMatch[2]}`

  return null
}

// ---------------------------------------------------------------------------
// Canonical name builder
// ---------------------------------------------------------------------------

/**
 * Build the canonical_name for a structural entity.
 * Pattern: DISCIPLINE_ENTITYTYPE_MARK or DISCIPLINE_ENTITYTYPE_LABEL
 *
 * Examples:
 *   'structural' + 'footing' + 'F-1'   → 'STRUCTURAL_FOOTING_F1'
 *   'structural' + 'beam'   + 'W12x26' → 'STRUCTURAL_BEAM_W12X26'
 */
export function buildStructuralCanonicalName(
  entityType: StructuralEntityType,
  mark: string | null,
  label: string | null
): string {
  const identifier = mark ?? label ?? 'UNKNOWN'
  const normalized = identifier.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `STRUCTURAL_${entityType.toUpperCase()}_${normalized}`
}

// ---------------------------------------------------------------------------
// Extraction prompts
// ---------------------------------------------------------------------------

export const STRUCTURAL_EXTRACTION_SYSTEM_CONTEXT = `You are a structural engineering drawing extraction assistant.
Your task is to extract structural entities (footings, columns, beams, grid lines, walls) from plan drawings.

Rules:
- Extract only entities that are clearly labeled or annotated on the drawing.
- For each entity, extract: entity_type, mark/label, grid reference, level, status (new/existing).
- W-section notation: preserve format as W12x26 (lowercase 'x', no spaces).
- Marks are typically formatted as: F-1 (footing), C-4 (column), or section designation.
- Grid references: format as "A-3" or "B/3" for intersection of grid A and line 3.
- Status: "new" for items being installed, "existing" for items to remain, "unknown" if not clear.
- Output ONLY valid JSON. No explanations.`

export const STRUCTURAL_FOUNDATION_EXTRACTION_PROMPT = `Extract all structural foundation elements from this drawing sheet.

For each element found, output a JSON array entry:
{
  "entity_type": "footing" | "column" | "foundation_wall" | "slab_edge" | "grid_line",
  "subtype": "<W-section, spread, continuous, etc.>" | null,
  "label": "<mark as shown on drawing>",
  "canonical_name": "STRUCTURAL_<TYPE>_<MARK_NORMALIZED>",
  "display_name": "<human-readable description>",
  "status": "new" | "existing" | "unknown",
  "level": "<e.g. L1, B1, GRADE>",
  "grid_ref": "<e.g. A-3, B/2-3>",
  "findings": [
    {
      "finding_type": "dimension" | "material" | "load_bearing" | "capacity" | "note",
      "statement": "<e.g. 3'-0\" × 3'-0\" × 12\" deep, 3000 psi concrete>",
      "text_value": "<string value if applicable>",
      "numeric_value": <number or null>,
      "unit": "<inches, psi, kips, etc.>" | null
    }
  ]
}

Output the complete JSON array. If no structural elements are found, output [].`

export const STRUCTURAL_FRAMING_EXTRACTION_PROMPT = `Extract all structural framing elements from this drawing sheet.

For each element found, output a JSON array entry:
{
  "entity_type": "beam" | "column" | "structural_opening" | "slab_edge" | "grid_line",
  "subtype": "<W-section designation, LVL, glulam, etc.>" | null,
  "label": "<mark or designation as shown>",
  "canonical_name": "STRUCTURAL_<TYPE>_<MARK_NORMALIZED>",
  "display_name": "<human-readable description>",
  "status": "new" | "existing" | "unknown",
  "level": "<floor level, e.g. L1, L2, ROOF>",
  "grid_ref": "<grid reference, e.g. A-3, B/2>",
  "findings": [
    {
      "finding_type": "dimension" | "material" | "load_bearing" | "capacity" | "note",
      "statement": "<e.g. W12×26 A992 steel, 14'-6\" span>",
      "text_value": "<string value>",
      "numeric_value": <number or null>,
      "unit": "<feet, inches, kips, etc.>" | null
    }
  ]
}

Output the complete JSON array. If no framing elements are found, output [].`
