# Roadmap — thepe

High-level phase sequence and status. Updated by CTO Builder only.
Last updated: 2026-03-14

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
| **Phase 7** | **Project-scoped memory architecture** | **IN PROGRESS** | Design done 2026-03-13 |
| Phase 8 | TBD — vision processing wiring (spec/rfi/submittal extractors) | PLANNED | — |

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

## Pending Decisions

- **Phase 8 scope:** Wire spec-extractor.ts, rfi-extractor.ts, submittal-extractor.ts into auto-process pipeline (same integration as demo-extractor.ts) — OR — implement Phase 6D (Spec → Drawing governs linkage) first. Needs CTO Builder session to decide.

---

## Completed Phase Archives

Full checklists for completed phases:
- `plans/archive/phase-3-complete.md`
- `plans/archive/phase-4-complete.md`
- `plans/archive/phase-5-complete.md`
- `plans/archive/phase-6-complete.md`
