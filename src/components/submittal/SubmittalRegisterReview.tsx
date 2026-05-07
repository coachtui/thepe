'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  LatestSubmittalRegisterRun,
  SubmittalRegisterGroup,
  SubmittalRegisterItem,
} from '@/lib/chat/submittal-register'

interface SubmittalRegisterReviewProps {
  projectId: string
}

const REVIEW_STATUSES = [
  'pending',
  'approved',
  'approved_as_noted',
  'rejected',
  'needs_clarification',
  'superseded',
] as const

type ReviewStatus = (typeof REVIEW_STATUSES)[number]

const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  approved_as_noted: 'Approved as noted',
  rejected: 'Rejected',
  needs_clarification: 'Needs clarification',
  superseded: 'Superseded',
}

const STATUS_PILL_CLASSES: Record<ReviewStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  approved: 'bg-green-100 text-green-800',
  approved_as_noted: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  needs_clarification: 'bg-yellow-100 text-yellow-800',
  superseded: 'bg-gray-200 text-gray-700',
}

const SOURCE_QUALITY_PILL: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-green-50 text-green-700 border border-green-200',
  medium: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  low: 'bg-red-50 text-red-700 border border-red-200',
}

interface DraftState {
  status: ReviewStatus
  notes: string
}

interface RowSaveState {
  saving: boolean
  error: string | null
}

export function SubmittalRegisterReview({ projectId }: SubmittalRegisterReviewProps) {
  const [data, setData] = useState<LatestSubmittalRegisterRun | null>(null)
  const [found, setFound] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})
  const [rowSave, setRowSave] = useState<Record<string, RowSaveState>>({})

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await fetch(`/api/projects/${projectId}/submittal-register/latest`, {
          credentials: 'include',
        })
        const body = await res.json()
        if (!res.ok || !body.success) {
          throw new Error(body?.error ?? `Request failed (${res.status})`)
        }
        setFound(Boolean(body.found))
        setData(body.found ? (body.run as LatestSubmittalRegisterRun) : null)
        setDrafts({})
        setRowSave({})
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load submittal register')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [projectId]
  )

  useEffect(() => {
    load('initial')
  }, [load])

  const orderedSections = useMemo(() => {
    if (!data) return []
    return data.groupedSections
  }, [data])

  const handleSetDraftStatus = (itemId: string, currentStatus: ReviewStatus, currentNotes: string, status: ReviewStatus) => {
    setDrafts(prev => ({
      ...prev,
      [itemId]: { status, notes: prev[itemId]?.notes ?? currentNotes },
    }))
    if (rowSave[itemId]?.error) {
      setRowSave(prev => ({ ...prev, [itemId]: { saving: false, error: null } }))
    }
    void currentStatus
  }

  const handleSetDraftNotes = (itemId: string, currentStatus: ReviewStatus, currentNotes: string, notes: string) => {
    setDrafts(prev => ({
      ...prev,
      [itemId]: { status: prev[itemId]?.status ?? currentStatus, notes },
    }))
    if (rowSave[itemId]?.error) {
      setRowSave(prev => ({ ...prev, [itemId]: { saving: false, error: null } }))
    }
    void currentNotes
  }

  const handleSave = async (itemId: string, currentStatus: ReviewStatus, currentNotes: string) => {
    const draft = drafts[itemId] ?? { status: currentStatus, notes: currentNotes }
    setRowSave(prev => ({ ...prev, [itemId]: { saving: true, error: null } }))
    try {
      const res = await fetch(`/api/projects/${projectId}/submittal-register/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          item_id: itemId,
          review_status: draft.status,
          review_notes: draft.notes.trim().length > 0 ? draft.notes : null,
        }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      const updated = body.item as {
        reviewStatus: string
        reviewNotes: string | null
        reviewedAt: string | null
        reviewedByRole: string | null
      }
      setData(prev => prev ? patchItemInRun(prev, itemId, updated) : prev)
      setDrafts(prev => {
        const next = { ...prev }
        delete next[itemId]
        return next
      })
      setRowSave(prev => ({ ...prev, [itemId]: { saving: false, error: null } }))
    } catch (err) {
      setRowSave(prev => ({
        ...prev,
        [itemId]: { saving: false, error: err instanceof Error ? err.message : 'Save failed' },
      }))
    }
  }

  const handleResetDraft = (itemId: string) => {
    setDrafts(prev => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
    setRowSave(prev => ({ ...prev, [itemId]: { saving: false, error: null } }))
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-2">Submittal Register Review</h3>
        <p className="text-sm text-gray-500">Loading latest submittal register…</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Submittal Register Review</h3>
          <p className="text-sm text-gray-500 mt-1">
            Review the latest persisted submittal register run for this project. Updates are saved per item.
          </p>
        </div>
        <button
          onClick={() => load('refresh')}
          disabled={refreshing}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {found === false && !error && (
        <div className="rounded-md bg-gray-50 border border-gray-200 p-4">
          <p className="text-sm text-gray-700">
            No submittal register run exists for this project yet.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Ask the assistant to <span className="font-mono">build a submittal register</span> for this project. Once it completes, it will appear here.
          </p>
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-md bg-gray-50 border border-gray-200 p-4">
          <p className="text-sm text-gray-700">
            The latest run completed but contained no items.
          </p>
          {data.summary.reviewFlags.length > 0 && (
            <ul className="mt-2 text-xs text-gray-500 list-disc pl-5 space-y-0.5">
              {data.summary.reviewFlags.map((flag, idx) => (
                <li key={idx}>{flag}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <RunSummary run={data} />
          <div className="space-y-4">
            {orderedSections.map(section => (
              <SectionCard
                key={section.specSection ?? '__unsec__'}
                section={section}
                drafts={drafts}
                rowSave={rowSave}
                onStatus={handleSetDraftStatus}
                onNotes={handleSetDraftNotes}
                onSave={handleSave}
                onReset={handleResetDraft}
              />
            ))}
            {data.ungrouped.length > 0 && (
              <UngroupedCard
                items={data.ungrouped}
                drafts={drafts}
                rowSave={rowSave}
                onStatus={handleSetDraftStatus}
                onNotes={handleSetDraftNotes}
                onSave={handleSave}
                onReset={handleResetDraft}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function RunSummary({ run }: { run: LatestSubmittalRegisterRun }) {
  const wr = run.workflowRun
  const completedAt = wr.completedAt ? new Date(wr.completedAt).toLocaleString() : 'in progress'
  return (
    <div className="rounded-md border border-gray-200 p-4 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <SummaryStat label="Items" value={String(run.summary.totalItemCount)} />
        <SummaryStat label="Sections" value={String(run.summary.groupCount)} />
        <SummaryStat label="Ungrouped" value={String(run.summary.ungroupedCount)} />
        <SummaryStat
          label="Avg confidence"
          value={`${Math.round(run.summary.averageConfidence * 100)}%`}
        />
      </div>
      <p className="text-xs text-gray-500">
        Run {wr.id.slice(0, 8)}… · completed {completedAt}
        {wr.durationMs != null ? ` · ${(wr.durationMs / 1000).toFixed(1)}s` : ''}
      </p>
      {run.summary.reviewFlags.length > 0 && (
        <ul className="mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 list-disc pl-5 space-y-0.5">
          {run.summary.reviewFlags.map((flag, idx) => (
            <li key={idx}>{flag}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-base font-semibold text-gray-900">{value}</div>
    </div>
  )
}

interface SectionRenderProps {
  drafts: Record<string, DraftState>
  rowSave: Record<string, RowSaveState>
  onStatus: (itemId: string, currentStatus: ReviewStatus, currentNotes: string, status: ReviewStatus) => void
  onNotes: (itemId: string, currentStatus: ReviewStatus, currentNotes: string, notes: string) => void
  onSave: (itemId: string, currentStatus: ReviewStatus, currentNotes: string) => void
  onReset: (itemId: string) => void
}

function SectionCard({
  section,
  drafts,
  rowSave,
  onStatus,
  onNotes,
  onSave,
  onReset,
}: SectionRenderProps & { section: SubmittalRegisterGroup }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 text-left bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-gray-900">
            {section.specSection ?? '—'}
            {section.sectionTitle ? <span className="text-gray-700 font-normal"> · {section.sectionTitle}</span> : null}
          </h4>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-500">
              {section.itemCount} item{section.itemCount === 1 ? '' : 's'} · avg{' '}
              {Math.round(section.averageConfidence * 100)}%
            </span>
            <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
          </div>
        </div>
        {section.reviewFlags.length > 0 && (
          <ul className="mt-2 text-xs text-amber-800 list-disc pl-5 space-y-0.5 text-left">
            {section.reviewFlags.map((flag, idx) => (
              <li key={idx}>{flag}</li>
            ))}
          </ul>
        )}
      </button>
      {open && (
        <ul className="divide-y divide-gray-200">
          {section.items.map((item, idx) => (
            <ItemRow
              key={item.persistedItemId ?? `${section.specSection ?? 'x'}-${idx}`}
              item={item}
              drafts={drafts}
              rowSave={rowSave}
              onStatus={onStatus}
              onNotes={onNotes}
              onSave={onSave}
              onReset={onReset}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function UngroupedCard({
  items,
  drafts,
  rowSave,
  onStatus,
  onNotes,
  onSave,
  onReset,
}: SectionRenderProps & { items: SubmittalRegisterItem[] }) {
  return (
    <div className="rounded-md border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h4 className="text-sm font-semibold text-gray-900">Ungrouped (no spec section)</h4>
        <p className="text-xs text-gray-500 mt-0.5">
          {items.length} item{items.length === 1 ? '' : 's'} without a spec section reference.
        </p>
      </div>
      <ul className="divide-y divide-gray-200">
        {items.map((item, idx) => (
          <ItemRow
            key={item.persistedItemId ?? `ungrouped-${idx}`}
            item={item}
            drafts={drafts}
            rowSave={rowSave}
            onStatus={onStatus}
            onNotes={onNotes}
            onSave={onSave}
            onReset={onReset}
          />
        ))}
      </ul>
    </div>
  )
}

function ItemRow({
  item,
  drafts,
  rowSave,
  onStatus,
  onNotes,
  onSave,
  onReset,
}: SectionRenderProps & { item: SubmittalRegisterItem }) {
  const itemId = item.persistedItemId
  const currentStatus: ReviewStatus = isReviewStatus(item.reviewStatus) ? item.reviewStatus : 'pending'
  const currentNotes = item.reviewNotes ?? ''
  const draft = itemId ? drafts[itemId] : undefined
  const draftStatus = draft?.status ?? currentStatus
  const draftNotes = draft?.notes ?? currentNotes
  const isDirty = !!draft && (draft.status !== currentStatus || draft.notes !== currentNotes)
  const save = itemId ? rowSave[itemId] : undefined

  return (
    <li className="p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <p className="flex-1 min-w-0 text-sm text-gray-900">{item.submittalItem}</p>
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${STATUS_PILL_CLASSES[currentStatus]}`}>
          {STATUS_LABELS[currentStatus]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {item.submittalType && (
          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded">
            {item.submittalType}
          </span>
        )}
        {item.approvalRequired && (
          <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded">
            Approval required
          </span>
        )}
        {item.sourceQuality && (
          <span className={`px-2 py-0.5 rounded ${SOURCE_QUALITY_PILL[item.sourceQuality]}`}>
            {item.sourceQuality} confidence ({Math.round(item.confidence * 100)}%)
          </span>
        )}
        {item.citationCompleteness != null && (
          <span className="text-gray-500">citation {item.citationCompleteness}/4</span>
        )}
      </div>

      {(item.sourceReference?.specSection || item.sourceReference?.documentName || item.sourceReference?.pageNumber) && (
        <p className="text-xs text-gray-500">
          {[
            item.sourceReference.specSection ? `spec ${item.sourceReference.specSection}` : null,
            item.sourceReference.documentName ?? null,
            item.sourceReference.pageNumber != null ? `p.${item.sourceReference.pageNumber}` : null,
            item.sourceReference.partReference ?? null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {item.excerpt && (
        <blockquote className="text-xs text-gray-600 border-l-2 border-gray-200 pl-3">
          &ldquo;{item.excerpt}&rdquo;
        </blockquote>
      )}

      {!itemId ? (
        <p className="text-xs text-gray-500 italic">Item not persisted — review controls unavailable.</p>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Review status</label>
            <select
              value={draftStatus}
              onChange={e => onStatus(itemId, currentStatus, currentNotes, e.target.value as ReviewStatus)}
              className="block w-full sm:w-72 rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white cursor-pointer"
            >
              {REVIEW_STATUSES.map(s => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Review notes</label>
            <textarea
              value={draftNotes}
              onChange={e => onNotes(itemId, currentStatus, currentNotes, e.target.value)}
              rows={2}
              placeholder="Optional notes — reasoning, follow-ups, references…"
              className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSave(itemId, currentStatus, currentNotes)}
              disabled={!isDirty || save?.saving}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {save?.saving ? 'Saving…' : 'Save review'}
            </button>
            {isDirty && !save?.saving && (
              <button
                onClick={() => onReset(itemId)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer"
              >
                Reset
              </button>
            )}
            {item.reviewedAt && !isDirty && (
              <span className="text-xs text-gray-500">
                Last reviewed {new Date(item.reviewedAt).toLocaleString()}
                {item.reviewedByRole ? ` · ${item.reviewedByRole}` : ''}
              </span>
            )}
          </div>
          {save?.error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {save.error}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && (REVIEW_STATUSES as readonly string[]).includes(value)
}

function patchItemInRun(
  run: LatestSubmittalRegisterRun,
  itemId: string,
  updated: { reviewStatus: string; reviewNotes: string | null; reviewedAt: string | null; reviewedByRole: string | null }
): LatestSubmittalRegisterRun {
  const patchItem = (item: SubmittalRegisterItem): SubmittalRegisterItem =>
    item.persistedItemId === itemId
      ? {
          ...item,
          reviewStatus: updated.reviewStatus,
          reviewNotes: updated.reviewNotes,
          reviewedAt: updated.reviewedAt,
          reviewedByRole: updated.reviewedByRole,
        }
      : item

  return {
    ...run,
    items: run.items.map(patchItem),
    groupedSections: run.groupedSections.map(section => ({
      ...section,
      items: section.items.map(patchItem),
    })),
    ungrouped: run.ungrouped.map(patchItem),
  }
}
