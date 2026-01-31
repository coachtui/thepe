-- Migration: Add support for quantities, vision analysis, and enhanced metadata
-- Purpose: Enable structured quantity extraction and vision-based document analysis
-- Date: 2026-01-28

-- ============================================================================
-- PART 0: Enable required extensions
-- ============================================================================

-- Enable trigram extension for fuzzy string matching (needed for gin_trgm_ops)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- PART 1: Enhance document_chunks table with vision and metadata
-- ============================================================================

-- Add columns to existing document_chunks table
ALTER TABLE document_chunks
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS vision_data JSONB,
ADD COLUMN IF NOT EXISTS is_critical_sheet BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS extracted_quantities JSONB,
ADD COLUMN IF NOT EXISTS stations JSONB, -- Array of station numbers found in chunk
ADD COLUMN IF NOT EXISTS sheet_type TEXT, -- 'title', 'summary', 'plan', 'profile', 'detail', 'legend'
ADD COLUMN IF NOT EXISTS vision_processed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS vision_model_version TEXT;

-- Backfill project_id for existing document_chunks from documents table
UPDATE document_chunks dc
SET project_id = d.project_id
FROM documents d
WHERE dc.document_id = d.id
AND dc.project_id IS NULL;

-- Add index for project_id lookups
CREATE INDEX IF NOT EXISTS idx_document_chunks_project
ON document_chunks(project_id);

-- Add index for critical sheets (high-value sheets like title, summary)
CREATE INDEX IF NOT EXISTS idx_critical_sheets
ON document_chunks(project_id, is_critical_sheet)
WHERE is_critical_sheet = TRUE;

-- Add index for sheet type filtering
CREATE INDEX IF NOT EXISTS idx_sheet_type
ON document_chunks(project_id, sheet_type)
WHERE sheet_type IS NOT NULL;

-- Add GIN index for JSONB columns for fast queries
CREATE INDEX IF NOT EXISTS idx_extracted_quantities_gin
ON document_chunks USING GIN (extracted_quantities);

CREATE INDEX IF NOT EXISTS idx_stations_gin
ON document_chunks USING GIN (stations);

-- Add comment for documentation
COMMENT ON COLUMN document_chunks.project_id IS 'Denormalized project_id for faster queries (derived from documents table)';
COMMENT ON COLUMN document_chunks.vision_data IS 'Full vision analysis output from Claude Vision API';
COMMENT ON COLUMN document_chunks.is_critical_sheet IS 'True if sheet contains critical info (title, summary, quantities)';
COMMENT ON COLUMN document_chunks.extracted_quantities IS 'Structured quantities extracted from vision analysis';
COMMENT ON COLUMN document_chunks.stations IS 'Array of station numbers (e.g., ["13+00", "15+50", "36+00"])';
COMMENT ON COLUMN document_chunks.sheet_type IS 'Type of sheet: title, summary, plan, profile, detail, legend';

-- ============================================================================
-- PART 2: Create project_quantities table for structured quantity storage
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_quantities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id UUID REFERENCES document_chunks(id) ON DELETE SET NULL,

    -- Item identification
    item_name TEXT NOT NULL, -- e.g., "Water Line A", "Storm Drain B"
    item_type TEXT, -- 'waterline', 'storm_drain', 'sewer', 'paving', 'curb', 'sidewalk', etc.
    item_number TEXT, -- e.g., "WL-A", "SD-B"

    -- Quantity information
    quantity NUMERIC,
    unit TEXT, -- 'LF', 'SF', 'CY', 'EA', 'SY', 'TON'
    description TEXT,

    -- Station/location information
    station_from TEXT, -- e.g., "13+00"
    station_to TEXT, -- e.g., "36+00"
    location_description TEXT,

    -- Source tracking
    sheet_number TEXT,
    source_type TEXT CHECK (source_type IN ('vision', 'text', 'calculated', 'manual')),
    confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1), -- 0.0 to 1.0

    -- Additional metadata
    metadata JSONB, -- Flexible storage for additional data

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for project_quantities
CREATE INDEX idx_quantities_project ON project_quantities(project_id);
CREATE INDEX idx_quantities_document ON project_quantities(document_id);
CREATE INDEX idx_quantities_item_name ON project_quantities(project_id, item_name);
CREATE INDEX idx_quantities_item_type ON project_quantities(project_id, item_type) WHERE item_type IS NOT NULL;
CREATE INDEX idx_quantities_sheet ON project_quantities(project_id, sheet_number) WHERE sheet_number IS NOT NULL;
CREATE INDEX idx_quantities_source ON project_quantities(project_id, source_type);

-- Add full-text search on item names for fuzzy matching
CREATE INDEX idx_quantities_item_name_trgm ON project_quantities USING gin (item_name gin_trgm_ops);

-- Comments
COMMENT ON TABLE project_quantities IS 'Structured quantities extracted from construction documents';
COMMENT ON COLUMN project_quantities.item_name IS 'Display name of item (e.g., "Water Line A")';
COMMENT ON COLUMN project_quantities.item_type IS 'Category of item for filtering';
COMMENT ON COLUMN project_quantities.source_type IS 'How quantity was extracted: vision, text, calculated, or manual';
COMMENT ON COLUMN project_quantities.confidence IS 'Confidence score from extraction (0.0 to 1.0)';

-- ============================================================================
-- PART 3: Create query_analytics table for tracking query performance
-- ============================================================================

CREATE TABLE IF NOT EXISTS query_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Query information
    query_text TEXT NOT NULL,
    query_type TEXT, -- 'quantity', 'location', 'specification', 'detail', 'general'
    query_classification JSONB, -- Full classification output

    -- Response information
    response_text TEXT,
    response_method TEXT, -- 'direct_lookup', 'vector_search', 'hybrid', 'vision'
    sources JSONB, -- Array of source references

    -- Quality metrics
    success BOOLEAN,
    user_feedback_rating INTEGER CHECK (user_feedback_rating >= 1 AND user_feedback_rating <= 5),
    user_feedback_text TEXT,

    -- Performance metrics
    latency_ms INTEGER,
    tokens_used INTEGER,
    cost_usd NUMERIC(10, 6),

    -- Search details
    vector_search_results INTEGER,
    direct_lookup_results INTEGER,
    vision_calls_made INTEGER,

    -- Metadata
    metadata JSONB,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for query_analytics
CREATE INDEX idx_analytics_project ON query_analytics(project_id);
CREATE INDEX idx_analytics_user ON query_analytics(user_id);
CREATE INDEX idx_analytics_query_type ON query_analytics(project_id, query_type) WHERE query_type IS NOT NULL;
CREATE INDEX idx_analytics_method ON query_analytics(project_id, response_method);
CREATE INDEX idx_analytics_created ON query_analytics(project_id, created_at DESC);
CREATE INDEX idx_analytics_success ON query_analytics(project_id, success) WHERE success IS NOT NULL;

-- Comments
COMMENT ON TABLE query_analytics IS 'Tracks all user queries for analytics and continuous improvement';
COMMENT ON COLUMN query_analytics.response_method IS 'Primary method used to generate response';
COMMENT ON COLUMN query_analytics.latency_ms IS 'Total response time in milliseconds';

-- ============================================================================
-- PART 4: Create helper functions for quantity searching
-- ============================================================================

-- Function to normalize station numbers for comparison
CREATE OR REPLACE FUNCTION normalize_station(station TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Convert "13+68.83" to "001368.83" for numeric comparison
    -- Convert "STA 13+68.83" to "001368.83"
    -- Handle null/empty
    IF station IS NULL OR station = '' THEN
        RETURN NULL;
    END IF;

    -- Remove "STA" prefix and spaces
    station := REGEXP_REPLACE(station, '^\s*STA\s*', '', 'i');
    station := REGEXP_REPLACE(station, '\s+', '', 'g');

    -- Split on "+" and combine
    -- "13+68.83" -> ["13", "68.83"] -> "001368.83"
    IF station ~ '\+' THEN
        DECLARE
            parts TEXT[];
            major_station TEXT;
            minor_station TEXT;
        BEGIN
            parts := STRING_TO_ARRAY(station, '+');
            major_station := LPAD(parts[1], 4, '0');
            minor_station := COALESCE(parts[2], '00');
            RETURN major_station || minor_station;
        END;
    END IF;

    RETURN station;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to calculate station distance
CREATE OR REPLACE FUNCTION station_distance(sta1 TEXT, sta2 TEXT)
RETURNS NUMERIC AS $$
DECLARE
    norm1 TEXT;
    norm2 TEXT;
    val1 NUMERIC;
    val2 NUMERIC;
BEGIN
    norm1 := normalize_station(sta1);
    norm2 := normalize_station(sta2);

    IF norm1 IS NULL OR norm2 IS NULL THEN
        RETURN NULL;
    END IF;

    val1 := norm1::NUMERIC;
    val2 := norm2::NUMERIC;

    RETURN ABS(val1 - val2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to search quantities with fuzzy matching
CREATE OR REPLACE FUNCTION search_quantities(
    p_project_id UUID,
    p_search_term TEXT,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    item_name TEXT,
    item_type TEXT,
    quantity NUMERIC,
    unit TEXT,
    sheet_number TEXT,
    confidence NUMERIC,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pq.id,
        pq.item_name,
        pq.item_type,
        pq.quantity,
        pq.unit,
        pq.sheet_number,
        pq.confidence,
        SIMILARITY(pq.item_name, p_search_term) as similarity
    FROM project_quantities pq
    WHERE
        pq.project_id = p_project_id
        AND (
            pq.item_name ILIKE '%' || p_search_term || '%'
            OR pq.item_number ILIKE '%' || p_search_term || '%'
            OR SIMILARITY(pq.item_name, p_search_term) > 0.3
        )
    ORDER BY
        CASE
            WHEN pq.item_name ILIKE p_search_term THEN 1
            WHEN pq.item_name ILIKE p_search_term || '%' THEN 2
            WHEN pq.item_name ILIKE '%' || p_search_term THEN 3
            ELSE 4
        END,
        SIMILARITY(pq.item_name, p_search_term) DESC,
        pq.confidence DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 5: Add RLS policies for new tables
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE project_quantities ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_analytics ENABLE ROW LEVEL SECURITY;

-- RLS for project_quantities (same access as projects)
CREATE POLICY "Users can view quantities for their projects"
ON project_quantities FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = project_quantities.project_id
        AND pm.user_id = auth.uid()
    )
);

CREATE POLICY "Users can insert quantities for their projects"
ON project_quantities FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = project_quantities.project_id
        AND pm.user_id = auth.uid()
    )
);

CREATE POLICY "Users can update quantities for their projects"
ON project_quantities FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = project_quantities.project_id
        AND pm.user_id = auth.uid()
    )
);

CREATE POLICY "Users can delete quantities for their projects"
ON project_quantities FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = project_quantities.project_id
        AND pm.user_id = auth.uid()
    )
);

-- RLS for query_analytics (users can see their own and their project's analytics)
CREATE POLICY "Users can view their own query analytics"
ON query_analytics FOR SELECT
USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = query_analytics.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('admin', 'project_manager')
    )
);

CREATE POLICY "Users can insert their own query analytics"
ON query_analytics FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own query analytics"
ON query_analytics FOR UPDATE
USING (user_id = auth.uid());

-- ============================================================================
-- PART 6: Create updated_at trigger for project_quantities
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_project_quantities_updated_at
    BEFORE UPDATE ON project_quantities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 7: Create view for quantity summary by project
-- ============================================================================

CREATE OR REPLACE VIEW project_quantity_summary AS
SELECT
    p.id as project_id,
    p.name as project_name,
    pq.item_type,
    COUNT(DISTINCT pq.id) as item_count,
    COUNT(DISTINCT pq.document_id) as document_count,
    AVG(pq.confidence) as avg_confidence,
    json_agg(
        json_build_object(
            'item_name', pq.item_name,
            'quantity', pq.quantity,
            'unit', pq.unit,
            'sheet_number', pq.sheet_number,
            'confidence', pq.confidence
        ) ORDER BY pq.confidence DESC
    ) as items
FROM projects p
LEFT JOIN project_quantities pq ON p.id = pq.project_id
GROUP BY p.id, p.name, pq.item_type;

COMMENT ON VIEW project_quantity_summary IS 'Summary of all quantities by project and item type';

-- ============================================================================
-- PART 8: Grant appropriate permissions
-- ============================================================================

-- Grant execute on functions to authenticated users
GRANT EXECUTE ON FUNCTION normalize_station(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION station_distance(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION search_quantities(UUID, TEXT, INTEGER) TO authenticated;

-- Grant select on view to authenticated users
GRANT SELECT ON project_quantity_summary TO authenticated;

-- ============================================================================
-- End of migration
-- ============================================================================
