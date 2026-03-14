# Phase 6: Spec + RFI + Submittal Ingestion — COMPLETE ✓

Delivered 2026-03-11. TypeScript compilation passed with zero errors (`npx tsc --noEmit --skipLibCheck`).

## Delivered Files

| Deliverable | File | Status |
|---|---|---|
| Spec + RFI + submittal schema extension | `supabase/migrations/00043_spec_rfi_submittal_schema.sql` | ✓ NEW |
| AnswerMode + ReasoningMode + entity type extensions | `src/lib/chat/types.ts` | ✓ MODIFIED |
| Spec + RFI + submittal classification | `src/lib/chat/query-classifier.ts` | ✓ MODIFIED |
| Spec + RFI + submittal mode mapping | `src/lib/chat/query-analyzer.ts` | ✓ MODIFIED |
| Spec graph read queries | `src/lib/chat/spec-queries.ts` | ✓ NEW |
| RFI graph read queries | `src/lib/chat/rfi-queries.ts` | ✓ NEW |
| Submittal + governing doc queries | `src/lib/chat/submittal-queries.ts` | ✓ NEW |
| Spec + RFI + submittal retrieval path | `src/lib/chat/retrieval-orchestrator.ts` | ✓ MODIFIED |
| Phase 6 reasoning modes | `src/lib/chat/reasoning-engine.ts` | ✓ MODIFIED |
| Spec vision extraction infrastructure | `src/lib/vision/spec-extractor.ts` | ✓ NEW |
| RFI vision extraction infrastructure | `src/lib/vision/rfi-extractor.ts` | ✓ NEW |
| Submittal vision extraction infrastructure | `src/lib/vision/submittal-extractor.ts` | ✓ NEW |
| Phase 6 validation harness | `src/lib/chat/spec-validator.ts` | ✓ NEW |

## Key Design Decisions

### Three new disciplines: 'spec', 'rfi', 'submittal'
Added to the `discipline` CHECK constraint in migration 00043. Status values reused semantically: `existing` = answered RFI, `to_remain` = approved submittal, `new` = open RFI/pending submittal, `to_remove` = voided/rejected.

### Requirement families are finding_type, not entity subtype
7 requirement families stored as `finding_type` values on `entity_findings`. Enables cross-section queries without complex JOINs.

### Section number normalization
`normalizeSectionNumber()` handles "033000", "03 30 00", "03300" → "03 30 00". `canonical_name` uses underscore form: "SPEC_03_30_00".

### Conservative governing document hierarchy
`resolveGoverningDocument()` does NOT automatically assert precedence. Returns all authorities ranked by tier and surfaces open RFIs as `conflicting_documents` gaps.

### Support levels from document status, not model
Answered RFIs → explicit; open RFIs → inferred. Model never assigns support levels.

### Retrieval step ordering
2.95 (spec graph) → 2.97 (RFI/submittal/governing graph) inserted before smart router.
