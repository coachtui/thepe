-- Migration: Fix infinite recursion in users RLS policy
-- Created: 2026-01-27
-- Issue: users_select policy causes infinite recursion by querying users table within its own policy

-- Drop the problematic policy
DROP POLICY IF EXISTS users_select ON users;

-- Create a simpler policy that doesn't cause recursion
-- Users can see themselves, and we'll handle organization-level access separately
CREATE POLICY users_select_own ON users
  FOR SELECT USING (id = auth.uid());

-- Create a function to check organization membership without recursion
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid();
$$;

-- Now create a policy for viewing organization members using the function
CREATE POLICY users_select_org_members ON users
  FOR SELECT USING (
    organization_id = public.get_user_organization_id()
  );

-- Also fix the organizations_select policy which has the same issue
DROP POLICY IF EXISTS organizations_select ON organizations;

CREATE POLICY organizations_select ON organizations
  FOR SELECT USING (
    id = public.get_user_organization_id()
  );

-- Fix projects_insert policy
DROP POLICY IF EXISTS projects_insert ON projects;

CREATE POLICY projects_insert ON projects
  FOR INSERT WITH CHECK (
    organization_id = public.get_user_organization_id()
  );

-- Ensure organizations can be created during signup
-- Drop and recreate to ensure it's correct
DROP POLICY IF EXISTS organizations_insert ON organizations;

CREATE POLICY organizations_insert ON organizations
  FOR INSERT WITH CHECK (true);

-- Allow authenticated users to update their own organization
CREATE POLICY organizations_update ON organizations
  FOR UPDATE USING (
    id = public.get_user_organization_id()
  );
