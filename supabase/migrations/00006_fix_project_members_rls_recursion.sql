-- Migration: Fix infinite recursion in project_members RLS policy
-- Created: 2026-01-27
-- Issue: project_members_select policy causes infinite recursion by querying itself

-- Create helper functions to bypass RLS using SECURITY DEFINER

-- Get user's project IDs (for SELECT)
CREATE OR REPLACE FUNCTION public.get_user_project_ids()
RETURNS TABLE(project_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT project_id FROM public.project_members WHERE user_id = auth.uid();
$$;

-- Check if user can manage project members (owner or editor)
CREATE OR REPLACE FUNCTION public.user_can_manage_project(p_project_id uuid)
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

-- Check if user is project owner
CREATE OR REPLACE FUNCTION public.user_is_project_owner(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = p_project_id
    AND user_id = auth.uid()
    AND role = 'owner'
  );
$$;

-- Check if project has no members yet (for first member)
CREATE OR REPLACE FUNCTION public.project_has_no_members(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.project_members WHERE project_id = p_project_id
  );
$$;

-- Drop the problematic policies
DROP POLICY IF EXISTS project_members_select ON project_members;
DROP POLICY IF EXISTS project_members_insert ON project_members;
DROP POLICY IF EXISTS project_members_delete ON project_members;

-- Create new policies using the helper functions

-- SELECT: Users can see members of projects they're in
CREATE POLICY project_members_select ON project_members
  FOR SELECT USING (
    project_id IN (SELECT * FROM public.get_user_project_ids())
  );

-- INSERT: Owners/editors can add members, or allow first member for new projects
CREATE POLICY project_members_insert ON project_members
  FOR INSERT WITH CHECK (
    public.user_can_manage_project(project_id)
    OR public.project_has_no_members(project_id)
  );

-- DELETE: Only owners can remove members
CREATE POLICY project_members_delete ON project_members
  FOR DELETE USING (
    public.user_is_project_owner(project_id)
  );
