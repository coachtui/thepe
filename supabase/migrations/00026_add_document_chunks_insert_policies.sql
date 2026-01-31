-- Add INSERT policies for document_chunks and document_embeddings
-- Created: 2026-01-28
-- Phase 2: Document processing needs to insert chunks and embeddings

-- Document Chunks: Allow insert if user has editor/owner role on the parent document's project
CREATE POLICY document_chunks_insert ON document_chunks
  FOR INSERT WITH CHECK (
    document_id IN (
      SELECT d.id FROM documents d
      WHERE d.project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
        AND role IN ('owner', 'editor')
      )
    )
  );

-- Document Chunks: Allow update for project editors/owners
CREATE POLICY document_chunks_update ON document_chunks
  FOR UPDATE USING (
    document_id IN (
      SELECT d.id FROM documents d
      WHERE d.project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
        AND role IN ('owner', 'editor')
      )
    )
  );

-- Document Chunks: Allow delete for project editors/owners
CREATE POLICY document_chunks_delete ON document_chunks
  FOR DELETE USING (
    document_id IN (
      SELECT d.id FROM documents d
      WHERE d.project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
        AND role IN ('owner', 'editor')
      )
    )
  );

-- Document Embeddings: Allow insert if user has editor/owner role on the parent document's project
CREATE POLICY document_embeddings_insert ON document_embeddings
  FOR INSERT WITH CHECK (
    chunk_id IN (
      SELECT dc.id FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE d.project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
        AND role IN ('owner', 'editor')
      )
    )
  );

-- Document Embeddings: Allow update for project editors/owners
CREATE POLICY document_embeddings_update ON document_embeddings
  FOR UPDATE USING (
    chunk_id IN (
      SELECT dc.id FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE d.project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
        AND role IN ('owner', 'editor')
      )
    )
  );

-- Document Embeddings: Allow delete for project editors/owners
CREATE POLICY document_embeddings_delete ON document_embeddings
  FOR DELETE USING (
    chunk_id IN (
      SELECT dc.id FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE d.project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
        AND role IN ('owner', 'editor')
      )
    )
  );
