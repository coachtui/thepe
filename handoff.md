# Handoff

Last updated: 2026-05-07 21:05 HST (artifact review workflow)

---

## What Was Done This Session

### 1. Submittal register review panel UI improvements
- RunSummary: 8 stats, progress bar, readiness message, construction-specific labels
- SectionCard headers: per-section "X/Y reviewed" + mini progress bar

### 2. Artifact cleanup script (`scripts/clean-submittal-artifacts.ts`)
- Dry-run audit: 4 safe_delete, 2 safe_clean, 16 manual_review found
- In --execute mode now also marks manual_review rows with `artifactReviewStatus: 'artifact_suspected'` in item_payload
- Safe rows (4 delete + 2 clean) are auto-applied; ambiguous rows are queued

### 3. Artifact review product workflow
- New type fields on `SubmittalRegisterItem`: `artifactReviewStatus`, `artifactReviewReason`, `artifactSuggestedName`
- New API route: `POST /api/projects/[id]/submittal-register/artifact-review` (accept/edit/ignore)
- New component: `ArtifactReviewQueue.tsx` — collapsible amber panel above sections
- `SubmittalRegisterReview.tsx` integrated with queue + `patchItemFields` helper

---

## What Is Currently In Progress

Nothing. All three sessions completed cleanly.

---

## What To Do Next

### IMMEDIATE: Run the script to populate the review queue

```
npx tsx scripts/clean-submittal-artifacts.ts --execute
```

This will:
- DELETE 4 pure artifact rows (`-PAGE-BREAK---`, `GE-BREAK---`)
- UPDATE 2 rows with clean names (Raised Pavement Markers, Control Contractor's... Testing)
- MARK 16 rows as `artifact_suspected` in `item_payload` so they appear in the review queue

After running, open the Ammunition project submittal register — the amber "Extraction Review Queue" panel will appear with 16 items to review.

### After executing, verify in UI
1. The 4 deleted rows should not appear in any section
2. The 2 cleaned rows should show clean names
3. The amber review queue panel should show 16 items needing review

### Remaining backlog
- ~82 duplicate rows (same dedupeKey within a run) — deduplicate at read time
- 50 sections still lack titles — standard pipeline didn't extract them
- Phase 7A — Manual Analyze button bug fix (see plans/current-phase.md)

---

## Open Questions / Blockers

- 16 manual_review rows need human judgment via the UI review queue once the script is executed
- Some stripped texts may be complete names ("Surge Arresters", "Initiating devices") — user can accept the suggestion or edit
- Some stripped texts are clearly truncated ("Operation and", "Probing and") — user should edit with the real name or ignore
