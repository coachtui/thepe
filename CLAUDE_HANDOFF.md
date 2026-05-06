# Claude Code Handoff — PE Project → Construction Intelligence Core

## Current Goal

Refactor this PE / project-engineer document intelligence project from generic project chat into a project-aware construction intelligence core.

This is intended to later become reusable inside BedrockOS, but for now all work stays inside this PE repo.

## Current Architecture Progress

Implemented so far:

1. Task router
   - File: `src/lib/chat/task-router.ts`
   - Classifies user messages into construction task types:
     - ask_project
     - spec_lookup
     - plan_lookup
     - rfi_draft
     - submittal_review
     - submittal_register
     - qc_plan
     - schedule_question
     - field_question
     - equipment_question
     - general

2. Retrieval strategy map
   - Also in `src/lib/chat/task-router.ts`
   - Defines config for each task type:
     - retrievalMode
     - preferredDocumentTypes
     - preferredMetadataFields
     - defaultTopK
     - citationRequired
     - includeProjectHistory
     - structuredOutputRequired
     - promptTemplateName
     - notes

3. Router wired into chat flow
   - `src/lib/chat/chat-handler.ts`
   - `src/app/api/chat/route.ts`
   - `src/app/api/mobile/chat/route.ts`
   - `src/lib/chat/tools/index.ts`
   - Currently only applies `defaultTopK` where supported.
   - Other strategy fields remain metadata/TODOs.

4. Spec lookup specialist behavior
   - Prompt-level specialist behavior for `taskType === "spec_lookup"`.
   - Instructs model to prioritize specs, cite source metadata, separate Requirement / Interpretation / Recommended Action, and avoid uncited certainty.

5. Normalized source references
   - File: `src/lib/chat/source-references.ts`
   - Adds `SourceReference` type, normalizer, and formatter.
   - `src/lib/chat/types.ts` now supports optional `sourceReference` on `SpecFinding` and `SpecEntity`.
   - `src/lib/chat/spec-queries.ts` uses normalized citations for spec answers.

6. Submittal register workflow
   - File: `src/lib/chat/submittal-register.ts`
   - Adds `buildSubmittalRegisterFromSpecs(...)`.
   - Reads existing `project_entities`, `entity_findings`, and `entity_citations`.
   - Extracts structured submittal register rows:
     - specSection
     - sectionTitle
     - submittalItem
     - submittalType
     - requiredAction
     - approvalRequired
     - sourceReference
     - excerpt
     - confidence
     - notes

7. Submittal register quality hardening
   - Deterministic dedupe added.
   - Dedupe key:
     - specSection
     - normalized submittalItem
     - submittalType
     - source part/paragraph reference
   - Added optional metadata:
     - rawExcerpt
     - dedupeKey
     - duplicateCount
     - citationCompleteness
     - sourceQuality
     - confidenceReason
   - Confidence logic:
     - high = explicit submittal_requirement finding with section and citation metadata
     - medium = parsed spec-like text with section/page metadata
     - low = uncited or weak parsed text

8. Harness
   - File: `scripts/task-router-harness.mjs`
   - Command: `npm run router:harness`
   - Currently passes.
   - Includes examples for router classification, normalized source references, and submittal register quality cases.

9. Grouped review output shape for `submittal_register`
   - File: `src/lib/chat/submittal-register.ts`
   - Types:
     - `SubmittalRegisterGroup`
     - `SubmittalRegisterReview`
   - Functions:
     - `groupSubmittalRegisterForReview()`
     - `formatSubmittalRegisterReviewAsJson()`
   - Per-group aggregates: itemCount, averageConfidence, confidenceBreakdown (high/medium/low), citationBreakdown (fullyCited/partiallyCited/uncited), submittalTypeCounts, approvalRequiredCount, reviewFlags.
   - Top-level shape: sorted groups, ungrouped items (no specSection), global review flags.
   - Harness coverage added in `scripts/task-router-harness.mjs`.
   - `npm run router:harness` passes.
   - `npm run build` passes.

10. Grouped submittal register output wired into chat/tool path
    - Files:
      - `src/lib/chat/submittal-register.ts`
      - `src/lib/chat/tools/index.ts`
      - `src/lib/chat/chat-handler.ts`
      - `scripts/task-router-harness.mjs`
    - `formatSubmittalRegisterToolPayload(result)` now emits flat `items` + `summary` + `groupedSections` + `ungrouped` in a single JSON payload.
    - `buildSubmittalRegister` tool now returns the combined payload (replacing the prior flat-only formatter).
    - `submittal_register` workflow prompt in `chat-handler.ts` instructs the model to use `groupedSections` for section-by-section review and to surface `reviewFlags` for uncited or low-confidence items.
    - Flat `items` array preserved at the top level — backward-compatible for any existing consumer.
    - Fallback payload behavior preserved: when `buildSubmittalRegisterFromSpecs` returns no items, the formatter emits `success: false`, empty `items`, empty `groupedSections`, empty `ungrouped`, and a summary `reviewFlag` noting nothing was available.
    - Harness coverage added: tool-payload structure check + fallback payload check.
    - `npm run router:harness` passes.
    - `npm run build` passes.

11. Persistence schema migration for workflow runs and submittal register items
    - File: `supabase/migrations/00050_workflow_runs_and_submittal_register.sql`
    - Tables added:
      - `workflow_runs` — per-run record for routed task types. `workflow_type` `CHECK` is currently restricted to `'submittal_register'`; other routed task types extend this CHECK in a follow-up migration when their persistence is added. Stores `inputs`, `output_payload`, `output_summary`, `error`, `status`, `triggered_by_user_id`, `triggered_by_role`, `source_type`, `duration_ms`, `cost_usd`, `started_at`, `completed_at`. Composite uniqueness `uq_workflow_runs_id_project (id, project_id)` exposed as a composite-FK target.
      - `submittal_register_items` — per-item snapshot of a `submittal_register` workflow run. Carries identity (`workflow_run_id`, `dedupe_key`), denormalized filterable columns (`spec_section`, `submittal_type`, `review_status`, etc.), provenance links to existing `entity_findings(id)` and `entity_citations(id)` (no duplicate citation table), full `item_payload` JSONB snapshot, and human review state (`review_status`, `reviewed_by_user_id`, `reviewed_by_role`, `reviewed_at`, `review_notes`, `confirmed_by_count`, `rejected_by_count`, `superseded_by_id`).
    - Indexes added (including partial indexes): `idx_workflow_runs_project`, `idx_workflow_runs_project_type`, `idx_workflow_runs_project_recent`, `idx_workflow_runs_status` (partial: `status IN ('running','failed')`), `idx_workflow_runs_user` (partial: `triggered_by_user_id IS NOT NULL`), `idx_sri_run`, `idx_sri_project`, `idx_sri_project_status`, `idx_sri_project_section` (partial), `idx_sri_project_type` (partial), `idx_sri_finding` (partial), `idx_sri_pending_review` (partial: `review_status = 'pending'`).
    - RLS pattern: project-members `SELECT/INSERT/UPDATE/DELETE` policies + `service_role FOR ALL` policy on each table, copied verbatim from the established `00038`/`00047` style. RLS enabled on both tables.
    - Grants: `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`; `GRANT ALL ... TO service_role`.
    - `update_updated_at_column()` triggers on both tables.
    - Project consistency enforcement: composite foreign key `fk_sri_run_project (workflow_run_id, project_id) -> workflow_runs(id, project_id) ON DELETE CASCADE`. Engine-enforced — `submittal_register_items.project_id` cannot drift from the parent `workflow_runs.project_id`. Mirrors the `entity_locations` / `entity_findings` / `entity_relationships` pattern from `00038`.
    - Idempotent: `CREATE TABLE IF NOT EXISTS`, `DO $$ ... EXCEPTION WHEN duplicate_object $$` guards on every named constraint, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY/TRIGGER IF EXISTS` before each `CREATE`.
    - No application code wired yet — service-role TypeScript persistence wiring is the next phase.
    - **Applied to the linked Supabase project `the-pe` (`frhzemhbgcjjprfxgmgq`) via the Supabase MCP server `apply_migration` tool.** Local Docker stack remained unavailable, so verification was performed against the live linked DB rather than a local stack.
    - Engine-level verification confirmed: both tables present, all constraints present including the composite FK `fk_sri_run_project (workflow_run_id, project_id) -> workflow_runs(id, project_id) ON DELETE CASCADE`, all 16 indexes present (including all partial indexes), all 10 RLS policies present (5 per table — 4 user + 1 service_role), `update_updated_at_column()` triggers attached, GRANTs applied.
    - **Migration history version mismatch (cosmetic):** the MCP `apply_migration` tool registered the migration as `20260506000254_workflow_runs_and_submittal_register` in `supabase_migrations.schema_migrations` rather than `00050`. The local file remains `00050_workflow_runs_and_submittal_register.sql`. DDL is identical and engine state is correct; only the version IDs differ. To watch out for during a future `supabase db push` reconciliation.
    - **00049 history gap (pre-existing):** local `00049_utility_length_canonical_trigger.sql` was effectively applied at some prior point — the trigger exists on the remote — but the `schema_migrations` row for 00049 was never recorded. Attempting to apply it through MCP failed with `trigger already exists`. Schema state is correct; history is missing the 00049 row. Backfilling the history row (an `INSERT` into the system table) was not done — out of scope for this task and not authorized.
    - **Advisor results on the new tables (all INFO/WARN, no ERROR):**
      - `unindexed_foreign_keys` (INFO × 4) on `submittal_register_items` for `fk_sri_run_project`, `reviewed_by_user_id_fkey`, `source_citation_id_fkey`, `superseded_by_id_fkey`. Advisory only — same level the existing schema accepts on `entity_findings` / `entity_relationships`.
      - `unused_index` (INFO × 12) on both new tables. Expected — no queries have run yet.
      - `auth_rls_initplan` (WARN × 10) — RLS policies use `auth.uid()` / `auth.role()` directly. This is the **project-wide pattern across all ~100 existing policies in `00038`/`00047`/etc.**, followed verbatim here per the "do not modify any existing table or policy" rule.
      - `multiple_permissive_policies` (WARN × many) — service_role + user policies coexist. Same established repo pattern.
    - `npm run router:harness` passes.
    - `npm run build` passes.

## Next Recommended Step

Wire `workflow_runs` + `submittal_register_items` writes from the `buildSubmittalRegister` tool path using service-role only. Use a single transaction or the best available transactional pattern, set `status='completed'` on success, set `error` on failure, and do not modify the tool's return contract.

## Validation

Run:

```bash
npm run router:harness
npm run build
```
