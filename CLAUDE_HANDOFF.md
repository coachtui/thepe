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

12. Persistence wired into the `buildSubmittalRegister` tool path
    - Files:
      - `src/lib/chat/submittal-register.ts` — adds pure transforms `buildOutputSummary`, `buildSubmittalRegisterItemRows`, `buildSubmittalRegisterPersistedPayload` plus `SubmittalRegisterOutputSummary` and `SubmittalRegisterItemRow` types. Pure helpers; no DB imports.
      - `src/lib/chat/submittal-register-persistence.ts` *(new)* — `persistSubmittalRegisterRun(opts)` orchestrates the writes; uses service-role client only.
      - `src/lib/chat/tools/index.ts` — `buildTools` now accepts an optional `userContext: { userId?: string | null; userRole?: string | null }`. The `buildSubmittalRegister` tool execute calls `persistSubmittalRegisterRun` after formatting the payload; persistence errors are swallowed.
      - `src/lib/chat/chat-handler.ts` — `ChatHandlerOptions` accepts `userId?: string | null` and `userRole?: string | null`; threaded into `buildTools`.
      - `src/app/api/chat/route.ts` — passes `userId: user.id` through to `handleChatRequest`.
      - `src/app/api/mobile/chat/route.ts` — same.
      - `scripts/task-router-harness.mjs` — adds two coverage blocks for the pure transforms (combined sample + fallback empty case).
    - Tool return contract unchanged. The tool still returns the same JSON string from `formatSubmittalRegisterToolPayload`; persistence is invoked between formatting and return.
    - Persistence flow on each `buildSubmittalRegister` execute:
      1. Insert into `workflow_runs` with `status='running'`, `inputs` (sectionFilter, keyword, limit, taskType), `source_type='chat_tool'`, `triggered_by_user_id` (when available), `triggered_by_role` (null for now), `started_at=now()`. RETURNING `id`.
      2. Insert per-item rows into `submittal_register_items` in a single batch. `dedupe_key`, denormalized filterable fields, `confidence`, `source_quality`, `citation_completeness`, full `item_payload` JSONB snapshot. `source_finding_id` / `source_citation_id` are null in Phase 1 (carrying those would require expanding `SubmittalRegisterItem`, which would change the tool return contract; deferred).
      3. Update the `workflow_runs` row to `status='completed'`, `output_payload` (the full persisted snapshot), `output_summary` (compact aggregate counts + reviewFlags), `completed_at`, `duration_ms`.
      4. On any error in steps 1–3: best-effort update to `status='failed'`, `error=<message>`, `completed_at`, `duration_ms`.
    - Transactional pattern: Supabase JS does not expose multi-statement transactions to the JS client. The implementation uses sequential writes with status tracking — running → completed/failed — modelled on the existing `recheck_sessions` audit pattern (`00047`). A future hardening pass could move this into a Postgres function (RPC) for true atomicity if needed.
    - Failure isolation: `persistSubmittalRegisterRun` is a no-throw boundary — every internal error is caught and logged, the function returns an outcome object instead of throwing. The tool execute also wraps the persistence call in `try/catch` as belt-and-suspenders. **A persistence failure never affects the tool response.** The tool still returns the formatted payload; only `console.warn` records the issue.
    - Fallback / no-config behavior: if `SUPABASE_SERVICE_ROLE_KEY` is unset, `createServiceRoleClient` throws — the helper catches this, logs a warning, and returns `status='skipped'`. The tool response is unaffected.
    - Provenance fields:
      - `triggered_by_user_id` — populated from `user.id` in both API routes when available; null otherwise (e.g. background callers).
      - `triggered_by_role` — null in Phase 1. Threaded as a parameter so a future PR can populate it from the `users.role` column without reshaping the helper.
      - `source_type='chat_tool'` — fixed for this code path (other source types reserved for future API-direct / scheduled / admin invocations).
    - Type safety note: the generated `Database` type (`src/lib/db/supabase/types.ts`) does not yet include `workflow_runs` or `submittal_register_items` — generated before the migration. The persistence helper casts the service-role client to `any` at the boundary to avoid blocking the build. Regenerating types is a future cleanup item.
    - Harness coverage: pure transforms (`buildOutputSummary`, `buildSubmittalRegisterItemRows`) verified for both populated and empty results without requiring a live Supabase. Pure helpers live in `submittal-register.ts` precisely so the harness can load them without the service-role client import path.
    - `npm run router:harness` passes — all 12 router classification cases plus new persistence transform checks.
    - `npm run build` passes.

13. Regenerated Supabase Database types — `workflow_runs` + `submittal_register_items` are now typed
    - Files:
      - `src/lib/db/supabase/types.ts` — regenerated against the live linked project (`frhzemhbgcjjprfxgmgq` / `the-pe`) via the Supabase MCP `generate_typescript_types` tool. 3219 → 3439 lines (+220). Now includes both `workflow_runs` and `submittal_register_items` Row/Insert/Update/Relationships definitions, including the composite FK `fk_sri_run_project`.
      - `src/lib/chat/submittal-register-persistence.ts` — removed the `ServiceRoleClient = any` escape hatch. Now uses `ReturnType<typeof createServiceRoleClient>` for the client, plus generated `Database['public']['Tables'][...]` types for inserts and updates.
    - Type generation approach: MCP `generate_typescript_types` against the linked remote — same auth path as `apply_migration`. No Docker required. Saved-to-disk MCP output extracted via `jq -r '.[0].text | fromjson | .types'` and copied into `types.ts`.
    - `any` cast on the service-role client: **removed.** The client is now `ReturnType<typeof createServiceRoleClient>` so column-level type safety on every `.from(...).insert/update/select` chain.
    - Two narrow `as unknown as` casts remain at the JSONB boundary — supabase-js types JSONB columns as `Json` (recursive `{ [k: string]: Json | undefined } | …`), and our `SubmittalRegisterItem` interface (and its nested `SubmittalRegisterGroup` array) lacks an index signature so it isn't structurally assignable to `Json`. The casts are localized to:
      - `submittal_register_items.insert` — casts the row array to `SubmittalRegisterItemInsert[]`.
      - `workflow_runs.update` — casts `output_payload` and `output_summary` fields to the generated `WorkflowRunUpdate` field types.
      These are pragmatic boundary assertions where we know the values are JSON-serializable but TS can't structurally prove it. Same pattern recommended in supabase-js docs for typed JSONB columns.
    - Remaining type debt:
      - The two `as unknown as` casts above (small, clearly named, only at I/O boundary).
      - `source_finding_id` / `source_citation_id` are still always-null on persisted rows — would require expanding `SubmittalRegisterItem` to carry source IDs (defer; would change the tool return contract).
      - `triggered_by_role` is still always-null — would require a `users.role` lookup at the API-route layer (defer).
    - `npm run router:harness` passes — all 12 router classifications, plus pure-transform persistence checks.
    - `npm run build` passes — full type checking against the new generated `Database` type.

14. Read path for the latest persisted `submittal_register` workflow run, by project
    - Files:
      - `src/lib/chat/submittal-register.ts` — adds pure transform `reconstructLatestSubmittalRegisterRun` plus `LatestSubmittalRegisterRun`, `LatestSubmittalRegisterWorkflowRun`, `ReconstructWorkflowRunInput`, `ReconstructItemRowInput` types. No new DB imports — manual interface shapes mirror the persisted column set, matching the `SubmittalRegisterItemRow` pattern. Pure helpers; harness can load them without service-role.
      - `src/lib/chat/submittal-register-read.ts` *(new)* — `loadLatestSubmittalRegisterRun(supabase, projectId)`. Service-role client only. Two sequential reads: (1) `workflow_runs` filtered to `workflow_type='submittal_register'`, `status='completed'`, ordered `completed_at DESC NULLS LAST`, `limit 1`, `maybeSingle()`; (2) `submittal_register_items.item_payload` for that run + project, ordered `created_at ASC`. Returns a discriminated outcome `{ status: 'found' | 'not_found' | 'error', ... }`. Delegates reconstruction to the pure transform — service-role I/O and grouped-output assembly stay separate concerns.
      - `src/app/api/projects/[id]/submittal-register/latest/route.ts` *(new)* — `GET` handler. Auth via cookie-bound supabase, then `project_members` membership check (any role allowed for read), then `createServiceRoleClient()` and call to `loadLatestSubmittalRegisterRun`. Returns `{ success: true, found: false, run: null }` for `not_found`, `{ success: true, found: true, run }` for `found`, and 500 with sanitized detail for `error`. No DB schema, migration, or tool return contract changes.
      - `scripts/task-router-harness.mjs` — adds three pure-transform coverage blocks: (a) populated reconstruction (asserts `groupCountMatchesLive` against live `groupSubmittalRegisterForReview`), (b) empty `itemRows` case, (c) malformed `item_payload` filtering case (skips null + non-`SubmittalRegisterItem` payloads, keeps the one valid payload).
    - Auth / RLS approach: cookie-bound anon client for `auth.getUser()` + explicit `project_members` row check, then service-role for the two table reads. Mirrors the established `corrections/route.ts` and `memory/confirm/route.ts` pattern (auth via anon, privileged action via service-role). `workflow_runs` and `submittal_register_items` RLS policies (project-members + service_role) from migration `00050` cover both code paths.
    - Why this route placement: existing project-scoped routes (`analyze-complete`, `corrections`, `memory/confirm`) already follow `/api/projects/[id]/<feature>/<action>` — `submittal-register/latest` matches that convention. No UI was added; this is purely a backend read endpoint.
    - Grouped output reconstruction: each persisted `submittal_register_items.item_payload` is the original `SubmittalRegisterItem` snapshot (set during step 12). The pure transform feeds those payloads into the *same* `groupSubmittalRegisterForReview()` used by the live tool path, so grouped sections, ungrouped items, summary, and review flags are byte-for-byte equivalent to the original run. Malformed/null payloads are skipped (defensive — they should never exist post-step-12, but the transform won't throw if a row is corrupted). `summary` is recomputed via `buildOutputSummary()` rather than re-read from `workflow_runs.output_summary` so the reconstructed shape stays internally consistent with the items returned (in case some rows are filtered out as malformed).
    - Query shape (compact):
      - `workflow_runs`: select 12 columns (excludes `output_payload` / `output_summary` — reconstructed from items instead), `WHERE project_id = ? AND workflow_type = 'submittal_register' AND status = 'completed' ORDER BY completed_at DESC NULLS LAST LIMIT 1`. Uses `idx_workflow_runs_project_recent (project_id, workflow_type, completed_at DESC)` added in `00050`.
      - `submittal_register_items`: `SELECT item_payload WHERE project_id = ? AND workflow_run_id = ? ORDER BY created_at ASC`. Uses `idx_sri_run`. Project filter is redundant given the composite FK `fk_sri_run_project` but kept for defense-in-depth.
    - Harness coverage does NOT require a live Supabase — the pure transform is exercised directly with synthetic `runRow` + `itemRows` objects matching the DB column shape.
    - Type safety: the I/O wrapper uses `ReturnType<typeof createServiceRoleClient>` for the supabase client (no `any` cast). The pure transform takes structural input shapes, not generated `Database` types, so it remains harness-loadable without dragging in `@supabase/supabase-js`.
    - `npm run router:harness` passes — adds three new check blocks for reconstruction.
    - `npm run build` passes — new route appears as `/api/projects/[id]/submittal-register/latest` in the build output.

15. Backend review-status update path for persisted `submittal_register_items`
    - Files:
      - `src/lib/chat/submittal-register.ts` — adds:
        - `ALLOWED_REVIEW_STATUSES = ['pending','approved','approved_as_noted','rejected','needs_clarification','superseded'] as const`
        - `SubmittalRegisterReviewStatus` (literal union) + `isValidReviewStatus(value)` type guard
        - `SubmittalRegisterReviewUpdate` (normalized update payload), `ValidateReviewUpdateInput`, `ValidateReviewUpdateResult`
        - `validateSubmittalRegisterReviewUpdate(input)` — pure validator. Trims `reviewNotes` strings, normalizes empty/whitespace-only to `null`, rejects non-string notes, rejects unknown statuses, defaults `reviewedAt` to `new Date()` when omitted. No I/O imports — harness-loadable.
      - `src/lib/chat/submittal-register-review.ts` *(new)* — `updateSubmittalRegisterItemReview(supabase, opts)`. Service-role client only. Two-step:
        1. `submittal_register_items.select('id').eq('id', itemId).eq('project_id', projectId).maybeSingle()` — defense-in-depth existence check; returns `not_found` for wrong-project / unknown item rather than a silent zero-row update.
        2. `submittal_register_items.update({ review_status, review_notes, reviewed_by_user_id, reviewed_by_role, reviewed_at })` filtered by both `id` and `project_id`, with `.select(...).single()` to return the post-update row.
        Returns a discriminated outcome `{ status: 'updated' | 'not_found' | 'error', ... }`. Uses generated `Database['public']['Tables']['submittal_register_items']['Update']` for the update payload — no `any` casts.
      - `src/app/api/projects/[id]/submittal-register/review/route.ts` *(new)* — `POST` handler. Body: `{ item_id, review_status, review_notes? }`. Auth via cookie-bound supabase, then `project_members` membership check (any role). The user's `id` and `project_members.role` are used as `reviewed_by_user_id` and `reviewed_by_role` — clients cannot supply or override those fields. On success returns `{ success: true, item, allowedReviewStatuses }`; 400 for bad body / invalid status / missing item_id; 403 for non-members; 404 when the item is not in this project; 500 for service-role unavailability or update failure.
      - `scripts/task-router-harness.mjs` — adds eight validator cases (4 valid, 4 invalid) including: status `approved` with notes that are trimmed; status `rejected` with explicit `null` notes; whitespace-only notes normalized to `null`; missing `reviewedAt` defaults to ISO-now; unknown status string; empty status string; numeric status; numeric `review_notes`. Each case asserts `ok` flag, normalized fields, and ISO-string shape of `reviewedAt`.
    - Auth / RLS approach: same as `corrections`, `memory/confirm`, and `submittal-register/latest` — anon cookie client for `auth.getUser()` + `project_members` row check, then service-role for the update. No new SQL or RLS policy changes; existing `00050` policies cover the path. **`reviewed_by_user_id` and `reviewed_by_role` are server-derived from the authenticated session — clients cannot supply or override them.**
    - Review status validation: 6 allowed values (`pending`, `approved`, `approved_as_noted`, `rejected`, `needs_clarification`, `superseded`). The list is exported (`ALLOWED_REVIEW_STATUSES`) and surfaced in the success response so a caller can echo it for UI dropdowns without a separate metadata call. Matches the DB CHECK constraint in `00050` line 133 verbatim — application validator and DB CHECK stay in lock-step; if the schema set is ever widened, this constant must be updated alongside.
    - Update query shape:
      ```sql
      -- existence check
      SELECT id FROM submittal_register_items
      WHERE id = $1 AND project_id = $2 LIMIT 1;
      -- update + return
      UPDATE submittal_register_items SET
        review_status = $3,
        review_notes = $4,
        reviewed_by_user_id = $5,
        reviewed_by_role = $6,
        reviewed_at = $7
      WHERE id = $1 AND project_id = $2
      RETURNING id, project_id, workflow_run_id, review_status,
                review_notes, reviewed_by_user_id, reviewed_by_role,
                reviewed_at, updated_at;
      ```
      `updated_at` is auto-set by the existing `update_updated_at_column()` trigger on the table (added in `00050`).
    - Why this route placement: matches the established `<feature>/<action>` pattern (`memory/confirm`) — POST + body-carried `item_id`. Did not nest the item id in the path because all sibling routes use action-verb leaves (`memory/confirm`, `analyze-complete`, `submittal-register/latest`).
    - No grouped output rebuild here (per task spec) — the response carries only the updated row's review fields. A caller wanting the refreshed grouped view should re-hit `GET /api/projects/[id]/submittal-register/latest`.
    - Harness coverage does NOT require a live Supabase — only the pure validator is exercised.
    - `npm run router:harness` passes — adds eight validator-case assertions.
    - `npm run build` passes — new route appears as `/api/projects/[id]/submittal-register/review` in the build output.

## Next Recommended Step

Optional follow-ups, no clear single next step:
- Carry `entity_findings.id` and `entity_citations.id` through `SubmittalRegisterItem` so `source_finding_id` / `source_citation_id` get populated on persisted rows (would expand the tool's items shape — small payload contract change, decide first).
- Thread `users.role` lookup at the API layer so `triggered_by_role` is populated.
- Backfill `schema_migrations` history rows for `00049` (already-applied trigger) and `00050` (registered under timestamp `20260506000254` rather than `00050`) so future `supabase db push` reconciles cleanly.
- Begin extending the same persistence pattern to other routed task types (`spec_lookup`, `rfi_draft`, etc.) — the schema is generic; only the `workflow_type` CHECK and per-type item table need to evolve.

## Validation

Run:

```bash
npm run router:harness
npm run build
```
