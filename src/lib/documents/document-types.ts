/**
 * Document type taxonomy.
 *
 * The user picks a type at upload time and the pipeline branches on it:
 *   - drawing  → full vision pipeline (callout + crossing + termination + quantity)
 *   - spec     → text-only; spec-extractor will run when wired (A3)
 *   - schedule → text-only; schedule-extractor when built (deferred)
 *   - submittal→ text-only; chunked + embedded for retrieval
 *   - other    → text-only; minimal handling
 *
 * NULL document_type is treated as legacy = vision-eligible so already-uploaded
 * documents don't change behavior. Once A1 is rolled out, all new uploads will
 * carry an explicit type.
 */

export const DOCUMENT_TYPES = [
  'drawing',
  'spec',
  'schedule',
  'submittal',
  'other',
] as const

export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  drawing: 'Drawing',
  spec: 'Specification',
  schedule: 'Schedule',
  submittal: 'Submittal',
  other: 'Other',
}

export const DOCUMENT_TYPE_HELP: Record<DocumentType, string> = {
  drawing: 'Plans, details, redlines. Goes through vision analysis.',
  spec: 'CSI-format specifications, project manuals. Text extraction only.',
  schedule: 'Project schedule (P6, MS Project, Gantt). Text extraction only.',
  submittal: 'Product data, shop drawings, manufacturer cut sheets. Text extraction only.',
  other: 'Anything that does not fit the above. Text extraction only.',
}

const VISION_ELIGIBLE_TYPES = new Set<DocumentType>(['drawing'])

/**
 * Returns true if this document type should go through the vision pipeline.
 *
 * Legacy rows (NULL document_type) are treated as vision-eligible so the
 * behavior of already-uploaded documents does not change when this flag
 * is introduced.
 */
export function isVisionEligible(documentType: string | null | undefined): boolean {
  if (documentType == null || documentType === '') return false
  return VISION_ELIGIBLE_TYPES.has(documentType as DocumentType)
}

export function isValidDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value)
}
