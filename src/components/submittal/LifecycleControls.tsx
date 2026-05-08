'use client'

import { useState } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import type { SubmittalLifecycleStatus, LifecycleHistoryEntry } from '@/lib/chat/submittal-lifecycle'
import {
  resolveEffectiveStatus,
  getNextStatuses,
  STATUS_LABELS,
  isOverdue,
  formatDueDate,
} from '@/lib/chat/submittal-lifecycle'
import { LifecycleBadge } from './LifecycleBadge'

interface LifecycleControlsProps {
  item: SubmittalRegisterItem
  projectId: string
  onTransitioned: (updates: Partial<SubmittalRegisterItem>) => void
}

export function LifecycleControls({ item, projectId, onTransitioned }: LifecycleControlsProps) {
  const [expanded, setExpanded] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedStatus, setSelectedStatus] = useState<SubmittalLifecycleStatus | ''>('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveStatus = resolveEffectiveStatus(item)
  const nextStatuses = getNextStatuses(effectiveStatus)
  const overdue = isOverdue(item.lifecycleDueDate)
  const formattedDue = formatDueDate(item.lifecycleDueDate)
  const history: LifecycleHistoryEntry[] = Array.isArray(item.lifecycleStatusHistory)
    ? item.lifecycleStatusHistory
    : []

  const handleAdvance = async () => {
    if (!selectedStatus || !item.persistedItemId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/submittal-register/lifecycle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            item_id: item.persistedItemId,
            to_status: selectedStatus,
            note: note.trim() || undefined,
          }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) {
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      onTransitioned(body.updatedFields as Partial<SubmittalRegisterItem>)
      setSelectedStatus('')
      setNote('')
      setExpanded(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Inline lifecycle row */}
      <div className="flex flex-wrap items-center gap-2">
        <LifecycleBadge status={effectiveStatus} overdue={overdue} />

        {item.lifecycleLongLeadFlag && (
          <span className="px-2 py-0.5 text-xs rounded bg-purple-50 text-purple-700 border border-purple-200">
            Long Lead
          </span>
        )}

        {formattedDue && (
          <span className={`text-xs ${overdue ? 'text-red-700 font-medium' : 'text-gray-500'}`}>
            Due {formattedDue}{overdue ? ' — overdue' : ''}
          </span>
        )}

        {item.lifecycleResponsibleParty && (
          <span className="text-xs text-gray-500">
            {item.lifecycleResponsibleParty}
          </span>
        )}

        {item.persistedItemId && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                {history.length} update{history.length === 1 ? '' : 's'}
              </button>
            )}
            {nextStatuses.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(o => !o)}
                className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer"
              >
                {expanded ? 'Cancel' : 'Advance'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Transition form */}
      {expanded && nextStatuses.length > 0 && (
        <div className="rounded border border-gray-200 bg-gray-50 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value as SubmittalLifecycleStatus)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
            >
              <option value="">Select next status…</option>
              {nextStatuses.map(s => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdvance}
              disabled={!selectedStatus || saving}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
          />
          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              {error}
            </p>
          )}
        </div>
      )}

      {/* History drawer */}
      {historyOpen && (
        <HistoryDrawer history={history} onClose={() => setHistoryOpen(false)} />
      )}
    </>
  )
}

// ── History drawer ─────────────────────────────────────────────────────────────

interface HistoryDrawerProps {
  history: LifecycleHistoryEntry[]
  onClose: () => void
}

function HistoryDrawer({ history, onClose }: HistoryDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-white rounded-lg shadow-lg w-full max-w-md max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-900">Lifecycle History</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <ul className="overflow-y-auto divide-y divide-gray-100 flex-1">
          {[...history].reverse().map((entry, idx) => (
            <li key={idx} className="px-4 py-3 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                {entry.fromStatus && (
                  <>
                    <span className="text-xs text-gray-500">{STATUS_LABELS[entry.fromStatus]}</span>
                    <span className="text-xs text-gray-300">→</span>
                  </>
                )}
                <span className="text-xs font-medium text-gray-800">
                  {STATUS_LABELS[entry.toStatus]}
                </span>
              </div>
              <div className="text-xs text-gray-400">
                {new Date(entry.changedAt).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
                {entry.changedBy ? ` · ${entry.changedBy}` : ''}
              </div>
              {entry.note && (
                <p className="text-xs text-gray-600 italic">{entry.note}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
