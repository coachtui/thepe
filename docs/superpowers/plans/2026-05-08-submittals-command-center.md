# Submittals Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the submittals UI from a single full-page component into a 5-tab command center (Overview, Register, Review Queue, Approvals, Long Lead) so the main project page shows a decision surface instead of 1,200+ register rows.

**Architecture:** New `SubmittalsCommandCenter` component owns the data fetch and tab shell; existing components slot into tabs without internal rewrites. `SubmittalRegisterReview` loses its own fetch and receives data as props. `LifecycleSummary` and `ArtifactReviewQueue` move out of the register into their own tabs.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, existing `SubmittalRegisterItem` / `LatestSubmittalRegisterRun` types from `@/lib/chat/submittal-register`, existing lifecycle utilities from `@/lib/chat/submittal-lifecycle`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/components/submittal/SubmittalsCommandCenter.tsx` | Data fetch, tab shell, `patchItem` callback |
| **Create** | `src/components/submittal/tabs/OverviewTab.tsx` | LifecycleSummary + 3 computed summary sections |
| **Create** | `src/components/submittal/tabs/ApprovalsTab.tsx` | Filtered approval-workflow view |
| **Create** | `src/components/submittal/tabs/LongLeadTab.tsx` | Filtered long-lead / procurement-risk view |
| **Modify** | `src/components/submittal/SubmittalRegisterReview.tsx` | Accept data as props, remove fetch + LifecycleSummary + ArtifactReviewQueue |
| **Modify** | `src/app/(dashboard)/projects/[id]/page.tsx` | Swap import + JSX |

No new API routes. No schema changes. `LifecycleSummary`, `LifecycleBadge`, `LifecycleControls`, `ArtifactReviewQueue` untouched internally.

---

## Task 1 — Create `SubmittalsCommandCenter`

**Files:**
- Create: `src/components/submittal/SubmittalsCommandCenter.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  LatestSubmittalRegisterRun,
  SubmittalRegisterItem,
} from '@/lib/chat/submittal-register'
import { SubmittalRegisterReview } from './SubmittalRegisterReview'
import { ArtifactReviewQueue } from './ArtifactReviewQueue'
import { OverviewTab } from './tabs/OverviewTab'
import { ApprovalsTab } from './tabs/ApprovalsTab'
import { LongLeadTab } from './tabs/LongLeadTab'

type Tab = 'overview' | 'register' | 'queue' | 'approvals' | 'longlead'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'register', label: 'Register' },
  { id: 'queue', label: 'Review Queue' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'longlead', label: 'Long Lead' },
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
      } finally {
        setLoading(false)
        setRefreshing(false)
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
    data?.items.filter(i =>
      ['pending_review', 'submitted', 'revise_resubmit'].includes(
        i.lifecycleStatus ?? 'draft'
      )
    ).length ?? 0

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-gray-500">Loading submittal register…</p>
      </div>
    )
  }

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
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 mb-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {found === false && !error && (
          <div className="rounded-md bg-gray-50 border border-gray-200 p-4">
            <p className="text-sm text-gray-700">
              No submittal register run exists for this project yet.
            </p>
          </div>
        )}
        {data && (
          <>
            {activeTab === 'overview' && <OverviewTab items={data.items} />}
            {activeTab === 'register' && (
              <SubmittalRegisterReview
                projectId={projectId}
                data={data}
                refreshing={refreshing}
                onRefresh={() => load('refresh')}
                onPatchItem={patchItem}
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
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles (tab content components don't exist yet — expect import errors only)**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: errors for missing `OverviewTab`, `ApprovalsTab`, `LongLeadTab` imports. No other errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/submittal/SubmittalsCommandCenter.tsx
git commit -m "feat: add SubmittalsCommandCenter tab shell with data fetch"
```

---

## Task 2 — Create `OverviewTab`

**Files:**
- Create: `src/components/submittal/tabs/OverviewTab.tsx`

- [ ] **Step 1: Create the `tabs/` directory and file**

```tsx
'use client'

import { useMemo } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import { LifecycleSummary } from '../LifecycleSummary'
import { LifecycleBadge } from '../LifecycleBadge'
import { resolveEffectiveStatus, isOverdue } from '@/lib/chat/submittal-lifecycle'

interface OverviewTabProps {
  items: SubmittalRegisterItem[]
}

export function OverviewTab({ items }: OverviewTabProps) {
  const priorityItems = useMemo(() => {
    return items
      .filter(i => {
        const status = resolveEffectiveStatus(i)
        return (
          isOverdue(i.lifecycleDueDate) ||
          status === 'revise_resubmit'
        )
      })
      .sort((a, b) => {
        // Overdue first, then by due date ascending
        const aOverdue = isOverdue(a.lifecycleDueDate) ? 0 : 1
        const bOverdue = isOverdue(b.lifecycleDueDate) ? 0 : 1
        if (aOverdue !== bOverdue) return aOverdue - bOverdue
        const aDate = a.lifecycleDueDate ?? ''
        const bDate = b.lifecycleDueDate ?? ''
        return aDate < bDate ? -1 : aDate > bDate ? 1 : 0
      })
  }, [items])

  const recentlyApproved = useMemo(() => {
    return items
      .filter(i => {
        const s = resolveEffectiveStatus(i)
        return s === 'approved' || s === 'approved_as_noted'
      })
      .sort((a, b) => {
        const aT = a.lifecycleApprovedAt ?? a.lifecycleSubmittedAt ?? ''
        const bT = b.lifecycleApprovedAt ?? b.lifecycleSubmittedAt ?? ''
        return aT > bT ? -1 : aT < bT ? 1 : 0
      })
      .slice(0, 10)
  }, [items])

  const longLeadRisks = useMemo(() => {
    return items
      .filter(i => i.lifecycleLongLeadFlag === true || (i.lifecycleLeadTimeDays ?? 0) > 0)
      .sort((a, b) => (b.lifecycleLeadTimeDays ?? 0) - (a.lifecycleLeadTimeDays ?? 0))
      .slice(0, 10)
  }, [items])

  return (
    <div className="space-y-6">
      <LifecycleSummary items={items} />

      {/* High-Priority Action Queue */}
      <section>
        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          High-Priority Action Queue
        </h4>
        {priorityItems.length === 0 ? (
          <p className="text-sm text-gray-500">No overdue or revision-required items.</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md overflow-hidden">
            {priorityItems.map((item, idx) => (
              <li key={item.persistedItemId ?? idx} className="flex items-center gap-3 px-4 py-3 bg-white">
                <LifecycleBadge
                  status={resolveEffectiveStatus(item)}
                  overdue={isOverdue(item.lifecycleDueDate)}
                  compact
                />
                <span className="flex-1 text-sm text-gray-900 truncate">{item.submittalItem}</span>
                {item.specSection && (
                  <span className="text-xs text-gray-500 shrink-0">{item.specSection}</span>
                )}
                {item.lifecycleDueDate && (
                  <span className={`text-xs shrink-0 ${isOverdue(item.lifecycleDueDate) ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                    Due {item.lifecycleDueDate}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Recently Approved */}
        <section>
          <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Recently Approved
          </h4>
          {recentlyApproved.length === 0 ? (
            <p className="text-sm text-gray-500">No approved items yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md overflow-hidden">
              {recentlyApproved.map((item, idx) => (
                <li key={item.persistedItemId ?? idx} className="flex items-center gap-3 px-4 py-3 bg-white">
                  <LifecycleBadge status={resolveEffectiveStatus(item)} compact />
                  <span className="flex-1 text-sm text-gray-900 truncate">{item.submittalItem}</span>
                  {item.specSection && (
                    <span className="text-xs text-gray-500 shrink-0">{item.specSection}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Long-Lead Risks */}
        <section>
          <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Long-Lead Risks
          </h4>
          {longLeadRisks.length === 0 ? (
            <p className="text-sm text-gray-500">No long-lead items identified.</p>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md overflow-hidden">
              {longLeadRisks.map((item, idx) => {
                const weeks = item.lifecycleLeadTimeDays
                  ? Math.round(item.lifecycleLeadTimeDays / 7)
                  : null
                return (
                  <li key={item.persistedItemId ?? idx} className="flex items-center gap-3 px-4 py-3 bg-white">
                    {weeks !== null && (
                      <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                        {weeks}wk
                      </span>
                    )}
                    <span className="flex-1 text-sm text-gray-900 truncate">{item.submittalItem}</span>
                    {item.specSection && (
                      <span className="text-xs text-gray-500 shrink-0">{item.specSection}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify no TypeScript errors in this file**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1 | grep "tabs/OverviewTab"
```

Expected: no output (no errors in this file).

- [ ] **Step 3: Commit**

```bash
git add src/components/submittal/tabs/OverviewTab.tsx
git commit -m "feat: add OverviewTab with lifecycle summary and priority sections"
```

---

## Task 3 — Create `ApprovalsTab`

**Files:**
- Create: `src/components/submittal/tabs/ApprovalsTab.tsx`

- [ ] **Step 1: Create the file**

```tsx
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

const REVIEW_STATUS_LABELS: Record<typeof REVIEW_STATUSES[number], string> = {
  pending: 'Pending',
  approved: 'Approved',
  approved_as_noted: 'Approved as noted',
  rejected: 'Rejected',
  needs_clarification: 'Needs clarification',
  superseded: 'Superseded',
}

interface DraftState {
  status: typeof REVIEW_STATUSES[number]
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
      APPROVAL_STATUSES.includes(
        (i.lifecycleStatus ?? 'draft') as typeof APPROVAL_STATUSES[number]
      )
    )
  }, [items])

  const getDraft = (item: SubmittalRegisterItem): DraftState => {
    const id = item.persistedItemId ?? ''
    return (
      drafts[id] ?? {
        status: (item.reviewStatus as typeof REVIEW_STATUSES[number]) ?? 'pending',
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
          draft.status !== ((item.reviewStatus as typeof REVIEW_STATUSES[number]) ?? 'pending') ||
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
                      [id]: { ...getDraft(item), status: e.target.value as typeof REVIEW_STATUSES[number] },
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
```

- [ ] **Step 2: Verify no TypeScript errors in this file**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1 | grep "tabs/ApprovalsTab"
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/submittal/tabs/ApprovalsTab.tsx
git commit -m "feat: add ApprovalsTab with filtered approval workflow view"
```

---

## Task 4 — Create `LongLeadTab`

**Files:**
- Create: `src/components/submittal/tabs/LongLeadTab.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client'

import { useMemo } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import { LifecycleBadge } from '../LifecycleBadge'
import { LifecycleControls } from '../LifecycleControls'
import { resolveEffectiveStatus, isOverdue } from '@/lib/chat/submittal-lifecycle'

interface LongLeadTabProps {
  projectId: string
  items: SubmittalRegisterItem[]
  onPatchItem: (itemId: string, updates: Partial<SubmittalRegisterItem>) => void
}

type RiskLevel = 'critical' | 'high' | 'moderate' | 'ordered'

function deriveRisk(item: SubmittalRegisterItem): RiskLevel {
  const status = resolveEffectiveStatus(item)
  if (status === 'approved' || status === 'approved_as_noted' || status === 'closed') {
    return 'ordered'
  }
  const days = item.lifecycleLeadTimeDays ?? 0
  if (days >= 140) return 'critical' // ≥ 20 weeks
  if (days >= 84) return 'high'      // ≥ 12 weeks
  return 'moderate'
}

const RISK_CLASSES: Record<RiskLevel, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-amber-100 text-amber-800',
  moderate: 'bg-blue-100 text-blue-800',
  ordered: 'bg-green-100 text-green-800',
}

const RISK_LABELS: Record<RiskLevel, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  ordered: 'Ordered',
}

export function LongLeadTab({ projectId, items, onPatchItem }: LongLeadTabProps) {
  const longLeadItems = useMemo(() => {
    return items
      .filter(
        i =>
          i.lifecycleLongLeadFlag === true ||
          (i.lifecycleLeadTimeDays != null && i.lifecycleLeadTimeDays > 0)
      )
      .sort((a, b) => (b.lifecycleLeadTimeDays ?? 0) - (a.lifecycleLeadTimeDays ?? 0))
  }, [items])

  if (longLeadItems.length === 0) {
    return <p className="text-sm text-gray-500 py-4">No long-lead items identified.</p>
  }

  return (
    <div className="space-y-3">
      {longLeadItems.map((item, idx) => {
        const id = item.persistedItemId ?? String(idx)
        const weeks = item.lifecycleLeadTimeDays
          ? Math.round(item.lifecycleLeadTimeDays / 7)
          : null
        const risk = deriveRisk(item)
        const overdue = isOverdue(item.lifecycleDueDate)

        return (
          <div key={id} className="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {item.submittalItem}
                </p>
                {item.specSection && (
                  <p className="text-xs text-gray-500 mt-0.5">{item.specSection}</p>
                )}
              </div>
              {weeks !== null && (
                <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                  {weeks}wk
                </span>
              )}
              <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${RISK_CLASSES[risk]}`}>
                {RISK_LABELS[risk]}
              </span>
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
```

- [ ] **Step 2: Verify no TypeScript errors in this file**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1 | grep "tabs/LongLeadTab"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/submittal/tabs/LongLeadTab.tsx
git commit -m "feat: add LongLeadTab with procurement risk view"
```

---

## Task 5 — Refactor `SubmittalRegisterReview` to accept props

**Files:**
- Modify: `src/components/submittal/SubmittalRegisterReview.tsx`

This is the most invasive change. The goal: remove the internal data fetch, remove `LifecycleSummary` and `ArtifactReviewQueue` from the render, and accept data as props.

**What changes:**
1. Props interface: add `data`, `refreshing`, `onRefresh`, `onPatchItem`; remove nothing else
2. Remove from imports: `useCallback`, `useEffect`, `ArtifactReviewQueue`, `LifecycleSummary`
3. Remove state: `data`, `found`, `loading`, `refreshing`, `error`
4. Remove: `load` callback, `useEffect`, `handleArtifactResolved`, `handleLifecycleTransitioned`
5. Remove: `patchItemFields` and `patchItemInRun` helper functions at bottom of file
6. Simplify: `handleSave` — replace `setData(patchItemInRun(...))` with `onPatchItem(itemId, {...updated})`
7. Simplify: `orderedSections` useMemo — uses `data.groupedSections` directly (data is now a prop)
8. Render: remove loading return, remove top-level loading/error/found checks, remove Refresh button, remove `<LifecycleSummary>`, remove `<ArtifactReviewQueue>`, pass `onPatchItem` as `onLifecycleTransitioned`

- [ ] **Step 1: Update the props interface (line 13-15)**

Old:
```tsx
interface SubmittalRegisterReviewProps {
  projectId: string
}
```

New:
```tsx
interface SubmittalRegisterReviewProps {
  projectId: string
  data: LatestSubmittalRegisterRun
  refreshing: boolean
  onRefresh: () => void
  onPatchItem: (itemId: string, updates: Partial<SubmittalRegisterItem>) => void
}
```

- [ ] **Step 2: Update imports — remove `useCallback`, `useEffect`, `ArtifactReviewQueue`, `LifecycleSummary`**

Old lines 1-11:
```tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  LatestSubmittalRegisterRun,
  SubmittalRegisterGroup,
  SubmittalRegisterItem,
} from '@/lib/chat/submittal-register'
import { ArtifactReviewQueue } from './ArtifactReviewQueue'
import { LifecycleSummary } from './LifecycleSummary'
import { LifecycleControls } from './LifecycleControls'
```

New:
```tsx
'use client'

import { useMemo, useState } from 'react'
import type {
  LatestSubmittalRegisterRun,
  SubmittalRegisterGroup,
  SubmittalRegisterItem,
} from '@/lib/chat/submittal-register'
import { LifecycleControls } from './LifecycleControls'
```

- [ ] **Step 3: Replace the function body opening — remove state/fetch, keep drafts/rowSave**

Old (lines 62-100, the full state + load block):
```tsx
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
```

New:
```tsx
export function SubmittalRegisterReview({
  projectId,
  data,
  refreshing,
  onRefresh,
  onPatchItem,
}: SubmittalRegisterReviewProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})
  const [rowSave, setRowSave] = useState<Record<string, RowSaveState>>({})
```

- [ ] **Step 4: Remove the `load` callback, `useEffect`, and `handleArtifactResolved` / `handleLifecycleTransitioned`**

Delete these blocks entirely (approximately lines 72–207 in the original, from `const load = useCallback` through `handleLifecycleTransitioned`'s closing `}`):

```tsx
  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      // ... entire block
    },
    [projectId]
  )

  useEffect(() => {
    load('initial')
  }, [load])

  // ... orderedSections useMemo (KEEP THIS — rewrite it below)

  // ... handleSetDraftStatus (KEEP)
  // ... handleSetDraftNotes (KEEP)
  // ... handleSave (KEEP but modify)
  // ... handleResetDraft (KEEP)

  const handleArtifactResolved = useCallback(...)   // DELETE
  const handleLifecycleTransitioned = useCallback(...)  // DELETE
```

Replace `orderedSections` useMemo with:
```tsx
  const orderedSections = useMemo(() => data.groupedSections, [data])
```

- [ ] **Step 5: Update `handleSave` — replace `setData(patchItemInRun(...))` with `onPatchItem(...)`**

Find the block after `const updated = body.item as {...}` and replace:
```tsx
      setData(prev => prev ? patchItemInRun(prev, itemId, updated) : prev)
```

With:
```tsx
      onPatchItem(itemId, {
        reviewStatus: updated.reviewStatus,
        reviewNotes: updated.reviewNotes,
        reviewedAt: updated.reviewedAt,
        reviewedByRole: updated.reviewedByRole,
      })
```

- [ ] **Step 6: Remove the loading early return**

Delete:
```tsx
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-2">Submittal Register Review</h3>
        <p className="text-sm text-gray-500">Loading latest submittal register…</p>
      </div>
    )
  }
```

- [ ] **Step 7: Update the render — remove outer shell, Refresh button, error/found blocks, LifecycleSummary, ArtifactReviewQueue**

The component no longer needs the wrapping `<div className="bg-white rounded-lg shadow p-6 space-y-4">` header section (the command center provides the container). Replace the full render return with:

```tsx
  return (
    <div className="space-y-4">
      {data.items.length === 0 ? (
        <p className="text-sm text-gray-500">No items in this submittal register run.</p>
      ) : (
        <>
          <RunSummary run={data} />
          <div className="space-y-4">
            {orderedSections.map(section => (
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
              />
            ))}
            {data.ungrouped.length > 0 && (
              <UngroupedCard
                items={data.ungrouped}
                projectId={projectId}
                drafts={drafts}
                rowSave={rowSave}
                onStatus={handleSetDraftStatus}
                onNotes={handleSetDraftNotes}
                onSave={handleSave}
                onReset={handleResetDraft}
                onLifecycleTransitioned={onPatchItem}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
```

- [ ] **Step 8: Remove `patchItemFields` and `patchItemInRun` helper functions**

Delete lines 664–705 (both functions at the bottom of the file).

- [ ] **Step 9: Run TypeScript check**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1 | grep "SubmittalRegisterReview"
```

Expected: no output. Fix any type errors before continuing.

- [ ] **Step 10: Commit**

```bash
git add src/components/submittal/SubmittalRegisterReview.tsx
git commit -m "refactor: SubmittalRegisterReview accepts data as props, removes fetch and summary components"
```

---

## Task 6 — Update project page

**Files:**
- Modify: `src/app/(dashboard)/projects/[id]/page.tsx`

- [ ] **Step 1: Swap the import**

Find:
```tsx
import { SubmittalRegisterReview } from '@/components/submittal/SubmittalRegisterReview'
```

Replace with:
```tsx
import { SubmittalsCommandCenter } from '@/components/submittal/SubmittalsCommandCenter'
```

- [ ] **Step 2: Swap the JSX (around line 444)**

Find:
```tsx
            {/* Submittal Register Review Section */}
            <div className="pt-6 border-t border-gray-200">
              <SubmittalRegisterReview projectId={params.id} />
            </div>
```

Replace with:
```tsx
            {/* Submittals Command Center */}
            <div className="pt-6 border-t border-gray-200">
              <SubmittalsCommandCenter projectId={params.id} />
            </div>
```

- [ ] **Step 3: Run full TypeScript check**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1
```

Expected: no errors. If there are errors, fix them before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/projects/[id]/page.tsx
git commit -m "feat: replace SubmittalRegisterReview with SubmittalsCommandCenter on project page"
```

---

## Task 7 — Build verification

- [ ] **Step 1: Run production build**

```bash
cd /Users/tui/thepe && npm run build 2>&1 | tail -30
```

Expected: build completes with no errors. Note any warnings.

- [ ] **Step 2: Report**

List all files changed and confirm build passes. If the build fails, check for:
- Missing imports (new tab files must be importable)
- Type mismatches (especially `onLifecycleTransitioned` vs `onPatchItem` signature — both are `(itemId: string, updates: Partial<SubmittalRegisterItem>) => void`)
- `data` being typed as non-nullable in `SubmittalRegisterReview` but nullable somewhere in the call chain

- [ ] **Step 3: Final commit of any fixes**

```bash
git add -A
git commit -m "fix: resolve build errors from command center refactor"
```

---

## Files Changed Summary

| File | Change type |
|------|-------------|
| `src/components/submittal/SubmittalsCommandCenter.tsx` | Created |
| `src/components/submittal/tabs/OverviewTab.tsx` | Created |
| `src/components/submittal/tabs/ApprovalsTab.tsx` | Created |
| `src/components/submittal/tabs/LongLeadTab.tsx` | Created |
| `src/components/submittal/SubmittalRegisterReview.tsx` | Modified — props refactor, remove fetch + summary components |
| `src/app/(dashboard)/projects/[id]/page.tsx` | Modified — swap component |
