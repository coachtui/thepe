'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/db/supabase/client'
import { CreateProjectModal } from '@/components/projects/create-project-modal'

interface Project {
  id: string
  name: string
  description: string | null
  address: string | null
  status: string | null
  start_date: string | null
  end_date: string | null
  created_at: string | null
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  useEffect(() => {
    loadProjects()
  }, [])

  const loadProjects = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) return

      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          project_members!inner(role)
        `)
        .eq('project_members.user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setProjects(data || [])
    } catch (error) {
      console.error('Error loading projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800'
      case 'planning':
        return 'bg-blue-100 text-blue-800'
      case 'on_hold':
        return 'bg-yellow-100 text-yellow-800'
      case 'completed':
        return 'bg-gray-100 text-gray-800'
      case 'cancelled':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading projects...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
          <p className="mt-2 text-gray-600">
            Manage your construction projects
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
        >
          + New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
          <span className="text-6xl">🏗️</span>
          <h3 className="mt-4 text-lg font-medium text-gray-900">No projects yet</h3>
          <p className="mt-2 text-gray-500">Get started by creating your first project.</p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
          >
            Create Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6"
            >
              <div className="flex items-start justify-between">
                <h3 className="text-lg font-semibold text-gray-900 truncate">
                  {project.name}
                </h3>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(
                    project.status || 'active'
                  )}`}
                >
                  {project.status || 'active'}
                </span>
              </div>

              {project.description && (
                <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                  {project.description}
                </p>
              )}

              {project.address && (
                <p className="mt-2 text-sm text-gray-500">
                  📍 {project.address}
                </p>
              )}

              <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>Start: {formatDate(project.start_date)}</span>
                  <span>End: {formatDate(project.end_date)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreateProjectModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false)
          loadProjects()
        }}
      />
    </div>
  )
}
