# Phase 6: Specifications + RFIs + Submittals + Requirements Reasoning

## Split Structure

- **Phase 6A** — Spec ingestion + requirement extraction
- **Phase 6B** — RFI / change-document ingestion
- **Phase 6C** — Submittal linkage + governing-document reasoning

---

## What Changed Through Phase 5

| Phase | Discipline | Core capability |
|---|---|---|
| 1 | — | Universal entity model schema |
| 2 | utility | Utility pipe/fitting/crossing/junction graph |
| 3 | demo | Demolition scope and constraint reasoning |
| 4 | architectural | Room/door/window/schedule entity graph and reasoning |
| 5A | structural, mep | Structural footing/column/beam/grid + MEP panel/AHU/fixture graph |
| 5B | cross-discipline | Coordination reasoning: trades-per-room, dependency analysis |
| **6A** | **spec** | **Spec section ingestion, requirement extraction, spec queries** |
| **6B** | **rfi** | **RFI/change-document ingestion, change linkage** |
| **6C** | **submittal** | **Submittal linkage, governing-document reasoning** |

---

## Schema Baseline (migration 00042 state)

discipline CHECK includes: `'utility', 'demo', 'architectural', 'structural', 'mep', 'schedule', 'general'`

**Phase 6 must add:** `'spec', 'rfi', 'submittal'` to the discipline constraint.

---

# PHASE 6A: Spec Ingestion + Requirement Extraction

---

## Spec Entity Model (discipline = 'spec')

### entity_type × subtype vocabulary

| entity_type | subtype examples | canonical_name format |
|---|---|---|
| `spec_section` | `division_03`, `division_09`, `division_16` | `SPEC_03_30_00` |
| `spec_part` | `general`, `products`, `execution` | `SPEC_03_30_00_PART_1` |
| `spec_requirement` | `material`, `execution`, `testing`, `submittal`, `closeout`, `protection`, `inspection` | `SPEC_03_30_00_REQ_MATERIAL_001` |
| `spec_note` | `general`, `reference_standard` | `SPEC_03_30_00_NOTE_001` |

### canonical_name rules
- `SPEC_{SECTION_NORMALIZED}` where SECTION_NORMALIZED = `03_30_00` from CSI `03 30 00`
- `SPEC_{SECTION_NORMALIZED}_PART_{N}` for PART 1/2/3
- `SPEC_{SECTION_NORMALIZED}_REQ_{TYPE_UPPER}_{IDX:03d}`
- `SPEC_{SECTION_NORMALIZED}_NOTE_{IDX:03d}`

### status lifecycle mapping
- `existing` = active/issued spec section
- `proposed` = addendum/pending revision
- `to_remove` = withdrawn/superseded
- `unknown` → not used; use metadata→workflow_status if needed

### Finding types for spec discipline

New finding types added in migration 00043:

| finding_type | description |
|---|---|
| `material_requirement` | Material spec: "Concrete f'c = 4000 psi at 28 days" |
| `execution_requirement` | How work shall be done: "Place concrete in one continuous operation" |
| `testing_requirement` | Tests/inspections required: "One slump test per 50 CY" |
| `submittal_requirement` | What must be submitted: "Submit mix design 14 days before placement" |
| `closeout_requirement` | Closeout/warranty: "Provide certified test reports at closeout" |
| `protection_requirement` | Protection of work: "Protect from freezing for 7 days minimum" |
| `inspection_requirement` | Hold points, notifications: "Notify inspector 24 hours before placement" |

### Relationship types for spec discipline

| relationship_type | description |
|---|---|
| `governs` | spec_section governs entity / work type |
| `requires` | spec_section requires submittal / test action |
| `references` | spec document references another section, standard, or sheet |

---

## Spec Ingestion Standard

### Document types handled
- Specification books (full CSI-formatted PDF or text)
- Single specification sections
- Project manual excerpts

### Sheet number conventions
- Spec documents do not have sheet numbers; citation uses `document_id + section_number`
- `entity_citations.sheet_number` = spec section number (e.g., "03 30 00")

### CSI section normalization
```
normalizeSection(s) = UPPER(s).replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
// "03 30 00" → "03_30_00"
// "03300" → "03300"
// "Division 3" → "DIVISION_3"
```

### Extraction pipeline
1. `classifySpecDocument()` — detect spec format (CSI, narrative, schedule)
2. `extractSpecSections()` — split into numbered sections
3. `extractRequirementFamilies()` — regex first-pass per section
4. `SPEC_EXTRACTION_PROMPT` — passed to claude-sonnet for structured JSON output
5. Write to universal entity model

### Extraction prompt output contract (JSON)
```json
{
  "sections": [
    {
      "sectionNumber": "03 30 00",
      "sectionTitle": "Cast-In-Place Concrete",
      "divisionNumber": "03",
      "parts": {
        "general": "text...",
        "products": "text...",
        "execution": "text..."
      },
      "requirements": [
        {
          "requirementType": "material",
          "statement": "Concrete compressive strength: 4000 psi minimum at 28 days",
          "partReference": "PART 2 - PRODUCTS, 2.1A",
          "confidence": 0.95
        }
      ]
    }
  ]
}
```

---

## Retrieval for Spec Queries

### New answer modes (Phase 6A)
- `spec_section_lookup` — "What does spec section 03 30 00 require?"
- `spec_requirement_lookup` — "What testing is required for concrete work?"

### Retrieval step: 2.95 (after coordination at 2.9, before smart-router at 3)

---

# PHASE 6B: RFI / Change-Document Ingestion

---

## RFI Entity Model (discipline = 'rfi')

### entity_type × subtype vocabulary

| entity_type | subtype examples | canonical_name format |
|---|---|---|
| `rfi` | — | `RFI_001` (padded to 3 digits) |
| `asi` | — | `ASI_001` |
| `addendum` | — | `ADDENDUM_001` |
| `bulletin` | — | `BULLETIN_001` |
| `clarification` | verbal, written | `CLARIF_{PARENT_NORM}_{IDX:03d}` |

### canonical_name rules
- `RFI_{NUMBER_PADDED}` — `RFI_023` from "RFI-23" or "RFI #23"
- `ASI_{NUMBER_PADDED}` — from Architect's Supplemental Instructions
- `ADDENDUM_{NUMBER_PADDED}` — from Addendum
- `BULLETIN_{NUMBER_PADDED}` — from Bulletin

### status lifecycle mapping
- `existing` = issued / answered RFI
- `new` = open / unanswered RFI
- `to_remove` = voided / withdrawn
- `proposed` = draft / pending issuance

### Finding types for rfi discipline

New finding types added in migration 00043:

| finding_type | description |
|---|---|
| `clarification_statement` | The clarification text: "Footing F-1 depth to be 4'-0" minimum" |
| `superseding_language` | Explicit replacement: "Detail 5/S-201 supersedes Detail 3/S-201" |
| `revision_metadata` | Doc metadata: "RFI-023, issued 2026-02-15, Architect response 2026-02-20" |

Note: `referenced_entity` is handled via `entity_relationships` (clarifies/references), not a separate finding type.

### Relationship types for rfi discipline

| relationship_type | description |
|---|---|
| `clarifies` | rfi/asi clarifies a drawing entity, detail, or spec section |
| `replaces` | change doc replaces/supersedes a prior entity or detail |
| `references` | doc references a sheet, detail, section |
| `applies_to` | change applies to a specific entity, system, or room |

---

## RFI/Change Ingestion Standard

### Document types handled
- RFI log (list of RFIs with numbers, subject, status)
- Individual RFI documents (question + response)
- ASIs (Architect's Supplemental Instructions)
- Addenda (numbered with attachment sheets)
- Bulletins

### Key fields extracted
1. **Identifier** — RFI number, ASI number, Addendum number
2. **Subject / Description** — single-line summary
3. **Referenced entities** — sheet numbers, detail references, spec sections mentioned
4. **Clarification/response text** — the answer or instruction
5. **Superseding language** — explicit "replace", "revise", "supersede" phrases
6. **Revision metadata** — date issued, date answered, preparer, responder
7. **Status** — open, answered, voided

### Extraction prompt output contract (JSON)
```json
{
  "changeDocuments": [
    {
      "docType": "rfi",
      "identifier": "RFI-023",
      "subject": "Footing F-1 depth at Grid A-3",
      "status": "answered",
      "dateIssued": "2026-02-15",
      "dateAnswered": "2026-02-20",
      "referencedSheets": ["S-201"],
      "referencedDetails": ["5/S-201"],
      "referencedSpecSections": [],
      "referencedEntities": ["F-1"],
      "clarificationText": "Footing F-1 minimum depth shall be 4'-0\" below finished grade.",
      "supersedingLanguage": null,
      "confidence": 0.92
    }
  ]
}
```

---

## Retrieval for RFI Queries

### New answer modes (Phase 6B)
- `rfi_lookup` — "Did an RFI address footing F-1?"
- `change_impact_lookup` — "What changed in Addendum 1?"

### Retrieval step: 2.97 (after spec at 2.95, before smart-router at 3)

---

# PHASE 6C: Submittal Linkage + Governing Reasoning

---

## Submittal Entity Model (discipline = 'submittal')

### entity_type × subtype vocabulary

| entity_type | subtype examples | canonical_name format |
|---|---|---|
| `submittal` | product_data, shop_drawing, sample, certificate | `SUB_{SPEC_SECTION_NORM}_{IDX:03d}` |
| `product_data` | — | `PROD_{MANUFACTURER_NORM}_{TAG_NORM}` |
| `shop_drawing` | — | `SHOP_{SPEC_SECTION_NORM}_{IDX:03d}` |

### status lifecycle mapping
- `to_remain` = approved
- `new` = submitted / under review
- `proposed` = pending approval
- `to_remove` = rejected / resubmit required
- `existing` = approved as noted (in use)

### Finding types for submittal discipline

New finding types added in migration 00043:

| finding_type | description |
|---|---|
| `approval_status` | "Approved as Noted, 2026-01-20, Architect" |
| `manufacturer_info` | "Simpson Strong-Tie HDU8-SDS2.5, 20kip capacity" |
| `product_tag` | Drawing tag this submittal covers: "LP-1", "D-14" |

Note: `spec_section_ref` is handled via `entity_relationships` (submitted_for), not as a finding.

### Relationship types for submittal discipline

| relationship_type | description |
|---|---|
| `submitted_for` | submittal submitted for a spec section |
| `applies_to` | submittal covers a specific project entity |
| `governs` | approved submittal governs product/installation for that entity |

---

## Governing Document Resolver

### Precedence hierarchy (conservative, evidence-based)
1. **Explicit contractual language** — if a document explicitly states precedence, use it. Support level: explicit.
2. **RFI/ASI/Addendum** — issued change documents supersede drawings and specs where the scope is clear. Support level: explicit where stated, inferred otherwise.
3. **Specifications** — govern materials and execution unless changed by (2). Support level: explicit.
4. **Construction Drawings** — govern geometry, location, quantity. Support level: explicit.
5. **Submittals (approved)** — confirm what was actually installed/ordered; may narrow but do not override spec unless explicitly approved as substitution.

**IMPORTANT:** This hierarchy is an industry standard default. The system shall NOT claim contractual legal precedence unless it finds the exact precedence clause in an ingested document.

### Governing document questions answered
- "What governs here: plan, spec, or RFI?"
- "Does the submittal align with the spec and plan?"
- "Is there a conflict between the drawing and the spec?"

---

## New Answer Modes (Phase 6C)
- `submittal_lookup` — "What submittal covers LP-1?"
- `governing_document_query` — "What governs here: plan, spec, or RFI?"

---

# REASONING MODES — PHASE 6

## New reasoning modes

| mode | activation | description |
|---|---|---|
| `requirement_reasoning` | spec_section_lookup, spec_requirement_lookup | Groups requirements by family (material/testing/etc), cites sections, flags gaps |
| `change_reasoning` | rfi_lookup, change_impact_lookup | Groups changes by entity/area affected, distinguishes answered vs open RFIs |
| `governing_document_reasoning` | governing_document_query | Applies precedence hierarchy, emits explicit vs inferred support level |
| `requirement_gap_reasoning` | spec_requirement_lookup when only partial evidence | What's missing, what needs field verification |

## Support level assignment for Phase 6

| evidence source | support level |
|---|---|
| spec entity in DB (vision_db) | explicit |
| rfi entity in DB with clarification (vision_db) | explicit |
| rfi entity in DB open/unanswered | inferred |
| approved submittal in DB | explicit |
| vector search hit in spec document | inferred |
| no evidence found | unknown |

---

# SCHEMA MIGRATION (00043)

## Changes

### 1. Extend discipline CHECK
Add `'spec', 'rfi', 'submittal'`

### 2. Extend entity_findings.finding_type CHECK
Add:
- `material_requirement`
- `execution_requirement`
- `testing_requirement`
- `submittal_requirement`
- `closeout_requirement`
- `protection_requirement`
- `inspection_requirement`
- `clarification_statement`
- `superseding_language`
- `revision_metadata`
- `approval_status`
- `manufacturer_info`
- `product_tag`

### 3. Extend entity_relationships.relationship_type CHECK
Add:
- `governs`
- `requires`
- `references`
- `clarifies`
- `replaces`
- `supersedes`
- `submitted_for`

### 4. Performance indexes
- `idx_entities_spec` — spec entities by project
- `idx_entities_spec_section` — spec section number lookup (via label)
- `idx_entities_rfi` — rfi entities by project
- `idx_entities_rfi_label` — RFI number lookup (via label)
- `idx_entities_submittal` — submittal entities by project
- `idx_findings_requirement` — requirement finding types (partial index)
- `idx_findings_clarification` — clarification_statement findings
- `idx_relationships_governs` — governs relationships
- `idx_relationships_clarifies` — clarifies relationships

---

# FILE-BY-FILE CHANGE PLAN

## New files

| file | phase | purpose |
|---|---|---|
| `supabase/migrations/00043_spec_rfi_submittal_schema.sql` | 6A/B/C | Schema extension: discipline + finding_type + relationship_type + indexes |
| `src/lib/vision/spec-extractor.ts` | 6A | Sheet classification, section extraction, requirement extraction, extraction prompt |
| `src/lib/vision/rfi-extractor.ts` | 6B | RFI/change doc classification, field extraction, extraction prompt |
| `src/lib/vision/submittal-extractor.ts` | 6C | Submittal classification, field extraction, extraction prompt |
| `src/lib/chat/spec-queries.ts` | 6A | DB queries for spec entities + result formatting |
| `src/lib/chat/rfi-queries.ts` | 6B | DB queries for rfi entities + result formatting |
| `src/lib/chat/submittal-queries.ts` | 6C | DB queries for submittal entities + governing resolver |
| `src/lib/chat/spec-validator.ts` | 6A | Validation harness for spec entity graph |

## Modified files

| file | changes |
|---|---|
| `src/lib/chat/types.ts` | Add AnswerModes, ReasoningModes, GapTypes, entity interfaces |
| `src/lib/chat/query-classifier.ts` | Add spec/rfi/submittal query type patterns and routing extras |
| `src/lib/chat/query-analyzer.ts` | Map new query types to answer modes, add Phase 6 routing fields |
| `src/lib/chat/retrieval-orchestrator.ts` | Add retrieval steps 2.95 (spec), 2.97 (rfi/submittal), shouldAttemptLivePDF update |
| `src/lib/chat/reasoning-engine.ts` | Add Phase 6 reasoning modes and finding generators |

---

# VALIDATION HARNESS

`spec-validator.ts` exports `runSpecValidation(projectId)`:

1. **test_spec_sections_ingested** — at least one spec entity with discipline='spec'
2. **test_requirement_families** — at least one of each finding_type family exists across project
3. **test_governs_relationships** — at least one `governs` relationship in entity_relationships
4. **test_rfi_linked** — at least one rfi entity with a `clarifies` relationship
5. **test_submittal_linked** — at least one submittal entity with a `submitted_for` relationship

---

# EXAMPLE OUTPUTS

## "What does the spec require for concrete work?"

```
Spec Section 03 30 00 — Cast-In-Place Concrete
Source: Spec Section 03 30 00 (explicit)

Material Requirements:
- Concrete compressive strength: f'c = 4000 psi minimum at 28 days [explicit — Spec 03 30 00, 2.1.A]
- Water-cement ratio: 0.45 maximum [explicit — Spec 03 30 00, 2.1.B]
- Portland cement: ASTM C150, Type I/II [explicit — Spec 03 30 00, 2.1.C]

Testing Requirements:
- Slump test: one test per 50 CY or fraction thereof [explicit — Spec 03 30 00, 3.6.A]
- Cylinder breaks: one set per 50 CY; test at 7 and 28 days [explicit — Spec 03 30 00, 3.6.B]

Submittal Requirements:
- Submit concrete mix design 14 days before placement [explicit — Spec 03 30 00, 1.3.A]

Inspection Requirements:
- Notify inspector 24 hours before placement [explicit — Spec 03 30 00, 1.4.A]

Gaps:
- Protection requirements: not found in ingested spec content (check Spec 03 30 00, PART 3 Section 3.7)
```

## "Did an RFI change the detail at Grid A-3?"

```
RFI-023 — Footing F-1 depth at Grid A-3
Status: Answered (2026-02-20)
Source: RFI-023 (explicit)

Clarification: Footing F-1 minimum depth shall be 4'-0" below finished grade.
This supersedes the 3'-6" depth shown on Sheet S-201, Detail 5.

Linked entities: Footing F-1, Sheet S-201

No other RFIs found referencing Grid A-3 entities.
```

## "What governs here: plan, spec, or RFI?"

```
Governing Document Analysis — Footing F-1 at Grid A-3

RFI-023 (answered) governs depth: 4'-0" minimum [explicit — RFI-023, issued 2026-02-20]
  Basis: RFI-023 explicitly supersedes Sheet S-201, Detail 5 for this element.

Spec 03 30 00 governs material and testing requirements [explicit — Spec 03 30 00]
  No RFI or addendum conflicts with these spec requirements.

Sheet S-201 governs geometry, location, reinforcing not addressed by RFI-023 [explicit — S-201]

Inferred: No submittal yet approved for this footing/rebar combination. Verify before ordering. [inferred]

Summary: RFI-023 > Sheet S-201 for depth. Spec 03 30 00 governs all material/testing unchanged.
```

---

# CONSTRAINTS ENFORCED

1. **Conservative** — never claim full contractual precedence unless explicitly encoded in a document.
2. **Evidence-based** — all support levels assigned deterministically by source type.
3. **Honest gaps** — open/unanswered RFIs are flagged as `inferred`, not `explicit`.
4. **No conflict resolution by inference** — conflicting documents are surfaced as gaps, not silently resolved.
5. **Existing pipeline preserved** — all prior utility/demo/arch/struct/mep behavior unchanged.

---

# SUCCESS CRITERIA

- [ ] `00043` migration runs idempotently
- [ ] Spec sections extract into project_entities (discipline='spec')
- [ ] Requirement families present across spec query results
- [ ] RFIs link to drawing entities via `clarifies` relationships
- [ ] Submittals link to spec sections via `submitted_for` relationships
- [ ] `spec_section_lookup` returns structured requirement lists with citations
- [ ] `rfi_lookup` returns change impact with answered vs open distinction
- [ ] `governing_document_query` applies hierarchy with explicit support levels
- [ ] `requirement_lookup` still routes as `unsupported` for queries that can't be matched to a spec section
- [ ] Validation harness passes 5/5 tests when spec data is present
