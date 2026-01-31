-- Migration: Add Utility Crossings Table
-- Created: 2026-01-29
-- Purpose: Store utility crossing data extracted from profile views
--          Tracks where different utilities cross each other

-- ============================================================================
-- PART 1: Create utility_crossings table
-- ============================================================================

CREATE TABLE IF NOT EXISTS utility_crossings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- References
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id UUID REFERENCES document_chunks(id) ON DELETE SET NULL,

    -- Crossing utility identification
    crossing_utility TEXT NOT NULL, -- Abbreviation: "ELEC", "SS", "STM", "GAS", "TEL", "W", "FO"
    utility_full_name TEXT NOT NULL, -- Full name: "Electrical", "Sanitary Sewer", "Storm Drain", etc.

    -- Location information
    station TEXT, -- Station where crossing occurs (e.g., "5+23.50")
    station_numeric NUMERIC, -- Normalized numeric value for queries
    elevation NUMERIC, -- Elevation of crossing in feet (e.g., 35.73)

    -- Utility characteristics
    is_existing BOOLEAN DEFAULT false,
    is_proposed BOOLEAN DEFAULT false,
    size TEXT, -- Pipe/cable size (e.g., "12-IN", "4-IN")

    -- Additional context
    sheet_number TEXT, -- Sheet where crossing was found
    notes TEXT, -- Additional context or descriptive notes

    -- Source tracking
    source_type TEXT CHECK (source_type IN ('vision', 'text', 'manual')) DEFAULT 'vision',
    confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1), -- 0.0 to 1.0

    -- Vision metadata
    vision_data JSONB, -- Raw vision analysis for this crossing
    extracted_at TIMESTAMPTZ DEFAULT NOW(),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PART 2: Create indexes
-- ============================================================================

-- Primary lookup indexes
CREATE INDEX idx_crossings_project ON utility_crossings(project_id);
CREATE INDEX idx_crossings_utility ON utility_crossings(project_id, crossing_utility);

-- Full name search
CREATE INDEX idx_crossings_full_name ON utility_crossings(project_id, utility_full_name);

-- Sheet number lookup
CREATE INDEX idx_crossings_sheet ON utility_crossings(project_id, sheet_number)
WHERE sheet_number IS NOT NULL;

-- Station-based queries
CREATE INDEX idx_crossings_station_numeric ON utility_crossings(project_id, station_numeric)
WHERE station_numeric IS NOT NULL;

-- Existing vs proposed filtering
CREATE INDEX idx_crossings_existing ON utility_crossings(project_id, is_existing)
WHERE is_existing = true;
CREATE INDEX idx_crossings_proposed ON utility_crossings(project_id, is_proposed)
WHERE is_proposed = true;

-- Full-text search on utility names
CREATE INDEX idx_crossings_full_name_trgm ON utility_crossings
USING gin (utility_full_name gin_trgm_ops);

-- ============================================================================
-- PART 3: Add comments for documentation
-- ============================================================================

COMMENT ON TABLE utility_crossings IS 'Stores utility crossing data extracted from profile views showing where utilities intersect';
COMMENT ON COLUMN utility_crossings.crossing_utility IS 'Utility abbreviation as shown on drawings (ELEC, SS, STM, GAS, etc.)';
COMMENT ON COLUMN utility_crossings.utility_full_name IS 'Full utility name (Electrical, Sanitary Sewer, Storm Drain, etc.)';
COMMENT ON COLUMN utility_crossings.station IS 'Station number where crossing occurs';
COMMENT ON COLUMN utility_crossings.elevation IS 'Elevation or depth of crossing in feet';
COMMENT ON COLUMN utility_crossings.is_existing IS 'Whether this is an existing utility';
COMMENT ON COLUMN utility_crossings.is_proposed IS 'Whether this is a proposed utility';
COMMENT ON COLUMN utility_crossings.size IS 'Pipe or cable size (e.g., 12-IN)';
COMMENT ON COLUMN utility_crossings.confidence IS 'Confidence score from extraction (0.0 to 1.0)';

-- ============================================================================
-- PART 4: Create helper functions
-- ============================================================================

-- Function to search for utility crossings with fuzzy matching
CREATE OR REPLACE FUNCTION search_utility_crossings(
    p_project_id UUID,
    p_utility_search TEXT DEFAULT NULL,
    p_sheet_number TEXT DEFAULT NULL,
    p_existing_only BOOLEAN DEFAULT NULL,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id UUID,
    crossing_utility TEXT,
    utility_full_name TEXT,
    station TEXT,
    station_numeric NUMERIC,
    elevation NUMERIC,
    is_existing BOOLEAN,
    is_proposed BOOLEAN,
    size TEXT,
    sheet_number TEXT,
    notes TEXT,
    confidence NUMERIC,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        uc.id,
        uc.crossing_utility,
        uc.utility_full_name,
        uc.station,
        uc.station_numeric,
        uc.elevation,
        uc.is_existing,
        uc.is_proposed,
        uc.size,
        uc.sheet_number,
        uc.notes,
        uc.confidence,
        CASE
            WHEN p_utility_search IS NULL THEN 1.0
            ELSE GREATEST(
                SIMILARITY(uc.utility_full_name, p_utility_search),
                SIMILARITY(uc.crossing_utility, p_utility_search)
            )
        END as similarity
    FROM utility_crossings uc
    WHERE
        uc.project_id = p_project_id
        AND (
            p_utility_search IS NULL
            OR uc.utility_full_name ILIKE '%' || p_utility_search || '%'
            OR uc.crossing_utility ILIKE '%' || p_utility_search || '%'
            OR SIMILARITY(uc.utility_full_name, p_utility_search) > 0.3
        )
        AND (p_sheet_number IS NULL OR uc.sheet_number = p_sheet_number)
        AND (p_existing_only IS NULL OR uc.is_existing = p_existing_only)
    ORDER BY
        CASE
            WHEN p_utility_search IS NULL THEN 0
            ELSE GREATEST(
                SIMILARITY(uc.utility_full_name, p_utility_search),
                SIMILARITY(uc.crossing_utility, p_utility_search)
            )
        END DESC,
        uc.confidence DESC NULLS LAST,
        uc.station_numeric ASC NULLS LAST,
        uc.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to count utility crossings by type
CREATE OR REPLACE FUNCTION count_utility_crossings_by_type(
    p_project_id UUID
)
RETURNS TABLE (
    crossing_utility TEXT,
    utility_full_name TEXT,
    total_count BIGINT,
    existing_count BIGINT,
    proposed_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        uc.crossing_utility,
        uc.utility_full_name,
        COUNT(*) as total_count,
        SUM(CASE WHEN uc.is_existing THEN 1 ELSE 0 END) as existing_count,
        SUM(CASE WHEN uc.is_proposed THEN 1 ELSE 0 END) as proposed_count
    FROM utility_crossings uc
    WHERE uc.project_id = p_project_id
    GROUP BY uc.crossing_utility, uc.utility_full_name
    ORDER BY total_count DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 5: Add RLS policies
-- ============================================================================

-- Enable RLS
ALTER TABLE utility_crossings ENABLE ROW LEVEL SECURITY;

-- Users can view crossings for their projects
CREATE POLICY "Users can view crossings for their projects"
ON utility_crossings FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = utility_crossings.project_id
        AND pm.user_id = auth.uid()
    )
);

-- Users can insert crossings for their projects
CREATE POLICY "Users can insert crossings for their projects"
ON utility_crossings FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = utility_crossings.project_id
        AND pm.user_id = auth.uid()
    )
);

-- Users can update crossings for their projects
CREATE POLICY "Users can update crossings for their projects"
ON utility_crossings FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = utility_crossings.project_id
        AND pm.user_id = auth.uid()
    )
);

-- Users can delete crossings for their projects
CREATE POLICY "Users can delete crossings for their projects"
ON utility_crossings FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = utility_crossings.project_id
        AND pm.user_id = auth.uid()
    )
);

-- ============================================================================
-- PART 6: Create trigger for updated_at
-- ============================================================================

CREATE TRIGGER update_utility_crossings_updated_at
    BEFORE UPDATE ON utility_crossings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 7: Grant permissions
-- ============================================================================

-- Grant execute on functions to authenticated users
GRANT EXECUTE ON FUNCTION search_utility_crossings(UUID, TEXT, TEXT, BOOLEAN, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION count_utility_crossings_by_type(UUID) TO authenticated;

-- ============================================================================
-- End of migration
-- ============================================================================
