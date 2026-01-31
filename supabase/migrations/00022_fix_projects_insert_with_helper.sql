-- Migration: Fix projects INSERT using helper function
-- Created: 2026-01-28
-- Issue: projects INSERT still blocked even with proper query
-- Solution: Use the get_user_organization_id() helper function with SECURITY DEFINER

-- Drop and recreate projects INSERT policy using helper function
DROP POLICY IF EXISTS projects_insert ON projects;

CREATE POLICY projects_insert ON projects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Use helper function that bypasses RLS
    organization_id = public.get_user_organization_id()
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
