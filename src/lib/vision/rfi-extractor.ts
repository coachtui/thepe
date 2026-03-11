/**
 * RFI Extractor — Phase 6B
 *
 * Extraction infrastructure for RFIs, ASIs, addenda, and bulletins.
 *
 * Role in the pipeline:
 *   When the document processing pipeline encounters a change document:
 *     1. classifyChangeDocument()        — detect doc type (RFI/ASI/addendum/bulletin)
 *     2. extractChangeDocIdentifier()    — extract number and type
 *     3. extractChangeDocReferences()    — extract sheet/detail/spec references
 *     4. RFI_EXTRACTION_PROMPT           — passed to claude-sonnet for structured JSON
 *
 * Output is written to the universal entity model:
 *   project_entities  (discipline='rfi')
 *   entity_findings   (clarification_statement, superseding_language, revision_metadata)
 *   entity_citations  (document_id, change doc number as sheet_number)
 *   entity_relationships (clarifies, replaces, references, applies_to)
 *
 * Design rules:
 *   - Document type detection is deterministic (regex patterns first)
 *   - Status assignment: answered → 'existing'; open → 'new'; voided → 'to_remove'
 *   - Superseding language is flagged explicitly, never inferred from clarification
 *   - extraction_source = 'text' (parsed from document text, not vision)
 *   - Open/unanswered RFIs: support_level = 'inferred' on all findings
 *   - Answered RFIs: support_level = 'explicit' on clarification findings
 */

// ---------------------------------------------------------------------------
// Document classification
// ---------------------------------------------------------------------------

export type ChangeDocType =
  | 'rfi'
  | 'asi'
  | 'addendum'
  | 'bulletin'
  | 'clarification'
  | null

/**
 * Regex patterns to identify change document types from title or filename.
 */
export const CHANGE_DOC_PATTERNS: Record<NonNullable<ChangeDocType>, RegExp[]> = {
  rfi: [
    /\bRFI\s*[-#]?\s*\d+/i,
    /\brequest\s+for\s+information\b/i,
    /\brequest\s+for\s+clarification\b/i,
  ],
  asi: [
    /\bASI\s*[-#]?\s*\d+/i,
    /\barchitect['\s]*s?\s+supplemental\s+instruction/i,
    /\bsupplemental\s+instruction/i,
  ],
  addendum: [
    /\baddendum\s+(?:no\.?\s*)?\d+/i,
    /\baddendum\s+[a-z]\b/i,
  ],
  bulletin: [
    /\bbulletin\s+(?:no\.?\s*)?\d+/i,
    /\bowner['s\s]+bulletin/i,
  ],
  clarification: [
    /\bclarification\s+(?:no\.?\s*)?\d+/i,
    /\bfield\s+clarification\b/i,
  ],
}

/**
 * File patterns for change documents.
 */
export const RFI_FILE_PATTERNS = /(?:rfi|asi|addendum|bulletin|clarification)[-_\s]*\d*/i

/**
 * Classify a document as a change document type.
 */
export function classifyChangeDocument(
  title: string,
  filename: string
): ChangeDocType {
  const titleNorm = title.trim()
  const fileNorm = filename.trim()

  for (const [docType, patterns] of Object.entries(CHANGE_DOC_PATTERNS) as Array<
    [NonNullable<ChangeDocType>, RegExp[]]
  >) {
    if (patterns.some(p => p.test(titleNorm) || p.test(fileNorm))) {
      return docType
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Identifier extraction
// ---------------------------------------------------------------------------

/**
 * Extract a change document identifier from text.
 * "RFI-023", "RFI #23", "Request for Information No. 23" → { type: 'rfi', number: '023' }
 */
export function extractChangeDocIdentifier(text: string): {
  docType: ChangeDocType
  number: string
  label: string  // normalized label: "RFI-023"
} | null {
  const patterns: Array<{ type: ChangeDocType; pattern: RegExp }> = [
    { type: 'rfi',          pattern: /\bRFI\s*[-#]?\s*(\d+)/i },
    { type: 'asi',          pattern: /\bASI\s*[-#]?\s*(\d+)/i },
    { type: 'addendum',     pattern: /\baddendum\s*(?:no\.?\s*)?(\d+)/i },
    { type: 'bulletin',     pattern: /\bbulletin\s*(?:no\.?\s*)?(\d+)/i },
    { type: 'clarification',pattern: /\bclarification\s*(?:no\.?\s*)?(\d+)/i },
  ]

  for (const { type, pattern } of patterns) {
    const m = text.match(pattern)
    if (m) {
      const num = m[1].padStart(3, '0')
      const prefix = type!.toUpperCase()
      return {
        docType: type,
        number: num,
        label: `${prefix}-${num}`,
      }
    }
  }

  return null
}

/**
 * Extract date strings from change document text.
 * Recognizes: "2026-02-15", "02/15/2026", "February 15, 2026"
 */
export function extractChangeDocDates(text: string): {
  dateIssued: string | null
  dateAnswered: string | null
} {
  // ISO date
  const isoPattern = /\b(\d{4}-\d{2}-\d{2})\b/g
  // US date
  const usPattern  = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g

  const dates: string[] = []
  let m: RegExpExecArray | null

  while ((m = isoPattern.exec(text)) !== null) dates.push(m[1])
  while ((m = usPattern.exec(text)) !== null) dates.push(normalizeUsDate(m[1]))

  dates.sort()

  return {
    dateIssued:   dates[0] ?? null,
    dateAnswered: dates.length > 1 ? dates[dates.length - 1] : null,
  }
}

function normalizeUsDate(s: string): string {
  const parts = s.split('/')
  if (parts.length !== 3) return s
  const [m, d, y] = parts
  const year = y.length === 2 ? `20${y}` : y
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Reference extraction
// ---------------------------------------------------------------------------

/**
 * Extract sheet number references from change document text.
 * "See Sheet S-201", "refer to Detail 5/S-201" → ["S-201", "5/S-201"]
 */
export function extractSheetReferences(text: string): string[] {
  const refs = new Set<string>()

  // Sheet number patterns
  const sheetPatterns = [
    /\bsheet\s+([A-Z]-?\d{1,3}[A-Z]?)\b/gi,
    /\bdrawing\s+(?:no\.?\s*)?([A-Z]-?\d{1,3}[A-Z]?)\b/gi,
    /\b([ACSMEPFDG]-?\d{1,3}[A-Z]?)\b/g,  // common sheet number formats
  ]

  for (const pattern of sheetPatterns) {
    let m: RegExpExecArray | null
    while ((m = new RegExp(pattern.source, pattern.flags).exec(text)) !== null) {
      refs.add(m[1])
    }
  }

  return Array.from(refs)
}

/**
 * Extract detail references (e.g. "Detail 5/S-201", "3/A-401").
 */
export function extractDetailReferences(text: string): string[] {
  const refs = new Set<string>()

  const patterns = [
    /\bdetail\s+(\d+\/[A-Z]-?\d{1,3}[A-Z]?)\b/gi,
    /\b(\d+\/[A-Z]-?\d{1,3}[A-Z]?)\b/g,
  ]

  for (const pattern of patterns) {
    let m: RegExpExecArray | null
    while ((m = new RegExp(pattern.source, pattern.flags).exec(text)) !== null) {
      refs.add(m[1])
    }
  }

  return Array.from(refs)
}

/**
 * Extract spec section references from change document text.
 * "Spec Section 03 30 00", "Section 03300", "Division 3" → ["03 30 00"]
 */
export function extractSpecSectionReferences(text: string): string[] {
  const refs = new Set<string>()

  const patterns = [
    /\b(?:spec(?:ification)?|section)\s+(\d{2}\s*\d{2}\s*\d{2})\b/gi,
    /\bsection\s+(\d{5,6})\b/gi,
  ]

  for (const pattern of patterns) {
    let m: RegExpExecArray | null
    while ((m = new RegExp(pattern.source, pattern.flags).exec(text)) !== null) {
      const raw = m[1].replace(/\s+/g, '')
      const norm = `${raw.slice(0, 2)} ${raw.slice(2, 4)} ${raw.slice(4, 6)}`
      refs.add(norm)
    }
  }

  return Array.from(refs)
}

// ---------------------------------------------------------------------------
// Superseding language detection
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate superseding / replacement language.
 * When these match, the finding is tagged 'superseding_language'.
 */
export const SUPERSEDING_PATTERNS = [
  /\b(?:supersede|replace|revise|amend)\b.{0,100}(?:detail|drawing|sheet|section|specification)/i,
  /\b(?:in\s+lieu\s+of|instead\s+of)\b/i,
  /\bno\s+longer\s+(?:applies?|valid|required)/i,
  /\bdelete\b.{0,60}(?:and\s+)?(?:replace|substitute|insert)/i,
  /\bthe\s+following\s+(?:shall\s+)?(?:replace|supersede|govern)/i,
]

/**
 * Detect whether a statement contains superseding language.
 */
export function isSupersedingLanguage(text: string): boolean {
  return SUPERSEDING_PATTERNS.some(p => p.test(text))
}

// ---------------------------------------------------------------------------
// Status determination
// ---------------------------------------------------------------------------

/**
 * Determine RFI status from document text.
 * Returns entity status value: 'existing' (answered), 'new' (open), 'to_remove' (voided)
 */
export function determineRFIStatus(text: string): 'existing' | 'new' | 'to_remove' {
  const textLower = text.toLowerCase()

  if (/\b(voided?|withdrawn|cancelled?|cancelled?)\b/.test(textLower)) {
    return 'to_remove'
  }

  if (
    /\b(answered?|responded?|closed?|resolved?|complete[d]?)\b/.test(textLower) ||
    /\bresponse\s*:\s*\w/.test(textLower)
  ) {
    return 'existing'
  }

  return 'new'  // default: open/unanswered
}

// ---------------------------------------------------------------------------
// Canonical name helpers
// ---------------------------------------------------------------------------

/**
 * Build canonical_name for a change document entity.
 * "rfi", "023" → "RFI_023"
 */
export function buildChangeDocCanonical(
  docType: NonNullable<ChangeDocType>,
  number: string
): string {
  return `${docType.toUpperCase()}_${number.padStart(3, '0')}`
}

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

/**
 * Extraction prompt for RFI/change documents.
 * Passed to claude-sonnet with the document text.
 * Model outputs structured JSON. Support levels are assigned by ingestion code.
 */
export const RFI_EXTRACTION_PROMPT = `
You are a construction change-document parser. Extract structured data from the change document text provided.

Output ONLY valid JSON. Do not add commentary or prose outside the JSON object.

JSON structure:
{
  "docType": "rfi",
  // docType: one of: rfi, asi, addendum, bulletin, clarification
  "identifier": "RFI-023",
  // identifier: normalized doc number label (e.g. "RFI-023", "ASI-002", "ADDENDUM-001")
  "subject": "Footing F-1 depth at Grid A-3",
  // subject: one-line description of the clarification subject
  "status": "answered",
  // status: one of: open, answered, voided
  "dateIssued": "2026-02-15",
  // dateIssued: ISO date string or null
  "dateAnswered": "2026-02-20",
  // dateAnswered: ISO date string or null (for answered RFIs only)
  "referencedSheets": ["S-201"],
  // referencedSheets: drawing sheet numbers mentioned
  "referencedDetails": ["5/S-201"],
  // referencedDetails: detail callout references (e.g. "5/S-201")
  "referencedSpecSections": [],
  // referencedSpecSections: spec section numbers mentioned (CSI format)
  "referencedEntityLabels": ["F-1"],
  // referencedEntityLabels: drawing tags / element marks mentioned (e.g. "F-1", "D-14", "LP-1")
  "clarificationText": "Footing F-1 minimum depth shall be 4'-0\\" below finished grade.",
  // clarificationText: the complete clarification or response text. Verbatim.
  "supersedingLanguage": "Detail 5/S-201 is superseded and replaced by this clarification.",
  // supersedingLanguage: explicit replacement text, or null if none
  "confidence": 0.92
}

Rules:
- If the document is an Addendum with multiple items, extract the primary clarification only.
- If multiple RFIs are in one document, extract only the first/primary one.
- Keep clarificationText verbatim or near-verbatim. Do not summarize or paraphrase.
- Do not invent references not present in the text.
- If status cannot be determined, default to "open".
`.trim()

/**
 * Extraction prompt for an RFI log (multiple RFIs in tabular form).
 * Returns an array of lightweight RFI summaries.
 */
export const RFI_LOG_EXTRACTION_PROMPT = `
You are a construction RFI log parser. Extract all RFI entries from the log.

Output ONLY valid JSON as an array:
[
  {
    "identifier": "RFI-001",
    "subject": "Clarify door hardware on D-14",
    "status": "answered",
    "dateIssued": "2026-01-10",
    "dateAnswered": "2026-01-15"
  }
]

Include all RFIs visible in the log. Maximum 200 entries.
`.trim()
