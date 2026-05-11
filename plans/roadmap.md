# Roadmap — thepe

High-level phase sequence and status. Updated by CTO Builder only.
Last updated: 2026-05-10 (Phase 8 graph layer designed; sequencing decision pending)

---

## Phase Status

| Phase | Name | Status | Delivered |
|---|---|---|---|
| Phase 1 | Vision extraction + entity graph tables | COMPLETE | 2026-03-10 |
| Phase 2 | Universal entity model + utility pipeline backfill | COMPLETE | 2026-03-10 |
| Phase 3 | Demo-plan ingestion and reasoning | COMPLETE | 2026-03-10 |
| Phase 4 | Architectural floor plans + schedule linkage | COMPLETE | 2026-03-11 |
| Phase 5 | Structural + MEP + coordination reasoning | COMPLETE | 2026-03-11 |
| Phase 6 | Spec + RFI + submittal ingestion | COMPLETE | 2026-03-11 |
| Phase 7 | Project-scoped memory architecture | DESIGN COMPLETE | Design done 2026-03-13, no code |
| **Phase 8** | **Operational graph layer — project entities + typed relations** | **DESIGN COMPLETE** | Design done 2026-05-10 |
| Phase 9 | TBD — likely specialist routing payoffs (chat queries graph) | PLANNED | — |

---

## Phase 7 Sub-Phases

| Sub-phase | Name | Status |
|---|---|---|
| 7A | Fix Manual Analyze button bug + query tracing fields | NOT STARTED |
| 7B | Migration 00047 + project-memory.ts | NOT STARTED |
| 7C | Correction capture API | NOT STARTED |
| 7D | Recheck workflow | NOT STARTED |
| 7E | Confidence-aware responses | NOT STARTED |
| 7F | Project Memory dashboard UI | NOT STARTED |

---

## Phase 8 Sub-Phases

| Sub-phase | Name | Status |
|---|---|---|
| 8A | FOW entity promotion + readiness view | NOT STARTED |
| 8B | Schedule activities as entities | DESIGNED, not detailed |
| 8C | Inspections as entities | DESIGNED, not detailed |
| 8D | Procurement as entities | DESIGNED, not detailed |

Full design: `plans/phase8-graph-layer.md`

---

## Pending Decisions

- **Phase 7 vs Phase 8 sequencing.** Phase 7 (chat memory + corrections + recheck) and Phase 8 (operational graph) are independent. Phase 8 builds the structured retrieval layer that Phase 7 later queries. Recommended order: **Phase 8A first**, then Phase 7A bug fixes in parallel, then full Phase 7. Needs user decision.
- **Original Phase 8 (vision wiring) is now folded forward.** The prior "wire spec-extractor.ts into auto-process" task is still real but not a phase — it's a single PR-sized task that can ship anytime independent of phases 7/8.

---

## Completed Phase Archives

Full checklists for completed phases:
- `plans/archive/phase-3-complete.md`
- `plans/archive/phase-4-complete.md`
- `plans/archive/phase-5-complete.md`
- `plans/archive/phase-6-complete.md`
