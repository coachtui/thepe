-- supabase/migrations/00048_utility_length_canonical.sql
CREATE TABLE utility_length_canonical (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  utility_name text NOT NULL,
  utility_type text,
  begin_station text,
  begin_station_numeric numeric,
  begin_sheet text,
  end_station text,
  end_station_numeric numeric,
  end_sheet text,
  length_lf numeric,
  confidence numeric,
  method text CHECK (method IN ('focused_reextraction', 'sheet_scoped', 'unscoped')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id, utility_name)
);

CREATE INDEX idx_utility_length_canonical_project
  ON utility_length_canonical(project_id);
