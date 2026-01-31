-- Migration: Verify and fix projects insert RLS policy
-- Created: 2026-01-27
-- Issue: Projects insert failing with RLS violation

-- Ensure the helper function exists
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid();
$$;

-- Create helper function to get user's project IDs (if not exists from migration 00006)
CREATE OR REPLACE FUNCTION public.get_user_project_ids()
RETURNS TABLE(project_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT project_id FROM public.project_members WHERE user_id = auth.uid();
$$;

-- Create helper to check if user can manage project
CREATE OR REPLACE FUNCTION public.user_can_edit_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = p_project_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'editor')
  );
$$;

-- Drop and recreate all projects policies using helper functions
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_update ON projects;
DROP POLICY IF EXISTS projects_delete ON projects;

-- INSERT: User's org must match project's org
CREATE POLICY projects_insert ON projects
  FOR INSERT WITH CHECK (
    organization_id = public.get_user_organization_id()
  );

-- SELECT: Users can see projects they're members of
CREATE POLICY projects_select ON projects
  FOR SELECT USING (
    id IN (SELECT * FROM public.get_user_project_ids())
  );

-- UPDATE: Only owners and editors can update
CREATE POLICY projects_update ON projects
  FOR UPDATE USING (
    public.user_can_edit_project(id)
  );

-- DELETE: Only owners can delete (reuse function from migration 00006)
CREATE POLICY projects_delete ON projects
  FOR DELETE USING (
    public.user_is_project_owner(id)
  );
