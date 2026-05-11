'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  LatestSubmittalRegisterRun,
  SubmittalRegisterItem,
} from '@/lib/chat/submittal-register'
import type { QAFindingType } from '@/lib/chat/submittal-coverage-qa'
import { SubmittalRegisterReview } from './SubmittalRegisterReview'
import { ArtifactReviewQueue } from './ArtifactReviewQueue'
import { OverviewTab } from './tabs/OverviewTab'
import { ApprovalsTab } from './tabs/ApprovalsTab'
import { LongLeadTab } from './tabs/LongLeadTab'
import { ReconciliationTab } from './tabs/ReconciliationTab'
import { FowReadinessTab } from './tabs/FowReadinessTab'
import { resolveEffectiveStatus } from '@/lib/chat/submittal-lifecycle'

type Tab = 'overview' | 'register' | 'queue' | 'approvals' | 'longlead' | 'fow' | 'reconciliation'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'register', label: 'Register' },
  { id: 'queue', label: 'Review Queue' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'longlead', label: 'Long Lead' },
  { id: 'fow', label: 'Features of Work' },
  { id: 'reconciliation', label: 'Reconciliation' },
]

function patchItemFields(
  run: LatestSubmittalRegisterRun,
  itemId: string,
  updates: Partial<SubmittalRegisterItem>
): LatestSubmittalRegisterRun {
  const patch = (item: SubmittalRegisterItem): SubmittalRegisterItem =>
    item.persistedItemId === itemId ? { ...item, ...updates } : item
  return {
    ...run,
    items: run.items.map(patch),
    groupedSections: run.groupedSections.map(s => ({ ...s, items: s.items.map(patch) })),
    ungrouped: run.ungrouped.map(patch),
  }
}

interface SubmittalsCommandCenterProps {
  projectId: string
}

export function SubmittalsCommandCenter({ projectId }: SubmittalsCommandCenterProps) {
  const [data, setData] = useState<LatestSubmittalRegisterRun | null>(null)
  const [found, setFound] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [qaFindingFilter, setQaFindingFilter] = useState<QAFindingType | ''>('')

  const handleSelectFindingType = useCallback((type: QAFindingType) => {
    setActiveTab('register')
    setQaFindingFilter(type)
  }, [])

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/projects/${projectId}/submittal-register/latest`,
          { credentials: 'include' }
        )
        const body = await res.json()
        if (!res.ok || !body.success) {
          throw new Error(body?.error ?? `Request failed (${res.status})`)
        }
        setFound(Boolean(body.found))
        setData(body.found ? (body.run as LatestSubmittalRegisterRun) : null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load submittal register')
        setData(null)
        setFound(null)
      } finally {
        if (mode === 'initial') setLoading(false)
        else setRefreshing(false)
      }
    },
    [projectId]
  )

  useEffect(() => { load('initial') }, [load])

  const patchItem = useCallback(
    (itemId: string, updates: Partial<SubmittalRegisterItem>) => {
      setData(prev => (prev ? patchItemFields(prev, itemId, updates) : prev))
    },
    []
  )

  const artifactPendingCount =
    data?.items.filter(i => i.artifactReviewStatus === 'artifact_suspected').length ?? 0

  const approvalsPendingCount =
    data?.items.filter(i => {
      const s = resolveEffectiveStatus(i)
      return ['pending_review', 'submitted', 'revise_resubmit'].includes(s)
    }).length ?? 0

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-gray-500">Loading submittal register…</p>
      </div>
    )
  }

  // Error state — no tab bar
  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
        <button
          onClick={() => load('refresh')}
          disabled={refreshing}
          className="mt-3 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
        >
          {refreshing ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    )
  }

  // No run yet — no tab bar
  if (found === false) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="rounded-md bg-gray-50 border border-gray-200 p-4">
          <p className="text-sm text-gray-700">
            No submittal register run exists for this project yet.
          </p>
        </div>
      </div>
    )
  }

  // Data available — show tabs
  return (
    <div className="bg-white rounded-lg shadow">
      {/* Tab bar */}
      <div className="border-b border-gray-200 px-6 pt-4">
        <div className="flex items-center justify-between">
          <nav className="-mb-px flex gap-0" aria-label="Submittals">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
                {tab.id === 'queue' && artifactPendingCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                    {artifactPendingCount}
                  </span>
                )}
                {tab.id === 'approvals' && approvalsPendingCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {approvalsPendingCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <button
            onClick={() => load('refresh')}
            disabled={refreshing}
            className="mb-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {data && (
          <>
            {activeTab === 'overview' && (
              <OverviewTab
                items={data.items}
                onSelectFindingType={handleSelectFindingType}
              />
            )}
            {activeTab === 'register' && (
              <SubmittalRegisterReview
                projectId={projectId}
                data={data}
                onPatchItem={patchItem}
                qaFindingFilter={qaFindingFilter}
                onQaFindingFilterChange={setQaFindingFilter}
              />
            )}
            {activeTab === 'queue' && (
              <ArtifactReviewQueue
                projectId={projectId}
                items={data.items}
                onResolved={(itemId, updates) =>
                  patchItem(itemId, {
                    ...(updates.submittalItem !== undefined
                      ? { submittalItem: updates.submittalItem }
                      : {}),
                    artifactReviewStatus: updates.artifactReviewStatus,
                  })
                }
              />
            )}
            {activeTab === 'approvals' && (
              <ApprovalsTab
                projectId={projectId}
                items={data.items}
                onPatchItem={patchItem}
              />
            )}
            {activeTab === 'longlead' && (
              <LongLeadTab
                projectId={projectId}
                items={data.items}
                onPatchItem={patchItem}
              />
            )}
            {activeTab === 'fow' && (
              <FowReadinessTab projectId={projectId} />
            )}
            {activeTab === 'reconciliation' && (
              <ReconciliationTab
                projectId={projectId}
                generatedItems={data.items}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
