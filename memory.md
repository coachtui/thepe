# Project Memory

Validated learnings, confirmed nuances, and recurring constraints.
Updated when something is likely to matter again across sessions.

---

## Architecture Decisions

### Inngest is the only correct document processing path
- Manual Analyze button (`/api/projects/{id}/analyze-complete`) does NOT call `indexDocumentPage()`
- Only the Inngest path (`vision-process-document.ts`) populates `document_pages` and `sheet_entities`
- Plan reader, sheet narrowing, and (future) recheck workflow all depend on `document_pages` being populated
- Fix is in `src/lib/processing/vision-processor.ts` — must call `indexDocumentPage()` per page

### Structured data always beats vector search
- Retrieval order: vision_db → graph lookups (2.5 through 2.97) → smart router → live PDF
- Vector search is last resort, confidence-capped
- Never move vector search earlier in the pipeline

### Hard refuse is code-level, not prompt-level
- `evidence-evaluator.ts` enforces `coverageStatus: insufficient` as a hard block
- Changing or softening this requires code change, not a prompt change

### Re-processing documents requires deleting project_quantities first
- Dedup logic in quantity extractor skips re-insertion if rows already exist
- Must `DELETE FROM project_quantities WHERE project_id = ?` before re-running extraction

### Manual Analyze button bug (known, unfixed as of 2026-03-13)
- Root cause: `processDocumentWithVision()` in vision-processor.ts missing `indexDocumentPage()` call
- Impact: empty `document_pages` → plan reader cannot narrow sheets → weaker answers
- Priority: Fix this before any recheck workflow work

---

## Retrieval Pipeline Nuances

### Callout variability is a structural problem
- Vision extractor captures abbreviated labels literally (HORIZ DEFL, MJ BEND, DEFL COUPLING)
- COMPONENT_PATTERNS in vision-queries.ts uses normalized patterns → misses project-specific abbrevs
- Future fix: project_memory_items aliases injected into plan reader prompt and pattern matching

### Station normalization is inconsistent
- `utility_termination_points` and `utility_crossings` both have `station` (TEXT) + `station_numeric` (computed)
- Inconsistent normalization can cause nearby-station queries to miss
- Station parser is in `station-parser.ts` — tests exist but are not comprehensive

### Multi-system queries get suppressed
- `autoDetectSystem()` in smart-router.ts: when multiple systems detected, system detection is suppressed
- Query searches all systems → over-broad results
- Workaround: user must specify exact system name ("Water Line A" not "water lines")

---

## Phase History

| Phase | Status | Key deliverable |
|---|---|---|
| Phase 1–2 | DONE | Vision extraction, entity graph tables, utility pipeline |
| Phase 3 | DONE | Demo plan ingestion and reasoning |
| Phase 4 | DONE | Architectural floor plans + schedule linkage |
| Phase 5 | DONE | Structural + MEP + coordination reasoning |
| Phase 6 | DONE | Spec + RFI + submittal ingestion |
| Phase 7 | DESIGN DONE | Project-scoped memory architecture (see current-phase.md) |

Full phase history and implementation checklists: `plans/current-phase.md`

---

## Key Constraints

- Temperature 0.2 for all factual answer modes — do not raise
- Never use anon Supabase client for writes — always service role
- Never add "typically", "industry standard", etc. to factual responses
- `supabase as any` cast used throughout graph queries — regenerate types after next deploy
- Vercel Pro required for `maxDuration=300` on `/api/inngest/route.ts`
- 5 pages per Inngest chunk (PAGES_PER_CHUNK=5) — do not increase without testing timeout behavior

---

## Spec Extraction Batching

- `BATCH_SIZE = 5` sections per Inngest step (16 batches for ~80-section spec)
- `discoverSpecSections` runs all non-LLM phases (concat + CSI regex + dedup + cap) — fast, single step, no LLM
- `extractSectionBatch` runs LLM for a batch; result returned from step is used for immediate persistence
- Per-batch scoped delete: `canonical_name LIKE 'SPEC_{norm}%'` — covers section + all its requirements
- `skipDelete: true` in `persistSpecExtractionResult` when caller handles delete externally
- The 25-minute local failure was a stale-connection-in-single-step issue; production is safe because each Vercel invocation gets a fresh connection

## Recurring Failure Patterns

### "No valves/fittings found" after corrections
- Root cause: `project_quantities` not updated; next query re-reads stale data
- Fix: Phase 7C correction capture — write corrections to DB, merge at retrieval time

### Regression to "no data" after improvement
- Root cause: stateless pipeline; plan reader findings not persisted
- Fix: Phase 7B project memory + Phase 7D recheck with write-back

### Sheet narrowing fails silently
- Root cause: `document_pages` empty (Manual Analyze button bug)
- Fix: Phase 7A — fix vision-processor.ts

## PDF Line Reconstruction (added 2026-05-09)

### Line reconstruction lives in harness-only path
- `src/lib/parsers/pdf-line-reconstruction.ts` — `groupPdfTextItemsIntoLines()` + `parseDocumentWithLineReconstruction()`
- `ingestion-runner.ts` uses new parser; production `pdfjs-parser.ts` is untouched
- Reason: safe separation allows harness iteration without risking production regressions

### 26.6% SD coverage was inflated — blob concatenation was accidental inline extraction
- Old blob-per-page behavior: `items.join(' ')` mixed SD code text ("SD-03 Product Data") into same line as item descriptions → `extractSdCode()` found them inline
- After correct line reconstruction: SD codes are on their own short lines; nearby-SD must carry the load
- True honest coverage after reconstruction: 15.7% on UFGS spec
- `MAX_DISTANCE=2` in `nearby-sd-association.ts` too narrow; 477 SD-only lines detected, only 212 associated

### UFGS SD code placement pattern
- UFGS table format puts SD codes in a separate column, often 3–10 lines from the description row
- Increasing `MAX_DISTANCE` to 4–5 is the next SD coverage improvement lever
- Do not overfit to UFGS PDFs — test commercial CSI specs first to understand baseline

### Skip-if-multiple-candidates in nearby-SD association (added 2026-05-10)
- When the search window contains >1 candidate items, association is skipped (skippedMultiCandidate metric)
- This is INTENTIONAL conservatism — prevents false assignment when SD code category header sits above a block of items
- For UFGS PDFs: 138 multi-cand skips observed — the UFGS "SUBMITTALS" structure frequently puts 1 SD-only header above 3–5 items that all share that code
- Fix for UFGS: multi-item block association (apply SD code to ALL items in block when SD-only precedes a contiguous item block)

### Configurable nearby-SD distance
- `associateNearbySdCodes(lines, options?)` accepts `{ maxDistance?, mode? }`
- mode 'reconstructed_pdf' or 'ufgs' → default distance 5; mode 'default' → distance 2
- ingestion-runner.ts passes `{ mode: 'reconstructed_pdf' }` when `lineReconstruction` is defined
- extractSubmittalRegisterItemsFromText accepts optional third param `nearbyOptions?: NearbysdOptions`

### Pass 5 block association (added 2026-05-10)
- Only runs for mode 'reconstructed_pdf' or 'ufgs'
- Each SD-only line scans forward until hitting a boundary, another SD header, or end-of-lines
- Assigns SD code to ALL items in the block (vs single-candidate forward/backward passes)
- Inline SD codes not overwritten; prior associations not overwritten
- UFGS result: 44 headers triggered → 131 items assigned → SD coverage 15.2%→18.9%
- 183 boundary-end: many UFGS SD-only lines sit immediately before section boundaries

### SD_ONLY_MAX_LENGTH = 60 edge case
- Lines ≤ 60 chars that contain an SD code are classified as SD-only headers by extractSdOnlyCode
- Submittal items with inline SD codes that are shorter than 60 chars will be misclassified as SD-only
- Test fixtures for "inline SD code present" must use lines > 60 chars to avoid this
- This is a known limitation — SD_ONLY_MAX_LENGTH was set to catch real SD-only headers, not statements

### UFGS SD coverage ceiling
- With text-line extraction (no DD-form parser): ~18-19% max on ammunition-storage-wl-specs.pdf
- 183 boundary-end blocks confirm UFGS structure places SD headers near section boundaries
- Further gains require DD-form submittal appendix parser (75-page table in the spec)

## UFGS DD-form Appendix Parser (added 2026-05-10)

### Structure discovered
- "SUBMITTAL FORM, Jan 96" marker = page boundary anchor (appears at END of each page's data block)
- Each page block: classification blob (G G G G...) → paragraph blob → item names blob → SD codes blob → spec sections blob → page title/anchor
- The landscape table columns are read as blob lines by PDF.js: each column = one concatenated line
- S P E C S E C T (c) = column (c) header; line below = spec sections blob
- SD codes appear in line before spec section header

### Parser location
- `src/lib/parsers/ufgs-submittal-register-parser.ts`
- `hasUfgsDDFormAppendix(text)` for detection
- `parseUfgsDDFormAppendix(text)` for full extraction

### First-pass results on UFGS ammunition storage spec
- 75 pages detected, 279 rows extracted, 279 unique (specSection, sdCode) pairs, 68 unique spec sections
- 100% SD coverage by construction (only rows with SD codes are created)
- 1 warning: page 40 had no SD codes
- Recommended over narrative (18.9% SD coverage)

### Known false positives
- CSI section boundary concatenation creates `14 00 01`, `05 52 00 06 41 16` etc.
- Impact: minor — a few rows with wrong spec section, but SD codes are correct
- Fix: CSI division allowlist or boundary-aware regex

### Evaluation mode: no production integration yet
- Parser runs in ingestion-runner.ts and populates `result.ddForm` for harness reporting
- Does not replace or supplement production extraction
- No database writes

## Source Selection Utility (added 2026-05-10)

### Location
`src/lib/ingestion/submittal-source-selector.ts`

### Decision tree
1. No DD-form rows → narrative
2. DD-form SD% < 80% threshold → narrative
3. Narrative SD% >= DD-form SD% → narrative
4. DD-form covers < 70% of narrative spec sections → hybrid
5. Otherwise → dd_form

### UFGS result: hybrid
- DD-form covers 47/77 narrative spec sections (61%) → below 70% threshold → hybrid
- Hybrid: 1593 items, 36.3% SD, 22.9% Auth (vs narrative: 3537 items, 18.9% SD, 6.4% Auth)
- The 30 uncovered narrative spec sections contribute low-quality fill items

### Thresholds (may need tuning with more spec data)
- `DD_FORM_SD_THRESHOLD = 80` — minimum DD-form SD% to prefer over narrative
- `HYBRID_COVERAGE_THRESHOLD = 0.70` — if DD-form covers < 70% of narrative sections → hybrid

### mapDDFormRowToSubmittalItem
- confidence: 0.92 (authoritative source)
- approvalRequired: true when approvalAuthority === 'G'
- sourceReference.extractionSource: 'ufgs_dd_form'
- blockingRisk: 'none'
- submittalType from SD_TYPE_MAP (SD-01 through SD-11)

## Extraction Provenance Labels (added 2026-05-10)

### Fields added to SubmittalRegisterItem
- `extractionSource?: 'narrative' | 'ufgs_dd_form' | 'hybrid_fill'` — which pipeline produced this row
- `extractionConfidence?: number` — confidence from extraction (may differ from display confidence)
- `extractionSourceReason?: string` — human-readable provenance explanation

### Confidence adjustment in hybrid fill
- Base: `item.confidence` (typically 0.72 from narrative extraction)
- Missing sdCode: −0.10
- Missing approvalAuthority: −0.05
- Floor: 0.30
- UFGS fill avg: ~0.33 (most items miss both fields)

### computeSourceBreakdown
- Groups items by `extractionSource`, computes count/sdCoverage/avgConfidence
- Exported from `src/lib/ingestion/submittal-source-selector.ts`
