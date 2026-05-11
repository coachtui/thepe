# Phase 8: Operational Graph Layer — Project Entities + Typed Relations

**Date:** 2026-05-10
**Status:** DESIGN — not yet implemented
**Architectural anchor:** the "knowledge base / retrieval" layer in the routed-specialists architecture diagram (see `memory/project_routed_specialists_architecture.md`). This phase builds the structured operational state that specialists query instead of loading documents into context.

---

## A. The problem

Construction operations are a graph. Submittals link to FOW link to schedule activities link to inspections link to procurement link to crews. In the current system, those links are loose strings on `submittal_register_items`:

- `lifecycleResponsibleParty` — text
- `featureOfWork` — text
- `scheduleActivity` — text

These are data, not relations. The system cannot answer:

- *"What features of work are currently blocked by pending submittals?"*
- *"Which schedule activities are at risk because their submittals are revise/resubmit?"*
- *"What's the readiness state of the slab pour next Tuesday?"*

Because FOW isn't an entity — it's a string. Two submittals can reference the same FOW with slightly different spellings and the system has no idea they're the same thing.

This phase promotes the entities that matter operationally to first-class rows with typed relations between them. Once FOW is an entity, *every other subsystem* (schedule, inspections, procurement) can attach to it the same way.

---

## B. The two primitives

### B1. First-class entity tables (typed, not generic)

Each operational concept gets its own table with its own status and metadata. Not a generic `entities` table — typed tables are more constrained, more queryable, and let each subsystem evolve its own specialist schema.

Phase 8A introduces one new entity table:

```sql
project_features_of_work (
  id            UUID PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES projects(id),
  name          TEXT NOT NULL,         -- "Slab on grade — Bldg 2"
  discipline    TEXT,                  -- 'civil' | 'structural' | 'mep' | ...
  status        TEXT NOT NULL,         -- 'planned' | 'active' | 'blocked' | 'complete'
  description   TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Later sub-phases add:
- `project_schedule_activities` (Phase 8B)
- `project_inspections` (Phase 8C)
- `project_procurement_items` (Phase 8D)
- `project_equipment` (later)
- `project_crews` (later)

### B2. Typed relations table

One generic `entity_relations` table is sufficient — relations are uniform shape regardless of which entities they connect:

```sql
entity_relations (
  id            UUID PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES projects(id),
  source_type   TEXT NOT NULL,         -- 'submittal' | 'fow' | 'schedule_activity' | ...
  source_id     UUID NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     UUID NOT NULL,
  relation_type TEXT NOT NULL,         -- see below
  confidence    REAL NOT NULL DEFAULT 1.0,
  provenance    JSONB NOT NULL DEFAULT '{}', -- {source: 'spec_extraction' | 'user' | 'inference', ...}
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_type, source_id, target_type, target_id, relation_type)
)
```

Initial relation types in Phase 8A:
- `submittal_required_for_fow` — this submittal must be approved before FOW can start
- `submittal_blocks_fow` — derived view of the above, restricted to pending/rejected submittals

Future relation types as later phases land:
- `fow_scheduled_as_activity` — FOW maps to a schedule activity
- `inspection_required_for_fow` — FOW needs this inspection before close-out
- `procurement_for_submittal` — material PO depends on submittal approval
- `spec_section_governs_submittal` — provenance link
- `rfi_about_spec_section` — RFI references a spec section

Indices on `(project_id, source_type, source_id)` and `(project_id, target_type, target_id)` make neighborhood queries fast.

### B3. Why typed tables, not one generic `entities` table

A generic table is cheaper to add new types but loses constraint enforcement, type-specific indexes, and meaningful column names. Submittal already has its own table with rich fields; FOW deserves the same. The cost of N typed tables is paid once; the benefit (query clarity, schema-as-documentation, RLS per type) is paid every day.

The **relations** are uniform, so one generic relations table is correct there.

---

## C. Phase 8A — FOW promotion (this sub-phase)

**Goal:** Promote `featureOfWork` from a string field to a first-class entity with a relation to its submittals. Surface a "Features of Work" view that shows which FOW are blocked by pending submittals.

### Deliverables

1. **Migration `00053_fow_entities_and_relations.sql`**
   - Create `project_features_of_work`
   - Create `entity_relations`
   - Indexes + RLS policies (project members read; service role writes)

2. **Backfill: `scripts/backfill-fow-entities.mjs`**
   - For each project, gather unique non-null `featureOfWork` strings from `submittal_register_items.item_payload`
   - Normalize whitespace + case, dedupe (e.g. "slab on grade" == "Slab On Grade")
   - Insert one `project_features_of_work` row per unique normalized FOW
   - Insert one `entity_relations` row per submittal → FOW link with `relation_type = 'submittal_required_for_fow'`, `provenance.source = 'backfill_from_string_field'`
   - Idempotent — re-runnable without duplicating

3. **Pure query module: `src/lib/graph/fow-readiness.ts`**
   - `getFowReadiness(projectId, fowId)` → returns:
     ```
     {
       fow: { id, name, status, discipline },
       requiredSubmittals: SubmittalRegisterItem[],
       readiness: {
         approvedCount, pendingCount, blockedCount,
         readinessPercent,        // approved / total
         blockers: SubmittalRegisterItem[]  // status in pending_review, revise_resubmit, rejected
       }
     }
     ```
   - `listFowWithReadiness(projectId)` → array of the above for every FOW in project, sorted by readiness ascending (most blocked first)
   - Pure — accepts a Supabase client, no side effects

4. **API route: `GET /api/projects/[id]/features-of-work`**
   - Returns `listFowWithReadiness` output
   - Project membership auth

5. **UI: new "Features of Work" tab in `SubmittalsCommandCenter`**
   - Modeled after `LongLeadTab.tsx`
   - Each row: FOW name | discipline | readiness % bar | blocker count | drill-in
   - Drill-in panel: full list of required submittals with their lifecycle states
   - Sorted by readiness ascending (worst first) — surface what's blocked

6. **Harness: `scripts/fow-graph-harness.mjs`**
   - Test FOW backfill produces expected unique entities from a fixture submittal set
   - Test `getFowReadiness` returns correct counts/percentages
   - Test relation table queries return expected neighborhoods
   - Test idempotency: running backfill twice produces the same state

### What this unlocks

- Superintendent-grade view: "what FOW is blocked right now"
- A reusable pattern (`entity_relations`) that every later sub-phase plugs into
- The first piece of structured operational state a specialist can query instead of reading documents

### What 8A deliberately doesn't do

- No schedule integration (8B)
- No write-back of FOW status from external sources
- No automatic relation inference from specs — backfill only uses the existing string field
- No editing FOW from the UI — 8A is read-only

---

## D. Sub-phase roadmap (Phase 8B–8D)

### 8B — Schedule activities as entities
- Promote `scheduleActivity` string to `project_schedule_activities` entity
- New relation: `fow_scheduled_as_activity`
- API: schedule activity → list of FOW → list of submittals → readiness rollup
- UI: schedule-readiness view: which activities have all submittals approved vs. pending

### 8C — Inspections as entities
- New table: `project_inspections` (type, FOW, scheduled date, status)
- New relation: `inspection_required_for_fow`
- API: inspection readiness — submittals approved + procurement on site + crew assigned
- UI: inspection readiness queue

### 8D — Procurement as entities
- New table: `project_procurement_items` (PO, material, lead time, expected date)
- New relations: `procurement_for_submittal`, `procurement_for_fow`
- API: lead-time risk — which submittals approved but procurement not started; which FOW at risk from late material
- UI: procurement risk dashboard

### Later
- RFIs as entities (link to spec sections)
- Equipment + crews (link to FOW + schedule)
- Specs as entities (already have foreign keys; promote to graph nodes)

---

## E. Specialist integration (the architecture payoff)

Once the graph exists, the chat handler and specialists can query it directly instead of loading documents:

- Query "is the slab pour ready" → `task-router` classifies as `fow_readiness_query` → calls `getFowReadiness('slab on grade')` → Haiku formats the answer from structured data
- No spec PDFs loaded into context
- No reasoning about blocking — the graph already knows
- Same primitive serves the chat layer, the UI, the QA layer, and future automation

This is the architecture pattern from the routed-specialists diagram: **keep knowledge outside the model, route tasks to specialists, only escalate to the large model when reasoning is genuinely cross-discipline.**

---

## F. Open decisions

1. **Phase 7 sequencing.** Phase 7 (project-scoped chat memory) is currently "IN PROGRESS — design done, no code." Phase 8 is independent of it. Options:
   - (a) Phase 8 first — operational graph is more aligned with the recent submittal/reconciliation work and provides a structured retrieval layer for Phase 7 to query later
   - (b) Phase 7 first — chat layer's memory/correction loop is the original Phase 7 scope
   - (c) Phase 8A in parallel with Phase 7A (which is just bug fixes + type additions)
   - **Recommended:** (a) or (c). Phase 7 design depends on entity primitives that don't exist yet; building Phase 8A first makes Phase 7 cleaner.

2. **FOW normalization rules during backfill.** Should "Slab on grade — Bldg 2" and "SOG B2" be merged? For 8A: no — exact match after whitespace/case normalization only. Manual merge can be a future feature.

3. **Soft delete vs. hard delete on relations.** When a submittal is removed by amendment, the relation goes away. Track historically (soft delete with `archived_at`) or just remove? **Recommended:** hard delete on relations, but keep `entity_relations.provenance` so re-imports can detect "this was previously linked."

4. **Confidence on inferred relations.** Backfill from string field is high confidence (1.0). Future relation types inferred from spec text (e.g. "submittal X is for FOW Y") should carry confidence < 1.0 and require user confirmation for low-confidence relations. Mirror the QA finding pattern.

---

## G. Testing strategy

- **Unit:** `getFowReadiness` and `listFowWithReadiness` against fixtures (no DB)
- **Integration:** backfill script against a seeded `submittal_register_items` table; verify entity + relation counts
- **Harness:** `scripts/fow-graph-harness.mjs` follows the existing `reconciliation:harness` pattern — pure module testing without DB
- **Regression:** Confirm no impact on existing submittal register, reconciliation, QA harnesses

---

## H. File map for Phase 8A

| File | Status | Purpose |
|---|---|---|
| `supabase/migrations/00053_fow_entities_and_relations.sql` | TO CREATE | Schema + RLS |
| `scripts/backfill-fow-entities.mjs` | TO CREATE | One-time + idempotent backfill |
| `src/lib/graph/fow-readiness.ts` | TO CREATE | Pure query module |
| `src/app/api/projects/[id]/features-of-work/route.ts` | TO CREATE | API endpoint |
| `src/components/submittal/tabs/FowReadinessTab.tsx` | TO CREATE | UI tab |
| `src/components/submittal/SubmittalsCommandCenter.tsx` | TO MODIFY | Add 7th tab |
| `scripts/fow-graph-harness.mjs` | TO CREATE | Test harness |
| `package.json` | TO MODIFY | Add `graph:harness` script |

---

## I. Success criteria

- Backfill produces a clean set of FOW entities from existing submittal register data
- `getFowReadiness` returns correct blocker counts on a real project
- The FOW Readiness tab visibly surfaces which FOW are blocked by pending submittals — a question the system could not answer before
- Zero regression on existing harnesses (reconciliation, QA, ingestion)
- The pattern is reusable: Phase 8B can plug schedule activities into the same `entity_relations` table without schema changes
