# Phase 4: Architectural Floor Plans + Schedule Linkage

## Goal

Add architectural building-plan understanding so the assistant can answer
room-based, tag-based, and schedule-based questions using the universal
entity model. Phase 4 is a focused expansion — floor plans and supported
schedule types only. No structural, MEP, life safety, or code-compliance
reasoning is attempted in this phase.

---

## What Changes vs. Phase 3

Phase 3 proved multi-discipline reasoning with demolition plans.
Phase 4 **extends** the model with:

1. Active extraction of architectural entities from uploaded drawings
2. Schedule parsing (door / window / room finish schedules) into entity rows
3. Deterministic tag-to-schedule linkage (`D-14` → door schedule entry for `D-14`)
4. New query modes: `arch_element_lookup`, `arch_room_scope`, `arch_schedule_query`
5. New reasoning modes: `arch_element_reasoning`, `arch_room_scope_reasoning`
6. Read paths for tag, room, and schedule questions

**Nothing in the utility or demo pipeline is touched.**

---

## Schema Analysis (from migration 00038)

- `project_entities.discipline` CHECK: `'architectural'` ← use this value (not 'arch')
- `entity_locations.grid_ref TEXT` ← **already exists**, no column addition needed
- `entity_findings.finding_type` has CHECK constraint — must extend for new types
- `entity_relationships.relationship_type` already has `'described_by'` and `'applies_to'` ← sufficient
- No new tables needed — universal entity model absorbs all arch data

---

## Architectural Entity Model (discipline = 'architectural')

### entity_type × subtype vocabulary

| entity_type | subtype examples | canonical_name format |
|---|---|---|
| `room` | `office`, `corridor`, `restroom`, `mech_room`, `open_office`, `conference` | `ROOM_{NUMBER}` |
| `wall` | `type_a`, `cmu`, `exterior`, `partition`, `rated`, `glass` | `WALL_TYPE_{TAG}` |
| `door` | `single`, `double`, `sliding`, `overhead`, `hollow_core`, `solid_core` | `DOOR_{TAG_NORM}` |
| `window` | `fixed`, `casement`, `sliding`, `curtain_wall`, `skylight` | `WINDOW_{TAG_NORM}` |
| `finish_tag` | `floor`, `base`, `wall_finish`, `ceiling_finish` | `FINISH_{CODE}` |
| `schedule_entry` | `door`, `window`, `room_finish`, `hardware` | `SCHED_{TYPE}_{TAG}` |
| `keynote` | (no fixed subtypes) | `KEYNOTE_{SHEET}_{NUM}` |
| `note` | `general`, `code`, `specification` | `NOTE_{SHEET}_{LAST8}` |
| `detail_ref` | (no fixed subtypes) | `DETAIL_{REF_NORM}` |

Tag normalization rule: `UPPER(REGEXP_REPLACE(tag, '[^A-Z0-9]', ''))`
e.g. "D-14" → "D14", "W-3A" → "W3A", "WT-A" → "WTA"

### Status vocabulary

Arch entities use existing status values — no new values needed:
`existing` | `new` | `proposed` | `unknown`

### Finding types

Migration 00041 extends `entity_findings.finding_type` CHECK constraint:

| finding_type | Usage | Status |
|---|---|---|
| `schedule_row` | Full parsed schedule row as structured text | **NEW** — add in 00041 |
| `constraint` | Accessibility/ADA, clearance, code constraint | **NEW** — add in 00041 |
| `dimension` | Opening size, room dimension, clearance | Existing |
| `material` | Material / finish specification | Existing |
| `note` | General note from drawing | Existing |
| `specification_ref` | Specification section cross-reference | Existing |

### Relationship types used (all existing)

| Relationship | Direction | Example |
|---|---|---|
| `located_in` | entity → room entity | Door D-14 → ROOM_105 |
| `described_by` | entity → schedule_entry | Door D-14 → SCHED_DOOR_D14 |
| `applies_to` | keynote → entity | Keynote 7 → Door D-14 |

---

## Architectural Sheet Classification

### Sheet types

| Sheet type ID | Title patterns | Typical prefix |
|---|---|---|
| `arch_floor_plan` | "FLOOR PLAN", "ARCHITECTURAL FLOOR PLAN" | A- (no qualifier) |
| `arch_enlarged_plan` | "ENLARGED", "ENLARGED FLOOR PLAN", "PARTIAL PLAN" | A-2xx |
| `arch_finish_plan` | "FINISH PLAN", "FINISH FLOOR PLAN" | A-3xx |
| `arch_rcp` | "REFLECTED CEILING PLAN", "RCP" | A-5xx |
| `door_schedule` | "DOOR SCHEDULE" | A-8xx, A-9xx |
| `window_schedule` | "WINDOW SCHEDULE" | A-8xx |
| `room_finish_schedule` | "ROOM FINISH SCHEDULE", "FINISH SCHEDULE" | A-8xx |
| `keynote_legend` | "KEYNOTE", "LEGEND", "KEYNOTE LEGEND" | A-0xx |
| `arch_detail` | "DETAIL", "ARCHITECTURAL DETAIL" | A-4xx |

---

## Canonical Name Rules

```
room:           ROOM_{NUMBER}                    e.g. ROOM_105
wall:           WALL_TYPE_{TAG_NORM}             e.g. WALL_TYPE_A
door:           DOOR_{TAG_NORM}                  e.g. DOOR_D14
window:         WINDOW_{TAG_NORM}                e.g. WINDOW_W3A
finish_tag:     FINISH_{CODE_NORM}               e.g. FINISH_FT3
schedule_entry: SCHED_{SUBTYPE}_{TAG_NORM}       e.g. SCHED_DOOR_D14, SCHED_FINISH_105
keynote:        KEYNOTE_{SHEET_CLEAN}_{NUM}      e.g. KEYNOTE_A101_7
note:           NOTE_{SHEET_CLEAN}_{LAST8_OF_ID}
detail_ref:     DETAIL_{REF_NORM}                e.g. DETAIL_3_A401
```

---

## New Answer Modes

| Mode | Triggers | Example queries |
|---|---|---|
| `arch_element_lookup` | Tag lookup — door/window/wall/keynote by label | "What is Door D-14?" "What wall type is WT-A?" |
| `arch_room_scope` | Room-based scope or content query | "What's in Room 105?" "Which rooms are affected?" "What stands out about Room 105?" |
| `arch_schedule_query` | Schedule-focused query | "What does the door schedule say for D-14?" "What finish applies to Room 101?" |

---

## New Reasoning Modes

| Mode | Triggered by | Primary job |
|---|---|---|
| `arch_element_reasoning` | `arch_element_lookup`, `arch_schedule_query` | Element + schedule linkage + findings (dimension/material/constraint) with citations |
| `arch_room_scope_reasoning` | `arch_room_scope` | Room contents (doors, windows, walls, finishes) + notes + constraints |

### Support level rules

| Evidence source | Support level |
|---|---|
| Entity from vision_db (arch graph extraction) | `explicit` |
| Keynote or note on arch sheet tied to entity | `explicit` |
| Inferred from entity type or industry practice | `inferred` |
| No evidence found | `unknown` |

---

## Deliverables: File-by-File Change Plan

### 1. `supabase/migrations/00041_arch_entity_schema.sql` — NEW

**Purpose:** Extend `entity_findings.finding_type` CHECK; add arch performance indexes.

Operations:
1. Extend finding_type CHECK constraint to add `'schedule_row'` and `'constraint'`
   - Drop and recreate constraint with new values (same idempotency pattern as 00040)
2. Add `idx_entities_arch` — partial WHERE `discipline = 'architectural'`
3. Add `idx_entities_arch_type` — `(project_id, entity_type)` WHERE arch
4. Add `idx_entities_arch_label` — `(project_id, label)` WHERE arch
5. Add `idx_findings_schedule_row` — `(entity_id, finding_type)` WHERE `finding_type = 'schedule_row'`
6. Add `idx_relationships_described_by` — `(from_entity_id)` WHERE `relationship_type = 'described_by'`

---

### 2. `src/lib/chat/types.ts` — MODIFY

Add to `AnswerMode`:
```typescript
| 'arch_element_lookup'  // What is Door D-14? What wall type WT-A?
| 'arch_room_scope'      // What's in Room 105? Which rooms affected?
| 'arch_schedule_query'  // What does the door schedule say for D-14?
```

Add to `ReasoningMode`:
```typescript
| 'arch_element_reasoning'      // element + schedule linkage + constraint findings
| 'arch_room_scope_reasoning'   // room contents + finish schedule + notes
```

Add interfaces (Phase 4):
```typescript
export interface ArchFinding {
  findingType: string         // 'schedule_row' | 'dimension' | 'material' | 'note' | 'constraint' | 'specification_ref'
  statement: string
  supportLevel: SupportLevel
  textValue: string | null
  numericValue: number | null
  unit: string | null
  confidence: number
}

export interface ArchScheduleEntry {
  id: string
  tag: string                 // "D-14", "W-3A", "105"
  scheduleType: 'door' | 'window' | 'room_finish' | 'hardware'
  canonicalName: string
  displayName: string
  sheetNumber: string | null
  findings: ArchFinding[]
}

export interface ArchEntity {
  id: string
  entityType: string
  subtype: string | null
  canonicalName: string
  displayName: string
  label: string | null
  status: string
  confidence: number
  room: string | null
  level: string | null
  area: string | null
  gridRef: string | null
  sheetNumber: string | null
  findings: ArchFinding[]
  scheduleEntry: ArchScheduleEntry | null
}

export interface ArchQueryResult {
  success: boolean
  projectId: string
  queryType: 'element' | 'room' | 'schedule'
  tag: string | null
  roomFilter: string | null
  entities: ArchEntity[]
  rooms: ArchEntity[]
  scheduleEntries: ArchScheduleEntry[]
  totalCount: number
  sheetsCited: string[]
  confidence: number
  formattedAnswer: string
}
```

Extend `QueryAnalysis._routing`:
```typescript
archTag?: string | null
archTagType?: 'door' | 'window' | 'wall_type' | 'room' | 'keynote' | null
archRoom?: string | null
archScheduleType?: 'door' | 'window' | 'room_finish' | null
```

---

### 3. `src/lib/chat/query-classifier.ts` — MODIFY

Add to `QueryType`:
```typescript
| 'arch_element_lookup'
| 'arch_room_scope'
| 'arch_schedule_query'
```

Add to `QueryClassification`:
```typescript
archTag?: string
archTagType?: 'door' | 'window' | 'wall_type' | 'room' | 'keynote'
archScheduleType?: 'door' | 'window' | 'room_finish'
```

Pattern constants:
```typescript
const ARCH_ELEMENT_PATTERNS = [
  /\bdoor\s+[A-Z]?\d+[A-Z]?\b/i,
  /\b(D-\d+[A-Z]?)\b/,
  /\bwindow\s+[A-Z]?\d+[A-Z]?\b/i,
  /\b(W-\d+[A-Z]?)\b/,
  /\bwall\s+type\s+[A-Z\d]+\b/i,
  /\bWT-?\w+\b/,
  /what\s+(?:is|are)\s+(?:door|window|wall)\s+/i,
  /tell\s+me\s+about\s+(?:door|window|wall)\s+/i,
  /keynote\s+\d+\b/i,
]

const ARCH_ROOM_PATTERNS = [
  /\broom\s+\w+\b/i,
  /what(?:'?s?|\s+(?:is|are))\s+in\s+room\s+/i,
  /what\s+stands?\s+out\s+(?:about|in)\s+room\s+/i,
  /which\s+rooms?\s+are\s+affected/i,
  /(?:list|show)\s+(?:all\s+)?rooms?/i,
  /room\s+\w+\s+(?:contents?|finishes?|schedule)/i,
]

const ARCH_SCHEDULE_PATTERNS = [
  /(?:door|window|room\s+finish)\s+schedule/i,
  /finish\s+schedule/i,
  /\bdoor\s+type\b/i,
  /\bwindow\s+type\b/i,
  /\bdoor\s+frame\b/i,
  /\bhardware\s+group\b/i,
  /what\s+(?:hardware|finish|type)\s+(?:for|is|applies\s+to)\s+(?:door|window)\s+/i,
]
```

Tag extraction helpers:
```typescript
function extractArchTag(query: string): {
  tag: string | null
  tagType: 'door' | 'window' | 'wall_type' | 'room' | 'keynote' | null
}

function extractArchRoom(query: string): string | null

function extractArchScheduleType(query: string): 'door' | 'window' | 'room_finish' | null
```

Classification priority: arch patterns checked AFTER demo patterns, BEFORE general fallback.

---

### 4. `src/lib/chat/query-analyzer.ts` — MODIFY

In `mapToAnswerMode()`:
```typescript
case 'arch_element_lookup':  return 'arch_element_lookup'
case 'arch_room_scope':      return 'arch_room_scope'
case 'arch_schedule_query':  return 'arch_schedule_query'
```

In `_routing` construction:
```typescript
archTag:          effectiveClassification.archTag          ?? null,
archTagType:      effectiveClassification.archTagType      ?? null,
archRoom:         effectiveClassification.archRoom         ?? null,
archScheduleType: effectiveClassification.archScheduleType ?? null,
```

In `buildPreferredSources()` — arch modes prefer `['vision_db', 'vector_search']`.

---

### 5. `src/lib/chat/arch-queries.ts` — NEW

Key exported functions:

```typescript
// Single element by tag (door D-14, window W-3A, wall type WT-A, keynote 7)
export async function queryArchElement(
  projectId: string,
  tag: string,
  tagType?: 'door' | 'window' | 'wall_type' | 'keynote' | null
): Promise<ArchQueryResult>

// All arch entities in a room (or all rooms if roomNumber is null)
export async function queryArchRoom(
  projectId: string,
  roomNumber: string | null
): Promise<ArchQueryResult>

// Schedule entries by type + optional tag filter
export async function queryArchSchedule(
  projectId: string,
  scheduleType: 'door' | 'window' | 'room_finish',
  tag?: string | null
): Promise<ArchScheduleEntry[]>

// Keynote lookup by number
export async function queryArchKeynote(
  projectId: string,
  keynoteNumber: string,
  sheetFilter?: string | null
): Promise<ArchEntity | null>

// Format results for LLM context
export function formatArchElementAnswer(result: ArchQueryResult): string
export function formatArchRoomAnswer(result: ArchQueryResult): string
```

**Tag matching strategy** — normalize before comparison:
```sql
UPPER(REGEXP_REPLACE(pe.label, '[^A-Z0-9]', '', 'g'))
  = UPPER(REGEXP_REPLACE($tag, '[^A-Z0-9]', '', 'g'))
```
This ensures "D-14" matches "D14", "d14", "D 14".

**Schedule linkage** — two-step (same pattern as `queryDemoConstraints`):
1. Find entity by tag label
2. Find `schedule_entry` via `entity_relationships WHERE relationship_type='described_by' AND from_entity_id=$entity_id`
3. Load `schedule_row` finding from the schedule_entry

---

### 6. `src/lib/chat/retrieval-orchestrator.ts` — MODIFY

Add **Step 2.75** between demo graph and smart router:

```typescript
// Step 2.75: Arch graph queries
if (
  items.length === 0 &&
  (analysis.answerMode === 'arch_element_lookup' ||
   analysis.answerMode === 'arch_room_scope'     ||
   analysis.answerMode === 'arch_schedule_query')
) {
  const archItem = await attemptArchGraphLookup(analysis, projectId)
  if (archItem) {
    items.push(archItem)
    retrievalMethod = 'arch_graph'
  }
}
```

Add to `shouldAttemptLivePDF()`:
```typescript
'arch_element_lookup', 'arch_room_scope', 'arch_schedule_query'
```

Add to `selectRelevantSheets()` patterns:
```typescript
{ test: /door|window|floor\s*plan|room|finish\s*plan/i,
  filePattern: /^a-?\d+|arch|floor\s*plan/i }
```

---

### 7. `src/lib/chat/reasoning-engine.ts` — MODIFY

In `selectReasoningMode()`:
```typescript
case 'arch_element_lookup':
case 'arch_schedule_query':
  return 'arch_element_reasoning'

case 'arch_room_scope':
  return 'arch_room_scope_reasoning'
```

In `generateFindings()`:
```typescript
case 'arch_element_reasoning':     return generateArchElementFindings(packet)
case 'arch_room_scope_reasoning':  return generateArchRoomScopeFindings(packet)
```

New finding generators:

**`generateArchElementFindings(packet)`**
- vision_db items → explicit (schedule entry data, dimension, material findings)
- vector_search items with arch language → inferred
- Standard inferred notes: hardware schedule cross-ref, fire rating note for rated walls, ADA note for accessible doors

**`generateArchRoomScopeFindings(packet)`**
- vision_db items → explicit (room entity + contained elements + schedule entries)
- vector_search items → inferred
- Standard inferred notes: above-ceiling coordination (MEP), acoustic consideration (conference rooms), accessible route note (corridor/restroom)

In `selectAnswerFrame()`:
```typescript
case 'arch_element_reasoning':
  return hasExplicit ? 'arch_element_with_schedule' : 'arch_element_partial'
case 'arch_room_scope_reasoning':
  return hasExplicit ? 'arch_room_cited' : 'arch_room_partial'
```

In `identifyGaps()` — add arch gap detection:
```typescript
if (['arch_element_lookup', 'arch_room_scope', 'arch_schedule_query'].includes(analysis.answerMode)) {
  if (!packet.items.some(i => i.source === 'vision_db')) {
    gaps.push({
      description: 'No architectural entities extracted — arch floor plan sheets may not have been processed',
      gapType: 'insufficient_structured_data',
      actionable: 'Process architectural floor plan sheets (A-xxx) using the Analyze function',
    })
  }
}
```

---

### 8. `src/lib/vision/arch-extractor.ts` — NEW

```typescript
export type ArchSheetType =
  | 'arch_floor_plan' | 'arch_enlarged_plan' | 'arch_finish_plan'
  | 'arch_rcp' | 'door_schedule' | 'window_schedule'
  | 'room_finish_schedule' | 'keynote_legend' | 'arch_detail' | null

export const ARCH_SHEET_PATTERNS: Record<NonNullable<ArchSheetType>, RegExp[]>
export const ARCH_SHEET_NUMBER_PREFIXES: RegExp   // /^A-?\d+/i
export function classifyArchSheet(title: string, sheetNumber: string): ArchSheetType

export const ARCH_ENTITY_PATTERNS: Record<string, RegExp[]>
export function detectArchEntityType(text: string): string
export function detectArchEntitySubtype(entityType: string, text: string): string | null

export function extractArchTagFromText(text: string): {
  tag: string | null
  tagType: 'door' | 'window' | 'wall_type' | 'finish_code' | null
}

export function buildArchCanonicalName(params: {
  entityType: string
  label?: string | null
  room?: string | null
  sheetNumber?: string | null
  entityId: string
}): string

// Two extraction prompts — floor plans vs. schedules
export const ARCH_FLOOR_PLAN_EXTRACTION_PROMPT: string
export const ARCH_SCHEDULE_EXTRACTION_PROMPT: string
export const ARCH_KEYNOTE_EXTRACTION_PROMPT: string
export const ARCH_EXTRACTION_SYSTEM_CONTEXT: string
```

---

### 9. `src/lib/chat/arch-validator.ts` — NEW

```typescript
export interface ArchValidationReport { ... }

export async function runArchValidation(projectId: string): Promise<ArchValidationReport>
// 6 tests:
// 1. arch_entities_exist:  COUNT > 0 WHERE discipline='architectural'
// 2. schedules_parsed:     COUNT > 0 WHERE entity_type='schedule_entry'
// 3. tag_linkage:          ≥ 1 described_by relationship to schedule_entry
// 4. location_coverage:    ≥ 80% of physical arch entities have a location
// 5. findings_coverage:    ≥ 50% of schedule_entry entities have a schedule_row finding
// 6. citation_coverage:    ≥ 1 arch entity has source_document_id set

export function formatArchValidationReport(report: ArchValidationReport): string
```

---

## Example Outputs

### "What is Door D-14?"

```
From Floor Plan A-201 and Door Schedule A-801 (explicit):

DOOR D-14:
• Location: Room 105 (Conference Room), Grid B-5
• Type: Type 3 — Hollow Metal Single Door
• Size: 3'-0" × 7'-0"
• Frame: Hollow Metal — HM-2 profile
• Hardware Group: HW-4 (see Hardware Schedule A-804)
• Glazing: Vision light, 6" × 24", tempered
• Sources: A-201 (plan location), A-801 (door schedule)

Inferred:
• HW-4 hardware typically includes lever handle, LCN closer, and kick plate.
  Verify against Hardware Schedule A-804 for complete specification.

Information gaps:
• Hardware Schedule A-804 not yet analyzed — hardware details unconfirmed.
```

### "Which rooms are affected?"

```
From Floor Plan A-201 (explicit):

ROOMS ON THIS LEVEL (5):

Room 105 — Conference Room
• Doors: D-14, D-15 (Hollow Metal)
• Windows: W-3A, W-3B (Fixed Glazing)
• Floor: CPT-2 | Wall: PT-1 | Ceiling: ACT-1 at 9'-0"

Room 106 — Office
• Doors: D-16 (Wood)
• Floor: CPT-2 | Ceiling: ACT-1 at 9'-0"

Room 110 — Restroom
• Doors: D-20 (Hollow Metal)
• Floor: CT-3 | Wall: CT-4 (tile wainscot to 4'-0") | Ceiling: GYP-1 at 8'-0"

[...2 more rooms]

Information gaps:
• Room Finish Schedule A-803 not yet analyzed — finish codes may not be fully resolved.
```

### "What stands out about Room 105?"

```
From Floor Plan A-201 and Room Finish Schedule A-803 (explicit):

ROOM 105 — Conference Room

Elements (explicit):
• 2 doors: D-14 and D-15 (hollow metal, HW-4)
• 2 windows: W-3A, W-3B (fixed glazing — see window schedule)
• Wall type WT-B on north — rated wall assembly
• Keynote 12: "Provide blocking for future AV mounting"
• Finishes: CPT-2 / PT-1 / PT-1 / ACT-1 at 9'-0"

Notes (explicit):
• Keynote 12: Blocking in walls for future AV equipment. Coordinate with
  electrical for conduit rough-in locations.

Inferred:
• WT-B is a rated assembly — all penetrations require fire stopping sealant.
  Verify fire-rating requirement against code sheet.
• ACT-1 ceiling — if above-ceiling MEP runs through this space, confirm
  plenum classification with mechanical drawings.

Information gaps:
• Window Schedule A-802 not yet analyzed — W-3A and W-3B spec unconfirmed.
• No acoustic specification noted — STC rating for conference room not found.
```

---

## What Does NOT Change

- Utility pipeline — untouched
- Demo pipeline — untouched
- `project_quantities`, `utility_termination_points`, `utility_crossings` — untouched
- All existing SQL functions, views, indexes — untouched
- `graph-queries.ts`, `graph-validator.ts`, `demo-queries.ts`, `demo-validator.ts` — untouched
- `smart-router.ts` — untouched
- Existing answer modes and reasoning modes — untouched
- `requirement_lookup` remains unsupported

---

## Design Constraints Preserved

1. All responses are streaming — no non-streaming arch paths
2. Conversation history always preserved
3. Support levels are deterministic TypeScript — model never reassigns them
4. Reasoning engine is pure TypeScript — no new LLM calls in reasoning layer
5. Insufficient evidence fails honestly at evidence-evaluator
6. Architectural entities use universal entity model — no arch-specific tables
7. Unknown status is explicit — not guessed
8. Schedule linkage is deterministic (normalized label match) — not fuzzy LLM inference
9. Unsupported implications (structural, MEP, code compliance) are flagged as gaps, not inferred

---

## Implementation Checklist

### Migration
- [ ] `supabase/migrations/00041_arch_entity_schema.sql`
  - [ ] Extend `entity_findings.finding_type` CHECK: add `'schedule_row'`, `'constraint'`
  - [ ] `idx_entities_arch`
  - [ ] `idx_entities_arch_type`
  - [ ] `idx_entities_arch_label`
  - [ ] `idx_findings_schedule_row`
  - [ ] `idx_relationships_described_by`

### Types — `src/lib/chat/types.ts`
- [ ] `arch_element_lookup`, `arch_room_scope`, `arch_schedule_query` → AnswerMode
- [ ] `arch_element_reasoning`, `arch_room_scope_reasoning` → ReasoningMode
- [ ] `ArchFinding`, `ArchScheduleEntry`, `ArchEntity`, `ArchQueryResult` interfaces
- [ ] `archTag`, `archTagType`, `archRoom`, `archScheduleType` → `_routing`

### Query classifier — `src/lib/chat/query-classifier.ts`
- [ ] `arch_element_lookup`, `arch_room_scope`, `arch_schedule_query` → QueryType
- [ ] `archTag`, `archTagType`, `archRoom`, `archScheduleType` → QueryClassification
- [ ] `ARCH_ELEMENT_PATTERNS`, `ARCH_ROOM_PATTERNS`, `ARCH_SCHEDULE_PATTERNS`
- [ ] `extractArchTag()`, `extractArchRoom()`, `extractArchScheduleType()`

### Query analyzer — `src/lib/chat/query-analyzer.ts`
- [ ] Arch type → answer mode mapping
- [ ] Arch routing fields propagation

### Arch queries — `src/lib/chat/arch-queries.ts` (NEW)
- [ ] `queryArchElement()`
- [ ] `queryArchRoom()`
- [ ] `queryArchSchedule()`
- [ ] `queryArchKeynote()`
- [ ] `formatArchElementAnswer()`
- [ ] `formatArchRoomAnswer()`

### Retrieval — `src/lib/chat/retrieval-orchestrator.ts`
- [ ] Step 2.75: arch graph lookup
- [ ] Arch modes → `shouldAttemptLivePDF()`
- [ ] Arch sheet filter → `selectRelevantSheets()`

### Reasoning — `src/lib/chat/reasoning-engine.ts`
- [ ] Arch modes → `selectReasoningMode()`
- [ ] `generateArchElementFindings()`, `generateArchRoomScopeFindings()`
- [ ] Arch answer frames → `selectAnswerFrame()`
- [ ] Arch gap detection → `identifyGaps()`

### Vision extractor — `src/lib/vision/arch-extractor.ts` (NEW)
- [ ] `classifyArchSheet()`, `ARCH_SHEET_PATTERNS`
- [ ] `detectArchEntityType()`, `detectArchEntitySubtype()`
- [ ] `extractArchTagFromText()`, `buildArchCanonicalName()`
- [ ] `ARCH_FLOOR_PLAN_EXTRACTION_PROMPT`
- [ ] `ARCH_SCHEDULE_EXTRACTION_PROMPT`
- [ ] `ARCH_KEYNOTE_EXTRACTION_PROMPT`

### Validation — `src/lib/chat/arch-validator.ts` (NEW)
- [ ] `runArchValidation()` — 6 tests
- [ ] `formatArchValidationReport()`
