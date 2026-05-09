# Spec Section Linkage — Design Spec

**Date:** 2026-05-08  
**Status:** Approved  
**Scope:** Incremental — type extension + UI only. No DB migration. No FOW or schedule logic.

---

## Goal

Make each submittal register item traceable to its source specification section, with enough metadata to support future linkage to Features of Work and schedule activities. Add filtering and a source detail drawer to the register UI. Add a Spec Coverage summary card to the Overview tab.

---

## What Already Exists (No Change Needed)

- `specSection: string | null` — spec section number, e.g. `"03 30 00"`. Already in type + DB column.
- `sectionTitle: string | null` — human-readable section title. Already in type + DB column. (User listed as `specTitle` — same field.)
- `submittalType: string | null` — already in type + DB column.
- `approvalRequired: boolean | null` — boolean flag. Already in type + DB column.
- `excerpt: string | null` — general extraction excerpt. Already in type.
- `sourceReference` — structured object including `pageNumber`, `documentName`, `specSection`. Already in type.

---

## Section 1 — Type Extension

**File:** `src/lib/chat/submittal-register.ts`

Add 7 optional fields to `SubmittalRegisterItem`. All stored in `item_payload` JSONB (same pattern as lifecycle fields). No DB migration required. All fields optional and nullable — no existing data breaks.

```typescript
sdCode?: string | null           // submittal designator, e.g. "SD-02", "SD-06"
approvalAuthority?: string | null  // e.g. "Government", "A/E", "Contractor"
sourcePage?: number | null       // page number in source spec document
sourceExcerpt?: string | null    // verbatim spec requirement text (pipeline-set)
relatedFOW?: string | null       // future: Feature of Work ID
scheduleActivity?: string | null // future: schedule activity ID
blockingRisk?: 'none' | 'low' | 'medium' | 'high' | null
```

---

## Section 2 — Register Row UI

**File:** `src/components/submittal/SubmittalRegisterReview.tsx`

Two additive changes to `ItemRow`. No existing content moves.

**SD code chip:** When `item.sdCode` is present, render a small gray chip next to the submittal item name (e.g. `SD-02`). Same visual weight as the lifecycle badge.

**"View Source" icon button:** Shown when source data is available — `item.sourceExcerpt ?? item.excerpt ?? item.sourceReference?.pageNumber`. Small document icon on the right edge of the row. Click sets `selectedSourceItem` state in the parent component, opening the drawer.

---

## Section 3 — Filter Bar

**File:** `src/components/submittal/SubmittalRegisterReview.tsx`

Four filter controls rendered above the section list, below the run summary. Filter state is local (`useState` inside `SubmittalRegisterReview`). No API changes — all filtering is client-side via `useMemo`.

| Filter | Control | Match logic |
|---|---|---|
| Spec section | text input | prefix match on `item.specSection` |
| SD code | `<select>` | exact match; options built from unique values in data |
| Approval authority | `<select>` | exact match; options built from unique values in data |
| Blocking risk | `<select>` | exact match; options: `none / low / medium / high` |

Filtered `items`, `groupedSections`, and `ungrouped` are all derived together in one `useMemo` so the three collections stay in sync (consistent with the existing `patchItemFields` triple-update pattern).

A "Clear filters" button appears only when at least one filter is active.

---

## Section 4 — Source Detail Drawer

**File:** `src/components/submittal/SourceDetailDrawer.tsx` (new)

Slide-over panel from the right. State (`selectedSourceItem: SubmittalRegisterItem | null`) lives in `SubmittalRegisterReview`. The drawer is conditionally mounted at the bottom of that component.

**Props:** `item: SubmittalRegisterItem | null`, `onClose: () => void`

**Behavior:**
- Fixed right panel, ~480px wide, full viewport height
- Semi-transparent backdrop — click to close
- Escape key closes it

**Layout:**
- **Header:** `specSection · sectionTitle` (e.g. `03 30 00 · Cast-In-Place Concrete`)
- **Source location:** document name + page number (`sourceReference.documentName`, `sourceReference.pageNumber ?? sourcePage`)
- **Spec excerpt:** `sourceExcerpt ?? excerpt` in a readable monospace/pre block
- **Submittal details:** SD code, approval authority, blocking risk — rendered only if populated
- **Notes:** `item.notes` if present

---

## Section 5 — Spec Coverage Card (Overview Tab)

**File:** `src/components/submittal/tabs/OverviewTab.tsx`

New card section inserted below `LifecycleSummary`, above the High-Priority Action Queue. Uses the existing `StatCard` pattern from `LifecycleSummary`.

**Title:** "Spec Coverage"

| Stat | Logic | Highlight condition |
|---|---|---|
| Spec-linked | `item.specSection != null` | — |
| Missing spec link | `item.specSection == null` | count > 0 → amber |
| Gov't approval required | `item.approvalAuthority === 'Government'` | — |
| Blocking risk | `item.blockingRisk === 'medium' \|\| === 'high'` | count > 0 → amber |

All stats computed via `useMemo` from `items`. Since `approvalAuthority` and `blockingRisk` are new unpopulated fields, counts for those stats will start at zero — correct and honest behavior.

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/chat/submittal-register.ts` | Add 7 optional fields to `SubmittalRegisterItem` |
| `src/components/submittal/SubmittalRegisterReview.tsx` | Filter bar + SD code chip + View Source button + drawer state |
| `src/components/submittal/tabs/OverviewTab.tsx` | Spec Coverage card section |
| `src/components/submittal/SourceDetailDrawer.tsx` | New slide-over component |

## Files NOT Changed

- API routes — no schema or response changes
- Supabase schema — no migration
- `ApprovalsTab.tsx`, `LongLeadTab.tsx` — not in scope
- `SubmittalsCommandCenter.tsx` — no new state or props
- `LifecycleSummary.tsx` — Spec Coverage card goes in OverviewTab, not here

---

## Out of Scope

- FOW (Feature of Work) linkage logic
- Schedule activity integration
- Pipeline changes to populate new fields
- DB column promotion for any of the 7 new fields
