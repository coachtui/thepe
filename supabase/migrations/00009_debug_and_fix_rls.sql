-- Migration: Debug and fix RLS policy for projects
-- Created: 2026-01-27
-- Issue: INSERT still violating RLS despite helper function

-- Let's try a different approach: use a direct subquery instead of a function
-- This avoids potential issues with SECURITY DEFINER context

-- Drop the current insert policy
DROP POLICY IF EXISTS projects_insert ON projects;

-- Create a simpler policy that doesn't rely on a function
-- Users can insert projects if the organization_id matches their own
CREATE POLICY projects_insert ON projects
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Let's also make sure the user can read their own profile
-- Drop and recreate to ensure it's correct
DROP POLICY IF EXISTS users_select_own ON users;
DROP POLICY IF EXISTS users_select_org_members ON users;

-- First policy: Users can always see their own record
CREATE POLICY users_select_own ON users
  FOR SELECT USING (id = auth.uid());

-- Second policy: Users can see other members of their organization
-- Using the helper function to avoid recursion
CREATE POLICY users_select_org_members ON users
  FOR SELECT USING (
    organization_id = public.get_user_organization_id()
  );
