/**
 * Arch Extractor — Phase 4
 *
 * Extraction infrastructure for architectural floor plan and schedule sheets.
 *
 * Role in the pipeline:
 *   When the vision processing pipeline (auto-process.ts) encounters a sheet
 *   classified as an architectural type, it calls:
 *     1. classifyArchSheet()          — confirm sheet type
 *     2. extractArchTagFromText()     — extract door/window/room tags from text labels
 *     3. detectArchEntityType()       — classify entity type from text labels
 *     4. ARCH_FLOOR_PLAN_EXTRACTION_PROMPT or ARCH_SCHEDULE_EXTRACTION_PROMPT
 *        — passed to claude-sonnet for structured extraction
 *
 * Output of extraction is written to the universal entity model:
 *   project_entities  (discipline='architectural')
 *   entity_locations  (room, level, area, grid_ref, sheet_number)
 *   entity_findings   (schedule_row, dimension, material, note, constraint)
 *   entity_citations  (document_id, chunk_id, sheet_number)
 *   entity_relationships (described_by: door/window/room → schedule_entry)
 *
 * Design rules:
 *   - Sheet classification is deterministic (regex patterns first)
 *   - Tag extraction is deterministic (normalize + match)
 *   - Status is assigned by rules, not model inference
 *   - Unclear status → 'unknown' (honest over guessing)
 *   - Schedule linkage: tag-to-schedule_entry via normalized label match
 *   - Model outputs structured JSON only — it does NOT assign support levels
 */

// ---------------------------------------------------------------------------
// Sheet classification
// ---------------------------------------------------------------------------

export type ArchSheetType =
  | 'arch_floor_plan'
  | 'arch_enlarged_plan'
  | 'arch_finish_plan'
  | 'arch_rcp'
  | 'door_schedule'
  | 'window_schedule'
  | 'room_finish_schedule'
  | 'keynote_legend'
  | 'arch_detail'
  | null

/**
 * Regex patterns to identify each arch sheet type from sheet title or filename.
 * Order matters: more specific patterns listed first (schedules before plans).
 */
export const ARCH_SHEET_PATTERNS: Record<NonNullable<ArchSheetType>, RegExp[]> = {
  door_schedule: [
    /door\s+schedule/i,
    /schedule\s+of\s+doors/i,
  ],
  window_schedule: [
    /window\s+schedule/i,
    /schedule\s+of\s+windows/i,
  ],
  room_finish_schedule: [
    /room\s+finish\s+schedule/i,
    /finish\s+schedule/i,
    /interior\s+finish\s+schedule/i,
  ],
  keynote_legend: [
    /keynote\s+legend/i,
    /keynote\s+list/i,
    /\bkeynotes?\b/i,
    /\blegend\b/i,
  ],
  arch_rcp: [
    /reflected\s+ceiling\s+plan/i,
    /\brcp\b/i,
  ],
  arch_enlarged_plan: [
    /enlarged\s+(?:floor\s+)?plan/i,
    /partial\s+(?:floor\s+)?plan/i,
    /enlarged\s+plan/i,
  ],
  arch_finish_plan: [
    /finish\s+(?:floor\s+)?plan/i,
    /flooring\s+plan/i,
  ],
  arch_detail: [
    /architectural\s+detail/i,
    /(?:wall|floor|ceiling)\s+(?:section|detail)/i,
  ],
  arch_floor_plan: [
    /architectural\s+floor\s+plan/i,
    /floor\s+plan/i,
    /\bfirst\s+floor\b/i,
    /\bsecond\s+floor\b/i,
    /\b(?:level|floor)\s+\w+\s+plan\b/i,
  ],
}

/**
 * Sheet number prefix patterns that are strong signals for arch sheets.
 * A- is standard; AD- is sometimes used for architectural demolition/design.
 */
export const ARCH_SHEET_NUMBER_PREFIXES = /^A-?\d+/i

/**
 * Classify a sheet as an architectural sheet type.
 *
 * @param sheetTitle   Title text extracted from the sheet
 * @param sheetNumber  Sheet number / label (e.g. "A-201", "A-801")
 * @returns ArchSheetType if recognized, null otherwise
 */
export function classifyArchSheet(
  sheetTitle: string,
  sheetNumber: string
): ArchSheetType {
  const titleNorm = sheetTitle.trim()

  // Check title patterns in specificity order (schedules > plans)
  for (const [sheetType, patterns] of Object.entries(ARCH_SHEET_PATTERNS) as Array<
    [NonNullable<ArchSheetType>, RegExp[]]
  >) {
    if (patterns.some(p => p.test(titleNorm))) {
      return sheetType
    }
  }

  // Fall back to sheet number prefix heuristics
  if (ARCH_SHEET_NUMBER_PREFIXES.test(sheetNumber.trim())) {
    const upper = sheetNumber.toUpperCase().replace(/[^A-Z0-9]/g, '')
    // A-8xx and A-9xx are typically schedules/details; A-2xx–A-5xx are plans
    const numMatch = upper.match(/^A(\d+)/)
    if (numMatch) {
      const n = parseInt(numMatch[1], 10)
      if (n >= 800) return 'door_schedule'   // best guess for A-8xx+
      if (n >= 500) return 'arch_rcp'         // A-5xx
      if (n >= 400) return 'arch_detail'      // A-4xx
      if (n >= 300) return 'arch_finish_plan' // A-3xx
    }
    return 'arch_floor_plan'
  }

  return null
}

// ---------------------------------------------------------------------------
// Entity type detection
// ---------------------------------------------------------------------------

/**
 * Regex patterns for each architectural entity type.
 * Applied to extracted text labels or drawing callout text.
 */
export const ARCH_ENTITY_PATTERNS: Record<string, RegExp[]> = {
  door: [
    /\bdoor\b/i,
    /\bD-\d+[A-Z]?\b/,      // tag "D-14"
    /\b\d+[A-Z]?\s*door\b/i,
  ],
  window: [
    /\bwindow\b/i,
    /\bW-\d+[A-Z]?\b/,      // tag "W-3A"
    /\bglaz(?:ing|ed)\b/i,
  ],
  wall: [
    /\bwall\s+type\b/i,
    /\bWT-?\w+\b/,           // wall type tag "WT-A"
    /\bwall\s+assembly\b/i,
    /\bpartition\s+type\b/i,
  ],
  room: [
    /\broom\b/i,
    /\bspace\b/i,
    /\boffice\b/i,
    /\bcorridor\b/i,
    /\blobby\b/i,
    /\brestroom\b/i,
  ],
  finish_tag: [
    /\bFT-?\d+\b/,           // finish tag "FT-3"
    /\bfinish\s+(?:type|code)\b/i,
    /\bCPT-\d+\b/i,          // carpet code
    /\bCT-\d+\b/i,           // ceramic tile code
    /\bVCT-\d+\b/i,          // vinyl composition tile
    /\bACT-\d+\b/i,          // acoustical ceiling tile
    /\bPT-\d+\b/i,           // paint type
    /\bGYP-\d+\b/i,          // gypsum board type
  ],
  schedule_entry: [
    /schedule\s+(?:row|entry|item)/i,
  ],
  keynote: [
    /\bkeynote\s+\d+\b/i,
    /^\d+\s*\./,
    /\(kn[-\s]*\d+\)/i,
  ],
  detail_ref: [
    /\bdetail\s+[\w/]+/i,
    /\bsim(?:ilar)?\b/i,
    /\btypical\b/i,
    /\/[A-Z]-?\d+/,          // "3/A-401" style detail reference
  ],
  note: [
    /\bnote\b/i,
    /\bgeneral\s+note\b/i,
    /\btypical\b/i,
    /\bcaution\b/i,
  ],
}

/**
 * Detect entity type from a label or text description.
 *
 * @param text  Drawing label or callout text
 * @returns Entity type string or 'unknown'
 */
export function detectArchEntityType(text: string): string {
  for (const [entityType, patterns] of Object.entries(ARCH_ENTITY_PATTERNS)) {
    if (patterns.some(p => p.test(text))) {
      return entityType
    }
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Subtype detection
// ---------------------------------------------------------------------------

const DOOR_SUBTYPE_PATTERNS: Array<{ pattern: RegExp; subtype: string }> = [
  { pattern: /hollow\s+metal|hm\b/i,        subtype: 'hollow_metal' },
  { pattern: /solid\s+core|sc\b/i,           subtype: 'solid_core' },
  { pattern: /hollow\s+core|hc\b/i,          subtype: 'hollow_core' },
  { pattern: /sliding/i,                     subtype: 'sliding' },
  { pattern: /double/i,                      subtype: 'double' },
  { pattern: /overhead|roll.?up/i,           subtype: 'overhead' },
  { pattern: /glass|glazed|storefront/i,     subtype: 'glass' },
]

const WINDOW_SUBTYPE_PATTERNS: Array<{ pattern: RegExp; subtype: string }> = [
  { pattern: /fixed/i,                       subtype: 'fixed' },
  { pattern: /casement/i,                    subtype: 'casement' },
  { pattern: /sliding/i,                     subtype: 'sliding' },
  { pattern: /curtain\s*wall/i,              subtype: 'curtain_wall' },
  { pattern: /skylight|clerestory/i,         subtype: 'skylight' },
  { pattern: /awning/i,                      subtype: 'awning' },
]

const ROOM_SUBTYPE_PATTERNS: Array<{ pattern: RegExp; subtype: string }> = [
  { pattern: /restroom|toilet|wc\b|lavatory/i,  subtype: 'restroom' },
  { pattern: /corridor|hallway|hall\b/i,        subtype: 'corridor' },
  { pattern: /conference|meeting/i,             subtype: 'conference' },
  { pattern: /mech(?:anical)?\s+room|mech\b/i,  subtype: 'mech_room' },
  { pattern: /elec(?:trical)?\s+room/i,         subtype: 'electrical_room' },
  { pattern: /open\s+office/i,                  subtype: 'open_office' },
  { pattern: /lobby|reception/i,                subtype: 'lobby' },
  { pattern: /stair/i,                          subtype: 'stair' },
  { pattern: /elevator|lift\b/i,                subtype: 'elevator' },
]

/**
 * Detect entity subtype from a label or text description.
 */
export function detectArchEntitySubtype(
  entityType: string,
  text: string
): string | null {
  if (entityType === 'door') {
    for (const { pattern, subtype } of DOOR_SUBTYPE_PATTERNS) {
      if (pattern.test(text)) return subtype
    }
  }
  if (entityType === 'window') {
    for (const { pattern, subtype } of WINDOW_SUBTYPE_PATTERNS) {
      if (pattern.test(text)) return subtype
    }
  }
  if (entityType === 'room') {
    for (const { pattern, subtype } of ROOM_SUBTYPE_PATTERNS) {
      if (pattern.test(text)) return subtype
    }
  }
  if (entityType === 'wall') {
    if (/rated|fire.?wall|fire.?rated/i.test(text)) return 'rated'
    if (/cmu|masonry/i.test(text))                  return 'cmu'
    if (/curtain/i.test(text))                      return 'curtain'
    if (/exterior/i.test(text))                     return 'exterior'
    if (/glass/i.test(text))                        return 'glass'
  }
  return null
}

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

/**
 * Extract a drawing tag and its type from a text label.
 *
 * Handles formats: "D-14", "W-3A", "WT-A", "Room 105", "Keynote 7"
 */
export function extractArchTagFromText(text: string): {
  tag: string | null
  tagType: 'door' | 'window' | 'wall_type' | 'finish_code' | null
} {
  // Door tag: D-14, D14, D 14
  const doorMatch = text.match(/\b(D-?\d+[A-Z]?)\b/i)
  if (doorMatch) return { tag: doorMatch[1].toUpperCase(), tagType: 'door' }

  // Window tag: W-3A, W3A, W 3
  const winMatch = text.match(/\b(W-?\d+[A-Z]?)\b/i)
  if (winMatch) return { tag: winMatch[1].toUpperCase(), tagType: 'window' }

  // Wall type: WT-A, WT3, Wall Type A
  const wallMatch = text.match(/\b(WT-?[A-Z\d]+)\b/i) ??
    text.match(/wall\s+type\s+([A-Z\d]+)/i)
  if (wallMatch) return { tag: wallMatch[1].toUpperCase(), tagType: 'wall_type' }

  // Finish code: FT-3, CPT-2, CT-4, ACT-1, PT-1
  const finishMatch = text.match(/\b((?:FT|CPT|CT|VCT|ACT|PT|GYP)-?\d+[A-Z]?)\b/i)
  if (finishMatch) return { tag: finishMatch[1].toUpperCase(), tagType: 'finish_code' }

  return { tag: null, tagType: null }
}

// ---------------------------------------------------------------------------
// Canonical name generation
// ---------------------------------------------------------------------------

/**
 * Generate a stable canonical_name for an architectural entity.
 *
 * Format: {TYPE}_{TAG_OR_ROOM}[_{LAST8_OF_ID}]
 *
 * Examples:
 *   DOOR_D14
 *   WINDOW_W3A
 *   ROOM_105
 *   WALL_TYPE_A
 *   SCHED_DOOR_D14
 *   KEYNOTE_A201_7
 */
export function buildArchCanonicalName(params: {
  entityType: string
  label?: string | null
  room?: string | null
  sheetNumber?: string | null
  entityId: string
}): string {
  const { entityType, label, room, sheetNumber, entityId } = params

  // Normalize label: strip non-alphanumeric, uppercase
  const normalizeTag = (s: string) =>
    s.toUpperCase().replace(/[^A-Z0-9]/g, '')

  switch (entityType) {
    case 'door':
      return label ? `DOOR_${normalizeTag(label)}` : `DOOR_${entityId.replace(/-/g, '').slice(-8)}`

    case 'window':
      return label ? `WINDOW_${normalizeTag(label)}` : `WINDOW_${entityId.replace(/-/g, '').slice(-8)}`

    case 'room':
      return room
        ? `ROOM_${normalizeTag(room)}`
        : label
          ? `ROOM_${normalizeTag(label)}`
          : `ROOM_${entityId.replace(/-/g, '').slice(-8)}`

    case 'wall':
      return label ? `WALL_TYPE_${normalizeTag(label)}` : `WALL_TYPE_${entityId.replace(/-/g, '').slice(-8)}`

    case 'finish_tag':
      return label ? `FINISH_${normalizeTag(label)}` : `FINISH_${entityId.replace(/-/g, '').slice(-8)}`

    case 'schedule_entry': {
      // Subtype is passed via label convention: "DOOR:D-14" or just the tag
      const tag = label ? normalizeTag(label) : entityId.replace(/-/g, '').slice(-8)
      return `SCHED_${tag}`
    }

    case 'keynote': {
      // KEYNOTE_{SHEET}_{NUMBER} — stable across re-runs
      const num = label?.replace(/\D/g, '') ?? entityId.replace(/-/g, '').slice(-8)
      const sheet = sheetNumber ? normalizeTag(sheetNumber) : 'SHEET'
      return `KEYNOTE_${sheet}_${num}`
    }

    case 'detail_ref':
      return label
        ? `DETAIL_${normalizeTag(label)}`
        : `DETAIL_${entityId.replace(/-/g, '').slice(-8)}`

    case 'note':
    default: {
      const sheet = sheetNumber ? normalizeTag(sheetNumber) : 'SHEET'
      return `NOTE_${sheet}_${entityId.replace(/-/g, '').slice(-8)}`
    }
  }
}

// ---------------------------------------------------------------------------
// Vision extraction system context
// ---------------------------------------------------------------------------

/**
 * Domain context prepended before the extraction prompts.
 * Gives the model architectural convention knowledge.
 */
export const ARCH_EXTRACTION_SYSTEM_CONTEXT = `
You are analyzing architectural construction drawings from a commercial building project.
Common conventions:
- Door tags (e.g. "D-14", "114A") appear as circled or boxed numbers near door openings.
  The same tag appears in the door schedule, which lists type, size, frame, and hardware.
- Window tags (e.g. "W-3A") appear in diamond symbols. See window schedule for spec.
- Wall type designations (e.g. "WT-A", "Type 3") appear as callouts with arrows pointing to walls.
- Room numbers appear in bold, often centered in the room. Room names are usually above or below.
- Finish codes (e.g. "CPT-2", "CT-4", "ACT-1") reference the room finish schedule.
- Grid lines appear as letters (A, B, C...) across the top and numbers (1, 2, 3...) down the side.
  A grid intersection is written as "B-5".
- "New" elements are typically shown with solid heavy lines; "existing" with lighter or dashed lines.
- NTS = not to scale (annotation only, not a lifecycle status).
`.trim()

// ---------------------------------------------------------------------------
// Floor plan extraction prompt
// ---------------------------------------------------------------------------

/**
 * Extraction prompt for architectural floor plan sheets.
 * Extracts rooms, doors, windows, wall types, finish tags, keynotes, notes.
 * Does NOT parse schedule tables — those use ARCH_SCHEDULE_EXTRACTION_PROMPT.
 */
export const ARCH_FLOOR_PLAN_EXTRACTION_PROMPT = `
You are extracting architectural entities from a floor plan drawing.
Output ONLY a JSON array. Do not include any prose or explanation.

For each entity clearly visible on this sheet, output one object:

{
  "entity_type": "room" | "door" | "window" | "wall" | "finish_tag" | "keynote" | "note" | "detail_ref",
  "label": "<drawing tag if any — e.g. D-14, W-3A, WT-A, Room 105, FT-3, Keynote 7>",
  "display_name": "<human-readable description — e.g. 'Door D-14', 'Room 105 — Conference Room'>",
  "room": "<room number this entity belongs to, if determinable, else null>",
  "level": "<floor or level if stated — e.g. 'Level 1', 'L2', else null>",
  "grid_ref": "<grid intersection if readable — e.g. 'B-5', else null>",
  "subtype_hint": "<specific type if readable — e.g. 'Hollow Metal', 'Conference Room', 'Rated Wall', else null>",
  "status": "existing" | "new" | "unknown",
  "notes": "<any keynote callout text verbatim, else null>",
  "confidence": <0.0 to 1.0 based on clarity>
}

Rules:
- Include ONLY entities with clear evidence on this sheet. Do not infer.
- Rooms: label = room number (e.g. "105"), display_name = include room name if visible.
- Doors: label = door tag (e.g. "D-14"). Always include the tag — it links to the door schedule.
- Windows: label = window tag (e.g. "W-3A"). Always include the tag.
- Wall types: label = wall type designation (e.g. "WT-A", "Type 3").
- Finish tags: label = finish code (e.g. "CPT-2", "ACT-1").
- Keynotes: label = keynote number, notes = keynote text if visible on this sheet.
- Do NOT parse schedule tables here — those are handled separately.
- status 'new' = shown as new construction. 'existing' = existing to remain. 'unknown' = unclear.
- Confidence 1.0 = tag clearly visible. 0.5 = tag present but partially legible. 0.3 = inferred.
- Return [] if no architectural entities are clearly identifiable.
`.trim()

// ---------------------------------------------------------------------------
// Schedule extraction prompt
// ---------------------------------------------------------------------------

/**
 * Extraction prompt for schedule sheets (door, window, room finish).
 * Outputs one structured row per schedule entry.
 */
export const ARCH_SCHEDULE_EXTRACTION_PROMPT = `
You are parsing an architectural schedule from a construction drawing.
Output ONLY a JSON array — one object per schedule row. Do not include prose.

Determine the schedule type from the sheet title or column headers.

For DOOR SCHEDULE rows, output:
{
  "schedule_type": "door",
  "tag": "<door mark — e.g. D-14>",
  "display_name": "Door <tag>",
  "size": "<width × height — e.g. 3'-0\" × 7'-0\", or null>",
  "door_type": "<type code or description — e.g. Type 3, Hollow Metal, or null>",
  "frame_type": "<frame type — e.g. HM-2, or null>",
  "hardware_group": "<hardware set — e.g. HW-4, or null>",
  "glazing": "<glazing description if applicable, else null>",
  "fire_rating": "<fire rating if stated — e.g. 20 MIN, 90 MIN, or null>",
  "remarks": "<any remarks verbatim, else null>",
  "confidence": <0.0 to 1.0>
}

For WINDOW SCHEDULE rows, output:
{
  "schedule_type": "window",
  "tag": "<window mark — e.g. W-3A>",
  "display_name": "Window <tag>",
  "size": "<width × height or null>",
  "window_type": "<type code or null>",
  "glazing": "<glazing specification or null>",
  "frame_material": "<frame material — e.g. Aluminum, Wood, or null>",
  "remarks": "<any remarks verbatim or null>",
  "confidence": <0.0 to 1.0>
}

For ROOM FINISH SCHEDULE rows, output:
{
  "schedule_type": "room_finish",
  "tag": "<room number — e.g. 105>",
  "display_name": "Room <tag>",
  "room_name": "<room name if visible — e.g. Conference Room, or null>",
  "floor_finish": "<floor finish code/description or null>",
  "base_finish": "<base/skirting finish or null>",
  "wall_finish": "<wall finish or null>",
  "ceiling_finish": "<ceiling finish or null>",
  "ceiling_height": "<ceiling height — e.g. 9'-0\", or null>",
  "remarks": "<any remarks or null>",
  "confidence": <0.0 to 1.0>
}

Rules:
- One object per row. Do NOT merge rows.
- Use null for fields that are blank or illegible.
- Preserve verbatim text for remarks and notes — do not paraphrase.
- Confidence 1.0 = all primary fields clearly readable.
  Confidence 0.5 = some fields unclear or partially legible.
  Confidence 0.3 = row exists but most fields are illegible.
- Return [] if no schedule data is identifiable on this sheet.
`.trim()

// ---------------------------------------------------------------------------
// Keynote legend extraction prompt
// ---------------------------------------------------------------------------

/**
 * Extraction prompt for keynote legend / legend sheets.
 * Outputs one keynote entity per numbered entry.
 */
export const ARCH_KEYNOTE_EXTRACTION_PROMPT = `
You are extracting keynote entries from an architectural keynote legend.
Output ONLY a JSON array. Do not include prose.

For each keynote entry:
{
  "number": "<keynote number — e.g. 7>",
  "text": "<full keynote text verbatim>",
  "entity_hint": "<the type of thing this keynote references — e.g. wall, door, finish, general, or null>",
  "confidence": <0.0 to 1.0>
}

Rules:
- Include every numbered entry, even if text is brief.
- Preserve the exact verbatim text — do not summarize.
- entity_hint is a best-guess at what building element is referenced (optional context, not authoritative).
- Return [] if no keynote entries are identifiable.
`.trim()
