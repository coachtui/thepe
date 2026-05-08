'use client'

import { useMemo, useState } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'

interface ArtifactReviewQueueProps {
  projectId: string
  items: SubmittalRegisterItem[]
  onResolved: (
    itemId: string,
    updates: { submittalItem?: string; artifactReviewStatus: 'resolved' | 'ignored' }
  ) => void
}

interface ItemUIState {
  mode: 'idle' | 'editing' | 'saving'
  editValue: string
  localStatus: 'resolved' | 'ignored' | null
  error: string | null
}

export function ArtifactReviewQueue({
  projectId,
  items,
  onResolved,
}: ArtifactReviewQueueProps) {
  const [open, setOpen] = useState(false)
  const [uiState, setUiState] = useState<Record<string, ItemUIState>>({})

  const getState = (id: string): ItemUIState =>
    uiState[id] ?? { mode: 'idle', editValue: '', localStatus: null, error: null }

  const patchState = (id: string, patch: Partial<ItemUIState>) =>
    setUiState(prev => ({ ...prev, [id]: { ...getState(id), ...patch } }))

  const pendingItems = useMemo(
    () =>
      items.filter(i => {
        if (!i.persistedItemId) return false
        const local = uiState[i.persistedItemId]?.localStatus
        if (local === 'resolved' || local === 'ignored') return false
        return i.artifactReviewStatus === 'artifact_suspected'
      }),
    [items, uiState]
  )

  const resolvedCount = useMemo(
    () =>
      Object.values(uiState).filter(
        s => s.localStatus === 'resolved' || s.localStatus === 'ignored'
      ).length,
    [uiState]
  )

  if (pendingItems.length === 0 && resolvedCount === 0) return null

  const callReview = async (
    itemId: string,
    action: 'accept' | 'edit' | 'ignore',
    cleanName?: string
  ) => {
    patchState(itemId, { mode: 'saving', error: null })
    try {
      const res = await fetch(
        `/api/projects/${projectId}/submittal-register/artifact-review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ item_id: itemId, action, clean_name: cleanName }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) {
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      const newStatus = body.artifactReviewStatus as 'resolved' | 'ignored'
      patchState(itemId, { mode: 'idle', localStatus: newStatus, error: null })
      onResolved(itemId, {
        submittalItem: body.newSubmittalItem,
        artifactReviewStatus: newStatus,
      })
    } catch (err) {
      patchState(itemId, {
        mode: 'idle',
        error: err instanceof Error ? err.message : 'Action failed',
      })
    }
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 text-left hover:bg-amber-100 transition-colors rounded-md"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-amber-900">
              Extraction Review Queue
            </span>
            {pendingItems.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-200 text-amber-900">
                {pendingItems.length} need{pendingItems.length === 1 ? 's' : ''} review
              </span>
            )}
            {resolvedCount > 0 && (
              <span className="text-xs text-amber-700">
                · {resolvedCount} resolved this session
              </span>
            )}
          </div>
          <span className="text-amber-600 text-xs shrink-0">{open ? '▲' : '▼'}</span>
        </div>
        {!open && pendingItems.length > 0 && (
          <p className="text-xs text-amber-700 mt-0.5">
            These items may contain PDF extraction artifacts. Review before export.
          </p>
        )}
      </button>

      {open && (
        <div className="border-t border-amber-200">
          {pendingItems.length === 0 ? (
            <p className="px-4 py-3 text-sm text-amber-800">
              All items in this queue have been resolved.
            </p>
          ) : (
            <ul className="divide-y divide-amber-200">
              {pendingItems.map(item => {
                const id = item.persistedItemId!
                const state = getState(id)
                return (
                  <ReviewRow
                    key={id}
                    item={item}
                    state={state}
                    onAccept={() =>
                      callReview(id, 'accept', item.artifactSuggestedName ?? undefined)
                    }
                    onEditStart={() =>
                      patchState(id, {
                        mode: 'editing',
                        editValue: item.artifactSuggestedName ?? item.submittalItem,
                        error: null,
                      })
                    }
                    onEditSave={() => callReview(id, 'edit', state.editValue)}
                    onEditCancel={() => patchState(id, { mode: 'idle', error: null })}
                    onEditChange={v => patchState(id, { editValue: v })}
                    onIgnore={() => callReview(id, 'ignore')}
                  />
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

interface ReviewRowProps {
  item: SubmittalRegisterItem
  state: ItemUIState
  onAccept: () => void
  onEditStart: () => void
  onEditSave: () => void
  onEditCancel: () => void
  onEditChange: (v: string) => void
  onIgnore: () => void
}

function ReviewRow({
  item,
  state,
  onAccept,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditChange,
  onIgnore,
}: ReviewRowProps) {
  const hasSuggestion = !!item.artifactSuggestedName
  const sourcePage = item.sourceReference?.pageNumber
  const isSaving = state.mode === 'saving'

  return (
    <li className="px-4 py-4 space-y-2">
      {/* Section + page metadata */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-amber-700">
        {item.specSection && (
          <span className="font-mono font-medium">{item.specSection}</span>
        )}
        {item.sectionTitle && (
          <span className="text-amber-600">· {item.sectionTitle}</span>
        )}
        {sourcePage != null && (
          <span className="text-amber-500">· p.{sourcePage}</span>
        )}
      </div>

      {/* Before / after names */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-500 w-24 shrink-0">
            Current text
          </span>
          <span className="text-xs text-red-700 font-mono bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
            {item.submittalItem}
          </span>
        </div>

        {hasSuggestion && state.mode !== 'editing' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 w-24 shrink-0">
              Suggested
            </span>
            <span className="text-xs text-green-700 font-mono bg-green-50 px-1.5 py-0.5 rounded border border-green-200">
              {item.artifactSuggestedName}
            </span>
          </div>
        )}
      </div>

      {/* Review reason */}
      {item.artifactReviewReason && (
        <p className="text-xs text-amber-700">
          <span className="font-medium">Review note:</span> {item.artifactReviewReason}
        </p>
      )}

      {/* Source text excerpt */}
      {item.rawExcerpt && (
        <blockquote className="text-xs text-gray-600 border-l-2 border-amber-300 pl-2 italic">
          &ldquo;
          {item.rawExcerpt.length > 160
            ? item.rawExcerpt.slice(0, 160) + '…'
            : item.rawExcerpt}
          &rdquo;
        </blockquote>
      )}

      {/* Edit input */}
      {state.mode === 'editing' ? (
        <div className="space-y-1.5">
          <input
            type="text"
            value={state.editValue}
            onChange={e => onEditChange(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white"
            placeholder="Enter corrected submittal item name…"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              onClick={onEditSave}
              disabled={!state.editValue.trim()}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              Save
            </button>
            <button
              onClick={onEditCancel}
              className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Action buttons */
        <div className="flex flex-wrap items-center gap-2">
          {hasSuggestion && (
            <button
              onClick={onAccept}
              disabled={isSaving}
              className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Saving…' : 'Accept suggestion'}
            </button>
          )}
          <button
            onClick={onEditStart}
            disabled={isSaving}
            className="px-3 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
          >
            Edit name
          </button>
          <button
            onClick={onIgnore}
            disabled={isSaving}
            className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? '…' : 'Ignore'}
          </button>
        </div>
      )}

      {state.error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {state.error}
        </p>
      )}
    </li>
  )
}
