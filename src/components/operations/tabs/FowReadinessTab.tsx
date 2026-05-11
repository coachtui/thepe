'use client'

import { useEffect, useState } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import type { FowEntity, FowReadiness, FowReviewStatus } from '@/lib/graph/fow-readiness'
import { LifecycleBadge } from '../../submittal/LifecycleBadge'

interface FowReadinessTabProps {
  projectId: string
}

interface FowApiResponse {
  features: FowReadiness[]
  totals: {
    fowCount: number
    submittalsLinked: number
    submittalsUnlinked: number
  }
}

function readinessColor(percent: number): string {
  if (percent >= 90) return 'bg-green-500'
  if (percent >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

function readinessTextColor(percent: number): string {
  if (percent >= 90) return 'text-green-700'
  if (percent >= 50) return 'text-amber-700'
  return 'text-red-700'
}

const STATUS_STYLES: Record<FowReviewStatus, string> = {
  needs_review: 'bg-amber-100 text-amber-800 border border-amber-200',
  active: 'bg-gray-100 text-gray-700 border border-gray-200',
  approved: 'bg-green-100 text-green-800 border border-green-200',
}

const STATUS_LABELS: Record<FowReviewStatus, string> = {
  needs_review: 'Needs Review',
  active: 'Active',
  approved: 'Approved',
}

// ---------------------------------------------------------------------------
// FOW row — expandable inline edit
// ---------------------------------------------------------------------------

function FowRow({
  data,
  projectId,
  onChanged,
}: {
  data: FowReadiness
  projectId: string
  onChanged: () => void
}) {
  const { fow } = data
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: fow.displayName,
    specSectionsStr: fow.specSections.join(', '),
    trade: fow.trade ?? '',
    subcontractor: fow.subcontractor ?? '',
    status: fow.status,
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/features-of-work/${fow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          specSections: form.specSectionsStr.split(',').map(s => s.trim()).filter(Boolean),
          trade: form.trade.trim() || null,
          subcontractor: form.subcontractor.trim() || null,
          status: form.status,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to save')
      }
      setEditing(false)
      onChanged()
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${fow.displayName}"? Submittals will not be affected.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/features-of-work/${fow.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to delete')
      }
      onChanged()
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Failed to delete')
      setDeleting(false)
    }
  }

  const handleApprove = async () => {
    setSaving(true)
    try {
      await fetch(`/api/projects/${projectId}/features-of-work/${fow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 cursor-pointer text-left"
      >
        <span className="font-mono text-xs text-gray-400 w-6 shrink-0">{fow.sequence || '—'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-900 truncate">{fow.displayName}</p>
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[fow.status]}`}>
              {STATUS_LABELS[fow.status]}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {fow.trade && <span className="mr-2">{fow.trade}</span>}
            {fow.specSections.length > 0
              ? <span>{fow.specSections.length} spec section{fow.specSections.length !== 1 ? 's' : ''}</span>
              : <span className="italic">no spec sections</span>}
            <span className="mx-2">•</span>
            {data.approvedCount}/{data.totalCount} approved
            {data.blockedCount > 0 && <span className="text-red-600 ml-2">• {data.blockedCount} blocked</span>}
          </p>
        </div>
        <div className="flex-shrink-0 w-32">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full ${readinessColor(data.readinessPercent)}`}
                style={{ width: `${data.readinessPercent}%` }}
              />
            </div>
            <span className={`text-xs font-semibold w-9 text-right ${readinessTextColor(data.readinessPercent)}`}>
              {data.readinessPercent}%
            </span>
          </div>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-4 py-3 bg-gray-50 space-y-3">
          {/* Inline edit / view toggle */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-700 uppercase tracking-wider">Details</p>
            <div className="flex gap-2">
              {!editing && fow.status === 'needs_review' && (
                <button
                  onClick={handleApprove}
                  disabled={saving}
                  className="px-2 py-1 text-xs border border-green-600 rounded text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 cursor-pointer"
                >
                  Approve as-is
                </button>
              )}
              <button
                onClick={() => setEditing(e => !e)}
                className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
              >
                {editing ? 'Cancel' : 'Edit'}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-2 py-1 text-xs border border-red-300 rounded text-red-700 bg-white hover:bg-red-50 disabled:opacity-50 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>

          {editing ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 col-span-2">
                <span className="text-xs font-medium text-gray-700">Name</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-gray-700">Trade</span>
                <input
                  type="text"
                  value={form.trade}
                  onChange={e => setForm(f => ({ ...f, trade: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-gray-700">Subcontractor</span>
                <input
                  type="text"
                  value={form.subcontractor}
                  onChange={e => setForm(f => ({ ...f, subcontractor: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-xs font-medium text-gray-700">Spec Sections (comma-separated)</span>
                <input
                  type="text"
                  value={form.specSectionsStr}
                  onChange={e => setForm(f => ({ ...f, specSectionsStr: e.target.value }))}
                  placeholder="e.g. 03 30 00, 03 11 00, 03 15 00"
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono"
                />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-xs font-medium text-gray-700">Status</span>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as FowReviewStatus }))}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                >
                  <option value="needs_review">Needs Review</option>
                  <option value="active">Active</option>
                  <option value="approved">Approved</option>
                </select>
              </label>
              <div className="col-span-2 flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm border border-indigo-600 rounded text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-500">Trade</p>
                <p className="text-gray-900">{fow.trade ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Subcontractor</p>
                <p className="text-gray-900">{fow.subcontractor ?? '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-500">Spec Sections</p>
                {fow.specSections.length === 0 ? (
                  <p className="text-gray-400 italic">none</p>
                ) : (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {fow.specSections.map(s => (
                      <span key={s} className="text-xs font-mono px-2 py-0.5 rounded bg-white border border-gray-300 text-gray-700">{s}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Blockers list */}
          {data.blockers.length > 0 && (
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs font-medium text-gray-700 uppercase tracking-wider mb-2">
                Blocking submittals ({data.blockers.length})
              </p>
              <ul className="space-y-1.5">
                {data.blockers.map((s: SubmittalRegisterItem, i) => (
                  <li key={s.persistedItemId ?? i} className="flex items-start gap-2 text-sm">
                    <LifecycleBadge status={s.lifecycleStatus ?? 'draft'} compact />
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-900 truncate">{s.submittalItem}</p>
                      {s.specSection && <p className="text-xs text-gray-500">{s.specSection}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create FOW modal
// ---------------------------------------------------------------------------

function CreateFowModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [specSectionsStr, setSpecSectionsStr] = useState('')
  const [trade, setTrade] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/features-of-work`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          specSections: specSectionsStr.split(',').map(s => s.trim()).filter(Boolean),
          trade: trade.trim() || null,
          status: 'active',
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to create')
      }
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-start justify-center p-4 pt-24">
        <div className="fixed inset-0 bg-gray-500/60" onClick={onClose} />
        <div className="relative z-10 w-full max-w-md bg-white rounded-lg shadow-xl">
          <div className="border-b border-gray-200 px-6 py-4">
            <h3 className="text-base font-semibold text-gray-900">Add Feature of Work</h3>
          </div>
          <div className="px-6 py-4 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-gray-700">Name</span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
                placeholder="e.g., Slab on Grade — Bldg 2"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-gray-700">Trade <span className="text-gray-400">(optional)</span></span>
              <input
                type="text"
                value={trade}
                onChange={e => setTrade(e.target.value)}
                placeholder="e.g., Concrete"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-gray-700">Spec Sections <span className="text-gray-400">(comma-separated, optional)</span></span>
              <input
                type="text"
                value={specSectionsStr}
                onChange={e => setSpecSectionsStr(e.target.value)}
                placeholder="03 30 00, 03 11 00"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="border-t border-gray-200 px-6 py-3 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="px-3 py-1.5 text-sm border border-indigo-600 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function FowReadinessTab({ projectId }: FowReadinessTabProps) {
  const [data, setData] = useState<FowApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/projects/${projectId}/features-of-work`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `Request failed: ${res.status}`)
        }
        const json: FowApiResponse = await res.json()
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [projectId, refreshKey])

  const refresh = () => setRefreshKey(k => k + 1)

  const handleSuggest = async () => {
    setSuggesting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/features-of-work/suggest`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to generate suggestions')
      }
      const result = await res.json()
      if (result.created === 0 && result.updated === 0) {
        alert('No new suggestions — all CSI divisions in the submittal data are already covered by existing FOWs.')
      }
      refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to suggest')
    } finally {
      setSuggesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600 mb-3" />
          <p className="text-sm text-gray-500">Loading features of work…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>
  }

  const isEmpty = data && data.features.length === 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="grid grid-cols-3 gap-3 flex-1">
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-500">Features of Work</p>
            <p className="text-2xl font-semibold text-gray-900">{data?.totals.fowCount ?? 0}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-500">Submittals linked</p>
            <p className="text-2xl font-semibold text-gray-900">{data?.totals.submittalsLinked ?? 0}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-500">Submittals unlinked</p>
            <p className="text-2xl font-semibold text-gray-900">{data?.totals.submittalsUnlinked ?? 0}</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleSuggest}
            disabled={suggesting}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {suggesting ? 'Generating…' : 'Suggest from spec data'}
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="px-3 py-2 text-sm border border-indigo-600 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer whitespace-nowrap"
          >
            Add Feature of Work
          </button>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="rounded-md bg-gray-50 border border-gray-200 px-4 py-8 text-center space-y-2">
          <p className="text-sm font-medium text-gray-700">No features of work yet</p>
          <p className="text-xs text-gray-500">
            Use <span className="font-medium">Suggest from spec data</span> to auto-generate features from your submittal register,
            or <span className="font-medium">Add Feature of Work</span> to create one manually.
          </p>
        </div>
      )}

      {/* FOW list */}
      {data && data.features.length > 0 && (
        <div className="space-y-2">
          {data.features.map(f => (
            <FowRow key={f.fow.id} data={f} projectId={projectId} onChanged={refresh} />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateFowModal
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onCreated={refresh}
        />
      )}
    </div>
  )
}
