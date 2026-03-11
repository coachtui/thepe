/**
 * Spec Extractor — Phase 6A
 *
 * Extraction infrastructure for specification documents (CSI-formatted and
 * narrative). Handles both full project manuals and individual spec sections.
 *
 * Role in the pipeline:
 *   When the vision / document processing pipeline encounters a file
 *   classified as a specification document, it calls:
 *     1. classifySpecDocument()          — detect spec format and structure
 *     2. extractSpecSections()           — split into section headers
 *     3. extractRequirementFamilies()    — regex first-pass per section
 *     4. SPEC_SECTION_EXTRACTION_PROMPT  — passed to claude-sonnet for
 *                                          structured JSON extraction
 *
 * Output is written to the universal entity model:
 *   project_entities  (discipline='spec')
 *   entity_findings   (material_requirement, testing_requirement, etc.)
 *   entity_citations  (document_id, section_number as sheet_number)
 *   entity_relationships (governs, requires, references)
 *
 * Design rules:
 *   - Section classification is deterministic (regex first)
 *   - Requirement families are assigned by finding_type, not model inference
 *   - Ambiguous requirement family → 'execution_requirement' (conservative)
 *   - Model outputs structured JSON only — no narrative interpretation
 *   - extraction_source = 'text' for spec entities (parsed from text, not vision)
 */

// ---------------------------------------------------------------------------
// Document classification
// ---------------------------------------------------------------------------

export type SpecDocumentType =
  | 'project_manual'      // Full project manual (multiple sections)
  | 'spec_section'        // Single CSI section
  | 'spec_addendum'       // Addendum affecting spec sections
  | 'reference_standard'  // Referenced standard (ASTM, ACI, etc.)
  | null

/**
 * Regex patterns to identify spec document types from title or filename.
 */
export const SPEC_DOCUMENT_PATTERNS: Record<NonNullable<SpecDocumentType>, RegExp[]> = {
  project_manual: [
    /project\s+manual/i,
    /specifications\s+(?:and\s+)?(?:drawings|contract\s+documents)/i,
    /(?:contract\s+)?specification[s]?\s+(?:book|manual|volume)/i,
    /\btable\s+of\s+contents\b/i,
    /division\s+\d+.*division\s+\d+/is,  // multiple divisions
  ],
  spec_addendum: [
    /addendum\s+(?:no\.?\s*)?\d+/i,
    /specification\s+addendum/i,
    /revised?\s+specification/i,
  ],
  reference_standard: [
    /^ASTM\s+[A-Z]\d+/i,
    /^ACI\s+\d+/i,
    /^AISC\s+/i,
    /american\s+(?:concrete|steel|welding)\s+institute/i,
  ],
  spec_section: [
    /SECTION\s+\d{2}\s*\d{2}\s*\d{2}/i,
    /^\d{2}\s+\d{2}\s+\d{2}\b/,
    /\bPART\s+1\s*[-–]\s*GENERAL\b/i,
    /\bPART\s+2\s*[-–]\s*PRODUCTS\b/i,
    /\bPART\s+3\s*[-–]\s*EXECUTION\b/i,
  ],
}

/**
 * File extension + name patterns that are strong signals for spec documents.
 */
export const SPEC_FILE_PATTERNS = /(?:spec|specification|project.?manual|section[_\s]\d{2})/i

/**
 * Classify a document as a spec type.
 */
export function classifySpecDocument(
  title: string,
  filename: string
): SpecDocumentType {
  const titleNorm = title.trim()
  const fileNorm = filename.trim()

  for (const [docType, patterns] of Object.entries(SPEC_DOCUMENT_PATTERNS) as Array<
    [NonNullable<SpecDocumentType>, RegExp[]]
  >) {
    if (patterns.some(p => p.test(titleNorm) || p.test(fileNorm))) {
      return docType
    }
  }

  // Filename-based fallback
  if (SPEC_FILE_PATTERNS.test(fileNorm)) return 'spec_section'

  return null
}

// ---------------------------------------------------------------------------
// CSI section extraction
// ---------------------------------------------------------------------------

/**
 * CSI section header patterns.
 * Handles "03 30 00", "033000", "Section 03 30 00", "SECTION 03 30 00 -"
 */
export const CSI_SECTION_PATTERN =
  /(?:SECTION\s+)?(\d{2}\s*\d{2}\s*\d{2})\s*[-–]?\s*([A-Z][A-Z\s\-/&,]+?)(?:\n|$)/gi

/**
 * CSI PART heading patterns.
 */
export const CSI_PART_PATTERN =
  /^\s*PART\s+([123])\s*[-–]\s*(GENERAL|PRODUCTS|EXECUTION)\s*$/im

/**
 * Extract section numbers and titles from raw spec text.
 * Returns an ordered list of section descriptors.
 */
export function extractSpecSections(text: string): Array<{
  sectionNumber: string
  sectionTitle: string
  startIndex: number
}> {
  const sections: Array<{ sectionNumber: string; sectionTitle: string; startIndex: number }> = []
  const pattern = new RegExp(CSI_SECTION_PATTERN.source, 'gim')
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const rawNum = match[1].replace(/\s+/g, '')
    const sectionNumber = `${rawNum.slice(0, 2)} ${rawNum.slice(2, 4)} ${rawNum.slice(4, 6)}`
    const sectionTitle = match[2].trim().replace(/\s+/g, ' ')

    sections.push({
      sectionNumber,
      sectionTitle,
      startIndex: match.index,
    })
  }

  return sections
}

/**
 * Split a section body into PART 1/2/3 blocks.
 */
export function splitIntoParts(sectionText: string): {
  general: string
  products: string
  execution: string
} {
  const partPattern = /PART\s+([123])\s*[-–]\s*(GENERAL|PRODUCTS|EXECUTION)/gi

  const parts: Array<{ num: number; label: string; start: number }> = []
  let m: RegExpExecArray | null

  while ((m = partPattern.exec(sectionText)) !== null) {
    parts.push({ num: parseInt(m[1]), label: m[2].toUpperCase(), start: m.index })
  }

  if (parts.length === 0) {
    return { general: sectionText, products: '', execution: '' }
  }

  const getText = (startIdx: number, endIdx: number) =>
    sectionText.slice(startIdx, endIdx).trim()

  const part1 = parts.find(p => p.num === 1)
  const part2 = parts.find(p => p.num === 2)
  const part3 = parts.find(p => p.num === 3)

  return {
    general:   part1 ? getText(part1.start, part2?.start ?? part3?.start ?? sectionText.length) : '',
    products:  part2 ? getText(part2.start, part3?.start ?? sectionText.length) : '',
    execution: part3 ? getText(part3.start, sectionText.length) : '',
  }
}

// ---------------------------------------------------------------------------
// First-pass requirement family detection
// ---------------------------------------------------------------------------

/**
 * Requirement keyword patterns for first-pass classification.
 * Used before the model extraction step to tag obvious requirements cheaply.
 */
export const REQUIREMENT_PATTERNS: Record<string, RegExp[]> = {
  material_requirement: [
    /\bshall\s+(?:be|have|conform|meet|comply)\b.{0,80}(?:ASTM|ACI|AISC|grade|type|class|psi|ksi|f'c|fy)/i,
    /\b(?:minimum|maximum|required)\s+(?:strength|compressive|yield|tensile)/i,
    /\b(?:concrete|steel|masonry|wood|timber|aluminum|copper|PVC|HDPE)\b.{0,40}\bshall\b/i,
    /\b(?:mix|mixture|admixture|aggregate|cement|rebar|reinforcing)\b.{0,60}\bshall\b/i,
  ],
  execution_requirement: [
    /\bshall\s+(?:be\s+)?(?:installed|placed|applied|erected|constructed|fabricated)\b/i,
    /\b(?:install|place|apply|erect|construct|fabricate|provide)\b.{0,40}\bin\s+accordance\b/i,
    /\b(?:sequence|order|procedure|method)\s+of\s+(?:installation|placement|construction)\b/i,
    /\bdo\s+not\s+(?:install|place|apply|proceed)\b/i,
  ],
  testing_requirement: [
    /\b(?:test|testing|sample|specimen|cylinder|core|probe)\b.{0,60}\bshall\b/i,
    /\b(?:slump|air\s+content|temperature|unit\s+weight)\s+test\b/i,
    /\b(?:field|laboratory)\s+test(?:ing)?\b/i,
    /\b(?:one|1)\s+(?:test|set|sample)\s+per\s+\d+/i,
    /\bhold\s+point\b/i,
    /\bwitness\s+(?:test|inspection)\b/i,
  ],
  submittal_requirement: [
    /\bsubmit\b.{0,80}(?:before|prior\s+to|in\s+advance|days?)\b/i,
    /\b(?:shop\s+drawing|product\s+data|sample|certificate|mix\s+design)\b.{0,40}\bsubmit\b/i,
    /\b(?:approval|review)\s+(?:required|necessary)\s+before\b/i,
    /\bsubmit\b.{0,40}(?:for\s+review|for\s+approval|to\s+(?:the\s+)?(?:engineer|architect))/i,
  ],
  closeout_requirement: [
    /\b(?:at|upon|prior\s+to)\s+(?:substantial\s+completion|project\s+closeout|final\s+acceptance)\b/i,
    /\b(?:operation|maintenance)\s+(?:manual|data|instruction)\b/i,
    /\bwarranty\b.{0,60}\b(?:year|month|provide|submit)\b/i,
    /\b(?:as-built|record)\s+drawing[s]?\b/i,
    /\b(?:test\s+report|inspection\s+report)\b.{0,40}\bsubmit\b/i,
  ],
  protection_requirement: [
    /\bprotect\b.{0,80}(?:damage|weather|moisture|freezing|impact|adjacent)\b/i,
    /\bdo\s+not\s+(?:damage|disturb|expose|allow)\b/i,
    /\b(?:cover|wrap|seal|guard)\s+(?:to|for|against)\b.{0,40}protect\b/i,
    /\bremove\s+(?:protection|covering|temporary)\b/i,
    /\bminimum\s+\d+\s+(?:day|hour)\b.{0,40}\bprotect\b/i,
  ],
  inspection_requirement: [
    /\bnotif(?:y|ication)\b.{0,60}\b(?:inspector|engineer|architect|owner)\b/i,
    /\b(?:24|48|72)\s*hour[s]?\s+(?:before|prior|notice)\b/i,
    /\bdo\s+not\s+(?:proceed|continue|pour|place)\b.{0,40}\buntil\b.{0,40}\binspect/i,
    /\bhold\s+point\b/i,
    /\b(?:special\s+inspection|third[\s-]party\s+inspection|IBC)\b/i,
  ],
}

/**
 * First-pass requirement classification from text.
 * Returns the most likely requirement family, or null if not determined.
 */
export function classifyRequirement(
  text: string
): 'material_requirement' | 'execution_requirement' | 'testing_requirement' |
   'submittal_requirement' | 'closeout_requirement' | 'protection_requirement' |
   'inspection_requirement' | null {
  for (const [family, patterns] of Object.entries(REQUIREMENT_PATTERNS)) {
    if (patterns.some(p => p.test(text))) {
      return family as ReturnType<typeof classifyRequirement>
    }
  }
  return null
}

/**
 * Extract requirement statements from a section part text.
 * Uses the "shall" verb as the primary signal.
 * Returns up to maxItems requirement strings.
 */
export function extractRequirementStatements(
  text: string,
  maxItems = 30
): string[] {
  const statements: string[] = []
  const lines = text.split(/\n+/)

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip empty lines and pure section headers
    if (!trimmed || trimmed.length < 20) continue
    // Skip lines that are pure headings (ALL CAPS, short)
    if (/^[A-Z\s\-–.]{2,40}$/.test(trimmed)) continue
    // Must contain "shall" or "required" or equivalent obligation word
    if (/\b(shall|must|required|required\s+to|need\s+to)\b/i.test(trimmed)) {
      statements.push(trimmed.replace(/^\s*[A-Z]\.\s*/, '').replace(/^\s*\d+\.\s*/, ''))
      if (statements.length >= maxItems) break
    }
  }

  return statements
}

// ---------------------------------------------------------------------------
// Canonical name helpers
// ---------------------------------------------------------------------------

/**
 * Build canonical_name for a spec section.
 * "03 30 00" → "SPEC_03_30_00"
 */
export function buildSpecSectionCanonical(sectionNumber: string): string {
  const norm = sectionNumber.trim().replace(/\s+/g, '_')
  return `SPEC_${norm}`
}

/**
 * Build canonical_name for a spec requirement.
 * "03 30 00", "material", 1 → "SPEC_03_30_00_REQ_MATERIAL_001"
 */
export function buildSpecRequirementCanonical(
  sectionNumber: string,
  requirementType: string,
  index: number
): string {
  const norm = sectionNumber.trim().replace(/\s+/g, '_')
  const typeNorm = requirementType.toUpperCase()
  const idx = String(index).padStart(3, '0')
  return `SPEC_${norm}_REQ_${typeNorm}_${idx}`
}

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

/**
 * Extraction prompt for a single spec section.
 *
 * Passed to claude-sonnet with the section text. Model outputs structured JSON.
 * The model does NOT assign support levels — those are assigned deterministically
 * by the ingestion code based on source type.
 */
export const SPEC_SECTION_EXTRACTION_PROMPT = `
You are a construction specification parser. Extract structured data from the specification section text provided.

Output ONLY valid JSON. Do not add commentary or prose outside the JSON object.

JSON structure:
{
  "sectionNumber": "03 30 00",           // CSI section number, formatted "XX XX XX"
  "sectionTitle": "Cast-In-Place Concrete",
  "divisionNumber": "03",
  "parts": {
    "general": true,   // true if PART 1 is present
    "products": true,  // true if PART 2 is present
    "execution": true  // true if PART 3 is present
  },
  "requirements": [
    {
      "requirementType": "material_requirement",
      // requirementType must be one of:
      //   material_requirement, execution_requirement, testing_requirement,
      //   submittal_requirement, closeout_requirement, protection_requirement,
      //   inspection_requirement
      "statement": "Concrete compressive strength: f'c = 4000 psi minimum at 28 days",
      // statement: one complete, self-contained requirement. Do not truncate.
      "partReference": "PART 2 - PRODUCTS, 2.1.A",
      // partReference: specific article/paragraph location
      "confidence": 0.95
      // confidence: 0.7–1.0. Lower when the requirement boundary is unclear.
    }
  ],
  "referencedStandards": ["ASTM C150", "ACI 301"],
  // referencedStandards: external standards mentioned in the section
  "confidence": 0.92
  // overall extraction confidence for this section
}

Rules:
- Extract only OBLIGATORY requirements (shall, must, required). Skip informational notes.
- One JSON object per spec section. If the text contains multiple sections, use the primary section only.
- If a requirement is ambiguous, classify it as execution_requirement (conservative default).
- Do not invent requirements not present in the text.
- Keep statements verbatim or nearly verbatim — do not paraphrase.
- Maximum 50 requirements per section.
`.trim()

/**
 * Extraction prompt for a full project manual (multiple sections).
 * Returns an array of section objects.
 */
export const SPEC_MANUAL_EXTRACTION_PROMPT = `
You are a construction specification parser. The text contains multiple specification sections from a project manual.

Extract ONLY sections where substantive requirements are present. Skip TOC, signature pages, and administrative boilerplate.

Output ONLY valid JSON as an array:
[
  {
    "sectionNumber": "03 30 00",
    "sectionTitle": "Cast-In-Place Concrete",
    "divisionNumber": "03",
    "hasRequirements": true,
    "requirementCount": 12,
    "primaryRequirementTypes": ["material_requirement", "testing_requirement"]
    // primaryRequirementTypes: which families are present (for prioritization)
  }
]

This is a first-pass index only. Individual section extraction happens separately.
Maximum 100 sections.
`.trim()
