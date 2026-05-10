-- Reconciliation sessions: persists imported external rows and match decisions
-- so users can resume review across page refreshes.

CREATE TABLE reconciliation_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_name TEXT NOT NULL,
  external_rows    JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress', 'complete')),
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One decision per (session, external_row, generated_item) pair
CREATE TABLE reconciliation_decisions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL REFERENCES reconciliation_sessions(id) ON DELETE CASCADE,
  external_row_id    TEXT NOT NULL,
  generated_item_id  TEXT NOT NULL,
  decision           TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected')),
  decided_by         UUID REFERENCES auth.users(id),
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, external_row_id, generated_item_id)
);

CREATE INDEX ON reconciliation_sessions (project_id, created_at DESC);
CREATE INDEX ON reconciliation_decisions (session_id);

ALTER TABLE reconciliation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project members read reconciliation sessions"
  ON reconciliation_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = reconciliation_sessions.project_id
        AND project_members.user_id = auth.uid()
    )
  );

CREATE POLICY "project members read reconciliation decisions"
  ON reconciliation_decisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM reconciliation_sessions s
      JOIN project_members pm ON pm.project_id = s.project_id
      WHERE s.id = reconciliation_decisions.session_id
        AND pm.user_id = auth.uid()
    )
  );
