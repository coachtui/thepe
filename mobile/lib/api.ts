import { supabase } from './supabase'

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API Error ${response.status}: ${error}`)
  }

  return response.json()
}

// Chat API for AI responses
// Note: React Native doesn't support Web Streams API, so we get the full response
export async function streamChat(
  projectId: string,
  messages: Array<{ role: string; content: string }>,
  onChunk: (text: string) => void,
  onComplete?: () => void
) {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('Not authenticated')
  }

  console.log('[streamChat] Sending to:', `${API_BASE}/api/mobile/chat`)
  console.log('[streamChat] Project ID:', projectId)
  console.log('[streamChat] Messages count:', messages.length)

  const response = await fetch(`${API_BASE}/api/mobile/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ messages, projectId }),
  })

  console.log('[streamChat] Response status:', response.status)

  if (!response.ok) {
    const errorText = await response.text()
    console.log('[streamChat] Error:', errorText)
    throw new Error(`Chat API Error ${response.status}: ${errorText}`)
  }

  // React Native doesn't support streaming, so get full response
  const text = await response.text()
  console.log('[streamChat] Response length:', text.length)
  console.log('[streamChat] Response preview:', text.substring(0, 200))
  onChunk(text)
  onComplete?.()
}

// Projects API
export const projectsApi = {
  list: () => apiClient<{ projects: Project[] }>('/api/projects'),
  get: (id: string) => apiClient<{ project: Project }>(`/api/projects/${id}`),
  create: (data: CreateProjectData) =>
    apiClient<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// Documents API
export const documentsApi = {
  list: (projectId: string) =>
    apiClient<{ documents: Document[] }>(
      `/api/documents?projectId=${projectId}`
    ),
  get: (id: string) => apiClient<{ document: Document }>(`/api/documents/${id}`),
  search: (projectId: string, query: string) =>
    apiClient<{ results: SearchResult[] }>('/api/documents/search', {
      method: 'POST',
      body: JSON.stringify({ projectId, query }),
    }),
}

// Types
export interface Project {
  id: string
  name: string
  description?: string
  address?: string
  project_number?: string
  status: 'active' | 'completed' | 'on_hold'
  created_at: string
  updated_at: string
}

export interface CreateProjectData {
  name: string
  description?: string
  address?: string
  project_number?: string
}

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

export interface SearchResult {
  id: string
  content: string
  similarity: number
  document_id: string
  page_number?: number
}
