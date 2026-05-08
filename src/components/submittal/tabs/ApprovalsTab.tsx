'use client'

import { useMemo, useState } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import { LifecycleBadge } from '../LifecycleBadge'
import { LifecycleControls } from '../LifecycleControls'
import { resolveEffectiveStatus, isOverdue } from '@/lib/chat/submittal-lifecycle'

const APPROVAL_STATUSES = [
  'pending_review',
  'submitted',
  'approved_as_noted',
  'revise_resubmit',
  'rejected',
] as const

const REVIEW_STATUSES = [
  'pending',
  'approved',
  'approved_as_noted',
  'rejected',
  'needs_clarification',
  'superseded',
] as const

type ReviewStatusValue = typeof REVIEW_STATUSES[number]

const REVIEW_STATUS_LABELS: Record<ReviewStatusValue, string> = {
  pending: 'Pending',
  approved: 'Approved',
  approved_as_noted: 'Approved as noted',
  rejected: 'Rejected',
  needs_clarification: 'Needs clarification',
  superseded: 'Superseded',
}

interface DraftState {
  status: ReviewStatusValue
  notes: string
}

interface RowSave {
  saving: boolean
  error: string | null
}

interface ApprovalsTabProps {
  projectId: string
  items: SubmittalRegisterItem[]
  onPatchItem: (itemId: string, updates: Partial<SubmittalRegisterItem>) => void
}

export function ApprovalsTab({ projectId, items, onPatchItem }: ApprovalsTabProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})
  const [rowSave, setRowSave] = useState<Record<string, RowSave>>({})

  const approvalItems = useMemo(() => {
    return items.filter(i =>
      i.lifecycleStatus !== undefined &&
      APPROVAL_STATUSES.includes(i.lifecycleStatus as typeof APPROVAL_STATUSES[number])
    )
  }, [items])

  const getDraft = (item: SubmittalRegisterItem): DraftState => {
    const id = item.persistedItemId ?? ''
    return (
      drafts[id] ?? {
        status: (item.reviewStatus as ReviewStatusValue) ?? 'pending',
        notes: item.reviewNotes ?? '',
      }
    )
  }

  const handleSave = async (item: SubmittalRegisterItem) => {
    const id = item.persistedItemId
    if (!id) return
    const draft = getDraft(item)
    setRowSave(prev => ({ ...prev, [id]: { saving: true, error: null } }))
    try {
      const res = await fetch(
        `/api/projects/${projectId}/submittal-register/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            item_id: id,
            review_status: draft.status,
            review_notes: draft.notes.trim().length > 0 ? draft.notes : null,
          }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body?.error ?? `Failed (${res.status})`)
      const updated = body.item as {
        reviewStatus: string
        reviewNotes: string | null
        reviewedAt: string | null
        reviewedByRole: string | null
      }
      onPatchItem(id, {
        reviewStatus: updated.reviewStatus,
        reviewNotes: updated.reviewNotes,
        reviewedAt: updated.reviewedAt,
        reviewedByRole: updated.reviewedByRole,
      })
      setDrafts(prev => { const n = { ...prev }; delete n[id]; return n })
      setRowSave(prev => ({ ...prev, [id]: { saving: false, error: null } }))
    } catch (err) {
      setRowSave(prev => ({
        ...prev,
        [id]: { saving: false, error: err instanceof Error ? err.message : 'Save failed' },
      }))
    }
  }

  if (approvalItems.length === 0) {
    return <p className="text-sm text-gray-500 py-4">No items pending approval.</p>
  }

  return (
    <div className="space-y-3">
      {approvalItems.map((item, idx) => {
        const id = item.persistedItemId ?? String(idx)
        const draft = getDraft(item)
        const save = rowSave[id]
        const isDirty =
          draft.status !== ((item.reviewStatus as ReviewStatusValue) ?? 'pending') ||
          draft.notes !== (item.reviewNotes ?? '')
        const overdue = isOverdue(item.lifecycleDueDate)

        return (
          <div key={id} className="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
            {/* Header row */}
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {item.submittalItem}
                </p>
                {item.specSection && (
                  <p className="text-xs text-gray-500 mt-0.5">{item.specSection}</p>
                )}
              </div>
              <LifecycleBadge
                status={resolveEffectiveStatus(item)}
                overdue={overdue}
                compact
              />
              {item.lifecycleDueDate && (
                <span className={`text-xs shrink-0 ${overdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                  Due {item.lifecycleDueDate}
                </span>
              )}
            </div>

            {/* Review form */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Review status</label>
                <select
                  value={draft.status}
                  onChange={e =>
                    setDrafts(prev => ({
                      ...prev,
                      [id]: { ...getDraft(item), status: e.target.value as ReviewStatusValue },
                    }))
                  }
                  className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                >
                  {REVIEW_STATUSES.map(s => (
                    <option key={s} value={s}>{REVIEW_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <input
                  type="text"
                  value={draft.notes}
                  onChange={e =>
                    setDrafts(prev => ({
                      ...prev,
                      [id]: { ...getDraft(item), notes: e.target.value },
                    }))
                  }
                  placeholder="Optional notes"
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1"
                />
              </div>
              {isDirty && (
                <button
                  onClick={() => handleSave(item)}
                  disabled={save?.saving}
                  className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                >
                  {save?.saving ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>

            {save?.error && (
              <p className="text-xs text-red-600">{save.error}</p>
            )}

            {/* Lifecycle controls */}
            {item.persistedItemId && (
              <LifecycleControls
                item={item}
                projectId={projectId}
                onTransitioned={updates => onPatchItem(item.persistedItemId!, updates)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
