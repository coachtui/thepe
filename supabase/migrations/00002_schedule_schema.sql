-- Migration: Schedule Schema for Construction Copilot
-- Created: 2025-01-27

-- Schedule Activities
CREATE TABLE schedule_activities (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  activity_id text NOT NULL,
  activity_name text NOT NULL,
  description text,
  early_start date,
  early_finish date,
  late_start date,
  late_finish date,
  actual_start date,
  actual_finish date,
  duration_days integer,
  percent_complete numeric(5,2) DEFAULT 0,
  is_critical boolean DEFAULT false,
  total_float_days integer,
  wbs_code text,
  responsible_party text,
  cost_code text,
  calendar text DEFAULT 'standard',
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT chk_dates CHECK (early_start <= early_finish),
  CONSTRAINT chk_late_dates CHECK (late_start <= late_finish),
  CONSTRAINT chk_percent CHECK (percent_complete >= 0 AND percent_complete <= 100)
);

-- Activity Predecessors (logic relationships)
CREATE TABLE activity_predecessors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id uuid REFERENCES schedule_activities(id) ON DELETE CASCADE,
  predecessor_id uuid REFERENCES schedule_activities(id) ON DELETE CASCADE,
  relationship_type text CHECK (relationship_type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Activity-Document Links
CREATE TABLE activity_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id uuid REFERENCES schedule_activities(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  relevance_type text,
  created_at timestamptz DEFAULT now()
);

-- Schedule Versions (for tracking updates)
CREATE TABLE schedule_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  version_date date NOT NULL,
  description text,
  is_baseline boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Add version reference to activities
ALTER TABLE schedule_activities ADD COLUMN version_id uuid REFERENCES schedule_versions(id);

-- Schedule Indexes
CREATE INDEX idx_schedule_activities_project ON schedule_activities(project_id);
CREATE INDEX idx_schedule_activities_dates ON schedule_activities(early_start, early_finish);
CREATE INDEX idx_schedule_activities_critical ON schedule_activities(is_critical);
CREATE INDEX idx_activity_predecessors_activity ON activity_predecessors(activity_id);
CREATE INDEX idx_activity_documents_activity ON activity_documents(activity_id);
CREATE INDEX idx_schedule_versions_project ON schedule_versions(project_id);
