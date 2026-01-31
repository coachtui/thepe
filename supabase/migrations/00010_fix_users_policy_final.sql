-- Migration: Fix users policy recursion once and for all
-- Created: 2026-01-27
-- Issue: users_select_org_members creates recursion by calling get_user_organization_id()

-- Drop all users SELECT policies
DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS users_select_own ON users;
DROP POLICY IF EXISTS users_select_org_members ON users;

-- Create ONLY the self-select policy
-- Users can ALWAYS see their own record, no function calls needed
CREATE POLICY users_select_own ON users
  FOR SELECT USING (id = auth.uid());

-- Now fix the projects_insert policy to use a direct subquery
-- This avoids calling the helper function which might have context issues
DROP POLICY IF EXISTS projects_insert ON projects;

CREATE POLICY projects_insert ON projects
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.users WHERE id = auth.uid()
    )
  );
