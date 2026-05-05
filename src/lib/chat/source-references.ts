export type SourceReferenceType =
  | 'specification'
  | 'drawing'
  | 'document'
  | 'rfi'
  | 'submittal'
  | 'quantity'
  | 'vision'
  | 'unknown'

export interface SourceReference {
  sourceType?: SourceReferenceType
  documentType?: string
  documentId?: string
  documentTitle?: string
  documentName?: string
  filename?: string
  pageNumber?: number
  chunkId?: string
  chunkIndex?: number
  specSection?: string
  sectionTitle?: string
  partReference?: string
  paragraphReference?: string
  sheetNumber?: string
  detailReference?: string
  extractionSource?: string
}

type SourceLike = Record<string, unknown>

export function normalizeSourceReference(input: SourceLike | null | undefined): SourceReference {
  if (!input) return {}

  const sourceType = normalizeSourceType(
    firstString(input, ['sourceType', 'source_type', 'documentType', 'document_type', 'extraction_source'])
  )

  return removeEmpty({
    sourceType,
    documentType: firstString(input, ['documentType', 'document_type', 'chunk_type', 'sheet_type']),
    documentId: firstString(input, ['documentId', 'document_id']),
    documentTitle: firstString(input, ['documentTitle', 'document_title', 'title']),
    documentName: firstString(input, ['documentName', 'document_name', 'name']),
    filename: firstString(input, ['filename', 'fileName', 'document_filename']),
    pageNumber: firstNumber(input, ['pageNumber', 'page_number', 'page']),
    chunkId: firstString(input, ['chunkId', 'chunk_id']),
    chunkIndex: firstNumber(input, ['chunkIndex', 'chunk_index']),
    specSection: firstString(input, ['specSection', 'spec_section', 'sectionNumber', 'section_number', 'label']),
    sectionTitle: firstString(input, ['sectionTitle', 'section_title', 'displayName', 'display_name']),
    partReference: firstString(input, ['partReference', 'part_reference', 'part']),
    paragraphReference: firstString(input, ['paragraphReference', 'paragraph_reference', 'paragraph']),
    sheetNumber: firstString(input, ['sheetNumber', 'sheet_number']),
    detailReference: firstString(input, ['detailReference', 'detail_ref', 'detail']),
    extractionSource: firstString(input, ['extractionSource', 'extraction_source']),
  })
}

export function formatSourceReference(ref: SourceReference | null | undefined): string {
  if (!ref) return 'Source unavailable'

  const parts: string[] = []
  const documentLabel = ref.documentTitle ?? ref.documentName ?? ref.filename

  if (ref.specSection) {
    parts.push(`Spec ${ref.specSection}`)
  }

  if (ref.sectionTitle && ref.sectionTitle !== ref.specSection) {
    parts.push(ref.sectionTitle)
  }

  if (ref.partReference) {
    parts.push(ref.partReference)
  } else if (ref.paragraphReference) {
    parts.push(ref.paragraphReference)
  }

  if (ref.sheetNumber && !parts.some(part => part.includes(ref.sheetNumber as string))) {
    parts.push(`Sheet ${ref.sheetNumber}`)
  }

  if (ref.detailReference) {
    parts.push(`Detail ${ref.detailReference}`)
  }

  if (ref.pageNumber !== undefined) {
    parts.push(`Page ${ref.pageNumber}`)
  }

  if (documentLabel) {
    parts.push(documentLabel)
  } else if (ref.documentId) {
    parts.push(`Document ${shortId(ref.documentId)}`)
  }

  if (ref.chunkId) {
    parts.push(`Chunk ${shortId(ref.chunkId)}`)
  }

  return parts.length > 0 ? parts.join(' | ') : 'Source unavailable'
}

export function formatSourceReferences(refs: Array<SourceReference | null | undefined>): string {
  const formatted = refs
    .map(formatSourceReference)
    .filter(ref => ref !== 'Source unavailable')

  return Array.from(new Set(formatted)).join('; ')
}

function firstString(input: SourceLike, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function firstNumber(input: SourceLike, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function normalizeSourceType(value: string | undefined): SourceReferenceType | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase()

  if (normalized.includes('spec')) return 'specification'
  if (normalized.includes('drawing') || normalized.includes('plan') || normalized.includes('sheet')) return 'drawing'
  if (normalized.includes('rfi')) return 'rfi'
  if (normalized.includes('submittal')) return 'submittal'
  if (normalized.includes('quantity')) return 'quantity'
  if (normalized.includes('vision')) return 'vision'
  if (normalized.includes('document')) return 'document'

  return 'unknown'
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value
}

function removeEmpty(ref: SourceReference): SourceReference {
  return Object.fromEntries(
    Object.entries(ref).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ) as SourceReference
}
