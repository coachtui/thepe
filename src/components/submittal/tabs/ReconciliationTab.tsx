'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import { getSubmittalItemKey } from '@/lib/chat/submittal-coverage-qa'
import type { NormalizedExternalRow } from '@/lib/reconciliation/submittal-log-normalizer'
import { parseSubmittalLog } from '@/lib/reconciliation/submittal-log-normalizer'
import type { ReconciliationFinding, ReconciliationResult } from '@/lib/reconciliation/submittal-reconciliation'
import { reconcileRegisters, applyMatchDecision } from '@/lib/reconciliation/submittal-reconciliation'

interface ReconciliationTabProps {
  projectId: string
  generatedItems: SubmittalRegisterItem[]
}

// ---------------------------------------------------------------------------
// Match Review Modal
// ---------------------------------------------------------------------------

interface ModalProps {
  finding: ReconciliationFinding
  genItem: SubmittalRegisterItem | null
  extRow: NormalizedExternalRow | null
  onDecision: (findingId: string, decision: 'confirmed' | 'rejected') => void
  onClose: () => void
}

function MatchReviewModal({ finding, genItem, extRow, onDecision, onClose }: ModalProps) {
  const sig = finding.matchSignals

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-start justify-center p-4 pt-16">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-gray-500/60" onClick={onClose} />

        <div className="relative z-10 w-full max-w-4xl bg-white rounded-lg shadow-xl">
          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Review Match</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Confidence: {Math.round(finding.confidence * 100)}% — confirm or reject this candidate match
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer">
              <span className="sr-only">Close</span>
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Side-by-side comparison */}
          <div className="px-6 py-5 grid grid-cols-2 gap-6">
            {/* Generated item */}
            <div className="bg-indigo-50 rounded-md p-4">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-3">Spec Register (Generated)</p>
              {genItem ? (
                <dl className="space-y-2">
                  <div>
                    <dt className="text-xs text-indigo-600">Spec Section</dt>
                    <dd className="text-sm font-medium text-gray-900">{genItem.specSection ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-indigo-600">Title</dt>
                    <dd className="text-sm text-gray-900">{genItem.submittalItem ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-indigo-600">SD Code</dt>
                    <dd className="text-sm text-gray-900">{genItem.sdCode ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-indigo-600">Lifecycle Status</dt>
                    <dd className="text-sm text-gray-900">{genItem.lifecycleStatus ?? 'draft'}</dd>
                  </div>
                  {genItem.lifecycleDueDate && (
                    <div>
                      <dt className="text-xs text-indigo-600">Due Date</dt>
                      <dd className="text-sm text-gray-900">{genItem.lifecycleDueDate}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-indigo-500 italic">Item not found</p>
              )}
            </div>

            {/* External row */}
            <div className="bg-amber-50 rounded-md p-4">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">External Log (Imported)</p>
              {extRow ? (
                <dl className="space-y-2">
                  <div>
                    <dt className="text-xs text-amber-600">Spec Section</dt>
                    <dd className="text-sm font-medium text-gray-900">{extRow.specSection ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-amber-600">Title</dt>
                    <dd className="text-sm text-gray-900">{extRow.title ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-amber-600">SD Code</dt>
                    <dd className="text-sm text-gray-900">{extRow.sdCode ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-amber-600">Status</dt>
                    <dd className="text-sm text-gray-900">{extRow.status ?? '—'}</dd>
                  </div>
                  {extRow.submittalNumber && (
                    <div>
                      <dt className="text-xs text-amber-600">Submittal #</dt>
                      <dd className="text-sm text-gray-900">{extRow.submittalNumber}</dd>
                    </div>
                  )}
                  {extRow.dueDate && (
                    <div>
                      <dt className="text-xs text-amber-600">Due Date</dt>
                      <dd className="text-sm text-gray-900">{extRow.dueDate}</dd>
                    </div>
                  )}
                  {extRow.submittedAt && (
                    <div>
                      <dt className="text-xs text-amber-600">Submitted</dt>
                      <dd className="text-sm text-gray-900">{extRow.submittedAt}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-amber-600">Source Row</dt>
                    <dd className="text-sm text-gray-900">Row {extRow.sourceRowNumber} in {extRow.sourceFileName}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-amber-500 italic">Row not found</p>
              )}
            </div>
          </div>

          {/* Match signals */}
          {sig && (
            <div className="px-6 pb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Match Signals</p>
              <div className="flex flex-wrap gap-2">
                <Signal label="Spec Section" match={sig.specSectionMatch} />
                <Signal label="SD Code" match={sig.sdCodeMatch} />
                <Signal label={`Title Similarity ${Math.round(sig.titleSimilarity * 100)}%`} match={sig.titleSimilarity >= 0.70} />
                {sig.statusMatch !== null && (
                  <Signal label="Status" match={sig.statusMatch} />
                )}
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">
                  Confidence: {Math.round(finding.confidence * 100)}%
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => onDecision(finding.id, 'rejected')}
              className="px-4 py-2 text-sm border border-red-300 rounded-md text-red-700 bg-red-50 hover:bg-red-100 cursor-pointer"
            >
              Reject Match
            </button>
            <button
              onClick={() => onDecision(finding.id, 'confirmed')}
              className="px-4 py-2 text-sm rounded-md text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            >
              Confirm Match
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Signal({ label, match }: { label: string; match: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
      match ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
    }`}>
      {match ? '✓' : '✗'} {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  count,
  color,
  subtext,
}: {
  label: string
  count: number
  color: string
  subtext?: string
}) {
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-sm font-medium mt-0.5">{label}</p>
      {subtext && <p className="text-xs mt-0.5 opacity-70">{subtext}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Finding section
// ---------------------------------------------------------------------------

function FindingSection({
  title,
  findings,
  emptyMsg,
  children,
}: {
  title: string
  findings: ReconciliationFinding[]
  emptyMsg?: string
  children?: (f: ReconciliationFinding) => React.ReactNode
}) {
  if (findings.length === 0 && !emptyMsg) return null

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 mb-2">
        {title}
        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          {findings.length}
        </span>
      </h3>
      {findings.length === 0 ? (
        <p className="text-sm text-gray-400 italic">{emptyMsg}</p>
      ) : (
        <div className="border border-gray-200 rounded-md divide-y divide-gray-100 overflow-hidden">
          {findings.map(f => children ? children(f) : (
            <div key={f.id} className="px-4 py-3 text-sm text-gray-700">
              {f.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export function ReconciliationTab({ projectId, generatedItems }: ReconciliationTabProps) {
  const [externalRows, setExternalRows] = useState<NormalizedExternalRow[] | null>(null)
  const [result, setResult] = useState<ReconciliationResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [reviewFinding, setReviewFinding] = useState<ReconciliationFinding | null>(null)
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Lookup maps for modal resolution
  const genItemByKey = useMemo(() => {
    const map = new Map<string, SubmittalRegisterItem>()
    generatedItems.forEach((item, i) => map.set(getSubmittalItemKey(item, i), item))
    return map
  }, [generatedItems])

  const extRowById = useMemo(() => {
    if (!externalRows) return new Map<string, NormalizedExternalRow>()
    const map = new Map<string, NormalizedExternalRow>()
    externalRows.forEach(r => map.set(r.externalId, r))
    return map
  }, [externalRows])

  const processFile = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase()
    const validExt = ext.endsWith('.xlsx') || ext.endsWith('.xls') || ext.endsWith('.csv')
    if (!validExt) {
      setParseError('Unsupported file type. Please upload an XLSX or CSV file.')
      return
    }

    setParsing(true)
    setParseError(null)
    setExternalRows(null)
    setResult(null)

    try {
      const rows = await parseSubmittalLog(file)
      if (rows.length === 0) {
        setParseError('No data rows found. Check that the first row contains column headers.')
        return
      }
      setExternalRows(rows)
      const reconciled = reconcileRegisters(generatedItems, rows, { sourceFileName: file.name })
      setResult(reconciled)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse the file.')
    } finally {
      setParsing(false)
    }
  }, [generatedItems])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [processFile])

  const handleDecision = useCallback((findingId: string, decision: 'confirmed' | 'rejected') => {
    setResult(prev => prev ? applyMatchDecision(prev, findingId, decision) : prev)
    setReviewFinding(null)
  }, [])

  const handleExport = useCallback(async () => {
    if (!result) return
    setExporting(true)
    try {
      const XLSX = await import('xlsx')
      const buckets: [string, ReconciliationFinding[]][] = [
        ['Matched', result.matched],
        ['Low Confidence', result.lowConfidenceMatches],
        ['Generated Only', result.generatedOnly],
        ['External Only', result.externalOnly],
        ['Status Mismatch', result.statusMismatches],
        ['Metadata Mismatch', result.metadataMismatches],
        ['Possible Duplicate', result.possibleDuplicates],
      ]
      const rows = buckets.flatMap(([bucket, findings]) =>
        findings.map(f => ({
          'Bucket': bucket,
          'Type': f.type,
          'Severity': f.severity,
          'Message': f.message,
          'Confidence': `${Math.round(f.confidence * 100)}%`,
          'Generated Item ID': f.generatedItemId ?? '',
          'External Row ID': f.externalRowId ?? '',
          'Suggested Action': f.suggestedAction,
          'User Confirmed': f.userConfirmed ? 'Yes' : '',
          'User Rejected': f.userRejected ? 'Yes' : '',
        }))
      )
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [
        { wch: 18 }, { wch: 22 }, { wch: 10 }, { wch: 60 }, { wch: 12 },
        { wch: 28 }, { wch: 18 }, { wch: 54 }, { wch: 14 }, { wch: 13 },
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation')
      const date = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `reconciliation-${projectId}-${date}.xlsx`)
    } finally {
      setExporting(false)
    }
  }, [result, projectId])

  // Resolve modal data
  const modalGenItem = reviewFinding?.generatedItemId
    ? (genItemByKey.get(reviewFinding.generatedItemId) ?? null)
    : null
  const modalExtRow = reviewFinding?.externalRowId
    ? (extRowById.get(reviewFinding.externalRowId) ?? null)
    : null

  // ---------------------------------------------------------------------------
  // Render: empty state
  // ---------------------------------------------------------------------------

  if (!externalRows && !parsing) {
    return (
      <div className="space-y-4">
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
            isDragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
          }`}
        >
          <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700">Upload existing submittal log</p>
          <p className="text-xs text-gray-400 mt-1">XLSX or CSV — drag and drop or click to browse</p>
          <p className="text-xs text-gray-400 mt-1">Column names are matched automatically</p>
        </div>

        {parseError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">{parseError}</p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: parsing
  // ---------------------------------------------------------------------------

  if (parsing) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600 mb-3" />
          <p className="text-sm text-gray-500">Parsing and reconciling…</p>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: results
  // ---------------------------------------------------------------------------

  if (!result || !externalRows) return null

  const totalFindings =
    result.lowConfidenceMatches.length +
    result.generatedOnly.length +
    result.externalOnly.length +
    result.statusMismatches.length

  return (
    <div className="space-y-6">
      {/* Session notice + controls */}
      <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-amber-800">
            {externalRows.length} rows imported from <span className="font-semibold">{result.sourceFileName}</span>
          </p>
          <p className="text-xs text-amber-600 mt-0.5">
            Imported for this review session only. Data is not saved — re-upload to restore after a page refresh.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs border border-amber-300 rounded-md text-amber-700 bg-white hover:bg-amber-50 cursor-pointer whitespace-nowrap"
          >
            Replace file
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {exporting ? 'Exporting…' : 'Export results'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label="Matched"
          count={result.matched.length}
          color="border-green-200 bg-green-50 text-green-800"
        />
        <SummaryCard
          label="Low Confidence"
          count={result.lowConfidenceMatches.length}
          color="border-yellow-200 bg-yellow-50 text-yellow-800"
          subtext="needs review"
        />
        <SummaryCard
          label="In Spec Only"
          count={result.generatedOnly.length}
          color="border-indigo-200 bg-indigo-50 text-indigo-800"
          subtext="not in log"
        />
        <SummaryCard
          label="In Log Only"
          count={result.externalOnly.length}
          color="border-orange-200 bg-orange-50 text-orange-800"
          subtext="not in spec"
        />
        <SummaryCard
          label="Status Mismatch"
          count={result.statusMismatches.length}
          color="border-red-200 bg-red-50 text-red-800"
        />
        <SummaryCard
          label="Possible Dupes"
          count={result.possibleDuplicates.length}
          color="border-gray-200 bg-gray-50 text-gray-700"
          subtext="in log"
        />
      </div>

      {totalFindings === 0 && result.matched.length > 0 && (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3">
          <p className="text-sm text-green-700 font-medium">All items matched — no findings require review.</p>
        </div>
      )}

      {/* Low confidence matches — most important */}
      <FindingSection
        title="Low Confidence Matches — Needs Review"
        findings={result.lowConfidenceMatches}
      >
        {(f) => (
          <div key={f.id} className="px-4 py-3 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-800">{f.message}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {f.matchSignals && (
                  <>
                    {f.matchSignals.specSectionMatch && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">✓ Section</span>
                    )}
                    {f.matchSignals.sdCodeMatch && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">✓ SD Code</span>
                    )}
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${
                      f.matchSignals.titleSimilarity >= 0.70
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {Math.round(f.matchSignals.titleSimilarity * 100)}% title match
                    </span>
                  </>
                )}
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                  {Math.round(f.confidence * 100)}% confidence
                </span>
              </div>
            </div>
            <button
              onClick={() => setReviewFinding(f)}
              className="shrink-0 px-3 py-1.5 text-xs border border-indigo-300 rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 cursor-pointer"
            >
              Review
            </button>
          </div>
        )}
      </FindingSection>

      {/* Status mismatches */}
      <FindingSection title="Status Mismatches" findings={result.statusMismatches}>
        {(f) => (
          <div key={f.id} className="px-4 py-3">
            <p className="text-sm text-gray-800">{f.message}</p>
            <p className="text-xs text-gray-500 mt-0.5">{f.suggestedAction}</p>
          </div>
        )}
      </FindingSection>

      {/* External only */}
      <FindingSection title="In External Log — No Spec Match" findings={result.externalOnly}>
        {(f) => {
          const row = extRowById.get(f.externalRowId ?? '')
          return (
            <div key={f.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="text-xs text-gray-400 whitespace-nowrap mt-0.5">
                  Row {row?.sourceRowNumber ?? '—'}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-gray-800">{row?.title ?? '(no title)'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[row?.specSection, row?.sdCode, row?.status].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
            </div>
          )
        }}
      </FindingSection>

      {/* Generated only */}
      <FindingSection title="In Spec Register — Not Found in Log" findings={result.generatedOnly}>
        {(f) => {
          const genItem = f.generatedItemId ? genItemByKey.get(f.generatedItemId) : undefined
          return (
            <div key={f.id} className="px-4 py-3">
              <p className="text-sm text-gray-800">{genItem?.submittalItem ?? f.message}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {[genItem?.specSection, genItem?.sdCode].filter(Boolean).join(' · ')}
                {f.userRejected && <span className="ml-2 text-amber-600">rejected match</span>}
              </p>
            </div>
          )
        }}
      </FindingSection>

      {/* Possible duplicates in log */}
      <FindingSection title="Possible Duplicates in External Log" findings={result.possibleDuplicates}>
        {(f) => (
          <div key={f.id} className="px-4 py-3">
            <p className="text-sm text-gray-800">{f.message}</p>
            <p className="text-xs text-gray-500 mt-0.5">{f.suggestedAction}</p>
          </div>
        )}
      </FindingSection>

      {/* Metadata mismatches */}
      <FindingSection title="Metadata Differences" findings={result.metadataMismatches}>
        {(f) => (
          <div key={f.id} className="px-4 py-3">
            <p className="text-sm text-gray-800">{f.message}</p>
            <p className="text-xs text-gray-500 mt-0.5">{f.suggestedAction}</p>
          </div>
        )}
      </FindingSection>

      {/* Matched — collapsed summary */}
      {result.matched.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            Matched
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
              {result.matched.length}
            </span>
          </h3>
          <p className="text-xs text-gray-400">
            {result.matched.filter(f => f.userConfirmed).length} user-confirmed,{' '}
            {result.matched.filter(f => !f.userConfirmed).length} auto-matched.
          </p>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Match review modal */}
      {reviewFinding && (
        <MatchReviewModal
          finding={reviewFinding}
          genItem={modalGenItem}
          extRow={modalExtRow}
          onDecision={handleDecision}
          onClose={() => setReviewFinding(null)}
        />
      )}
    </div>
  )
}
