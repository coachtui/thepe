-- Migration: Ultra permissive policy to test if org check is the issue
-- Created: 2026-01-27
-- TEMPORARY - just for testing

DROP POLICY IF EXISTS projects_insert ON projects;

-- Most permissive policy possible - just check authentication
CREATE POLICY projects_insert ON projects
  FOR INSERT WITH CHECK (true);
