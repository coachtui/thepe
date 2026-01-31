-- Migration: Complete reset of all RLS policies
-- Created: 2026-01-27
-- Issue: RLS still blocking inserts despite all fixes

-- Step 1: Drop ALL policies on all tables to start fresh
DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS users_select_own ON users;
DROP POLICY IF EXISTS users_select_org_members ON users;
DROP POLICY IF EXISTS users_update_own ON users;
DROP POLICY IF EXISTS users_insert ON users;

DROP POLICY IF EXISTS organizations_select ON organizations;
DROP POLICY IF EXISTS organizations_insert ON organizations;
DROP POLICY IF EXISTS organizations_update ON organizations;

DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_update ON projects;
DROP POLICY IF EXISTS projects_delete ON projects;

DROP POLICY IF EXISTS project_members_select ON project_members;
DROP POLICY IF EXISTS project_members_insert ON project_members;
DROP POLICY IF EXISTS project_members_update ON project_members;
DROP POLICY IF EXISTS project_members_delete ON project_members;

-- Step 2: Ensure all helper functions exist with correct definitions
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_user_project_ids()
RETURNS TABLE(project_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT project_id FROM public.project_members WHERE user_id = auth.uid();
$$;

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

-- Step 3: Create simple, clear policies

-- USERS: Can only see their own record (no org members for now to avoid recursion)
CREATE POLICY users_select_own ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY users_update_own ON users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (id = auth.uid());

-- ORGANIZATIONS: Users can see and update their own org
CREATE POLICY organizations_select ON organizations
  FOR SELECT USING (
    id = public.get_user_organization_id()
  );

CREATE POLICY organizations_insert ON organizations
  FOR INSERT WITH CHECK (true); -- Allow creation during signup

CREATE POLICY organizations_update ON organizations
  FOR UPDATE USING (
    id = public.get_user_organization_id()
  );

-- PROJECTS: Simple direct subquery approach
CREATE POLICY projects_select ON projects
  FOR SELECT USING (
    id IN (SELECT * FROM public.get_user_project_ids())
  );

-- Try the most permissive INSERT policy first to test
CREATE POLICY projects_insert ON projects
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL  -- Just check that user is authenticated
  );

CREATE POLICY projects_update ON projects
  FOR UPDATE USING (
    public.user_can_manage_project(id)
  );

CREATE POLICY projects_delete ON projects
  FOR DELETE USING (
    public.user_is_project_owner(id)
  );

-- PROJECT_MEMBERS: Use helper functions to avoid recursion
CREATE POLICY project_members_select ON project_members
  FOR SELECT USING (
    project_id IN (SELECT * FROM public.get_user_project_ids())
  );

CREATE POLICY project_members_insert ON project_members
  FOR INSERT WITH CHECK (
    public.user_can_manage_project(project_id)
    OR public.project_has_no_members(project_id)
  );

CREATE POLICY project_members_delete ON project_members
  FOR DELETE USING (
    public.user_is_project_owner(project_id)
  );

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
