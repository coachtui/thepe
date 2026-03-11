/**
 * Submittal Extractor — Phase 6C
 *
 * Extraction infrastructure for submittal logs, individual submittal packages,
 * and product data sheets.
 *
 * Role in the pipeline:
 *   When the document processing pipeline encounters a submittal document:
 *     1. classifySubmittalDocument()     — detect document type
 *     2. extractSubmittalIdentifier()    — extract submittal number and spec section
 *     3. extractApprovalStatus()         — extract approval status if present
 *     4. SUBMITTAL_EXTRACTION_PROMPT     — passed to claude-sonnet for structured JSON
 *
 * Output is written to the universal entity model:
 *   project_entities  (discipline='submittal')
 *   entity_findings   (approval_status, manufacturer_info, product_tag)
 *   entity_citations  (document_id, submittal_id as sheet_number)
 *   entity_relationships (submitted_for, applies_to)
 *
 * Design rules:
 *   - Submittal numbers may follow many conventions: "03-01", "16-002", "SB-01-001"
 *   - Approval status is extracted as a finding, not entity status
 *   - Entity status maps: approved=to_remain, pending=new, under_review=proposed, rejected=to_remove
 *   - extraction_source = 'text' (parsed from document text)
 *   - Model does NOT assign support levels; ingestion code assigns based on approval status
 */

// ---------------------------------------------------------------------------
// Document classification
// ---------------------------------------------------------------------------

export type SubmittalDocType =
  | 'submittal_log'     // Full submittal log (list of submittals)
  | 'submittal_package' // Single submittal package (cover + product data)
  | 'product_data'      // Product data sheet (manufacturer literature)
  | 'shop_drawing'      // Shop drawing
  | 'material_sample'   // Sample submittal
  | 'certificate'       // Certificate of compliance, test report
  | null

/**
 * Regex patterns to identify submittal document types.
 */
export const SUBMITTAL_DOC_PATTERNS: Record<NonNullable<SubmittalDocType>, RegExp[]> = {
  submittal_log: [
    /submittal\s+(?:log|register|schedule|tracking)/i,
    /submittal\s+(?:status|list)\s+(?:log|report)/i,
  ],
  shop_drawing: [
    /\bshop\s+drawing[s]?\b/i,
    /\bfabrication\s+drawing[s]?\b/i,
  ],
  material_sample: [
    /\bmaterial\s+sample\b/i,
    /\bcolor\s+sample\b/i,
    /\bsample\s+submittal\b/i,
  ],
  certificate: [
    /\bcertificate\s+of\s+(?:compliance|conformance|testing)\b/i,
    /\btest\s+report\b/i,
    /\bmaterial\s+certification\b/i,
  ],
  product_data: [
    /\bproduct\s+data\b/i,
    /\btechnical\s+data\s+sheet\b/i,
    /\bmanufacturer['\s]*s?\s+(?:data|literature|catalog)\b/i,
  ],
  submittal_package: [
    /\bsubmittal\s+(?:package|cover\s+sheet|transmittal)\b/i,
    /\btransmittal\s+form\b/i,
    /\bsubmission\s+(?:cover|form)\b/i,
  ],
}

/**
 * Classify a document as a submittal type.
 */
export function classifySubmittalDocument(
  title: string,
  filename: string
): SubmittalDocType {
  const titleNorm = title.trim()
  const fileNorm = filename.trim()

  for (const [docType, patterns] of Object.entries(SUBMITTAL_DOC_PATTERNS) as Array<
    [NonNullable<SubmittalDocType>, RegExp[]]
  >) {
    if (patterns.some(p => p.test(titleNorm) || p.test(fileNorm))) {
      return docType
    }
  }

  // Filename hint
  if (/submitt?al?/i.test(fileNorm)) return 'submittal_package'

  return null
}

// ---------------------------------------------------------------------------
// Identifier extraction
// ---------------------------------------------------------------------------

/**
 * Common submittal number formats:
 * "03-01", "03-01A", "16-002", "SB-03-01", "03300-01"
 */
const SUBMITTAL_ID_PATTERN =
  /\b(?:SB|SUB)?[-_]?(\d{2,5}[-_]\d{2,3}[A-Z]?)\b/i

/**
 * Extract submittal identifier and related spec section from text.
 */
export function extractSubmittalIdentifier(text: string): {
  submittalId: string | null
  specSection: string | null
  label: string | null
} {
  const m = text.match(SUBMITTAL_ID_PATTERN)
  const submittalId = m ? m[1].toUpperCase().replace(/_/g, '-') : null

  // Extract spec section reference
  const sectionMatch = text.match(/(?:spec(?:ification)?|section)\s+(\d{2}\s*\d{2}\s*\d{2})/i)
  let specSection: string | null = null
  if (sectionMatch) {
    const raw = sectionMatch[1].replace(/\s+/g, '')
    specSection = `${raw.slice(0, 2)} ${raw.slice(2, 4)} ${raw.slice(4, 6)}`
  }

  return {
    submittalId,
    specSection,
    label: submittalId,
  }
}

// ---------------------------------------------------------------------------
// Approval status extraction
// ---------------------------------------------------------------------------

/**
 * Approval status vocabulary and entity status mapping.
 */
export const APPROVAL_STATUS_PATTERNS: Array<{
  pattern: RegExp
  label: string
  entityStatus: 'to_remain' | 'new' | 'proposed' | 'to_remove'
}> = [
  {
    pattern: /\bapproved\s+as\s+noted\b/i,
    label: 'Approved as Noted',
    entityStatus: 'to_remain',
  },
  {
    pattern: /\bapproved\b(?!\s+as\s+noted)/i,
    label: 'Approved',
    entityStatus: 'to_remain',
  },
  {
    pattern: /\bresubmit\b/i,
    label: 'Revise and Resubmit',
    entityStatus: 'to_remove',
  },
  {
    pattern: /\brejected\b/i,
    label: 'Rejected',
    entityStatus: 'to_remove',
  },
  {
    pattern: /\bunder\s+review\b/i,
    label: 'Under Review',
    entityStatus: 'proposed',
  },
  {
    pattern: /\bpending\b/i,
    label: 'Pending Review',
    entityStatus: 'new',
  },
  {
    pattern: /\bno\s+exceptions\s+taken\b/i,
    label: 'No Exceptions Taken',
    entityStatus: 'to_remain',
  },
  {
    pattern: /\bmake\s+corrections\s+noted\b/i,
    label: 'Make Corrections Noted',
    entityStatus: 'proposed',
  },
]

/**
 * Extract approval status from submittal text.
 * Returns the label and entity status, or null if not determinable.
 */
export function extractApprovalStatus(text: string): {
  label: string
  entityStatus: 'to_remain' | 'new' | 'proposed' | 'to_remove'
} | null {
  for (const { pattern, label, entityStatus } of APPROVAL_STATUS_PATTERNS) {
    if (pattern.test(text)) {
      return { label, entityStatus }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Product/manufacturer extraction
// ---------------------------------------------------------------------------

/**
 * Extract manufacturer and model information from product data text.
 * Returns null if not found.
 */
export function extractManufacturerInfo(text: string): string | null {
  const patterns = [
    /\bmanufacturer\s*:\s*([A-Za-z][^,\n]{5,60})/i,
    /\bproduct(?:\s+name)?\s*:\s*([A-Za-z][^,\n]{5,60})/i,
    /\bmodel(?:\s+no\.?)?\s*:\s*([A-Za-z0-9][^,\n]{3,40})/i,
  ]

  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m) return m[1].trim()
  }

  return null
}

/**
 * Extract drawing tags mentioned in a submittal (e.g. "LP-1", "D-14").
 * These become product_tag findings linking the submittal to plan entities.
 */
export function extractProductTags(text: string): string[] {
  const tags = new Set<string>()

  const patterns = [
    /\b(LP|MDP|PP|EP|DP)-?\d{1,3}[A-Z]?\b/g,     // electrical panels
    /\b(AHU|RTU|FCU|VAV)-?\d{1,3}[A-Z]?\b/gi,    // mechanical
    /\b(WH|HB|FD|CO|WC)-?\d{1,3}[A-Z]?\b/g,      // plumbing
    /\bD-\d{1,3}[A-Z]?\b/g,                        // doors
    /\bW-\d{1,3}[A-Z]?\b/g,                        // windows
  ]

  for (const pattern of patterns) {
    let m: RegExpExecArray | null
    while ((m = new RegExp(pattern.source, pattern.flags).exec(text)) !== null) {
      tags.add(m[0].trim())
    }
  }

  return Array.from(tags)
}

// ---------------------------------------------------------------------------
// Canonical name helpers
// ---------------------------------------------------------------------------

/**
 * Build canonical_name for a submittal entity.
 * spec_section="03 30 00", idx=1 → "SUB_03_30_00_001"
 */
export function buildSubmittalCanonical(
  specSection: string | null,
  index: number
): string {
  const sectionNorm = specSection
    ? specSection.trim().replace(/\s+/g, '_')
    : 'UNSPECIFIED'
  const idx = String(index).padStart(3, '0')
  return `SUB_${sectionNorm}_${idx}`
}

/**
 * Build canonical_name for a product data entity.
 * manufacturer="Simpson Strong-Tie", tag="HDU8" → "PROD_SIMPSON_STRONG_TIE_HDU8"
 */
export function buildProductDataCanonical(
  manufacturer: string,
  tag: string
): string {
  const mfrNorm = manufacturer.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30)
  const tagNorm = tag.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20)
  return `PROD_${mfrNorm}_${tagNorm}`
}

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

/**
 * Extraction prompt for a single submittal package or product data sheet.
 * Passed to claude-sonnet with the document text.
 */
export const SUBMITTAL_EXTRACTION_PROMPT = `
You are a construction submittal parser. Extract structured data from the submittal document provided.

Output ONLY valid JSON. Do not add commentary outside the JSON object.

JSON structure:
{
  "submittalId": "03-01",
  // submittalId: the submittal number (e.g. "03-01", "16-002")
  "specSection": "03 30 00",
  // specSection: CSI section this submittal covers. Null if not stated.
  "submittalType": "product_data",
  // submittalType: one of: product_data, shop_drawing, material_sample, certificate
  "manufacturer": "Lafarge Holcim",
  // manufacturer: manufacturer name, or null
  "product": "Type I/II Portland Cement",
  // product: product name / model, or null
  "drawingTags": ["LP-1", "D-14"],
  // drawingTags: drawing entity tags this submittal covers. Empty array if none.
  "approvalStatus": "Approved as Noted",
  // approvalStatus: one of: Approved, Approved as Noted, Revise and Resubmit,
  //                 Rejected, Under Review, Pending Review, No Exceptions Taken, null
  "approvalDate": "2026-01-20",
  // approvalDate: ISO date string, or null
  "notes": "Verify with structural engineer before ordering.",
  // notes: any review comments or special notes. Null if none.
  "confidence": 0.88
}

Rules:
- Extract only information explicitly present in the document.
- Do not invent a spec section or approval status if not stated.
- If drawingTags cannot be determined, return an empty array.
- If approval status is ambiguous, return null.
`.trim()

/**
 * Extraction prompt for a submittal log (list of submittals).
 * Returns an array of submittal summaries.
 */
export const SUBMITTAL_LOG_EXTRACTION_PROMPT = `
You are a construction submittal log parser. Extract all submittal entries.

Output ONLY valid JSON as an array:
[
  {
    "submittalId": "03-01",
    "specSection": "03 30 00",
    "description": "Concrete mix design",
    "submittalType": "product_data",
    "approvalStatus": "Approved",
    "approvalDate": "2026-01-15"
  }
]

Include all entries visible in the log. Maximum 200 entries.
`.trim()
