export interface NormalizedExternalRow {
  externalId: string
  specSection: string | null
  submittalNumber: string | null
  title: string | null
  description: string | null
  sdCode: string | null
  status: string | null
  submittedAt: string | null
  returnedAt: string | null
  approvedAt: string | null
  dueDate: string | null
  responsibleParty: string | null
  reviewer: string | null
  remarks: string | null
  normalizedTitle?: string
  sourceRowNumber: number
  sourceFileName: string
  rawRow?: Record<string, unknown>
}

type CanonicalField =
  | 'specSection' | 'submittalNumber' | 'title' | 'description'
  | 'sdCode' | 'status' | 'submittedAt' | 'returnedAt' | 'approvedAt'
  | 'dueDate' | 'responsibleParty' | 'reviewer' | 'remarks'

const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  specSection: [
    'spec section', 'spec', 'section', 'section number', 'section no',
    'csi section', 'section id', 'spec no', 'specification section',
    'division', 'spec #', 'csi #', 'section #',
  ],
  submittalNumber: [
    'submittal number', 'sub no', 'sub #', 'item no', 'item number',
    'submittal no', 'sub number', 'number', 'no', 'item', 'sub id',
    'submittal #', 'item #', 'subm no', 'subm #',
  ],
  title: [
    'title', 'description', 'submittal title', 'submittal description', 'item description',
    'submittal item', 'name', 'subject', 'submittal name',
  ],
  description: [
    'detailed description', 'detail', 'long description', 'full description',
  ],
  sdCode: [
    'sd code', 'sd type', 'type', 'submittal type', 'sd', 'code',
    'sd #', 'sd no', 'sd-code', 'submittal code', 'sd number',
  ],
  status: [
    'status', 'current status', 'approval status', 'review status',
    'disposition', 'action', 'final status',
  ],
  submittedAt: [
    'date submitted', 'submitted', 'submit date', 'date of submittal',
    'submission date', 'submitted date', 'date sent', 'date sub',
  ],
  returnedAt: [
    'date returned', 'returned', 'return date', 'date returned to contractor',
    'returned date', 'date rcvd', 'date received back',
  ],
  approvedAt: [
    'date approved', 'approved', 'approval date', 'date of approval',
    'approved date',
  ],
  dueDate: [
    'due date', 'required by', 'need by', 'need-by date', 'required date',
    'deadline', 'required by date', 'due', 'need by date', 'date required',
    'date needed',
  ],
  responsibleParty: [
    'responsible party', 'contractor', 'gc', 'subcontractor',
    'responsible contractor', 'submitted by', 'responsible',
    'prime contractor', 'prime', 'vendor', 'supplier',
  ],
  reviewer: [
    'reviewer', 'approver', 'review by', 'cor', 'reviewing party',
    'reviewed by', 'approval by', 'approving authority',
    'contracting officer',
  ],
  remarks: [
    'remarks', 'comments', 'notes', 'comment', 'remark', 'note',
    'remarks comments', 'general notes', 'additional notes',
  ],
}

function normalizeHeaderKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Build reverse alias lookup at module load time
const ALIAS_LOOKUP: Map<string, CanonicalField> = (() => {
  const map = new Map<string, CanonicalField>()
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [CanonicalField, string[]][]) {
    for (const alias of aliases) {
      map.set(alias, field)
    }
  }
  return map
})()

// Maps each raw header string to its canonical field name, or itself if unrecognized.
export function normalizeHeaders(rawHeaders: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const raw of rawHeaders) {
    const key = normalizeHeaderKey(raw)
    result[raw] = ALIAS_LOOKUP.get(key) ?? raw
  }
  return result
}

function coerceString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const s = String(value).trim()
  return s || null
}

function buildNormalizedTitle(title: string | null): string | undefined {
  if (!title) return undefined
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return [...new Set(tokens)].join(' ')
}

// Converts raw XLSX/CSV rows (already header-resolved) to normalized rows.
// Exported for harness testing without requiring a File object.
export function normalizeRows(
  rawRows: Record<string, unknown>[],
  headerMap: Record<string, string>,
  fileName: string
): NormalizedExternalRow[] {
  return rawRows.map((row, index) => {
    const mapped: Record<string, unknown> = {}
    for (const [rawHeader, canonical] of Object.entries(headerMap)) {
      const v = row[rawHeader]
      if (v !== undefined && v !== null && v !== '') {
        mapped[canonical] = v
      }
    }

    const title = coerceString(mapped['title'])

    return {
      externalId: `ext-${index}`,
      specSection: coerceString(mapped['specSection']),
      submittalNumber: coerceString(mapped['submittalNumber']),
      title,
      description: coerceString(mapped['description']),
      sdCode: coerceString(mapped['sdCode']),
      status: coerceString(mapped['status']),
      submittedAt: coerceString(mapped['submittedAt']),
      returnedAt: coerceString(mapped['returnedAt']),
      approvedAt: coerceString(mapped['approvedAt']),
      dueDate: coerceString(mapped['dueDate']),
      responsibleParty: coerceString(mapped['responsibleParty']),
      reviewer: coerceString(mapped['reviewer']),
      remarks: coerceString(mapped['remarks']),
      normalizedTitle: buildNormalizedTitle(title),
      sourceRowNumber: index + 2, // 1-based index, header row is row 1
      sourceFileName: fileName,
      rawRow: row,
    }
  })
}

// Parses an XLSX or CSV File into normalized rows. Client-side only (uses File API + xlsx).
export async function parseSubmittalLog(file: File): Promise<NormalizedExternalRow[]> {
  const XLSX = await import('xlsx')
  const ab = await file.arrayBuffer()
  const wb = XLSX.read(ab, { type: 'array', raw: false, cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: false,
  })
  if (rawRows.length === 0) return []

  const headers = Object.keys(rawRows[0])
  const headerMap = normalizeHeaders(headers)

  return normalizeRows(rawRows, headerMap, file.name)
}
