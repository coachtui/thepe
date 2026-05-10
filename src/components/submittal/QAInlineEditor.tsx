'use client'

import { useState } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import type { QAFindingType } from '@/lib/chat/submittal-coverage-qa'

const SD_CODES = [
  'SD-01', 'SD-02', 'SD-03', 'SD-04', 'SD-05', 'SD-06',
  'SD-07', 'SD-08', 'SD-09', 'SD-10', 'SD-11',
]

const APPROVAL_AUTHORITIES = ['Government', 'QC', 'A-E', 'Contractor'] as const

interface QAInlineEditorProps {
  item: SubmittalRegisterItem
  projectId: string
  activeQaFilter: QAFindingType
  onPatched: (updates: Partial<SubmittalRegisterItem>) => void
}

const STRIP = 'mt-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded text-xs'
const SELECT = 'rounded border border-indigo-300 px-2 py-1 text-xs bg-white cursor-pointer disabled:opacity-50'
const BTN_PRIMARY = 'px-2 py-1 text-xs rounded cursor-pointer bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed'
const INPUT_TEXT = 'w-full rounded border border-indigo-300 px-2 py-1 text-xs bg-white disabled:opacity-50'

export function QAInlineEditor({
  item,
  projectId,
  activeQaFilter,
  onPatched,
}: QAInlineEditorProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dueDateLocal, setDueDateLocal] = useState(item.lifecycleDueDate ?? '')
  const [noteLocal, setNoteLocal] = useState('')
  const [fowLocal, setFowLocal] = useState(item.relatedFOW ?? '')
  const [activityLocal, setActivityLocal] = useState(item.scheduleActivity ?? '')
  const [needByLocal, setNeedByLocal] = useState(item.activityNeedByDate ?? '')
  const [blocksWorkLocal, setBlocksWorkLocal] = useState(item.blocksWork ?? false)

  const itemId = item.persistedItemId
  if (!itemId) {
    return (
      <div className={`${STRIP} text-indigo-700`}>
        Item not yet persisted — save changes first to resolve QA issues.
      </div>
    )
  }

  async function patch(body: Record<string, unknown>) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/submittal-register/qa-patch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ itemId, ...body }),
        },
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data?.error ?? `Request failed (${res.status})`)
      }
      onPatched(data.updatedFields as Partial<SubmittalRegisterItem>)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (activeQaFilter === 'missing_sd_code') {
    return (
      <div className={`${STRIP} flex flex-wrap items-center gap-2`}>
        <span className="font-medium text-indigo-800">Set SD code</span>
        <select
          value={item.sdCode ?? ''}
          onChange={e => { if (e.target.value) patch({ sdCode: e.target.value }) }}
          disabled={saving}
          className={SELECT}
        >
          <option value="">— select —</option>
          {SD_CODES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {saving && <span className="text-indigo-600">Saving…</span>}
        {error && <span className="text-red-700">{error}</span>}
      </div>
    )
  }

  if (activeQaFilter === 'missing_approval_authority') {
    return (
      <div className={`${STRIP} flex flex-wrap items-center gap-2`}>
        <span className="font-medium text-indigo-800">Set approval authority</span>
        <select
          value={item.approvalAuthority ?? ''}
          onChange={e => { if (e.target.value) patch({ approvalAuthority: e.target.value }) }}
          disabled={saving}
          className={SELECT}
        >
          <option value="">— select —</option>
          {APPROVAL_AUTHORITIES.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {saving && <span className="text-indigo-600">Saving…</span>}
        {error && <span className="text-red-700">{error}</span>}
      </div>
    )
  }

  if (activeQaFilter === 'blocking_risk_no_due_date') {
    return (
      <div className={`${STRIP} flex flex-wrap items-center gap-2`}>
        <span className="font-medium text-indigo-800">Set due date</span>
        <input
          type="date"
          value={dueDateLocal}
          onChange={e => setDueDateLocal(e.target.value)}
          disabled={saving}
          className="rounded border border-indigo-300 px-2 py-1 text-xs bg-white disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => { if (dueDateLocal) patch({ dueDate: dueDateLocal }) }}
          disabled={saving || !dueDateLocal}
          className={BTN_PRIMARY}
        >
          {saving ? 'Saving…' : 'Set date'}
        </button>
        {error && <span className="text-red-700">{error}</span>}
      </div>
    )
  }

  if (activeQaFilter === 'duplicate_submittal') {
    const ack = item.qaAcknowledgements?.duplicate_submittal
    return (
      <div className={`${STRIP} flex flex-col gap-1`}>
        {ack ? (
          <p className="text-indigo-700">
            <span className="font-medium">Reviewed</span>
            {' · '}{new Date(ack.acknowledgedAt).toLocaleDateString()}
            {ack.acknowledgedBy ? ` by ${ack.acknowledgedBy}` : ''}
            {ack.note ? ` — "${ack.note}"` : ''}
          </p>
        ) : (
          <>
            <span className="font-medium text-indigo-800">Mark as reviewed (intentional duplicate)</span>
            <input
              type="text"
              value={noteLocal}
              onChange={e => setNoteLocal(e.target.value)}
              placeholder="Note (optional) — e.g. same item referenced in multiple sections"
              disabled={saving}
              className={INPUT_TEXT}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => patch({ acknowledge: 'duplicate_submittal', note: noteLocal || undefined })}
                disabled={saving}
                className={BTN_PRIMARY}
              >
                {saving ? 'Saving…' : 'Mark reviewed'}
              </button>
              {error && <span className="text-red-700">{error}</span>}
            </div>
          </>
        )}
      </div>
    )
  }

  if (activeQaFilter === 'blocking_risk_missing_work_linkage') {
    const hasLinkage = !!(item.relatedFOW || item.scheduleActivity)
    if (hasLinkage) {
      return (
        <div className={`${STRIP} text-indigo-700`}>
          <span className="font-medium">Work linkage set</span>
          {item.relatedFOW && <> · FOW: {item.relatedFOW}</>}
          {item.scheduleActivity && <> · Activity: {item.scheduleActivity}</>}
        </div>
      )
    }
    return (
      <div className={`${STRIP} flex flex-col gap-1.5`}>
        <span className="font-medium text-indigo-800">Work linkage</span>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={fowLocal}
            onChange={e => setFowLocal(e.target.value)}
            placeholder="Feature of Work"
            disabled={saving}
            className="rounded border border-indigo-300 px-2 py-1 text-xs bg-white disabled:opacity-50 flex-1 min-w-32"
          />
          <input
            type="text"
            value={activityLocal}
            onChange={e => setActivityLocal(e.target.value)}
            placeholder="Schedule Activity"
            disabled={saving}
            className="rounded border border-indigo-300 px-2 py-1 text-xs bg-white disabled:opacity-50 flex-1 min-w-32"
          />
          <input
            type="date"
            value={needByLocal}
            onChange={e => setNeedByLocal(e.target.value)}
            disabled={saving}
            className="rounded border border-indigo-300 px-2 py-1 text-xs bg-white disabled:opacity-50"
          />
          <label className="flex items-center gap-1 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={blocksWorkLocal}
              onChange={e => setBlocksWorkLocal(e.target.checked)}
              disabled={saving}
              className="cursor-pointer"
            />
            <span className="text-xs text-indigo-800">Blocks Work</span>
          </label>
          <button
            type="button"
            onClick={() => {
              const updates: Record<string, unknown> = {}
              if (fowLocal.trim()) updates.relatedFOW = fowLocal.trim()
              if (activityLocal.trim()) updates.scheduleActivity = activityLocal.trim()
              if (needByLocal) updates.activityNeedByDate = needByLocal
              updates.blocksWork = blocksWorkLocal
              patch(updates)
            }}
            disabled={saving || (!fowLocal.trim() && !activityLocal.trim())}
            className={BTN_PRIMARY}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {error && <span className="text-red-700">{error}</span>}
        </div>
      </div>
    )
  }

  if (activeQaFilter === 'missing_source_excerpt') {
    const ack = item.qaAcknowledgements?.missing_source_excerpt
    return (
      <div className={`${STRIP} flex flex-col gap-1`}>
        {ack ? (
          <p className="text-indigo-700">
            <span className="font-medium">Acknowledged</span>
            {' · '}{new Date(ack.acknowledgedAt).toLocaleDateString()}
            {ack.acknowledgedBy ? ` by ${ack.acknowledgedBy}` : ''}
            {ack.note ? ` — "${ack.note}"` : ''}
          </p>
        ) : (
          <>
            <span className="font-medium text-indigo-800">Mark as acknowledged (excerpt unavailable)</span>
            <input
              type="text"
              value={noteLocal}
              onChange={e => setNoteLocal(e.target.value)}
              placeholder="Note (optional) — e.g. not available in spec, confirmed by field"
              disabled={saving}
              className={INPUT_TEXT}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => patch({ acknowledge: 'missing_source_excerpt', note: noteLocal || undefined })}
                disabled={saving}
                className={BTN_PRIMARY}
              >
                {saving ? 'Saving…' : 'Mark acknowledged'}
              </button>
              {error && <span className="text-red-700">{error}</span>}
            </div>
          </>
        )}
      </div>
    )
  }

  return null
}
