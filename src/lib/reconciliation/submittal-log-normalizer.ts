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

// ---------------------------------------------------------------------------
// NAVFAC DD-form submittal register format
// Merged-cell headers produce mostly __EMPTY_N keys. This format uses
// positional column mapping instead of header name resolution.
// ---------------------------------------------------------------------------

function isNavfacFormat(firstRowKeys: string[]): boolean {
  if (firstRowKeys[0]?.includes('SUBMITTAL REGISTER')) return true
  const emptyCount = firstRowKeys.filter(k => k.startsWith('__EMPTY')).length
  return emptyCount / firstRowKeys.length > 0.6
}

const NAVFAC_STATUS_MAP: Record<string, string> = {
  '1': 'draft',
  '2': 'pending_review',
  '3': 'revise_resubmit',
  '4': 'pending_review',
  '5': 'pending_submission',
  '6': 'submitted',
  '7': 'pending_review',
  'c': 'approved',
}

function parseNavfacFormat(
  rawArrays: (string | null)[][],
  fileName: string
): NormalizedExternalRow[] {
  // Column positions (0-indexed) from the NAVFAC DD-form layout:
  // col 2 = Spec Section, col 3 = Item No, col 4 = SD Code (group headers only),
  // col 5 = Description, col 8 = Planned Submit, col 9 = Approval Needed By,
  // col 12 = Contractor Action Date, col 20 = Status
  const COL_SPEC = 2
  const COL_ITEM = 3
  const COL_SD = 4
  const COL_DESC = 5
  const COL_PLANNED_SUBMIT = 8
  const COL_APPROVAL_BY = 9
  const COL_ACTION_DATE = 12
  const COL_STATUS = 20

  const results: NormalizedExternalRow[] = []
  let currentSdCode: string | null = null
  let idx = 0

  for (let i = 0; i < rawArrays.length; i++) {
    const row = rawArrays[i]
    if (!row || row.every(v => !v)) continue

    const specRaw = row[COL_SPEC]
    const sdRaw = row[COL_SD]
    const descRaw = row[COL_DESC]

    // Group header row: col 4 has SD code (e.g. "SD-01")
    if (sdRaw && /^SD-\d+/i.test(String(sdRaw))) {
      const m = String(sdRaw).match(/^(SD-\d+)/i)
      if (m) currentSdCode = m[1].toUpperCase()
      continue
    }

    // Item row: must have a spec section and description
    if (!specRaw || !descRaw) continue
    if (!/^\d{2}\s?\d{2}\s?\d{2}/.test(String(specRaw))) continue

    const title = String(descRaw).trim()
    const actionDate = row[COL_ACTION_DATE] ? String(row[COL_ACTION_DATE]).trim() : null
    const statusRaw = row[COL_STATUS] ? String(row[COL_STATUS]).trim().toLowerCase() : null
    const status = statusRaw ? (NAVFAC_STATUS_MAP[statusRaw] ?? statusRaw) : null

    results.push({
      externalId: `navfac-${idx++}`,
      specSection: String(specRaw).replace(/\s+/g, ' ').trim(),
      submittalNumber: row[COL_ITEM] ? String(row[COL_ITEM]).trim() : null,
      title,
      description: null,
      sdCode: currentSdCode,
      status,
      submittedAt: actionDate ?? (row[COL_PLANNED_SUBMIT] ? String(row[COL_PLANNED_SUBMIT]).trim() : null),
      returnedAt: null,
      approvedAt: status === 'approved' ? actionDate : null,
      dueDate: row[COL_APPROVAL_BY] ? String(row[COL_APPROVAL_BY]).trim() : null,
      responsibleParty: null,
      reviewer: null,
      remarks: null,
      normalizedTitle: buildNormalizedTitle(title),
      sourceRowNumber: i + 1,
      sourceFileName: fileName,
    })
  }

  return results
}

// Parses an XLSX or CSV File into normalized rows. Client-side only (uses File API + xlsx).
export async function parseSubmittalLog(file: File): Promise<NormalizedExternalRow[]> {
  const XLSX = await import('xlsx')
  const ab = await file.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(ab), { type: 'array', raw: false, cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []

  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: false,
  })
  if (jsonRows.length === 0) return []

  const headers = Object.keys(jsonRows[0])

  // NAVFAC DD-form: merged cells produce mostly __EMPTY_N header keys
  if (isNavfacFormat(headers)) {
    const rawArrays = XLSX.utils.sheet_to_json<(string | null)[]>(ws, {
      header: 1, defval: null, raw: false,
    })
    return parseNavfacFormat(rawArrays as (string | null)[][], file.name)
  }

  const headerMap = normalizeHeaders(headers)
  return normalizeRows(jsonRows, headerMap, file.name)
}
