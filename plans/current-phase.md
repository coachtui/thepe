# Current Phase: Phase 7 — Project-Scoped Memory Architecture

**Status:** DESIGN COMPLETE — implementation not yet started
**Design completed:** 2026-03-13
**Checklist tightened:** 2026-03-14

Full design spec: `plans/phase7-project-memory-architecture.md`

---

## Goal

Redesign plan Q&A from a stateless per-query pipeline into a project-scoped learning system.
Eliminate the failure mode where user corrections and plan-reader findings vanish between sessions.

---

## Role + Access Model (resolved 2026-03-14)

Two distinct role axes:

| Axis | Column | Values | Purpose |
|---|---|---|---|
| Access level | `project_members.role` | `owner`, `editor`, `viewer` | Controls what actions a user can take in the UI and API |
| Trust weight | `submitted_by_role` (self-reported TEXT) | `PE`, `superintendent`, `foreman`, `engineer`, `admin`, `ai_suggestion` | Controls how much weight a correction carries in retrieval |

**Action gating for Phase 7C/7F:**
- `owner` or `editor` → can submit corrections, accept/dispute memory items, add source quality modifiers
- `viewer` → read-only on all memory UI

**Trust weights (from architecture doc):**
- PE: 3.0 | Superintendent: 2.0 | Admin override: 2.5 | Engineer/Foreman: 1.0 | AI suggestion: 0.5 | Recheck finding (unconfirmed): 0.75

Note: `submitted_by_role` is self-reported at submission time (honor-system for Phase 7). No `PE` or `foreman` value exists in `users.role` CHECK constraint — these are correction-context labels only.

---

## Task Checklist

### Phase 7A — Foundation fixes
- [ ] **Fix Manual Analyze button bug**
  - File: `src/lib/processing/vision-processor.ts`
  - Currently: calls `processDocumentWithVision()` but does NOT call `indexDocumentPage()`
  - Fix: call `indexDocumentPage()` per page (same pattern as `src/inngest/functions/vision-process-document.ts`)
  - Verify: `document_pages` and `sheet_entities` are populated after manual analyze
  - Unblocks: plan reader sheet narrowing, recheck workflow (Phase 7D), sheet hint lookups
- [ ] **Add query tracing fields to `EvidenceItem` type** (`src/lib/chat/types.ts` or wherever EvidenceItem is defined)
  - Add `query_id: string` — unique ID per chat request, passed through all retrieval steps
  - Add `source_confidence_at_retrieval: number` — capture raw confidence before any modifier is applied
- [ ] **Add `data_source_counts` to `ChatResponse` type**
  - Shape: `{ vision_db: number, vector: number, plan_reader: number, graph: number }`
  - Populate in `chat-handler.ts` by counting evidence items per source
- [ ] **Add debug trace endpoint**
  - `GET /api/projects/[id]/query-trace/[queryId]`
  - Returns all EvidenceItems for the given query_id (read from wherever chat-handler logs them)
  - Scope: server-side only, no auth requirement beyond project membership

### Phase 7B — Memory schema + load
- [ ] **Write migration `supabase/migrations/00047_project_memory.sql`**
  - Schema is fully specified in `plans/phase7-project-memory-architecture.md` Section C
  - Tables: `project_memory_items`, `project_corrections`, `memory_confirmations`, `project_source_quality`, `recheck_sessions`
  - All 5 tables need RLS enabled (policies: project members read; service role writes)
- [ ] **Create `src/lib/chat/project-memory.ts`**
  - `loadProjectMemory(projectId: string): Promise<ProjectMemoryContext>`
    - Queries `project_memory_items WHERE project_id = ? AND validation_status = 'accepted'`
    - Returns: `{ aliases: MemoryItem[], calloutPatterns: MemoryItem[], sheetHints: MemoryItem[], sourceQuality: SourceQualityItem[] }`
  - `resolveAliases(entities: string[], ctx: ProjectMemoryContext): Record<string, string[]>`
    - Expands each entity against aliases + system_alias items
    - Filter by discipline if available; if unknown, return all ranked by confirmed_by_count
  - `getSourceQuality(source: string, discipline: string | null, system: string | null, ctx: ProjectMemoryContext): { cap: number | null, modifier: number | null }`
- [ ] **Wire into `chat-handler.ts`**
  - Step 0 (before query analysis): call `loadProjectMemory(projectId)` and attach to request context
  - Step 0.5 (after query analysis, before any lookup): call `resolveAliases()` on extracted entities
  - Pass alias map into `query-analyzer.ts` entity extraction context
  - Pass `calloutPatterns` into `plan-reader.ts` Haiku prompt context (inject as "known abbreviations for this project: ...")

### Phase 7C — Correction capture
- [ ] **Create `POST /api/projects/[id]/corrections/route.ts`**
  - Auth check: `project_members.role IN ('owner', 'editor')`
  - Body schema:
    ```
    {
      query_text: string,
      query_answer_mode: string,
      sheet_number?: string,
      discipline?: string,
      system_queried?: string,
      expected_item?: string,
      missed_item_type?: string,
      how_it_appeared?: 'text'|'symbol'|'detail'|'legend'|'note'|'profile'|'schedule'|'plan_view'|'unknown',
      ai_response_excerpt?: string,
      ai_detected_value?: string,
      ai_confidence?: number,
      expected_value: string,
      submitted_by_role: string,   // self-reported: PE, superintendent, foreman, engineer
      evidence_reference?: string,
      notes?: string
    }
    ```
  - Writes row to `project_corrections` (validation_status = 'pending')
  - If submitted_by_role weight ≥ 2.0 (superintendent or above): also auto-write a linked `project_memory_items` row with `validation_status = 'accepted'`
  - If weight < 2.0: memory item stays 'pending' until confirmed
- [ ] **Create `POST /api/projects/[id]/memory/confirm/route.ts`**
  - Body: `{ memory_item_id: string, vote: 'confirm' | 'dispute', note?: string }`
  - Writes to `memory_confirmations` (UNIQUE constraint prevents double-voting)
  - Updates `confirmed_by_count` / `rejected_by_count` on the parent `project_memory_items` row
  - If `rejected_by_count > confirmed_by_count`: set `validation_status = 'disputed'`
- [ ] **Modify `retrieval-orchestrator.ts`**
  - After vision_db lookup: merge accepted corrections from `project_corrections WHERE project_id = ? AND system_queried = ? AND validation_status = 'accepted'`
  - Mark merged items with `source = 'user_correction'` and attach provenance fields
- [ ] **Modify `evidence-evaluator.ts`**
  - After computing raw confidence: call `getSourceQuality()` and apply `confidence_cap` / `confidence_modifier`
  - If multiple accepted corrections exist for same entity: override AI confidence with correction confidence
- [ ] **UI: correction modal in chat** (`src/components/chat/ChatMessage.tsx` or equivalent)
  - Add lightweight action bar below each assistant message: `[✓ Correct] [⚑ Flag Issue] [↻ Recheck Plans]`
  - "Flag Issue" opens modal pre-filled with query text + detected value + sheet citations
  - User fills: expected value, how it appeared (dropdown), sheet number, job role, notes
  - On submit: `POST /api/projects/[id]/corrections`
- [ ] **UI: inline provenance citations in responses**
  - When response includes a corrected fact: append brief citation — "corrected by [role] on [date], Sheet [X]"
  - When response uses an unverified memory item: add caveat — "interpretation based on unverified field correction"
  - When confidence level is `disputed`: show both values with sources — do not state either as fact

### Phase 7D — Recheck workflow
**Dependency: Phase 7A must be complete** (recheck needs `document_pages` populated; graceful error if empty: "Sheet index is incomplete — run document reprocessing first.")

- [ ] **Create `src/lib/chat/recheck-workflow.ts`**
  - Input: `{ projectId, query, discipline?, systemContext?, forceSheets?: string[] }`
  - Step 1: identify candidate sheets from `document_pages` WHERE system appears + `project_memory_items` WHERE type='sheet_hint' for system
  - Step 2: live vision pass on candidate sheets (reuse `plan-reader.ts` core logic; no stored data)
  - Step 3: fetch stored `project_quantities` for same system → compare against live findings
  - Step 4: compute delta — `{ storedValue, liveValue, deltaDetected, deltaSummary }`
  - Step 5: offer write-back — if user accepts, write to `project_memory_items` with `source_type='recheck_finding'` + provenance
  - Step 6: log session in `recheck_sessions`
- [ ] **Create `POST /api/projects/[id]/recheck/route.ts`**
  - Body: `{ query: string, discipline?: string, systemContext?: string, forceSheets?: string[] }`
  - Calls `recheck-workflow.ts`, returns delta result as streaming or single response
  - Auth check: `project_members.role IN ('owner', 'editor')`
- [ ] **UI: Recheck Plans button**
  - Location: same action bar as correction modal (`[✓ Correct] [⚑ Flag Issue] [↻ Recheck Plans]`)
  - Available when: response confidence is medium or low, or after a correction is submitted
  - Clicking triggers `POST /api/projects/[id]/recheck` with query + detected discipline/system from response
  - Progress shown inline: "Inspecting sheets C-003, C-004, C-005..."
  - Delta result shown with diff highlighting; Accept / Dismiss controls

### Phase 7E — Confidence-aware responses
- [ ] **Add `confidenceLevel` to `EvidencePacket` type** (`types.ts`)
  - `confidenceLevel: 'high' | 'medium' | 'low' | 'disputed'`
- [ ] **Update `evidence-evaluator.ts`**
  - Compute `confidenceLevel` per the policy table (see `plans/phase7-project-memory-architecture.md` Section D3)
  - Add dispute detection: if `confirmed_by_count < rejected_by_count` on any evidence item → set `confidenceLevel = 'disputed'`
- [ ] **Update `response-writer.ts`**
  - Inject confidence-appropriate language based on `confidenceLevel`:
    - `high`: state fact directly, cite sheets
    - `medium`: state with caveat — "Based on available data, with some uncertainty. Recommend field verification for critical decisions."
    - `low`: do not state as fact — "Current data suggests X, but evidence is incomplete. Recommend running Recheck Plans on sheets [Y, Z] before acting on this answer."
    - `disputed`: explicitly surface conflict — "Project data is disputed. [User A] reported X on [date]. [User B] reported Y. Recommend direct sheet review."
  - Inject provenance citations when answer uses corrected or unverified memory items

### Phase 7F — Project Memory dashboard UI
- [ ] **New page: `src/app/projects/[id]/memory/page.tsx`**
  - Tab layout with 4 tabs: Aliases | Corrections | Source Quality | Recheck History
  - Auth: any project member can view; `project_members.role IN ('owner', 'editor')` required for actions
  - Add link to project sidebar nav (below Documents / Chat)

- [ ] **Tab 1: Aliases** — `src/components/memory/AliasesTab.tsx`
  - Source: `GET /api/projects/[id]/memory/items?type=alias,callout_pattern,system_alias`
  - Columns: Original Text | Normalized Value | Type | Discipline | System | Submitted By | Role | Date | Status
  - Actions (owner/editor): Accept | Dispute (calls `/memory/confirm`)
  - Filters: discipline dropdown, item_type, validation_status

- [ ] **Tab 2: Corrections** — `src/components/memory/CorrectionsTab.tsx`
  - Source: `GET /api/projects/[id]/corrections`
  - Columns: Query | Expected Value | AI Value | Sheet | Discipline | System | Submitted By | Role | Date | Status
  - Actions (owner/editor): Accept (promotes to memory item, `validation_status = 'accepted'`) | Dispute
  - Filters: discipline, system_queried, validation_status

- [ ] **Tab 3: Source Quality** — `src/components/memory/SourceQualityTab.tsx`
  - Source: `GET /api/projects/[id]/source-quality`
  - Columns: Source | Discipline | System | Confidence Cap | Modifier | Reason | Set By | Role | Date
  - Actions (owner only): Add new modifier | Remove
  - Collapsed behind "Advanced" toggle by default — this is a power-user setting

- [ ] **Tab 4: Recheck History** — `src/components/memory/RecheckHistoryTab.tsx`
  - Source: `GET /api/projects/[id]/recheck`
  - Columns: Date | Query | System | Sheets Inspected | Stored Value | Live Value | Delta? | Accepted?
  - Read-only — audit trail, no actions
  - "Re-run" link on each row: opens chat with the original query pre-filled

- [ ] **Shared components**
  - `src/components/memory/MemoryItemRow.tsx` — table row with inline provenance display
  - `src/components/memory/ProvenanceBadge.tsx` — compact "submitted by [name] ([role]) on [date]" badge

- [ ] **New API routes for 7F (read)**
  - `GET /api/projects/[id]/memory/items` — paginated, filterable by type/discipline/status
  - `GET /api/projects/[id]/corrections` — paginated, filterable (POST in 7C; GET here)
  - `GET /api/projects/[id]/source-quality` — full list
  - `GET /api/projects/[id]/recheck` — paginated list of recheck_sessions
  - `PATCH /api/projects/[id]/memory/items/[itemId]` — update validation_status (owner/editor only)
  - `POST /api/projects/[id]/source-quality` — add modifier (owner only)
  - `DELETE /api/projects/[id]/source-quality/[itemId]` — remove modifier (owner only)

---

## Blockers

- Phase 7D depends on Phase 7A (Manual Analyze button bug populates `document_pages`)
- No correction API exists yet — all of 7C is net-new
- `PE` role does not exist in `users.role` CHECK constraint — `submitted_by_role` is self-reported text (honor-system) for Phase 7; add enforcement in a future phase if needed

---

## Key Files

| File | Status | Purpose |
|---|---|---|
| `plans/phase7-project-memory-architecture.md` | DONE | Full design doc, schema, flow |
| `src/lib/processing/vision-processor.ts` | TO FIX | Manual Analyze button bug (7A) |
| `src/lib/chat/types.ts` | TO MODIFY | Add query_id, source_confidence_at_retrieval, confidenceLevel |
| `src/lib/chat/project-memory.ts` | TO CREATE | Memory load/alias resolution (7B) |
| `supabase/migrations/00047_project_memory.sql` | TO CREATE | 5 new tables (7B) |
| `src/app/api/projects/[id]/corrections/route.ts` | TO CREATE | POST correction (7C) |
| `src/app/api/projects/[id]/memory/confirm/route.ts` | TO CREATE | Confirm/dispute memory item (7C) |
| `src/lib/chat/recheck-workflow.ts` | TO CREATE | Live recheck logic (7D) |
| `src/app/api/projects/[id]/recheck/route.ts` | TO CREATE | Recheck API (7D) |
| `src/app/projects/[id]/memory/page.tsx` | TO CREATE | Dashboard page (7F) |
| `src/components/memory/` | TO CREATE | Dashboard tab components (7F) |

---

## Testing Targets

- Query: "what fittings are on Water Line A?" — should now pick up aliases like "HORIZ DEFL"
- Submit a correction → re-query same question → should return corrected value with provenance citation
- Recheck workflow → live inspection result should differ from stored value and surface delta
- Superintendent correction vs. viewer correction → superintendent correction auto-accepted; viewer stays pending
- Disputed item (two conflicting corrections) → response flags conflict, does not state either as fact
- Memory dashboard → owner can accept a pending correction; viewer cannot

---

## Suggested Next-Window Prompt (Lead Builder / `/build`)

```
We are implementing Phase 7A of the project-scoped memory architecture.
Read plans/current-phase.md, handoff.md, and plans/phase7-project-memory-architecture.md first.

Phase 7A has four deliverables:

1. Fix Manual Analyze button bug:
   - File: src/lib/processing/vision-processor.ts
   - It currently calls processDocumentWithVision() but does NOT call indexDocumentPage()
   - The Inngest path in src/inngest/functions/vision-process-document.ts correctly calls indexDocumentPage()
   - Wire the same indexDocumentPage() call into vision-processor.ts for each page processed
   - Verify: document_pages and sheet_entities are populated after manual analyze

2. Add query_id: string to EvidenceItem type (unique per chat request, threaded through all retrieval steps)

3. Add source_confidence_at_retrieval: number to EvidenceItem type (raw confidence before any modifier)

4. Add data_source_counts: { vision_db: number, vector: number, plan_reader: number, graph: number }
   to ChatResponse type, populated in chat-handler.ts by counting evidence items per source

Do NOT start migration 00047 or project-memory.ts yet — those are Phase 7B.
```
