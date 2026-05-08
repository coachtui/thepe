# Handoff

Last updated: 2026-05-07 21:45 HST (submittal lifecycle engine)

---

## What Was Done This Session

### Submittal Lifecycle Engine — foundational workflow architecture

**`src/lib/chat/submittal-lifecycle.ts`** — new status engine
- `SubmittalLifecycleStatus` type: draft | pending_submission | submitted | pending_review | approved | approved_as_noted | revise_resubmit | rejected | closed
- `LifecycleHistoryEntry` type
- `TRANSITIONS` map with all valid status paths
- `canTransition()`, `buildTransition()`, `getNextStatuses()`
- `STATUS_LABELS`, `STATUS_COLORS` (Tailwind classes)
- `resolveEffectiveStatus()` — artifact_suspected items surface as pending_review
- `isOverdue()`, `formatDueDate()`, `timestampFieldForStatus()`

**`src/lib/chat/submittal-register.ts`** — lifecycle fields on SubmittalRegisterItem
- 10 new optional fields: lifecycleStatus, lifecycleResponsibleParty, lifecycleAssignedReviewer, lifecycleDueDate, lifecycleLeadTimeDays, lifecycleLongLeadFlag, lifecycleSubmittedAt, lifecycleApprovedAt, lifecycleClosedAt, lifecycleStatusHistory
- Stored in item_payload JSONB, no migration needed

**`POST /api/projects/[id]/submittal-register/lifecycle`** — transition API
- Validates transition using engine
- Appends to statusHistory array
- Sets timestamps for key transitions (submittedAt, approvedAt, closedAt)
- Optional metadata updates: responsibleParty, assignedReviewer, dueDate, leadTimeDays, longLeadFlag

**`LifecycleBadge.tsx`** — status pill with Tailwind color mapping + overdue indicator

**`LifecycleSummary.tsx`** — 6-stat operational dashboard: Total, Pending Review, Revision Required, Long Lead, Approved, Overdue

**`LifecycleControls.tsx`** — per-item inline controls
- Shows lifecycle badge + due date + responsible party + long-lead flag
- "Advance" button → select next valid status + optional note → POST /lifecycle
- "N updates" link → opens history drawer (modal)
- History drawer shows reverse-chronological entries with timestamps

**`SubmittalRegisterReview.tsx`** — integrated all of the above
- LifecycleSummary between RunSummary and ArtifactReviewQueue
- LifecycleControls at the bottom of each ItemRow
- handleLifecycleTransitioned patches local state via patchItemFields
- projectId and onLifecycleTransitioned threaded through SectionRenderProps → SectionCard → UngroupedCard → ItemRow

---

## What Is Currently In Progress

Nothing. Session completed cleanly. Build clean, 12/12 harness.

---

## What To Do Next

1. **Commit and push** this session's work
2. **Test lifecycle transitions in the UI** — open any item, click "Advance", select a status, save
3. **Future lifecycle phases:**
   - Due date + responsible party editors (currently set only via API, UI coming)
   - Bulk status update (advance all items in a section)
   - Schedule/FOW linkage (connect lifecycle to project activities)
   - Export/report with lifecycle status filter

---

## Open Questions / Blockers

- Lifecycle fields default to `draft` when not set. All existing 1,221 items show as Draft until explicitly advanced. This is correct behavior for v1.
- `responsible_party`, `due_date` etc. are only settable via API body alongside a transition. A future UI can allow editing metadata without a status change.
- History drawer is a simple modal — no virtualization; fine for expected history depth (< 20 entries per item).
