-- Migration: Spec + RFI + Submittal Entity Schema Extensions
-- Created: 2026-03-11
-- Phase: 6A + 6B + 6C
--
-- PURPOSE
--   Extend the universal entity model to support specification, RFI/change-
--   document, and submittal discipline entities for requirements reasoning,
--   change-impact lookup, and governing-document analysis.
--
--   Changes:
--     1. Extend project_entities.discipline CHECK to add:
--          'spec'       — specification sections, requirements, notes
--          'rfi'        — RFIs, ASIs, addenda, bulletins, clarifications
--          'submittal'  — submittals, product data, shop drawings
--
--     2. Extend entity_findings.finding_type CHECK to add:
--          Spec finding types:
--            'material_requirement'   — concrete f'c, steel grade, etc.
--            'execution_requirement'  — how work shall be performed
--            'testing_requirement'    — required tests / hold points
--            'submittal_requirement'  — what must be submitted before work
--            'closeout_requirement'   — warranty / O&M / testing at closeout
--            'protection_requirement' — protect work from damage / weather
--            'inspection_requirement' — inspector notifications / hold points
--          RFI finding types:
--            'clarification_statement' — the clarification / answer text
--            'superseding_language'    — explicit replacement / supersede text
--            'revision_metadata'       — RFI number, date, preparer, responder
--          Submittal finding types:
--            'approval_status'   — Approved / Approved As Noted / Rejected
--            'manufacturer_info' — manufacturer name + model data
--            'product_tag'       — drawing tag this submittal covers
--
--     3. Extend entity_relationships.relationship_type CHECK to add:
--          'governs'      — spec_section governs entity / work type
--          'requires'     — spec requires submittal / test / action
--          'references'   — document references section / sheet / standard
--          'clarifies'    — RFI/ASI clarifies a drawing entity / spec section
--          'replaces'     — change doc replaces a prior entity / detail
--          'supersedes'   — newer doc version supersedes older
--          'submitted_for'— submittal covers a spec section or entity
--
--     4. Add performance indexes for spec, rfi, and submittal queries.
--
-- IDEMPOTENCY
--   Safe to re-run. All DDL is conditional (skip if already present).
--
-- NO DATA CHANGES
--   Purely schema. No rows are inserted, updated, or deleted.

-- ============================================================================
-- PART 1: Extend project_entities.discipline CHECK
--
-- Strategy: Drop the existing CHECK and recreate with new discipline values.
-- If all three new values are already present (re-run), skip entirely.
-- ============================================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Skip if all three new disciplines are already present (idempotent re-run)
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'project_entities'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) LIKE '%spec%'
      AND pg_get_constraintdef(oid) LIKE '%rfi%'
      AND pg_get_constraintdef(oid) LIKE '%submittal%'
  ) THEN
    RAISE NOTICE 'Phase 6 disciplines already present — skipping discipline constraint update';
  ELSE
    -- Find the current discipline CHECK constraint name
    SELECT conname INTO v_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'project_entities'::regclass
      AND contype  = 'c'
      AND conname LIKE '%discipline%'
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE project_entities DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    -- Recreate with all existing values + Phase 6 additions
    ALTER TABLE project_entities
      ADD CONSTRAINT project_entities_discipline_check
      CHECK (discipline IN (
        -- existing disciplines (Phases 1-5)
        'utility', 'demo', 'architectural', 'structural', 'mep', 'schedule', 'general',
        -- Phase 6 additions
        'spec', 'rfi', 'submittal'
      ));
  END IF;
END $$;

-- ============================================================================
-- PART 2: Extend entity_findings.finding_type CHECK
--
-- Adds all Phase 6 finding types.
-- Strategy: Skip if 'material_requirement' already present (re-run guard).
-- ============================================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'entity_findings'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) LIKE '%material_requirement%'
  ) THEN
    SELECT conname INTO v_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'entity_findings'::regclass
      AND contype  = 'c'
      AND conname LIKE '%finding_type%'
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE entity_findings DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE entity_findings
      ADD CONSTRAINT entity_findings_finding_type_check
      CHECK (finding_type IN (
        -- existing types (Phases 1-5)
        'quantity', 'material', 'requirement', 'demo_scope', 'crossing_count',
        'sequence_hint', 'risk_note', 'dimension', 'elevation',
        'specification_ref', 'note',
        'schedule_row', 'constraint',
        'load_bearing', 'capacity', 'equipment_tag', 'circuit_ref',
        'coordination_note',
        -- Phase 6A — spec requirement families
        'material_requirement',
        'execution_requirement',
        'testing_requirement',
        'submittal_requirement',
        'closeout_requirement',
        'protection_requirement',
        'inspection_requirement',
        -- Phase 6B — RFI / change document
        'clarification_statement',
        'superseding_language',
        'revision_metadata',
        -- Phase 6C — submittal
        'approval_status',
        'manufacturer_info',
        'product_tag'
      ));
  END IF;
END $$;

-- ============================================================================
-- PART 3: Extend entity_relationships.relationship_type CHECK
--
-- Adds: 'governs', 'requires', 'references', 'clarifies', 'replaces',
--       'supersedes', 'submitted_for'
--
-- Strategy: Skip if 'governs' already present (re-run guard).
-- ============================================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'entity_relationships'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) LIKE '%governs%'
  ) THEN
    SELECT conname INTO v_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'entity_relationships'::regclass
      AND contype  = 'c'
      AND conname LIKE '%relationship_type%'
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE entity_relationships DROP CONSTRAINT %I', v_constraint_name
      );
    END IF;

    ALTER TABLE entity_relationships
      ADD CONSTRAINT entity_relationships_relationship_type_check
      CHECK (relationship_type IN (
        -- existing types (Phases 1-5)
        'located_in', 'described_by', 'applies_to',
        'supports', 'served_by',
        -- Phase 6 additions
        'governs',       -- spec_section governs entity / work type
        'requires',      -- spec requires submittal / test / action
        'references',    -- document references section / sheet / standard
        'clarifies',     -- RFI/ASI clarifies a drawing entity or spec section
        'replaces',      -- change doc replaces prior entity / detail
        'supersedes',    -- newer version supersedes older
        'submitted_for'  -- submittal covers a spec section or entity
      ));
  END IF;
END $$;

-- ============================================================================
-- PART 4: Performance indexes for spec entity queries
-- ============================================================================

-- All spec entities for a project
CREATE INDEX IF NOT EXISTS idx_entities_spec
  ON project_entities(project_id, entity_type)
  WHERE discipline = 'spec';

-- Spec section lookup by label (section number stored as label)
CREATE INDEX IF NOT EXISTS idx_entities_spec_label
  ON project_entities(project_id, label)
  WHERE discipline = 'spec' AND label IS NOT NULL;

-- Spec sections only (most common query: "what does section X require?")
CREATE INDEX IF NOT EXISTS idx_entities_spec_section
  ON project_entities(project_id, canonical_name)
  WHERE discipline = 'spec' AND entity_type = 'spec_section';

-- ============================================================================
-- PART 5: Performance indexes for RFI entity queries
-- ============================================================================

-- All RFI-discipline entities for a project
CREATE INDEX IF NOT EXISTS idx_entities_rfi
  ON project_entities(project_id, entity_type)
  WHERE discipline = 'rfi';

-- RFI label lookup (RFI number stored as label: "RFI-023", "ASI-002")
CREATE INDEX IF NOT EXISTS idx_entities_rfi_label
  ON project_entities(project_id, label)
  WHERE discipline = 'rfi' AND label IS NOT NULL;

-- Open / unanswered RFIs (status='new') — coordination risk queries
CREATE INDEX IF NOT EXISTS idx_entities_rfi_open
  ON project_entities(project_id, status)
  WHERE discipline = 'rfi' AND status = 'new';

-- ============================================================================
-- PART 6: Performance indexes for submittal entity queries
-- ============================================================================

-- All submittal entities for a project
CREATE INDEX IF NOT EXISTS idx_entities_submittal
  ON project_entities(project_id, entity_type)
  WHERE discipline = 'submittal';

-- Submittal label lookup (submittal ID stored as label)
CREATE INDEX IF NOT EXISTS idx_entities_submittal_label
  ON project_entities(project_id, label)
  WHERE discipline = 'submittal' AND label IS NOT NULL;

-- Approved submittals only (status='to_remain') — governing doc queries
CREATE INDEX IF NOT EXISTS idx_entities_submittal_approved
  ON project_entities(project_id, status)
  WHERE discipline = 'submittal' AND status = 'to_remain';

-- ============================================================================
-- PART 7: Performance indexes for Phase 6 finding types
-- ============================================================================

-- Requirement finding family (partial index — all 7 spec requirement types)
CREATE INDEX IF NOT EXISTS idx_findings_material_req
  ON entity_findings(entity_id, finding_type)
  WHERE finding_type = 'material_requirement';

CREATE INDEX IF NOT EXISTS idx_findings_testing_req
  ON entity_findings(entity_id, finding_type)
  WHERE finding_type = 'testing_requirement';

CREATE INDEX IF NOT EXISTS idx_findings_submittal_req
  ON entity_findings(entity_id, finding_type)
  WHERE finding_type = 'submittal_requirement';

-- Clarification statement — most queried RFI finding type
CREATE INDEX IF NOT EXISTS idx_findings_clarification
  ON entity_findings(entity_id, finding_type)
  WHERE finding_type = 'clarification_statement';

-- Approval status — most queried submittal finding type
CREATE INDEX IF NOT EXISTS idx_findings_approval_status
  ON entity_findings(entity_id, finding_type)
  WHERE finding_type = 'approval_status';

-- ============================================================================
-- PART 8: Performance indexes for Phase 6 relationship types
-- ============================================================================

-- governs relationships (spec section → entity/work type)
CREATE INDEX IF NOT EXISTS idx_relationships_governs
  ON entity_relationships(project_id, from_entity_id, relationship_type)
  WHERE relationship_type = 'governs';

-- clarifies relationships (RFI → drawing entity / spec section)
CREATE INDEX IF NOT EXISTS idx_relationships_clarifies
  ON entity_relationships(project_id, from_entity_id, relationship_type)
  WHERE relationship_type = 'clarifies';

-- submitted_for relationships (submittal → spec section)
CREATE INDEX IF NOT EXISTS idx_relationships_submitted_for
  ON entity_relationships(project_id, from_entity_id, relationship_type)
  WHERE relationship_type = 'submitted_for';

-- requires relationships (spec section → submittal / test action)
CREATE INDEX IF NOT EXISTS idx_relationships_requires
  ON entity_relationships(project_id, from_entity_id, relationship_type)
  WHERE relationship_type = 'requires';

-- ============================================================================
-- End of migration
-- ============================================================================
