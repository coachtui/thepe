-- Migration: Add Utility Termination Points Table
-- Created: 2026-01-28
-- Purpose: Store BEGIN/END termination points extracted from actual plan/profile drawings
--          This allows accurate length calculations from actual drawings rather than index sheets

-- ============================================================================
-- PART 1: Create utility_termination_points table
-- ============================================================================

CREATE TABLE IF NOT EXISTS utility_termination_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- References
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id UUID REFERENCES document_chunks(id) ON DELETE SET NULL,

    -- Utility identification
    utility_name TEXT NOT NULL, -- e.g., "Water Line A", "Storm Drain B"
    utility_type TEXT, -- 'water', 'storm', 'sewer', 'gas', 'electric', etc.

    -- Termination point information
    termination_type TEXT NOT NULL CHECK (termination_type IN ('BEGIN', 'END', 'TIE-IN', 'TERMINUS')),
    station TEXT NOT NULL, -- e.g., "0+00", "32+62.01"
    station_numeric NUMERIC, -- Normalized numeric value for calculations (e.g., 3262.01)

    -- Additional context
    sheet_number TEXT, -- Sheet where this termination was found
    notes TEXT, -- e.g., "= ROAD 'A' B STA 42+64.00", "Connects to existing"
    location_description TEXT, -- Human-readable location

    -- Source tracking
    source_type TEXT CHECK (source_type IN ('vision', 'text', 'manual')) DEFAULT 'vision',
    confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1), -- 0.0 to 1.0

    -- Vision metadata
    vision_data JSONB, -- Raw vision analysis for this termination point
    extracted_at TIMESTAMPTZ DEFAULT NOW(),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PART 2: Create indexes
-- ============================================================================

-- Primary lookup indexes
CREATE INDEX idx_termination_project ON utility_termination_points(project_id);
CREATE INDEX idx_termination_utility ON utility_termination_points(project_id, utility_name);
CREATE INDEX idx_termination_type ON utility_termination_points(project_id, termination_type);

-- Utility type filtering
CREATE INDEX idx_termination_utility_type ON utility_termination_points(project_id, utility_type)
WHERE utility_type IS NOT NULL;

-- Sheet number lookup
CREATE INDEX idx_termination_sheet ON utility_termination_points(project_id, sheet_number)
WHERE sheet_number IS NOT NULL;

-- Station-based queries
CREATE INDEX idx_termination_station_numeric ON utility_termination_points(project_id, station_numeric)
WHERE station_numeric IS NOT NULL;

-- Compound index for efficient utility + type lookups
CREATE INDEX idx_termination_utility_and_type ON utility_termination_points(project_id, utility_name, termination_type);

-- Full-text search on utility names
CREATE INDEX idx_termination_utility_name_trgm ON utility_termination_points
USING gin (utility_name gin_trgm_ops);

-- ============================================================================
-- PART 3: Add comments for documentation
-- ============================================================================

COMMENT ON TABLE utility_termination_points IS 'Stores BEGIN/END termination points extracted from actual plan/profile drawings for accurate length calculations';
COMMENT ON COLUMN utility_termination_points.utility_name IS 'Display name of utility (e.g., "Water Line A")';
COMMENT ON COLUMN utility_termination_points.termination_type IS 'Type of termination: BEGIN (start), END (finish), TIE-IN (connects to existing), or TERMINUS (dead end)';
COMMENT ON COLUMN utility_termination_points.station IS 'Station number as shown on drawing (e.g., "32+62.01")';
COMMENT ON COLUMN utility_termination_points.station_numeric IS 'Numeric station value for calculations (e.g., 3262.01)';
COMMENT ON COLUMN utility_termination_points.sheet_number IS 'Sheet number where termination point appears';
COMMENT ON COLUMN utility_termination_points.notes IS 'Additional context like cross-references or connections';
COMMENT ON COLUMN utility_termination_points.source_type IS 'How termination was found: vision (from Claude Vision), text (from text extraction), or manual';
COMMENT ON COLUMN utility_termination_points.confidence IS 'Confidence score from extraction (0.0 to 1.0)';

-- ============================================================================
-- PART 4: Create helper functions
-- ============================================================================

-- Function to calculate utility length from termination points
CREATE OR REPLACE FUNCTION calculate_utility_length(
    p_project_id UUID,
    p_utility_name TEXT
)
RETURNS TABLE (
    utility_name TEXT,
    begin_station TEXT,
    end_station TEXT,
    begin_sheet TEXT,
    end_sheet TEXT,
    length_lf NUMERIC,
    confidence NUMERIC,
    method TEXT
) AS $$
DECLARE
    v_begin_point RECORD;
    v_end_point RECORD;
BEGIN
    -- Find BEGIN point
    SELECT * INTO v_begin_point
    FROM utility_termination_points
    WHERE project_id = p_project_id
      AND utility_name ILIKE '%' || p_utility_name || '%'
      AND termination_type = 'BEGIN'
      AND station_numeric IS NOT NULL
    ORDER BY confidence DESC NULLS LAST, created_at DESC
    LIMIT 1;

    -- Find END point
    SELECT * INTO v_end_point
    FROM utility_termination_points
    WHERE project_id = p_project_id
      AND utility_name ILIKE '%' || p_utility_name || '%'
      AND termination_type = 'END'
      AND station_numeric IS NOT NULL
    ORDER BY confidence DESC NULLS LAST, created_at DESC
    LIMIT 1;

    -- If both found, calculate length
    IF v_begin_point IS NOT NULL AND v_end_point IS NOT NULL THEN
        RETURN QUERY SELECT
            v_begin_point.utility_name,
            v_begin_point.station,
            v_end_point.station,
            v_begin_point.sheet_number,
            v_end_point.sheet_number,
            v_end_point.station_numeric - v_begin_point.station_numeric,
            LEAST(v_begin_point.confidence, v_end_point.confidence),
            'calculated_from_termination_points'::TEXT;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql;

-- Function to search for termination points with fuzzy matching
CREATE OR REPLACE FUNCTION search_termination_points(
    p_project_id UUID,
    p_utility_search TEXT,
    p_termination_type TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    utility_name TEXT,
    termination_type TEXT,
    station TEXT,
    station_numeric NUMERIC,
    sheet_number TEXT,
    confidence NUMERIC,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        utp.id,
        utp.utility_name,
        utp.termination_type,
        utp.station,
        utp.station_numeric,
        utp.sheet_number,
        utp.confidence,
        SIMILARITY(utp.utility_name, p_utility_search) as similarity
    FROM utility_termination_points utp
    WHERE
        utp.project_id = p_project_id
        AND (
            utp.utility_name ILIKE '%' || p_utility_search || '%'
            OR SIMILARITY(utp.utility_name, p_utility_search) > 0.3
        )
        AND (p_termination_type IS NULL OR utp.termination_type = p_termination_type)
    ORDER BY
        SIMILARITY(utp.utility_name, p_utility_search) DESC,
        utp.confidence DESC NULLS LAST,
        utp.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 5: Create view for utility length summary
-- ============================================================================

CREATE OR REPLACE VIEW utility_length_summary AS
SELECT
    p.id as project_id,
    p.name as project_name,
    begin_pts.utility_name,
    begin_pts.utility_type,
    begin_pts.station as begin_station,
    begin_pts.sheet_number as begin_sheet,
    begin_pts.station_numeric as begin_station_numeric,
    end_pts.station as end_station,
    end_pts.sheet_number as end_sheet,
    end_pts.station_numeric as end_station_numeric,
    (end_pts.station_numeric - begin_pts.station_numeric) as length_lf,
    LEAST(begin_pts.confidence, end_pts.confidence) as confidence,
    'calculated_from_drawings' as source_method
FROM projects p
INNER JOIN utility_termination_points begin_pts ON p.id = begin_pts.project_id
    AND begin_pts.termination_type = 'BEGIN'
    AND begin_pts.station_numeric IS NOT NULL
INNER JOIN utility_termination_points end_pts ON p.id = end_pts.project_id
    AND end_pts.utility_name = begin_pts.utility_name
    AND end_pts.termination_type = 'END'
    AND end_pts.station_numeric IS NOT NULL
WHERE end_pts.station_numeric > begin_pts.station_numeric;

COMMENT ON VIEW utility_length_summary IS 'Calculated utility lengths from BEGIN/END termination points found on actual drawings';

-- ============================================================================
-- PART 6: Add RLS policies
-- ============================================================================

-- Enable RLS
ALTER TABLE utility_termination_points ENABLE ROW LEVEL SECURITY;

-- Users can view termination points for their projects
CREATE POLICY "Users can view termination points for their projects"
ON utility_termination_points FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = utility_termination_points.project_id
        AND pm.user_id = auth.uid()
    )
);

-- Users can insert termination points for their projects
CREATE POLICY "Users can insert termination points for their projects"
ON utility_termination_points FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = utility_termination_points.project_id
        AND pm.user_id = auth.uid()
    )
);

-- Users can update termination points for their projects
CREATE POLICY "Users can update termination points for their projects"
ON utility_termination_points FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = utility_termination_points.project_id
        AND pm.user_id = auth.uid()
    )
);

-- Users can delete termination points for their projects
CREATE POLICY "Users can delete termination points for their projects"
ON utility_termination_points FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = utility_termination_points.project_id
        AND pm.user_id = auth.uid()
    )
);

-- ============================================================================
-- PART 7: Create trigger for updated_at
-- ============================================================================

CREATE TRIGGER update_utility_termination_points_updated_at
    BEFORE UPDATE ON utility_termination_points
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 8: Grant permissions
-- ============================================================================

-- Grant execute on functions to authenticated users
GRANT EXECUTE ON FUNCTION calculate_utility_length(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION search_termination_points(UUID, TEXT, TEXT, INTEGER) TO authenticated;

-- Grant select on view to authenticated users
GRANT SELECT ON utility_length_summary TO authenticated;

-- ============================================================================
-- End of migration
-- ============================================================================
