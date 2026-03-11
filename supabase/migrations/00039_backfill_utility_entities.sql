-- Migration: Backfill Utility Data into Universal Entity Model
-- Created: 2026-03-10
-- Revised:  2026-03-10  (complete rewrite — v2)
--
-- IDEMPOTENCY
--   Safe to re-run. Every insert is guarded by ON CONFLICT or NOT EXISTS.
--
-- AUTHORITY
--   Legacy tables remain authoritative. No legacy data is modified.
--   This migration only adds rows to the entity graph tables.
--
-- ENTITY FAMILIES (discipline = 'utility')
--   entity_type = 'linear_asset' — pipe / main / line rows from project_quantities
--                                  (item_type IN waterline/storm_drain/sewer/gas/… OR unit = LF/SY)
--   entity_type = 'component'    — fittings, valves, structures from project_quantities
--                                  (everything that is not a linear_asset)
--   entity_type = 'junction'     — termination points from utility_termination_points
--   entity_type = 'crossing'     — utility crossing events from utility_crossings
--
-- CANONICAL NAME RULES
--   linear_asset / component:
--     UPPER(REGEXP_REPLACE(TRIM(item_name), '\s+', '_', 'g'))
--     Multiple pq rows with the same item_name → one entity (first by confidence DESC).
--     All rows contribute findings; only the highest-confidence row sets legacy_quantity_id.
--
--   junction:
--     UPPER(REGEXP_REPLACE(TRIM(utility_name), '\s+', '_', 'g'))
--       || '_' || termination_type
--       || '_' || RIGHT(id::TEXT, 8)
--     The id suffix makes each physical termination point uniquely addressable even when
--     the same utility has multiple TIE-IN or TERMINUS points.
--
--   crossing:
--     'CROSSING_' || UPPER(crossing_utility)
--       || '_' || COALESCE(REPLACE(station, '+', '_'), 'NOSTATION')
--       || '_' || RIGHT(id::TEXT, 8)
--     The id suffix prevents collisions when two crossings of the same utility
--     occur at the same station (rare but possible).
--
-- STATUS MAPPING
--   is_existing = TRUE            → 'existing'
--   is_proposed = TRUE (only)     → 'proposed'
--   neither / NULL                → 'existing'   (safe default)
--
-- SUPPORT LEVEL MAPPING  (entity_findings.support_level)
--   source_type IN ('vision','text','manual') → 'explicit'
--   source_type = 'calculated'               → 'inferred'
--   NULL / other                             → 'unknown'
--
-- RELATIONSHIPS CREATED
--   junction → linear_asset  :  'located_in'
--     Matched when UPPER(REGEXP_REPLACE(utp.utility_name,'\s+','_','g'))
--       equals a known linear_asset canonical_name in the same project.
--     Unmatched junctions (utility name has no corresponding linear_asset) are
--     still backfilled as standalone entities with their location data.
--
--   crossing → linear_asset  :  deferred to Phase 3.
--     The host utility line cannot be reliably identified from crossing rows alone
--     without project-level context (which utility is being installed).
--
-- KNOWN GAPS (carried forward from migration 00038)
--   A. entity_citations.entity_id composite FK cross-project enforcement: deferred.
--   B. finding_id / relationship_id composite FK on entity_citations: deferred.
--   C. entity_relationships.citation_id project_id check: deferred.
--
-- ============================================================================
-- PART 1: normalize_station()
--   Converts surveyor "N+NN.NN" format to decimal feet.
--   Examples: "13+00" → 1300.00   "24+93.06" → 2493.06
--   Returns NULL for any format that cannot be safely converted.
--   IMMUTABLE so it can be used in index expressions if needed.
-- ============================================================================

DROP FUNCTION IF EXISTS normalize_station(TEXT);

CREATE OR REPLACE FUNCTION normalize_station(station_text TEXT)
RETURNS NUMERIC AS $$
DECLARE
  cleaned TEXT;
  parts   TEXT[];
BEGIN
  IF station_text IS NULL OR TRIM(station_text) = '' THEN
    RETURN NULL;
  END IF;

  -- Strip leading "STA" prefix
  cleaned := REGEXP_REPLACE(TRIM(station_text), '^\s*STA\s*', '', 'i');
  cleaned := TRIM(cleaned);

  -- Surveyor format: digits + "+" + digits[.digits]
  IF cleaned ~ '^\d+\+\d+(\.\d+)?$' THEN
    parts := regexp_split_to_array(cleaned, '\+');
    RETURN (parts[1]::NUMERIC * 100) + parts[2]::NUMERIC;
  END IF;

  -- Plain numeric (already normalised)
  IF cleaned ~ '^\d+(\.\d+)?$' THEN
    RETURN cleaned::NUMERIC;
  END IF;

  -- Anything else (offsets, annotations, road references) → NULL
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- PART 1b: Wipe entity graph tables before backfilling
--
-- All rows in these tables are 100% derived from legacy tables (project_quantities,
-- utility_termination_points, utility_crossings). Truncating before re-inserting
-- ensures this migration is safe to re-run even if a previous partial run left
-- duplicate or inconsistent rows.
--
-- Order matters: entity_citations references entity_findings + entity_relationships,
-- so it must be truncated first to avoid FK violation errors.
-- ============================================================================

TRUNCATE entity_citations, entity_findings, entity_relationships, entity_locations, project_entities;

-- ============================================================================
-- PART 2: project_entities from project_quantities
--
-- Deduplication: one entity per (project_id, canonical_name).
-- When multiple rows share the same item_name, the row with the highest
-- confidence (ties broken by earliest created_at) becomes the representative
-- row that sets legacy_quantity_id and source provenance.
-- All rows contribute findings in Part 3.
-- ============================================================================

INSERT INTO project_entities (
    project_id, discipline, entity_type, subtype,
    canonical_name, display_name, label,
    status, confidence, extraction_source,
    source_document_id, source_chunk_id,
    legacy_quantity_id, metadata, created_at, updated_at
)
SELECT DISTINCT ON (pq.project_id, UPPER(REGEXP_REPLACE(TRIM(pq.item_name), '\s+', '_', 'g')))
    pq.project_id,
    'utility',
    -- linear_asset: the utility run / pipe itself
    -- component:    discrete fittings, valves, structures
    CASE
        WHEN LOWER(COALESCE(pq.item_type, '')) IN
             ('waterline', 'water', 'storm_drain', 'storm', 'sewer',
              'gas', 'electric', 'telecom', 'fiber', 'reclaimed')
          OR (pq.item_type IS NULL AND LOWER(COALESCE(pq.unit, '')) IN ('lf', 'sy'))
        THEN 'linear_asset'
        ELSE 'component'
    END,
    COALESCE(pq.item_type, 'general'),  -- subtype
    -- canonical_name: stable machine ID, scoped to project
    UPPER(REGEXP_REPLACE(TRIM(pq.item_name), '\s+', '_', 'g')),
    pq.item_name,      -- display_name
    pq.item_number,    -- label (drawing tag)
    'existing',        -- status default; adjusted below for specific types
    pq.confidence,
    -- extraction_source: use original source; all values are valid for project_entities
    pq.source_type,
    pq.document_id,
    pq.chunk_id,
    pq.id,             -- legacy_quantity_id = the representative row
    jsonb_build_object(
        'primary_quantity', pq.quantity,
        'unit',             pq.unit,
        'station_from',     pq.station_from,
        'station_to',       pq.station_to,
        'sheet_number',     pq.sheet_number
    ),
    pq.created_at,
    pq.updated_at
FROM project_quantities pq
WHERE NOT EXISTS (
    SELECT 1 FROM project_entities pe2
    WHERE  pe2.project_id    = pq.project_id
      AND  pe2.canonical_name = UPPER(REGEXP_REPLACE(TRIM(pq.item_name), '\s+', '_', 'g'))
)
ORDER BY
    pq.project_id,
    UPPER(REGEXP_REPLACE(TRIM(pq.item_name), '\s+', '_', 'g')),
    pq.confidence DESC NULLS LAST,
    pq.created_at ASC;

-- ============================================================================
-- PART 3: entity_findings (quantity) — one finding per project_quantities row
--
-- ALL rows for the same item_name contribute findings to the shared entity.
-- Idempotency: guarded by NOT EXISTS check on metadata->>'source_id'.
-- ============================================================================

INSERT INTO entity_findings (
    project_id, entity_id, finding_type,
    numeric_value, unit, statement,
    support_level, confidence, metadata, created_at
)
SELECT
    pe.project_id,
    pe.id,
    'quantity',
    pq.quantity,
    pq.unit,
    -- Human-readable statement
    TRIM(pq.item_name)
      || CASE WHEN pq.quantity IS NOT NULL
              THEN ': ' || pq.quantity::TEXT || ' ' || COALESCE(pq.unit, '')
              ELSE '' END
      || CASE WHEN pq.station_from IS NOT NULL AND pq.station_to IS NOT NULL
              THEN ' (Sta. ' || pq.station_from || ' to ' || pq.station_to || ')'
              WHEN pq.station_from IS NOT NULL
              THEN ' (from Sta. ' || pq.station_from || ')'
              ELSE '' END,
    CASE
        WHEN pq.source_type IN ('vision', 'text', 'manual') THEN 'explicit'
        WHEN pq.source_type = 'calculated'                  THEN 'inferred'
        ELSE 'unknown'
    END,
    pq.confidence,
    jsonb_build_object(
        'source_table',  'project_quantities',
        'source_id',      pq.id,
        'sheet_number',   pq.sheet_number,
        'description',    pq.description
    ),
    pq.created_at
FROM project_entities pe
JOIN project_quantities pq
     ON  pe.project_id   = pq.project_id
     AND pe.canonical_name = UPPER(REGEXP_REPLACE(TRIM(pq.item_name), '\s+', '_', 'g'))
WHERE pq.quantity IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM entity_findings ef
      WHERE  ef.entity_id          = pe.id
        AND  ef.finding_type       = 'quantity'
        AND  ef.metadata->>'source_id' = pq.id::TEXT
  );

-- ============================================================================
-- PART 4: entity_locations (station range) from project_quantities
--
-- One primary location per entity (via the representative row: legacy_quantity_id).
-- Skipped if the entity already has any location (idempotent).
-- ============================================================================

INSERT INTO entity_locations (
    entity_id, project_id, location_type,
    station_value, station_numeric,
    station_to, station_to_numeric,
    sheet_number, is_primary, description, created_at
)
SELECT
    pe.id,
    pe.project_id,
    'station',
    pq.station_from,
    normalize_station(pq.station_from),
    pq.station_to,
    normalize_station(pq.station_to),
    pq.sheet_number,
    TRUE,
    pq.location_description,
    pq.created_at
FROM project_entities pe
JOIN project_quantities pq ON pe.legacy_quantity_id = pq.id
WHERE pq.station_from IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM entity_locations el
      WHERE  el.entity_id = pe.id
        AND  el.is_primary = TRUE
  );

-- ============================================================================
-- PART 5: entity_citations from project_quantities
--
-- One citation per entity pointing at its source document/chunk.
-- Skipped when source_document_id is NULL or citation already exists.
-- ============================================================================

INSERT INTO entity_citations (
    project_id, entity_id,
    document_id, chunk_id, sheet_number,
    extraction_source, confidence, created_at
)
SELECT
    pe.project_id,
    pe.id,
    pe.source_document_id,
    pe.source_chunk_id,
    pq.sheet_number,
    -- Citations use restricted vocabulary: 'vision'/'text'/'manual'/'imported'
    CASE
        WHEN pq.source_type IN ('vision', 'text', 'manual') THEN pq.source_type
        ELSE 'imported'
    END,
    pq.confidence,
    pq.created_at
FROM project_entities pe
JOIN project_quantities pq ON pe.legacy_quantity_id = pq.id
WHERE pe.source_document_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM entity_citations ec
      WHERE  ec.entity_id   = pe.id
        AND  ec.document_id = pe.source_document_id
  );

-- ============================================================================
-- PART 6: project_entities from utility_termination_points
--
-- Each physical termination point → one entity.
-- canonical_name includes id suffix to uniquely address all points,
-- including cases where one utility has multiple TIE-IN or TERMINUS entries.
-- ============================================================================

INSERT INTO project_entities (
    project_id, discipline, entity_type, subtype,
    canonical_name, display_name, label,
    status, confidence, extraction_source,
    source_document_id, source_chunk_id,
    legacy_termination_id, metadata, created_at, updated_at
)
SELECT
    utp.project_id,
    'utility',
    'junction',
    utp.utility_type,
    -- canonical: UTILITY_NAME_TERMTYPE_lastUIDchars
    UPPER(REGEXP_REPLACE(TRIM(utp.utility_name), '\s+', '_', 'g'))
      || '_' || utp.termination_type
      || '_' || RIGHT(utp.id::TEXT, 8),
    utp.utility_name || ' ' || utp.termination_type,   -- display_name
    utp.termination_type,                               -- label
    'existing',
    utp.confidence,
    utp.source_type,
    utp.document_id,
    utp.chunk_id,
    utp.id,
    jsonb_build_object(
        'termination_type', utp.termination_type,
        'station',          utp.station,
        'station_numeric',  utp.station_numeric,
        'utility_name',     utp.utility_name,
        'notes',            utp.notes
    ),
    utp.created_at,
    utp.updated_at
FROM utility_termination_points utp
WHERE NOT EXISTS (
    SELECT 1 FROM project_entities pe2
    WHERE  pe2.project_id    = utp.project_id
      AND  pe2.canonical_name =
               UPPER(REGEXP_REPLACE(TRIM(utp.utility_name), '\s+', '_', 'g'))
               || '_' || utp.termination_type
               || '_' || RIGHT(utp.id::TEXT, 8)
);

-- ============================================================================
-- PART 7: entity_findings (note) from utility_termination_points
--
-- Human-readable statement capturing what this termination point is.
-- ============================================================================

INSERT INTO entity_findings (
    project_id, entity_id, finding_type,
    text_value, statement,
    support_level, confidence, metadata, created_at
)
SELECT
    pe.project_id,
    pe.id,
    'note',
    utp.termination_type,
    utp.utility_name || ' ' || utp.termination_type || ' at station ' || utp.station
      || CASE WHEN utp.notes IS NOT NULL THEN ' — ' || utp.notes ELSE '' END,
    CASE
        WHEN utp.source_type IN ('vision', 'text', 'manual') THEN 'explicit'
        ELSE 'unknown'
    END,
    utp.confidence,
    jsonb_build_object(
        'source_table', 'utility_termination_points',
        'source_id',    utp.id
    ),
    utp.created_at
FROM project_entities pe
JOIN utility_termination_points utp ON pe.legacy_termination_id = utp.id
WHERE NOT EXISTS (
    SELECT 1 FROM entity_findings ef
    WHERE  ef.entity_id              = pe.id
      AND  ef.finding_type           = 'note'
      AND  ef.metadata->>'source_id' = utp.id::TEXT
);

-- ============================================================================
-- PART 8: entity_locations from utility_termination_points
--
-- One primary station location per junction entity.
-- ============================================================================

INSERT INTO entity_locations (
    entity_id, project_id, location_type,
    station_value, station_numeric,
    sheet_number, is_primary, created_at
)
SELECT
    pe.id,
    pe.project_id,
    'station',
    utp.station,
    utp.station_numeric,
    utp.sheet_number,
    TRUE,
    utp.created_at
FROM project_entities pe
JOIN utility_termination_points utp ON pe.legacy_termination_id = utp.id
WHERE NOT EXISTS (
    SELECT 1 FROM entity_locations el
    WHERE  el.entity_id = pe.id
      AND  el.is_primary = TRUE
);

-- ============================================================================
-- PART 9: entity_citations from utility_termination_points
-- ============================================================================

INSERT INTO entity_citations (
    project_id, entity_id,
    document_id, chunk_id, sheet_number,
    extraction_source, confidence, created_at
)
SELECT
    pe.project_id,
    pe.id,
    pe.source_document_id,
    pe.source_chunk_id,
    utp.sheet_number,
    CASE
        WHEN utp.source_type IN ('vision', 'text', 'manual') THEN utp.source_type
        ELSE 'imported'
    END,
    utp.confidence,
    utp.created_at
FROM project_entities pe
JOIN utility_termination_points utp ON pe.legacy_termination_id = utp.id
WHERE pe.source_document_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM entity_citations ec
      WHERE  ec.entity_id   = pe.id
        AND  ec.document_id = pe.source_document_id
  );

-- ============================================================================
-- PART 10: project_entities from utility_crossings
--
-- Each crossing event → one entity.
-- canonical_name includes id suffix to handle:
--   (a) crossings without a station value
--   (b) two crossings of the same utility at the same station
-- ============================================================================

INSERT INTO project_entities (
    project_id, discipline, entity_type, subtype,
    canonical_name, display_name, label,
    status, confidence, extraction_source,
    source_document_id, source_chunk_id,
    legacy_crossing_id, metadata, created_at, updated_at
)
SELECT
    uc.project_id,
    'utility',
    'crossing',
    uc.crossing_utility,
    -- canonical: CROSSING_UTIL_STATION_lastUIDchars
    'CROSSING_' || UPPER(uc.crossing_utility)
      || '_' || COALESCE(REPLACE(uc.station, '+', '_'), 'NOSTATION')
      || '_' || RIGHT(uc.id::TEXT, 8),
    uc.utility_full_name || ' crossing at '
      || COALESCE(uc.station, 'unknown station'),
    uc.crossing_utility,    -- label (short tag)
    CASE
        WHEN uc.is_existing              THEN 'existing'
        WHEN uc.is_proposed              THEN 'proposed'
        WHEN NOT uc.is_existing AND NOT uc.is_proposed  THEN 'existing'
        ELSE 'existing'
    END,
    uc.confidence,
    uc.source_type,
    uc.document_id,
    uc.chunk_id,
    uc.id,
    jsonb_build_object(
        'size',         uc.size,
        'elevation',    uc.elevation,
        'is_existing',  uc.is_existing,
        'is_proposed',  uc.is_proposed,
        'notes',        uc.notes
    ),
    uc.created_at,
    uc.updated_at
FROM utility_crossings uc
WHERE NOT EXISTS (
    SELECT 1 FROM project_entities pe2
    WHERE  pe2.project_id    = uc.project_id
      AND  pe2.canonical_name =
               'CROSSING_' || UPPER(uc.crossing_utility)
               || '_' || COALESCE(REPLACE(uc.station, '+', '_'), 'NOSTATION')
               || '_' || RIGHT(uc.id::TEXT, 8)
);

-- ============================================================================
-- PART 11: entity_findings from utility_crossings
--
-- (a) elevation finding — when elevation is recorded
-- (b) dimension finding — when size is recorded
-- (c) note finding     — human-readable crossing description
-- ============================================================================

-- (a) Elevation findings
INSERT INTO entity_findings (
    project_id, entity_id, finding_type,
    numeric_value, unit, statement,
    support_level, confidence, metadata, created_at
)
SELECT
    pe.project_id,
    pe.id,
    'elevation',
    uc.elevation,
    'ft',
    uc.utility_full_name || ' crossing elevation: ' || uc.elevation::TEXT || ' ft'
      || CASE WHEN uc.station IS NOT NULL THEN ' at Sta. ' || uc.station ELSE '' END,
    CASE
        WHEN uc.source_type IN ('vision', 'text', 'manual') THEN 'explicit'
        ELSE 'unknown'
    END,
    uc.confidence,
    jsonb_build_object(
        'source_table', 'utility_crossings',
        'source_id',    uc.id,
        'finding',      'elevation'
    ),
    uc.created_at
FROM project_entities pe
JOIN utility_crossings uc ON pe.legacy_crossing_id = uc.id
WHERE uc.elevation IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM entity_findings ef
      WHERE  ef.entity_id              = pe.id
        AND  ef.finding_type           = 'elevation'
        AND  ef.metadata->>'source_id' = uc.id::TEXT
  );

-- (b) Dimension (size) findings
INSERT INTO entity_findings (
    project_id, entity_id, finding_type,
    text_value, statement,
    support_level, confidence, metadata, created_at
)
SELECT
    pe.project_id,
    pe.id,
    'dimension',
    uc.size,
    uc.utility_full_name || ' crossing size: ' || uc.size
      || CASE WHEN uc.station IS NOT NULL THEN ' at Sta. ' || uc.station ELSE '' END,
    CASE
        WHEN uc.source_type IN ('vision', 'text', 'manual') THEN 'explicit'
        ELSE 'unknown'
    END,
    uc.confidence,
    jsonb_build_object(
        'source_table', 'utility_crossings',
        'source_id',    uc.id,
        'finding',      'dimension'
    ),
    uc.created_at
FROM project_entities pe
JOIN utility_crossings uc ON pe.legacy_crossing_id = uc.id
WHERE uc.size IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM entity_findings ef
      WHERE  ef.entity_id              = pe.id
        AND  ef.finding_type           = 'dimension'
        AND  ef.metadata->>'source_id' = uc.id::TEXT
  );

-- (c) Note findings (crossing description)
INSERT INTO entity_findings (
    project_id, entity_id, finding_type,
    text_value, statement,
    support_level, confidence, metadata, created_at
)
SELECT
    pe.project_id,
    pe.id,
    'note',
    CASE WHEN uc.is_existing THEN 'existing' WHEN uc.is_proposed THEN 'proposed' ELSE 'unknown' END,
    uc.utility_full_name || ' (' || uc.crossing_utility || ') crossing'
      || CASE WHEN uc.station IS NOT NULL    THEN ' at Sta. ' || uc.station          ELSE '' END
      || CASE WHEN uc.is_existing            THEN ' — existing'                      ELSE '' END
      || CASE WHEN uc.is_proposed            THEN ' — proposed'                      ELSE '' END
      || CASE WHEN uc.size    IS NOT NULL     THEN ', size: ' || uc.size             ELSE '' END
      || CASE WHEN uc.elevation IS NOT NULL   THEN ', elev: ' || uc.elevation::TEXT || ' ft' ELSE '' END,
    CASE
        WHEN uc.source_type IN ('vision', 'text', 'manual') THEN 'explicit'
        ELSE 'unknown'
    END,
    uc.confidence,
    jsonb_build_object(
        'source_table', 'utility_crossings',
        'source_id',    uc.id,
        'finding',      'note'
    ),
    uc.created_at
FROM project_entities pe
JOIN utility_crossings uc ON pe.legacy_crossing_id = uc.id
WHERE NOT EXISTS (
    SELECT 1 FROM entity_findings ef
    WHERE  ef.entity_id              = pe.id
      AND  ef.finding_type           = 'note'
      AND  ef.metadata->>'source_id' = uc.id::TEXT
);

-- ============================================================================
-- PART 12: entity_locations from utility_crossings
-- ============================================================================

INSERT INTO entity_locations (
    entity_id, project_id, location_type,
    station_value, station_numeric,
    sheet_number, is_primary, created_at
)
SELECT
    pe.id,
    pe.project_id,
    'station',
    uc.station,
    uc.station_numeric,
    uc.sheet_number,
    TRUE,
    uc.created_at
FROM project_entities pe
JOIN utility_crossings uc ON pe.legacy_crossing_id = uc.id
WHERE uc.station IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM entity_locations el
      WHERE  el.entity_id = pe.id
        AND  el.is_primary = TRUE
  );

-- ============================================================================
-- PART 13: entity_citations from utility_crossings
-- ============================================================================

INSERT INTO entity_citations (
    project_id, entity_id,
    document_id, chunk_id, sheet_number,
    extraction_source, confidence, created_at
)
SELECT
    pe.project_id,
    pe.id,
    pe.source_document_id,
    pe.source_chunk_id,
    uc.sheet_number,
    CASE
        WHEN uc.source_type IN ('vision', 'text', 'manual') THEN uc.source_type
        ELSE 'imported'
    END,
    uc.confidence,
    uc.created_at
FROM project_entities pe
JOIN utility_crossings uc ON pe.legacy_crossing_id = uc.id
WHERE pe.source_document_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM entity_citations ec
      WHERE  ec.entity_id   = pe.id
        AND  ec.document_id = pe.source_document_id
  );

-- ============================================================================
-- PART 14: entity_relationships — junction → linear_asset  (located_in)
--
-- Links each termination point to the linear_asset entity that represents
-- its parent utility run. Match is on canonical_name: the linear_asset must
-- already exist in project_entities (created in Part 2 above).
--
-- Unmatched junctions (no corresponding linear_asset found) are silently
-- skipped — they still exist as standalone entities with their location data.
-- ============================================================================

INSERT INTO entity_relationships (
    project_id, from_entity_id, to_entity_id,
    relationship_type, station, station_numeric,
    extraction_source, confidence, metadata, created_at
)
SELECT
    pe_junction.project_id,
    pe_junction.id,   -- FROM: the termination point
    pe_linear.id,     -- TO:   the parent utility line
    'located_in',
    utp.station,
    utp.station_numeric,
    CASE
        WHEN utp.source_type IN ('vision', 'text', 'manual') THEN utp.source_type
        ELSE 'imported'
    END,
    utp.confidence,
    jsonb_build_object(
        'termination_type', utp.termination_type,
        'source_table',     'utility_termination_points',
        'source_id',        utp.id
    ),
    utp.created_at
FROM project_entities pe_junction
JOIN utility_termination_points utp
     ON  pe_junction.legacy_termination_id = utp.id
-- The linear_asset must have a canonical_name that exactly matches
-- UPPER(REPLACE(utp.utility_name)) — the same rule used in Part 2.
JOIN project_entities pe_linear
     ON  pe_linear.project_id   = pe_junction.project_id
     AND pe_linear.entity_type  = 'linear_asset'
     AND pe_linear.discipline   = 'utility'
     AND pe_linear.canonical_name =
           UPPER(REGEXP_REPLACE(TRIM(utp.utility_name), '\s+', '_', 'g'))
WHERE pe_junction.entity_type = 'junction'
  AND pe_junction.discipline  = 'utility'
  AND NOT EXISTS (
      SELECT 1 FROM entity_relationships er
      WHERE  er.from_entity_id     = pe_junction.id
        AND  er.to_entity_id       = pe_linear.id
        AND  er.relationship_type  = 'located_in'
  );

-- ============================================================================
-- End of migration
-- ============================================================================
