'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  LatestSubmittalRegisterRun,
  SubmittalRegisterGroup,
  SubmittalRegisterItem,
} from '@/lib/chat/submittal-register'
import { LifecycleControls } from './LifecycleControls'
import { SourceDetailDrawer } from './SourceDetailDrawer'

interface SubmittalRegisterReviewProps {
  projectId: string
  data: LatestSubmittalRegisterRun
  onPatchItem: (itemId: string, updates: Partial<SubmittalRegisterItem>) => void
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

export function SubmittalRegisterReview({
  projectId,
  data,
  onPatchItem,
}: SubmittalRegisterReviewProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})
  const [rowSave, setRowSave] = useState<Record<string, RowSaveState>>({})
  const [selectedSourceItem, setSelectedSourceItem] = useState<SubmittalRegisterItem | null>(null)
  const [specSectionFilter, setSpecSectionFilter] = useState('')
  const [sdCodeFilter, setSdCodeFilter] = useState('')
  const [approvalAuthorityFilter, setApprovalAuthorityFilter] = useState('')
  const [blockingRiskFilter, setBlockingRiskFilter] = useState('')

  useEffect(() => {
    setDrafts({})
    setRowSave({})
    setSpecSectionFilter('')
    setSdCodeFilter('')
    setApprovalAuthorityFilter('')
    setBlockingRiskFilter('')
  }, [data])

  const uniqueSdCodes = useMemo(() => {
    const codes = new Set(data.items.flatMap(i => (i.sdCode ? [i.sdCode] : [])))
    return [...codes].sort()
  }, [data.items])

  const uniqueAuthorities = useMemo(() => {
    const auths = new Set(data.items.flatMap(i => (i.approvalAuthority ? [i.approvalAuthority] : [])))
    return [...auths].sort()
  }, [data.items])

  const filteredData = useMemo(() => {
    const matchItem = (item: SubmittalRegisterItem): boolean => {
      if (specSectionFilter && !(item.specSection ?? '').toLowerCase().startsWith(specSectionFilter.toLowerCase())) return false
      if (sdCodeFilter && item.sdCode !== sdCodeFilter) return false
      if (approvalAuthorityFilter && item.approvalAuthority !== approvalAuthorityFilter) return false
      if (blockingRiskFilter && (item.blockingRisk ?? 'none') !== blockingRiskFilter) return false
      return true
    }
    const items = data.items.filter(matchItem)
    const groupedSections = data.groupedSections
      .map(s => ({ ...s, items: s.items.filter(matchItem) }))
      .filter(s => s.items.length > 0)
    const ungrouped = data.ungrouped.filter(matchItem)
    return { items, groupedSections, ungrouped }
  }, [data, specSectionFilter, sdCodeFilter, approvalAuthorityFilter, blockingRiskFilter])

  const filtersActive = !!(specSectionFilter || sdCodeFilter || approvalAuthorityFilter || blockingRiskFilter)

  const handleSetDraftStatus = (itemId: string, _currentStatus: ReviewStatus, currentNotes: string, status: ReviewStatus) => {
    setDrafts(prev => ({
      ...prev,
      [itemId]: { status, notes: prev[itemId]?.notes ?? currentNotes },
    }))
    if (rowSave[itemId]?.error) {
      setRowSave(prev => ({ ...prev, [itemId]: { saving: false, error: null } }))
    }
  }

  const handleSetDraftNotes = (itemId: string, currentStatus: ReviewStatus, _currentNotes: string, notes: string) => {
    setDrafts(prev => ({
      ...prev,
      [itemId]: { status: prev[itemId]?.status ?? currentStatus, notes },
    }))
    if (rowSave[itemId]?.error) {
      setRowSave(prev => ({ ...prev, [itemId]: { saving: false, error: null } }))
    }
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
      onPatchItem(itemId, {
        reviewStatus: updated.reviewStatus,
        reviewNotes: updated.reviewNotes,
        reviewedAt: updated.reviewedAt,
        reviewedByRole: updated.reviewedByRole,
      })
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

  return (
    <div className="space-y-4">
      {data.items.length === 0 ? (
        <p className="text-sm text-gray-500">No items in this submittal register run.</p>
      ) : (
        <>
          <RunSummary run={data} />

          <div className="flex flex-wrap items-end gap-3 p-3 bg-gray-50 rounded-md border border-gray-200">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Spec section</label>
              <input
                type="text"
                value={specSectionFilter}
                onChange={e => setSpecSectionFilter(e.target.value)}
                placeholder="e.g. 03 30"
                className="rounded border border-gray-300 px-2 py-1.5 text-sm w-28"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SD code</label>
              <select
                value={sdCodeFilter}
                onChange={e => setSdCodeFilter(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white cursor-pointer"
              >
                <option value="">All</option>
                {uniqueSdCodes.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Approval authority</label>
              <select
                value={approvalAuthorityFilter}
                onChange={e => setApprovalAuthorityFilter(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white cursor-pointer"
              >
                <option value="">All</option>
                {uniqueAuthorities.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Blocking risk</label>
              <select
                value={blockingRiskFilter}
                onChange={e => setBlockingRiskFilter(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white cursor-pointer"
              >
                <option value="">All</option>
                {(['none', 'low', 'medium', 'high'] as const).map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setSpecSectionFilter('')
                  setSdCodeFilter('')
                  setApprovalAuthorityFilter('')
                  setBlockingRiskFilter('')
                }}
                className="text-sm text-blue-600 hover:underline cursor-pointer"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="space-y-4">
            {filtersActive && filteredData.items.length === 0 && (
              <p className="text-sm text-gray-500 py-4 text-center">No items match the current filters.</p>
            )}
            {filteredData.groupedSections.map(section => (
              <SectionCard
                key={section.specSection ?? '__unsec__'}
                section={section}
                projectId={projectId}
                drafts={drafts}
                rowSave={rowSave}
                onStatus={handleSetDraftStatus}
                onNotes={handleSetDraftNotes}
                onSave={handleSave}
                onReset={handleResetDraft}
                onLifecycleTransitioned={onPatchItem}
                onViewSource={setSelectedSourceItem}
              />
            ))}
            {filteredData.ungrouped.length > 0 && (
              <UngroupedCard
                items={filteredData.ungrouped}
                projectId={projectId}
                drafts={drafts}
                rowSave={rowSave}
                onStatus={handleSetDraftStatus}
                onNotes={handleSetDraftNotes}
                onSave={handleSave}
                onReset={handleResetDraft}
                onLifecycleTransitioned={onPatchItem}
                onViewSource={setSelectedSourceItem}
              />
            )}
          </div>
        </>
      )}
      <SourceDetailDrawer
        item={selectedSourceItem}
        onClose={() => setSelectedSourceItem(null)}
      />
    </div>
  )
}

function RunSummary({ run }: { run: LatestSubmittalRegisterRun }) {
  const wr = run.workflowRun
  const completedAt = wr.completedAt
    ? new Date(wr.completedAt).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : 'in progress'

  const totalItems = run.summary.totalItemCount
  const reviewedItems = run.items.filter(i => i.reviewStatus && i.reviewStatus !== 'pending').length
  const pendingItems = totalItems - reviewedItems
  const approvalRequiredItems = run.items.filter(i => i.approvalRequired === true).length
  const lowConfidenceItems = run.items.filter(i => i.sourceQuality === 'low').length
  const reviewedPct = totalItems > 0 ? Math.round((reviewedItems / totalItems) * 100) : 0

  let statusMessage: string
  let statusClass = 'text-gray-700'
  if (totalItems === 0) {
    statusMessage = 'No items in this run.'
  } else if (reviewedItems === totalItems) {
    statusMessage = `All ${totalItems.toLocaleString()} items reviewed across ${run.summary.groupCount} sections. Ready for export.`
    statusClass = 'text-green-700'
  } else if (reviewedItems === 0) {
    statusMessage = `${totalItems.toLocaleString()} items across ${run.summary.groupCount} sections.${run.summary.ungroupedCount > 0 ? ` ${run.summary.ungroupedCount} ungrouped.` : ''} Review pending items before export.`
  } else {
    statusMessage = `${reviewedItems.toLocaleString()} of ${totalItems.toLocaleString()} items reviewed (${reviewedPct}%). ${pendingItems.toLocaleString()} pending.`
  }
  if (totalItems > 1000 && reviewedItems < totalItems) {
    statusMessage += ' High item count — review by section before export.'
  }

  return (
    <div className="rounded-md border border-gray-200 p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <SummaryStat label="Submittal Items" value={totalItems.toLocaleString()} />
        <SummaryStat label="Spec Sections" value={String(run.summary.groupCount)} />
        <SummaryStat label="Ungrouped Items" value={String(run.summary.ungroupedCount)} />
        <SummaryStat label="Review Confidence" value={`${Math.round(run.summary.averageConfidence * 100)}%`} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <SummaryStat label="Reviewed" value={reviewedItems.toLocaleString()} />
        <SummaryStat label="Pending Review" value={pendingItems.toLocaleString()} />
        <SummaryStat label="Approval Required" value={approvalRequiredItems.toLocaleString()} />
        <SummaryStat
          label="Low Confidence"
          value={lowConfidenceItems > 0 ? `${lowConfidenceItems.toLocaleString()} flagged` : '—'}
        />
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>Review progress — {reviewedItems.toLocaleString()} / {totalItems.toLocaleString()} items</span>
          <span>{reviewedPct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${reviewedPct}%` }}
          />
        </div>
      </div>

      <p className={`text-sm ${statusClass}`}>{statusMessage}</p>

      <p className="text-xs text-gray-500">
        Run <span className="font-mono">{wr.id.slice(0, 8)}…</span> · generated {completedAt}
        {wr.durationMs != null ? ` · ${(wr.durationMs / 1000).toFixed(1)}s` : ''}
      </p>

      {run.summary.reviewFlags.length > 0 && (
        <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 list-disc pl-5 space-y-0.5">
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
  projectId: string
  drafts: Record<string, DraftState>
  rowSave: Record<string, RowSaveState>
  onStatus: (itemId: string, currentStatus: ReviewStatus, currentNotes: string, status: ReviewStatus) => void
  onNotes: (itemId: string, currentStatus: ReviewStatus, currentNotes: string, notes: string) => void
  onSave: (itemId: string, currentStatus: ReviewStatus, currentNotes: string) => void
  onReset: (itemId: string) => void
  onLifecycleTransitioned: (itemId: string, updates: Partial<SubmittalRegisterItem>) => void
  onViewSource: (item: SubmittalRegisterItem) => void
}

function SectionCard({
  section,
  projectId,
  drafts,
  rowSave,
  onStatus,
  onNotes,
  onSave,
  onReset,
  onLifecycleTransitioned,
  onViewSource,
}: SectionRenderProps & { section: SubmittalRegisterGroup }) {
  const [open, setOpen] = useState(false)

  const reviewedInSection = section.items.filter(i => i.reviewStatus && i.reviewStatus !== 'pending').length
  const totalInSection = section.items.length
  const sectionPct = totalInSection > 0 ? Math.round((reviewedInSection / totalInSection) * 100) : 0

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
              {section.itemCount} item{section.itemCount === 1 ? '' : 's'}
              {' · '}{reviewedInSection}/{totalInSection} reviewed
              {' · '}avg {Math.round(section.averageConfidence * 100)}%
            </span>
            <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
          </div>
        </div>
        <div className="mt-2 h-1 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-400 rounded-full transition-all duration-300"
            style={{ width: `${sectionPct}%` }}
          />
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
              projectId={projectId}
              drafts={drafts}
              rowSave={rowSave}
              onStatus={onStatus}
              onNotes={onNotes}
              onSave={onSave}
              onReset={onReset}
              onLifecycleTransitioned={onLifecycleTransitioned}
              onViewSource={onViewSource}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function UngroupedCard({
  items,
  projectId,
  drafts,
  rowSave,
  onStatus,
  onNotes,
  onSave,
  onReset,
  onLifecycleTransitioned,
  onViewSource,
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
            projectId={projectId}
            drafts={drafts}
            rowSave={rowSave}
            onStatus={onStatus}
            onNotes={onNotes}
            onSave={onSave}
            onReset={onReset}
            onLifecycleTransitioned={onLifecycleTransitioned}
            onViewSource={onViewSource}
          />
        ))}
      </ul>
    </div>
  )
}

function ItemRow({
  item,
  projectId,
  drafts,
  rowSave,
  onStatus,
  onNotes,
  onSave,
  onReset,
  onLifecycleTransitioned,
  onViewSource,
}: SectionRenderProps & { item: SubmittalRegisterItem }) {
  const itemId = item.persistedItemId
  const currentStatus: ReviewStatus = isReviewStatus(item.reviewStatus) ? item.reviewStatus : 'pending'
  const currentNotes = item.reviewNotes ?? ''
  const draft = itemId ? drafts[itemId] : undefined
  const draftStatus = draft?.status ?? currentStatus
  const draftNotes = draft?.notes ?? currentNotes
  const isDirty = !!draft && (draft.status !== currentStatus || draft.notes !== currentNotes)
  const save = itemId ? rowSave[itemId] : undefined
  const hasSource = !!(item.sourceExcerpt ?? item.excerpt ?? (item.sourceReference?.pageNumber != null ? item.sourceReference.pageNumber : null))

  return (
    <li className="p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <p className="flex-1 min-w-0 text-sm text-gray-900">{item.submittalItem}</p>
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${STATUS_PILL_CLASSES[currentStatus]}`}>
          {STATUS_LABELS[currentStatus]}
        </span>
        {hasSource && (
          <button
            type="button"
            onClick={() => onViewSource(item)}
            className="px-2 py-0.5 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50 cursor-pointer"
            title="View source excerpt"
          >
            View source
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {item.submittalType && (
          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded">
            {item.submittalType}
          </span>
        )}
        {item.sdCode && (
          <span className="px-2 py-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded">
            {item.sdCode}
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

      {itemId && (
        <LifecycleControls
          item={item}
          projectId={projectId}
          onTransitioned={updates => onLifecycleTransitioned(itemId, updates)}
        />
      )}
    </li>
  )
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && (REVIEW_STATUSES as readonly string[]).includes(value)
}

