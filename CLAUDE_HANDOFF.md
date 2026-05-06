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

16. Project-scoped submittal register review UI (panel embedded in the existing project page)
    - Files:
      - `src/components/submittal/SubmittalRegisterReview.tsx` *(new)* — `'use client'` panel component, single named export `SubmittalRegisterReview({ projectId })`. Mirrors the existing project-page design language: `bg-white rounded-lg shadow p-6` cards, stock Tailwind palette (`bg-blue-600/text-white` actions, `bg-blue-100/text-blue-800` pills, `bg-red-50 border border-red-200` errors, `border-gray-200` separators) — no shadcn/Radix/lucide pulled in. Plain `<select>` for status + `<textarea>` for notes; Save/Reset buttons. Per-item save state is local — no global store.
      - `src/app/(dashboard)/projects/[id]/page.tsx` — adds a single import and a single new `<div className="pt-6 border-t border-gray-200"><SubmittalRegisterReview projectId={params.id} /></div>` section after the existing AI Assistant block. No restructuring of the rest of the page.
      - `src/lib/chat/submittal-register.ts` — extends `SubmittalRegisterItem` with five **optional** persistence-only fields: `persistedItemId?`, `reviewStatus?`, `reviewNotes?`, `reviewedAt?`, `reviewedByRole?`. Set ONLY by the read-path reconstructor; the live `buildSubmittalRegisterFromSpecs` path never sets them, so `JSON.stringify` omits them and the buildSubmittalRegister tool return contract is byte-for-byte unchanged. Adds `mergeRowOntoItemPayload(row)` private helper. Widens `ReconstructItemRowInput` to optionally accept `id`, `review_status`, `review_notes`, `reviewed_at`, `reviewed_by_role` — when present these merge onto the frozen `item_payload` snapshot.
      - `src/lib/chat/submittal-register-read.ts` — widens the `submittal_register_items` SELECT from `'item_payload'` only to `'id, item_payload, review_status, review_notes, reviewed_at, reviewed_by_role'` so the reconstructor has the live review state. No new tables, no schema changes.
      - `scripts/task-router-harness.mjs` — extends the existing reconstruction block with synthetic per-item review state (item 0 → approved + notes, item 1 → rejected + notes, item 2 → pending + null notes), then asserts: `firstItemPersistedId`, `firstItemReviewStatus = 'approved'`, `firstItemReviewNotes = 'Looks good.'`, `secondItemReviewStatus = 'rejected'`, `thirdItemReviewedAt = null`, and crucially `liveItemHasNoPersistedFields = true` — confirming the merge does NOT mutate the upstream `reviewSource.items` (so the live tool path is untouched).
    - Page/route: no new route was added — the UI is a panel inside the existing `(dashboard)/projects/[id]/page.tsx`. This matches the project's pattern of mounting feature components (`ChatInterface`, `DocumentUpload`, `DocumentSearch`, `DocumentList`) inside the single project page rather than fanning out to subpages.
    - Data loading approach:
      - On mount: `fetch('/api/projects/[id]/submittal-register/latest', { credentials: 'include' })` → response `{ success, found, run | null }`. On success populates `data` + `found` state. On any failure (`!res.ok` or thrown) sets `error` and renders a calm red banner above the content.
      - Manual "Refresh" button at the panel header re-fetches without unmounting (`refreshing` flag toggles button label only). Auto-refetch is *not* triggered on save — local state is patched optimistically in-place via `patchItemInRun(run, itemId, updated)`, which walks `items[]`, `groupedSections[].items[]`, and `ungrouped[]` and replaces matching items by `persistedItemId`. This avoids a full reload after every keystroke-saved row and keeps scroll position stable.
    - Review update behavior:
      - Per-row local `drafts[itemId]: { status, notes }` only exists once the user changes status or notes; until then the row reads `currentStatus` / `currentNotes` directly from the persisted item. `Save` button is disabled when `!isDirty || saving`.
      - On Save: `POST /api/projects/[id]/submittal-register/review` with `{ item_id, review_status, review_notes }`. `review_notes` is whitespace-trimmed → empty becomes `null` (matches the server validator's normalization).
      - On 200 `{ success: true, item }`: patch the run via `patchItemInRun`, drop the draft, clear row error.
      - On error: keep the draft, set `rowSave[itemId].error` to the server message, render inline (`text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2`). The user can edit and retry, or hit Reset.
      - `Reset` discards the draft and clears row error.
    - Empty / error states:
      - Loading: simple "Loading latest submittal register…" inside an empty card. No skeleton — the UI is field-targeted, not a marketing dashboard.
      - `found === false` (no run): gray neutral card with "No submittal register run exists for this project yet" + a one-line hint to ask the assistant to build one. Not styled as an error.
      - `found === true && items.length === 0`: gray neutral card with "The latest run completed but contained no items" plus the run's `reviewFlags` if any.
      - API error (any 4xx/5xx or thrown): red banner at the top of the panel, rest of the panel still renders so previously-loaded state isn't lost.
      - Per-item save error: inline red message under the row's Save button — does not interrupt other rows.
    - Status options surfaced in the `<select>`: all 6 `ALLOWED_REVIEW_STATUSES` (`pending`, `approved`, `approved_as_noted`, `rejected`, `needs_clarification`, `superseded`). Local copy of the literal array on the client to avoid pulling server-only modules into a `'use client'` component (the constant must stay in lock-step with `submittal-register.ts` `ALLOWED_REVIEW_STATUSES`).
    - Display fields per item: `submittalItem` (primary line) · current `reviewStatus` pill · `submittalType` pill · `approvalRequired` pill · `sourceQuality` pill (with `confidence` %) · `citationCompleteness` indicator · source-reference line (spec section, document name, page number, part reference) · excerpt blockquote · review controls (status select + notes textarea + Save/Reset).
    - No export/PDF added (per task spec).
    - `npm run router:harness` passes — extends the existing reconstruction harness with merge-state assertions; no new top-level blocks needed.
    - `npm run build` passes — `/projects/[id]` grew from 9.59 kB → 12.5 kB First Load JS for the new panel; no new routes appeared.

17. Document-type-aware upload + vision-pipeline gating (Option A, phases A1+A2)
    - Architectural context: per `project_routed_specialists_architecture.md` and `project_pipeline_doc_type_split.md`, the system is a routed network of small specialists. Vision is the right tool for drawings only; specs / schedules / submittals are text-heavy and don't need vision. This phase makes the pipeline honor that distinction.
    - Files:
      - `src/lib/documents/document-types.ts` *(new)* — single source of truth for the type taxonomy. Exports `DOCUMENT_TYPES = ['drawing','spec','schedule','submittal','other']`, `DOCUMENT_TYPE_LABELS`, `DOCUMENT_TYPE_HELP`, `DocumentType` literal union, `isValidDocumentType()` type guard, `isVisionEligible(documentType)` helper. **NULL is treated as vision-eligible** so legacy uploads (pre-A1) keep their existing behavior with zero regression.
      - `src/components/documents/DocumentUpload.tsx` — adds a required `<select>` above the dropzone (`drawing | spec | schedule | submittal | other`, default `drawing`). Help text under the picker explains what each type means and whether it goes through vision. Selected value flows through `createDocument()` as `document_type`. Disabled while uploading.
      - `src/lib/vision/auto-process.ts` — `shouldAutoProcessVision()` now also fetches `document_type` and short-circuits with a `[SKIP-NON-DRAWING]` log line when `isVisionEligible(document_type)` is false. Added before the existing PDF / text-complete / vision-pending checks so non-drawing types never reach those.
    - DB schema: NO migration. `documents.document_type` column already exists (`text`, nullable, no CHECK constraint — verified via `information_schema.columns`). App-layer validation only for v1; a DB-level CHECK can be added later if desired.
    - Backfill (live): updated the Ammunition project (`c455e726-b3b4-4f87-97e9-70a89ec17228`) via Supabase MCP — `AmmunitionStorageWL_Amendment0002_Specifications.pdf` → `document_type='spec'`, `Ammunition_Storage_Drawings_redline.pdf` → `document_type='drawing'`. Done by filename heuristic (`ILIKE '%spec%'` / `ILIKE '%drawing%'`); both files matched cleanly.
    - Behavior change summary:
      - **Drawings:** unchanged. Same vision pipeline, same cost, same output.
      - **Specs / schedules / submittals / other:** vision pipeline now skipped. Saves the full vision call cost (~$1–2/project on average per `project_inngest_vision.md`). Text extraction (LlamaParse → chunks → embeddings) still runs as before.
      - **Legacy uploads (NULL `document_type`):** unchanged. `isVisionEligible(null) === true`, so existing rows keep running through vision exactly as before.
    - What this does NOT do (deferred to A3):
      - Spec-extractor still has zero callers. Specs upload, get text-extracted and chunked, but `project_entities` rows with `discipline='spec'` are still NOT created. `buildSubmittalRegister` will continue to return zero items until A3 wires `src/lib/vision/spec-extractor.ts` into a real Inngest function with Haiku 4.5 at temperature 0.
      - No DB-level CHECK constraint on `document_type` — app-layer validation only.
      - No UI for showing the type pill on the existing `DocumentList` (deferred — additive, not blocking).
    - Build / harness:
      - `npm run router:harness` passes (no new harness blocks; the changes are in the upload UI + Inngest gating, neither of which the harness exercises).
      - `npm run build` passes. `/projects/[id]` First Load JS: 12.5 kB → 12.9 kB (+0.4 kB for the type picker).

18. Spec extraction pipeline — pure orchestrator (Option A, phase A3a)
    - Architectural context: per `project_routed_specialists_architecture.md`, structured extraction is a routed-specialist task. Spec extraction is the next specialist after the document classifier. This phase ships only the *pure transform* — no I/O, no Inngest, no DB writes, no auto-trigger, no API routes. Persistence (A3b), Inngest wiring (A3c), and the manual re-run endpoint (A3d) follow in their own commits.
    - Files:
      - `src/lib/chat/spec-extraction-pipeline.ts` *(new)* — single export `runSpecExtractionPipeline(input)`, plus exported phrase-detection helpers `detectApprovalRequired(text)` / `detectRecordOnly(text)`. Imports the deterministic helpers from `src/lib/vision/spec-extractor.ts` (`classifySpecDocument`, `extractSpecSections`, `splitIntoParts`, `classifyRequirement`, `extractRequirementStatements`, `buildSpecSectionCanonical`, `buildSpecRequirementCanonical`, `SPEC_SECTION_EXTRACTION_PROMPT`) — all already-existing pure functions that until now had zero callers.
      - `scripts/task-router-harness.mjs` — adds five harness blocks: happy-path (3 sections, regex agrees with model on 3/4 requirements, approval/record-only counts asserted, source chunks + page numbers attached); malformed-JSON (validationFailed=true, warning surfaced, regex first-pass still populated); oversize-section (skipped against `maxSectionChars=1000`, no LLM cost, `regexFirstPassTotal` still computed); approval/record-only phrase detection table over 8 sample strings.
      - `tsconfig.json` — adds `allowImportingTsExtensions: true` so the pipeline can use a literal `.ts` import path for `'../vision/spec-extractor.ts'`. Required because the harness loads the pipeline via Node 24's native TS support (which strict-resolves paths) AND the tsc build under `moduleResolution: "bundler"`. `noEmit: true` was already set (the prerequisite for the flag). No bundler behavior change.
    - Pipeline API (input):
      - `projectId, documentId, documentMeta { title?, filename }, chunks, llmCaller, options?`
      - `chunks: Array<{ id, chunk_index, content, page_number?, metadata? }>` — caller-supplied; pipeline sorts by `chunk_index` defensively, never trusts caller ordering.
      - `llmCaller: ({ prompt, sectionText, sectionContext, modelHint? }) => Promise<{ rawText, modelUsed?, costUsd?, error? }>` — fully decoupled from the Anthropic SDK. The pipeline sets `modelHint` only as a hint; a future wrapper passes `'haiku'` by default and `'sonnet'` on retry. Pipeline does not interpret the hint.
      - `options.maxSectionsPerDocument` (default 250) and `options.maxSectionChars` (default 60000) are the two guardrails.
    - Output shape (high-level):
      - `documentClassification: SpecDocumentType | null` — output of `classifySpecDocument(title, filename)`.
      - `sections[]` — one entry per CSI section detected, each with: `sectionNumber`, `sectionTitle`, `canonicalName` (`SPEC_03_30_00`), `divisionNumber` (`'03'`), `parts { general, products, execution }`, `partsText { general, products, execution }`, `requirements[]`, `referencedStandards[]`, `confidence` (clamped to [0,1]), `validationFailed`, `warnings[]`, `sectionCharCount`, `sourceChunkIds[]`, `sourcePageNumbers[]`, `modelUsed?`, `costUsd`, `regexFirstPassByFamily { material_requirement[], execution_requirement[], …, unclassified[] }`, `regexFirstPassTotal`.
      - Each `requirements[]` entry carries: `requirementType` (validated against the seven-family allow-set), `statement` (verbatim), `partReference`, `confidence`, `canonicalName` (`SPEC_03_30_00_REQ_SUBMITTAL_REQUIREMENT_001`), `regexFamily` (cross-check vs the model — surfaced separately rather than overriding the model), `approvalRequired`, `recordOnly`, `requirementTypeRemapped` (true when the model emitted an unknown family that was conservatively defaulted to `execution_requirement`).
      - Top-level: `totalSections`, `sectionsAttempted`, `sectionsSucceeded`, `totalCostUsd`, `warnings[]`.
    - Regex first-pass behavior:
      - Per section, `extractRequirementStatements()` runs against `partsText.general`, `partsText.products`, `partsText.execution`, AND the full body (deduped by lowercased trimmed key). Each statement is classified by `classifyRequirement()` and bucketed into one of the seven families or `unclassified`.
      - The first-pass output is exposed verbatim on the section result. It is NOT used to override the LLM output — only as a cross-check signal (`requirements[].regexFamily`) and as a fallback corpus when the LLM call fails entirely (downstream consumer can ingest `regexFirstPassByFamily` if `validationFailed === true`).
      - Approval-gating phrases (`APPROVAL_PHRASES`) and record-only phrases (`RECORD_ONLY_PHRASES`) are applied at the *requirement* level via `detectApprovalRequired()` / `detectRecordOnly()`. Both helpers are exported for harness + future caller usage.
    - LLM caller contract:
      - Pipeline is the boundary owner; the caller owns the actual API call. Caller is given `prompt = SPEC_SECTION_EXTRACTION_PROMPT`, `sectionText` (the full section body, capped by `maxSectionChars`), and `sectionContext { sectionNumber, sectionTitle, sectionCharCount }`.
      - Caller returns `{ rawText, modelUsed?, costUsd?, error? }`. Caller errors are caught (try/catch around the call) and converted to section warnings + `validationFailed=true`; thrown errors are also caught — pipeline never throws on a single-section LLM failure.
      - Schema validation in `validateSectionJson()` is permissive on optional fields and strict on required ones (top-level must be object; `requirements[].statement` must be a non-empty string). Unknown `requirementType` values map to `execution_requirement` (per the prompt's conservative default) and are flagged via `requirementTypeRemapped: true`.
      - Markdown code fences (` ```json ... ``` `) are stripped before `JSON.parse`. If parse still fails, the section is marked `validationFailed=true` with a clear warning. No best-effort prose extraction.
    - Guardrails:
      - `maxSectionsPerDocument` (default 250) caps the LLM call count. Excess sections are dropped with a top-level warning.
      - `maxSectionChars` (default 60000) skips the LLM call entirely for oversize sections; the section is still returned with `parts`, `partsText`, `regexFirstPassByFamily`, source chunks/pages, and a clear warning. `validationFailed` stays false (this is an explicit guardrail skip, not a validation failure).
      - No DB writes — file does not import the Supabase client.
      - No network calls — file does not import any HTTP / Anthropic SDK. Only the injected `llmCaller` can perform I/O.
      - No infinite loops — every loop is bounded by either input length, `maxSectionsPerDocument`, or `maxSectionChars`.
    - Harness coverage (no live Supabase, no real LLM):
      - **CSI extraction**: 4 chunks → 3 sections detected (`03 30 00`, `33 05 00`, `09 91 23`) with correct titles + canonical names + division numbers.
      - **PART 1/2/3 splitting**: `03 30 00` correctly shows `parts: { general: true, products: true, execution: true }`.
      - **Submittal requirement extraction**: 2 submittal requirements in `03 30 00`; `regexAgreesWithModel: true` on 3 of 4 requirements; the disagreement (`material_requirement` regex vs `execution_requirement` model) is surfaced cleanly and not silently overridden.
      - **Approval vs record-only**: `approvalRequiredCount: 1` on `03 30 00`; record-only sample correctly flagged; ambiguous statements get neither flag.
      - **Malformed JSON**: `validationFailed: true`, zero requirements, warning text clear, regex first-pass still ran (`regexFirstPassTotal: 1`).
      - **Oversize section**: section body 57524 chars vs 1000 limit → LLM call skipped, `costUsd: 0`, warning clear, regex first-pass still ran.
    - Build / harness:
      - `npm run router:harness` exit 0. Output is print-based per the existing harness convention; spot-check by scanning for the `Spec extraction —` blocks.
      - `npm run build` passes. No new routes; one shared module added (`spec-extraction-pipeline.ts`). `/projects/[id]` First Load JS unchanged at 12.9 kB (the pipeline is server-only — never bundled into client routes).

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
