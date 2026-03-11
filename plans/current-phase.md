# Phase 6: Spec + RFI + Submittal Ingestion — COMPLETE ✓

Delivered 2026-03-11. TypeScript compilation passed with zero errors (`npx tsc --noEmit --skipLibCheck`).

---

## Phase 6 Status: COMPLETE ✓

### Delivered Files

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

### Implementation Checklist

#### Migration (`supabase/migrations/00043_spec_rfi_submittal_schema.sql`)
- [x] Extend `project_entities.discipline` CHECK: adds `'spec'`, `'rfi'`, `'submittal'`
- [x] Extend `entity_findings.finding_type` CHECK: adds 13 new types:
  - `'material_requirement'`, `'execution_requirement'`, `'testing_requirement'`
  - `'submittal_requirement'`, `'closeout_requirement'`, `'protection_requirement'`, `'inspection_requirement'`
  - `'clarification_statement'`, `'superseding_language'`, `'revision_metadata'`
  - `'approval_status'`, `'manufacturer_info'`, `'product_tag'`
- [x] Extend `entity_relationships.relationship_type` CHECK: adds 7 new types:
  - `'governs'`, `'requires'`, `'references'`
  - `'clarifies'`, `'replaces'`, `'supersedes'`
  - `'submitted_for'`
- [x] 18 performance indexes: spec (discipline, label, canonical), RFI (discipline, label, status, finding types), submittal (discipline, label, finding types), cross-discipline (governs, clarifies, submitted_for)
- [x] All idempotent (DO $ blocks checking existing constraint values)

#### Types (`src/lib/chat/types.ts`)
- [x] Add `spec_section_lookup`, `spec_requirement_lookup` to `AnswerMode`
- [x] Add `rfi_lookup`, `change_impact_lookup` to `AnswerMode`
- [x] Add `submittal_lookup`, `governing_document_query` to `AnswerMode`
- [x] Add `requirement_reasoning`, `change_reasoning`, `governing_document_reasoning`, `requirement_gap_reasoning` to `ReasoningMode`
- [x] Add `missing_rfi_resolution`, `conflicting_documents`, `unlinked_submittal`, `spec_section_not_ingested` to `GapType`
- [x] Add `specSection`, `specRequirementType`, `rfiNumber`, `changeDocType`, `submittalId`, `governingDocScope` to `_routing`
- [x] Add `SpecFinding`, `SpecEntity`, `SpecRequirementGroup`, `SpecQueryResult` interfaces
- [x] Add `RFIFinding`, `RFIReference`, `RFIEntity`, `RFIQueryResult` interfaces
- [x] Add `SubmittalFinding`, `SubmittalEntity`, `SubmittalQueryResult` interfaces
- [x] Add `GoverningAuthority`, `GoverningDocResult` interfaces

#### Query Classifier (`src/lib/chat/query-classifier.ts`)
- [x] 6 new `QueryType` values
- [x] Pattern constants: SPEC_SECTION_PATTERNS, SPEC_REQUIREMENT_PATTERNS, RFI_LOOKUP_PATTERNS, CHANGE_IMPACT_PATTERNS, SUBMITTAL_LOOKUP_PATTERNS, GOVERNING_DOCUMENT_PATTERNS
- [x] Extractor helpers: extractSpecSection(), extractSpecRequirementType(), extractRFINumber(), extractChangeDocType()
- [x] Classification branches in classifyQuery() (governing → rfi → change_impact → submittal → spec_section → spec_requirement, before default)

#### Query Analyzer (`src/lib/chat/query-analyzer.ts`)
- [x] 6 new case mappings in mapToAnswerMode()
- [x] Phase 6 preferred sources in buildPreferredSources() (vision_db + vector_search for all new modes)
- [x] Phase 6 routing fields in _routing construction

#### Spec Queries (`src/lib/chat/spec-queries.ts`) — NEW
- [x] `querySpecSection(supabase, projectId, sectionNumber)` — normalized section number match (label ilike + canonical_name ilike)
- [x] `querySpecRequirements(supabase, projectId, requirementType, sectionFilter?)` — all-section or section-filtered requirement lookup
- [x] `formatSpecAnswer(result)` — grouped by requirement family with part_reference citations
- [x] `normalizeSectionNumber(s)` — "033000" → "03 30 00"
- [x] `normalizeForCanonical(s)` — "03 30 00" → "03_30_00"
- [x] `SPEC_REQUIREMENT_TYPES` constant array (7 families)
- [x] Hydration, grouping (groupByRequirementFamily), deduplication helpers

#### RFI Queries (`src/lib/chat/rfi-queries.ts`) — NEW
- [x] `queryRFIByNumber(supabase, projectId, identifier)` — label match (normalizeRFILabel + ilike)
- [x] `queryRFIsByEntity(supabase, projectId, entityTag)` — two-step: tag→entity IDs→RFI clarifies relationships + text match
- [x] `queryRecentChanges(supabase, projectId, docType?)` — ordered by label desc, limit 20
- [x] `formatRFIAnswer(result)` — status-grouped, superseding language flagged
- [x] Support levels: `existing` (answered) → explicit; `new` (open) → inferred

#### Submittal Queries (`src/lib/chat/submittal-queries.ts`) — NEW
- [x] `querySubmittalByEntity(supabase, projectId, entityTag)` — two-step: tag → entity IDs → submittal submitted_for relationships
- [x] `querySubmittalBySection(supabase, projectId, sectionNumber)` — canonical_name ilike SPEC_ prefix
- [x] `resolveGoverningDocument(supabase, projectId, scope, entityTag?)` — conservative hierarchy: answered RFIs → specs → drawings → approved submittals
- [x] `formatSubmittalAnswer(result)`, `formatGoverningDocAnswer(result)` — with conflict flags for open RFIs

#### Retrieval (`src/lib/chat/retrieval-orchestrator.ts`)
- [x] Step 2.95: spec graph lookup (spec_section_lookup, spec_requirement_lookup)
- [x] Step 2.97: Phase 6B/C graph lookup (rfi_lookup, change_impact_lookup, submittal_lookup, governing_document_query)
- [x] `attemptSpecGraphLookup()` — routes by mode: section vs. requirement
- [x] `attemptPhase6GraphLookup()` — routes to governing / submittal / rfi-by-number / rfi-by-entity / recent-changes
- [x] All 6 new modes added to `shouldAttemptLivePDF()`
- [x] Spec (SP-xxx), submittal (SUB-xxx, SUBMITTAL) sheet patterns in `selectRelevantSheets()`

#### Reasoning (`src/lib/chat/reasoning-engine.ts`)
- [x] `requirement_reasoning` mode: spec_section_lookup + spec_requirement_lookup
- [x] `change_reasoning` mode: rfi_lookup + change_impact_lookup
- [x] `governing_document_reasoning` mode: governing_document_query + submittal_lookup
- [x] `generateRequirementFindings()` — explicit for spec data, requirement_gap for missing families
- [x] `generateChangeFindings()` — explicit for answered RFIs, inferred for open; superseding_language flagged
- [x] `generateGoverningDocFindings()` — hierarchy surfaced; conflicts flagged as conflicting_documents gap
- [x] `generateRequirementGapFindings()` — spec_section_not_ingested gap + missing_rfi_resolution gap
- [x] Gap detection: open RFIs (missing_rfi_resolution), doc conflicts (conflicting_documents), unlinked submittals, missing spec sections
- [x] Answer frames: requirements_with_citations, change_impact_documented, governing_doc_hierarchy, requirement_gaps_identified

#### Vision Extractors
- [x] `src/lib/vision/spec-extractor.ts` — SpecDocumentType (4 types), SPEC_DOCUMENT_PATTERNS, classifySpecDocument(), extractSpecSections(), splitIntoParts(), classifyRequirement(), extractRequirementStatements(), buildSpecSectionCanonical(), buildSpecRequirementCanonical(), SPEC_SECTION_EXTRACTION_PROMPT, SPEC_MANUAL_EXTRACTION_PROMPT
- [x] `src/lib/vision/rfi-extractor.ts` — ChangeDocType (5 types), CHANGE_DOC_PATTERNS, classifyChangeDocument(), extractChangeDocIdentifier(), extractChangeDocDates(), extractSheetReferences(), extractDetailReferences(), extractSpecSectionReferences(), isSupersedingLanguage(), determineRFIStatus(), buildChangeDocCanonical(), RFI_EXTRACTION_PROMPT, RFI_LOG_EXTRACTION_PROMPT
- [x] `src/lib/vision/submittal-extractor.ts` — SubmittalDocType (6 types), SUBMITTAL_DOC_PATTERNS, classifySubmittalDocument(), extractSubmittalIdentifier(), extractApprovalStatus(), extractManufacturerInfo(), extractProductTags(), buildSubmittalCanonical(), buildProductDataCanonical(), SUBMITTAL_EXTRACTION_PROMPT, SUBMITTAL_LOG_EXTRACTION_PROMPT

#### Validation Harness (`src/lib/chat/spec-validator.ts`) — NEW
- [x] `runSpecValidation(supabase, projectId)` → SpecValidationReport (5 tests, all parallel)
- [x] `formatSpecValidationReport(report)` → string
- [x] Tests: spec_sections_ingested, requirement_families, governs_relationships, rfi_linked, submittal_linked

---

## Key Design Decisions

### Three new disciplines: 'spec', 'rfi', 'submittal'
Added to the `discipline` CHECK constraint in migration 00043. Status values reused semantically: `existing` = answered RFI, `to_remain` = approved submittal, `new` = open RFI/pending submittal, `to_remove` = voided/rejected.

### Requirement families are finding_type, not entity subtype
7 requirement families (material, execution, testing, submittal, closeout, protection, inspection) are stored as `finding_type` values on `entity_findings`, not as entity subtypes. This enables cross-section queries without complex JOINs.

### Section number normalization
`normalizeSectionNumber()` handles "033000", "03 30 00", and "03300" → "03 30 00". Stored in `label`. `canonical_name` uses underscore form: "SPEC_03_30_00". Queries use both ilike matches.

### Conservative governing document hierarchy
`resolveGoverningDocument()` does NOT automatically assert precedence. It returns all authorities ranked by tier (answered RFIs > specs > drawings > approved submittals) and surfaces open RFIs as `conflicting_documents` gaps. The LLM surfaces conflicts; the system never silently resolves them.

### Support levels from document status, not model
Answered RFIs → explicit; open RFIs → inferred. Spec findings → explicit. Approved submittals → explicit; pending/rejected → inferred. Model never assigns support levels.

### Two-step entity tag lookup for RFI/submittal
`queryRFIsByEntity()` and `querySubmittalByEntity()` first resolve entity IDs from the tag, then look up relationships. Same pattern established in arch-queries.ts (Phase 4).

### Retrieval step ordering
1 → 2 (vision DB) → 2.5 (demo graph) → 2.75 (arch graph) → 2.8 (structural graph) → 2.85 (MEP graph) → 2.9 (coordination graph) → **2.95 (spec graph)** → **2.97 (RFI/submittal/governing graph)** → 3 (smart router) → 4 (live PDF).

---

## What Does NOT Change

- All utility, demo, architectural, structural, MEP, and coordination pipeline code — untouched
- `graph-queries.ts`, `demo-queries.ts`, `arch-queries.ts`, `structural-queries.ts`, `mep-queries.ts`, `coordination-queries.ts`, `smart-router.ts` — untouched
- Existing answer modes and reasoning modes — untouched
- `requirement_lookup` (legacy mode) — still distinct; new modes are `spec_requirement_lookup` / `spec_section_lookup`

---

## Next Phase

**Phase 7: Vision Processing Wiring** — wire spec-extractor.ts, rfi-extractor.ts, and submittal-extractor.ts
into the auto-process pipeline (same integration point as demo-extractor.ts and arch-extractor.ts).

Or **Phase 6D: Spec → Drawing Linkage** — wire `governs` relationships between spec sections and drawing entities (e.g. footing F-1 governed by Section 03 30 00).

---

# Phase 5: Structural + MEP + Coordination Reasoning — COMPLETE ✓

Delivered 2026-03-11. TypeScript compilation passed with zero errors (`npx tsc --noEmit --skipLibCheck`).

---

## Phase 5 Status: COMPLETE ✓

### Delivered Files

| Deliverable | File | Status |
|---|---|---|
| Structural + MEP schema extension | `supabase/migrations/00042_structural_mep_entity_schema.sql` | ✓ NEW |
| AnswerMode + ReasoningMode extensions | `src/lib/chat/types.ts` | ✓ MODIFIED |
| Structural + MEP + coordination classification | `src/lib/chat/query-classifier.ts` | ✓ MODIFIED |
| Structural + MEP + coordination mode mapping | `src/lib/chat/query-analyzer.ts` | ✓ MODIFIED |
| Structural graph read queries | `src/lib/chat/structural-queries.ts` | ✓ NEW |
| MEP graph read queries | `src/lib/chat/mep-queries.ts` | ✓ NEW |
| Coordination graph read queries | `src/lib/chat/coordination-queries.ts` | ✓ NEW |
| Structural + MEP + coordination retrieval path | `src/lib/chat/retrieval-orchestrator.ts` | ✓ MODIFIED |
| Phase 5 reasoning modes | `src/lib/chat/reasoning-engine.ts` | ✓ MODIFIED |
| Structural vision extraction infrastructure | `src/lib/vision/structural-extractor.ts` | ✓ NEW |
| MEP vision extraction infrastructure | `src/lib/vision/mep-extractor.ts` | ✓ NEW |
| Coordination validation harness | `src/lib/chat/coordination-validator.ts` | ✓ NEW |

### Implementation Checklist

#### Migration (`supabase/migrations/00042_structural_mep_entity_schema.sql`)
- [x] Extend `entity_findings.finding_type` CHECK: adds `'load_bearing'`, `'capacity'`, `'equipment_tag'`, `'circuit_ref'`, `'coordination_note'`
- [x] Extend `entity_relationships.relationship_type` CHECK: adds `'supports'`, `'served_by'`
- [x] `idx_entities_structural`, `idx_entities_structural_label`
- [x] `idx_entities_mep`, `idx_entities_mep_type`, `idx_entities_mep_label`, `idx_entities_mep_schedule`
- [x] `idx_findings_capacity`, `idx_findings_equipment_tag`, `idx_findings_coordination_note`
- [x] `idx_location_room_discipline`
- [x] All idempotent (DO $ blocks checking existing constraint values)

#### Types (`src/lib/chat/types.ts`)
- [x] Add `struct_element_lookup`, `struct_area_scope`, `mep_element_lookup`, `mep_area_scope` to `AnswerMode`
- [x] Add `trade_coordination`, `coordination_sequence`, `affected_area` to `AnswerMode`
- [x] Add 7 new `ReasoningMode` values: struct_element_reasoning, struct_area_reasoning, mep_element_reasoning, mep_area_reasoning, trade_overlap_reasoning, coordination_constraint_reasoning, affected_area_reasoning
- [x] Add `structMark`, `structEntityType`, `structGrid`, `structLevel`, `mepTag`, `mepDiscipline`, `coordRoom`, `coordLevel` to `_routing`
- [x] Add `StructuralFinding`, `StructuralEntity`, `StructuralQueryResult` interfaces
- [x] Add `MEPFinding`, `MEPEntity`, `MEPScheduleEntry`, `MEPQueryResult` interfaces
- [x] Add `TradePresence`, `CoordinationQueryResult` interfaces

#### Query Classifier (`src/lib/chat/query-classifier.ts`)
- [x] 7 new `QueryType` values
- [x] Pattern constants: STRUCTURAL_ELEMENT_PATTERNS, STRUCTURAL_AREA_PATTERNS, MEP_ELEMENT_PATTERNS, MEP_AREA_PATTERNS, COORDINATION_SEQUENCE_PATTERNS, AFFECTED_AREA_PATTERNS, TRADE_COORDINATION_PATTERNS
- [x] Extractor helpers: extractStructMark(), extractStructGrid(), extractStructLevel(), extractMEPTag(), extractCoordRoom(), extractCoordLevel()
- [x] Classification branches in classifyQuery() (coordination checked before structural/MEP)

#### Query Analyzer (`src/lib/chat/query-analyzer.ts`)
- [x] 7 new case mappings in mapToAnswerMode()
- [x] Phase 5 preferred sources in buildPreferredSources() (vision_db + vector_search for all new modes)
- [x] Phase 5 routing fields in _routing construction

#### Structural Queries (`src/lib/chat/structural-queries.ts`) — NEW
- [x] `queryStructuralElement(projectId, mark, entityType?)` — normalized mark match (uppercase + strip non-alphanumeric)
- [x] `queryStructuralByArea(projectId, gridRef?, level?)` — TypeScript-side level/grid filter
- [x] `formatStructuralElementAnswer(result)`, `formatStructuralAreaAnswer(result)`
- [x] Entity type grouping order: footing → column → beam → foundation_wall → slab_edge → grid_line → structural_note

#### MEP Queries (`src/lib/chat/mep-queries.ts`) — NEW
- [x] `classifyMEPTrade(entityType)` — exported, maps entity_type → 'electrical' | 'mechanical' | 'plumbing'
- [x] `queryMEPElement(projectId, tag, discipline?)` — normalized tag match + optional trade filter
- [x] `queryMEPByArea(projectId, roomFilter?, levelFilter?, disciplineFilter?)` — location + trade filtering
- [x] `fetchScheduleEntryForMEPEntity()` — described_by lookup (same two-step pattern as arch-queries)
- [x] `formatMEPElementAnswer(result)`, `formatMEPAreaAnswer(result)` — grouped by trade
- [x] Sets: ELECTRICAL_ENTITY_TYPES, MECHANICAL_ENTITY_TYPES, PLUMBING_ENTITY_TYPES

#### Coordination Queries (`src/lib/chat/coordination-queries.ts`) — NEW
- [x] `queryTradesInRoom(projectId, roomNumber)` — all disciplines in a room, grouped by trade
- [x] `queryCoordinationConstraints(projectId, roomFilter?, levelFilter?)` — demo to_remain/to_protect + coordination_note entities
- [x] `queryAffectedArea(projectId, roomFilter?, levelFilter?)` — all disciplines in room/level
- [x] `buildTradePresence(rows)` — sorted by canonical order: arch → struct → electrical → mechanical → plumbing → demo
- [x] `extractCoordinationNotes(rows)` — pulls coordination_note findings
- [x] `toTradeName(discipline, entityType)` — MEP → classifyMEPTrade(), else discipline directly
- [x] Formatters: formatTradeCoordinationAnswer(), formatCoordinationSequenceAnswer(), formatAffectedAreaAnswer()

#### Retrieval (`src/lib/chat/retrieval-orchestrator.ts`)
- [x] Step 2.8: structural graph lookup (struct_element_lookup, struct_area_scope)
- [x] Step 2.85: MEP graph lookup (mep_element_lookup, mep_area_scope)
- [x] Step 2.9: coordination graph lookup (trade_coordination, coordination_sequence, affected_area)
- [x] attemptStructuralGraphLookup(), attemptMEPGraphLookup(), attemptCoordinationGraphLookup()
- [x] All 7 new modes added to shouldAttemptLivePDF()
- [x] Structural (S-xxx), mechanical (M-xxx), electrical (E-xxx), plumbing (P-xxx) sheet patterns in selectRelevantSheets()
- [x] TS fixes: schedType cast removes 'hardware', safeArchTagType filters 'room' from archTagType

#### Reasoning (`src/lib/chat/reasoning-engine.ts`)
- [x] 7 new selectReasoningMode() cases
- [x] 7 new generateFindings() dispatch cases
- [x] generateStructuralElementFindings(), generateStructuralAreaFindings()
- [x] generateMEPElementFindings(), generateMEPAreaFindings()
- [x] generateTradeOverlapFindings() with STANDARD_COORDINATION_CAUTIONS (6 inferred cautions)
- [x] generateCoordinationConstraintFindings(), generateAffectedAreaFindings()
- [x] Gap detection for structural/MEP/coordination modes
- [x] 7 new selectAnswerFrame() cases

#### Vision Extractors
- [x] `src/lib/vision/structural-extractor.ts` — StructuralSheetType (7 types), STRUCTURAL_SHEET_PATTERNS, detectStructuralEntityType(), extractStructuralMarkFromText(), buildStructuralCanonicalName(), STRUCTURAL_FOUNDATION_EXTRACTION_PROMPT, STRUCTURAL_FRAMING_EXTRACTION_PROMPT
- [x] `src/lib/vision/mep-extractor.ts` — MEPSheetType (9 types), MEP_SHEET_PATTERNS, detectMEPEntityType(), detectMEPTrade(), extractMEPTagFromText(), buildMEPCanonicalName(), MECHANICAL_EXTRACTION_PROMPT, ELECTRICAL_EXTRACTION_PROMPT, PLUMBING_EXTRACTION_PROMPT

#### Validation Harness (`src/lib/chat/coordination-validator.ts`) — NEW
- [x] `runCoordinationValidation(projectId)` → CoordinationValidationReport (8 tests)
- [x] `formatCoordinationValidationReport(report)` → string
- [x] Tests: entity_discipline_coverage, entity_location_coverage, trade_presence_per_room, trade_presence_per_level, coordination_notes_surface, demo_constraint_surface, cross_discipline_consistency, confidence_range

---

## Key Design Decisions

### discipline = 'structural' and 'mep' already in schema
migration 00038 already included these values in the discipline CHECK constraint. No discipline migration needed in 00042.

### MEP trade is query-time derived, not a DB column
`classifyMEPTrade(entityType)` maps entity_type → 'electrical' | 'mechanical' | 'plumbing' at query time. No separate trade column. Three entity-type Sets (ELECTRICAL_ENTITY_TYPES, MECHANICAL_ENTITY_TYPES, PLUMBING_ENTITY_TYPES) used by both mep-queries.ts and mep-extractor.ts.

### Coordination is room/level text-anchor based
Cross-discipline coordination is anchored on `room_number` and `level` in `entity_locations`. No geometry, no BIM-grade clash detection. Filtering in TypeScript post-fetch (bounded entity counts per project).

### STANDARD_COORDINATION_CAUTIONS
6 inferred cautions in reasoning-engine.ts triggered by discipline combination patterns in formatted content: demo+MEP, structural+MEP penetrations, ACT ceiling+mechanical diffusers, electrical+plumbing clearance, HVAC+structural bays, general pre-installation meeting (3+ trades).

### Retrieval step ordering
1 → 2 (vision DB) → 2.5 (demo graph) → 2.75 (arch graph) → 2.8 (structural graph) → 2.85 (MEP graph) → 2.9 (coordination graph) → 3 (smart router) → 4 (live PDF).

### (any[]) cast pattern for rawEntities.map()
`(rawEntities as any[]).map(toEntityFn)` used throughout to ensure TypeScript infers the mapped type correctly when the Supabase client returns `any`. Established in arch-queries.ts and applied consistently in structural-queries.ts, mep-queries.ts.

---

## What Does NOT Change

- All utility, demo, and architectural pipeline code — untouched
- `graph-queries.ts`, `demo-queries.ts`, `arch-queries.ts`, `smart-router.ts` — untouched
- Existing answer modes and reasoning modes — untouched
- `requirement_lookup` remains unsupported

---

## Next Phase

**Phase 6: Spec Ingestion Pipeline** — ingest project specifications to enable `requirement_lookup` mode
(currently marked unsupported: no spec pipeline exists).

Or **Phase 5C: Vision Processing Wiring** — wire structural-extractor.ts and mep-extractor.ts into the
auto-process pipeline (same integration point as demo-extractor.ts and arch-extractor.ts).

---

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
