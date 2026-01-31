import { createClient } from '@/lib/db/supabase/server'

export interface CreateProjectInput {
  name: string
  description?: string
  address?: string
  start_date?: string
  end_date?: string
  organization_id: string
  created_by: string
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  address?: string
  start_date?: string
  end_date?: string
  status?: 'active' | 'completed' | 'on_hold'
}

export async function getProjects(userId: string) {
  const supabase = await createClient()

  // Get projects where user is a member
  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      project_members!inner(role)
    `)
    .eq('project_members.user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getProjectById(projectId: string, userId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      project_members!inner(role, user_id)
    `)
    .eq('id', projectId)
    .eq('project_members.user_id', userId)
    .single()

  if (error) throw error
  return data
}

export async function createProject(input: CreateProjectInput): Promise<string> {
  const supabase = await createClient()

  // Use secure RPC function that handles RLS properly
  const { data: projectId, error } = await (supabase as any)
    .rpc('create_project_secure', {
      p_name: input.name,
      p_description: input.description || null,
      p_address: input.address || null,
      p_organization_id: input.organization_id,
      p_start_date: input.start_date || null,
      p_end_date: input.end_date || null
    })

  if (error) throw error
  return projectId as string
}

export async function updateProject(
  projectId: string,
  userId: string,
  updates: UpdateProjectInput
) {
  const supabase = await createClient()

  // Verify user has permission (owner or editor)
  const { data: member } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .single()

  if (!member || (member.role !== 'owner' && member.role !== 'editor')) {
    throw new Error('Insufficient permissions')
  }

  const { data, error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteProject(projectId: string, userId: string) {
  const supabase = await createClient()

  // Verify user is owner
  const { data: member } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .single()

  if (!member || member.role !== 'owner') {
    throw new Error('Only project owners can delete projects')
  }

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)

  if (error) throw error
}

export async function getProjectMembers(projectId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('project_members')
    .select(`
      role,
      joined_at,
      users (
        id,
        email,
        full_name,
        avatar_url
      )
    `)
    .eq('project_id', projectId)
    .order('joined_at', { ascending: true })

  if (error) throw error
  return data
}
