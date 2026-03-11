/**
 * MEP Extractor — Phase 5A
 *
 * Extraction infrastructure for mechanical, electrical, and plumbing plan sheets.
 *
 * Role in the pipeline:
 *   When the vision processing pipeline encounters a sheet classified as an MEP type,
 *   it calls:
 *     1. classifyMEPSheet()              — confirm sheet type + trade
 *     2. extractMEPTagFromText()         — extract panel tags, equipment tags, fixture ids
 *     3. detectMEPEntityType()           — classify entity type from text labels
 *     4. MECHANICAL_EXTRACTION_PROMPT, ELECTRICAL_EXTRACTION_PROMPT, or
 *        PLUMBING_EXTRACTION_PROMPT — passed to claude-sonnet for structured extraction
 *
 * Output is written to the universal entity model:
 *   project_entities  (discipline='mep')
 *   entity_locations  (room_number, level, area, sheet_number)
 *   entity_findings   (equipment_tag, circuit_ref, dimension, capacity, note, coordination_note)
 *   entity_citations  (document_id, sheet_number)
 *
 * Design rules:
 *   - Sheet classification is deterministic (regex patterns)
 *   - Tag extraction is deterministic (normalize + match)
 *   - Trade (electrical/mechanical/plumbing) is derived from entity_type at query time
 *   - Status: 'new', 'existing', 'relocated', 'removed', 'unknown'
 *   - Model outputs structured JSON only — no support levels assigned by model
 */

// ---------------------------------------------------------------------------
// Sheet classification
// ---------------------------------------------------------------------------

export type MEPSheetType =
  | 'mechanical_plan'
  | 'mechanical_schedule'
  | 'electrical_plan'
  | 'electrical_schedule'
  | 'lighting_plan'
  | 'plumbing_plan'
  | 'plumbing_schedule'
  | 'fire_protection_plan'
  | null

/**
 * Regex patterns to identify MEP sheet type from sheet title or filename.
 * Order matters: schedules and specific types listed before general plans.
 */
export const MEP_SHEET_PATTERNS: Record<NonNullable<MEPSheetType>, RegExp[]> = {
  mechanical_schedule: [
    /mechanical\s+(?:equipment\s+)?schedule/i,
    /HVAC\s+schedule/i,
    /air\s+(?:handling|handler)\s+schedule/i,
    /diffuser\s+schedule/i,
  ],
  electrical_schedule: [
    /electrical\s+schedule/i,
    /panel\s+schedule/i,
    /load\s+(?:center|schedule)/i,
    /distribution\s+board/i,
  ],
  plumbing_schedule: [
    /plumbing\s+(?:fixture\s+)?schedule/i,
    /fixture\s+schedule/i,
    /plumbing\s+schedule/i,
  ],
  mechanical_plan: [
    /mechanical\s+plan/i,
    /HVAC\s+plan/i,
    /air\s+conditioning\s+plan/i,
    /duct(?:work)?\s+plan/i,
    /\bM[-_]?\d/i,                           // M-1, M-101 etc.
  ],
  electrical_plan: [
    /electrical\s+plan/i,
    /power\s+plan/i,
    /branch\s+circuit\s+plan/i,
    /\bE[-_]?\d/i,                           // E-1, E-101 etc.
  ],
  lighting_plan: [
    /lighting\s+plan/i,
    /fixture\s+plan/i,
    /\bE[-_]?L\d/i,                          // E-L1 lighting plans
  ],
  plumbing_plan: [
    /plumbing\s+plan/i,
    /sanitary\s+plan/i,
    /domestic\s+water\s+plan/i,
    /\bP[-_]?\d/i,                           // P-1, P-101 etc.
  ],
  fire_protection_plan: [
    /fire\s+protection\s+plan/i,
    /sprinkler\s+plan/i,
    /FP[-_]?\d/i,
    /\bFP\b/,
  ],
}

/**
 * Classify an MEP sheet by matching title or filename against patterns.
 * Returns null when the sheet is not an MEP type.
 */
export function classifyMEPSheet(titleOrFilename: string): MEPSheetType {
  for (const [type, patterns] of Object.entries(MEP_SHEET_PATTERNS) as Array<
    [NonNullable<MEPSheetType>, RegExp[]]
  >) {
    if (patterns.some(p => p.test(titleOrFilename))) return type
  }
  return null
}

// ---------------------------------------------------------------------------
// Entity type detection
// ---------------------------------------------------------------------------

export type MEPEntityType =
  | 'panel'
  | 'transformer'
  | 'electrical_fixture'
  | 'conduit'
  | 'schedule_entry'
  | 'air_handler'
  | 'vav_box'
  | 'diffuser'
  | 'duct_run'
  | 'mechanical_equipment'
  | 'plumbing_fixture'
  | 'floor_drain'
  | 'cleanout'
  | 'piping_segment'
  | 'plumbing_equipment'

/** Patterns to detect MEP entity type from label text. */
export const MEP_ENTITY_PATTERNS: Record<MEPEntityType, RegExp[]> = {
  // Electrical
  panel: [
    /\bP[-_]?\d+[A-Z]?\b/,               // P-1, PA, P1A
    /\bMDP\b/,                             // main distribution panel
    /\bLDP\b/,                             // lighting distribution panel
    /\bSWBD\b/i,                           // switchboard
    /panel(?:board)?\b/i,
  ],
  transformer: [
    /\bXFMR\b/i,
    /\bTR[-_]?\d/i,
    /transformer\b/i,
  ],
  electrical_fixture: [
    /\bLF[-_]?\d/i,                        // lighting fixture
    /\bEM\b/,                              // emergency light
    /\bEX\b/,                              // exit sign
    /luminaire\b/i,
    /light\s+fixture\b/i,
  ],
  conduit: [
    /conduit\b/i,
    /\bEMT\b/,
    /\bRMC\b/,
    /\bIMC\b/,
  ],
  schedule_entry: [
    /schedule\s+entry/i,
    /\bSCHED\b/i,
  ],
  // Mechanical
  air_handler: [
    /\bAHU[-_]?\d/i,
    /\bAH[-_]?\d/i,
    /air.?handling\s+unit\b/i,
    /air\s+handler\b/i,
    /\bMAU\b/i,                            // makeup air unit
    /\bERU\b/i,                            // energy recovery unit
  ],
  vav_box: [
    /\bVAV[-_]?\d/i,
    /variable\s+air\s+volume\b/i,
    /\bFCU[-_]?\d/i,                       // fan coil unit
    /\bCAV[-_]?\d/i,                       // constant air volume
  ],
  diffuser: [
    /\bCD[-_]?\d/i,                        // ceiling diffuser
    /\bSD[-_]?\d/i,                        // supply diffuser
    /\bRG[-_]?\d/i,                        // return grille
    /diffuser\b/i,
    /\bgrille\b/i,
  ],
  duct_run: [
    /duct\b/i,
    /\bFD\b/,                              // flex duct
    /supply\s+duct\b/i,
    /return\s+duct\b/i,
  ],
  mechanical_equipment: [
    /\bEF[-_]?\d/i,                        // exhaust fan
    /\bCU[-_]?\d/i,                        // condensing unit
    /\bHP[-_]?\d/i,                        // heat pump
    /\bRTU[-_]?\d/i,                       // rooftop unit
    /\bCH[-_]?\d/i,                        // chiller
    /\bCT[-_]?\d/i,                        // cooling tower
    /mechanical\s+equipment\b/i,
  ],
  // Plumbing
  plumbing_fixture: [
    /\bWC\b/,                              // water closet
    /\bWH\b/,                              // water heater
    /\bLV\b/,                              // lavatory
    /\bUS\b/,                              // urinal
    /toilet\b/i,
    /lavatory\b/i,
    /urinal\b/i,
    /sink\b/i,
    /drinking\s+fountain\b/i,
  ],
  floor_drain: [
    /\bFD[-_]?\d*/i,
    /floor\s+drain\b/i,
    /\bFD\b/,
  ],
  cleanout: [
    /\bCO[-_]?\d*/i,
    /cleanout\b/i,
    /\bC\.O\./i,
  ],
  piping_segment: [
    /\bHWS\b/,                             // hot water supply
    /\bHWR\b/,                             // hot water return
    /\bCWS\b/,                             // cold water supply
    /\bDW\b/,                              // domestic water
    /piping\b/i,
  ],
  plumbing_equipment: [
    /water\s+heater\b/i,
    /\bWH[-_]?\d/i,
    /\bPWH\b/i,                            // point-of-use water heater
    /\bSWH\b/i,                            // solar water heater
    /booster\s+pump\b/i,
    /backflow\s+preventer\b/i,
    /\bRP[-_]?\d/i,                        // reduced pressure BFP
  ],
}

/**
 * Detect the MEP entity type from a text label.
 * Returns 'schedule_entry' as fallback for unrecognized text.
 */
export function detectMEPEntityType(text: string): MEPEntityType {
  for (const [type, patterns] of Object.entries(MEP_ENTITY_PATTERNS) as Array<
    [MEPEntityType, RegExp[]]
  >) {
    if (type === 'schedule_entry') continue       // Skip default — checked last
    if (type === 'conduit') continue              // Too generic, check last among electrical
    if (patterns.some(p => p.test(text))) return type
  }
  if (MEP_ENTITY_PATTERNS.conduit.some(p => p.test(text))) return 'conduit'
  return 'schedule_entry'
}

/**
 * Detect the trade (electrical / mechanical / plumbing) from entity type.
 * Mirrors classifyMEPTrade() in mep-queries.ts — kept here for extraction-side use.
 */
export function detectMEPTrade(entityType: MEPEntityType): 'electrical' | 'mechanical' | 'plumbing' {
  const ELECTRICAL: Set<MEPEntityType> = new Set([
    'panel', 'transformer', 'electrical_fixture', 'conduit', 'schedule_entry',
  ])
  const MECHANICAL: Set<MEPEntityType> = new Set([
    'air_handler', 'vav_box', 'diffuser', 'duct_run', 'mechanical_equipment',
  ])
  if (ELECTRICAL.has(entityType)) return 'electrical'
  if (MECHANICAL.has(entityType)) return 'mechanical'
  return 'plumbing'
}

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

/**
 * Extract an equipment or fixture tag from label text.
 * Normalizes to uppercase.
 *
 * Examples: "AHU-1", "ahu1" → "AHU-1", "P-2A" → "P-2A"
 */
export function extractMEPTagFromText(text: string): string | null {
  // Panel: P-1, P-1A, MDP, LDP
  const panelMatch = text.match(/\b(MDP|LDP|SWBD|P[-_]?\d+[A-Z]?)\b/i)
  if (panelMatch) return panelMatch[1].toUpperCase().replace(/_/, '-')

  // AHU / VAV / RTU / EF etc.
  const equipMatch = text.match(
    /\b(AHU|AH|MAU|ERU|VAV|FCU|CAV|EF|CU|HP|RTU|CH|CT|WH|PWH|SWH)[-_]?(\d+[A-Z]?)\b/i
  )
  if (equipMatch) return `${equipMatch[1].toUpperCase()}-${equipMatch[2].toUpperCase()}`

  // Diffuser / grille: CD-1, RG-2
  const diffMatch = text.match(/\b(CD|SD|RG|FD)[-_]?(\d+)\b/i)
  if (diffMatch) return `${diffMatch[1].toUpperCase()}-${diffMatch[2]}`

  // Cleanout: CO-1
  const coMatch = text.match(/\bC\.?O\.?[-_]?(\d+[A-Z]?)\b/i)
  if (coMatch) return `CO-${coMatch[1].toUpperCase()}`

  return null
}

// ---------------------------------------------------------------------------
// Canonical name builder
// ---------------------------------------------------------------------------

/**
 * Build the canonical_name for an MEP entity.
 * Pattern: MEP_ENTITYTYPE_TAG or MEP_ENTITYTYPE_LABEL
 *
 * Examples:
 *   'mep' + 'air_handler' + 'AHU-1'  → 'MEP_AIR_HANDLER_AHU1'
 *   'mep' + 'panel'       + 'P-2A'   → 'MEP_PANEL_P2A'
 */
export function buildMEPCanonicalName(
  entityType: MEPEntityType,
  tag: string | null,
  label: string | null
): string {
  const identifier = tag ?? label ?? 'UNKNOWN'
  const normalized = identifier.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `MEP_${entityType.toUpperCase()}_${normalized}`
}

// ---------------------------------------------------------------------------
// Extraction prompts
// ---------------------------------------------------------------------------

export const MEP_EXTRACTION_SYSTEM_CONTEXT = `You are an MEP (mechanical, electrical, plumbing) drawing extraction assistant.
Your task is to extract MEP equipment entities from plan drawings and schedules.

Rules:
- Extract only entities that are clearly labeled or tagged on the drawing.
- For each entity, extract: entity_type, tag/label, room, level, status.
- Maintain original equipment tag formatting (AHU-1, P-2A, VAV-103 etc.).
- Status: "new" for new work, "existing" for existing to remain, "relocated", "removed", or "unknown".
- Include schedule data (capacity, CFM, kW, voltage) as findings.
- Output ONLY valid JSON. No explanations.`

export const MECHANICAL_EXTRACTION_PROMPT = `Extract all mechanical equipment entities from this drawing sheet.

For each item found, output a JSON array entry:
{
  "entity_type": "air_handler" | "vav_box" | "diffuser" | "duct_run" | "mechanical_equipment",
  "label": "<tag as shown, e.g. AHU-1, VAV-103>",
  "canonical_name": "MEP_<TYPE>_<TAG_NORMALIZED>",
  "display_name": "<human-readable description>",
  "status": "new" | "existing" | "relocated" | "removed" | "unknown",
  "room_number": "<room or space number>" | null,
  "level": "<floor level, e.g. L1, L2, ROOF>" | null,
  "findings": [
    {
      "finding_type": "capacity" | "dimension" | "equipment_tag" | "coordination_note" | "note",
      "statement": "<e.g. 5000 CFM, 10-ton cooling, 208V/3Ph>",
      "text_value": "<string>" | null,
      "numeric_value": <number> | null,
      "unit": "<CFM, tons, kW, V, etc.>" | null
    }
  ]
}

Output the complete JSON array. If no mechanical entities are found, output [].`

export const ELECTRICAL_EXTRACTION_PROMPT = `Extract all electrical equipment entities from this drawing sheet.

For each item found, output a JSON array entry:
{
  "entity_type": "panel" | "transformer" | "electrical_fixture" | "conduit" | "schedule_entry",
  "label": "<tag as shown, e.g. P-1, MDP, ATS-1>",
  "canonical_name": "MEP_<TYPE>_<TAG_NORMALIZED>",
  "display_name": "<human-readable description>",
  "status": "new" | "existing" | "relocated" | "removed" | "unknown",
  "room_number": "<room number>" | null,
  "level": "<floor level>" | null,
  "findings": [
    {
      "finding_type": "capacity" | "circuit_ref" | "equipment_tag" | "dimension" | "note",
      "statement": "<e.g. 200A/120-240V/1Ph, 42-circuit, fed from MDP>",
      "text_value": "<string>" | null,
      "numeric_value": <number> | null,
      "unit": "<A, V, kVA, AWG, etc.>" | null
    }
  ]
}

Output the complete JSON array. If no electrical entities are found, output [].`

export const PLUMBING_EXTRACTION_PROMPT = `Extract all plumbing equipment and fixture entities from this drawing sheet.

For each item found, output a JSON array entry:
{
  "entity_type": "plumbing_fixture" | "floor_drain" | "cleanout" | "piping_segment" | "plumbing_equipment",
  "label": "<tag as shown, e.g. WC-1, FD-3, CO-2>",
  "canonical_name": "MEP_<TYPE>_<TAG_NORMALIZED>",
  "display_name": "<human-readable description>",
  "status": "new" | "existing" | "relocated" | "removed" | "unknown",
  "room_number": "<room number>" | null,
  "level": "<floor level>" | null,
  "findings": [
    {
      "finding_type": "dimension" | "capacity" | "equipment_tag" | "coordination_note" | "note",
      "statement": "<e.g. 3-inch floor drain, trap primer required, 2-inch vent>",
      "text_value": "<string>" | null,
      "numeric_value": <number> | null,
      "unit": "<inch, GPM, etc.>" | null
    }
  ]
}

Output the complete JSON array. If no plumbing entities are found, output [].`
