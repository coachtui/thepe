'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/db/supabase/client'
import { updateProjectAction, deleteProjectAction } from '../actions'
import { getDocuments } from '@/lib/db/queries/documents'
import { DocumentUpload } from '@/components/documents/DocumentUpload'
import { DocumentList } from '@/components/documents/DocumentList'
import { DocumentSearch } from '@/components/documents/DocumentSearch'
import { ChatInterface } from '@/components/chat/ChatInterface'
import type { Database } from '@/lib/db/supabase/types'

type Document = Database['public']['Tables']['documents']['Row']

interface Project {
  id: string
  name: string
  description: string | null
  address: string | null
  status: 'active' | 'completed' | 'on_hold' | null
  start_date: string | null
  end_date: string | null
  created_at: string | null
  project_members: Array<{ role: string }>
}

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState<{
    name: string
    description: string
    address: string
    status: 'active' | 'completed' | 'on_hold'
    start_date: string
    end_date: string
  }>({
    name: '',
    description: '',
    address: '',
    status: 'active',
    start_date: '',
    end_date: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [loadingDocuments, setLoadingDocuments] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisStatus, setAnalysisStatus] = useState<{
    isComplete: boolean
    isProcessing: boolean
    stats?: any
  } | null>(null)

  useEffect(() => {
    loadProject()
    loadDocuments()
    checkAnalysisStatus()
  }, [])

  const checkAnalysisStatus = async () => {
    try {
      const response = await fetch(`/api/projects/${params.id}/analyze-complete`)
      if (response.ok) {
        const data = await response.json()
        setAnalysisStatus(data)
      }
    } catch (error) {
      console.error('Error checking analysis status:', error)
    }
  }

  const handleAnalyze = async () => {
    if (!confirm('This will process all documents in the project with vision analysis. This may take 20-30 minutes and cost $1-2. Continue?')) {
      return
    }

    setAnalyzing(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${params.id}/analyze-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Analysis failed')
      }

      alert(`Analysis complete!\n\nProcessed ${result.totalSheetsProcessed} sheets\nExtracted ${result.totalQuantitiesExtracted} quantities\nCost: $${result.totalCost.toFixed(2)}`)
      checkAnalysisStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const loadDocuments = async () => {
    setLoadingDocuments(true)
    try {
      const supabase = createClient()
      const docs = await getDocuments(supabase, params.id)
      setDocuments(docs)
    } catch (error) {
      console.error('Error loading documents:', error)
    } finally {
      setLoadingDocuments(false)
    }
  }

  const loadProject = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) return

      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          project_members!inner(role, user_id)
        `)
        .eq('id', params.id)
        .eq('project_members.user_id', user.id)
        .single()

      if (error) throw error
      const projectData = data as Project
      if (projectData) {
        setProject(projectData)
        setFormData({
          name: projectData.name,
          description: projectData.description || '',
          address: projectData.address || '',
          status: projectData.status || 'active',
          start_date: projectData.start_date || '',
          end_date: projectData.end_date || '',
        })
      }
    } catch (error) {
      console.error('Error loading project:', error)
      setError('Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      const result = await updateProjectAction(params.id, formData)

      if (result.error) {
        setError(result.error)
      } else {
        setEditing(false)
        loadProject()
      }
    } catch (err) {
      setError('Failed to update project')
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      return
    }

    try {
      const result = await deleteProjectAction(params.id)

      if (result.error) {
        setError(result.error)
      } else {
        router.push('/projects')
      }
    } catch (err) {
      setError('Failed to delete project')
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not set'
    return new Date(dateString).toLocaleDateString()
  }

  const canEdit = project?.project_members.some(
    (m) => m.role === 'owner' || m.role === 'editor'
  )
  const canDelete = project?.project_members.some((m) => m.role === 'owner')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading project...</div>
      </div>
    )
  }

  if (error && !project) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Project not found</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/projects')}
          className="text-gray-600 hover:text-gray-900"
        >
          ← Back to Projects
        </button>
        <div className="space-x-2">
          {documents.length > 0 && !analysisStatus?.isComplete && (
            <button
              onClick={handleAnalyze}
              disabled={analyzing || analysisStatus?.isProcessing}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {analyzing || analysisStatus?.isProcessing ? 'Analyzing...' : 'Analyze'}
            </button>
          )}
          {analysisStatus?.isComplete && (
            <span className="px-4 py-2 bg-green-100 text-green-800 rounded-md text-sm">
              ✓ Analysis Complete ({analysisStatus.stats?.totalSheetsProcessed || 0} sheets)
            </span>
          )}
          {canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              onClick={handleDelete}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <div className="text-sm text-red-800">{error}</div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        {editing ? (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Project Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                rows={4}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Location
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              >
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Start Date
                </label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  End Date
                </label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setError(null)
                }}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Save Changes
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{project.name}</h1>
              <span className="inline-block mt-2 px-3 py-1 text-sm font-medium rounded bg-blue-100 text-blue-800">
                {project.status}
              </span>
            </div>

            {project.description && (
              <div>
                <h3 className="text-sm font-medium text-gray-500">Description</h3>
                <p className="mt-1 text-gray-900">{project.description}</p>
              </div>
            )}

            {project.address && (
              <div>
                <h3 className="text-sm font-medium text-gray-500">Location</h3>
                <p className="mt-1 text-gray-900">📍 {project.address}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-medium text-gray-500">Start Date</h3>
                <p className="mt-1 text-gray-900">{formatDate(project.start_date)}</p>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-500">End Date</h3>
                <p className="mt-1 text-gray-900">{formatDate(project.end_date)}</p>
              </div>
            </div>

            {/* AI Assistant Section */}
            {documents.length > 0 && (
              <div className="pt-6 border-t border-gray-200">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  AI Assistant
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Ask questions about your project documents using AI
                </p>
                <ChatInterface projectId={params.id} />
              </div>
            )}

            <div className="pt-6 border-t border-gray-200">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Documents</h3>

              {/* Upload Section */}
              <div className="mb-6">
                <DocumentUpload
                  projectId={params.id}
                  onUploadComplete={loadDocuments}
                />
              </div>

              {/* Search Section */}
              {documents.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-md font-medium text-gray-900 mb-3">Search Documents</h4>
                  <DocumentSearch projectId={params.id} />
                </div>
              )}

              {/* Documents List */}
              {loadingDocuments ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">Loading documents...</p>
                </div>
              ) : (
                <DocumentList
                  documents={documents}
                  projectId={params.id}
                  onDelete={loadDocuments}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
