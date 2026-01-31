/**
 * Document database queries
 * Phase 2: Document Management & RAG
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/supabase/types'

type Document = Database['public']['Tables']['documents']['Row']
type DocumentInsert = Database['public']['Tables']['documents']['Insert']
type DocumentUpdate = Database['public']['Tables']['documents']['Update']

/**
 * Get all documents for a project
 */
export async function getDocuments(
  supabase: SupabaseClient<Database>,
  projectId: string
): Promise<Document[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching documents:', error)
    throw new Error('Failed to fetch documents')
  }

  return data || []
}

/**
 * Get a single document by ID
 */
export async function getDocument(
  supabase: SupabaseClient<Database>,
  documentId: string
): Promise<Document | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single()

  if (error) {
    console.error('Error fetching document:', error)
    return null
  }

  return data
}

/**
 * Create a document record (called after file upload to storage)
 */
export async function createDocument(
  supabase: SupabaseClient<Database>,
  document: DocumentInsert
): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .insert(document)
    .select()
    .single()

  if (error) {
    console.error('Error creating document:', error)
    throw new Error('Failed to create document record')
  }

  return data
}

/**
 * Update document metadata
 */
export async function updateDocument(
  supabase: SupabaseClient<Database>,
  documentId: string,
  updates: DocumentUpdate
): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .update(updates)
    .eq('id', documentId)
    .select()
    .single()

  if (error) {
    console.error('Error updating document:', error)
    throw new Error('Failed to update document')
  }

  return data
}

/**
 * Delete a document (also removes from storage)
 */
export async function deleteDocument(
  supabase: SupabaseClient<Database>,
  documentId: string
): Promise<void> {
  // First get the file path
  const { data: document, error: fetchError } = await supabase
    .from('documents')
    .select('file_path')
    .eq('id', documentId)
    .single()

  if (fetchError) {
    console.error('Error fetching document for deletion:', fetchError)
    throw new Error('Failed to find document')
  }

  // Delete from storage
  const { error: storageError } = await supabase.storage
    .from('documents')
    .remove([document.file_path])

  if (storageError) {
    console.error('Error deleting file from storage:', storageError)
    // Continue anyway - the file might already be deleted
  }

  // Delete from database
  const { error: dbError } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)

  if (dbError) {
    console.error('Error deleting document from database:', dbError)
    throw new Error('Failed to delete document')
  }
}

/**
 * Update document processing status
 */
export async function updateDocumentStatus(
  supabase: SupabaseClient<Database>,
  documentId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  pageCount?: number
): Promise<void> {
  const updates: DocumentUpdate = {
    processing_status: status,
    updated_at: new Date().toISOString(),
  }

  if (pageCount !== undefined) {
    updates.page_count = pageCount
  }

  const { error } = await supabase
    .from('documents')
    .update(updates)
    .eq('id', documentId)

  if (error) {
    console.error('Error updating document status:', error)
    throw new Error('Failed to update document status')
  }
}

/**
 * Get documents by processing status
 */
export async function getDocumentsByStatus(
  supabase: SupabaseClient<Database>,
  projectId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed'
): Promise<Document[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('project_id', projectId)
    .eq('processing_status', status)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching documents by status:', error)
    throw new Error('Failed to fetch documents')
  }

  return data || []
}

/**
 * Upload file to Supabase Storage
 */
export async function uploadDocumentFile(
  supabase: SupabaseClient<Database>,
  projectId: string,
  file: File
): Promise<{ path: string; publicUrl: string }> {
  // Create unique filename
  const timestamp = Date.now()
  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const fileName = `${projectId}/${timestamp}-${sanitizedFileName}`

  // Upload to storage
  const { data, error } = await supabase.storage
    .from('documents')
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error) {
    console.error('Error uploading file:', error)
    throw new Error(`Failed to upload file: ${error.message}`)
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from('documents').getPublicUrl(data.path)

  return {
    path: data.path,
    publicUrl,
  }
}

/**
 * Get signed URL for private document access
 */
export async function getDocumentSignedUrl(
  supabase: SupabaseClient<Database>,
  filePath: string,
  expiresIn: number = 3600
): Promise<string> {
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(filePath, expiresIn)

  if (error) {
    console.error('Error creating signed URL:', error)
    throw new Error('Failed to create signed URL')
  }

  return data.signedUrl
}
