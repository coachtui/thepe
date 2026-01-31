/**
 * Vector search with pgvector
 * Phase 2: Document Management & RAG
 */

import { createClient } from '@/lib/db/supabase/client'
import { createClient as createServerClient } from '@/lib/db/supabase/server'
import type { Database } from '@/lib/db/supabase/types'
import type { SupabaseClient } from '@supabase/supabase-js'

type DocumentChunk = Database['public']['Tables']['document_chunks']['Row']
type DocumentEmbedding = Database['public']['Tables']['document_embeddings']['Row']
type Document = Database['public']['Tables']['documents']['Row']

export interface SearchResult {
  chunk: DocumentChunk
  document: Document
  similarity: number
  rank: number
}

// Result type from the search_documents RPC function
export interface RpcSearchResult {
  chunk_id: string
  document_id: string
  chunk_index: number
  content: string
  page_number: number | null
  similarity: number
  document_filename: string
  sheet_number: string | null
  project_id: string
}

export interface SearchOptions {
  limit?: number
  similarityThreshold?: number
  projectId?: string
  documentIds?: string[]
}

/**
 * Create document chunks in the database
 */
export async function createDocumentChunks(
  supabase: SupabaseClient<Database>,
  documentId: string,
  chunks: Array<{
    content: string
    chunkIndex: number
    pageNumber?: number
    chunkType?: string
    containsComponents?: boolean
    componentList?: string[]
    systemName?: string
    station?: string
  }>
): Promise<DocumentChunk[]> {
  const chunksToInsert = chunks.map((chunk) => ({
    document_id: documentId,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    page_number: chunk.pageNumber,
    chunk_type: chunk.chunkType || 'text',
    contains_components: chunk.containsComponents,
    component_list: chunk.componentList,
    system_name: chunk.systemName,
    station: chunk.station,
  }))

  const { data, error } = await supabase
    .from('document_chunks')
    .insert(chunksToInsert)
    .select()

  if (error) {
    console.error('Error creating document chunks:', error)
    throw new Error('Failed to create document chunks')
  }

  return data
}

/**
 * Create embeddings for document chunks
 */
export async function createDocumentEmbeddings(
  supabase: SupabaseClient<Database>,
  embeddings: Array<{
    chunkId: string
    embedding: number[]
    modelVersion: string
  }>
): Promise<void> {
  const embeddingsToInsert = embeddings.map((emb) => ({
    chunk_id: emb.chunkId,
    embedding: `[${emb.embedding.join(',')}]`, // pgvector format
    model_version: emb.modelVersion,
  }))

  const { error } = await supabase
    .from('document_embeddings')
    .insert(embeddingsToInsert)

  if (error) {
    console.error('Error creating document embeddings:', error)
    throw new Error('Failed to create document embeddings')
  }
}

/**
 * Search for similar documents using vector similarity
 * Uses cosine similarity with pgvector
 */
export async function searchDocuments(
  queryEmbedding: number[],
  options: SearchOptions = {}
): Promise<RpcSearchResult[]> {
  const {
    limit = 10,
    similarityThreshold = 0.5,
    projectId,
    documentIds,
  } = options

  const supabase = await createServerClient()

  // Convert embedding to pgvector format
  const embeddingString = `[${queryEmbedding.join(',')}]`

  // Build the query
  let query = supabase
    .from('document_embeddings')
    .select(
      `
      *,
      chunk:document_chunks!inner(
        *,
        document:documents!inner(*)
      )
    `
    )
    .order('similarity', { ascending: false })
    .limit(limit)

  // Apply filters
  if (projectId) {
    query = query.eq('chunk.document.project_id', projectId)
  }

  if (documentIds && documentIds.length > 0) {
    query = query.in('chunk.document_id', documentIds)
  }

  // Execute search with pgvector similarity
  // Note: This uses a PostgreSQL function for cosine similarity
  const { data, error } = await (supabase as any).rpc('search_documents', {
    query_embedding: embeddingString,
    match_count: limit,
    similarity_threshold: similarityThreshold,
    filter_project_id: projectId || null,
    filter_document_ids: documentIds && documentIds.length > 0 ? documentIds : null,
  })

  if (error) {
    console.error('Error searching documents:', error)
    throw new Error('Failed to search documents')
  }

  return data || []
}

/**
 * Get chunks for a specific document
 */
export async function getDocumentChunks(
  documentId: string
): Promise<DocumentChunk[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('document_chunks')
    .select('*')
    .eq('document_id', documentId)
    .order('chunk_index', { ascending: true })

  if (error) {
    console.error('Error fetching document chunks:', error)
    throw new Error('Failed to fetch document chunks')
  }

  return data || []
}

/**
 * Get embedding for a specific chunk
 */
export async function getChunkEmbedding(
  chunkId: string
): Promise<DocumentEmbedding | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('document_embeddings')
    .select('*')
    .eq('chunk_id', chunkId)
    .single()

  if (error) {
    console.error('Error fetching chunk embedding:', error)
    return null
  }

  return data
}

/**
 * Delete all chunks and embeddings for a document
 */
export async function deleteDocumentChunks(documentId: string): Promise<void> {
  const supabase = createClient()

  // Delete embeddings first (due to foreign key)
  const { data: chunks } = await supabase
    .from('document_chunks')
    .select('id')
    .eq('document_id', documentId)

  if (chunks && chunks.length > 0) {
    const chunkIds = chunks.map((c) => c.id)

    await supabase.from('document_embeddings').delete().in('chunk_id', chunkIds)
  }

  // Delete chunks
  const { error } = await supabase
    .from('document_chunks')
    .delete()
    .eq('document_id', documentId)

  if (error) {
    console.error('Error deleting document chunks:', error)
    throw new Error('Failed to delete document chunks')
  }
}

/**
 * Get statistics for embeddings
 */
export async function getEmbeddingStats(projectId?: string): Promise<{
  totalDocuments: number
  totalChunks: number
  totalEmbeddings: number
  documentsWithEmbeddings: number
}> {
  const supabase = await createServerClient()

  let query = supabase.from('documents').select('id', { count: 'exact' })

  if (projectId) {
    query = query.eq('project_id', projectId)
  }

  const { count: totalDocuments } = await query

  const { count: totalChunks } = await supabase
    .from('document_chunks')
    .select('id', { count: 'exact' })

  const { count: totalEmbeddings } = await supabase
    .from('document_embeddings')
    .select('id', { count: 'exact' })

  const { count: documentsWithEmbeddings } = await supabase
    .from('documents')
    .select('id', { count: 'exact' })
    .eq('processing_status', 'completed')

  return {
    totalDocuments: totalDocuments || 0,
    totalChunks: totalChunks || 0,
    totalEmbeddings: totalEmbeddings || 0,
    documentsWithEmbeddings: documentsWithEmbeddings || 0,
  }
}
