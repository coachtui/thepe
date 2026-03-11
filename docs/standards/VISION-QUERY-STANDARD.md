# Vision Query Standard

This document defines how visual analysis queries work within the **unified chat pipeline**. It covers the retrieval hierarchy, when live PDF analysis runs, and what prompt rules apply to which sheet types.

**This is the canonical reference. All future visual query features MUST follow this pattern.**

---

## Architecture Overview

Visual queries are not a separate code path. They flow through the same unified pipeline as all other queries. Vision-specific behavior is determined by `QueryAnalysis` fields set during query analysis.

```
POST /api/chat  or  /api/mobile/chat
    │  (auth only — both routes delegate to chat-handler)
    ▼
chat-handler.ts: handleChatRequest()
    │
    ▼
query-analyzer.ts: analyzeQuery()
    │  → answerMode: 'quantity_lookup' | 'crossing_lookup' | ...
    │  → retrievalHints.needsVisionDBLookup: true/false
    │  → retrievalHints.visionQuerySubtype: 'component' | 'crossing' | 'length'
    ▼
retrieval-orchestrator.ts: retrieveEvidence()
    │
    ├─ 1. Vision DB  (if needsVisionDBLookup)
    │     → queryComponentCount / queryCrossings / queryUtilityLength
    │     → Returns EvidenceItem[] from pre-extracted structured data
    │
    ├─ 2. Smart router  (if Vision DB empty or not applicable)
    │     → direct_quantity_lookup, complete_data, vector_search
    │
    └─ 3. Live PDF analysis  (LAST RESORT — only if items still empty)
          → shouldAttemptLivePDF() gates by answerMode
          → createDocumentAnalyzer().analyzeSheetSet()
          → Returns EvidenceItem[] tagged source: 'live_pdf_analysis'
          → Confidence capped at 0.6 if sheets were skipped or capped
    │
    ▼
evidence-evaluator.ts: evaluateSufficiency()
    │
    ▼
response-writer.ts: writeResponse()   ← always streaming, always has conversation history
```

---

## Primary Visual Path: Vision DB

**Vision DB is the preferred source for all counting, crossing, and length queries.**

Data is extracted from PDFs at indexing time and stored in Supabase tables. Queries against this data are fast, structured, and confidence-scored without re-reading PDFs at chat time.

### When Vision DB is used

`query-analyzer.ts` calls `determineVisionQueryType()` (from `vision-queries.ts`) and sets:

```typescript
retrievalHints: {
  needsVisionDBLookup: true,
  visionQuerySubtype: 'component' | 'crossing' | 'length'
}
```

`retrieval-orchestrator.ts` then calls the appropriate Vision DB function:

| `visionQuerySubtype` | DB function | Answers |
|---|---|---|
| `component` | `queryComponentCount()` | "How many 12-IN gate valves?" |
| `crossing` | `queryCrossings()` | "What utilities cross Water Line A?" |
| `length` | `queryUtilityLength()` | "How long is Water Line A?" |

If any of these return results, **steps 2 and 3 are skipped**.

### When Vision DB is not used

- `visionQuerySubtype` is `'none'` (e.g., sheet lookup, specification question, general chat)
- The data was never extracted during indexing (new project, failed processing)
- The Vision DB query returns empty (rare — falls through to smart router)

---

## Secondary Path: Smart Router

If Vision DB returns nothing, the smart router runs. It attempts in order:
1. Direct quantity lookup (structured DB quantities)
2. Complete chunk data (all chunks for a system — used for full takeoffs)
3. Vector search (semantic similarity over indexed text)

This path is not vision-specific. It handles queries whose answers were captured as text during document indexing.

---

## Last-Resort Path: Live PDF Analysis

Live PDF analysis downloads project PDFs from Supabase storage and passes them to `createDocumentAnalyzer().analyzeSheetSet()` at chat time. It runs **only when**:

1. Vision DB returned nothing, AND
2. Smart router returned nothing, AND
3. `shouldAttemptLivePDF(answerMode)` returns `true`

### Supported answer modes for live PDF

```typescript
function shouldAttemptLivePDF(answerMode: string): boolean {
  const supported = [
    'quantity_lookup',
    'crossing_lookup',
    'project_summary',
    'scope_summary',
    'sheet_lookup',
    'document_lookup',
  ]
  return supported.includes(answerMode)
}
```

Modes like `sequence_inference`, `general_chat`, and `requirement_lookup` do NOT trigger live PDF.

### Live PDF constraints

- Max 15 sheets per request (`MAX_SHEETS = 15`)
- Max 10 MB per sheet (`MAX_PDF_SIZE_MB = 10`)
- Confidence capped at **0.6** (vs 0.85 for complete runs) if any sheets were skipped or total > cap
- `LiveAnalysisMeta` is attached to the `EvidencePacket` so the response-writer can disclose limitations

### Sheet selection

The orchestrator pre-filters sheets before downloading, matching the query to relevant sheet types:

```typescript
const patterns = [
  { test: /electrical|elec|power/i,   filePattern: /elect|elec|power|e-\d+/i },
  { test: /gas\b|gas line/i,           filePattern: /gas|g-\d+/i },
  { test: /storm|stm\b/i,             filePattern: /storm|stm|sd-\d+/i },
  { test: /sewer|sanitary|ss\b/i,     filePattern: /sewer|sanitary|ss-\d+/i },
  { test: /telecom|fiber|fo\b|catv/i, filePattern: /telecom|tel|fiber|fo|comm|c-\d+/i },
]
```

If no pattern matches, all sheets are used up to `MAX_SHEETS`.

### DO NOT bypass the retrieval hierarchy

Live PDF analysis is not a shortcut for queries that seem "visual." If Vision DB has the data, use it. Only invoke live PDF analysis through the normal pipeline — never by directly calling `getProjectPdfAttachments()` or `anthropicDirect.messages.stream()` from a route file.

---

## Prompt Engineering for Live PDF Analysis

When live PDF analysis runs, prompts are built inside `createDocumentAnalyzer` (see `src/agents/constructionPEAgent/`). The following rules govern what to include.

### Scope prompt rules to sheet type

**Profile-view scanning rules apply only to utility plan sheets**, not to all construction plans.

#### Utility plan sheets (water, sewer, storm, gas lines)

These sheets typically have two distinct sections:

```
PLAN VIEW (top 50–60%)
- Aerial overhead view of horizontal alignment
- May contain callout boxes pointing to fittings or crossings

PROFILE VIEW (bottom 40–50%)
- Side view showing vertical alignment and grade
- Station scale at bottom (0+00, 5+00, 10+00, ...)
- Vertical text labels rotated 90° along the utility line
- PRIMARY SOURCE for component counts and crossing depths
```

**Scanning technique for utility profiles:**
1. Identify the profile view (bottom section with elevation grid and station scale)
2. Scan left-to-right along the utility line
3. Read every vertical text label — these are component calls (GATE VALVE, TEE, VERT DEFL, etc.) or utility crossings (ELEC, SS, STM, GAS)
4. Record the station from the scale below each label

#### Other sheet types (electrical, civil grading, structural, details)

These sheets do not have profile views. Scanning technique varies:
- **Electrical sheets:** Read panel schedules, conduit run tables, and plan-view annotations
- **Detail sheets:** Read keynotes, call-outs, and dimensions directly on the detail
- **Civil grading sheets:** Read contours, spot elevations, and drainage basin labels

Do not instruct Claude to "look at the profile view" on these sheet types. The instruction will produce hallucinations or missed data.

### Terminology: utility components vs. utility crossings

This distinction is critical for crossing queries and must be stated explicitly in every crossing-analysis prompt.

**Components of the subject utility line (do NOT count as crossings):**

| Label | Meaning |
|---|---|
| VERT DEFL | Vertical deflection fitting |
| TEE | Tee fitting for a branch connection |
| GATE VALVE | Isolation valve on the subject line |
| BEND | Elbow/bend fitting |
| CAP | End cap |
| AIR RELEASE VALVE | ARV on the subject line |

**Other utilities crossing the subject line (COUNT as crossings):**

| Label | Utility |
|---|---|
| ELEC | Electrical conduit |
| SS or SAN | Sanitary sewer |
| STM | Storm drain |
| GAS | Gas main |
| W or WTR | Water main (if subject line is not water) |
| TEL / FO / CATV | Telecommunications |

**Sanity check:** A single water line alignment typically has 0–6 utility crossings. If you find 10+, you are likely counting water line fittings.

### Size filtering

When a query specifies a size, filter strictly. State explicitly in the prompt:

```
READ CAREFULLY — THESE ARE DIFFERENT SIZES:
- "12-IN" = twelve inch  ← COUNT if user asks for 12-inch
- "8-IN"  = eight inch   ← EXCLUDE if user asks for 12-inch
- "1-1/2-IN" = one-and-a-half inch  ← EXCLUDE

Only count items whose label includes exactly the size the user asked for.
```

### Response format

Always request a structured response so the user can verify results:

```
For each sheet analyzed:

**Sheet [NAME]:**
- Profile view findings: [component or crossing label, station, count]
- Plan view callouts: [any additional items found]
- Subtotal: [N]

**TOTAL** across all sheets: [N]
**CONFIDENCE:** [high/medium/low]
**NOTES:** [any ambiguous labels, skipped areas, or caveats]
```

---

## Adding New Visual Query Types

### 1. Add detection to `vision-queries.ts`

`determineVisionQueryType()` returns `'component' | 'crossing' | 'length' | 'none'`. If your new query type maps to one of these, it is already handled.

If you need a new subtype, add it to `VisionQuerySubtype` in `types.ts` and add a detection branch in `determineVisionQueryType()`.

### 2. Add a Vision DB query function (preferred)

If the data can be stored during indexing, add a query function in `vision-queries.ts` and call it from `attemptVisionDBLookup()` in `retrieval-orchestrator.ts`. This avoids live PDF analysis for every query.

### 3. Update `shouldAttemptLivePDF()` if needed

If your new answer mode should fall back to live PDF analysis, add it to the supported list in `retrieval-orchestrator.ts:shouldAttemptLivePDF()`.

### 4. Scope prompts correctly

When adding new prompts to `createDocumentAnalyzer`:
- Apply profile-view scanning rules only to utility plan sheets
- State terminology explicitly — Claude does not inherently know construction abbreviations
- Include a sanity check for the expected range of results
- Request a per-sheet breakdown so results are verifiable

---

## Common Pitfalls

| Wrong | Right |
|---|---|
| Treat live PDF as the default visual path | Live PDF is last-resort only — Vision DB runs first |
| Apply profile-view rules to all sheet types | Profile-view rules apply only to utility plan sheets |
| Assume Claude knows VERT DEFL ≠ crossing | Explicitly list what IS and IS NOT a crossing |
| Count all valves regardless of size | State size filter explicitly in the prompt |
| Convert PDF → images before sending | Use Claude's native document support (`type: 'document'`) |
| Skip per-sheet breakdown in response | Always request per-sheet breakdown for verification |
| Call `anthropicDirect.messages.stream()` from a route file for vision | Route through the chat pipeline — retrieval-orchestrator handles live PDF |

---

## File Reference

| File | Role |
|---|---|
| [src/lib/chat/query-analyzer.ts](src/lib/chat/query-analyzer.ts) | Single entry point for query analysis; sets `needsVisionDBLookup` and `visionQuerySubtype` |
| [src/lib/chat/retrieval-orchestrator.ts](src/lib/chat/retrieval-orchestrator.ts) | Executes retrieval hierarchy: Vision DB → smart router → live PDF |
| [src/lib/chat/vision-queries.ts](src/lib/chat/vision-queries.ts) | Vision DB query functions (`queryComponentCount`, `queryCrossings`, `queryUtilityLength`) |
| [src/lib/chat/smart-router.ts](src/lib/chat/smart-router.ts) | Direct lookup + vector/complete-data search |
| [src/lib/chat/types.ts](src/lib/chat/types.ts) | Shared types: `QueryAnalysis`, `EvidencePacket`, `LiveAnalysisMeta`, `AnswerMode` |
| [src/lib/chat/chat-handler.ts](src/lib/chat/chat-handler.ts) | Shared handler used by both web and mobile routes |
| [src/agents/constructionPEAgent/](src/agents/constructionPEAgent/) | `createDocumentAnalyzer()` — live PDF analysis and prompt logic |
| [src/app/api/chat/route.ts](src/app/api/chat/route.ts) | Web route — auth only, delegates to `handleChatRequest()` |
| [src/app/api/mobile/chat/route.ts](src/app/api/mobile/chat/route.ts) | Mobile route — Bearer token auth only, delegates to `handleChatRequest()` |

---

## Version History

| Date | Change |
|---|--------|
| 2026-01-31 | Initial standard established |
| 2026-03-10 | Rewritten to reflect unified pipeline; live PDF demoted to last-resort fallback; profile-view rules scoped to utility plan sheets only |
