-- Add callout metadata columns to document_chunks table
-- These columns support the hybrid retrieval system for construction plans

-- Add columns for callout box metadata
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS contains_components boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS component_list text[],
  ADD COLUMN IF NOT EXISTS system_name text,
  ADD COLUMN IF NOT EXISTS station text;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_document_chunks_contains_components
  ON document_chunks(contains_components)
  WHERE contains_components = true;

CREATE INDEX IF NOT EXISTS idx_document_chunks_chunk_type
  ON document_chunks(chunk_type);

CREATE INDEX IF NOT EXISTS idx_document_chunks_system_name
  ON document_chunks(system_name)
  WHERE system_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_chunks_station
  ON document_chunks(station)
  WHERE station IS NOT NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN document_chunks.contains_components IS 'True if this chunk contains a callout box with component lists';
COMMENT ON COLUMN document_chunks.component_list IS 'Array of component descriptions extracted from callout box (e.g., "1 - 12-IN GATE VALVE")';
COMMENT ON COLUMN document_chunks.system_name IS 'System identifier extracted from callout box (e.g., "Water Line A")';
COMMENT ON COLUMN document_chunks.station IS 'Station number extracted from callout box (e.g., "13+00")';
