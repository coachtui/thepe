# Handoff

## Completed This Session
- `low_extraction_confidence` QA finding — fires when `extractionConfidence < 0.80`. Source-aware messaging distinguishes DD-form vs hybrid_fill vs narrative. Severity: warning (<0.50), info (0.50–0.79). Skips items without `extractionConfidence` (legacy items safe).
- Low Confidence filter in register UI (`SubmittalRegisterReview.tsx`) — boolean toggle in advanced panel. Filters to items where extractionConfidence (or sourceQuality fallback) < 0.80.
- Updated RunSummary "Low Confidence" metric to use `extractionConfidence < 0.80` when available.
- 3 new XLSX export columns: Extraction Source, Extraction Confidence, Extraction Source Reason.
- QA-LC-1 through QA-LC-4 tests. 283/283 qa:harness. Typecheck clean. Build clean.

## UFGS Low-Confidence Summary
- DD-form 279 items: confidence 0.92 → 0 findings (correct)
- Hybrid fill 1314 items: confidence 0.33–0.62 → all below 0.80 → finding fires for all

## What To Do Next

### Commit + push
A lot of ingestion pipeline work has been done across multiple sessions. Suggested commit message:
"feat: UFGS ingestion pipeline — line reconstruction, normalization, DD-form parser, source selection, provenance labeling, QA confidence finding"

Files changed across sessions (since last push):
- src/lib/parsers/pdf-line-reconstruction.ts (new)
- src/lib/parsers/ufgs-submittal-register-parser.ts (new)
- src/lib/ingestion/nearby-sd-association.ts (extended)
- src/lib/ingestion/submittal-source-selector.ts (new)
- src/lib/ingestion/document-normalization.ts (existing, already committed)
- src/lib/eval/ingestion-runner.ts (extended)
- src/lib/eval/ingestion-types.ts (extended)
- src/lib/chat/submittal-coverage-qa.ts (extended)
- src/lib/chat/submittal-register.ts (extended)
- src/lib/export/submittal-export.ts (extended)
- src/components/submittal/SubmittalRegisterReview.tsx (extended)
- scripts/ingestion-harness.mjs (extended)
- scripts/qa-submittal-harness.mjs (extended)

### Production integration
The source selector output (selectedItems) is computed during ingestion evaluation but not yet fed into the production register. To integrate:
1. Call `chooseSubmittalExtractionSource` in the Inngest spec extraction workflow
2. Replace `items` from body extraction with `selResult.selectedItems` when DD-form present
3. Gate behind a feature flag or spec-type detector

### Test on commercial CSI specs
Only tested on UFGS. Commercial specs don't have the DD-form appendix, so the source selector would return narrative mode. Validating on those specs would confirm the pipeline doesn't break for non-UFGS documents.

## Open Questions / Blockers
- None blocking.
- The `low_extraction_confidence` finding only fires when `extractionConfidence` is set. For the UI to show it on existing registers, source selection integration would need to run first.
