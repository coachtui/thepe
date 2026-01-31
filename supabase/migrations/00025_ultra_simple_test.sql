-- Migration: Ultra simple test - just allow all authenticated inserts
-- Created: 2026-01-28
-- Purpose: Verify that grants and everything else works, isolate the policy logic

-- Drop ALL policies on projects (including any RESTRICTIVE ones we don't know about)
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'projects'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON projects', pol.policyname);
    END LOOP;
END
$$;

-- Create single, ultra-permissive policy for testing
CREATE POLICY projects_insert_test ON projects
  FOR INSERT
  TO authenticated
  WITH CHECK (true); -- Allow ALL authenticated inserts

-- Keep SELECT working
CREATE POLICY projects_select_test ON projects
  FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT * FROM public.get_user_project_ids())
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- Show what we created
SELECT policyname, cmd, permissive, with_check
FROM pg_policies
WHERE tablename = 'projects';
