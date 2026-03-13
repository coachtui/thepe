-- Migration 00045: Add cross-reference index columns to document_pages
--
-- These columns are used by the candidate sheet narrowing engine to:
--   1. Follow detail references across sheets without querying vision_data JSONB
--   2. Trace match-line continuations for linear systems
--   3. Efficiently find sheets that reference a given sheet number
--
-- Before this migration, the narrowing engine extracted cross-references from
-- vision_data->'crossReferences' at query time (slow, not indexed).
-- After this migration, references are stored as indexed TEXT[] columns.
--
-- Backfill: run the UPDATE statements below after applying the migration to
-- populate the columns for existing rows.

-- Add columns
ALTER TABLE document_pages
  ADD COLUMN IF NOT EXISTS cross_references    TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS match_line_sheets   TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS detail_refs         TEXT[] DEFAULT '{}';

-- GIN indexes for fast array-contains queries
CREATE INDEX IF NOT EXISTS idx_document_pages_cross_refs
  ON document_pages USING GIN (cross_references);

CREATE INDEX IF NOT EXISTS idx_document_pages_match_lines
  ON document_pages USING GIN (match_line_sheets);

CREATE INDEX IF NOT EXISTS idx_document_pages_detail_refs
  ON document_pages USING GIN (detail_refs);

-- Backfill cross_references from existing vision_data JSONB
-- (safe to run multiple times — overwrites only rows that have vision_data)
UPDATE document_pages
SET cross_references = ARRAY(
  SELECT DISTINCT UPPER(TRIM(ref ->> 'reference'))
  FROM jsonb_array_elements(vision_data -> 'crossReferences') AS ref
  WHERE ref ->> 'type' = 'sheet'
    AND ref ->> 'reference' IS NOT NULL
    AND LENGTH(TRIM(ref ->> 'reference')) <= 20
)
WHERE vision_data IS NOT NULL
  AND vision_data -> 'crossReferences' IS NOT NULL
  AND jsonb_array_length(vision_data -> 'crossReferences') > 0;

-- Backfill detail_refs from vision_data
UPDATE document_pages
SET detail_refs = ARRAY(
  SELECT DISTINCT TRIM(ref ->> 'reference')
  FROM jsonb_array_elements(vision_data -> 'crossReferences') AS ref
  WHERE ref ->> 'type' = 'detail'
    AND ref ->> 'reference' IS NOT NULL
)
WHERE vision_data IS NOT NULL
  AND vision_data -> 'crossReferences' IS NOT NULL
  AND jsonb_array_length(vision_data -> 'crossReferences') > 0;

-- Add project_id to sheet_entities if missing (needed for direct narrowing queries)
-- (Already present per migration 00044, this is a safety check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sheet_entities' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE sheet_entities ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
    CREATE INDEX idx_sheet_entities_project_entity_type
      ON sheet_entities (project_id, entity_type);
  END IF;
END $$;

-- Composite index on document_pages for the discipline narrowing query
CREATE INDEX IF NOT EXISTS idx_document_pages_project_discipline
  ON document_pages USING GIN (project_id, disciplines)
  WHERE project_id IS NOT NULL;

-- Index for sheet type narrowing
CREATE INDEX IF NOT EXISTS idx_document_pages_project_sheet_type
  ON document_pages (project_id, sheet_type)
  WHERE sheet_type IS NOT NULL;

-- Index for station range overlap queries
CREATE INDEX IF NOT EXISTS idx_document_pages_station_range
  ON document_pages (project_id, station_start_numeric, station_end_numeric)
  WHERE has_stations = TRUE
    AND station_start_numeric IS NOT NULL
    AND station_end_numeric IS NOT NULL;
