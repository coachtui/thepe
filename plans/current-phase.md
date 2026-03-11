# Phase 4: Architectural Floor Plans + Schedule Linkage — COMPLETE ✓

Delivered 2026-03-11. TypeScript compilation passed with zero errors (`npx tsc --noEmit --skipLibCheck`).

---

## Phase 4 Status: COMPLETE ✓

### Delivered Files

| Deliverable | File | Status |
|---|---|---|
| Arch entity schema extension | `supabase/migrations/00041_arch_entity_schema.sql` | ✓ NEW |
| AnswerMode + ReasoningMode extensions | `src/lib/chat/types.ts` | ✓ MODIFIED |
| Arch query classification | `src/lib/chat/query-classifier.ts` | ✓ MODIFIED |
| Arch answer mode mapping | `src/lib/chat/query-analyzer.ts` | ✓ MODIFIED |
| Arch graph read queries | `src/lib/chat/arch-queries.ts` | ✓ NEW |
| Arch graph retrieval path | `src/lib/chat/retrieval-orchestrator.ts` | ✓ MODIFIED |
| Arch reasoning modes | `src/lib/chat/reasoning-engine.ts` | ✓ MODIFIED |
| Vision extraction infrastructure | `src/lib/vision/arch-extractor.ts` | ✓ NEW |
| Arch validation harness | `src/lib/chat/arch-validator.ts` | ✓ NEW |

### Implementation Checklist

#### Migration
- [x] `supabase/migrations/00041_arch_entity_schema.sql`
  - [x] Extend `entity_findings.finding_type` CHECK to include `'schedule_row'`, `'constraint'` (idempotent DO $ block)
  - [x] Add `idx_entities_arch` index (discipline = 'architectural')
  - [x] Add `idx_entities_arch_label` index (discipline + normalized_label)
  - [x] Add `idx_entities_arch_schedule` index (entity_type = 'schedule_entry')
  - [x] Add `idx_findings_schedule_row` index (finding_type = 'schedule_row')
  - [x] Add `idx_relationships_described_by` index (relationship_type = 'described_by')

#### Types (`src/lib/chat/types.ts`)
- [x] Add `arch_element_lookup`, `arch_room_scope`, `arch_schedule_query` to `AnswerMode`
- [x] Add `arch_element_reasoning`, `arch_room_scope_reasoning` to `ReasoningMode`
- [x] Add `ArchFinding`, `ArchScheduleEntry`, `ArchEntity`, `ArchQueryResult` interfaces
- [x] Add `archTag`, `archTagType`, `archRoom`, `archScheduleType` to `_routing`

#### Query Classifier (`src/lib/chat/query-classifier.ts`)
- [x] Add `ARCH_ELEMENT_PATTERNS`, `ARCH_ROOM_PATTERNS`, `ARCH_SCHEDULE_PATTERNS`
- [x] Add `extractArchTag()`, `extractArchRoom()`, `extractArchScheduleType()` helpers
- [x] Add arch detection in `classifyQuery()` (schedule_query → element → room, before default-general)

#### Query Analyzer (`src/lib/chat/query-analyzer.ts`)
- [x] Map `arch_element_lookup` → `'arch_element_lookup'` in `mapToAnswerMode()`
- [x] Map `arch_room_scope` → `'arch_room_scope'`
- [x] Map `arch_schedule_query` → `'arch_schedule_query'`
- [x] Arch preferred sources (vision_db + vector_search) in `buildPreferredSources()`
- [x] Propagate `archTag`, `archTagType`, `archRoom`, `archScheduleType` to `_routing`

#### Arch Queries (`src/lib/chat/arch-queries.ts`) — NEW
- [x] `queryArchElement(projectId, tag, tagType?)` — normalized label match + schedule linkage
- [x] `queryArchRoom(projectId, roomNumber)` — all arch entities, TypeScript room filter
- [x] `queryArchSchedule(projectId, scheduleType, tag?)` — schedule entry lookup
- [x] `queryArchKeynote(projectId, keynoteNumber, sheetFilter?)` — keynote legend lookup
- [x] `formatArchElementAnswer(result)` — structured context for LLM
- [x] `formatArchRoomAnswer(result)` — grouped room contents for LLM
- [x] `fetchScheduleEntryForEntity()` — 2-step described_by → schedule entity resolution
- [x] Tag normalization: `UPPER(REGEXP_REPLACE(label, '[^A-Z0-9]', ''))`

#### Retrieval (`src/lib/chat/retrieval-orchestrator.ts`)
- [x] Step 2.75: arch graph lookup before smart-router (after demo graph step 2.5)
- [x] `attemptArchGraphLookup()` helper — routes to element/room/schedule query by mode
- [x] Arch modes added to `shouldAttemptLivePDF()`
- [x] Arch sheet pattern (`A-xxx`) added as first entry in `selectRelevantSheets()`

#### Reasoning (`src/lib/chat/reasoning-engine.ts`)
- [x] `arch_element_lookup` → `arch_element_reasoning` in `selectReasoningMode()`
- [x] `arch_room_scope` / `arch_schedule_query` → `arch_room_scope_reasoning`
- [x] `generateArchElementFindings()` — vision_db=explicit, vector=inferred
- [x] `generateArchRoomScopeFindings()` — vision_db=explicit, vector=inferred (room language filter)
- [x] Arch answer frames: `arch_element_with_schedule`, `arch_element_inferred`, `arch_room_scope_detailed`, `arch_room_scope_partial`
- [x] Arch-specific gap detection: no arch data → direct user to process A-xxx sheets

#### Vision Extractor (`src/lib/vision/arch-extractor.ts`) — NEW
- [x] `classifyArchSheet(title, sheetNumber)` → ArchSheetType (9 types)
- [x] `ARCH_SHEET_PATTERNS` with specificity-ordered regexes
- [x] `ARCH_ENTITY_PATTERNS` (9 entity types: door, window, wall, room, finish_tag, schedule_entry, keynote, detail_ref, note)
- [x] `detectArchEntityType(text)`, `detectArchEntitySubtype(entityType, text)`
- [x] `extractArchTagFromText(text)` — handles D-14, W-3A, WT-A, FT-3 tag formats
- [x] `buildArchCanonicalName(params)` — DOOR_D14, WINDOW_W3A, ROOM_105, SCHED_DOOR_D14
- [x] `ARCH_FLOOR_PLAN_EXTRACTION_PROMPT`, `ARCH_SCHEDULE_EXTRACTION_PROMPT`, `ARCH_KEYNOTE_EXTRACTION_PROMPT`

#### Validation Harness (`src/lib/chat/arch-validator.ts`) — NEW
- [x] `runArchValidation(projectId)` → ArchValidationReport (6 tests)
- [x] `formatArchValidationReport(report)` → string
- [x] Tests: arch_entities_exist, schedules_parsed, tag_linkage, location_coverage, findings_coverage, citation_coverage

---

## Key Design Decisions

### discipline = 'architectural' (not 'arch')
Existing CHECK constraint in migration 00038 uses `'architectural'`. No constraint migration needed for the discipline value.

### No new tables — universal entity model absorbs all arch data
`project_entities` + `entity_locations` + `entity_findings` + `entity_relationships` + `entity_citations` handle all architectural entities, schedule entries, and linkage.

### grid_ref already exists
`entity_locations.grid_ref TEXT` was added in migration 00038. No column addition needed in 00041.

### Tag linkage via normalized label matching
`normalizeTag(tag) = tag.toUpperCase().replace(/[^A-Z0-9]/g, '')` applied in TypeScript on both the stored label and the query tag. Two-step described_by → schedule entity resolution (same pattern as demo constraint queries).

### Two finding_types added: 'schedule_row', 'constraint'
Migration 00041 extends the CHECK constraint via idempotent DO $ block (same pattern as migration 00040).

### retrieval Step 2.75: arch graph between demo (2.5) and smart-router (3)
Arch graph data takes priority over generic vector search. Falls through gracefully when no arch entities exist.

---

## What Does NOT Change

- All utility and demo pipeline code — untouched
- `graph-queries.ts`, `demo-queries.ts`, `smart-router.ts` — untouched
- Existing answer modes and reasoning modes — untouched
- `requirement_lookup` remains unsupported

---

## Next Phase

**Phase 5: Cross-Discipline Reasoning** — cross-referencing arch, demo, and utility entities
(e.g. "does the demo scope affect any utilities?", "what utilities run under Room 105?").

---

# Phase 3: Demo-Plan Ingestion and Reasoning — COMPLETE ✓

Delivered 2026-03-10. TypeScript compilation passed with zero errors (`npx tsc --noEmit --skipLibCheck`).

---

## Phase 2 Status: COMPLETE ✓

Delivered 2026-03-10. All items shipped and migrations applied.

| Deliverable | File | Notes |
|---|---|---|
| Universal entity model schema | `migrations/00038` | Idempotent; 5 tables + RLS + indexes |
| Utility backfill migration | `migrations/00039` | project_quantities + termination_points + crossings |
| Graph retrieval helpers | `src/lib/chat/graph-queries.ts` | Mirrors vision-queries API |
| Validation harness | `src/lib/chat/graph-validator.ts` | 5 tests, legacy vs graph |
| Reasoning engine | `src/lib/chat/reasoning-engine.ts` | ReasoningPacket, support levels, pass-through mode |
| Chat pipeline wiring | `types.ts`, `chat-handler.ts`, `response-writer.ts` | Reasoning layer inserted between evidence and writer |

**Entity graph tables are live and backfilled.** Legacy tables remain authoritative.
`supabase as any` cast used throughout graph-queries — regenerate types after next deploy.

---

## Phase 3 Status: COMPLETE ✓

### Delivered Files

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

### Implementation Checklist

#### Migration
- [x] `supabase/migrations/00040_demo_entity_schema.sql`
  - [x] Extend `status` CHECK to include `'unknown'` (via dynamic DO $ block, idempotent)
  - [x] Add `idx_entities_demo` index
  - [x] Add `idx_findings_demo_scope` index
  - [x] Add `idx_entities_demo_status` index

#### Types (`src/lib/chat/types.ts`)
- [x] Add `demo_scope`, `demo_constraint` to `AnswerMode`
- [x] Add `demo_scope_reasoning`, `demo_constraint_reasoning` to `ReasoningMode`
- [x] Add `DemoEntity`, `DemoFinding`, `DemoQueryResult` interfaces
- [x] Add `demoRoom`, `demoLevel`, `demoStatusHint` to `_routing`

#### Query Classifier (`src/lib/chat/query-classifier.ts`)
- [x] Add `DEMO_SCOPE_PATTERNS`
- [x] Add `DEMO_REMAIN_PATTERNS`
- [x] Add `DEMO_CONSTRAINT_PATTERNS`
- [x] Add `extractDemoRoom()`, `extractDemoLevel()` helpers
- [x] Add demo detection in `classifyQuery()` (before default-general return)
- [x] `demoStatusHint: 'to_remain'` set when only remain patterns match

#### Query Analyzer (`src/lib/chat/query-analyzer.ts`)
- [x] Map `demo_scope` → `'demo_scope'` in `mapToAnswerMode()`
- [x] Map `demo_constraint` → `'demo_constraint'` in `mapToAnswerMode()`
- [x] Propagate `demoRoom`, `demoLevel`, `demoStatusHint` to `_routing`

#### Demo Queries (`src/lib/chat/demo-queries.ts`) — NEW
- [x] `queryDemoScope(projectId, roomFilter?, statusFilter?)`
- [x] `queryDemoByRoom(projectId, roomNumber)` (delegates to queryDemoScope)
- [x] `queryDemoProtectInPlace(projectId)` (delegates to queryDemoScope)
- [x] `queryDemoConstraints(projectId)` (two-step query: entity IDs → findings)
- [x] `formatDemoAnswer(result, mode)` — 'scope' | 'remain' | 'constraint'
- [x] `formatDemoConstraintsAsContext(result)` — for reasoning engine context
- [x] Room filter applied in TypeScript post-fetch (room_number in nested entity_locations)

#### Retrieval (`src/lib/chat/retrieval-orchestrator.ts`)
- [x] Step 2.5: demo graph lookup before smart-router (after vision DB step)
- [x] `attemptDemoGraphLookup()` helper
- [x] `demo_scope` and `demo_constraint` added to `shouldAttemptLivePDF()`
- [x] Demo sheet pattern added to `selectRelevantSheets()`

#### Reasoning (`src/lib/chat/reasoning-engine.ts`)
- [x] `demo_scope` → `demo_scope_reasoning` in `selectReasoningMode()`
- [x] `demo_constraint` → `demo_constraint_reasoning` in `selectReasoningMode()`
- [x] `generateDemoScopeFindings()` — vision_db=explicit, vector=inferred
- [x] `generateDemoConstraintFindings()` — risk notes explicit + STANDARD_DEMO_CAUTIONS inferred
- [x] `STANDARD_DEMO_CAUTIONS` array (utility isolation, hazmat survey, structural review, fire protection)
- [x] Demo answer frames added
- [x] Demo-specific gap detection: no demo data gap + unknown-status entities gap

#### Vision Extractor (`src/lib/vision/demo-extractor.ts`) — NEW
- [x] `classifyDemoSheet(sheetTitle, sheetNumber)` → DemoSheetType
- [x] `DEMO_SHEET_PATTERNS` (5 types: demo_plan, demo_rcp, demo_detail, demo_schedule, demo_notes)
- [x] `DEMO_SHEET_NUMBER_PREFIXES` regex
- [x] `DEMO_STATUS_KEYWORDS` with priority ordering
- [x] `extractDemoStatusFromText(text)` → DemoStatus
- [x] `DEMO_ENTITY_PATTERNS` (8 entity types)
- [x] `detectDemoEntityType(text)` → string
- [x] `detectDemoEntitySubtype(entityType, text)` → string | null
- [x] `buildDemoCanonicalName(params)` → string
- [x] `DEMO_EXTRACTION_PROMPT` — outputs `status_text` (raw text); status assigned deterministically post-fetch
- [x] `DEMO_EXTRACTION_SYSTEM_CONTEXT` — domain context for model

#### Validation Harness (`src/lib/chat/demo-validator.ts`) — NEW
- [x] `runDemoValidation(projectId)` → DemoValidationReport (5 tests)
- [x] `formatDemoValidationReport(report)` → string
- [x] Tests: demo_entities_exist, findings_coverage, location_coverage, status_variety, citation_coverage

---

## Key Design Decisions

### Status is deterministic, not model-inferred
`DEMO_EXTRACTION_PROMPT` outputs `status_text` (verbatim text from drawing).
`extractDemoStatusFromText()` maps it to the canonical status. The model never assigns status.

### Room filter is post-fetch TypeScript
`room_number` lives in `entity_locations` (nested table), not on `project_entities`.
Room filtering is applied in TypeScript after fetching. Bounded entity counts per project make this acceptable.

### Two-step constraint query
`queryDemoConstraints()` uses two queries (entity IDs first, then findings) to avoid complex PostgREST nested filter syntax on cross-table conditions.

### `supabase as any` cast
`project_entities` and entity graph tables are not yet in generated Supabase TypeScript types. Same pattern as `graph-queries.ts`.

### `unknown` status in migration
The existing CHECK constraint did not include `'unknown'`. Migration 00040 finds and replaces the constraint by name via dynamic DO $ block (idempotent).

---

## What Does NOT Change

- All utility pipeline code and queries — untouched
- `project_quantities`, `utility_termination_points`, `utility_crossings` — untouched
- All existing SQL functions and views — untouched
- `graph-queries.ts`, `graph-validator.ts` — untouched
- `smart-router.ts` — untouched
- Existing answer modes and reasoning modes — untouched
- `requirement_lookup` remains unsupported

---

## Next Phase

**Phase 4: Extended Cross-Discipline Reasoning** — cross-referencing demo and utility entities
(e.g. "does the demo scope affect any utilities?", utility protection during demo work).

See `plans/master-plan.md` for Phase 4 specification.
