import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface Document {
  id: string
  project_id: string
  filename: string
  file_path: string
  file_type: string
  document_type?: string
  processing_status: 'pending' | 'processing' | 'completed' | 'failed'
  created_at: string
}

export function useDocuments(projectId: string | null) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDocuments = useCallback(async () => {
    if (!projectId) {
      setDocuments([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const { data, error: queryError } = await supabase
        .from('documents')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (queryError) throw queryError
      setDocuments(data || [])
    } catch (err) {
      console.error('Failed to fetch documents:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch documents')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  const refresh = useCallback(() => {
    return fetchDocuments()
  }, [fetchDocuments])

  return {
    documents,
    loading,
    error,
    refresh,
  }
}
