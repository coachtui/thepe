# Spec Section Linkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add spec section traceability to the submittal register — 7 new optional type fields, SD code chips on rows, a filter bar, a source detail drawer, and a Spec Coverage card on the Overview tab.

**Architecture:** All new fields are optional additions to the existing `SubmittalRegisterItem` TypeScript interface, stored in `item_payload` JSONB (no DB migration). Filter state lives locally in `SubmittalRegisterReview`. The source detail drawer is a new slide-over component wired through a new `onViewSource` callback threaded via `SectionRenderProps`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-08-spec-section-linkage-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/chat/submittal-register.ts` | Modify (line 50) | Add 7 optional fields to `SubmittalRegisterItem` |
| `src/components/submittal/SourceDetailDrawer.tsx` | Create | Slide-over panel showing source location, excerpt, and submittal details |
| `src/components/submittal/SubmittalRegisterReview.tsx` | Modify | Add `onViewSource` to `SectionRenderProps`, SD code chip + View Source button on `ItemRow`, filter bar state + UI + filtered data derivation |
| `src/components/submittal/tabs/OverviewTab.tsx` | Modify | Add Spec Coverage card between `LifecycleSummary` and High-Priority Queue |

---

## Task 1: Extend `SubmittalRegisterItem` type

**Files:**
- Modify: `src/lib/chat/submittal-register.ts:50` (insert before closing `}` of the interface, after `lifecycleStatusHistory`)

- [ ] **Step 1: Insert new optional fields**

Open `src/lib/chat/submittal-register.ts`. The `SubmittalRegisterItem` interface closes at line 51. Add the following 7 lines immediately before the closing `}` (after the `lifecycleStatusHistory` line):

```typescript
  sdCode?: string | null
  approvalAuthority?: string | null
  sourcePage?: number | null
  sourceExcerpt?: string | null
  relatedFOW?: string | null
  scheduleActivity?: string | null
  blockingRisk?: 'none' | 'low' | 'medium' | 'high' | null
```

The block from line 44 should now read:

```typescript
  lifecycleDueDate?: string | null          // ISO date YYYY-MM-DD
  lifecycleLeadTimeDays?: number | null
  lifecycleLongLeadFlag?: boolean
  lifecycleSubmittedAt?: string | null      // ISO timestamp
  lifecycleApprovedAt?: string | null       // ISO timestamp
  lifecycleClosedAt?: string | null         // ISO timestamp
  lifecycleStatusHistory?: LifecycleHistoryEntry[]
  sdCode?: string | null
  approvalAuthority?: string | null
  sourcePage?: number | null
  sourceExcerpt?: string | null
  relatedFOW?: string | null
  scheduleActivity?: string | null
  blockingRisk?: 'none' | 'low' | 'medium' | 'high' | null
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1 | head -30
```

Expected: same errors as before (or none). No new errors introduced.

- [ ] **Step 3: Commit**

```bash
git add src/lib/chat/submittal-register.ts
git commit -m "feat: add spec section linkage fields to SubmittalRegisterItem"
```

---

## Task 2: Create `SourceDetailDrawer` component

**Files:**
- Create: `src/components/submittal/SourceDetailDrawer.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client'

import { useEffect } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'

interface SourceDetailDrawerProps {
  item: SubmittalRegisterItem | null
  onClose: () => void
}

export function SourceDetailDrawer({ item, onClose }: SourceDetailDrawerProps) {
  useEffect(() => {
    if (!item) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [item, onClose])

  if (!item) return null

  const heading = [item.specSection, item.sectionTitle].filter(Boolean).join(' · ')
  const docName = item.sourceReference?.documentName
  const pageNum = item.sourceReference?.pageNumber ?? item.sourcePage
  const excerpt = item.sourceExcerpt ?? item.excerpt

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-y-0 right-0 w-full max-w-[480px] bg-white shadow-xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 truncate">
            {heading || item.submittalItem}
          </h2>
          <button
            onClick={onClose}
            className="ml-4 text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {(docName || pageNum != null) && (
            <section>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Source location
              </p>
              <p className="text-sm text-gray-700">
                {[docName, pageNum != null ? `p.${pageNum}` : null].filter(Boolean).join(' · ')}
              </p>
            </section>
          )}
          {excerpt && (
            <section>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Spec excerpt
              </p>
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 border border-gray-200 rounded p-3 leading-relaxed">
                {excerpt}
              </pre>
            </section>
          )}
          {(item.sdCode || item.approvalAuthority || (item.blockingRisk && item.blockingRisk !== 'none')) && (
            <section>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Submittal details
              </p>
              <dl className="space-y-1">
                {item.sdCode && (
                  <div className="flex gap-3 text-sm">
                    <dt className="text-gray-500 w-36 shrink-0">SD code</dt>
                    <dd className="text-gray-900">{item.sdCode}</dd>
                  </div>
                )}
                {item.approvalAuthority && (
                  <div className="flex gap-3 text-sm">
                    <dt className="text-gray-500 w-36 shrink-0">Approval authority</dt>
                    <dd className="text-gray-900">{item.approvalAuthority}</dd>
                  </div>
                )}
                {item.blockingRisk && item.blockingRisk !== 'none' && (
                  <div className="flex gap-3 text-sm">
                    <dt className="text-gray-500 w-36 shrink-0">Blocking risk</dt>
                    <dd className="text-gray-900 capitalize">{item.blockingRisk}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}
          {item.notes && (
            <section>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Notes
              </p>
              <p className="text-sm text-gray-700">{item.notes}</p>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/submittal/SourceDetailDrawer.tsx
git commit -m "feat: add SourceDetailDrawer slide-over component"
```

---

## Task 3: Wire drawer into `SubmittalRegisterReview` + ItemRow UI updates

**Files:**
- Modify: `src/components/submittal/SubmittalRegisterReview.tsx`

This task makes four changes to the file:
1. Import `SourceDetailDrawer` and `useMemo`
2. Add `onViewSource` to `SectionRenderProps`
3. Add `selectedSourceItem` state + handler in `SubmittalRegisterReview`; thread `onViewSource` to `SectionCard` and `UngroupedCard`; render `SourceDetailDrawer`
4. Add SD code chip + View Source button to `ItemRow`

- [ ] **Step 1: Update the import line**

Change line 3 from:
```typescript
import { useEffect, useState } from 'react'
```
to:
```typescript
import { useEffect, useMemo, useState } from 'react'
```

Add the `SourceDetailDrawer` import after the existing imports block (after the `LifecycleControls` import):
```typescript
import { SourceDetailDrawer } from './SourceDetailDrawer'
```

- [ ] **Step 2: Add `onViewSource` to `SectionRenderProps`**

`SectionRenderProps` is at line 281. Add one line after `onLifecycleTransitioned`:

```typescript
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
```

- [ ] **Step 3: Add state, handler, and drawer to `SubmittalRegisterReview`**

In the `SubmittalRegisterReview` function body, add one more `useState` after the existing two:

```typescript
const [selectedSourceItem, setSelectedSourceItem] = useState<SubmittalRegisterItem | null>(null)
```

Then add `onViewSource` when calling `SectionCard` and `UngroupedCard`. Both currently receive `onLifecycleTransitioned={onPatchItem}`. Add `onViewSource={setSelectedSourceItem}` to each call:

For `SectionCard` (around line 157–170):
```tsx
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
```

For `UngroupedCard` (around line 174–183):
```tsx
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
  onViewSource={setSelectedSourceItem}
/>
```

Add `SourceDetailDrawer` at the very bottom of the `SubmittalRegisterReview` return, just before the outer closing `</div>`:
```tsx
      <SourceDetailDrawer
        item={selectedSourceItem}
        onClose={() => setSelectedSourceItem(null)}
      />
    </div>
  )
```

- [ ] **Step 4: Thread `onViewSource` through `SectionCard` and `UngroupedCard`**

Both internal functions receive and forward `SectionRenderProps`. Add `onViewSource` to their destructuring and forward it to `ItemRow`.

In `SectionCard` (destructuring around line 291):
```tsx
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
```

And in the `ItemRow` call inside `SectionCard`:
```tsx
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
```

In `UngroupedCard` (destructuring around line 365):
```tsx
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
```

And forward to `ItemRow` inside `UngroupedCard`:
```tsx
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
```

- [ ] **Step 5: Add SD code chip + View Source button to `ItemRow`**

In `ItemRow`'s destructuring (around line 403), add `onViewSource`:
```tsx
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
```

Add this constant near the top of `ItemRow` body (after the existing `const save = ...` line):
```tsx
const hasSource = !!(item.sourceExcerpt ?? item.excerpt ?? item.sourceReference?.pageNumber)
```

**Header row** — add the View Source button after the status pill in the first `<div className="flex flex-wrap items-start gap-2">`:
```tsx
<div className="flex flex-wrap items-start gap-2">
  <p className="flex-1 min-w-0 text-sm text-gray-900">{item.submittalItem}</p>
  <span className={`px-2 py-0.5 text-xs font-medium rounded ${STATUS_PILL_CLASSES[currentStatus]}`}>
    {STATUS_LABELS[currentStatus]}
  </span>
  {hasSource && (
    <button
      type="button"
      onClick={() => onViewSource(item)}
      className="px-2 py-0.5 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
      title="View source excerpt"
    >
      View source
    </button>
  )}
</div>
```

**Chips row** — add SD code chip in the second `<div className="flex flex-wrap items-center gap-2 text-xs">`, after the existing `{item.submittalType && ...}` chip:
```tsx
{item.sdCode && (
  <span className="px-2 py-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded">
    {item.sdCode}
  </span>
)}
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors. If you see "Property 'onViewSource' does not exist", check that `SectionRenderProps` was updated and all call sites forwarded it.

- [ ] **Step 7: Commit**

```bash
git add src/components/submittal/SubmittalRegisterReview.tsx
git commit -m "feat: add View Source drawer and SD code chip to register rows"
```

---

## Task 4: Add filter bar to `SubmittalRegisterReview`

**Files:**
- Modify: `src/components/submittal/SubmittalRegisterReview.tsx`

- [ ] **Step 1: Add filter state**

In `SubmittalRegisterReview` function body, after the existing `useState` calls, add:

```typescript
const [specSectionFilter, setSpecSectionFilter] = useState('')
const [sdCodeFilter, setSdCodeFilter] = useState('')
const [approvalAuthorityFilter, setApprovalAuthorityFilter] = useState('')
const [blockingRiskFilter, setBlockingRiskFilter] = useState('')
```

Also reset filters when data changes — update the existing `useEffect`:
```typescript
useEffect(() => {
  setDrafts({})
  setRowSave({})
  setSpecSectionFilter('')
  setSdCodeFilter('')
  setApprovalAuthorityFilter('')
  setBlockingRiskFilter('')
}, [data])
```

- [ ] **Step 2: Add filtered data derivation**

After the filter state, add three `useMemo` calls:

```typescript
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
```

- [ ] **Step 3: Replace data references in render with filteredData**

In the render, update the three places that currently reference `data.groupedSections`, `data.ungrouped`, and `data.items.length`:

Change:
```tsx
{data.items.length === 0 ? (
```
to:
```tsx
{data.items.length === 0 ? (
```
(Leave the empty-state check on the raw `data.items.length` — this checks if there's any data at all, not whether filters match.)

Change:
```tsx
{data.groupedSections.map(section => (
```
to:
```tsx
{filteredData.groupedSections.map(section => (
```

Change:
```tsx
{data.ungrouped.length > 0 && (
  <UngroupedCard
    items={data.ungrouped}
```
to:
```tsx
{filteredData.ungrouped.length > 0 && (
  <UngroupedCard
    items={filteredData.ungrouped}
```

- [ ] **Step 4: Add filter bar UI**

Insert the filter bar between `<RunSummary run={data} />` and `<div className="space-y-4">` (the sections container):

```tsx
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
      className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
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
      className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
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
      className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
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
      className="text-sm text-blue-600 hover:underline"
    >
      Clear filters
    </button>
  )}
</div>

<div className="space-y-4">
```

Also add a "no results" message inside the sections container when filters are active but nothing matches:

```tsx
<div className="space-y-4">
  {filtersActive && filteredData.items.length === 0 && (
    <p className="text-sm text-gray-500 py-4 text-center">No items match the current filters.</p>
  )}
  {filteredData.groupedSections.map(section => (
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/submittal/SubmittalRegisterReview.tsx
git commit -m "feat: add filter bar to submittal register (spec section, SD code, authority, risk)"
```

---

## Task 5: Add Spec Coverage card to Overview tab

**Files:**
- Modify: `src/components/submittal/tabs/OverviewTab.tsx`

- [ ] **Step 1: Add `specCoverage` useMemo**

In `OverviewTab`, add this `useMemo` after the existing `longLeadRisks` useMemo (around line 52):

```typescript
const specCoverage = useMemo(() => {
  let specLinked = 0
  let missingSpec = 0
  let govtApproval = 0
  let blockingRisk = 0
  for (const item of items) {
    if (item.specSection) specLinked++
    else missingSpec++
    if (item.approvalAuthority === 'Government') govtApproval++
    if (item.blockingRisk === 'medium' || item.blockingRisk === 'high') blockingRisk++
  }
  return { specLinked, missingSpec, govtApproval, blockingRisk }
}, [items])
```

- [ ] **Step 2: Insert Spec Coverage card in JSX**

In the `return` block, insert the following between `<LifecycleSummary items={items} />` and the `{/* High-Priority Action Queue */}` section comment:

```tsx
<LifecycleSummary items={items} />

<div className="rounded-md border border-gray-200 p-3">
  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Spec Coverage</p>
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
    {([
      { label: 'Spec-linked', value: specCoverage.specLinked, warn: false },
      { label: 'Missing spec link', value: specCoverage.missingSpec, warn: true },
      { label: "Gov't approval required", value: specCoverage.govtApproval, warn: false },
      { label: 'Blocking risk', value: specCoverage.blockingRisk, warn: true },
    ] as const).map(({ label, value, warn }) => (
      <div key={label} className="text-center px-3 py-2 bg-white rounded border border-gray-200">
        <div className={`text-lg font-semibold tabular-nums ${warn && value > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
          {value}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      </div>
    ))}
  </div>
</div>

{/* High-Priority Action Queue */}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/submittal/tabs/OverviewTab.tsx
git commit -m "feat: add Spec Coverage card to Overview tab"
```

---

## Task 6: Build verification and report

- [ ] **Step 1: Run full TypeScript check**

```bash
cd /Users/tui/thepe && npx tsc --noEmit 2>&1
```

Record output. Expected: zero new errors compared to pre-implementation baseline.

- [ ] **Step 2: Run Next.js build**

```bash
cd /Users/tui/thepe && npm run build 2>&1 | tail -30
```

Expected: build succeeds. If it fails, note the error and fix before reporting complete.

- [ ] **Step 3: Report files changed**

```bash
git log --oneline main~4..main
```

Report the 4 commits and their files:
1. `src/lib/chat/submittal-register.ts`
2. `src/components/submittal/SourceDetailDrawer.tsx` (new)
3. `src/components/submittal/SubmittalRegisterReview.tsx`
4. `src/components/submittal/tabs/OverviewTab.tsx`
