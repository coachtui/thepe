-- Migration: Demo Entity Schema Extensions
-- Created: 2026-03-10
--
-- PURPOSE
--   Extend the universal entity model to support demo discipline entities.
--   No new tables are needed — all demo data uses the existing 5-table model.
--
--   Changes:
--     1. Extend project_entities.status CHECK to include 'unknown'
--        'unknown' is the explicit safe fallback for demo items whose status
--        cannot be determined from the drawing. Better to be honest than to
--        default to 'existing' and mislead downstream reasoning.
--
--     2. Add targeted indexes for fast demo entity queries.
--
-- IDEMPOTENCY
--   Safe to re-run. All operations are conditional.
--
-- NO DATA CHANGES
--   Purely schema. No rows are inserted, updated, or deleted.

-- ============================================================================
-- PART 1: Extend status CHECK constraint to add 'unknown'
--
-- Strategy:
--   1. If 'unknown' is already in the constraint (re-run), skip entirely.
--   2. Otherwise, find and drop the existing status CHECK by name pattern,
--      then recreate it with 'unknown' added.
-- ============================================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Skip if 'unknown' is already a valid status (idempotent re-run)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid  = 'project_entities'::regclass
      AND contype   = 'c'
      AND pg_get_constraintdef(oid) LIKE '%unknown%'
  ) THEN
    -- Find the current status CHECK constraint name
    SELECT conname INTO v_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'project_entities'::regclass
      AND contype  = 'c'
      AND conname LIKE '%status%'
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE project_entities DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    -- Recreate with 'unknown' included
    ALTER TABLE project_entities
      ADD CONSTRAINT project_entities_status_check
      CHECK (status IN (
        'existing', 'new', 'to_remove', 'to_relocate',
        'to_protect', 'to_remain', 'temporary', 'proposed', 'nts', 'unknown'
      ));
  END IF;
END $$;

-- ============================================================================
-- PART 2: Targeted indexes for demo entity queries
--
-- These complement the existing utility indexes from migration 00038.
-- They make the three most common demo query patterns fast.
-- ============================================================================

-- All demo entities for a project (most common access pattern: discipline filter)
CREATE INDEX IF NOT EXISTS idx_entities_demo
  ON project_entities(project_id, entity_type)
  WHERE discipline = 'demo';

-- Demo entities by status (to_remove / to_remain / to_protect / to_relocate)
CREATE INDEX IF NOT EXISTS idx_entities_demo_status
  ON project_entities(project_id, status)
  WHERE discipline = 'demo';

-- Demo scope findings — the most accessed finding types for demo queries
CREATE INDEX IF NOT EXISTS idx_findings_demo_scope
  ON entity_findings(entity_id, finding_type)
  WHERE finding_type IN ('demo_scope', 'risk_note', 'requirement');

-- ============================================================================
-- End of migration
-- ============================================================================
