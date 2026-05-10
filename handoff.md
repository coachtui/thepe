# Handoff

## Completed This Session
- Document normalization layer (`src/lib/ingestion/document-normalization.ts`) — strips repeated headers/footers and project identifier prefixes before extraction. Handles both `\f` and `---PAGE-BREAK---` page separators. Uses 95% majority prefix detection (not 100%) to handle minor formatting variants.
- Applied normalization in `ingestion-runner.ts` (PDF-only path, before extraction).
- Harness updated with `Norm-Rm` column showing lines removed/stripped per file.
- 7 new NORM-* tests in QA harness (139/139 pass). TypeCheck clean. Build clean.
- Validated against real UFGS spec: full header ("FY22 MILCON PROJECT PN 080133 AMMUNITION STORAGE 1644749 WEST LOCH, HAWAII") correctly stripped from 1540 lines. Suspicious rows now show real spec content.

## In Progress
Nothing.

## What To Do Next
- **UFGS SD code gap**: SD coverage stays at 26.6% even after normalization. Root cause is that UFGS spec body puts SD codes on separate lines from item descriptions (not inline). Need multi-line context extraction OR parsing the 75-page DD-form submittal appendix.
- **DD-form appendix parser**: The spec's 75-page table-format submittal register (SUBMITTAL FORM, Jan 96) contains the authoritative SD code assignments. A table-aware parser for this section would likely push SD coverage to 80%+.
- **Get more real specs**: Only 1 spec in the database. Commercial CSI specs (no DoD watermarks) likely perform significantly better — test those to confirm demo readiness for non-UFGS projects.

## Open Questions / Blockers
- None.

## Completed This Session
- `evaluateRegisterPublishReadiness` — pure function in `src/lib/chat/submittal-publish-readiness.ts`. Accepts optional `ingestionGrade`, `ingestionGradeReasons`, `qaResult`. Returns `{status, reasons, requiredActions}`.
- `PublishReadinessBanner` — `src/components/submittal/PublishReadinessBanner.tsx`. Shows green/amber/red status, reason list, Publish Register button. Blocked = disabled button. needs_review = confirmation modal before publishing. Local publish state (publishedAt) + Unpublish.
- `OverviewTab` updated to compute `qaResult` and `readiness` via `useMemo`, render banner at top. Accepts new optional `ingestionGrade?` / `ingestionGradeReasons?` props.
- 7 publish readiness harness tests added (PRG-1 through PRG-7). qa:harness: 114/114. typecheck: clean. build: clean.

## In Progress
Nothing.

## What To Do Next
- If ingestion grade is ever persisted per workflow run, wire it through `SubmittalsCommandCenter` → `OverviewTab` → banner (the prop interface is already in place).
- Consider next reliability-first items from S234 strategic pivot: multi-document linkage architecture or real-project ingestion testing against production specs.

## Open Questions / Blockers
- None.

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
