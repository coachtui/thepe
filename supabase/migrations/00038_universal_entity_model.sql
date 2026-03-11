-- Migration: Universal Entity Model
-- Created: 2026-03-10
-- Revised:  2026-03-10 (v3 — fully idempotent for re-runs)
--
-- CHANGELOG (v3 — idempotency hardening)
--  1. All CREATE TABLE → CREATE TABLE IF NOT EXISTS
--  2. Named table constraints extracted to separate DO $$ EXCEPTION WHEN duplicate_object $$ blocks
--  3. All CREATE INDEX → CREATE INDEX IF NOT EXISTS
--  4. ALTER TABLE ADD COLUMN → ADD COLUMN IF NOT EXISTS
--  5. All CREATE POLICY wrapped with DROP POLICY IF EXISTS guards
--  6. All CREATE TRIGGER wrapped with DROP TRIGGER IF EXISTS guards
--
-- CHANGELOG (v2 — schema review hardening)
--  1. Added CREATE EXTENSION IF NOT EXISTS pg_trgm guard
--  2. Removed 'nts' from status CHECK (not a lifecycle value; store in metadata)
--  3. Added UNIQUE (project_id, canonical_name) — canonical identity per project
--  4. Added UNIQUE (id, project_id) — enables composite FK targets from child tables
--  5. entity_locations: composite FK (entity_id, project_id) → project_entities
--  6. entity_findings:  composite FK (entity_id, project_id) → project_entities
--  7. entity_relationships: composite FK for both from/to endpoints; self-reference CHECK
--  8. entity_citations: single-owner CHECK constraint after ALTER adds FK columns
--  9. Replaced non-unique idx_locations_primary with UNIQUE idx_locations_one_primary
-- 10. Standardised extraction_source vocabulary — added 'imported', removed 'inferred'
--     at entity level, documented per-table differences in comments
-- 11. Dropped redundant idx_entities_canonical (covered by uq_entities_canonical)
--
-- KNOWN INTEGRITY GAPS (intentionally deferred)
--  A. entity_citations.entity_id is nullable (polymorphic ownership). PostgreSQL
--     does not check composite FKs when the leading column is NULL, so
--     cross-project integrity for citations cannot be enforced in DDL alone.
--     TODO: add a BEFORE INSERT/UPDATE trigger in a follow-up migration.
--  B. entity_citations.finding_id and .relationship_id lack composite FK coverage
--     (would require UNIQUE (id, project_id) on those tables plus a project_id
--     column threaded through). Deferred until Phase 2 is validated in production.
--  C. entity_relationships.citation_id is a simple FK with no project_id check.
--     Same deferral rationale as (B).
--
-- PURPOSE: Additive entity graph layer — no existing tables, views, functions,
--          or code paths are modified.

-- ============================================================================
-- pg_trgm — required for label and display_name GIN indexes.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- PART 1: project_entities
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Classification
    discipline TEXT NOT NULL
        CHECK (discipline IN ('utility', 'demo', 'architectural', 'structural', 'mep', 'schedule', 'general')),
    entity_type TEXT NOT NULL,  -- 'line', 'fitting', 'wall', 'door', 'room', 'schedule_entry', etc.
    subtype TEXT,               -- discipline-specific: 'water', 'partition', 'hollow_metal', etc.

    -- Names
    canonical_name TEXT NOT NULL,  -- stable machine ID: "WATER_LINE_A", "DOOR_D14"
    display_name TEXT,             -- human label: "Water Line A", "Door D-14"
    label TEXT,                    -- short drawing tag: "WL-A", "D-14"

    -- Status lifecycle
    -- 'nts' (not-to-scale) is a drawing annotation, not an entity lifecycle value.
    -- Store NTS flags in metadata->>'nts' = 'true' instead.
    status TEXT DEFAULT 'existing'
        CHECK (status IN (
            'existing', 'new', 'to_remove', 'to_relocate',
            'to_protect', 'to_remain', 'temporary', 'proposed'
        )),

    -- Quality
    confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),

    -- extraction_source for project_entities:
    --   vision     = extracted from drawing/image by vision model
    --   text       = extracted from specification or document text
    --   manual     = entered by a human
    --   imported   = backfilled from a legacy table (project_quantities, etc.)
    --   calculated = derived value (e.g. computed length or aggregate)
    extraction_source TEXT CHECK (extraction_source IN ('vision', 'text', 'manual', 'imported', 'calculated')),

    -- Provenance
    source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    source_chunk_id UUID REFERENCES document_chunks(id) ON DELETE SET NULL,

    -- Legacy bridges (nullable — only set for rows migrated from old tables)
    legacy_quantity_id    UUID REFERENCES project_quantities(id)          ON DELETE SET NULL,
    legacy_termination_id UUID REFERENCES utility_termination_points(id)  ON DELETE SET NULL,
    legacy_crossing_id    UUID REFERENCES utility_crossings(id)           ON DELETE SET NULL,

    metadata   JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deduplicate any rows left by a previous partial run of migration 00039.
-- Keep the oldest row per (project_id, canonical_name); all entity graph data
-- is fully regenerable from legacy tables so losing duplicates is safe.
DELETE FROM project_entities
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY project_id, canonical_name
                   ORDER BY created_at ASC, id ASC
               ) AS rn
        FROM project_entities
    ) ranked
    WHERE rn > 1
);

-- Canonical name is the stable machine identity within a project.
DO $$ BEGIN
    ALTER TABLE project_entities
        ADD CONSTRAINT uq_entities_canonical UNIQUE (project_id, canonical_name);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Composite uniqueness used by child-table composite FKs.
DO $$ BEGIN
    ALTER TABLE project_entities
        ADD CONSTRAINT uq_entities_id_project UNIQUE (id, project_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 2: entity_locations
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- entity_id FK enforced via composite constraint (fk_location_entity_project)
    entity_id  UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    location_type TEXT NOT NULL
        CHECK (location_type IN (
            'station', 'grid', 'room', 'level', 'area', 'zone', 'detail_ref', 'sheet_ref'
        )),
    is_primary BOOLEAN DEFAULT TRUE,

    -- Station grammar (utility/civil)
    station_value    TEXT,     -- "13+00"
    station_numeric  NUMERIC,  -- 1300.00 (normalised)
    station_to       TEXT,     -- "36+00" (for ranges)
    station_to_numeric NUMERIC,

    -- Grid / room grammar (building)
    grid_ref    TEXT,   -- "B-5"
    room_number TEXT,   -- "104"
    level       TEXT,   -- "L1", "B1", "Roof"
    area        TEXT,   -- "East Wing"
    zone        TEXT,   -- "Zone A"

    -- Reference grammar (any discipline)
    detail_ref  TEXT,     -- "A/4.3"
    sheet_number TEXT,    -- "C-201"
    page_number INTEGER,

    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Composite FK: guarantees location.project_id = entity.project_id
DO $$ BEGIN
    ALTER TABLE entity_locations
        ADD CONSTRAINT fk_location_entity_project
            FOREIGN KEY (entity_id, project_id)
            REFERENCES project_entities(id, project_id)
            ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 3: entity_citations
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_citations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Polymorphic owner — exactly one of entity_id / finding_id / relationship_id
    -- must be non-null. The CHECK constraint is added below (after the ALTER that
    -- creates finding_id and relationship_id).
    entity_id UUID REFERENCES project_entities(id) ON DELETE CASCADE,

    -- Source
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    chunk_id    UUID REFERENCES document_chunks(id) ON DELETE SET NULL,

    -- Location in document
    sheet_number TEXT,
    page_number  INTEGER,
    detail_ref   TEXT,

    -- Content
    excerpt TEXT,  -- verbatim text or vision description
    context TEXT,  -- surrounding context

    confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),

    -- extraction_source for citations:
    --   vision   = drawn from image/drawing analysis
    --   text     = drawn from document text
    --   manual   = entered by a human
    --   imported = backfilled from legacy tables
    extraction_source TEXT CHECK (extraction_source IN ('vision', 'text', 'manual', 'imported')),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PART 4: entity_relationships
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Both entity FKs enforced via composite constraints below.
    from_entity_id UUID NOT NULL,
    to_entity_id   UUID NOT NULL,

    relationship_type TEXT NOT NULL
        CHECK (relationship_type IN (
            'crosses', 'located_in', 'described_by', 'governed_by', 'applies_to',
            'adjacent_to', 'connects_to', 'requires', 'feeds', 'demolishes',
            'protects', 'replaces', 'ties_into', 'precedes', 'follows'
        )),

    -- Crossing context (only populated when relationship_type = 'crosses')
    station         TEXT,
    station_numeric NUMERIC,
    elevation       NUMERIC,

    notes      TEXT,
    confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),

    -- extraction_source for relationships:
    --   vision   = identified in drawing/image analysis
    --   text     = identified in document text
    --   manual   = entered by a human
    --   imported = backfilled from legacy tables
    --   inferred = derived by combining multiple sources
    extraction_source TEXT CHECK (extraction_source IN ('vision', 'text', 'manual', 'imported', 'inferred')),

    citation_id UUID REFERENCES entity_citations(id) ON DELETE SET NULL,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- An entity cannot have a relationship with itself
DO $$ BEGIN
    ALTER TABLE entity_relationships
        ADD CONSTRAINT chk_rel_no_self_reference CHECK (from_entity_id <> to_entity_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Composite FKs: both endpoints must belong to this project
DO $$ BEGIN
    ALTER TABLE entity_relationships
        ADD CONSTRAINT fk_rel_from_entity_project
            FOREIGN KEY (from_entity_id, project_id)
            REFERENCES project_entities(id, project_id)
            ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE entity_relationships
        ADD CONSTRAINT fk_rel_to_entity_project
            FOREIGN KEY (to_entity_id, project_id)
            REFERENCES project_entities(id, project_id)
            ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 5: entity_findings
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- entity_id FK enforced via composite constraint (fk_finding_entity_project)
    entity_id UUID NOT NULL,

    finding_type TEXT NOT NULL
        CHECK (finding_type IN (
            'quantity', 'material', 'requirement', 'demo_scope', 'crossing_count',
            'sequence_hint', 'risk_note', 'dimension', 'elevation',
            'specification_ref', 'note'
        )),

    -- Value
    numeric_value NUMERIC,
    unit      TEXT,  -- 'LF', 'SF', 'CY', 'EA', 'TON', 'SY', etc.
    text_value TEXT, -- for non-numeric findings

    -- Human-readable statement (required)
    statement TEXT NOT NULL,

    -- Support classification (assigned by reasoning engine — never by LLM)
    support_level TEXT CHECK (support_level IN ('explicit', 'inferred', 'unknown')),

    citation_id UUID REFERENCES entity_citations(id) ON DELETE SET NULL,
    confidence  NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Composite FK: guarantees finding.project_id = entity.project_id
DO $$ BEGIN
    ALTER TABLE entity_findings
        ADD CONSTRAINT fk_finding_entity_project
            FOREIGN KEY (entity_id, project_id)
            REFERENCES project_entities(id, project_id)
            ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 6: Back-fill foreign keys on entity_citations (circular-safe via ALTER)
-- ============================================================================

-- finding_id and relationship_id must be added after both tables exist.
ALTER TABLE entity_citations
    ADD COLUMN IF NOT EXISTS finding_id      UUID REFERENCES entity_findings(id)      ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS relationship_id UUID REFERENCES entity_relationships(id)  ON DELETE CASCADE;

-- Exactly one owner must be set.
DO $$ BEGIN
    ALTER TABLE entity_citations
        ADD CONSTRAINT entity_citations_single_owner CHECK (
            (CASE WHEN entity_id       IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN finding_id      IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN relationship_id IS NOT NULL THEN 1 ELSE 0 END) = 1
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 7: Indexes
-- ============================================================================

-- project_entities
CREATE INDEX IF NOT EXISTS idx_entities_project    ON project_entities(project_id);
CREATE INDEX IF NOT EXISTS idx_entities_discipline ON project_entities(project_id, discipline);
CREATE INDEX IF NOT EXISTS idx_entities_type       ON project_entities(project_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_status     ON project_entities(project_id, status);
CREATE INDEX IF NOT EXISTS idx_entities_label_trgm   ON project_entities USING gin (label gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_display_trgm ON project_entities USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_legacy_quantity ON project_entities(legacy_quantity_id)
    WHERE legacy_quantity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entities_legacy_termination ON project_entities(legacy_termination_id)
    WHERE legacy_termination_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entities_legacy_crossing ON project_entities(legacy_crossing_id)
    WHERE legacy_crossing_id IS NOT NULL;

-- entity_locations
CREATE INDEX IF NOT EXISTS idx_locations_entity  ON entity_locations(entity_id);
CREATE INDEX IF NOT EXISTS idx_locations_project ON entity_locations(project_id);
CREATE INDEX IF NOT EXISTS idx_locations_type    ON entity_locations(project_id, location_type);
CREATE INDEX IF NOT EXISTS idx_locations_station ON entity_locations(project_id, station_numeric)
    WHERE station_numeric IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_room  ON entity_locations(project_id, room_number)
    WHERE room_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_sheet ON entity_locations(project_id, sheet_number)
    WHERE sheet_number IS NOT NULL;
-- UNIQUE partial index: each entity may have at most one primary location.
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_one_primary ON entity_locations(entity_id)
    WHERE is_primary = TRUE;

-- entity_relationships
CREATE INDEX IF NOT EXISTS idx_relationships_project ON entity_relationships(project_id);
CREATE INDEX IF NOT EXISTS idx_relationships_from    ON entity_relationships(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to      ON entity_relationships(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type    ON entity_relationships(project_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_relationships_crossing_station ON entity_relationships(project_id, station_numeric)
    WHERE relationship_type = 'crosses' AND station_numeric IS NOT NULL;

-- entity_citations
CREATE INDEX IF NOT EXISTS idx_citations_entity ON entity_citations(entity_id)
    WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_citations_finding ON entity_citations(finding_id)
    WHERE finding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_citations_relationship ON entity_citations(relationship_id)
    WHERE relationship_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_citations_document ON entity_citations(document_id)
    WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_citations_sheet ON entity_citations(project_id, sheet_number)
    WHERE sheet_number IS NOT NULL;

-- entity_findings
CREATE INDEX IF NOT EXISTS idx_findings_entity  ON entity_findings(entity_id);
CREATE INDEX IF NOT EXISTS idx_findings_project ON entity_findings(project_id);
CREATE INDEX IF NOT EXISTS idx_findings_type    ON entity_findings(project_id, finding_type);
CREATE INDEX IF NOT EXISTS idx_findings_support ON entity_findings(project_id, support_level)
    WHERE support_level IS NOT NULL;

-- ============================================================================
-- PART 8: RLS — standard project-member pattern
-- ============================================================================

ALTER TABLE project_entities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_citations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_findings      ENABLE ROW LEVEL SECURITY;

-- project_entities
DROP POLICY IF EXISTS "Users can view entities for their projects"   ON project_entities;
DROP POLICY IF EXISTS "Users can insert entities for their projects" ON project_entities;
DROP POLICY IF EXISTS "Users can update entities for their projects" ON project_entities;
DROP POLICY IF EXISTS "Users can delete entities for their projects" ON project_entities;
DROP POLICY IF EXISTS "Service role has full access to project_entities" ON project_entities;

CREATE POLICY "Users can view entities for their projects"
ON project_entities FOR SELECT
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = project_entities.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can insert entities for their projects"
ON project_entities FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = project_entities.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can update entities for their projects"
ON project_entities FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = project_entities.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can delete entities for their projects"
ON project_entities FOR DELETE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = project_entities.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Service role has full access to project_entities"
ON project_entities
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- entity_locations
DROP POLICY IF EXISTS "Users can view locations for their projects"   ON entity_locations;
DROP POLICY IF EXISTS "Users can insert locations for their projects" ON entity_locations;
DROP POLICY IF EXISTS "Users can update locations for their projects" ON entity_locations;
DROP POLICY IF EXISTS "Users can delete locations for their projects" ON entity_locations;
DROP POLICY IF EXISTS "Service role has full access to entity_locations" ON entity_locations;

CREATE POLICY "Users can view locations for their projects"
ON entity_locations FOR SELECT
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_locations.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can insert locations for their projects"
ON entity_locations FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_locations.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can update locations for their projects"
ON entity_locations FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_locations.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can delete locations for their projects"
ON entity_locations FOR DELETE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_locations.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Service role has full access to entity_locations"
ON entity_locations
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- entity_citations
DROP POLICY IF EXISTS "Users can view citations for their projects"   ON entity_citations;
DROP POLICY IF EXISTS "Users can insert citations for their projects" ON entity_citations;
DROP POLICY IF EXISTS "Users can update citations for their projects" ON entity_citations;
DROP POLICY IF EXISTS "Users can delete citations for their projects" ON entity_citations;
DROP POLICY IF EXISTS "Service role has full access to entity_citations" ON entity_citations;

CREATE POLICY "Users can view citations for their projects"
ON entity_citations FOR SELECT
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_citations.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can insert citations for their projects"
ON entity_citations FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_citations.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can update citations for their projects"
ON entity_citations FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_citations.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can delete citations for their projects"
ON entity_citations FOR DELETE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_citations.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Service role has full access to entity_citations"
ON entity_citations
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- entity_relationships
DROP POLICY IF EXISTS "Users can view relationships for their projects"   ON entity_relationships;
DROP POLICY IF EXISTS "Users can insert relationships for their projects" ON entity_relationships;
DROP POLICY IF EXISTS "Users can update relationships for their projects" ON entity_relationships;
DROP POLICY IF EXISTS "Users can delete relationships for their projects" ON entity_relationships;
DROP POLICY IF EXISTS "Service role has full access to entity_relationships" ON entity_relationships;

CREATE POLICY "Users can view relationships for their projects"
ON entity_relationships FOR SELECT
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_relationships.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can insert relationships for their projects"
ON entity_relationships FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_relationships.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can update relationships for their projects"
ON entity_relationships FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_relationships.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can delete relationships for their projects"
ON entity_relationships FOR DELETE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_relationships.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Service role has full access to entity_relationships"
ON entity_relationships
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- entity_findings
DROP POLICY IF EXISTS "Users can view findings for their projects"   ON entity_findings;
DROP POLICY IF EXISTS "Users can insert findings for their projects" ON entity_findings;
DROP POLICY IF EXISTS "Users can update findings for their projects" ON entity_findings;
DROP POLICY IF EXISTS "Users can delete findings for their projects" ON entity_findings;
DROP POLICY IF EXISTS "Service role has full access to entity_findings" ON entity_findings;

CREATE POLICY "Users can view findings for their projects"
ON entity_findings FOR SELECT
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_findings.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can insert findings for their projects"
ON entity_findings FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_findings.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can update findings for their projects"
ON entity_findings FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_findings.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can delete findings for their projects"
ON entity_findings FOR DELETE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = entity_findings.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Service role has full access to entity_findings"
ON entity_findings
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- PART 9: updated_at triggers
-- ============================================================================

DROP TRIGGER IF EXISTS update_project_entities_updated_at ON project_entities;
CREATE TRIGGER update_project_entities_updated_at
    BEFORE UPDATE ON project_entities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_entity_findings_updated_at ON entity_findings;
CREATE TRIGGER update_entity_findings_updated_at
    BEFORE UPDATE ON entity_findings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 10: Grant permissions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON project_entities     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_locations     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_citations     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_relationships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_findings      TO authenticated;

GRANT ALL ON project_entities     TO service_role;
GRANT ALL ON entity_locations     TO service_role;
GRANT ALL ON entity_citations     TO service_role;
GRANT ALL ON entity_relationships TO service_role;
GRANT ALL ON entity_findings      TO service_role;

-- ============================================================================
-- End of migration
-- ============================================================================
