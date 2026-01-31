-- Migration: Restore correct project_members policy using helper functions
-- Created: 2026-01-28
-- Issue: Migration 00019 overwrote the working policy from 00006 with a recursive one
-- Solution: Use the SECURITY DEFINER helper functions that bypass RLS

-- Drop the broken policy
DROP POLICY IF EXISTS project_members_insert ON project_members;

-- Recreate using helper functions (which use SECURITY DEFINER to bypass RLS)
CREATE POLICY project_members_insert ON project_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if user can manage the project (owner/editor)
    public.user_can_manage_project(project_id)
    OR
    -- Allow if project has no members yet (first member)
    public.project_has_no_members(project_id)
  );

-- Also fix SELECT to use helper function
DROP POLICY IF EXISTS project_members_select ON project_members;

CREATE POLICY project_members_select ON project_members
  FOR SELECT
  TO authenticated
  USING (
    -- Use helper function to avoid recursion
    project_id IN (SELECT * FROM public.get_user_project_ids())
  );

-- Also fix DELETE to use helper function
DROP POLICY IF EXISTS project_members_delete ON project_members;

CREATE POLICY project_members_delete ON project_members
  FOR DELETE
  TO authenticated
  USING (
    -- Use helper function to avoid recursion
    public.user_is_project_owner(project_id)
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
