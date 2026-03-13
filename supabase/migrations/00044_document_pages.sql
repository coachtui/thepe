-- Migration: Document Pages — Sheet Index Table (Phase 2)
-- Created: 2026-03-12
--
-- PURPOSE:
--   Create a normalized per-page index for every PDF in the system.
--   Each row represents one page of one document and stores all sheet
--   metadata extracted during vision processing.
--
-- This enables:
--   1. Fast candidate-sheet selection during chat verification
--   2. "Which sheets contain sewer?" queries without scanning all chunks
--   3. Sheet-level entity index for the query router
--   4. Future: sheet highlighting, match-line tracing, discipline filtering
--
-- POPULATED BY:
--   src/lib/processing/sheet-indexer.ts  (called from vision-process-document Inngest function)

-- ============================================================================
-- PART 1: document_pages
-- ============================================================================

CREATE TABLE IF NOT EXISTS document_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ownership
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,

    -- Page position
    page_number INTEGER NOT NULL,

    -- Sheet metadata (extracted by vision)
    sheet_number TEXT,   -- "CU110", "C-201", "S-001" etc.
    sheet_title  TEXT,   -- "PLAN - WATER LINE B", "FOOTING SCHEDULE"
    sheet_type   TEXT    -- plan / profile / detail / section / legend / notes / title / summary
        CHECK (sheet_type IN ('plan', 'profile', 'detail', 'section', 'legend', 'notes', 'title', 'summary', 'schedule', 'index', 'unknown')),

    -- Discipline classification
    disciplines TEXT[],   -- e.g. {'civil', 'utility'} or {'structural'}

    -- Detected utility content
    utilities            TEXT[],   -- {'water', 'sewer', 'storm', 'gas', 'electrical'}
    utility_designations TEXT[],   -- {'Water Line B', 'Sewer Line A', 'Storm Drain C'}

    -- Quick boolean flags (avoid JSONB scan for common filters)
    has_plan_view    BOOLEAN DEFAULT FALSE,
    has_profile_view BOOLEAN DEFAULT FALSE,
    has_stations     BOOLEAN DEFAULT FALSE,
    has_quantities   BOOLEAN DEFAULT FALSE,

    -- Station range visible on this page
    station_start TEXT,    -- "0+00"
    station_end   TEXT,    -- "13+50"
    station_start_numeric NUMERIC,
    station_end_numeric   NUMERIC,

    -- Storage
    page_image_url TEXT,   -- if we pre-render and store; NULL otherwise

    -- Full text content and embedding (for semantic search within this page)
    text_content TEXT,
    embedding    vector(1536),

    -- Full vision analysis (mirrors vision_data in document_chunks)
    vision_data JSONB,

    -- Provenance
    indexed_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (document_id, page_number)
);

-- ============================================================================
-- PART 2: sheet_entities — per-page entity rows
-- ============================================================================

-- Normalized entity rows for fast entity-level queries:
--   "Which pages contain Water Line B?"
--   "Which pages reference detail 4/S502?"
--   "Which pages have a manhole MH-12?"
--
-- Each row is one entity occurrence on one page.

CREATE TABLE IF NOT EXISTS sheet_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    document_page_id UUID NOT NULL REFERENCES document_pages(id) ON DELETE CASCADE,
    document_id      UUID NOT NULL REFERENCES documents(id)       ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects(id)         ON DELETE CASCADE,
    page_number      INTEGER NOT NULL,
    sheet_number     TEXT,

    -- Entity classification
    entity_type TEXT NOT NULL
        CHECK (entity_type IN (
            'utility_designation',  -- "Water Line B", "Sewer Line A"
            'pipe_size',            -- "12\" DIP", "8-IN PVC"
            'structure',            -- "MH-12", "CB-4"
            'detail_reference',     -- "4/S502"
            'station',              -- "13+00"
            'dimension',            -- "24' wide"
            'material',             -- "Ductile Iron"
            'equipment_label',      -- "PRV-1", "GV-3"
            'callout',              -- free-form callout text
            'other'
        )),

    entity_value   TEXT NOT NULL,  -- "Water Line B", "12\" DIP", "0+00"
    entity_context TEXT,           -- surrounding text / description

    confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PART 3: Indexes
-- ============================================================================

-- document_pages
CREATE INDEX IF NOT EXISTS idx_dpages_document   ON document_pages(document_id);
CREATE INDEX IF NOT EXISTS idx_dpages_project    ON document_pages(project_id);
CREATE INDEX IF NOT EXISTS idx_dpages_sheet_num  ON document_pages(project_id, sheet_number)
    WHERE sheet_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dpages_sheet_type ON document_pages(project_id, sheet_type)
    WHERE sheet_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dpages_utilities  ON document_pages USING gin(utilities)
    WHERE utilities IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dpages_util_desig ON document_pages USING gin(utility_designations)
    WHERE utility_designations IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dpages_disciplines ON document_pages USING gin(disciplines)
    WHERE disciplines IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dpages_station    ON document_pages(project_id, station_start_numeric, station_end_numeric)
    WHERE station_start_numeric IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dpages_indexed    ON document_pages(document_id, indexed_at)
    WHERE indexed_at IS NOT NULL;

-- sheet_entities
CREATE INDEX IF NOT EXISTS idx_sent_page        ON sheet_entities(document_page_id);
CREATE INDEX IF NOT EXISTS idx_sent_project     ON sheet_entities(project_id);
CREATE INDEX IF NOT EXISTS idx_sent_doc         ON sheet_entities(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_sent_type        ON sheet_entities(project_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_sent_value_trgm  ON sheet_entities USING gin (entity_value gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sent_sheet       ON sheet_entities(project_id, sheet_number)
    WHERE sheet_number IS NOT NULL;

-- ============================================================================
-- PART 4: updated_at trigger for document_pages
-- ============================================================================

DROP TRIGGER IF EXISTS update_document_pages_updated_at ON document_pages;
CREATE TRIGGER update_document_pages_updated_at
    BEFORE UPDATE ON document_pages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 5: RLS — project-member pattern
-- ============================================================================

ALTER TABLE document_pages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheet_entities  ENABLE ROW LEVEL SECURITY;

-- document_pages
DROP POLICY IF EXISTS "Users can view document pages for their projects" ON document_pages;
DROP POLICY IF EXISTS "Users can insert document pages for their projects" ON document_pages;
DROP POLICY IF EXISTS "Service role has full access to document_pages" ON document_pages;

CREATE POLICY "Users can view document pages for their projects"
ON document_pages FOR SELECT
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = document_pages.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can insert document pages for their projects"
ON document_pages FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = document_pages.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Service role has full access to document_pages"
ON document_pages
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- sheet_entities
DROP POLICY IF EXISTS "Users can view sheet entities for their projects" ON sheet_entities;
DROP POLICY IF EXISTS "Users can insert sheet entities for their projects" ON sheet_entities;
DROP POLICY IF EXISTS "Service role has full access to sheet_entities" ON sheet_entities;

CREATE POLICY "Users can view sheet entities for their projects"
ON sheet_entities FOR SELECT
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = sheet_entities.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can insert sheet entities for their projects"
ON sheet_entities FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = sheet_entities.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Service role has full access to sheet_entities"
ON sheet_entities
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- PART 6: Grant permissions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON document_pages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sheet_entities  TO authenticated;

GRANT ALL ON document_pages TO service_role;
GRANT ALL ON sheet_entities  TO service_role;

-- ============================================================================
-- End of migration
-- ============================================================================
