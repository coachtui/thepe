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
- [x] **No migration needed** — reuse existing `project_entities` table (entity_type='feature_of_work', discipline='general'). Link via `submittal_register_items.item_payload.fowEntityId`. The existing `project_entities` table from Phase 1/2 already provides the entity primitive.
- [x] **Added `fowEntityId?: string | null` to `SubmittalRegisterItem` type** in `src/lib/chat/submittal-register.ts`

### Pure logic
- [x] **Created `src/lib/graph/fow-readiness.ts`** — pure: `computeFowReadiness`, `rankFowByReadiness`, `groupSubmittalsByFowEntity`, `normalizeFowName`, `extractUniqueFowsFromSubmittals`
- [x] **Created `scripts/fow-graph-harness.mjs`** — 34/34 passing
- [x] **Wired `graph:harness` npm script**

### Backfill
- [ ] **Create `scripts/backfill-fow-entities.mjs`**
  - For each project: gather unique non-null `item_payload.relatedFOW` strings from `submittal_register_items`
  - Normalize whitespace + case, dedupe
  - Insert `project_entities` rows (entity_type='feature_of_work', discipline='general', canonical_name=normalized, display_name=original)
  - Update each submittal's `item_payload.fowEntityId` to point at the new FOW row
  - Idempotent — skip if `fowEntityId` already set, skip if matching FOW entity already exists

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
