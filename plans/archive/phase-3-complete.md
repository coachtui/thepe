# Phase 3: Demo-Plan Ingestion and Reasoning — COMPLETE ✓

Delivered 2026-03-10. TypeScript compilation passed with zero errors (`npx tsc --noEmit --skipLibCheck`).

## Delivered Files

| Deliverable | File | Status |
|---|---|---|
| Demo entity schema extension | `supabase/migrations/00040_demo_entity_schema.sql` | ✓ NEW |
| AnswerMode + ReasoningMode extensions | `src/lib/chat/types.ts` | ✓ MODIFIED |
| Demo query classification | `src/lib/chat/query-classifier.ts` | ✓ MODIFIED |
| Demo answer mode mapping | `src/lib/chat/query-analyzer.ts` | ✓ MODIFIED |
| Demo graph read queries | `src/lib/chat/demo-queries.ts` | ✓ NEW |
| Demo graph retrieval path | `src/lib/chat/retrieval-orchestrator.ts` | ✓ MODIFIED |
| Demo reasoning modes | `src/lib/chat/reasoning-engine.ts` | ✓ MODIFIED |
| Vision extraction infrastructure | `src/lib/vision/demo-extractor.ts` | ✓ NEW |
| Demo validation harness | `src/lib/chat/demo-validator.ts` | ✓ NEW |

## Key Design Decisions

### Status is deterministic, not model-inferred
`DEMO_EXTRACTION_PROMPT` outputs `status_text` (verbatim text from drawing). `extractDemoStatusFromText()` maps to canonical status. Model never assigns status.

### Room filter is post-fetch TypeScript
`room_number` lives in `entity_locations` (nested table). Filtering applied in TypeScript post-fetch.

### Two-step constraint query
`queryDemoConstraints()` uses two queries to avoid complex PostgREST nested filter syntax.

### Retrieval step ordering
2.5 (demo graph) inserted before smart router (3).
