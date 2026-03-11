-- Migration: Structural + MEP Entity Schema Extensions
-- Created: 2026-03-11
-- Phase: 5A + 5B
--
-- PURPOSE
--   Extend the universal entity model to support structural and MEP discipline
--   entities, plus the cross-discipline coordination reasoning layer.
--
--   NOTE: 'structural' and 'mep' are ALREADY valid discipline values in the
--   project_entities.discipline CHECK constraint (migration 00038, line 57).
--   No discipline constraint change is needed here.
--
--   Changes:
--     1. Extend entity_findings.finding_type CHECK to add:
--          'load_bearing'     — structural load-path significance note
--          'capacity'         — panel amperage, duct CFM, pipe sizing
--          'equipment_tag'    — equipment nameplate data (HP, voltage, FLA)
--          'circuit_ref'      — electrical circuit origin reference
--          'coordination_note'— cross-discipline coordination note
--
--     2. Extend entity_relationships.relationship_type CHECK to add:
--          'supports'         — structural load-path (column → beam, footing → column)
--          'served_by'        — MEP service connection (room → panel, room → AHU)
--
--     3. Add performance indexes for structural and MEP entity queries.
--
--     4. Add cross-discipline room query index on entity_locations.
--
-- IDEMPOTENCY
--   Safe to re-run. All DDL operations are conditional.
--
-- NO DATA CHANGES
--   Purely schema. No rows are inserted, updated, or deleted.

-- ============================================================================
-- PART 1: Extend entity_findings.finding_type CHECK
--
-- Adds: 'load_bearing', 'capacity', 'equipment_tag', 'circuit_ref',
--       'coordination_note'
--
-- Strategy: If 'load_bearing' is already present (re-run), skip.
-- Otherwise find and replace the existing finding_type CHECK by name pattern.
-- ============================================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Skip if 'load_bearing' is already a valid finding_type (idempotent re-run)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'entity_findings'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) LIKE '%load_bearing%'
  ) THEN
    -- Find the current finding_type CHECK constraint name
    SELECT conname INTO v_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'entity_findings'::regclass
      AND contype  = 'c'
      AND conname LIKE '%finding_type%'
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE entity_findings DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    -- Recreate with all existing values + Phase 5 additions
    ALTER TABLE entity_findings
      ADD CONSTRAINT entity_findings_finding_type_check
      CHECK (finding_type IN (
        -- existing types (Phases 1-4)
        'quantity', 'material', 'requirement', 'demo_scope', 'crossing_count',
        'sequence_hint', 'risk_note', 'dimension', 'elevation',
        'specification_ref', 'note',
        'schedule_row', 'constraint',
        -- Phase 5 additions
        'load_bearing', 'capacity', 'equipment_tag', 'circuit_ref',
        'coordination_note'
      ));
  END IF;
END $$;

-- ============================================================================
-- PART 2: Extend entity_relationships.relationship_type CHECK
--
-- Adds: 'supports', 'served_by'
--
-- Strategy: If 'supports' is already present (re-run), skip.
-- Otherwise find and replace the existing relationship_type CHECK by name pattern.
-- ============================================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Skip if 'supports' is already a valid relationship_type (idempotent re-run)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'entity_relationships'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) LIKE '%supports%'
  ) THEN
    -- Find the current relationship_type CHECK constraint name
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

    -- Recreate with all existing values + Phase 5 additions
    ALTER TABLE entity_relationships
      ADD CONSTRAINT entity_relationships_relationship_type_check
      CHECK (relationship_type IN (
        -- existing types (Phases 1-4)
        'located_in', 'described_by', 'applies_to',
        -- Phase 5 additions
        'supports', 'served_by'
      ));
  END IF;
END $$;

-- ============================================================================
-- PART 3: Performance indexes for structural entity queries
-- ============================================================================

-- All structural entities for a project (most common: discipline filter)
CREATE INDEX IF NOT EXISTS idx_entities_structural
  ON project_entities(project_id, entity_type)
  WHERE discipline = 'structural';

-- Structural entities by label (mark lookup: F-1, C-4, W12×26)
CREATE INDEX IF NOT EXISTS idx_entities_structural_label
  ON project_entities(project_id, label)
  WHERE discipline = 'structural' AND label IS NOT NULL;

-- ============================================================================
-- PART 4: Performance indexes for MEP entity queries
-- ============================================================================

-- All MEP entities for a project
CREATE INDEX IF NOT EXISTS idx_entities_mep
  ON project_entities(project_id, entity_type)
  WHERE discipline = 'mep';

-- MEP entities by entity_type (trade classification is derived from entity_type)
CREATE INDEX IF NOT EXISTS idx_entities_mep_type
  ON project_entities(project_id, entity_type)
  WHERE discipline = 'mep';

-- MEP entities by label (equipment tag lookup: LP-1, AHU-1, WC-3)
CREATE INDEX IF NOT EXISTS idx_entities_mep_label
  ON project_entities(project_id, label)
  WHERE discipline = 'mep' AND label IS NOT NULL;

-- Panel schedule entries (most common MEP schedule query)
CREATE INDEX IF NOT EXISTS idx_entities_mep_schedule
  ON project_entities(project_id, subtype)
  WHERE discipline = 'mep' AND entity_type = 'schedule_entry';

-- ============================================================================
-- PART 5: Performance indexes for capacity + equipment_tag findings
-- (used by MEP element reasoning and coordination reasoning)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_findings_capacity
  ON entity_findings(entity_id, finding_type)
  WHERE finding_type = 'capacity';

CREATE INDEX IF NOT EXISTS idx_findings_equipment_tag
  ON entity_findings(entity_id, finding_type)
  WHERE finding_type = 'equipment_tag';

CREATE INDEX IF NOT EXISTS idx_findings_coordination_note
  ON entity_findings(entity_id, finding_type)
  WHERE finding_type = 'coordination_note';

-- ============================================================================
-- PART 6: Cross-discipline room query index on entity_locations
--
-- Enables fast "what trades are in Room 105?" queries by joining
-- project_entities + entity_locations on room_number.
--
-- This is the coordination query anchor — the most performance-critical
-- index in Phase 5B.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_location_room_discipline
  ON entity_locations(project_id, room_number, entity_id)
  WHERE room_number IS NOT NULL;

-- ============================================================================
-- End of migration
-- ============================================================================
