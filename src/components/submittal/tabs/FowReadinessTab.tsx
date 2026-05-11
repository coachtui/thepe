'use client'

import { useEffect, useState } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import type { FowReadiness } from '@/lib/graph/fow-readiness'
import { LifecycleBadge } from '../LifecycleBadge'

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

export function FowReadinessTab({ projectId }: FowReadinessTabProps) {
  const [data, setData] = useState<FowApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
  }, [projectId])

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
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    )
  }

  if (!data || data.features.length === 0) {
    return (
      <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 space-y-1">
        <p className="text-sm font-medium text-amber-800">No features of work yet.</p>
        <p className="text-xs text-amber-700">
          FOW entities are created from submittal data via the backfill script.
          Run <code className="px-1 py-0.5 rounded bg-amber-100 text-amber-900 font-mono">node scripts/backfill-fow-entities.mjs</code> to populate from existing submittals.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header totals */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500">Features of Work</p>
          <p className="text-2xl font-semibold text-gray-900">{data.totals.fowCount}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500">Submittals linked</p>
          <p className="text-2xl font-semibold text-gray-900">{data.totals.submittalsLinked}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500">Submittals unlinked</p>
          <p className="text-2xl font-semibold text-gray-900">{data.totals.submittalsUnlinked}</p>
        </div>
      </div>

      {/* FOW list — worst-first */}
      <div className="space-y-2">
        {data.features.map(f => {
          const id = f.fow.id
          const isExpanded = expandedId === id
          return (
            <div key={id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : id)}
                className="w-full px-4 py-3 flex items-center gap-4 hover:bg-gray-50 cursor-pointer text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{f.fow.displayName}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {f.approvedCount}/{f.totalCount} approved
                    {f.blockedCount > 0 && (
                      <span className="text-red-600 ml-2">• {f.blockedCount} blocked</span>
                    )}
                    {f.pendingCount > 0 && (
                      <span className="text-amber-600 ml-2">• {f.pendingCount} pending</span>
                    )}
                  </p>
                </div>

                {/* Readiness bar */}
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

              {/* Drill-in */}
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
                              {s.specSection && (
                                <p className="text-xs text-gray-500">{s.specSection}</p>
                              )}
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
    </div>
  )
}
