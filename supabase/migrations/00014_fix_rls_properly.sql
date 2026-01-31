-- Migration: Fix RLS policies properly based on diagnostics
-- Created: 2026-01-27
-- Issue: Helper function returning NULL, blocking inserts

-- Step 1: Drop policies that depend on the function first
DROP POLICY IF EXISTS organizations_select ON organizations;
DROP POLICY IF EXISTS organizations_insert ON organizations;
DROP POLICY IF EXISTS organizations_update ON organizations;

-- Now we can drop and recreate the helper function
DROP FUNCTION IF EXISTS public.get_user_organization_id();

CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
BEGIN
  -- Directly query without triggering RLS
  SELECT organization_id INTO org_id
  FROM public.users
  WHERE id = auth.uid()
  LIMIT 1;

  RETURN org_id;
END;
$$;

-- Step 2: Ensure users table has minimal RLS for the function to work
-- Drop all users policies first
DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS users_select_own ON users;
DROP POLICY IF EXISTS users_select_org_members ON users;
DROP POLICY IF EXISTS users_update_own ON users;
DROP POLICY IF EXISTS users_insert ON users;

-- Create simple policy: users can ALWAYS see their own record
CREATE POLICY users_select_own ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY users_update_own ON users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (id = auth.uid());

-- Step 3: Now fix the projects INSERT policy
-- First verify what we're checking against
DROP POLICY IF EXISTS projects_insert ON projects;

-- Create a working policy that checks org_id matches
CREATE POLICY projects_insert ON projects
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.organization_id = projects.organization_id
    )
  );

-- Alternative: If the above still fails, use this ultra-permissive one temporarily
-- CREATE POLICY projects_insert ON projects
--   FOR INSERT WITH CHECK (true);

-- Step 4: Verify projects SELECT policy works
DROP POLICY IF EXISTS projects_select ON projects;

CREATE POLICY projects_select ON projects
  FOR SELECT USING (
    id IN (
      SELECT project_id
      FROM public.project_members
      WHERE user_id = auth.uid()
    )
  );

-- Grant explicit permissions on the function
GRANT EXECUTE ON FUNCTION public.get_user_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_organization_id() TO anon;

-- Step 5: Recreate the organizations policies we dropped earlier
CREATE POLICY organizations_select ON organizations
  FOR SELECT USING (
    id = public.get_user_organization_id()
  );

CREATE POLICY organizations_insert ON organizations
  FOR INSERT WITH CHECK (true);

CREATE POLICY organizations_update ON organizations
  FOR UPDATE USING (
    id = public.get_user_organization_id()
  );
