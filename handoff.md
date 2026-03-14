# Handoff

Last updated: 2026-03-14 (Phase 7B implementation session)

---

## What Was Done This Session

Phase 7B is complete.

### 1. Migration 00047
`supabase/migrations/00047_project_memory.sql` — creates:
- `project_memory_items` — aliases, callout patterns, corrections, sheet hints
- `project_corrections` — user feedback on AI answers
- `memory_confirmations` — per-user confirm/dispute votes on memory items
- `project_source_quality` — per-source confidence caps/modifiers
- `recheck_sessions` — audit trail for recheck runs
RLS enabled on all; service role full access; project members read-only.

### 2. project-memory.ts
New `src/lib/chat/project-memory.ts`:
- `loadProjectMemory(projectId)` — loads accepted items from DB, gracefully degrades to empty context if tables missing
- `resolveAliases(entities, ctx, discipline?)` — expands entity strings against accepted aliases
- `getSourceQuality(source, discipline, system, ctx)` — returns confidence cap + modifier
- `sanitizeForPrompt()` / `formatCalloutPatternsForPrompt()` — safe prompt injection helpers

### 3. query-analyzer.ts
Added exported `applyAliasExpansions(analysis, expansions)` — pure transform, no re-run of classification.

### 4. plan-reader.ts
`calloutPatterns?: MemoryItem[]` threaded through runPlanReader → runPlanReaderWithCandidates → inspectPageForQuestion → buildInspectionPrompt.
Callout patterns injected as structured "KNOWN PROJECT ABBREVIATIONS" block in Haiku prompt.

### 5. chat-handler.ts
- Step 0: `loadProjectMemory(projectId)` before query analysis
- Step 0.5: `resolveAliases()` + `applyAliasExpansions()` after query analysis
- `calloutPatterns` passed as 5th arg to `runPlanReader()`

---

## What Is Currently In Progress

Nothing — Phase 7B is complete.

---

## What To Do Next

**Apply the migration:**
```
supabase db push
# or: supabase migration up
```
Then regenerate types to remove the `as any` workaround in project-memory.ts.

**Start Phase 7C — Correction Capture:**

1. `POST /api/projects/[id]/corrections/route.ts`
   - Auth: project_members.role IN ('owner', 'editor')
   - Writes to project_corrections; if submitted_by_role weight ≥ 2.0 → also auto-write accepted project_memory_items row
   - Role weights: PE = 3.0, superintendent = 2.0, admin = 2.5, engineer/foreman = 1.0

2. `POST /api/projects/[id]/memory/confirm/route.ts`
   - Writes to memory_confirmations (UNIQUE prevents double-voting)
   - Updates confirmed_by_count / rejected_by_count on parent memory item
   - If rejected_by_count > confirmed_by_count → set validation_status = 'disputed'

3. Modify `retrieval-orchestrator.ts`
   - After vision_db lookup: merge accepted corrections from project_corrections
   - Mark merged items with source = 'user_correction'

4. Modify `evidence-evaluator.ts`
   - Call getSourceQuality() and apply confidence_cap / confidence_modifier

5. UI correction modal + inline provenance citations (Phase 7C UI items)

---

## Open Questions / Blockers

- Migration 00047 must be applied before Phase 7C API routes will work
- Supabase types should be regenerated after migration to remove `as any` cast in project-memory.ts
