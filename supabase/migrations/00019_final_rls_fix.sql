-- Migration: Final RLS Fix for Projects
-- Created: 2026-01-28
-- Issue: Auth context working but INSERT still blocked (42501 error)
-- Solution: Ensure proper grants and recreate policies correctly

-- Step 1: Ensure authenticated role has all necessary grants
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Specifically grant on key tables
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT SELECT ON public.organizations TO authenticated;

-- Step 2: Drop ALL existing policies on projects table to start fresh
DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_update ON projects;
DROP POLICY IF EXISTS projects_delete ON projects;

-- Step 3: Create clean, working policies

-- SELECT: Users can see projects they're members of
CREATE POLICY projects_select ON projects
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT project_id
      FROM project_members
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: Users can create projects in their organization
CREATE POLICY projects_insert ON projects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Must belong to the organization
    organization_id IN (
      SELECT organization_id
      FROM users
      WHERE id = auth.uid()
    )
  );

-- UPDATE: Owners and editors can update projects
CREATE POLICY projects_update ON projects
  FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT project_id
      FROM project_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'editor')
    )
  );

-- DELETE: Only owners can delete projects
CREATE POLICY projects_delete ON projects
  FOR DELETE
  TO authenticated
  USING (
    id IN (
      SELECT project_id
      FROM project_members
      WHERE user_id = auth.uid()
      AND role = 'owner'
    )
  );

-- Step 4: Ensure project_members policies are correct
DROP POLICY IF EXISTS project_members_select ON project_members;
DROP POLICY IF EXISTS project_members_insert ON project_members;
DROP POLICY IF EXISTS project_members_delete ON project_members;

-- Users can see members of their projects
CREATE POLICY project_members_select ON project_members
  FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT project_id
      FROM project_members
      WHERE user_id = auth.uid()
    )
  );

-- Users can add members to projects they own or manage
CREATE POLICY project_members_insert ON project_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    project_id IN (
      SELECT project_id
      FROM project_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'editor')
    )
  );

-- Owners can remove members
CREATE POLICY project_members_delete ON project_members
  FOR DELETE
  TO authenticated
  USING (
    project_id IN (
      SELECT project_id
      FROM project_members
      WHERE user_id = auth.uid()
      AND role = 'owner'
    )
  );

-- Step 5: Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- Step 6: Verify the fix
-- Run these queries to confirm:
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
-- WHERE tablename = 'projects' ORDER BY cmd, policyname;
