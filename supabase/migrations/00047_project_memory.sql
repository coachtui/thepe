-- Migration 00047: Project memory, corrections, confirmations, source quality, recheck sessions
--
-- Creates the project-scoped memory layer for Phase 7.
-- Every item is strictly isolated to its project_id — no cross-project contamination.
-- Provenance (submitted_by_user_id, submitted_by_role, source_type) is required on all rows.

-- ── project_memory_items ─────────────────────────────────────────────────────
-- Per-project learned aliases, callout patterns, corrections, and hints.
CREATE TABLE IF NOT EXISTS project_memory_items (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- What was learned
  item_type              TEXT         NOT NULL CHECK (item_type IN (
                           'alias', 'callout_pattern', 'correction',
                           'sheet_hint', 'confidence_modifier', 'system_alias'
                         )),
  discipline             TEXT,
  system_context         TEXT,
  sheet_numbers          TEXT[],
  original_text          TEXT,
  normalized_value       TEXT         NOT NULL,
  pattern_regex          TEXT,
  confidence_modifier    NUMERIC(3,2),

  -- Provenance (all three required — never null)
  submitted_by_user_id   UUID         NOT NULL REFERENCES auth.users(id),
  submitted_by_name      TEXT,
  submitted_by_role      TEXT         NOT NULL,
  submitted_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  source_type            TEXT         NOT NULL CHECK (source_type IN (
                           'user_correction', 'accepted_ai_suggestion',
                           'admin_override', 'sheet_reviewed_finding',
                           'imported_rule', 'recheck_finding'
                         )),
  evidence_reference     TEXT,
  notes                  TEXT,

  -- Validation
  validation_status      TEXT         NOT NULL DEFAULT 'pending' CHECK (validation_status IN (
                           'pending', 'accepted', 'disputed', 'superseded'
                         )),
  confirmed_by_count     INT          NOT NULL DEFAULT 0,
  rejected_by_count      INT          NOT NULL DEFAULT 0,
  superseded_by_id       UUID         REFERENCES project_memory_items(id),

  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memory_project        ON project_memory_items(project_id);
CREATE INDEX idx_memory_project_type   ON project_memory_items(project_id, item_type);
CREATE INDEX idx_memory_project_disc   ON project_memory_items(project_id, discipline);
CREATE INDEX idx_memory_project_system ON project_memory_items(project_id, system_context);
CREATE INDEX idx_memory_validation     ON project_memory_items(project_id, validation_status);
CREATE INDEX idx_memory_original_text  ON project_memory_items
  USING gin(to_tsvector('english', COALESCE(original_text, '')));

-- ── project_corrections ───────────────────────────────────────────────────────
-- Captures every user correction to a specific query/answer.
-- Linked to project_memory_items via memory_item_id when accepted.
CREATE TABLE IF NOT EXISTS project_corrections (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- What was corrected
  query_text             TEXT         NOT NULL,
  query_answer_mode      TEXT,
  sheet_number           TEXT,
  discipline             TEXT,
  system_queried         TEXT,
  expected_item          TEXT,
  missed_item_type       TEXT,
  how_it_appeared        TEXT         CHECK (how_it_appeared IN (
                           'text', 'symbol', 'detail', 'legend',
                           'note', 'profile', 'schedule', 'plan_view', 'unknown'
                         )),

  -- AI response vs. expected
  ai_response_excerpt    TEXT,
  ai_detected_value      TEXT,
  ai_confidence          NUMERIC(3,2),
  expected_value         TEXT         NOT NULL,

  -- Provenance (all three required — never null)
  submitted_by_user_id   UUID         NOT NULL REFERENCES auth.users(id),
  submitted_by_name      TEXT,
  submitted_by_role      TEXT         NOT NULL,
  submitted_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  source_type            TEXT         NOT NULL DEFAULT 'user_correction' CHECK (source_type IN (
                           'user_correction', 'accepted_ai_suggestion',
                           'admin_override', 'sheet_reviewed_finding',
                           'recheck_finding'
                         )),
  evidence_reference     TEXT,
  notes                  TEXT,

  -- Validation
  validation_status      TEXT         NOT NULL DEFAULT 'pending' CHECK (validation_status IN (
                           'pending', 'accepted', 'disputed', 'superseded'
                         )),
  confirmed_by_count     INT          NOT NULL DEFAULT 0,
  rejected_by_count      INT          NOT NULL DEFAULT 0,

  -- Link to accepted memory item (set when correction is promoted)
  memory_item_id         UUID         REFERENCES project_memory_items(id),

  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_corrections_project    ON project_corrections(project_id);
CREATE INDEX idx_corrections_discipline ON project_corrections(project_id, discipline);
CREATE INDEX idx_corrections_system     ON project_corrections(project_id, system_queried);
CREATE INDEX idx_corrections_validation ON project_corrections(project_id, validation_status);

-- ── memory_confirmations ──────────────────────────────────────────────────────
-- Tracks per-user votes on memory items.
-- UNIQUE(memory_item_id, user_id) prevents double-voting.
CREATE TABLE IF NOT EXISTS memory_confirmations (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_item_id  UUID         NOT NULL REFERENCES project_memory_items(id) ON DELETE CASCADE,
  user_id         UUID         NOT NULL REFERENCES auth.users(id),
  user_role       TEXT,
  vote            TEXT         NOT NULL CHECK (vote IN ('confirm', 'dispute')),
  note            TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (memory_item_id, user_id)
);

CREATE INDEX idx_confirmations_item ON memory_confirmations(memory_item_id);
CREATE INDEX idx_confirmations_user ON memory_confirmations(user_id);

-- ── project_source_quality ────────────────────────────────────────────────────
-- Per-project confidence modifiers for data sources.
-- UNIQUE(project_id, source_name, discipline, system_context) prevents duplicates.
CREATE TABLE IF NOT EXISTS project_source_quality (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_name          TEXT         NOT NULL,
  discipline           TEXT,
  system_context       TEXT,
  confidence_cap       NUMERIC(3,2),
  confidence_modifier  NUMERIC(3,2),
  reason               TEXT,
  submitted_by_user_id UUID         REFERENCES auth.users(id),
  submitted_by_role    TEXT,
  submitted_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, source_name, discipline, system_context)
);

CREATE INDEX idx_source_quality_project ON project_source_quality(project_id);

-- ── recheck_sessions ──────────────────────────────────────────────────────────
-- Audit trail for every explicit recheck workflow run.
CREATE TABLE IF NOT EXISTS recheck_sessions (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  triggered_by_user_id  UUID         REFERENCES auth.users(id),
  query_text            TEXT         NOT NULL,
  discipline            TEXT,
  system_context        TEXT,
  sheets_inspected      TEXT[],
  stored_value          TEXT,
  live_value            TEXT,
  delta_detected        BOOLEAN,
  delta_summary         TEXT,
  accepted_into_memory  BOOLEAN      DEFAULT FALSE,
  memory_item_id        UUID         REFERENCES project_memory_items(id),
  cost_usd              NUMERIC(8,4),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recheck_project ON recheck_sessions(project_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE project_memory_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_corrections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_confirmations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_source_quality ENABLE ROW LEVEL SECURITY;
ALTER TABLE recheck_sessions       ENABLE ROW LEVEL SECURITY;

-- Service role bypasses all policies
CREATE POLICY "Service role full access to project_memory_items"
  ON project_memory_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to project_corrections"
  ON project_corrections FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to memory_confirmations"
  ON memory_confirmations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to project_source_quality"
  ON project_source_quality FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to recheck_sessions"
  ON recheck_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Authenticated users can read their project's memory items
CREATE POLICY "Project members can read project_memory_items"
  ON project_memory_items FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can read project_corrections"
  ON project_corrections FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can read memory_confirmations"
  ON memory_confirmations FOR SELECT TO authenticated
  USING (
    memory_item_id IN (
      SELECT id FROM project_memory_items
      WHERE project_id IN (
        SELECT project_id FROM project_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Project members can read project_source_quality"
  ON project_source_quality FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can read recheck_sessions"
  ON recheck_sessions FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );
