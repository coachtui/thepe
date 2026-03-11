-- Fix ambiguous column reference in calculate_utility_length function
-- Error: column reference "utility_name" is ambiguous

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
      AND utility_termination_points.utility_name ILIKE '%' || p_utility_name || '%'
      AND termination_type = 'BEGIN'
      AND station_numeric IS NOT NULL
    ORDER BY confidence DESC NULLS LAST, created_at DESC
    LIMIT 1;

    -- Find END point
    SELECT * INTO v_end_point
    FROM utility_termination_points
    WHERE project_id = p_project_id
      AND utility_termination_points.utility_name ILIKE '%' || p_utility_name || '%'
      AND termination_type = 'END'
      AND station_numeric IS NOT NULL
    ORDER BY confidence DESC NULLS LAST, created_at DESC
    LIMIT 1;

    -- If both found, calculate length
    IF v_begin_point IS NOT NULL AND v_end_point IS NOT NULL THEN
        -- Fix: explicitly reference the record fields to avoid ambiguity
        RETURN QUERY SELECT
            v_begin_point.utility_name::TEXT,
            v_begin_point.station::TEXT,
            v_end_point.station::TEXT,
            v_begin_point.sheet_number::TEXT,
            v_end_point.sheet_number::TEXT,
            (v_end_point.station_numeric - v_begin_point.station_numeric)::NUMERIC,
            LEAST(v_begin_point.confidence, v_end_point.confidence)::NUMERIC,
            'calculated_from_termination_points'::TEXT;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION calculate_utility_length(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION calculate_utility_length IS 'Fixed version - resolves ambiguous column reference error by explicitly casting record fields';
