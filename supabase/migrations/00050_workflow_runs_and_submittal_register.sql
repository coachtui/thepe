-- Migration: workflow_runs + submittal_register_items
-- Created: 2026-05-05
-- Phase:   PE construction intelligence core — submittal_register persistence
--
-- PURPOSE
--   Persist routed workflow execution records and structured submittal-register
--   output (snapshot per item) for the construction intelligence core.
--
--   Adds two new tables only — no existing tables, columns, policies, functions,
--   or code paths are modified. No data is inserted, updated, or deleted.
--
--   Tables:
--     1. workflow_runs              — generic per-run record for routed task types
--     2. submittal_register_items   — per-item snapshot + human review state for
--                                     a workflow_runs row of workflow_type =
--                                     'submittal_register'
--
-- DESIGN NOTES
--   - workflow_type is constrained to 'submittal_register' for now; other
--     routed task types (spec_lookup, rfi_draft, submittal_review, qc_plan,
--     plan_lookup, schedule_question, field_question, equipment_question)
--     will extend the CHECK in a follow-up migration when their persistence
--     is added.
--   - workflow_runs.output_payload stores the verbatim
--     formatSubmittalRegisterToolPayload(...) result so a re-render can
--     reproduce the exact snapshot the user saw, even if upstream
--     entity_findings rows are later deleted, edited, or superseded.
--   - submittal_register_items.item_payload mirrors the same principle at
--     row granularity (full SubmittalRegisterItem JSON, including the
--     normalized sourceReference).
--   - source_finding_id / source_citation_id link to existing entity_findings
--     and entity_citations rather than duplicating citation columns.
--
-- PROJECT CONSISTENCY ENFORCEMENT
--   submittal_register_items.project_id is enforced equal to the parent
--   workflow_runs.project_id via a composite foreign key
--   (workflow_run_id, project_id) -> workflow_runs(id, project_id),
--   matching the established pattern from 00038_universal_entity_model.sql
--   (entity_locations, entity_findings, entity_relationships). Engine-enforced
--   on every INSERT/UPDATE — no procedural trigger required.
--
-- IDEMPOTENCY
--   Safe to re-run. CREATE TABLE IF NOT EXISTS, named-constraint guards via
--   DO $$ EXCEPTION WHEN duplicate_object $$ blocks, CREATE INDEX IF NOT EXISTS,
--   DROP POLICY IF EXISTS before each CREATE POLICY, DROP TRIGGER IF EXISTS
--   before CREATE TRIGGER.
--
-- NO APP WIRING YET
--   This migration only creates the schema. Service-role TypeScript
--   persistence wiring is a follow-up phase.

-- ============================================================================
-- PART 1: workflow_runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS workflow_runs (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id               UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    workflow_type            TEXT         NOT NULL
        CHECK (workflow_type IN ('submittal_register')),

    status                   TEXT         NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','failed','cancelled')),

    inputs                   JSONB        NOT NULL DEFAULT '{}',
    output_payload           JSONB,
    output_summary           JSONB,

    error                    TEXT,

    triggered_by_user_id     UUID         REFERENCES auth.users(id),
    triggered_by_role        TEXT,
    source_type              TEXT         NOT NULL
        CHECK (source_type IN ('chat_tool','api_direct','scheduled','admin')),

    duration_ms              INTEGER,
    cost_usd                 NUMERIC(8,4),

    started_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at             TIMESTAMPTZ,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Composite uniqueness — required as the FK target from
-- submittal_register_items(workflow_run_id, project_id).
DO $$ BEGIN
    ALTER TABLE workflow_runs
        ADD CONSTRAINT uq_workflow_runs_id_project UNIQUE (id, project_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 2: submittal_register_items
-- ============================================================================

CREATE TABLE IF NOT EXISTS submittal_register_items (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id               UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- workflow_run_id FK enforced via composite constraint (fk_sri_run_project)
    workflow_run_id          UUID         NOT NULL,

    -- Identity within a run (carried from the formatter)
    dedupe_key               TEXT         NOT NULL,

    spec_section             TEXT,
    section_title            TEXT,
    submittal_item           TEXT         NOT NULL,
    submittal_type           TEXT,
    required_action          TEXT,
    approval_required        BOOLEAN,

    -- Quality at time of run
    confidence               NUMERIC(3,2)
        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    source_quality           TEXT
        CHECK (source_quality IS NULL OR source_quality IN ('high','medium','low')),
    citation_completeness    INTEGER,

    -- Where it came from (link, don't duplicate)
    source_finding_id        UUID         REFERENCES entity_findings(id)  ON DELETE SET NULL,
    source_citation_id       UUID         REFERENCES entity_citations(id) ON DELETE SET NULL,

    -- Snapshot of the SubmittalRegisterItem JSON, including normalized
    -- sourceReference. Lets us reconstruct exactly what the user saw even if
    -- entity_findings / entity_citations later change.
    item_payload             JSONB        NOT NULL,

    -- Human review state
    review_status            TEXT         NOT NULL DEFAULT 'pending'
        CHECK (review_status IN (
            'pending','approved','approved_as_noted','rejected','needs_clarification','superseded'
        )),
    reviewed_by_user_id      UUID         REFERENCES auth.users(id),
    reviewed_by_role         TEXT,
    reviewed_at              TIMESTAMPTZ,
    review_notes             TEXT,

    -- Lifecycle continuity (matches 00047 pattern)
    confirmed_by_count       INTEGER      NOT NULL DEFAULT 0,
    rejected_by_count        INTEGER      NOT NULL DEFAULT 0,
    superseded_by_id         UUID         REFERENCES submittal_register_items(id),

    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Identity within a run.
DO $$ BEGIN
    ALTER TABLE submittal_register_items
        ADD CONSTRAINT uq_sri_run_dedupe UNIQUE (workflow_run_id, dedupe_key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 3: Project consistency enforcement
--
-- Composite FK guarantees submittal_register_items.project_id always equals
-- the parent workflow_runs.project_id. Mirrors the entity_locations /
-- entity_findings / entity_relationships pattern from 00038.
-- ============================================================================

DO $$ BEGIN
    ALTER TABLE submittal_register_items
        ADD CONSTRAINT fk_sri_run_project
            FOREIGN KEY (workflow_run_id, project_id)
            REFERENCES workflow_runs(id, project_id)
            ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 4: Indexes
-- ============================================================================

-- workflow_runs
CREATE INDEX IF NOT EXISTS idx_workflow_runs_project
    ON workflow_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_project_type
    ON workflow_runs(project_id, workflow_type);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_project_recent
    ON workflow_runs(project_id, workflow_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
    ON workflow_runs(project_id, status)
    WHERE status IN ('running','failed');
CREATE INDEX IF NOT EXISTS idx_workflow_runs_user
    ON workflow_runs(triggered_by_user_id)
    WHERE triggered_by_user_id IS NOT NULL;

-- submittal_register_items
CREATE INDEX IF NOT EXISTS idx_sri_run
    ON submittal_register_items(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_sri_project
    ON submittal_register_items(project_id);
CREATE INDEX IF NOT EXISTS idx_sri_project_status
    ON submittal_register_items(project_id, review_status);
CREATE INDEX IF NOT EXISTS idx_sri_project_section
    ON submittal_register_items(project_id, spec_section)
    WHERE spec_section IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sri_project_type
    ON submittal_register_items(project_id, submittal_type)
    WHERE submittal_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sri_finding
    ON submittal_register_items(source_finding_id)
    WHERE source_finding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sri_pending_review
    ON submittal_register_items(project_id, created_at DESC)
    WHERE review_status = 'pending';

-- ============================================================================
-- PART 5: RLS — project-member pattern + service_role full access
-- ============================================================================

ALTER TABLE workflow_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE submittal_register_items   ENABLE ROW LEVEL SECURITY;

-- workflow_runs
DROP POLICY IF EXISTS "Users can view workflow_runs for their projects"   ON workflow_runs;
DROP POLICY IF EXISTS "Users can insert workflow_runs for their projects" ON workflow_runs;
DROP POLICY IF EXISTS "Users can update workflow_runs for their projects" ON workflow_runs;
DROP POLICY IF EXISTS "Users can delete workflow_runs for their projects" ON workflow_runs;
DROP POLICY IF EXISTS "Service role has full access to workflow_runs"     ON workflow_runs;

CREATE POLICY "Users can view workflow_runs for their projects"
ON workflow_runs FOR SELECT
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = workflow_runs.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can insert workflow_runs for their projects"
ON workflow_runs FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = workflow_runs.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can update workflow_runs for their projects"
ON workflow_runs FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = workflow_runs.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can delete workflow_runs for their projects"
ON workflow_runs FOR DELETE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = workflow_runs.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Service role has full access to workflow_runs"
ON workflow_runs
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- submittal_register_items
DROP POLICY IF EXISTS "Users can view submittal_register_items for their projects"   ON submittal_register_items;
DROP POLICY IF EXISTS "Users can insert submittal_register_items for their projects" ON submittal_register_items;
DROP POLICY IF EXISTS "Users can update submittal_register_items for their projects" ON submittal_register_items;
DROP POLICY IF EXISTS "Users can delete submittal_register_items for their projects" ON submittal_register_items;
DROP POLICY IF EXISTS "Service role has full access to submittal_register_items"     ON submittal_register_items;

CREATE POLICY "Users can view submittal_register_items for their projects"
ON submittal_register_items FOR SELECT
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = submittal_register_items.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can insert submittal_register_items for their projects"
ON submittal_register_items FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = submittal_register_items.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can update submittal_register_items for their projects"
ON submittal_register_items FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = submittal_register_items.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Users can delete submittal_register_items for their projects"
ON submittal_register_items FOR DELETE
USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = submittal_register_items.project_id
    AND pm.user_id = auth.uid()
));

CREATE POLICY "Service role has full access to submittal_register_items"
ON submittal_register_items
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- PART 6: updated_at triggers
-- ============================================================================

DROP TRIGGER IF EXISTS update_workflow_runs_updated_at ON workflow_runs;
CREATE TRIGGER update_workflow_runs_updated_at
    BEFORE UPDATE ON workflow_runs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_submittal_register_items_updated_at ON submittal_register_items;
CREATE TRIGGER update_submittal_register_items_updated_at
    BEFORE UPDATE ON submittal_register_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART 7: Grants
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_runs            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON submittal_register_items TO authenticated;

GRANT ALL ON workflow_runs            TO service_role;
GRANT ALL ON submittal_register_items TO service_role;

-- ============================================================================
-- End of migration
-- ============================================================================
