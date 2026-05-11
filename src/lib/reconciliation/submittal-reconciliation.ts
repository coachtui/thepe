import type { SubmittalRegisterItem } from '../chat/submittal-register'
import { getSubmittalItemKey } from '../chat/submittal-coverage-qa.ts'
import type { NormalizedExternalRow } from './submittal-log-normalizer'

export type ReconciliationFindingType =
  | 'matched'
  | 'generated_only'
  | 'external_only'
  | 'status_mismatch'
  | 'metadata_mismatch'
  | 'possible_duplicate'
  | 'low_confidence_match'

export type ReconciliationSeverity = 'info' | 'warning' | 'critical'

export interface MatchSignals {
  specSectionMatch: boolean
  sdCodeMatch: boolean
  titleSimilarity: number        // 0–1 Jaccard
  submittalNumberMatch: boolean
  statusMatch: boolean | null    // null if either status is unknown
}

export interface ReconciliationFinding {
  id: string
  type: ReconciliationFindingType
  severity: ReconciliationSeverity
  generatedItemId: string | null
  externalRowId: string | null
  message: string
  confidence: number
  suggestedAction: string
  matchSignals?: MatchSignals
  userConfirmed?: boolean
  userRejected?: boolean
}

export interface ReconciliationResult {
  matched: ReconciliationFinding[]
  generatedOnly: ReconciliationFinding[]
  externalOnly: ReconciliationFinding[]
  statusMismatches: ReconciliationFinding[]
  metadataMismatches: ReconciliationFinding[]
  possibleDuplicates: ReconciliationFinding[]
  lowConfidenceMatches: ReconciliationFinding[]
  checkedAt: string
  sourceFileName: string
  totalGeneratedItems: number
  totalExternalRows: number
}

// ---------------------------------------------------------------------------
// Similarity helpers
// ---------------------------------------------------------------------------

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  return intersection / (a.size + b.size - intersection)
}

function normalizeSpecSection(s: string | null | undefined): string {
  if (!s) return ''
  // Strip non-digits, cap at 6 (drops sub-section suffixes), left-pad (fixes missing leading zeros)
  return s.replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0')
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, string> = {
  'approved': 'approved',
  'approved as noted': 'approved_as_noted',
  'approved-as-noted': 'approved_as_noted',
  'a n': 'approved_as_noted',
  'an': 'approved_as_noted',
  'revise and resubmit': 'revise_resubmit',
  'revise resubmit': 'revise_resubmit',
  'r r': 'revise_resubmit',
  'rejected': 'rejected',
  'denied': 'rejected',
  'submitted': 'submitted',
  'submitted for review': 'submitted',
  'pending': 'pending_review',
  'pending review': 'pending_review',
  'under review': 'pending_review',
  'in review': 'pending_review',
  'review': 'pending_review',
  'not submitted': 'draft',
  'not started': 'draft',
  'open': 'draft',
  'draft': 'draft',
  'void': 'closed',
  'closed': 'closed',
  'withdrawn': 'closed',
}

export function normalizeExternalStatus(status: string | null): string | null {
  if (!status) return null
  const key = status.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return STATUS_MAP[key] ?? null
}

// ---------------------------------------------------------------------------
// Per-pair match computation
// ---------------------------------------------------------------------------

function getExtTokens(row: NormalizedExternalRow): Set<string> {
  if (row.normalizedTitle) return new Set(row.normalizedTitle.split(' ').filter(Boolean))
  return tokenize(row.title ?? '')
}

interface MatchResult {
  confidence: number
  signals: MatchSignals
}

function computeMatch(
  genSection: string | null,
  genSdCode: string | null,
  genStatus: string | null,
  genTitleTokens: Set<string>,
  row: NormalizedExternalRow,
  extTitleTokens: Set<string>
): MatchResult {
  const specSectionMatch =
    !!genSection && !!row.specSection &&
    normalizeSpecSection(genSection) === normalizeSpecSection(row.specSection)

  const sdCodeMatch =
    !!genSdCode && !!row.sdCode &&
    genSdCode.toLowerCase().trim() === row.sdCode.toLowerCase().trim()

  const titleSim = jaccard(genTitleTokens, extTitleTokens)

  const extStatus = normalizeExternalStatus(row.status)
  const statusMatch = extStatus === null || genStatus === null
    ? null
    : extStatus === genStatus

  const signals: MatchSignals = {
    specSectionMatch,
    sdCodeMatch,
    titleSimilarity: titleSim,
    submittalNumberMatch: false, // generated items don't carry submittalNumber yet
    statusMatch,
  }

  // Priority 1: exact (section + SD code + title ≥ 0.85)
  if (specSectionMatch && sdCodeMatch && titleSim >= 0.85) {
    return { confidence: 1.0, signals }
  }

  // Priority 2: submittalNumber — dormant until generated items have submittalNumber field.
  // When wired: submittalNumber matches + corroboration → 0.90–0.95.

  // Priority 3: section + fuzzy title (≥ 0.70 → scale 0.75–0.90)
  if (specSectionMatch && titleSim >= 0.70) {
    const confidence = 0.75 + ((titleSim - 0.70) / 0.30) * 0.15
    return { confidence, signals }
  }

  // Section matches but title only 0.60–0.69 → low confidence (0.60–0.70)
  if (specSectionMatch && titleSim >= 0.60) {
    const confidence = 0.60 + ((titleSim - 0.60) / 0.10) * 0.10
    return { confidence, signals }
  }

  // Priority 4: title-only (≥ 0.65, no section match → scale 0.50–0.74)
  if (!specSectionMatch && titleSim >= 0.65) {
    const confidence = 0.50 + ((titleSim - 0.65) / 0.35) * 0.24
    return { confidence, signals }
  }

  return { confidence: 0, signals }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function reconcileRegisters(
  generated: SubmittalRegisterItem[],
  external: NormalizedExternalRow[],
  options?: { sourceFileName?: string }
): ReconciliationResult {
  const sourceFileName = options?.sourceFileName ?? 'unknown'

  const genKeys = generated.map((item, i) => getSubmittalItemKey(item, i))
  const genTitleTokens = generated.map(item => tokenize(item.submittalItem ?? ''))
  const extTitleTokens = external.map(row => getExtTokens(row))

  // Build ID→index lookups for O(1) access later
  const genKeyToIdx = new Map<string, number>(genKeys.map((k, i) => [k, i]))
  const extIdToIdx = new Map<string, number>(external.map((r, i) => [r.externalId, i]))

  // Compute all candidate pairs with confidence ≥ 0.50
  type Candidate = { gi: number; ei: number; confidence: number; signals: MatchSignals }
  const candidates: Candidate[] = []

  for (let gi = 0; gi < generated.length; gi++) {
    const item = generated[gi]
    for (let ei = 0; ei < external.length; ei++) {
      const { confidence, signals } = computeMatch(
        item.specSection,
        item.sdCode ?? null,
        item.lifecycleStatus ?? null,
        genTitleTokens[gi],
        external[ei],
        extTitleTokens[ei]
      )
      if (confidence >= 0.50) candidates.push({ gi, ei, confidence, signals })
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence)

  // Greedy one-to-one assignment
  const usedGen = new Set<number>()
  const usedExt = new Set<number>()
  const matched: ReconciliationFinding[] = []
  const lowConfidenceMatches: ReconciliationFinding[] = []

  for (const c of candidates) {
    if (usedGen.has(c.gi) || usedExt.has(c.ei)) continue
    usedGen.add(c.gi)
    usedExt.add(c.ei)

    const genItem = generated[c.gi]
    const extRow = external[c.ei]
    const genKey = genKeys[c.gi]

    if (c.confidence >= 0.75) {
      matched.push({
        id: `match-${c.gi}-${c.ei}`,
        type: 'matched',
        severity: 'info',
        generatedItemId: genKey,
        externalRowId: extRow.externalId,
        message: `"${genItem.submittalItem ?? 'Item'}" matched to external row ${extRow.sourceRowNumber}`,
        confidence: c.confidence,
        suggestedAction: 'Verify the match is correct.',
        matchSignals: c.signals,
      })
    } else {
      lowConfidenceMatches.push({
        id: `lc-${c.gi}-${c.ei}`,
        type: 'low_confidence_match',
        severity: 'warning',
        generatedItemId: genKey,
        externalRowId: extRow.externalId,
        message: `Possible match: "${genItem.submittalItem ?? 'Item'}" ↔ "${extRow.title ?? '(no title)'}" (${Math.round(c.confidence * 100)}% confidence)`,
        confidence: c.confidence,
        suggestedAction: 'Review this match and confirm or reject.',
        matchSignals: c.signals,
      })
    }
  }

  // Unmatched generated items
  const generatedOnly: ReconciliationFinding[] = []
  for (let gi = 0; gi < generated.length; gi++) {
    if (usedGen.has(gi)) continue
    const item = generated[gi]
    generatedOnly.push({
      id: `gen-only-${gi}`,
      type: 'generated_only',
      severity: 'info',
      generatedItemId: genKeys[gi],
      externalRowId: null,
      message: `"${item.submittalItem ?? 'Item'}" (${item.specSection ?? 'no section'}) is in the spec register but not found in the external log`,
      confidence: 1,
      suggestedAction: 'Check if this submittal exists in the contractor log under a different name or number.',
    })
  }

  // Unmatched external rows
  const externalOnly: ReconciliationFinding[] = []
  for (let ei = 0; ei < external.length; ei++) {
    if (usedExt.has(ei)) continue
    const row = external[ei]
    externalOnly.push({
      id: `ext-only-${ei}`,
      type: 'external_only',
      severity: 'warning',
      generatedItemId: null,
      externalRowId: row.externalId,
      message: `External log row ${row.sourceRowNumber}: "${row.title ?? '(no title)'}" has no match in the spec register`,
      confidence: 1,
      suggestedAction: 'Check if this submittal should be added to the spec-derived register.',
    })
  }

  // Status mismatches for high-confidence matched pairs
  const statusMismatches: ReconciliationFinding[] = []
  for (const m of matched) {
    if (!m.externalRowId || !m.generatedItemId) continue
    const gi = genKeyToIdx.get(m.generatedItemId) ?? -1
    const ei = m.externalRowId ? extIdToIdx.get(m.externalRowId) ?? -1 : -1
    if (gi === -1 || ei === -1) continue

    const extRow = external[ei]
    if (!extRow.status) continue

    const genItem = generated[gi]
    const genStatus = genItem.lifecycleStatus ?? 'draft'
    const extStatus = normalizeExternalStatus(extRow.status)

    if (extStatus && genStatus !== extStatus) {
      statusMismatches.push({
        id: `status-${m.id}`,
        type: 'status_mismatch',
        severity: 'warning',
        generatedItemId: m.generatedItemId,
        externalRowId: m.externalRowId,
        message: `Status differs: register shows "${genStatus}", external log shows "${extRow.status}"`,
        confidence: m.confidence,
        suggestedAction: 'Verify which status is current and update the register or the external log.',
        matchSignals: m.matchSignals,
      })
    }
  }

  // Metadata mismatches: due date present in external but absent in generated
  const metadataMismatches: ReconciliationFinding[] = []
  for (const m of matched) {
    if (!m.externalRowId || !m.generatedItemId) continue
    const gi = genKeyToIdx.get(m.generatedItemId) ?? -1
    const ei = m.externalRowId ? extIdToIdx.get(m.externalRowId) ?? -1 : -1
    if (gi === -1 || ei === -1) continue

    const genItem = generated[gi]
    const extRow = external[ei]

    if (extRow.dueDate && !genItem.lifecycleDueDate) {
      metadataMismatches.push({
        id: `meta-duedate-${m.id}`,
        type: 'metadata_mismatch',
        severity: 'info',
        generatedItemId: m.generatedItemId,
        externalRowId: m.externalRowId,
        message: `External log has due date "${extRow.dueDate}" but the register has none`,
        confidence: m.confidence,
        suggestedAction: 'Consider adding the due date from the external log to the register.',
        matchSignals: m.matchSignals,
      })
    }
  }

  // Possible duplicates within the external log (same section, high title similarity)
  const possibleDuplicates: ReconciliationFinding[] = []
  const dupChecked = new Set<string>()
  for (let i = 0; i < external.length; i++) {
    for (let j = i + 1; j < external.length; j++) {
      const a = external[i]
      const b = external[j]
      const secA = normalizeSpecSection(a.specSection)
      const secB = normalizeSpecSection(b.specSection)
      if (!secA || secA !== secB) continue

      const sim = jaccard(extTitleTokens[i], extTitleTokens[j])
      if (sim >= 0.85) {
        const dupKey = `${i}-${j}`
        if (!dupChecked.has(dupKey)) {
          dupChecked.add(dupKey)
          possibleDuplicates.push({
            id: `dup-${dupKey}`,
            type: 'possible_duplicate',
            severity: 'warning',
            generatedItemId: null,
            externalRowId: a.externalId,
            message: `External log rows ${a.sourceRowNumber} and ${b.sourceRowNumber} appear to be duplicates in section ${a.specSection}`,
            confidence: sim,
            suggestedAction: 'Review the imported log for duplicate entries.',
          })
        }
      }
    }
  }

  return {
    matched,
    generatedOnly,
    externalOnly,
    statusMismatches,
    metadataMismatches,
    possibleDuplicates,
    lowConfidenceMatches,
    checkedAt: new Date().toISOString(),
    sourceFileName,
    totalGeneratedItems: generated.length,
    totalExternalRows: external.length,
  }
}

// Returns a new ReconciliationResult with the decision applied. Does not mutate.
export function applyMatchDecision(
  result: ReconciliationResult,
  findingId: string,
  decision: 'confirmed' | 'rejected'
): ReconciliationResult {
  const finding = result.lowConfidenceMatches.find(f => f.id === findingId)
  if (!finding) return result

  const newLow = result.lowConfidenceMatches.filter(f => f.id !== findingId)

  if (decision === 'confirmed') {
    return {
      ...result,
      lowConfidenceMatches: newLow,
      matched: [...result.matched, { ...finding, type: 'matched', userConfirmed: true }],
    }
  }

  // Rejected: return both sides to unmatched pools
  const newGeneratedOnly: ReconciliationFinding[] = finding.generatedItemId
    ? [{
        id: `gen-only-rej-${finding.id}`,
        type: 'generated_only',
        severity: 'info',
        generatedItemId: finding.generatedItemId,
        externalRowId: null,
        message: `Rejected match — "${finding.message.split('"')[1] ?? 'item'}" has no confirmed entry in the external log`,
        confidence: 1,
        suggestedAction: 'Manually verify this submittal exists in the external log.',
        userRejected: true,
      }]
    : []

  const newExternalOnly: ReconciliationFinding[] = finding.externalRowId
    ? [{
        id: `ext-only-rej-${finding.id}`,
        type: 'external_only',
        severity: 'warning',
        generatedItemId: null,
        externalRowId: finding.externalRowId,
        message: `Rejected match — external row has no confirmed entry in the spec register`,
        confidence: 1,
        suggestedAction: 'Check if this external log entry corresponds to a different spec register item.',
        userRejected: true,
      }]
    : []

  return {
    ...result,
    lowConfidenceMatches: newLow,
    generatedOnly: [...result.generatedOnly, ...newGeneratedOnly],
    externalOnly: [...result.externalOnly, ...newExternalOnly],
  }
}
