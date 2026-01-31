-- Fix search_quantities to return station_from and station_to for proper deduplication
-- This allows the chat system to distinguish between multiple instances of the same item at different stations

-- Drop the existing function first (required when changing return type)
DROP FUNCTION IF EXISTS search_quantities(UUID, TEXT, INTEGER);

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
    station_from TEXT,
    station_to TEXT,
    description TEXT,
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
        pq.station_from,
        pq.station_to,
        pq.description,
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
