'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/db/supabase/client'
import { updateProjectAction, deleteProjectAction } from '../actions'
import { getDocuments } from '@/lib/db/queries/documents'
import { DocumentUpload } from '@/components/documents/DocumentUpload'
import { DocumentList } from '@/components/documents/DocumentList'
import { DocumentSearch } from '@/components/documents/DocumentSearch'
import { ChatInterface } from '@/components/chat/ChatInterface'
import { SubmittalsCommandCenter } from '@/components/submittal/SubmittalsCommandCenter'
import { OperationsCommandCenter } from '@/components/operations/OperationsCommandCenter'
import type { Database } from '@/lib/db/supabase/types'

type Document = Database['public']['Tables']['documents']['Row']

interface Project {
  id: string
  name: string
  description: string | null
  address: string | null
  status: 'active' | 'completed' | 'on_hold'
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
  project_members: Array<{ role: string; user_id: string }>
}

type TabId = 'overview' | 'documents' | 'chat' | 'submittals' | 'operations'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'documents', label: 'Documents' },
  { id: 'chat', label: 'AI Chat' },
  { id: 'submittals', label: 'Submittals' },
  { id: 'operations', label: 'Operations' },
]

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20',
  on_hold: 'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-600/20',
  completed: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
}

const INPUT_CLASS =
  'block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400 transition-colors duration-150'

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('overview')
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

  const pollRef = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    const hasProcessing = documents.some(
      (d) =>
        d.processing_status === 'pending' ||
        d.processing_status === 'processing' ||
        d.vision_status === 'processing'
    )
    if (hasProcessing) {
      pollRef.current = setInterval(() => {
        loadDocuments(false)
      }, 5000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [documents])

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
    if (
      !confirm(
        'This will process all documents in the project with vision analysis. This may take 20-30 minutes and cost $1-2. Continue?'
      )
    ) {
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

      alert(
        `Analysis complete!\n\nProcessed ${result.totalSheetsProcessed} sheets\nExtracted ${result.totalQuantitiesExtracted} quantities\nCost: $${result.totalCost.toFixed(2)}`
      )
      checkAnalysisStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const loadDocuments = async (showLoading = true) => {
    if (showLoading) setLoadingDocuments(true)
    try {
      const supabase = createClient()
      const docs = await getDocuments(supabase, params.id)
      setDocuments(docs)
    } catch (error) {
      console.error('Error loading documents:', error)
    } finally {
      if (showLoading) setLoadingDocuments(false)
    }
  }

  const loadProject = async () => {
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data, error } = await supabase
        .from('projects')
        .select(
          `
          *,
          project_members!inner(role, user_id)
        `
        )
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
    if (
      !confirm('Are you sure you want to delete this project? This action cannot be undone.')
    ) {
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
        <div className="text-slate-400 text-sm">Loading project...</div>
      </div>
    )
  }

  if (error && !project) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500 text-sm">Project not found</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Back navigation */}
      <button
        onClick={() => router.push('/projects')}
        className="text-sm text-slate-500 hover:text-slate-800 transition-colors duration-150 cursor-pointer"
      >
        ← Back to Projects
      </button>

      {/* Project Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[project.status] ?? STATUS_STYLES.active}`}
              >
                {STATUS_LABELS[project.status] ?? project.status}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 flex-wrap">
              {project.address && <span>{project.address}</span>}
              {(project.start_date || project.end_date) && (
                <span>
                  {formatDate(project.start_date)} – {formatDate(project.end_date)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {documents.length > 0 && !analysisStatus?.isComplete && (
              <button
                onClick={handleAnalyze}
                disabled={analyzing || analysisStatus?.isProcessing}
                className="px-3 py-1.5 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
              >
                {analyzing || analysisStatus?.isProcessing ? 'Analyzing...' : 'Analyze'}
              </button>
            )}
            {analysisStatus?.isComplete && (
              <span className="px-3 py-1.5 bg-green-50 text-green-700 text-sm font-medium rounded-lg ring-1 ring-inset ring-green-600/20">
                Analysis complete
              </span>
            )}
            {canEdit && !editing && (
              <button
                onClick={() => {
                  setEditing(true)
                  setActiveTab('overview')
                }}
                className="px-3 py-1.5 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors duration-150 cursor-pointer"
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors duration-150 cursor-pointer"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-100 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id)
                setEditing(false)
              }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors duration-150 cursor-pointer ${
                activeTab === tab.id
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          {editing ? (
            <form onSubmit={handleUpdate} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={INPUT_CLASS}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className={INPUT_CLASS}
                  rows={4}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({ ...formData, status: e.target.value as any })
                  }
                  className={INPUT_CLASS}
                >
                  <option value="active">Active</option>
                  <option value="on_hold">On Hold</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) =>
                      setFormData({ ...formData, start_date: e.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) =>
                      setFormData({ ...formData, end_date: e.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false)
                    setError(null)
                  }}
                  className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors duration-150 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors duration-150 cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-5">
              {project.description ? (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Description
                  </p>
                  <p className="text-sm text-slate-700 leading-relaxed">{project.description}</p>
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">No description added.</p>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 pt-4 border-t border-gray-100">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Status
                  </p>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[project.status] ?? STATUS_STYLES.active}`}
                  >
                    {STATUS_LABELS[project.status] ?? project.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Start Date
                  </p>
                  <p className="text-sm text-slate-700">{formatDate(project.start_date)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    End Date
                  </p>
                  <p className="text-sm text-slate-700">{formatDate(project.end_date)}</p>
                </div>
              </div>

              {project.address && (
                <div className="pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Location
                  </p>
                  <p className="text-sm text-slate-700">{project.address}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Documents Tab */}
      {activeTab === 'documents' && (
        <div className="space-y-5">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Upload Documents</h2>
            <DocumentUpload projectId={params.id} onUploadComplete={loadDocuments} />
          </div>

          {documents.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Search Documents</h2>
              <DocumentSearch projectId={params.id} />
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            {loadingDocuments ? (
              <div className="text-center py-8">
                <p className="text-sm text-slate-400">Loading documents...</p>
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

      {/* Chat Tab */}
      {activeTab === 'chat' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          {documents.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm font-medium text-slate-600 mb-1">No documents yet</p>
              <p className="text-sm text-slate-400">
                Upload documents in the Documents tab to start chatting with the AI assistant.
              </p>
            </div>
          ) : (
            <ChatInterface projectId={params.id} />
          )}
        </div>
      )}

      {/* Submittals Tab */}
      {activeTab === 'submittals' && (
        <SubmittalsCommandCenter projectId={params.id} />
      )}

      {/* Operations Tab */}
      {activeTab === 'operations' && (
        <OperationsCommandCenter projectId={params.id} />
      )}
    </div>
  )
}
