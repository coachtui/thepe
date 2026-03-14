-- Migration 00046: component_callouts table
--
-- Stores raw fitting/component callout text captured from plan sheets.
-- These are abbreviated labels such as "HORIZ DEFL", "DEFL COUPLING",
-- "MJ BEND", "RED", "TEE", "CAP" that appear near fitting symbols in
-- plan views and are not captured by the profile-view quantity extraction.
--
-- Rationale: the profile-view extraction (project_quantities) requires a
-- full structured label.  Abbreviated plan-view callouts carry real field
-- information and must never be silently discarded.

CREATE TABLE IF NOT EXISTS component_callouts (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID         NOT NULL REFERENCES projects(id)       ON DELETE CASCADE,
  document_id          UUID         NOT NULL REFERENCES documents(id)      ON DELETE CASCADE,
  document_page_id     UUID                  REFERENCES document_pages(id) ON DELETE SET NULL,
  page_number          INT          NOT NULL,
  sheet_number         TEXT,
  raw_callout_text     TEXT         NOT NULL,
  normalized_component TEXT,
  component_family     TEXT,
  associated_system    TEXT,
  station              TEXT,
  source_view          TEXT         CHECK (source_view IN ('plan', 'profile', 'detail', 'unknown'))
                                    DEFAULT 'unknown',
  confidence           FLOAT        NOT NULL DEFAULT 0.8
                                    CHECK (confidence BETWEEN 0.0 AND 1.0),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast lookups by project + sheet
CREATE INDEX idx_callouts_project       ON component_callouts (project_id);
CREATE INDEX idx_callouts_project_sheet ON component_callouts (project_id, sheet_number);
CREATE INDEX idx_callouts_project_sys   ON component_callouts (project_id, associated_system);

-- Trigram index for fuzzy text search (extension already enabled by prior migrations)
CREATE INDEX idx_callouts_text_trgm ON component_callouts
  USING gin (raw_callout_text gin_trgm_ops);

-- RLS: service-role bypasses; anon can read within their project
ALTER TABLE component_callouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to component_callouts"
  ON component_callouts FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read project component_callouts"
  ON component_callouts FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );
