-- Migration 00051 — extend project_entities.discipline CHECK to include 'spec'.
--
-- Background: `src/lib/vision/spec-extractor.ts` documented (since Phase 6A)
-- that spec-extracted entities go to `project_entities` with
-- `discipline='spec'`, but the CHECK constraint introduced in 00038 never
-- listed 'spec' in its allowed array. Result: any insert with
-- `discipline='spec'` fails with `project_entities_discipline_check`.
-- A3a/A3b/A3c (spec extraction pipeline → persistence → Inngest function)
-- depend on this value being writable.
--
-- This migration drops and re-creates the constraint with 'spec' added.
-- All other allowed disciplines from 00038 are preserved verbatim.
-- Idempotent: guarded with conditional drop.
--
-- Down-migration is the inverse (removing 'spec'); not provided here because
-- the project does not use down-migrations.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_entities_discipline_check'
      AND conrelid = 'public.project_entities'::regclass
  ) THEN
    ALTER TABLE public.project_entities
      DROP CONSTRAINT project_entities_discipline_check;
  END IF;
END $$;

ALTER TABLE public.project_entities
  ADD CONSTRAINT project_entities_discipline_check
  CHECK (discipline = ANY (ARRAY[
    'utility'::text,
    'demo'::text,
    'architectural'::text,
    'structural'::text,
    'mep'::text,
    'schedule'::text,
    'general'::text,
    'spec'::text
  ]));
