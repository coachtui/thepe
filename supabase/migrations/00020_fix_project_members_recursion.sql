-- Migration: Fix project_members INSERT recursion
-- Created: 2026-01-28
-- Issue: Can't add first member to new project (infinite recursion)
-- Solution: Allow insert if project has no members OR user is owner/editor

-- Drop and recreate the project_members INSERT policy
DROP POLICY IF EXISTS project_members_insert ON project_members;

CREATE POLICY project_members_insert ON project_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if project has no members yet (first member being added)
    public.project_has_no_members(project_id)
    OR
    -- Allow if user is already an owner or editor of the project
    project_id IN (
      SELECT pm.project_id
      FROM project_members pm
      WHERE pm.user_id = auth.uid()
      AND pm.role IN ('owner', 'editor')
    )
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
