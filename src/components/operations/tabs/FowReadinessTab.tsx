'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import type { FowReadiness } from '@/lib/graph/fow-readiness'
import { LifecycleBadge } from '../../submittal/LifecycleBadge'

interface FowReadinessTabProps {
  projectId: string
}

interface SubmittalSummary {
  id: string
  title: string
  specSection: string | null
  lifecycleStatus: string
  fowEntityId: string | null
}

interface FowApiResponse {
  features: FowReadiness[]
  totals: {
    fowCount: number
    submittalsLinked: number
    submittalsUnlinked: number
  }
  allSubmittals: SubmittalSummary[]
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
        body: JSON.stringify({ name: name.trim() }),
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
            <p className="text-xs text-gray-500 mt-0.5">
              Define a work activity for this project. Examples: &ldquo;Slab on Grade — Bldg 2&rdquo;, &ldquo;MEP Rough-in&rdquo;, &ldquo;Site Grading&rdquo;.
            </p>
          </div>
          <div className="px-6 py-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !saving) handleSave() }}
                autoFocus
                placeholder="e.g., Slab on Grade — Bldg 2"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
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
// Tag submittals modal — picker with search + spec section filter + checkboxes
// ---------------------------------------------------------------------------

function TagSubmittalsModal({
  projectId,
  fow,
  allSubmittals,
  onClose,
  onSaved,
}: {
  projectId: string
  fow: FowReadiness['fow']
  allSubmittals: SubmittalSummary[]
  onClose: () => void
  onSaved: () => void
}) {
  const [search, setSearch] = useState('')
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(true)
  // Pre-select submittals already on this FOW
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(allSubmittals.filter(s => s.fowEntityId === fow.id).map(s => s.id))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allSubmittals.filter(s => {
      if (showOnlyUnassigned && s.fowEntityId && s.fowEntityId !== fow.id) return false
      if (!q) return true
      return s.title.toLowerCase().includes(q) || (s.specSection?.toLowerCase().includes(q) ?? false)
    })
  }, [allSubmittals, search, showOnlyUnassigned, fow.id])

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAllFiltered = () => {
    const allFilteredSelected = filtered.every(s => selected.has(s.id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const s of filtered) next.delete(s.id)
      } else {
        for (const s of filtered) next.add(s.id)
      }
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      // Submittals to assign: in selected
      const toAssign = Array.from(selected)
      // Submittals to unassign: currently on this FOW but no longer selected
      const toUnassign = allSubmittals
        .filter(s => s.fowEntityId === fow.id && !selected.has(s.id))
        .map(s => s.id)

      if (toAssign.length > 0) {
        const res = await fetch(`/api/projects/${projectId}/features-of-work/${fow.id}/submittals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submittalIds: toAssign }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? 'Failed to assign submittals')
        }
      }

      if (toUnassign.length > 0) {
        const res = await fetch(`/api/projects/${projectId}/features-of-work/${fow.id}/submittals`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submittalIds: toUnassign }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? 'Failed to unassign submittals')
        }
      }

      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-start justify-center p-4 pt-16">
        <div className="fixed inset-0 bg-gray-500/60" onClick={onClose} />
        <div className="relative z-10 w-full max-w-3xl bg-white rounded-lg shadow-xl flex flex-col" style={{ maxHeight: '85vh' }}>
          <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Tag submittals — {fow.displayName}</h3>
              <p className="text-xs text-gray-500 mt-0.5">Pick submittals required for this feature of work. {selected.size} selected.</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Filters */}
          <div className="px-6 py-3 border-b border-gray-200 space-y-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by title or spec section…"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOnlyUnassigned}
                  onChange={e => setShowOnlyUnassigned(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Hide submittals already tagged to other FOWs
              </label>
              <button
                onClick={toggleAllFiltered}
                className="text-xs text-indigo-600 hover:text-indigo-700 cursor-pointer"
              >
                {filtered.every(s => selected.has(s.id)) ? 'Deselect all visible' : 'Select all visible'}
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-6 py-3">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">No submittals match.</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {filtered.map(s => {
                  const isOnDifferentFow = s.fowEntityId && s.fowEntityId !== fow.id
                  return (
                    <li key={s.id} className="py-2">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={() => toggleOne(s.id)}
                          className="mt-0.5 rounded border-gray-300"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 truncate">{s.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                            {s.specSection && <span>{s.specSection}</span>}
                            {isOnDifferentFow && <span className="text-amber-600">• already tagged to another FOW</span>}
                          </div>
                        </div>
                        <LifecycleBadge status={s.lifecycleStatus as Parameters<typeof LifecycleBadge>[0]['status']} compact />
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 px-6 py-3 flex justify-between items-center">
            {error && <p className="text-sm text-red-600 mr-auto">{error}</p>}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 text-sm border border-indigo-600 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Saving…' : `Save ${selected.size} submittals`}
              </button>
            </div>
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
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [tagFow, setTagFow] = useState<FowReadiness['fow'] | null>(null)
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
        <button
          onClick={() => setCreateOpen(true)}
          className="px-3 py-2 text-sm border border-indigo-600 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer whitespace-nowrap"
        >
          Add Feature of Work
        </button>
      </div>

      {/* Empty state */}
      {data && data.features.length === 0 && (
        <div className="rounded-md bg-gray-50 border border-gray-200 px-4 py-6 text-center space-y-1">
          <p className="text-sm font-medium text-gray-700">No features of work yet</p>
          <p className="text-xs text-gray-500">Add one above, then tag submittals to it.</p>
        </div>
      )}

      {/* FOW list */}
      {data && data.features.length > 0 && (
        <div className="space-y-2">
          {data.features.map(f => {
            const id = f.fow.id
            const isExpanded = expandedId === id
            return (
              <div key={id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : id)}
                    className="flex-1 px-4 py-3 flex items-center gap-4 hover:bg-gray-50 cursor-pointer text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{f.fow.displayName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {f.approvedCount}/{f.totalCount} approved
                        {f.blockedCount > 0 && <span className="text-red-600 ml-2">• {f.blockedCount} blocked</span>}
                        {f.pendingCount > 0 && <span className="text-amber-600 ml-2">• {f.pendingCount} pending</span>}
                      </p>
                    </div>
                    <div className="flex-shrink-0 w-32">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${readinessColor(f.readinessPercent)}`}
                            style={{ width: `${f.readinessPercent}%` }}
                          />
                        </div>
                        <span className={`text-xs font-semibold w-9 text-right ${readinessTextColor(f.readinessPercent)}`}>
                          {f.readinessPercent}%
                        </span>
                      </div>
                    </div>
                    <svg
                      className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setTagFow(f.fow)}
                    className="mr-3 px-2 py-1 text-xs border border-gray-300 rounded text-gray-700 bg-white hover:bg-gray-50 cursor-pointer whitespace-nowrap"
                  >
                    Tag submittals
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-200 px-4 py-3 bg-gray-50 space-y-2">
                    {f.blockers.length === 0 ? (
                      <p className="text-sm text-gray-500">No blockers — all required submittals are approved.</p>
                    ) : (
                      <>
                        <p className="text-xs font-medium text-gray-700">Blocking submittals ({f.blockers.length})</p>
                        <ul className="space-y-1.5">
                          {f.blockers.map((s: SubmittalRegisterItem, i) => (
                            <li key={s.persistedItemId ?? i} className="flex items-start gap-2 text-sm">
                              <LifecycleBadge status={s.lifecycleStatus ?? 'draft'} compact />
                              <div className="flex-1 min-w-0">
                                <p className="text-gray-900 truncate">{s.submittalItem}</p>
                                {s.specSection && <p className="text-xs text-gray-500">{s.specSection}</p>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {createOpen && (
        <CreateFowModal
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onCreated={refresh}
        />
      )}

      {tagFow && data && (
        <TagSubmittalsModal
          projectId={projectId}
          fow={tagFow}
          allSubmittals={data.allSubmittals}
          onClose={() => setTagFow(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
