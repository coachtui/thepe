-- Add missing SELECT policies for document_chunks and document_embeddings
-- Created: 2026-01-28
-- Purpose: Allow users to read chunks and embeddings from their projects

-- Document Chunks: Allow select for project members
CREATE POLICY document_chunks_select ON document_chunks
  FOR SELECT USING (
    document_id IN (
      SELECT d.id FROM documents d
      WHERE d.project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Document Embeddings: Allow select for project members
CREATE POLICY document_embeddings_select ON document_embeddings
  FOR SELECT USING (
    chunk_id IN (
      SELECT dc.id FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE d.project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Add helpful comments
COMMENT ON POLICY document_chunks_select ON document_chunks IS
  'Allow authenticated users to read document chunks from projects they have access to';

COMMENT ON POLICY document_embeddings_select ON document_embeddings IS
  'Allow authenticated users to read embeddings from projects they have access to';
