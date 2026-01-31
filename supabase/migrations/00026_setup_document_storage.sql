-- Migration: Setup Document Storage and Policies
-- Created: 2026-01-28
-- Purpose: Configure Supabase Storage bucket and RLS policies for document access

-- Create storage bucket for documents (if not exists)
-- Note: This may need to be created manually in Supabase Dashboard
-- Storage -> New Bucket -> Name: "documents", Public: false

-- Storage RLS Policies for documents bucket
-- Allow authenticated users to upload documents to their project folders

-- Policy: Users can upload documents to projects they're members of
CREATE POLICY "Users can upload documents to their projects"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT p.id::text
    FROM projects p
    JOIN project_members pm ON p.id = pm.project_id
    WHERE pm.user_id = auth.uid()
  )
);

-- Policy: Users can view documents from projects they're members of
CREATE POLICY "Users can view documents from their projects"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT p.id::text
    FROM projects p
    JOIN project_members pm ON p.id = pm.project_id
    WHERE pm.user_id = auth.uid()
  )
);

-- Policy: Users can update documents from projects they can manage
CREATE POLICY "Users can update documents from projects they manage"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT p.id::text
    FROM projects p
    JOIN project_members pm ON p.id = pm.project_id
    WHERE pm.user_id = auth.uid()
      AND pm.role IN ('owner', 'editor')
  )
);

-- Policy: Users can delete documents from projects they own
CREATE POLICY "Users can delete documents from projects they own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT p.id::text
    FROM projects p
    JOIN project_members pm ON p.id = pm.project_id
    WHERE pm.user_id = auth.uid()
      AND pm.role = 'owner'
  )
);

-- Add helpful comment
COMMENT ON POLICY "Users can upload documents to their projects" ON storage.objects IS
  'Phase 2: Allow authenticated users to upload documents to project folders they have access to';
