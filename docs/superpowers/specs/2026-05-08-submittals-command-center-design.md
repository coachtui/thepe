# Submittals Command Center — Design Spec

**Date:** 2026-05-08  
**Status:** Approved  

## Problem

The main project page is dominated by the full `SubmittalRegisterReview` component — 1,217 items across 81 spec sections rendering inline on page load. The register is a working table, not a decision surface. The main page should orient the user to what needs action, not dump the full data set on them.

## Goal

Refactor the submittals UI into a 5-tab command center. The main page becomes a decision surface (Overview). The full register, review queue, approval workflow, and long-lead tracking each get their own focused tab.

---

## Architecture

### Approach

**New wrapper component** (`SubmittalsCommandCenter`) owns the 5-tab shell and the data fetch. Existing components slot in as tab contents without internal modification (except `ArtifactReviewQueue` moving out of the register's inline render into its own tab).

### Component Tree

```
SubmittalsCommandCenter        ← new, owns fetch + tab state
├── OverviewTab                ← new
│   ├── LifecycleSummary       ← existing, reused
│   ├── PriorityActionQueue    ← new (computed list, no component)
│   ├── RecentlyApproved       ← new (computed list, no component)
│   └── LongLeadRisks          ← new (computed list, no component)
├── RegisterTab                ← thin wrapper, renders SubmittalRegisterReview
│   └── SubmittalRegisterReview ← existing, receives data as props
├── ReviewQueueTab             ← thin wrapper
│   └── ArtifactReviewQueue    ← existing, moved from SubmittalRegisterReview inline
├── ApprovalsTab               ← new
│   └── LifecycleControls      ← existing, per filtered item
└── LongLeadTab                ← new
    └── LifecycleControls      ← existing, per filtered item
```

### Data Flow

Single fetch from `/api/projects/[id]/submittal-register/latest` in `SubmittalsCommandCenter`. The resolved `SubmittalRegisterItem[]` is passed as props to all tabs. No new API routes. No additional fetches per tab.

---

## Files Changed

| File | Change |
|---|---|
| `src/app/(dashboard)/projects/[id]/page.tsx` | Swap `<SubmittalRegisterReview>` → `<SubmittalsCommandCenter projectId={id} />` |
| `src/components/submittal/SubmittalsCommandCenter.tsx` | **New** — tab shell + data fetch |
| `src/components/submittal/tabs/OverviewTab.tsx` | **New** — lifecycle summary + 3 computed sections |
| `src/components/submittal/tabs/ApprovalsTab.tsx` | **New** — filtered approval workflow view |
| `src/components/submittal/tabs/LongLeadTab.tsx` | **New** — filtered long-lead view |
| `src/components/submittal/SubmittalRegisterReview.tsx` | Remove `ArtifactReviewQueue` from inline render; accept pre-fetched data as prop instead of fetching internally |

**Not touched:** `LifecycleSummary`, `LifecycleBadge`, `LifecycleControls`, `ArtifactReviewQueue`, all API routes, DB schema.

---

## Tab Specifications

### Overview (default tab)

Purpose: decision surface — what needs action right now.

Sections (all computed from the loaded `SubmittalRegisterItem[]`):

1. **Lifecycle Summary** — renders existing `LifecycleSummary` component (total, pendingReview, revisionRequired, longLead, approved, overdue counts)
2. **High-Priority Action Queue** — items where `status === 'overdue' || lifecycleStatus === 'revise_resubmit'`, sorted by due date ascending. Shows item title, section, status badge, due date.
3. **Recently Approved** — items where `lifecycleStatus === 'approved' || lifecycleStatus === 'approved_as_noted'`, sorted by last-updated descending, capped at 10.
4. **Long-Lead Risks** — items where `longLeadFlag === true || (leadTimeDays && leadTimeDays > 0)`, sorted by `leadTimeDays` descending, capped at 10. Shows lead time, lifecycle status, due date.

### Register

Full existing `SubmittalRegisterReview` content unchanged: section grouping, inline edit, `LifecycleControls` per row, collapse/expand per section. `ArtifactReviewQueue` removed from here (moved to Review Queue tab).

### Review Queue

Renders `ArtifactReviewQueue` for the current run. Tab title shows pending artifact count badge when `> 0`. Empty state: "No extraction artifacts pending review."

### Approvals

Filtered view of items in lifecycle statuses: `pending_review`, `submitted`, `approved_as_noted`, `revise_resubmit`, `rejected`.

Shows per item:
- Item number, title, section
- `LifecycleBadge` for current status
- `LifecycleControls` for transitions
- Inline review fields (notes + status dropdown from existing `ItemRow` logic)
- Due date, overdue indicator

Empty state: "No items pending approval."

### Long Lead

Filtered view: items where `longLeadFlag === true || (leadTimeDays > 0)`.

Shows per item:
- Item title, section
- Lead time in weeks (`Math.round(leadTimeDays / 7)`)
- `LifecycleBadge` for current status
- Due date
- Risk level: derived as `critical` (lead time ≥ 20wk + not approved), `high` (lead time ≥ 12wk + not approved), `ordered` (approved)

Sorted: lead time descending.

Empty state: "No long-lead items identified."

---

## Tab Navigation

- Default tab: Overview
- Tab bar at top of component
- Active tab persisted in local component state (no URL routing — avoids breaking project page URL structure)
- Review Queue tab: badge showing pending artifact count
- Approvals tab: badge showing count of items in approval-relevant statuses

---

## Constraints

- Do not rewrite lifecycle logic
- Do not change the data model
- Do not add new API routes
- Reuse `LifecycleSummary`, `LifecycleBadge`, `LifecycleControls`, `ArtifactReviewQueue` as-is
- `SubmittalRegisterReview` internal review logic unchanged; only the data fetch responsibility moves up to `SubmittalsCommandCenter`
