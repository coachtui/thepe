-- Migration: Architectural Entity Schema Extensions
-- Created: 2026-03-10
--
-- PURPOSE
--   Extend the universal entity model to support architectural discipline entities.
--   No new tables are needed — all architectural data uses the existing 5-table model.
--
--   Changes:
--     1. Extend entity_findings.finding_type CHECK to add 'schedule_row' and 'constraint'.
--        'schedule_row'  = full parsed schedule row content (door / window / room finish)
--        'constraint'    = accessibility, clearance, or code constraint on an element
--
--     2. Add targeted indexes for fast architectural entity queries.
--
-- IDEMPOTENCY
--   Safe to re-run. All operations are conditional.
--
-- NO DATA CHANGES
--   Purely schema. No rows are inserted, updated, or deleted.

-- ============================================================================
-- PART 1: Extend entity_findings.finding_type CHECK to add arch finding types
--
-- Strategy:
--   1. If 'schedule_row' is already in the constraint (re-run), skip entirely.
--   2. Otherwise find and drop the existing finding_type CHECK by name pattern,
--      then recreate it with 'schedule_row' and 'constraint' added.
-- ============================================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Skip if 'schedule_row' is already a valid finding_type (idempotent re-run)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'entity_findings'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) LIKE '%schedule_row%'
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

    -- Recreate with 'schedule_row' and 'constraint' included
    ALTER TABLE entity_findings
      ADD CONSTRAINT entity_findings_finding_type_check
      CHECK (finding_type IN (
        'quantity', 'material', 'requirement', 'demo_scope', 'crossing_count',
        'sequence_hint', 'risk_note', 'dimension', 'elevation',
        'specification_ref', 'note',
        'schedule_row', 'constraint'
      ));
  END IF;
END $$;

-- ============================================================================
-- PART 2: Targeted indexes for architectural entity queries
--
-- These complement the existing utility and demo indexes.
-- They make the four most common architectural query patterns fast.
-- ============================================================================

-- All arch entities for a project (most common: discipline filter)
CREATE INDEX IF NOT EXISTS idx_entities_arch
  ON project_entities(project_id, entity_type)
  WHERE discipline = 'architectural';

-- Arch entities by label (tag lookup: D-14, W-3A, WT-A, Room 105)
-- Supports direct label equality and trgm similarity scans.
CREATE INDEX IF NOT EXISTS idx_entities_arch_label
  ON project_entities(project_id, label)
  WHERE discipline = 'architectural' AND label IS NOT NULL;

-- Schedule entries only (for schedule queries without full table scan)
CREATE INDEX IF NOT EXISTS idx_entities_arch_schedule
  ON project_entities(project_id, subtype)
  WHERE discipline = 'architectural' AND entity_type = 'schedule_entry';

-- Schedule row findings (most accessed finding type for schedule queries)
CREATE INDEX IF NOT EXISTS idx_findings_schedule_row
  ON entity_findings(entity_id, finding_type)
  WHERE finding_type = 'schedule_row';

-- described_by relationships (tag → schedule_entry linkage)
-- Supports: "find schedule entry for door D-14"
CREATE INDEX IF NOT EXISTS idx_relationships_described_by
  ON entity_relationships(from_entity_id, project_id)
  WHERE relationship_type = 'described_by';

-- ============================================================================
-- End of migration
-- ============================================================================
