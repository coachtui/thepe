import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface Project {
  id: string
  name: string
  description?: string
  address?: string
  status: 'active' | 'completed' | 'on_hold'
  created_at: string
  updated_at: string
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Not authenticated')
        return
      }

      // Get projects where user is a member
      const { data, error: queryError } = await supabase
        .from('projects')
        .select(`
          *,
          project_members!inner(role)
        `)
        .eq('project_members.user_id', user.id)
        .order('created_at', { ascending: false })

      if (queryError) throw queryError
      setProjects(data || [])
    } catch (err) {
      console.error('Failed to fetch projects:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const refresh = useCallback(() => {
    return fetchProjects()
  }, [fetchProjects])

  return {
    projects,
    loading,
    error,
    refresh,
  }
}

export function useProject(projectId: string | null) {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) {
      setProject(null)
      return
    }

    const fetchProject = async () => {
      try {
        setLoading(true)
        setError(null)

        const { data, error: queryError } = await supabase
          .from('projects')
          .select('*')
          .eq('id', projectId)
          .single()

        if (queryError) throw queryError
        setProject(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch project')
      } finally {
        setLoading(false)
      }
    }

    fetchProject()
  }, [projectId])

  return { project, loading, error }
}
