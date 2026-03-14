# Current Phase: Phase 7 — Project-Scoped Memory Architecture

**Status:** DESIGN COMPLETE — implementation not yet started
**Design completed:** 2026-03-13

Full design spec: `plans/phase7-project-memory-architecture.md`

---

## Goal

Redesign plan Q&A from a stateless per-query pipeline into a project-scoped learning system.
Eliminate the failure mode where user corrections and plan-reader findings vanish between sessions.

---

## Task Checklist

### Phase 7A — Foundation fixes
- [ ] Fix Manual Analyze button bug
  - File: `src/lib/processing/vision-processor.ts`
  - Add `indexDocumentPage()` call per page (same as `vision-process-document.ts`)
  - Unblocks: plan reader narrowing, recheck workflow, sheet hint lookups
- [ ] Add query tracing fields to `EvidenceItem` type

### Phase 7B — Memory schema + load
- [ ] Write migration 00047 (schema in `plans/phase7-project-memory-architecture.md`)
  - Tables: `project_memory_items`, `project_corrections`, `memory_confirmations`, `project_source_quality`, `recheck_sessions`
- [ ] Create `src/lib/chat/project-memory.ts`
  - `loadProjectMemory(projectId)` → aliases[], calloutPatterns[], sheetHints[], sourceQuality[]
  - `resolveAliases(entities, memoryContext)` → expanded entity map
  - `getSourceQuality(source, discipline, system, memoryContext)` → confidence cap/modifier
- [ ] Wire `loadProjectMemory()` into `chat-handler.ts` before Step 1

### Phase 7C — Correction capture
- [ ] Create `src/app/api/projects/[id]/corrections/route.ts`

### Phase 7D — Recheck workflow
- [ ] Create `src/lib/chat/recheck-workflow.ts`
- [ ] Create `src/app/api/projects/[id]/recheck/route.ts`

### Phase 7E — Confidence-aware responses
- [ ] Wire confidence policy (high/medium/low/disputed) into `response-writer.ts`

### Phase 7F — Project Memory dashboard UI
- [ ] TBD — scoped in CTO Builder session before starting

---

## Blockers

- Manual Analyze button bug must be fixed before recheck workflow (Phase 7D) can ship — needs `document_pages` populated
- No feedback API exists yet — all correction capture is net-new

---

## Key Files

| File | Status | Purpose |
|---|---|---|
| `plans/phase7-project-memory-architecture.md` | DONE | Full design doc, schema, flow |
| `src/lib/processing/vision-processor.ts` | TO FIX | Manual Analyze button bug |
| `src/lib/chat/project-memory.ts` | TO CREATE | Memory load/alias resolution |
| `supabase/migrations/00047_project_memory.sql` | TO CREATE | 5 new tables |
| `src/app/api/projects/[id]/corrections/route.ts` | TO CREATE | Correction capture API |
| `src/lib/chat/recheck-workflow.ts` | TO CREATE | Live recheck bypass |

---

## Testing Targets

- Query: "what fittings are on Water Line A?" — should now pick up aliases like "HORIZ DEFL"
- Submit a correction → re-query same question → should return corrected value
- Recheck workflow → live inspection result should differ from stored value and surface delta
- PE correction vs. foreman correction → PE correction should take precedence

---

## Suggested Next-Window Prompt (Lead Builder / `/build`)

```
We are implementing Phase 7A of the project-scoped memory architecture.
Read plans/current-phase.md, handoff.md, and plans/phase7-project-memory-architecture.md first.

Start with the Manual Analyze button bug fix:
- File: src/lib/processing/vision-processor.ts
- It currently calls processDocumentWithVision() but does NOT call indexDocumentPage()
- The Inngest path in src/inngest/functions/vision-process-document.ts correctly calls indexDocumentPage()
- Wire the same indexDocumentPage() call into vision-processor.ts for each page processed
- Verify: document_pages and sheet_entities are populated after manual analyze

After that, write migration 00047 from the schema in plans/phase7-project-memory-architecture.md.
```
