-- Migration: Add created_by column to projects table
-- Created: 2026-01-27
-- Issue: Code tries to insert created_by but column doesn't exist

-- Add created_by column to projects table
ALTER TABLE projects
ADD COLUMN created_by uuid REFERENCES users(id);

-- Add index for performance
CREATE INDEX idx_projects_created_by ON projects(created_by);

-- Update existing projects to set created_by to the first owner found
-- This is a one-time migration for existing data
UPDATE projects p
SET created_by = (
  SELECT pm.user_id
  FROM project_members pm
  WHERE pm.project_id = p.id
  AND pm.role = 'owner'
  LIMIT 1
)
WHERE created_by IS NULL;
