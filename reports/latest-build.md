# Latest Build Report

**Date:** 2026-05-10

## TypeScript Compile
`npx tsc --noEmit --skipLibCheck` → CLEAN

## QA Harness
`npm run qa:harness` → 283/283 passed (includes QA-LC-1 through QA-LC-4)

## Production Build
`npm run build` → CLEAN

## Ingestion Harness Summary

Adversarial TXT fixtures: REVIEW (75.6% SD, 33.3% Auth) — unchanged.

UFGS spec hybrid result:
  DD-form 279 items (conf 0.92, 100% SD, 100% Auth)
  Fill    1314 items (conf 0.33, 23% SD, 44% Auth)
  Total:  1593 hybrid items, 36.3% SD, 22.9% Auth

low_extraction_confidence QA finding: fires on all 1314 fill items (all below 0.80).
Severity: info for 0.50–0.79 range, warning for <0.50 range.

## New Capabilities (this session)
- low_extraction_confidence QA finding type (source-aware)
- Low Confidence filter toggle in register UI
- Extraction Source / Confidence / Source Reason in XLSX export

## Known Issues
- UFGS narrative grade POOR (18.9%) — source selection not yet replacing grade
- Production integration pending
- low_extraction_confidence finding only fires on items with extractionConfidence set
