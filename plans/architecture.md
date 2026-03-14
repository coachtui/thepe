# Architecture — thepe

Canonical record of architectural decisions. Updated by CTO Builder only.
Last updated: 2026-03-14

---

## Chat Pipeline

```
query-analyzer → smart-router → retrieval-orchestrator
  → sheet-verifier (Type B/C/D queries)
  → plan-reader (targeted page inspection)
  → evidence-evaluator → reasoning-engine → response-writer
```

All pipeline files live in `src/lib/chat/`.

| File | Role |
|---|---|
| `chat-handler.ts` | Orchestrates all steps |
| `query-analyzer.ts` | Classifies query + extracts entities |
| `sheet-verifier.ts` | Mandatory pre-answer verification (Types B/C/D) |
| `evidence-evaluator.ts` | Scores sufficiency; hard-gates on `insufficient` |
| `response-writer.ts` | Discipline-aware persona; temp 0.2 for all factual modes |
| `sheet-narrower.ts` | 11-signal ranked candidate sheet selection |
| `plan-reader.ts` | Multimodal page inspection at query time |

---

## Retrieval Step Ordering

Steps execute in this order (fractional steps = discipline graph lookups inserted between vision DB and smart router):

```
1     → query analysis
2     → vision DB lookup
2.5   → demo graph lookup
2.75  → arch graph lookup
2.8   → structural graph lookup
2.85  → MEP graph lookup
2.9   → coordination graph lookup
2.95  → spec graph lookup
2.97  → RFI/submittal/governing graph lookup
3     → smart router
4     → live PDF (plan-reader)
```

Structured data always precedes vector search. Vector search is last resort, confidence-capped.

---

## Verification System

Queries are classified before answering:

- **Type A** — skip verification (general chat, procedural)
- **Type B** — enumeration (count/list all X)
- **Type C** — measurement (size/length of specific X)
- **Type D** — global (project-wide scope)

`coverageStatus: insufficient` from the verifier is a **hard refuse** — code-level, not prompt-level. `evidence-evaluator.ts` enforces this regardless of what other retrieval sources found. Changing this requires a code change, not a prompt change.

---

## Vision Processing Paths

Two paths — **they are not equivalent**:

| Path | Trigger | Calls `indexDocumentPage`? |
|---|---|---|
| Inngest | Auto on upload, `vision/document.process` event | YES — populates `document_pages` + `sheet_entities` |
| Manual Analyze button | `/api/projects/{id}/analyze-complete` → `processDocumentWithVision()` | NO — Phase 2 indexes never populated |

**Known bug (unfixed as of 2026-03-14):** Manual Analyze button does not populate `document_pages` / `sheet_entities`.
Fix location: `src/lib/processing/vision-processor.ts` — must call `indexDocumentPage()` per page.
This is Phase 7A work.

Inngest function: `src/inngest/functions/vision-process-document.ts`
- 5 pages per chunk — do not increase without timeout testing
- `maxDuration = 300` on `/api/inngest/route.ts` (requires Vercel Pro)
- Concurrency limit: 5 documents

---

## Key Database Tables

| Table | Purpose |
|---|---|
| `documents` | PDFs — `vision_status`, `file_path`, `page_count` |
| `document_chunks` | Text chunks with `vision_data` JSONB |
| `document_pages` | One row per PDF page — sheet metadata, disciplines, station range |
| `sheet_entities` | One row per detected entity per page |
| `project_quantities` | Vision-extracted components (valves, pipe segments, etc.) |
| `utility_crossings` | Detected utility crossings |
| `utility_termination_points` | Line start/end points |
| `project_entities` | Universal entity graph (all disciplines) |
| `entity_locations` | Room/level/grid anchors per entity |
| `entity_findings` | Finding rows per entity (finding_type, value, support_level) |
| `entity_relationships` | Typed edges between entities |
| `entity_citations` | Sheet/page source citations per entity |
| `vision_job_logs` | Batch processing audit trail |

Phase 7 tables (migration 00047 — pending):
`project_memory_items`, `project_corrections`, `memory_confirmations`, `project_source_quality`, `recheck_sessions`

---

## Universal Entity Model

`project_entities` + `entity_locations` + `entity_findings` + `entity_relationships` + `entity_citations` absorb all discipline data. No separate tables per discipline. New disciplines are added via:
1. Extending `discipline` CHECK constraint (idempotent DO $ block)
2. New query file in `src/lib/chat/`
3. New vision extractor in `src/lib/vision/`
4. New retrieval step in `retrieval-orchestrator.ts`
5. New reasoning mode in `reasoning-engine.ts`

---

## Key Architectural Constraints

- **Temperature 0.2** for all factual answer modes — do not raise
- **Service role client** for all writes — never use anon client for inserts/updates
- **`supabase as any` cast** used throughout graph queries — regenerate types after next deploy
- **Station fields** are TEXT + computed `station_numeric` — normalization via `station-parser.ts`
- **Project memory is per-project only** — never load or apply memory items across different project IDs
- **Corrections overlay, not overwrite** — preserve original vision_db row; corrections are EvidenceItems with `source='user_correction'`
- **Disputed items always surfaced** — `confirmed_by_count < rejected_by_count` → never state as fact
