# Project Memory

Validated learnings, confirmed nuances, and recurring constraints.
Updated when something is likely to matter again across sessions.

---

## Architecture Decisions

### Inngest is the only correct document processing path
- Manual Analyze button (`/api/projects/{id}/analyze-complete`) does NOT call `indexDocumentPage()`
- Only the Inngest path (`vision-process-document.ts`) populates `document_pages` and `sheet_entities`
- Plan reader, sheet narrowing, and (future) recheck workflow all depend on `document_pages` being populated
- Fix is in `src/lib/processing/vision-processor.ts` — must call `indexDocumentPage()` per page

### Structured data always beats vector search
- Retrieval order: vision_db → graph lookups (2.5 through 2.97) → smart router → live PDF
- Vector search is last resort, confidence-capped
- Never move vector search earlier in the pipeline

### Hard refuse is code-level, not prompt-level
- `evidence-evaluator.ts` enforces `coverageStatus: insufficient` as a hard block
- Changing or softening this requires code change, not a prompt change

### Re-processing documents requires deleting project_quantities first
- Dedup logic in quantity extractor skips re-insertion if rows already exist
- Must `DELETE FROM project_quantities WHERE project_id = ?` before re-running extraction

### Manual Analyze button bug (known, unfixed as of 2026-03-13)
- Root cause: `processDocumentWithVision()` in vision-processor.ts missing `indexDocumentPage()` call
- Impact: empty `document_pages` → plan reader cannot narrow sheets → weaker answers
- Priority: Fix this before any recheck workflow work

---

## Retrieval Pipeline Nuances

### Callout variability is a structural problem
- Vision extractor captures abbreviated labels literally (HORIZ DEFL, MJ BEND, DEFL COUPLING)
- COMPONENT_PATTERNS in vision-queries.ts uses normalized patterns → misses project-specific abbrevs
- Future fix: project_memory_items aliases injected into plan reader prompt and pattern matching

### Station normalization is inconsistent
- `utility_termination_points` and `utility_crossings` both have `station` (TEXT) + `station_numeric` (computed)
- Inconsistent normalization can cause nearby-station queries to miss
- Station parser is in `station-parser.ts` — tests exist but are not comprehensive

### Multi-system queries get suppressed
- `autoDetectSystem()` in smart-router.ts: when multiple systems detected, system detection is suppressed
- Query searches all systems → over-broad results
- Workaround: user must specify exact system name ("Water Line A" not "water lines")

---

## Phase History

| Phase | Status | Key deliverable |
|---|---|---|
| Phase 1–2 | DONE | Vision extraction, entity graph tables, utility pipeline |
| Phase 3 | DONE | Demo plan ingestion and reasoning |
| Phase 4 | DONE | Architectural floor plans + schedule linkage |
| Phase 5 | DONE | Structural + MEP + coordination reasoning |
| Phase 6 | DONE | Spec + RFI + submittal ingestion |
| Phase 7 | DESIGN DONE | Project-scoped memory architecture (see current-phase.md) |

Full phase history and implementation checklists: `plans/current-phase.md`

---

## Key Constraints

- Temperature 0.2 for all factual answer modes — do not raise
- Never use anon Supabase client for writes — always service role
- Never add "typically", "industry standard", etc. to factual responses
- `supabase as any` cast used throughout graph queries — regenerate types after next deploy
- Vercel Pro required for `maxDuration=300` on `/api/inngest/route.ts`
- 5 pages per Inngest chunk (PAGES_PER_CHUNK=5) — do not increase without testing timeout behavior

---

## Recurring Failure Patterns

### "No valves/fittings found" after corrections
- Root cause: `project_quantities` not updated; next query re-reads stale data
- Fix: Phase 7C correction capture — write corrections to DB, merge at retrieval time

### Regression to "no data" after improvement
- Root cause: stateless pipeline; plan reader findings not persisted
- Fix: Phase 7B project memory + Phase 7D recheck with write-back

### Sheet narrowing fails silently
- Root cause: `document_pages` empty (Manual Analyze button bug)
- Fix: Phase 7A — fix vision-processor.ts
