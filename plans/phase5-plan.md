# Phase 5: Structural + MEP Support and Cross-Discipline Coordination Reasoning

## Split Structure

- **Phase 5A** — Structural extraction, MEP extraction, graph ingestion
- **Phase 5B** — First-pass cross-discipline coordination reasoning

---

## What Changed Through Phase 4

| Phase | Discipline | Core capability |
|---|---|---|
| 1 | — | Universal entity model schema |
| 2 | utility | Utility pipe/fitting/crossing/junction graph |
| 3 | demo | Demolition scope and constraint reasoning |
| 4 | architectural | Room/door/window/schedule entity graph and reasoning |
| 5A | structural, mep | Structural footing/column/beam/grid + MEP panel/AHU/fixture graph |
| 5B | cross-discipline | Coordination reasoning: trades-per-room, dependency analysis |

---

## Schema Baseline (from migration 00038)

The `project_entities.discipline` CHECK constraint **already includes** `'structural'` and `'mep'`:

```sql
CHECK (discipline IN ('utility', 'demo', 'architectural', 'structural', 'mep', 'schedule', 'general'))
```

**No discipline constraint migration is needed.** Phase 5 only needs to:
1. Extend `entity_findings.finding_type` CHECK (migration 00042)
2. Add performance indexes for structural + MEP queries (migration 00042)

---

---

# PHASE 5A: Structural + MEP Extraction

---

## Structural Entity Model (discipline = 'structural')

### entity_type × subtype vocabulary

| entity_type | subtype examples | canonical_name format |
|---|---|---|
| `footing` | `spread`, `continuous`, `pile_cap`, `grade_beam` | `FTG_{MARK_NORM}` e.g. FTG_F1, FTG_F2A |
| `column` | `steel`, `concrete`, `wood`, `tube_steel` | `COL_{MARK_NORM}` e.g. COL_C4, COL_1A |
| `beam` | `steel`, `concrete`, `lvl`, `glulam`, `wide_flange` | `BM_{MARK_NORM}` e.g. BM_W12X26_L1 |
| `foundation_wall` | `concrete`, `cmu`, `stem_wall` | `FWALL_{MARK_NORM}` e.g. FWALL_FW1 |
| `slab_edge` | `thickened`, `step`, `depressed` | `SLAB_EDGE_{SHEET}_{LAST8}` |
| `structural_opening` | `floor`, `wall`, `roof` | `STRUCT_OPNG_{MARK_NORM}` e.g. STRUCT_OPNG_SO1 |
| `grid_line` | (no subtype) | `GRID_{AXIS_NORM}` e.g. GRID_A, GRID_1, GRID_A1 |
| `structural_note` | `general`, `typical`, `specification_ref` | `STRUCT_NOTE_{SHEET}_{LAST8}` |

### Status vocabulary

Structural entities use existing status values: `existing` | `new` | `proposed` | `unknown`

### Mark normalization rule

`UPPER(REGEXP_REPLACE(mark, '[^A-Z0-9]', '', 'g'))` — same as arch tag normalization.
e.g. "F-1" → "F1", "C-4A" → "C4A", "W12×26" → "W1226"

### Finding types for structural (all existing except where marked NEW)

| finding_type | Usage |
|---|---|
| `dimension` | Member depth, footing size, slab thickness |
| `material` | Steel grade (ASTM A992), concrete strength (f'c=4000 psi), CMU type |
| `note` | General structural note |
| `specification_ref` | Structural spec section reference |
| `load_bearing` | **NEW** — Indicates load-bearing significance, load path note |
| `capacity` | **NEW** — Member capacity, bearing capacity note |

### Relationship types used (all existing)

| Relationship | Direction | Example |
|---|---|---|
| `located_in` | structural entity → room entity | Footing FTG_F1 → ROOM_105 |
| `supports` | **NEW** — column → beam, footing → column | COL_C4 supports BM_W12X26 |

`'supports'` is the only new relationship_type for Phase 5A. It is optional and only created when the extraction model extracts explicit load-path language.

---

## Structural Sheet Classification

| Sheet type ID | Title patterns | Typical prefix |
|---|---|---|
| `structural_foundation_plan` | "FOUNDATION PLAN", "FOOTING PLAN" | S-1xx |
| `structural_framing_plan` | "FRAMING PLAN", "STRUCTURAL FLOOR PLAN", "ROOF FRAMING" | S-2xx |
| `structural_notes` | "STRUCTURAL NOTES", "GENERAL STRUCTURAL NOTES" | S-0xx |
| `structural_detail` | "STRUCTURAL DETAIL", "DETAIL", "CONNECTION DETAIL" | S-3xx, S-4xx |

Sheet number prefix matching: `/^S[-_]?\d/i`

---

## MEP Entity Model (discipline = 'mep')

Trade differentiation is done via `entity_type` — the vocabulary is trade-specific with no overlap. No `subtype` is needed to distinguish electrical from mechanical from plumbing.

### Electrical entity_types

| entity_type | subtype examples | canonical_name format |
|---|---|---|
| `panel` | `main`, `branch`, `mcc`, `distribution` | `PANEL_{TAG_NORM}` e.g. PANEL_LP1, PANEL_MDP |
| `transformer` | `pad_mount`, `wall_mount`, `dry_type` | `XFMR_{TAG_NORM}` e.g. XFMR_T1 |
| `electrical_fixture` | `outlet`, `switch`, `light`, `receptacle` | `EFIXTR_{TAG_NORM}` |
| `conduit` | `rigid`, `emt`, `pvc` | `CONDUIT_{SHEET}_{LAST8}` |
| `schedule_entry` (panel) | `panel_schedule` | `SCHED_ELEC_{TAG_NORM}` e.g. SCHED_ELEC_LP1 |

### Mechanical entity_types

| entity_type | subtype examples | canonical_name format |
|---|---|---|
| `air_handler` | `ahu`, `rtu`, `fcu`, `split_system` | `AHU_{TAG_NORM}` e.g. AHU_1, RTU_2 |
| `vav_box` | `single_duct`, `fan_powered`, `parallel` | `VAV_{TAG_NORM}` e.g. VAV_101 |
| `diffuser` | `supply`, `return`, `exhaust`, `grille` | `DIFF_{TAG_NORM}` e.g. DIFF_SD1 |
| `duct_run` | `supply`, `return`, `exhaust`, `transfer` | `DUCT_{SHEET}_{LAST8}` |
| `mechanical_equipment` | `exhaust_fan`, `pump`, `boiler`, `chiller` | `MEQUIP_{TAG_NORM}` |
| `schedule_entry` (equipment) | `equipment_schedule` | `SCHED_MECH_{TAG_NORM}` |

### Plumbing entity_types

| entity_type | subtype examples | canonical_name format |
|---|---|---|
| `plumbing_fixture` | `lavatory`, `water_closet`, `urinal`, `sink`, `shower`, `drinking_fountain` | `PFIXTR_{TAG_NORM}` e.g. PFIXTR_WC1 |
| `floor_drain` | (no subtype) | `FD_{TAG_NORM}` e.g. FD_1 |
| `cleanout` | (no subtype) | `CO_{TAG_NORM}` e.g. CO_1 |
| `piping_segment` | `domestic_cold`, `domestic_hot`, `sanitary`, `vent`, `storm` | `PIPE_{SHEET}_{LAST8}` |
| `plumbing_equipment` | `water_heater`, `pump`, `expansion_tank` | `PEQUIP_{TAG_NORM}` |
| `schedule_entry` (plumbing) | `plumbing_fixture_schedule` | `SCHED_PLMB_{TAG_NORM}` |

### Status vocabulary

MEP entities use: `existing` | `new` | `proposed` | `unknown`

### Finding types for MEP

| finding_type | Usage |
|---|---|
| `dimension` | Duct size, pipe diameter, panel dimensions |
| `material` | Duct liner type, pipe material (copper/PVC/cast iron), conduit type |
| `note` | General MEP note |
| `specification_ref` | MEP spec section reference |
| `capacity` | **NEW** — Panel amperage, AHU CFM, pipe flow rate |
| `equipment_tag` | **NEW** — Equipment nameplate data (HP, voltage, FLA, MCA) |
| `circuit_ref` | **NEW** — Electrical circuit origin reference (e.g., "Fed from LP-1, Ckt 7") |
| `schedule_row` | Full parsed schedule row (panel schedule, equipment schedule) — already exists |

---

## MEP Sheet Classification

| Sheet type ID | Title patterns | Typical prefix |
|---|---|---|
| `mechanical_floor_plan` | "MECHANICAL FLOOR PLAN", "HVAC FLOOR PLAN", "MECHANICAL PLAN" | M-1xx |
| `electrical_power_plan` | "ELECTRICAL POWER PLAN", "POWER PLAN", "ELECTRICAL PLAN" | E-1xx |
| `electrical_lighting_plan` | "LIGHTING PLAN", "ELECTRICAL LIGHTING" | E-2xx |
| `plumbing_plan` | "PLUMBING FLOOR PLAN", "PLUMBING PLAN", "SANITARY PLAN" | P-1xx |
| `equipment_schedule` | "EQUIPMENT SCHEDULE", "MECHANICAL EQUIPMENT SCHEDULE" | M-8xx, M-9xx |
| `panel_schedule` | "PANEL SCHEDULE", "ELECTRICAL PANEL SCHEDULE" | E-8xx, E-9xx |
| `one_line_diagram` | "ONE-LINE DIAGRAM", "SINGLE LINE DIAGRAM", "RISER DIAGRAM" | E-0xx |

Sheet prefix matching (MEP combined): `/^[MEP][-_]?\d/i`

**One-line / riser diagram:** Light support only — extract panel tags and transformer tags. Do not attempt to parse circuit connectivity graphs.

---

## New Answer Modes (Phase 5A)

| Mode | Trigger examples |
|---|---|
| `struct_element_lookup` | "What is column C-4?" "What footing is at Grid A-3?" "Tell me about footing F-1" |
| `struct_area_scope` | "What's the structural system in this area?" "What structural elements are on Level 1?" |
| `mep_element_lookup` | "What panel is on Level 1?" "What's AHU-1?" "Tell me about transformer T-1" |
| `mep_area_scope` | "What MEP is in Room 105?" "What mechanical equipment is on Level 2?" |

## New Answer Modes (Phase 5B)

| Mode | Trigger examples |
|---|---|
| `trade_coordination` | "What trades touch Room 105?" "What systems are in Room 105?" "Which trades are working in this area?" |
| `coordination_sequence` | "What could hold this work up?" "What should be coordinated before starting?" "What needs to be done first?" |
| `affected_area` | "What systems are affected on Level 1?" "What's affected in this room?" "What touches this space?" |

---

## New Reasoning Modes

| Mode | Triggered by | Primary job |
|---|---|---|
| `struct_element_reasoning` | `struct_element_lookup` | Mark/grid lookup, material/dimension findings, load-bearing cautions |
| `struct_area_reasoning` | `struct_area_scope` | All structural elements in area, grid coverage, standard structural notes |
| `mep_element_reasoning` | `mep_element_lookup` | Tag lookup, schedule entry linkage, capacity/circuit findings |
| `mep_area_reasoning` | `mep_area_scope` | MEP entities grouped by trade in area, equipment tags, coordination notes |
| `trade_overlap_reasoning` | `trade_coordination` | Disciplines present in room/area, by-trade entity lists, overlap notes |
| `coordination_constraint_reasoning` | `coordination_sequence` | What holds work up: cross-discipline dependencies, standard cautions |
| `affected_area_reasoning` | `affected_area` | All disciplines + demo/arch context for a room/level, gap notes |

### Support level rules (unchanged)

| Evidence source | Support level |
|---|---|
| Entity from vision_db (structural or MEP graph) | `explicit` |
| Keynote or note tied to entity | `explicit` |
| Standard construction practice caution | `inferred` |
| No evidence found | `unknown` |

---

## Deliverables: File-by-File Change Plan

---

### 1. `supabase/migrations/00042_structural_mep_entity_schema.sql` — NEW

**Purpose:** Add structural/MEP finding types and performance indexes.

Operations:
1. Extend `entity_findings.finding_type` CHECK — add `'load_bearing'`, `'capacity'`, `'equipment_tag'`, `'circuit_ref'`, `'coordination_note'`
   - Same idempotent DO $ block pattern as migrations 00040 and 00041.
2. Extend `entity_relationships.relationship_type` CHECK — add `'supports'`, `'served_by'`
   - `'supports'`: structural load-path (column → beam, footing → column)
   - `'served_by'`: MEP service connection (room → panel, room → AHU)
3. Add `idx_entities_structural` — partial WHERE `discipline = 'structural'`
4. Add `idx_entities_mep` — partial WHERE `discipline = 'mep'`
5. Add `idx_entities_mep_type` — `(project_id, entity_type)` WHERE `discipline = 'mep'`
6. Add `idx_entities_structural_label` — `(project_id, label)` WHERE `discipline = 'structural' AND label IS NOT NULL`
7. Add `idx_entities_mep_label` — `(project_id, label)` WHERE `discipline = 'mep' AND label IS NOT NULL`
8. Add `idx_findings_capacity` — `(entity_id, finding_type)` WHERE `finding_type = 'capacity'`
9. Add `idx_findings_equipment_tag` — `(entity_id, finding_type)` WHERE `finding_type = 'equipment_tag'`
10. Add `idx_location_room_discipline` — `(project_id, room_number, entity_id)` on `entity_locations` — enables fast cross-discipline room queries

**Discipline CHECK note:** `'structural'` and `'mep'` are already valid (migration 00038 line 57). No constraint change needed for discipline.

---

### 2. `src/lib/chat/types.ts` — MODIFY

#### AnswerMode additions
```typescript
// Phase 5A
| 'struct_element_lookup'   // What is column C-4? What footing at Grid A-3?
| 'struct_area_scope'       // What structural elements are on Level 1?
| 'mep_element_lookup'      // What panel is LP-1? What's AHU-1?
| 'mep_area_scope'          // What MEP is in Room 105?
// Phase 5B
| 'trade_coordination'      // What trades touch Room 105?
| 'coordination_sequence'   // What could hold this work up?
| 'affected_area'           // What systems are affected on Level 1?
```

#### ReasoningMode additions
```typescript
| 'struct_element_reasoning'           // structural element + grid + findings
| 'struct_area_reasoning'              // structural system per area/level
| 'mep_element_reasoning'              // MEP element + schedule linkage
| 'mep_area_reasoning'                 // MEP by trade in area
| 'trade_overlap_reasoning'            // disciplines per room (Phase 5B)
| 'coordination_constraint_reasoning'  // dependencies + cautions (Phase 5B)
| 'affected_area_reasoning'            // all systems in room/level (Phase 5B)
```

#### New interfaces

```typescript
export interface StructuralFinding {
  findingType: string   // 'dimension' | 'material' | 'note' | 'load_bearing' | 'capacity' | 'specification_ref'
  statement: string
  supportLevel: SupportLevel
  textValue: string | null
  numericValue: number | null
  unit: string | null
  confidence: number
}

export interface StructuralEntity {
  id: string
  entityType: string        // 'footing' | 'column' | 'beam' | 'foundation_wall' | 'slab_edge' | 'structural_opening' | 'grid_line' | 'structural_note'
  subtype: string | null
  canonicalName: string
  displayName: string
  label: string | null      // mark ("F-1", "C-4", "W12×26")
  status: string
  confidence: number
  room: string | null
  level: string | null
  gridRef: string | null    // "Grid A-3", "Grid B/3-4"
  area: string | null
  sheetNumber: string | null
  findings: StructuralFinding[]
}

export interface StructuralQueryResult {
  success: boolean
  projectId: string
  queryType: 'element' | 'area'
  mark: string | null
  gridFilter: string | null
  levelFilter: string | null
  entities: StructuralEntity[]
  totalCount: number
  sheetsCited: string[]
  confidence: number
  formattedAnswer: string
}

export interface MEPFinding {
  findingType: string   // 'dimension' | 'material' | 'capacity' | 'equipment_tag' | 'circuit_ref' | 'note' | 'schedule_row' | 'coordination_note'
  statement: string
  supportLevel: SupportLevel
  textValue: string | null
  numericValue: number | null
  unit: string | null
  confidence: number
}

export interface MEPEntity {
  id: string
  entityType: string        // 'panel' | 'transformer' | 'air_handler' | 'vav_box' | 'plumbing_fixture' | etc.
  subtype: string | null
  canonicalName: string
  displayName: string
  label: string | null      // equipment tag ("LP-1", "AHU-1", "WC-3")
  trade: 'electrical' | 'mechanical' | 'plumbing' | 'unknown'  // derived at query time from entity_type
  status: string
  confidence: number
  room: string | null
  level: string | null
  area: string | null
  gridRef: string | null
  sheetNumber: string | null
  findings: MEPFinding[]
  scheduleEntry: MEPScheduleEntry | null
}

export interface MEPScheduleEntry {
  id: string
  tag: string
  scheduleType: 'panel' | 'equipment' | 'plumbing_fixture'
  canonicalName: string
  displayName: string
  sheetNumber: string | null
  findings: MEPFinding[]
}

export interface MEPQueryResult {
  success: boolean
  projectId: string
  queryType: 'element' | 'area'
  tag: string | null
  roomFilter: string | null
  levelFilter: string | null
  disciplineFilter: 'electrical' | 'mechanical' | 'plumbing' | null
  entities: MEPEntity[]
  totalCount: number
  sheetsCited: string[]
  confidence: number
  formattedAnswer: string
}

// Phase 5B
export interface TradePresence {
  trade: string             // 'structural' | 'electrical' | 'mechanical' | 'plumbing' | 'architectural' | 'demo'
  entityCount: number
  entityTypes: string[]     // ['panel', 'conduit'] for electrical
  representativeLabels: string[]  // ['LP-1', 'T-1'] — first 3
  sheetsCited: string[]
}

export interface CoordinationQueryResult {
  success: boolean
  projectId: string
  roomFilter: string | null
  levelFilter: string | null
  tradesPresent: TradePresence[]
  coordinationNotes: string[]   // explicit coordination_note findings
  totalDisciplineCount: number
  confidence: number
  formattedAnswer: string
}
```

#### _routing additions
```typescript
/** Structural mark extracted from query (e.g. "F-1", "C-4", "W12×26") */
structMark?: string | null
/** Structural entity type hint from query (e.g. "footing", "column") */
structEntityType?: 'footing' | 'column' | 'beam' | 'foundation_wall' | 'grid_line' | null
/** Grid reference extracted from query (e.g. "A-3", "B/3-4") */
structGrid?: string | null
/** Level extracted from structural query (e.g. "L1", "Level 2", "roof") */
structLevel?: string | null
/** MEP equipment tag (e.g. "LP-1", "AHU-1", "T-1") */
mepTag?: string | null
/** MEP discipline hint from query */
mepDiscipline?: 'electrical' | 'mechanical' | 'plumbing' | null
/** Room for coordination queries */
coordRoom?: string | null
/** Level for coordination queries */
coordLevel?: string | null
```

---

### 3. `src/lib/chat/query-classifier.ts` — MODIFY

#### New QueryType values
```typescript
| 'struct_element_lookup'
| 'struct_area_scope'
| 'mep_element_lookup'
| 'mep_area_scope'
| 'trade_coordination'      // Phase 5B
| 'coordination_sequence'   // Phase 5B
| 'affected_area'           // Phase 5B
```

#### New QueryClassification fields
```typescript
// Structural routing extras
structMark?: string
structEntityType?: 'footing' | 'column' | 'beam' | 'foundation_wall' | 'grid_line'
structGrid?: string
structLevel?: string
// MEP routing extras
mepTag?: string
mepDiscipline?: 'electrical' | 'mechanical' | 'plumbing'
// Coordination routing extras (Phase 5B)
coordRoom?: string
coordLevel?: string
```

#### Pattern constants

```typescript
const STRUCTURAL_ELEMENT_PATTERNS = [
  /\b(footing|ftg)\s+[A-Z]?\d+[A-Z]?\b/i,        // "footing F-1", "ftg F2A"
  /\b(column|col)\s+[A-Z]?\d+[A-Z]?\b/i,          // "column C-4", "col 1A"
  /\b(beam|bm|girder)\s+[A-Z\d-]+\b/i,            // "beam W12×26", "bm L2"
  /\bfoundation\s+wall\s+[A-Z\d]+\b/i,
  /\bgrid\s+(?:line\s+)?[A-Z]\d*\b/i,             // "grid A", "grid line 3"
  /\bgrid\s+[A-Z]-\d+\b/i,                         // "grid A-3"
  /what\s+(?:is|are)\s+(?:at\s+)?grid\s+[A-Z]/i,
  /structural\s+(?:element|member|system)\s+/i,
  /load[\s-]bearing/i,
]

const STRUCTURAL_AREA_PATTERNS = [
  /structural\s+(?:system|layout|plan)\s+(?:on|at|for)\s+/i,
  /structural\s+(?:elements?|members?)\s+(?:on|at|in)\s+/i,
  /(?:foundation|framing)\s+(?:plan|layout)/i,
  /what(?:'?s?|\s+(?:is|are))\s+(?:the\s+)?structural\s+/i,
]

const MEP_ELEMENT_PATTERNS = [
  // Electrical
  /\bpanel\s+[A-Z]{0,3}[LP]?\d+[A-Z]?\b/i,        // "panel LP-1", "panel MDP"
  /\b(LP|MDP|MCC|DP|PP|EP)-?\d*[A-Z]?\b/,          // bare panel tag
  /\btransformer\s+T[-\s]?\d+[A-Z]?\b/i,
  /\b(xfmr|transformer)\s+/i,
  // Mechanical
  /\b(AHU|RTU|FCU|HVAC)\s*[-\s]?\d+[A-Z]?\b/i,    // "AHU-1", "RTU 2"
  /\b(VAV|VVT)\s*[-\s]?\d+[A-Z]?\b/i,              // "VAV-101"
  /\bair\s+handler\s+/i,
  /\b(EF|SF|RF)\s*-?\d+[A-Z]?\b/i,                 // exhaust fan, supply fan
  // Plumbing
  /\b(WC|WH|HB|DF|FD|CO)\s*-?\d+[A-Z]?\b/i,       // plumbing tag patterns
  /\bwater\s+heater\s+/i,
  /\bfloor\s+drain\s+/i,
  /\bcleanout\s+/i,
]

const MEP_AREA_PATTERNS = [
  /what\s+(?:mep|mechanical|electrical|plumbing)\s+(?:is|are)\s+in\s+/i,
  /(?:mep|mechanical|electrical|plumbing)\s+(?:systems?|equipment)\s+in\s+(?:room|level)\s+/i,
  /what\s+(?:mep|m\/e\/p)\s+(?:runs?|services?|feeds?)\s+/i,
  /(?:electrical|mechanical|plumbing)\s+in\s+this\s+(?:room|space|area)/i,
]

// Phase 5B
const COORDINATION_PATTERNS = [
  /what\s+trades?\s+(?:touch|work\s+in|are\s+in)\s+/i,
  /which\s+trades?\s+(?:touch|work\s+in|are\s+present)\s+/i,
  /what\s+systems?\s+(?:touch|are\s+in|run\s+through)\s+/i,
  /what\s+(?:could\s+)?hold\s+(?:this|the)\s+work\s+up/i,
  /what\s+(?:needs?\s+to\s+be|should\s+be)\s+coordinated/i,
  /what\s+should\s+be\s+(?:done|completed)\s+before\s+starting/i,
  /what\s+(?:dependencies|constraints)\s+(?:exist|are\s+there)/i,
  /coordinate\s+before\s+/i,
  /what\s+(?:systems?|work)\s+(?:is|are)\s+affected\s+(?:in|on)\s+/i,
  /what\s+(?:affects|impacts)\s+(?:this|the)\s+(?:room|level|area)/i,
  /what\s+(?:is|are)\s+(?:going\s+on\s+in|happening\s+in)\s+(?:room|level|area)/i,
]

const COORDINATION_SEQUENCE_PATTERNS = [
  /what\s+could\s+hold\s+(?:this|the)\s+work\s+up/i,
  /what\s+(?:needs?\s+to\s+be|should\s+be)\s+coordinated\s+(?:before|first)/i,
  /what\s+should\s+(?:happen|be\s+done)\s+(?:before|first)/i,
  /(?:pre\s*-?\s*construction|pre\s*-?\s*work)\s+(?:coordination|checklist)/i,
  /coordination\s+(?:checklist|requirements|issues?)/i,
]

const AFFECTED_AREA_PATTERNS = [
  /what\s+(?:systems?|work)\s+(?:is|are)\s+affected\s+(?:on|in)/i,
  /what\s+(?:is|are)\s+(?:involved|present|going\s+on)\s+(?:on|in|at)\s+(?:level|room|area)/i,
  /what\s+(?:disciplines?|trades?)\s+are\s+on\s+(?:level|this\s+floor)/i,
]
```

#### Extractor helpers

```typescript
function extractStructMark(query: string): {
  mark: string | null
  entityType: 'footing' | 'column' | 'beam' | 'foundation_wall' | 'grid_line' | null
}

function extractStructGrid(query: string): string | null
// Patterns: "Grid A-3", "grid A", "at A/3", "grid B-C/3-4"

function extractStructLevel(query: string): string | null
// Patterns: "Level 1", "L1", "floor 2", "roof level"

function extractMEPTag(query: string): {
  tag: string | null
  discipline: 'electrical' | 'mechanical' | 'plumbing' | null
}

function extractCoordRoom(query: string): string | null
// Reuses arch extractArchRoom() pattern — same format

function extractCoordLevel(query: string): string | null
// Reuses extractDemoLevel() pattern
```

#### Classification priority

```
1. quantity / location / specification / detail / reference (existing)
2. project_summary (existing)
3. utility_crossing (existing)
4. demo_constraint (existing)
5. demo_scope (existing)
6. arch_schedule_query (existing)
7. arch_element_lookup (existing)
8. arch_room_scope (existing)
9. coordination_sequence  ← NEW (Phase 5B — check before general coordination)
10. affected_area          ← NEW (Phase 5B)
11. trade_coordination     ← NEW (Phase 5B)
12. struct_element_lookup  ← NEW (Phase 5A)
13. struct_area_scope      ← NEW (Phase 5A)
14. mep_element_lookup     ← NEW (Phase 5A)
15. mep_area_scope         ← NEW (Phase 5A)
16. general (default)
```

---

### 4. `src/lib/chat/query-analyzer.ts` — MODIFY

In `mapToAnswerMode()`:
```typescript
case 'struct_element_lookup':    return 'struct_element_lookup'
case 'struct_area_scope':        return 'struct_area_scope'
case 'mep_element_lookup':       return 'mep_element_lookup'
case 'mep_area_scope':           return 'mep_area_scope'
case 'trade_coordination':       return 'trade_coordination'
case 'coordination_sequence':    return 'coordination_sequence'
case 'affected_area':            return 'affected_area'
```

In `_routing` construction:
```typescript
structMark:       effectiveClassification.structMark       ?? null,
structEntityType: effectiveClassification.structEntityType ?? null,
structGrid:       effectiveClassification.structGrid       ?? null,
structLevel:      effectiveClassification.structLevel      ?? null,
mepTag:           effectiveClassification.mepTag           ?? null,
mepDiscipline:    effectiveClassification.mepDiscipline    ?? null,
coordRoom:        effectiveClassification.coordRoom        ?? null,
coordLevel:       effectiveClassification.coordLevel       ?? null,
```

In `buildPreferredSources()`:
- Structural + MEP modes prefer `['vision_db', 'vector_search']`
- Coordination modes prefer `['vision_db', 'vector_search']`

---

### 5. `src/lib/chat/structural-queries.ts` — NEW

```typescript
/**
 * Query the entity graph for structural entities.
 * discipline = 'structural'
 */

export async function queryStructuralElement(
  projectId: string,
  mark: string,
  entityType?: 'footing' | 'column' | 'beam' | 'foundation_wall' | 'grid_line' | null
): Promise<StructuralQueryResult>

export async function queryStructuralByArea(
  projectId: string,
  gridRef?: string | null,
  level?: string | null
): Promise<StructuralQueryResult>

export function formatStructuralElementAnswer(result: StructuralQueryResult): string
export function formatStructuralAreaAnswer(result: StructuralQueryResult): string
```

**Mark matching strategy** — same normalized label match as arch:
```sql
UPPER(REGEXP_REPLACE(pe.label, '[^A-Z0-9]', '', 'g'))
  = UPPER(REGEXP_REPLACE($mark, '[^A-Z0-9]', '', 'g'))
```
Optional `entity_type` filter applied when the extractor identified the structural type.

**Grid matching:** Normalized as `UPPER(REGEXP_REPLACE(grid_ref, '[^A-Z0-9/]', '', 'g'))` for fuzzy match against `entity_locations.grid_ref`.

---

### 6. `src/lib/chat/mep-queries.ts` — NEW

```typescript
/**
 * Query the entity graph for MEP entities.
 * discipline = 'mep'
 */

// Determine trade from entity_type at query time
function classifyMEPTrade(entityType: string): 'electrical' | 'mechanical' | 'plumbing' | 'unknown'
// electrical: panel, transformer, electrical_fixture, conduit, schedule_entry(panel)
// mechanical: air_handler, vav_box, diffuser, duct_run, mechanical_equipment
// plumbing:   plumbing_fixture, floor_drain, cleanout, piping_segment, plumbing_equipment

export async function queryMEPElement(
  projectId: string,
  tag: string,
  discipline?: 'electrical' | 'mechanical' | 'plumbing' | null
): Promise<MEPQueryResult>

export async function queryMEPByArea(
  projectId: string,
  roomFilter?: string | null,
  levelFilter?: string | null,
  disciplineFilter?: 'electrical' | 'mechanical' | 'plumbing' | null
): Promise<MEPQueryResult>

export function formatMEPElementAnswer(result: MEPQueryResult): string
export function formatMEPAreaAnswer(result: MEPQueryResult): string

// Schedule entry linkage — same described_by pattern as arch
async function fetchScheduleEntryForMEPEntity(
  projectId: string,
  entityId: string
): Promise<MEPScheduleEntry | null>
```

---

### 7. `src/lib/chat/coordination-queries.ts` — NEW (Phase 5B)

```typescript
/**
 * Cross-discipline coordination queries.
 *
 * These queries anchor on room_number + level from entity_locations
 * and return discipline-grouped counts and representative entities.
 *
 * No geometry is involved. This is a count-by-discipline-per-room lookup.
 */

// All disciplines present in a room (and representative entities per discipline)
export async function queryTradesInRoom(
  projectId: string,
  roomNumber: string
): Promise<CoordinationQueryResult>

// Cross-discipline coordination constraints for a room/level
// Returns entities with coordination_note findings + demo context
export async function queryCoordinationConstraints(
  projectId: string,
  roomFilter?: string | null,
  levelFilter?: string | null
): Promise<CoordinationQueryResult>

// What systems are present across all disciplines in a room/level
export async function queryAffectedArea(
  projectId: string,
  roomFilter?: string | null,
  levelFilter?: string | null
): Promise<CoordinationQueryResult>

export function formatTradeCoordinationAnswer(result: CoordinationQueryResult): string
export function formatCoordinationSequenceAnswer(result: CoordinationQueryResult): string
export function formatAffectedAreaAnswer(result: CoordinationQueryResult): string
```

**Core query pattern for coordination:**
```sql
SELECT
  pe.discipline,
  pe.entity_type,
  pe.label,
  pe.status,
  el.room_number,
  el.level
FROM project_entities pe
JOIN entity_locations el ON pe.id = el.entity_id AND pe.project_id = el.project_id
WHERE pe.project_id = $1
  AND ($2::TEXT IS NULL OR el.room_number = $2)
  AND ($3::TEXT IS NULL OR el.level      = $3)
ORDER BY pe.discipline, pe.entity_type
LIMIT 200
```

Results are grouped by discipline in TypeScript. No server-side aggregation needed at these entity counts.

---

### 8. `src/lib/chat/retrieval-orchestrator.ts` — MODIFY

**New retrieval steps** (inserted between arch graph step 2.75 and smart router step 3):

```typescript
// Step 2.8: Structural graph queries
if (
  items.length === 0 &&
  (analysis.answerMode === 'struct_element_lookup' ||
   analysis.answerMode === 'struct_area_scope')
) {
  const structItem = await attemptStructuralGraphLookup(analysis, projectId)
  if (structItem) {
    items.push(structItem)
    retrievalMethod = 'structural_graph'
  }
}

// Step 2.85: MEP graph queries
if (
  items.length === 0 &&
  (analysis.answerMode === 'mep_element_lookup' ||
   analysis.answerMode === 'mep_area_scope')
) {
  const mepItem = await attemptMEPGraphLookup(analysis, projectId)
  if (mepItem) {
    items.push(mepItem)
    retrievalMethod = 'mep_graph'
  }
}

// Step 2.9: Coordination graph queries (Phase 5B)
if (
  items.length === 0 &&
  (analysis.answerMode === 'trade_coordination'      ||
   analysis.answerMode === 'coordination_sequence'   ||
   analysis.answerMode === 'affected_area')
) {
  const coordItem = await attemptCoordinationGraphLookup(analysis, projectId)
  if (coordItem) {
    items.push(coordItem)
    retrievalMethod = 'coordination_graph'
  }
}
```

Add to `shouldAttemptLivePDF()`:
```typescript
'struct_element_lookup', 'struct_area_scope',
'mep_element_lookup', 'mep_area_scope',
'trade_coordination', 'coordination_sequence', 'affected_area',
```

Add to `selectRelevantSheets()` patterns:
```typescript
{ test: /structural|foundation|framing|footing|column|beam/i,
  filePattern: /^s[-_]?\d|struct/i },
{ test: /mechanical|hvac|ahu|vav|duct/i,
  filePattern: /^m[-_]?\d|mech/i },
{ test: /electrical|panel|circuit|elec/i,
  filePattern: /^e[-_]?\d|elec|power/i },
{ test: /plumbing|drain|fixture|sanitary/i,
  filePattern: /^p[-_]?\d|plumb/i },
```

---

### 9. `src/lib/chat/reasoning-engine.ts` — MODIFY

#### selectReasoningMode additions
```typescript
case 'struct_element_lookup':
  return 'struct_element_reasoning'

case 'struct_area_scope':
  return 'struct_area_reasoning'

case 'mep_element_lookup':
  return 'mep_element_reasoning'

case 'mep_area_scope':
  return 'mep_area_reasoning'

case 'trade_coordination':
  return 'trade_overlap_reasoning'

case 'coordination_sequence':
  return 'coordination_constraint_reasoning'

case 'affected_area':
  return 'affected_area_reasoning'
```

#### generateFindings additions
```typescript
case 'struct_element_reasoning':           return generateStructuralElementFindings(packet)
case 'struct_area_reasoning':              return generateStructuralAreaFindings(packet)
case 'mep_element_reasoning':              return generateMEPElementFindings(packet)
case 'mep_area_reasoning':                 return generateMEPAreaFindings(packet)
case 'trade_overlap_reasoning':            return generateTradeOverlapFindings(packet)
case 'coordination_constraint_reasoning':  return generateCoordinationConstraintFindings(packet)
case 'affected_area_reasoning':            return generateAffectedAreaFindings(packet)
```

#### generateStructuralElementFindings(packet)
- `vision_db` items → `explicit` (mark, grid, material, dimension findings)
- `vector_search` items with structural language → `inferred`
- Standard inferred notes:
  - Any `load_bearing` finding present → add caution: "Large penetrations through this member require structural engineer review"
  - Grid line entity → add inferred note: "Grid reference establishes coordinate system for all disciplines — confirm grid consistency across structural, architectural, and MEP drawings"

#### generateStructuralAreaFindings(packet)
- `vision_db` items → `explicit` grouped by entity_type
- Standard inferred note (always): "Structural layout controls MEP routing paths — confirm large duct/pipe penetrations through structural elements are coordinated with structural engineer"

#### generateMEPElementFindings(packet)
- `vision_db` items → `explicit` (tag, equipment data, capacity, circuit_ref findings)
- `vector_search` items → `inferred`
- Standard inferred notes:
  - Panel entity: "Confirm panel has spare capacity before adding new circuits"
  - AHU/RTU entity: "Confirm duct connections and clearances match architectural reflected ceiling plan"

#### generateMEPAreaFindings(packet)
- `vision_db` items → `explicit` grouped by trade (electrical / mechanical / plumbing)
- `vector_search` items with MEP language → `inferred`
- Standard inferred note: "Coordinate MEP rough-in sequence: rough plumbing → rough mechanical duct → rough electrical before any above-ceiling work is concealed"

#### generateTradeOverlapFindings(packet) — Phase 5B

```typescript
// Data: vision_db item contains pre-formatted TradePresence data from coordination-queries.ts
// Extract per-discipline sections and tag them explicit
// Add standard coordination cautions based on discipline combinations present

const STANDARD_COORDINATION_CAUTIONS: Array<{
  trigger: (tradesPresent: string[]) => boolean
  statement: string
}> = [
  {
    trigger: trades => trades.includes('demo') && trades.some(t => ['electrical','mechanical','plumbing'].includes(t)),
    statement: 'MEP systems serving areas being demolished must be isolated and abandoned per code before demo starts. Confirm scope of abandonment with MEP engineer.',
  },
  {
    trigger: trades => trades.includes('mechanical') && trades.includes('electrical'),
    statement: 'Mechanical equipment in this space requires electrical connections — coordinate panel capacity, circuit sizing, and disconnect locations with both mechanical and electrical contractors.',
  },
  {
    trigger: trades => trades.includes('plumbing') && trades.includes('mechanical'),
    statement: 'Plumbing and mechanical rough-in share above-ceiling space — confirm elevation coordination to avoid conflicts at duct crossings.',
  },
  {
    trigger: trades => trades.includes('structural') && trades.some(t => ['mechanical','plumbing'].includes(t)),
    statement: 'Large duct or pipe penetrations through structural elements require openings to be shown on structural drawings and reviewed by structural engineer.',
  },
  {
    trigger: trades => trades.includes('architectural') && trades.includes('mechanical'),
    statement: 'Confirm ACT ceiling type for this room — if plenum return air is used, mechanical contractor must verify plenum rating before running any materials above ceiling.',
  },
  {
    trigger: trades => trades.includes('demo') && trades.includes('structural'),
    statement: 'Confirm any walls or elements in demo scope are not load-bearing. Structural engineer must review before removal.',
  },
]
```

Support level: all standard cautions are `inferred` unless a `coordination_note` finding in the evidence explicitly documents the caution.

#### generateCoordinationConstraintFindings(packet) — Phase 5B
- Extract entities with `to_remain` status from demo discipline → explicit "what stays" findings
- Extract entities with `coordination_note` findings from any discipline → explicit constraints
- Apply relevant STANDARD_COORDINATION_CAUTIONS based on disciplines present → inferred

#### generateAffectedAreaFindings(packet) — Phase 5B
- All disciplines present, grouped → explicit (from vision_db)
- Add per-discipline status summary (new/existing/unknown counts)
- Apply STANDARD_COORDINATION_CAUTIONS for present discipline combination

#### identifyGaps additions
```typescript
// Structural-specific
if (['struct_element_lookup', 'struct_area_scope'].includes(analysis.answerMode)) {
  if (!packet.items.some(i => i.source === 'vision_db')) {
    gaps.push({
      description: 'No structural entities extracted — structural plan sheets may not have been processed',
      gapType: 'insufficient_structured_data',
      actionable: 'Process structural sheets (S-xxx) using the Analyze function',
    })
  }
}

// MEP-specific
if (['mep_element_lookup', 'mep_area_scope'].includes(analysis.answerMode)) {
  if (!packet.items.some(i => i.source === 'vision_db')) {
    gaps.push({
      description: 'No MEP entities extracted — mechanical, electrical, or plumbing sheets may not have been processed',
      gapType: 'insufficient_structured_data',
      actionable: 'Process MEP sheets (M-xxx, E-xxx, P-xxx) using the Analyze function',
    })
  }
}

// Coordination-specific
if (['trade_coordination', 'coordination_sequence', 'affected_area'].includes(analysis.answerMode)) {
  const disciplines = extractDisciplinesFromCoordination(packet)
  const missing = ['architectural', 'structural', 'mep'].filter(d => !disciplines.includes(d))
  if (missing.length > 0) {
    gaps.push({
      description: `Coordination answer is incomplete — ${missing.join(', ')} sheets have not been processed`,
      gapType: 'incomplete_system_coverage',
      actionable: `Process remaining discipline sheets to enable complete coordination answers`,
    })
  }
}
```

#### selectAnswerFrame additions
```typescript
case 'struct_element_reasoning':
  return hasExplicit ? 'structural_element_cited' : 'structural_element_partial'
case 'struct_area_reasoning':
  return hasExplicit ? 'structural_area_cited' : 'structural_area_partial'
case 'mep_element_reasoning':
  return hasExplicit ? 'mep_element_with_schedule' : 'mep_element_partial'
case 'mep_area_reasoning':
  return hasExplicit ? 'mep_area_by_trade' : 'mep_area_partial'
case 'trade_overlap_reasoning':
  return hasExplicit ? 'trade_overlap_multi_discipline' : 'trade_overlap_partial'
case 'coordination_constraint_reasoning':
  return hasExplicit ? 'coordination_documented' : 'coordination_inferred'
case 'affected_area_reasoning':
  return hasExplicit ? 'affected_area_multi_discipline' : 'affected_area_partial'
```

---

### 10. `src/lib/vision/structural-extractor.ts` — NEW

```typescript
export type StructuralSheetType =
  | 'structural_foundation_plan'
  | 'structural_framing_plan'
  | 'structural_notes'
  | 'structural_detail'
  | null

export const STRUCTURAL_SHEET_PATTERNS: Record<NonNullable<StructuralSheetType>, RegExp[]>
export const STRUCTURAL_SHEET_NUMBER_PREFIXES: RegExp  // /^S[-_]?\d/i
export function classifyStructuralSheet(title: string, sheetNumber: string): StructuralSheetType

export const STRUCTURAL_ENTITY_PATTERNS: Record<string, RegExp[]>
export function detectStructuralEntityType(text: string): string
export function detectStructuralEntitySubtype(entityType: string, text: string): string | null

export function extractStructuralMarkFromText(text: string): {
  mark: string | null
  entityType: 'footing' | 'column' | 'beam' | 'foundation_wall' | 'grid_line' | 'structural_opening' | null
}

export function buildStructuralCanonicalName(params: {
  entityType: string
  mark?: string | null
  sheetNumber?: string | null
  entityId: string
}): string

export const STRUCTURAL_FOUNDATION_EXTRACTION_PROMPT: string
// Focus: footing marks, column marks, grid lines, foundation wall labels,
//        bearing elevations, slab thickness notes. Prefer explicit labels.
//        Do NOT infer structural grades or load values.

export const STRUCTURAL_FRAMING_EXTRACTION_PROMPT: string
// Focus: column marks, beam marks (with size), structural openings,
//        grid line labels, level designators.
//        Do NOT infer connection types or load paths.

export const STRUCTURAL_EXTRACTION_SYSTEM_CONTEXT: string
// Domain context: "You are extracting structural entity data from construction
// drawings. Focus on labeled marks and tags only. Do not estimate member sizes
// or structural capacity. Do not infer load paths beyond what is explicitly labeled."
```

---

### 11. `src/lib/vision/mep-extractor.ts` — NEW

```typescript
export type MEPSheetType =
  | 'mechanical_floor_plan'
  | 'electrical_power_plan'
  | 'electrical_lighting_plan'
  | 'plumbing_plan'
  | 'equipment_schedule'
  | 'panel_schedule'
  | 'one_line_diagram'
  | null

export const MEP_SHEET_PATTERNS: Record<NonNullable<MEPSheetType>, RegExp[]>
export const MEP_SHEET_NUMBER_PREFIXES: RegExp   // /^[MEP][-_]?\d/i
export function classifyMEPSheet(title: string, sheetNumber: string): MEPSheetType

export function detectMEPEntityType(text: string, sheetType: MEPSheetType): string
// Returns entity_type from the MEP vocabulary above

export function detectMEPTrade(entityType: string): 'electrical' | 'mechanical' | 'plumbing' | 'unknown'
// Pure function: maps entity_type → trade — no sheet context needed

export function extractMEPTagFromText(text: string): {
  tag: string | null
  entityType: string | null
  discipline: 'electrical' | 'mechanical' | 'plumbing' | null
}

export function buildMEPCanonicalName(params: {
  entityType: string
  tag?: string | null
  sheetNumber?: string | null
  entityId: string
}): string

export const MECHANICAL_EXTRACTION_PROMPT: string
// Focus: equipment tags (AHU-1, VAV-101), duct sizes, air device tags,
//        room locations, level designators.
//        Do NOT estimate CFM from duct sizes.

export const ELECTRICAL_EXTRACTION_PROMPT: string
// Focus: panel tags (LP-1, MDP), transformer tags, circuit labels,
//        fixture tags, room locations.
//        For one-line diagrams: extract panel/transformer tags and voltage levels only.
//        Do NOT trace circuit connectivity graphs.

export const PLUMBING_EXTRACTION_PROMPT: string
// Focus: fixture tags (WC-1, L-3), floor drain tags (FD-1), cleanout tags,
//        pipe size labels, room locations.
//        Do NOT estimate flow rates or pipe velocities.

export const MEP_EXTRACTION_SYSTEM_CONTEXT: string
// Domain context: "You are extracting MEP entity data from construction drawings.
// Focus on labeled equipment tags and room locations. Do not infer system capacity,
// code compliance, or load calculations."
```

---

### 12. `src/lib/chat/coordination-validator.ts` — NEW

```typescript
export interface CoordinationValidationReport {
  projectId: string
  timestamp: string
  passed: number
  failed: number
  tests: Array<{
    name: string
    passed: boolean
    message: string
    count?: number
  }>
}

export async function runCoordinationValidation(
  projectId: string
): Promise<CoordinationValidationReport>
// Tests (8):
// 1. structural_entities_exist      — COUNT > 0 WHERE discipline='structural'
// 2. mep_entities_exist             — COUNT > 0 WHERE discipline='mep'
// 3. struct_location_coverage       — ≥ 60% of structural entities have a location
// 4. mep_location_coverage          — ≥ 60% of MEP entities have a location
// 5. mep_trade_variety              — at least 2 of the 3 MEP trades present
// 6. cross_discipline_rooms         — ≥ 1 room_number shared by ≥ 2 disciplines
// 7. panel_schedule_parsed          — ≥ 1 panel schedule_entry entity with schedule_row finding
// 8. coordination_notes_present     — ≥ 1 coordination_note finding across any discipline

export function formatCoordinationValidationReport(
  report: CoordinationValidationReport
): string
```

---

## Example Outputs

### "What trades touch Room 105?"

```
From architectural floor plan A-201, electrical plan E-101, mechanical plan M-101,
and demo plan DM-101 (explicit, 4 disciplines):

DISCIPLINES IN ROOM 105 — Conference Room:

ARCHITECTURAL (explicit):
• Doors: D-14 (HM single), D-15 (HM single) — hollow metal frame, HW-4 hardware
• Windows: W-3A, W-3B (fixed glazing)
• Wall type WT-B on north — rated assembly
• Finishes: CPT-2 / PT-1 / ACT-1 at 9'-0"

MECHANICAL (explicit):
• AHU-1 supply duct (12"×8") enters from north — Supply diffuser DIFF-105A, DIFF-105B
• VAV-105 box — single duct, 400 CFM per mechanical plan M-101

ELECTRICAL (explicit):
• (2) duplex receptacles fed from LP-1, circuits 7/9
• Dimmer switch — lighting control from EP-2

DEMO (explicit, from DM-101):
• Existing wall on east side: to_remove
• Existing ceiling tile: to_remove
• Column at Grid B-5: to_remain

---
Inferred coordination notes:
• ACT ceiling in this room — confirm plenum rating before concealing any above-ceiling
  work (mechanical and electrical). Not explicitly documented in these sheets.
• Rated wall WT-B — any penetrations require fire stopping. Coordinate with MEP
  for conduit and duct sleeve locations before framing.
• MEP systems (VAV-105, circuits 7/9) may serve this room while adjacent demo
  work proceeds — confirm isolation plan with MEP engineer before demo starts.

Information gaps:
• Structural sheets (S-xxx) not yet analyzed — structural elements in this room not confirmed.
• Plumbing sheets (P-xxx) not yet analyzed — plumbing fixtures and drain locations unknown.
```

---

### "What could hold this work up?"

```
From demo plan DM-101, architectural floor plan A-201, and mechanical plan M-101
(cross-discipline, explicit + inferred):

KNOWN DEPENDENCIES (explicit, from drawings):

Demo scope:
• East wall (to_remove) — verify not load-bearing before demo [from DM-101]
• Existing ACT ceiling (to_remove) — active VAV-105 system runs above ceiling [from M-101]
  → VAV and duct runs must be rerouted or capped before ceiling demo

Coordination constraints (explicit from drawing notes):
• Keynote 12 (A-201): "Provide blocking for future AV mounting" — requires
  coordination with electrical for conduit rough-in before framing closes

---
STANDARD CAUTIONS (inferred — not explicitly documented in these drawings):

• MEP isolation before demo: Systems serving the demo area (VAV-105, circuits 7/9)
  must be isolated and abandoned per code before demolition starts.
  Confirm scope with MEP engineer.
• Hazardous materials survey: Verify ACM/LBP survey is complete before
  disturbing ceiling tiles, wall finishes, or mastic.
• Rated wall WT-B: If WT-B is in or adjacent to the demo scope, confirm
  no fire-rated barrier is being removed without temporary protection in place.
• Structural review: Confirm structural engineer has reviewed east wall removal.
  Load path through this area not established from available sheets.

Information gaps:
• Structural sheets (S-xxx) not analyzed — cannot confirm load-bearing status of east wall.
• Plumbing sheets (P-xxx) not analyzed — drain and pipe scope in demo area unknown.
• No hazmat survey document found in project set.
```

---

### "What systems are affected on Level 1?"

```
From architectural (A-201), mechanical (M-101, M-102), electrical (E-101), and
demo (DM-101) sheets (explicit):

LEVEL 1 — DISCIPLINES PRESENT:

ARCHITECTURAL: 3 rooms, 8 doors, 5 windows, room finish schedule data
• Rooms: 105 (Conference), 106 (Office), 110 (Restroom)

MECHANICAL: 1 AHU, 4 VAV boxes, 6 supply diffusers
• AHU-1 serves all Level 1 spaces
• VAV-105 (400 CFM), VAV-106 (200 CFM), VAV-110 (150 CFM)

ELECTRICAL: 1 panel (LP-1), 12 circuits, 8 fixtures/devices
• LP-1 — Level 1 branch panel, 200A, (4 spare circuits)

DEMO: 2 walls to_remove, 1 ceiling to_remove, 2 elements to_remain
• East wall of Room 105: to_remove
• Existing ACT ceiling Room 105: to_remove
• Column at Grid B-5, Room 105: to_remain

---
Inferred:
• AHU-1 serves the entire Level 1 — any significant demo or construction
  that blocks AHU access or ductwork must be coordinated to avoid disrupting
  all Level 1 spaces.
• LP-1 likely serves Level 1 lighting and power — confirm with electrical
  contractor that panel remains accessible and live during construction.

Information gaps:
• Structural sheets (S-xxx) not analyzed — structural elements on Level 1 not mapped.
• Plumbing sheets (P-xxx) not analyzed — plumbing fixtures and drain scope unknown.
```

---

## What Does NOT Change

- Utility pipeline — untouched
- Demo pipeline — untouched
- Architectural pipeline — untouched
- `project_quantities`, `utility_termination_points`, `utility_crossings` — untouched
- All existing SQL functions, views, indexes — untouched
- `graph-queries.ts`, `demo-queries.ts`, `arch-queries.ts` — untouched
- `smart-router.ts` — untouched
- All existing answer modes and reasoning modes — untouched
- `requirement_lookup` remains unsupported

---

## Design Constraints Preserved

1. All responses are streaming — no non-streaming structural/MEP/coordination paths
2. Conversation history always preserved
3. Support levels are deterministic TypeScript — model never reassigns them
4. Reasoning engine is pure TypeScript — no new LLM calls in reasoning layer
5. Insufficient evidence fails honestly at evidence-evaluator
6. Universal entity model absorbs all structural and MEP data — no discipline-specific tables
7. Coordination reasoning is additive and non-destructive — does not replace discipline-specific reasoning
8. No BIM-grade clash detection, no geometry comparison, no load calculations
9. Grid line entities are not geometry — they are labels stored as text
10. Standard cautions are always tagged `inferred` — never upgraded to `explicit` without a matching finding
11. Unsupported implications (full load flow, code compliance, seismic analysis) are flagged as gaps

---

## Implementation Checklist

### Migration

- [ ] `supabase/migrations/00042_structural_mep_entity_schema.sql`
  - [ ] Extend `entity_findings.finding_type` CHECK: add `'load_bearing'`, `'capacity'`, `'equipment_tag'`, `'circuit_ref'`, `'coordination_note'`
  - [ ] Extend `entity_relationships.relationship_type` CHECK: add `'supports'`, `'served_by'`
  - [ ] `idx_entities_structural`
  - [ ] `idx_entities_mep`
  - [ ] `idx_entities_mep_type`
  - [ ] `idx_entities_structural_label`
  - [ ] `idx_entities_mep_label`
  - [ ] `idx_findings_capacity`
  - [ ] `idx_findings_equipment_tag`
  - [ ] `idx_location_room_discipline` on entity_locations

### Types — `src/lib/chat/types.ts`

- [ ] 7 new AnswerMode values (5A: 4, 5B: 3)
- [ ] 7 new ReasoningMode values
- [ ] StructuralFinding, StructuralEntity, StructuralQueryResult interfaces
- [ ] MEPFinding, MEPEntity, MEPScheduleEntry, MEPQueryResult interfaces
- [ ] TradePresence, CoordinationQueryResult interfaces (5B)
- [ ] 8 new _routing fields

### Query Classifier — `src/lib/chat/query-classifier.ts`

- [ ] 7 new QueryType values
- [ ] STRUCTURAL_ELEMENT_PATTERNS, STRUCTURAL_AREA_PATTERNS
- [ ] MEP_ELEMENT_PATTERNS, MEP_AREA_PATTERNS
- [ ] COORDINATION_PATTERNS, COORDINATION_SEQUENCE_PATTERNS, AFFECTED_AREA_PATTERNS
- [ ] extractStructMark(), extractStructGrid(), extractStructLevel()
- [ ] extractMEPTag(), extractCoordRoom(), extractCoordLevel()
- [ ] Classification priority ordering (structural/MEP after arch, coordination before structural)

### Query Analyzer — `src/lib/chat/query-analyzer.ts`

- [ ] 7 new mode mappings in mapToAnswerMode()
- [ ] 8 new routing fields propagated
- [ ] Preferred sources for all new modes

### Structural Queries — `src/lib/chat/structural-queries.ts` (NEW)

- [ ] queryStructuralElement() — mark match + entity_type filter
- [ ] queryStructuralByArea() — grid/level filter
- [ ] formatStructuralElementAnswer()
- [ ] formatStructuralAreaAnswer()

### MEP Queries — `src/lib/chat/mep-queries.ts` (NEW)

- [ ] classifyMEPTrade() — entity_type → trade
- [ ] queryMEPElement() — tag match + discipline filter
- [ ] queryMEPByArea() — room/level/discipline filter
- [ ] fetchScheduleEntryForMEPEntity() — described_by linkage
- [ ] formatMEPElementAnswer()
- [ ] formatMEPAreaAnswer()

### Coordination Queries — `src/lib/chat/coordination-queries.ts` (NEW, Phase 5B)

- [ ] queryTradesInRoom() — cross-discipline room query
- [ ] queryCoordinationConstraints() — coordination_note findings
- [ ] queryAffectedArea() — all disciplines in room/level
- [ ] formatTradeCoordinationAnswer()
- [ ] formatCoordinationSequenceAnswer()
- [ ] formatAffectedAreaAnswer()

### Retrieval — `src/lib/chat/retrieval-orchestrator.ts`

- [ ] Import from structural-queries, mep-queries, coordination-queries
- [ ] Step 2.8: attemptStructuralGraphLookup()
- [ ] Step 2.85: attemptMEPGraphLookup()
- [ ] Step 2.9: attemptCoordinationGraphLookup() (Phase 5B)
- [ ] New modes → shouldAttemptLivePDF()
- [ ] New sheet patterns → selectRelevantSheets()

### Reasoning — `src/lib/chat/reasoning-engine.ts`

- [ ] selectReasoningMode: 7 new cases
- [ ] generateFindings: 7 new cases
- [ ] generateStructuralElementFindings(), generateStructuralAreaFindings()
- [ ] generateMEPElementFindings(), generateMEPAreaFindings()
- [ ] generateTradeOverlapFindings() with STANDARD_COORDINATION_CAUTIONS
- [ ] generateCoordinationConstraintFindings()
- [ ] generateAffectedAreaFindings()
- [ ] identifyGaps: structural/MEP/coordination gap detection
- [ ] selectAnswerFrame: 7 new frames
- [ ] extractDisciplinesFromCoordination() helper

### Vision Extractors

- [ ] `src/lib/vision/structural-extractor.ts` (NEW)
  - [ ] classifyStructuralSheet()
  - [ ] STRUCTURAL_ENTITY_PATTERNS, detectStructuralEntityType/Subtype()
  - [ ] extractStructuralMarkFromText(), buildStructuralCanonicalName()
  - [ ] STRUCTURAL_FOUNDATION_EXTRACTION_PROMPT
  - [ ] STRUCTURAL_FRAMING_EXTRACTION_PROMPT
  - [ ] STRUCTURAL_EXTRACTION_SYSTEM_CONTEXT
- [ ] `src/lib/vision/mep-extractor.ts` (NEW)
  - [ ] classifyMEPSheet()
  - [ ] detectMEPEntityType(), detectMEPTrade()
  - [ ] extractMEPTagFromText(), buildMEPCanonicalName()
  - [ ] MECHANICAL_EXTRACTION_PROMPT
  - [ ] ELECTRICAL_EXTRACTION_PROMPT
  - [ ] PLUMBING_EXTRACTION_PROMPT
  - [ ] MEP_EXTRACTION_SYSTEM_CONTEXT

### Validation Harness

- [ ] `src/lib/chat/coordination-validator.ts` (NEW)
  - [ ] runCoordinationValidation() — 8 tests
  - [ ] formatCoordinationValidationReport()

---

## Success Criteria

- [ ] Structural entities (footing, column, beam, grid line) are stored in the graph with location data
- [ ] MEP entities (panel, AHU, VAV, fixtures) are stored in the graph with trade classification
- [ ] Multi-discipline room query returns entities from ≥ 2 disciplines for a room that appears in multiple sheets
- [ ] "What trades touch Room 105?" returns per-discipline entity lists with citations
- [ ] "What could hold this work up?" returns explicit evidence from drawings + inferred cautions with clear labeling
- [ ] "What systems are affected on Level 1?" returns a discipline-grouped summary with gap notes
- [ ] All standard cautions are tagged `inferred` — none are tagged `explicit` without matching finding evidence
- [ ] TypeScript compilation passes with zero errors
- [ ] All existing utility/demo/arch answer modes produce identical results

---

## Constraints Summary

| Constraint | How it's enforced |
|---|---|
| No BIM-grade clash detection | Coordination queries use room/level text anchors only — no geometry |
| No code compliance | Finding types do not include code pass/fail values |
| No load calculations | Structural extraction prompts explicitly exclude load inference |
| No riser diagram tracing | One-line diagrams: panel and transformer tags only — no circuit graph |
| Standard cautions are inferred | Support level = 'inferred' hardcoded for all STANDARD_COORDINATION_CAUTIONS entries |
| Geometry precision is not overstated | All gap notes call out when location data is text-only |
| Universal entity model only | No new discipline-specific tables |
| Prior pipelines preserved | All existing answer/reasoning modes untouched |
