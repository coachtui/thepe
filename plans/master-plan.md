# PE Copilot — Master Architecture Plan

## Vision

Transform the assistant from a smart document lookup tool into a genuine PE copilot
that reasons about construction projects — separating what the drawings explicitly support,
what industry practice infers, and what is genuinely unknown.

The platform is evolving from a utility-plan assistant into a **multi-discipline construction
reasoning platform**. The Universal Entity Model is the shared foundation that absorbs
current utility data and supports future disciplines (demo, architectural, structural, MEP)
without schema fragmentation or rewrites.

---

## Full Pipeline (current — V1 Reasoning Layer)

```
POST /api/chat or /api/mobile/chat
  → chat-handler.ts:              handleChatRequest()
  → query-analyzer.ts:            analyzeQuery()         → QueryAnalysis
  → retrieval-orchestrator.ts:    retrieveEvidence()     → EvidencePacket
  → evidence-evaluator.ts:        evaluateSufficiency()  → SufficiencyResult
  → reasoning-engine.ts:          applyReasoning()       → ReasoningPacket
  → response-writer.ts:           writeResponse()        → streaming Response
```

---

## Core Reasoning Philosophy

### 1. Deterministic before generative
Support levels are assigned by the TypeScript pipeline, not by the model:
- `explicit`  — evidence from vision_db, direct_lookup, project_summary
- `inferred`  — evidence from vector_search, live_pdf_analysis, or construction practice rules
- `unknown`   — no evidence exists; a gap

The model narrates these findings. It does not re-classify them.

### 2. No new LLM dependency
The reasoning engine is a pure TypeScript transform. It consumes QueryAnalysis +
EvidencePacket + SufficiencyResult and emits a ReasoningPacket. Zero new LLM calls.

### 3. Sufficiency guardrails preserved
Insufficient evidence still fails at evidence-evaluator and returns an honest
"cannot answer" response. The reasoning engine only activates when evidence exists.

### 4. Unsupported domains stay unsupported
requirement_lookup / spec queries remain unsupported.

---

## Phase Roadmap

### Phase 1 — V1 Reasoning Layer ✓ (COMPLETE)
- Four reasoning modes (sequence, scope, quantity, constraint)
- Deterministic support level assignment from evidence source
- Standard construction sequence lookup tables
- Gap classification with actionable resolutions
- Response writer consumes ReasoningPacket

### Phase 2 — Universal Entity Model ✓ (COMPLETE)
Additive database layer. Zero rewrites. All existing tables remain authoritative.

Core tables:
- `project_entities` — unified entity record (any discipline, any type)
- `entity_locations` — multi-grammar location (station, grid, room, level, area, zone)
- `entity_relationships` — typed relationships between entities (crosses, feeds, demolishes…)
- `entity_citations` — structured citations pointing back to source documents
- `entity_findings` — derived findings per entity (quantity, material, risk, sequence hint…)

See **Universal Entity Model** section below for full design.

### Phase 3 — Demo-Plan Ingestion and Reasoning (CURRENT)
Focused domain expansion: demo sheet classification, demo entity extraction, demo-aware
retrieval, and reasoning modes for demolition scope and constraint questions.
The proving ground for multi-discipline reasoning beyond utility.

See `plans/current-phase.md` for full deliverables.

### Phase 4 — Extended Cross-Discipline Reasoning (future)
- Spec-aware reasoning (when spec pipeline exists)
- Multi-system conflict detection (demo scope conflicts with new utility route)
- Schedule / critical-path inference from schedule entities + sequence hints
- Cost-implication suggestions from quantity findings
- Architectural and MEP plan ingestion

### Phase 5 — Feedback Loop (future)
- Track which inferences were confirmed or refuted in field
- Project-specific sequence overrides from entity findings
- Confidence calibration from user corrections

---

## Universal Entity Model

### Design Principles

1. **Stable core, discipline-specific subtypes** — The five tables are discipline-agnostic.
   Discipline variation is encoded in `discipline`, `entity_type`, and `subtype` columns plus `metadata`.
2. **Additive-only migration** — No existing tables are dropped or altered.
   Legacy tables (`project_quantities`, `utility_termination_points`, `utility_crossings`)
   remain authoritative and are bridged via nullable FK columns.
3. **Postgres/Supabase native** — JSONB for extensibility; standard FKs; no graph DB required.
4. **Citation-first** — Every significant entity, relationship, and finding can be traced
   back to a source document excerpt.

---

### Table: `project_entities`

The universal entity record. One row per named thing on the project.

```
project_entities
├── id (PK)
├── project_id (FK → projects)
│
├── CLASSIFICATION
│   ├── discipline         'utility' | 'demo' | 'architectural' | 'structural' | 'mep' | 'schedule'
│   ├── entity_type        e.g. 'line', 'fitting', 'crossing', 'wall', 'door', 'room', 'schedule_entry'
│   └── subtype            e.g. 'water', 'sewer', 'storm', 'partition', 'load_bearing', 'hollow_metal'
│
├── NAMES
│   ├── canonical_name     stable machine ID: "WATER_LINE_A", "DOOR_D14", "WALL_104N"
│   ├── display_name       human label: "Water Line A", "Door D-14", "North Wall Room 104"
│   └── label              short drawing label: "WL-A", "D-14", "W-104N"
│
├── STATUS
│   └── status             'existing' | 'new' | 'to_remove' | 'to_relocate' |
│                          'to_protect' | 'to_remain' | 'temporary' | 'proposed'
│
├── QUALITY
│   ├── confidence         0.0–1.0
│   └── extraction_source  'vision' | 'text' | 'manual' | 'calculated'
│
├── PROVENANCE
│   ├── source_document_id (FK → documents)
│   └── source_chunk_id    (FK → document_chunks)
│
├── LEGACY BRIDGES (nullable — only set for rows migrated from old tables)
│   ├── legacy_quantity_id     (FK → project_quantities)
│   ├── legacy_termination_id  (FK → utility_termination_points)
│   └── legacy_crossing_id     (FK → utility_crossings)
│
└── metadata JSONB
```

**Discipline × entity_type vocabulary (starter set):**

| discipline     | entity_type       | subtype examples                                      |
|----------------|-------------------|-------------------------------------------------------|
| utility        | line              | water, sewer, storm, gas, electric, telecom, fiber    |
| utility        | fitting           | valve, manhole, cleanout, meter, hydrant, junction    |
| utility        | crossing          | (relationship via entity_relationships)               |
| utility        | structure         | vault, pump_station, catch_basin, headwall            |
| demo           | wall              | partition, load_bearing, curtain, shear               |
| demo           | floor             | slab, raised_floor, suspended                         |
| demo           | ceiling           | suspended, exposed, drop                              |
| demo           | equipment         | hvac_unit, plumbing_fixture, electrical_panel         |
| architectural  | room              | office, corridor, mechanical, restroom, stair         |
| architectural  | door              | hollow_metal, wood, glass, overhead                   |
| architectural  | window            | fixed, operable, curtainwall                          |
| architectural  | wall              | partition, exterior, shear                            |
| architectural  | keynote           | (any keynoted item on architectural sheets)           |
| schedule       | schedule_entry    | door, window, finish, equipment, hardware             |

---

### Table: `entity_locations`

Multi-grammar location model. One entity can have multiple locations (e.g. a utility line
that runs across multiple sheets, multiple stations, multiple levels).

```
entity_locations
├── id (PK)
├── entity_id (FK → project_entities)
├── project_id (FK → projects)
├── location_type  'station' | 'grid' | 'room' | 'level' | 'area' | 'zone' | 'detail_ref' | 'sheet_ref'
├── is_primary     boolean — one primary location per entity
│
├── STATION GRAMMAR
│   ├── station_value       "13+00"
│   ├── station_numeric     1300.00 (normalized for math)
│   ├── station_to          "36+00" (for ranges)
│   └── station_to_numeric  3600.00
│
├── GRID / ROOM GRAMMAR
│   ├── grid_ref            "B-5"
│   ├── room_number         "104"
│   ├── level               "L1", "B1", "Roof"
│   ├── area                "East Wing", "Parking Structure"
│   └── zone                "Zone A", "Sector 3"
│
├── REFERENCE GRAMMAR
│   ├── detail_ref          "A/4.3" (detail A on sheet 4.3)
│   ├── sheet_number        "C-201"
│   └── page_number         integer
│
└── description TEXT
```

---

### Table: `entity_relationships`

Typed directional relationships between entities. Replaces ad-hoc joining logic.

```
entity_relationships
├── id (PK)
├── project_id (FK → projects)
├── from_entity_id (FK → project_entities)
├── to_entity_id   (FK → project_entities)
├── relationship_type
│     'crosses' | 'located_in' | 'described_by' | 'governed_by' | 'applies_to'
│     'adjacent_to' | 'connects_to' | 'requires' | 'feeds' | 'demolishes'
│     'protects' | 'replaces' | 'ties_into' | 'precedes' | 'follows'
│
├── CROSSING CONTEXT (only when relationship_type = 'crosses')
│   ├── station         "5+23.50"
│   ├── station_numeric 523.50
│   └── elevation       35.73
│
├── confidence
├── extraction_source  'vision' | 'text' | 'manual' | 'inferred'
├── citation_id (FK → entity_citations)
└── metadata JSONB
```

**Relationship direction conventions:**

| Relationship    | from              | to                      | Example                              |
|-----------------|-------------------|-------------------------|--------------------------------------|
| crosses         | proposed utility  | existing utility        | Water Line A crosses Existing Telecom|
| located_in      | entity            | room/zone/area          | Door D-14 located_in Room 104        |
| described_by    | entity            | schedule entry          | Door D-14 described_by Sched Row D14 |
| governed_by     | entity            | spec section            | WL-A governed_by Spec 33 11 00       |
| applies_to      | keynote           | entity                  | Keynote 5 applies_to Wall W-104N     |
| demolishes      | demo action       | existing entity         | Demo Scope demolishes Wall W-104N    |
| protects        | protection note   | existing entity         | Note 3 protects Existing Gas Line    |
| feeds           | upstream utility  | downstream utility      | Water Main feeds Fire Hydrant FH-3   |
| connects_to     | line segment      | fitting/structure       | WL-A connects_to Valve V-12          |

---

### Table: `entity_citations`

Every important claim traces back here. Shared across entities, findings, and relationships.

```
entity_citations
├── id (PK)
├── project_id (FK → projects)
│
├── BELONGS TO (nullable — one populated per row)
│   ├── entity_id       (FK → project_entities)
│   ├── finding_id      (FK → entity_findings)
│   └── relationship_id (FK → entity_relationships)
│
├── SOURCE DOCUMENT
│   ├── document_id  (FK → documents)
│   └── chunk_id     (FK → document_chunks)
│
├── LOCATION IN DOCUMENT
│   ├── sheet_number  "C-201"
│   ├── page_number   integer
│   └── detail_ref    "A/4.3"
│
├── CONTENT
│   ├── excerpt  verbatim text or vision description
│   └── context  surrounding context
│
└── confidence / extraction_source
```

---

### Table: `entity_findings`

Derived facts about an entity. The "leaf nodes" that the reasoning engine and retrieval
layer surface to the writer.

```
entity_findings
├── id (PK)
├── project_id (FK → projects)
├── entity_id  (FK → project_entities)
│
├── FINDING CLASSIFICATION
│   └── finding_type
│         'quantity' | 'material' | 'requirement' | 'demo_scope' | 'crossing_count'
│         'sequence_hint' | 'risk_note' | 'dimension' | 'elevation' | 'specification_ref' | 'note'
│
├── VALUE
│   ├── numeric_value  3262.01
│   ├── unit           'LF' | 'SF' | 'CY' | 'EA' | 'TON' | ...
│   └── text_value     "Remove and dispose" (for non-numeric findings)
│
├── HUMAN-READABLE
│   └── statement  "Water Line A: 3,262 LF from STA 0+00 to STA 32+62"
│
├── SUPPORT CLASSIFICATION (assigned by reasoning engine — never by model)
│   └── support_level  'explicit' | 'inferred' | 'unknown'
│
├── citation_id (FK → entity_citations)
└── confidence / metadata
```

---

## Legacy Table Mapping

### How existing utility tables map to the new model

| Legacy Table                   | Maps to                                                       |
|-------------------------------|---------------------------------------------------------------|
| `project_quantities` row       | `project_entities` (discipline=utility, entity_type=line) + `entity_findings` (finding_type=quantity) |
| `utility_termination_points` row | `project_entities` (discipline=utility, entity_type=fitting, subtype=termination) + `entity_locations` (location_type=station) |
| `utility_crossings` row        | `project_entities` (discipline=utility, entity_type=crossing) + `entity_relationships` (type=crosses) + `entity_locations` |
| `document_chunks.extracted_quantities` | `entity_findings` (finding_type=quantity) linked to entity |
| `document_chunks.stations`     | `entity_locations` (location_type=station)                    |

Legacy FK bridge columns on `project_entities` (`legacy_quantity_id`, `legacy_termination_id`,
`legacy_crossing_id`) allow zero-downtime migration: old queries still hit old tables while
new queries use the entity model. The bridge can be removed in a future cleanup phase.

---

## Migration Strategy

### Step 1 — Additive schema (Migration 00038)
- Create `project_entities`, `entity_locations`, `entity_relationships`,
  `entity_citations`, `entity_findings` with RLS matching existing pattern.
- Add FK from `entity_relationships.citation_id → entity_citations.id`
- Add FK from `entity_findings.citation_id → entity_citations.id`
- Add FK from `entity_citations.finding_id → entity_findings.id`
  (Use `ALTER TABLE ... ADD CONSTRAINT` after both tables exist to break circular dependency)

### Step 2 — Backfill utility data (Migration 00039)
- `INSERT INTO project_entities ... SELECT FROM project_quantities`
- `INSERT INTO project_entities ... SELECT FROM utility_termination_points`
- `INSERT INTO entity_relationships ... SELECT FROM utility_crossings`
- Populate `entity_findings` from `project_quantities.quantity`
- Populate `entity_locations` from termination/crossing station fields
- No data is deleted from legacy tables.

### Step 3 — Retrieval layer integration (code — no migration)
- `retrieval-orchestrator.ts` gains an optional entity-graph query path
- Old structured lookups (`search_quantities`, `search_termination_points`,
  `search_utility_crossings`) remain and continue to work
- New entity queries complement, not replace, legacy queries
- `reasoning-engine.ts` optionally consumes `entity_findings` for richer ReasoningPackets

### Step 4 — Demo / architectural extraction (Migration 00040+)
- New vision extraction jobs write directly to `project_entities` + `entity_locations`
- No new discipline-specific tables needed
- `discipline` + `entity_type` + `subtype` carry all classification

### Rollback Safety
- New tables are additive. Dropping them does not affect any existing feature.
- Legacy FKs on `project_entities` preserve links to original rows.
- Old code paths hit old tables directly — unaffected throughout.

---

## ReasoningPacket — Core Data Model (V1, unchanged)

```typescript
ReasoningPacket {
  mode: ReasoningMode                  // scope | sequence | constraint | quantity | none
  wasActivated: boolean                // false = pass-through, use evidence directly

  context: ProjectContextAssembly {   // Assembled project context
    primarySystems: string[]
    relatedSystems: string[]
    relevantSheets: string[]
    relevantStations: string[]
    dataCompleteness: 'full' | 'partial' | 'sparse'
  }

  findings: ReasoningFinding[] {      // Structured evidence, pre-classified
    statement: string
    supportLevel: 'explicit' | 'inferred' | 'unknown'
    citations?: StructuredCitation[]
    basis?: string
  }[]

  gaps: ReasoningGap[] {             // Identified information gaps
    description: string
    gapType: GapType
    actionable?: string
  }[]

  recommendedAnswerFrame: string
  evidenceStrength: 'strong' | 'moderate' | 'weak'
}
```

---

## Reasoning Modes

| Mode                 | Triggered by                              | Primary job                                              |
|----------------------|-------------------------------------------|----------------------------------------------------------|
| `sequence_reasoning` | sequence_inference                        | Apply standard install sequences + surface doc sequences |
| `scope_reasoning`    | scope_summary, project_summary            | Group systems, note data completeness per system         |
| `quantity_reasoning` | quantity_lookup with multi-system data    | Group quantities by system, flag structured vs. text-only|
| `constraint_reasoning`| general_chat with structured project data | Surface crossing/conflict/constraint evidence            |
| `none`               | all other modes                           | Pass-through — writer uses evidence directly             |
