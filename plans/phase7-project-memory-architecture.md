# Phase 7: Project-Scoped Memory, Correction Capture, and Recheck Architecture

**Date:** 2026-03-13
**Status:** DESIGN — not yet implemented

---

## A. Current Failure Analysis

### Root Cause: Stateless Pipeline, No Feedback Loop

The current system processes every query in a vacuum. There is no mechanism to:
- Persist user corrections back to the data store
- Downweight sources that were previously wrong for this project
- Learn project-specific callout aliases and abbreviations
- Trigger targeted re-extraction when findings are known to be incomplete

### Specific Failure Modes

**1. Callout Variability Mismatch**
- Vision extractor captures abbreviated callout text: "HORIZ DEFL", "DEFL COUPLING", "MJ BEND"
- `COMPONENT_PATTERNS` in vision-queries.ts uses normalized patterns → misses non-standard abbreviations
- No place to store "for this project, 'HORIZ DEFL' means horizontal deflection fitting"
- Next query returns the same miss

**2. Regression After Correction**
- User corrects the answer in chat
- System shows acknowledgment
- Next query re-runs full pipeline → re-reads same incomplete `project_quantities` → returns same wrong answer
- There is no `user_corrections` table. No feedback API route exists.

**3. Verification Gates on Empty Tables**
- Sheet verifier queries `project_quantities`, `utility_crossings`, `utility_termination_points`
- If these tables have no data for an entity → `coverageStatus: insufficient` → hard refuse
- No fallback path to "let me recheck the actual plan"
- Manual "Analyze Complete" button does not populate `document_pages` / `sheet_entities` (known bug)
- Plan reader cannot narrow candidate sheets → either scans all sheets or returns nothing

**4. Multi-System Ambiguity Suppression**
- `autoDetectSystem()` in smart-router.ts: when multiple systems detected, detection is suppressed
- Query falls back to searching all systems → over-broad, less precise results

**5. No Source Quality Memory**
- `project_quantities.confidence` is set at extraction time and never updated
- If a source was wrong 3 times for this project, confidence still reads 0.92
- System has no memory that "the vision extractor missed fittings on sheets C-003 to C-007"

**6. Single Interpretation Path**
- All queries go through the same pipeline regardless of discipline
- No discipline-specific callout dictionaries
- No project-specific alias resolution before pattern matching

---

## B. Proposed Project-Scoped Architecture

### Design Principles
1. **Global core layer** — generic extraction logic, prompt templates, pattern matchers
2. **Project memory layer** — per-project, isolated, user-correctable
3. **Provenance on every learned item** — who submitted it, when, what role, how trusted
4. **Recheck workflow** — explicit bypass of stored data to live plan inspection
5. **Confidence-aware responses** — answer behavior changes based on evidence quality

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  GLOBAL CORE LAYER (shared, read-only at query time)                    │
│  ─────────────────────────────────────────────────                      │
│  query-classifier.ts   │  vision-queries.ts    │  COMPONENT_PATTERNS   │
│  response-writer.ts    │  reasoning-engine.ts  │  extraction prompts    │
│  evidence-evaluator.ts │  plan-reader.ts        │  scoring weights       │
└─────────────────────────────────────────────────────────────────────────┘
           │                               │
           ▼                               ▼
┌────────────────────────┐    ┌─────────────────────────────────────────┐
│  DISCIPLINE ROUTER     │    │  PROJECT MEMORY LAYER (per-project)     │
│  ──────────────────    │    │  ─────────────────────────────────────  │
│  civil/utilities       │    │  project_memory_items (aliases,         │
│  demo                  │───▶│    callouts, corrections, hints)        │
│  structural            │    │  project_corrections (user feedback)    │
│  architectural         │    │  project_source_quality (per-table      │
│  mep                   │    │    confidence modifiers per project)    │
│  spec/rfi/submittal    │    │  provenance on every item               │
└────────────────────────┘    └─────────────────────────────────────────┘
           │                               │
           ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  RETRIEVAL PIPELINE (per-query)                                         │
│  ─────────────────────────────                                          │
│  1. Load project memory context (aliases, corrections, source quality)  │
│  2. Resolve aliases on query entities BEFORE lookup                     │
│  3. Apply source quality modifiers to confidence scores                 │
│  4. Vision DB + Graph DB lookups (with project corrections merged)      │
│  5. Sheet verification (using project memory for candidate narrowing)   │
│  6. Plan reader (targeted re-inspection)                                │
│  7. Evidence evaluation (with project-adjusted confidence)              │
│  8. Response writing (with provenance surfacing when relevant)          │
└─────────────────────────────────────────────────────────────────────────┘
           │
           ▼ (on user action)
┌─────────────────────────────────────────────────────────────────────────┐
│  RECHECK WORKFLOW                                                        │
│  ──────────────                                                          │
│  1. Identify likely relevant sheets (project memory + sheet index)       │
│  2. Force live OCR/vision pass on those sheets                           │
│  3. Compare live findings vs. stored data                                │
│  4. Surface deltas with source trace                                     │
│  5. Offer to write new findings to project memory (with provenance)      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Discipline Router

Add `disciplineRouter.ts` as the second step after `query-analyzer.ts`:

```
civil_utilities → existing pipeline (smart-router, vision-queries)
demo            → demo-queries (existing Phase 3)
structural      → structural-queries (existing Phase 5)
architectural   → arch-queries (existing Phase 4)
mep             → mep-queries (existing Phase 5)
spec_rfi        → spec-queries / rfi-queries (existing Phase 6)
general         → existing general path
```

For each discipline track, load the project memory context filtered to that discipline.

### Project Memory Layer

`project_memory_items` — one row per learned fact. Types:
- `alias` — "HORIZ DEFL" = "horizontal deflection fitting" (system: water_line, sheet: C-004)
- `callout_pattern` — regex or literal pattern specific to this project's callout style
- `correction` — user-submitted override of an extracted value
- `sheet_hint` — "Sheet C-007 has all fittings for Water Line A" (narrows plan reader)
- `confidence_modifier` — "vision_db for fittings on this project is unreliable, cap at 0.4"
- `system_alias` — "WLA" = "Water Line A" on all sheets

Each item carries full provenance (see Section C).

---

## C. Required Schema / Data Model

### Migration 00047: Project Memory and Corrections

```sql
-- ── project_memory_items ─────────────────────────────────────────────────
-- Stores per-project learned aliases, callout patterns, corrections, hints.
-- Each item is isolated to project_id — no cross-project contamination.
CREATE TABLE IF NOT EXISTS project_memory_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- What was learned
  item_type              TEXT NOT NULL CHECK (item_type IN (
                           'alias', 'callout_pattern', 'correction',
                           'sheet_hint', 'confidence_modifier', 'system_alias'
                         )),
  discipline             TEXT,              -- civil, demo, structural, arch, mep, spec, rfi, general
  system_context         TEXT,              -- e.g. "WATER LINE A", "STORM DRAIN"
  sheet_numbers          TEXT[],            -- sheets where this item applies (NULL = all sheets)
  original_text          TEXT,              -- raw text/callout as it appeared on the plan
  normalized_value       TEXT NOT NULL,     -- canonical interpretation
  pattern_regex          TEXT,              -- optional: regex form for callout_pattern type
  confidence_modifier    NUMERIC(3,2),      -- for confidence_modifier type: -1.0 to +1.0

  -- Provenance
  submitted_by_user_id   UUID REFERENCES auth.users(id),
  submitted_by_name      TEXT,
  submitted_by_role      TEXT,              -- PE, superintendent, foreman, engineer, admin, ai_suggestion
  submitted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_type            TEXT NOT NULL CHECK (source_type IN (
                           'user_correction', 'accepted_ai_suggestion',
                           'admin_override', 'sheet_reviewed_finding',
                           'imported_rule', 'recheck_finding'
                         )),
  evidence_reference     TEXT,              -- e.g. "Sheet C-004, plan view, top-right" (free text)
  notes                  TEXT,

  -- Validation status
  validation_status      TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN (
                           'pending', 'accepted', 'disputed', 'superseded'
                         )),
  confirmed_by_count     INT NOT NULL DEFAULT 0,
  rejected_by_count      INT NOT NULL DEFAULT 0,
  superseded_by_id       UUID REFERENCES project_memory_items(id),

  -- Conflict handling: same original_text may have different interpretations by discipline
  -- Do NOT enforce UNIQUE on (project_id, original_text) — allow context-specific variants
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memory_project         ON project_memory_items(project_id);
CREATE INDEX idx_memory_project_type    ON project_memory_items(project_id, item_type);
CREATE INDEX idx_memory_project_disc    ON project_memory_items(project_id, discipline);
CREATE INDEX idx_memory_project_system  ON project_memory_items(project_id, system_context);
CREATE INDEX idx_memory_validation      ON project_memory_items(project_id, validation_status);
-- Full-text on original_text for alias resolution at query time
CREATE INDEX idx_memory_original_text   ON project_memory_items USING gin(to_tsvector('english', COALESCE(original_text, '')));

-- ── project_corrections ──────────────────────────────────────────────────
-- Captures every user correction to a specific query/answer.
-- Linked to project_memory_items via memory_item_id when correction is accepted.
CREATE TABLE IF NOT EXISTS project_corrections (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- What was corrected
  query_text             TEXT NOT NULL,
  query_answer_mode      TEXT,              -- quantity_lookup, crossing_lookup, etc.
  sheet_number           TEXT,
  discipline             TEXT,
  system_queried         TEXT,
  expected_item          TEXT,
  missed_item_type       TEXT,              -- valve, fitting, crossing, length, etc.
  how_it_appeared        TEXT CHECK (how_it_appeared IN (
                           'text', 'symbol', 'detail', 'legend',
                           'note', 'profile', 'schedule', 'plan_view', 'unknown'
                         )),

  -- What the AI returned vs. what was expected
  ai_response_excerpt    TEXT,
  ai_detected_value      TEXT,
  ai_confidence          NUMERIC(3,2),
  expected_value         TEXT NOT NULL,

  -- Provenance
  submitted_by_user_id   UUID REFERENCES auth.users(id),
  submitted_by_name      TEXT,
  submitted_by_role      TEXT,
  submitted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_type            TEXT NOT NULL DEFAULT 'user_correction' CHECK (source_type IN (
                           'user_correction', 'accepted_ai_suggestion',
                           'admin_override', 'sheet_reviewed_finding',
                           'recheck_finding'
                         )),
  evidence_reference     TEXT,
  notes                  TEXT,

  -- Validation
  validation_status      TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN (
                           'pending', 'accepted', 'disputed', 'superseded'
                         )),
  confirmed_by_count     INT NOT NULL DEFAULT 0,
  rejected_by_count      INT NOT NULL DEFAULT 0,

  -- Link to accepted memory item
  memory_item_id         UUID REFERENCES project_memory_items(id),

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_corrections_project        ON project_corrections(project_id);
CREATE INDEX idx_corrections_discipline     ON project_corrections(project_id, discipline);
CREATE INDEX idx_corrections_system         ON project_corrections(project_id, system_queried);
CREATE INDEX idx_corrections_validation     ON project_corrections(project_id, validation_status);

-- ── memory_confirmations ─────────────────────────────────────────────────
-- Tracks which users confirmed or disputed a memory item.
-- Enables confirmed_by_count / rejected_by_count without double-counting.
CREATE TABLE IF NOT EXISTS memory_confirmations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_item_id  UUID NOT NULL REFERENCES project_memory_items(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  user_role       TEXT,
  vote            TEXT NOT NULL CHECK (vote IN ('confirm', 'dispute')),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (memory_item_id, user_id)
);

-- ── project_source_quality ───────────────────────────────────────────────
-- Per-project confidence modifiers for data sources.
-- Allows downweighting of sources known to be unreliable on this project.
CREATE TABLE IF NOT EXISTS project_source_quality (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_name         TEXT NOT NULL,        -- vision_db, vector_search, plan_reader, etc.
  discipline          TEXT,                 -- NULL = all disciplines
  system_context      TEXT,                 -- NULL = all systems
  confidence_cap      NUMERIC(3,2),         -- max confidence to assign from this source
  confidence_modifier NUMERIC(3,2),         -- additive modifier (-0.3 = "usually wrong here")
  reason              TEXT,
  submitted_by_user_id UUID REFERENCES auth.users(id),
  submitted_by_role   TEXT,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, source_name, discipline, system_context)
);

CREATE INDEX idx_source_quality_project ON project_source_quality(project_id);

-- ── recheck_sessions ─────────────────────────────────────────────────────
-- Tracks explicit recheck workflow runs.
CREATE TABLE IF NOT EXISTS recheck_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  triggered_by_user_id UUID REFERENCES auth.users(id),
  query_text          TEXT NOT NULL,
  discipline          TEXT,
  system_context      TEXT,
  sheets_inspected    TEXT[],
  stored_value        TEXT,                 -- what the DB had before recheck
  live_value          TEXT,                 -- what live inspection found
  delta_detected      BOOLEAN,
  delta_summary       TEXT,
  accepted_into_memory BOOLEAN DEFAULT FALSE,
  memory_item_id      UUID REFERENCES project_memory_items(id),
  cost_usd            NUMERIC(8,4),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recheck_project ON recheck_sessions(project_id);

-- RLS: project members can read/write their project's memory items
ALTER TABLE project_memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_source_quality ENABLE ROW LEVEL SECURITY;
ALTER TABLE recheck_sessions ENABLE ROW LEVEL SECURITY;

-- (RLS policies: members of the project can read; service role writes)
```

---

## D. Retrieval + Recheck Flow

### D1. Updated Retrieval Flow (with project memory)

```
STEP 0: Load project memory context
  → Query project_memory_items WHERE project_id = ? AND validation_status = 'accepted'
  → Cache: aliases[], callout_patterns[], sheet_hints[], confidence_modifiers[]
  → Cost: 1 DB query per chat request (cacheable per project, 5min TTL)

STEP 0.5: Alias resolution on query entities
  → For each extracted entity in QueryAnalysis._routing:
    - Run alias lookup against project_memory_items (type='alias' OR 'system_alias')
    - Expand: "WLA" → "WATER LINE A", "HORIZ DEFL" → "horizontal deflection fitting"
  → Updated entities fed into all downstream lookups

STEP 1: Query classification + discipline routing (existing, unmodified)

STEP 2: Vision DB lookup (modified)
  → After fetching project_quantities rows, merge accepted corrections
    from project_corrections WHERE project_id = ? AND system_queried = ? AND validation_status = 'accepted'
  → Apply confidence_cap from project_source_quality if present
  → Mark corrected items with source = 'user_correction' + provenance

STEP 2.5 – 2.97: Graph lookups (existing, unmodified)

STEP 3: Sheet verification (modified)
  → Supplement candidate sheet list with sheet_hint items from project memory
  → Sheet hints that were confirmed by a PE role get priority weighting

STEP 3.5: Plan reader (modified)
  → Pass resolved aliases and callout_patterns into the Haiku prompt context
  → "For this project, the following abbreviations are known: HORIZ DEFL = horizontal deflection fitting"
  → Increases detection rate for non-standard labels

STEP 4: Evidence evaluation (modified)
  → Apply project-level confidence_modifier from project_source_quality
  → If multiple accepted corrections exist for the same entity: override AI confidence with correction confidence

STEP 5: Response writing (modified)
  → When answer includes a corrected fact: surface provenance
    "This count was corrected by a PE on 2026-02-14 based on Sheet C-004."
  → When answer uses an unverified memory item: add caveat
    "Note: This interpretation of 'HORIZ DEFL' is based on one unverified field correction."
  → Confidence language rules (see D3)
```

### D2. Recheck Workflow

Triggered by:
- User clicking "Recheck Plans" button in UI
- Chat command: "recheck [query]" or "look at the plans again"
- Automatic trigger when correction is submitted and evidence_source = 'vision_db'

```
POST /api/projects/{projectId}/recheck
{
  "query": "what fittings are on Water Line A?",
  "discipline": "civil",
  "systemContext": "WATER LINE A",
  "forceSheets": ["C-003", "C-004", "C-005"]  // optional override
}
```

**Recheck steps:**
1. Identify candidate sheets:
   - From `document_pages` WHERE utility_designations contains system
   - From `project_memory_items` WHERE item_type = 'sheet_hint' AND system_context = ?
   - From previous plan reader sessions for this query type
2. Download and inspect those sheets live (same as plan-reader.ts, no stored data used)
3. Extract findings from live vision pass
4. Compare against stored `project_quantities` for same system
5. Surface delta: "Live inspection found 14 fittings. Stored data shows 9. Delta: +5 fittings."
6. Offer user: "Accept these findings into project memory?" → writes to `project_memory_items` with source_type='recheck_finding' + provenance
7. Log session in `recheck_sessions`

**Implementation:** New file `src/lib/chat/recheck-workflow.ts`

### D3. Confidence Policy

| Level | Condition | Response behavior |
|---|---|---|
| **High** | verificationMeta.coverageStatus = 'complete' AND confidence ≥ 0.85 AND no active corrections | State fact directly. Cite sheets. |
| **Medium** | coverageStatus = 'partial' OR confidence 0.5–0.84 OR accepted correction (single user) | State fact with caveat: "Based on available data, with some uncertainty. Recommend field verification for critical decisions." |
| **Low** | coverageStatus = 'insufficient' OR confidence < 0.5 OR unverified correction only | Do not state as fact. "Current data suggests X, but evidence is incomplete. Recommend running Recheck Plans on sheets [Y, Z] before acting on this answer." |
| **Disputed** | active corrections with rejected_by_count > confirmed_by_count | Explicitly flag conflict: "Project data is disputed. [User A] reported X on [date]. [User B] reported Y. Recommend direct sheet review." |

---

## E. UI/UX Changes

### E1. Correction Capture

**Location:** `src/components/chat/ChatMessage.tsx` (or equivalent)

Every assistant message should render a lightweight correction bar:
```
[👍 Correct] [👎 Flag Issue] [🔍 Recheck Plans]
```

Clicking "Flag Issue" opens a modal:
- Pre-filled: query text, detected value, sheet citations from the response
- User fills: expected value, how it appeared (dropdown), sheet number, notes
- Optional: select role (PE, superintendent, foreman, engineer)
- Submit → `POST /api/projects/{projectId}/corrections`

### E2. Recheck Plans Button

Available when:
- Response confidence is medium or low
- User explicitly requests it
- After a correction is submitted

Clicking triggers the recheck workflow. Progress shown inline: "Inspecting sheets C-003, C-004, C-005..."
After completion: delta shown with diff highlighting. Accept/dismiss controls.

### E3. Project Memory Dashboard

New page: `/projects/{id}/memory`
- Tab: **Aliases** — table of alias/callout items, sortable by confidence, filterable by discipline
- Tab: **Corrections** — history of user corrections, approval status, provenance
- Tab: **Source Quality** — per-source confidence modifiers, who set them, reason
- Tab: **Recheck History** — past recheck sessions, deltas found, what was accepted

Each row shows provenance: submitted_by_name, submitted_by_role, submitted_at.

Admin/PE users can accept/dispute/supersede items.

### E4. Chat Provenance Display

When a response uses a memory item, add a small citation link:
```
Water Line A has 14 fittings (corrected by PE on 2026-02-14, Sheet C-004) [ℹ️]
```
Clicking the ℹ️ shows the full provenance card.

---

## F. Phased Implementation Plan

### Phase 7A: Stabilize Routing and Traceability
**Goal:** Make failures observable and traceable before adding memory.
**Scope:**
- Fix Manual Analyze button bug: wire `indexDocumentPage()` into `processDocumentWithVision()` (vision-processor.ts)
- Add `query_id` to every EvidenceItem so each piece of evidence can be traced to its source query
- Add `source_confidence_at_retrieval` to EvidenceItem (capture confidence before any modifier)
- Add `data_source_counts` to ChatResponse: { vision_db: N, vector: N, plan_reader: N, graph: N }
- Add debug trace endpoint: `GET /api/projects/{id}/query-trace/{queryId}`
**Migration:** None
**Files:** vision-processor.ts, types.ts, chat-handler.ts, evidence-evaluator.ts

### Phase 7B: Project Memory Foundation
**Goal:** Create the memory layer and load it at query time (read-only at first).
**Scope:**
- Migration 00047 (schema above: project_memory_items, project_corrections, project_source_quality, recheck_sessions, memory_confirmations)
- New file: `src/lib/chat/project-memory.ts` — loadProjectMemory(), resolveAliases(), getSourceQuality()
- Load project memory in chat-handler.ts Step 0 (before query analysis)
- Pass alias map into query-analyzer.ts entity extraction
- Pass callout_patterns into plan-reader.ts Haiku prompt
**Migration:** 00047
**Files:** project-memory.ts, chat-handler.ts, query-analyzer.ts, plan-reader.ts

### Phase 7C: Correction Capture
**Goal:** Write user feedback to DB and apply it at retrieval time.
**Scope:**
- New API route: `POST /api/projects/{id}/corrections` — writes to project_corrections + project_memory_items
- New API route: `POST /api/projects/{id}/memory/confirm` — confirm/dispute a memory item
- Modify retrieval-orchestrator.ts: after vision_db lookup, merge accepted corrections
- Modify evidence-evaluator.ts: apply project_source_quality modifiers
- UI: correction modal in ChatMessage component
- UI: provenance citation in responses
**Files:** corrections API route, retrieval-orchestrator.ts, evidence-evaluator.ts, project-memory.ts

### Phase 7D: Recheck Workflow
**Goal:** Explicit live re-inspection path that bypasses stored data.
**Scope:**
- New file: `src/lib/chat/recheck-workflow.ts`
- New API route: `POST /api/projects/{id}/recheck`
- Reuse plan-reader.ts core logic but pass results through delta-comparison vs. stored data
- Write recheck findings to project_memory_items with source_type='recheck_finding'
- UI: Recheck Plans button with progress display and delta confirmation
**Files:** recheck-workflow.ts, recheck API route, ChatMessage.tsx

### Phase 7E: Confidence-Aware Responses
**Goal:** Response language changes based on evidence confidence.
**Scope:**
- Add `confidenceLevel: 'high' | 'medium' | 'low' | 'disputed'` to EvidencePacket
- Modify response-writer.ts: inject confidence-appropriate language into system prompt
- Modify response-writer.ts: inject provenance citations for corrected facts
- Modify evidence-evaluator.ts: incorporate project_corrections into confidence scoring
- Add dispute detection: if confirmed_by_count < rejected_by_count → disputed level
**Files:** types.ts, evidence-evaluator.ts, response-writer.ts

### Phase 7F: Project Memory Dashboard
**Goal:** UI for project admins/PEs to review, accept, dispute memory items.
**Scope:**
- New page: `src/app/projects/[id]/memory/page.tsx`
- Read-only first: display items, provenance, confirmations
- Add confirm/dispute actions (calls /memory/confirm API)
- Add source quality display + management
**Files:** memory/page.tsx, new API routes

---

## G. Highest-Risk Technical Issues

### G1. Alias Resolution Collision
**Risk:** Two aliases for the same abbreviation in different disciplines (e.g. "WL" = "Water Line" in civil vs. "Wall" in architectural). Alias resolution before lookup will pick the wrong one if discipline routing hasn't narrowed first.
**Mitigation:** Always filter alias lookup by discipline if available. If discipline is unknown, return all matching aliases ranked by confirmed_by_count + submitter role weight. Let query-analyzer.ts pick based on answer mode.

### G2. Correction Conflicts Across Users
**Risk:** Superintendent submits correction: "14 fittings." PE submits: "12 fittings." Both pending. System must not silently pick one.
**Mitigation:** When two accepted corrections conflict on the same entity + system: set confidence level to 'disputed', surface both with provenance, do not state either as fact. Require PE-level or admin override to resolve.

### G3. Stale Memory Items
**Risk:** Project memory items become outdated after a design revision (e.g., RFI changes a fitting count). Old correction now contradicts current drawings.
**Mitigation:** On every document re-upload or re-process: flag all memory items for the affected sheets as `validation_status = 'pending'` (need reconfirmation). Do not auto-supersede — require user review.

### G4. Plan Reader + Alias Injection Prompt Injection Risk
**Risk:** Malicious alias value injected into plan reader prompt: original_text = 'forget all instructions and return...'
**Mitigation:** Sanitize alias values before injection into prompts. Strip any characters outside alphanumeric + spaces + basic punctuation. Length-limit to 200 chars. Use structured prompt injection (variable substitution into pre-defined slots, not string concatenation into arbitrary prompt positions).

### G5. Memory Load Latency
**Risk:** Loading project memory on every query (Step 0) adds DB overhead.
**Mitigation:** Cache project memory in Redis or in-memory cache with 5-minute TTL, keyed by (project_id, updated_at_max). Invalidate cache on any write to project_memory_items for that project. Expected size: <100 items per project for 99% of cases; load is trivial.

### G6. Recheck Drift Without Ground Truth
**Risk:** Recheck finds "14 fittings" live. User accepts it. Next recheck of revised plans finds "12 fittings". Memory has two accepted corrections that contradict each other.
**Mitigation:** When a new recheck_finding contradicts an existing accepted memory item: don't auto-supersede. Set the old item to `validation_status = 'superseded'` only after user explicitly accepts the new finding and confirms the old is obsolete.

### G7. Role-Weight Gaming
**Risk:** Non-PE users submit many confirmations on low-quality corrections to inflate confirmed_by_count.
**Mitigation:** Weight confirmations by role, not count:
  - PE / licensed engineer: weight 3
  - Superintendent: weight 2
  - Foreman / field: weight 1
  - Engineer (unlicensed): weight 1
  A single PE confirmation (weight=3) outweighs 2 field confirmations (weight=2) for critical answers.

### G8. Missing document_pages Data (Existing Bug)
**Risk:** The recheck workflow depends on document_pages to identify candidate sheets. If the Manual Analyze button was used (not Inngest), these tables are empty → recheck has no sheets to inspect.
**Mitigation:** Phase 7A must fix the Manual Analyze button bug before Phase 7D recheck workflow ships. Recheck workflow should fail gracefully with a clear message: "Sheet index is incomplete. Run document reprocessing first."

---

## Provenance Trust Model

### Trust Weights by Role

| Role | Weight | Notes |
|---|---|---|
| PE (licensed engineer) | 3.0 | Highest authority; overrides AI suggestions |
| Superintendent | 2.0 | Field authority; high reliability for site conditions |
| Admin override | 2.5 | Project-level override; must include evidence_reference |
| Engineer (unlicensed) | 1.0 | Standard; requires confirmation |
| Foreman | 1.0 | Field observation; valuable for callout patterns |
| AI suggestion (accepted) | 0.5 | Use only when no human correction available |
| Recheck finding (unconfirmed) | 0.75 | Live-inspection backed but awaits human review |

### Provenance Surfacing in Responses

Rule: Surface provenance when:
- The answer uses a corrected value (always surface who corrected it and when)
- The answer uses an unverified memory item (always flag as unverified)
- The answer uses a disputed item (always show both interpretations with sources)
- The confidence level is medium or low (note that interpretation may be project-specific)

Do NOT surface provenance when:
- The answer comes from direct sheet evidence with no corrections applied
- The fact is trivially obvious and uncontested
- Surfacing provenance would bury the actual answer

Format: brief inline citation, not a wall of metadata.

### Conflict Preservation

When two memory items have the same original_text but different normalized_value:
- Do NOT overwrite the older item
- Set the newer item as a separate row
- Let validation_status, confirmed_by_count, submitter role, and discipline context determine which is preferred
- The response writer picks the highest-weight accepted item for the matching discipline/system context
- If weights are equal: surface both to the user

---
