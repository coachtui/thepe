# Current Phase: Phase 8A — FOW Entity Promotion + Readiness View

**Status:** READY TO BUILD
**Sprint started:** 2026-05-10
**Full design:** `plans/phase8-graph-layer.md`
**Phase 7 status:** DESIGN COMPLETE — deferred until Phase 8A ships. See `plans/phase8-graph-layer.md` Section F for sequencing rationale.

---

## Goal

Promote `featureOfWork` from a loose string field on `submittal_register_items` into a first-class entity (`project_features_of_work`) with typed relations to submittals (`entity_relations`). Surface a "Features of Work" view that shows which FOW are blocked by pending submittals.

This is the first piece of the operational knowledge graph that specialists will query instead of loading documents.

---

## Architectural Anchor

The routed-specialists architecture (see `memory/project_routed_specialists_architecture.md`) requires structured operational state to live **outside** the model. Phase 8A creates that structure for FOW. Every later subsystem (schedule, inspections, procurement) plugs into the same `entity_relations` table.

---

## Task Checklist

### Schema + persistence
- [ ] **Migration `00053_fow_entities_and_relations.sql`**
  - Create `project_features_of_work` (id, project_id, name, discipline, status, description, metadata JSONB, timestamps)
  - Create `entity_relations` (id, project_id, source_type, source_id, target_type, target_id, relation_type, confidence, provenance JSONB)
  - UNIQUE constraint on `(project_id, source_type, source_id, target_type, target_id, relation_type)`
  - Indexes on `(project_id, source_type, source_id)` and `(project_id, target_type, target_id)`
  - RLS enabled — project members read, service role writes
- [ ] **Apply migration to Supabase + regenerate `src/lib/db/supabase/types.ts`**

### Pure logic
- [ ] **Create `src/lib/graph/fow-readiness.ts`**
  - `getFowReadiness(supabase, projectId, fowId)` — return FOW + required submittals + blocker counts + readiness %
  - `listFowWithReadiness(supabase, projectId)` — array of above for every FOW, sorted worst-first
  - Pure — accepts a Supabase client; no side effects
- [ ] **Create `scripts/fow-graph-harness.mjs`** — pure module tests with fixtures
  - Test backfill produces expected unique FOW entities from a fixture submittal set
  - Test `getFowReadiness` returns correct counts/percentages
  - Test relation queries return expected neighborhoods
  - Wire `graph:harness` npm script

### Backfill
- [ ] **Create `scripts/backfill-fow-entities.mjs`**
  - For each project: gather unique non-null `featureOfWork` strings from `submittal_register_items.item_payload`
  - Normalize whitespace + case, dedupe
  - Insert `project_features_of_work` rows (one per unique normalized name)
  - Insert `entity_relations` rows linking each submittal to its FOW (`relation_type='submittal_required_for_fow'`, `provenance.source='backfill_from_string_field'`)
  - Idempotent — re-runnable without duplicating

### API
- [ ] **Create `GET /api/projects/[id]/features-of-work/route.ts`**
  - Auth: any project member
  - Returns `listFowWithReadiness` output
  - Service-role read

### UI
- [ ] **Create `src/components/submittal/tabs/FowReadinessTab.tsx`**
  - Modeled after `LongLeadTab.tsx` for visual consistency
  - Row per FOW: name | discipline | readiness % bar | blocker count | drill-in
  - Drill-in panel: full list of required submittals with lifecycle states
  - Sorted by readiness ascending (worst first)
- [ ] **Update `src/components/submittal/SubmittalsCommandCenter.tsx`**
  - Add 7th tab: "Features of Work"
  - Pass `projectId` to new tab

---

## Escalation Boundaries (per CLAUDE.md)

- Adding tables (`project_features_of_work`, `entity_relations`) — **PRE-APPROVED via Phase 8 plan**
- No changes to existing tables
- No changes to pipeline topology, Inngest, or auth

If anything during build requires a deviation from the schema in `plans/phase8-graph-layer.md`, stop and surface to user.

---

## Success Criteria

- Backfill produces a clean set of FOW entities from existing submittal data
- `getFowReadiness` returns correct blocker counts on real project data
- The FOW Readiness tab visibly surfaces which FOW are blocked by pending submittals
- All harnesses green (graph + reconciliation + qa + ingestion)
- `tsc --noEmit` clean, production build clean

---

## What 8A Deliberately Doesn't Do

- No schedule integration (that's 8B)
- No inspection linkage (that's 8C)
- No procurement (that's 8D)
- No FOW editing from UI — read-only in 8A
- No automatic FOW inference from spec text — backfill only uses existing string field
