-- Migration: Update Vector Search Function to Include Sheet Number
-- Created: 2026-01-28
-- Purpose: Add sheet_number to search results and support document ID filtering

-- Drop the old function
DROP FUNCTION IF EXISTS search_documents(vector, integer, float, uuid);

-- Create updated function with sheet_number and document filtering
CREATE OR REPLACE FUNCTION search_documents(
  query_embedding vector(1536),
  match_count integer DEFAULT 10,
  similarity_threshold float DEFAULT 0.5,
  filter_project_id uuid DEFAULT NULL,
  filter_document_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  chunk_index integer,
  content text,
  page_number integer,
  similarity float,
  document_filename text,
  sheet_number text,
  project_id uuid
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id AS chunk_id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    dc.page_number,
    1 - (de.embedding <=> query_embedding) AS similarity,
    d.filename AS document_filename,
    d.sheet_number,
    d.project_id
  FROM document_embeddings de
  JOIN document_chunks dc ON de.chunk_id = dc.id
  JOIN documents d ON dc.document_id = d.id
  WHERE
    (filter_project_id IS NULL OR d.project_id = filter_project_id)
    AND (filter_document_ids IS NULL OR d.id = ANY(filter_document_ids))
    AND (1 - (de.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY de.embedding <=> query_embedding ASC
  LIMIT match_count;
END;
$$;

-- Add helpful comment
COMMENT ON FUNCTION search_documents IS
  'Phase 3: Semantic search with sheet number and document filtering support. Returns chunks with sheet_number for better context attribution.';
