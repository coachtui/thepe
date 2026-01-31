'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/db/supabase/server'
import { createProject, updateProject, deleteProject } from '@/lib/db/queries/projects'
import { getUserProfile } from '@/lib/db/queries/users'
import type { Database } from '@/lib/db/supabase/types'

type UserProfile = Database['public']['Tables']['users']['Row']

export async function createProjectAction(formData: {
  name: string
  description?: string
  address?: string
  start_date?: string
  end_date?: string
}) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      console.error('[createProject] Not authenticated')
      return { error: 'Not authenticated' }
    }

    console.log('[createProject] User ID:', user.id)

    const userProfile = (await getUserProfile(user.id)) as UserProfile
    console.log('[createProject] User profile:', userProfile)

    if (!userProfile?.organization_id) {
      console.error('[createProject] No organization_id found for user')
      return { error: 'No organization found. Please contact support.' }
    }

    console.log('[createProject] Creating project with org ID:', userProfile.organization_id)

    const projectId = await createProject({
      name: formData.name,
      description: formData.description,
      address: formData.address,
      start_date: formData.start_date,
      end_date: formData.end_date,
      organization_id: userProfile.organization_id,
      created_by: user.id,
    })

    console.log('[createProject] Project created successfully:', projectId)

    revalidatePath('/projects')
    return { success: true, projectId }
  } catch (error) {
    console.error('[createProject] Error:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create project' }
  }
}

export async function updateProjectAction(
  projectId: string,
  formData: {
    name?: string
    description?: string
    address?: string
    start_date?: string
    end_date?: string
    status?: 'active' | 'completed' | 'on_hold'
  }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { error: 'Not authenticated' }
    }

    const project = await updateProject(projectId, user.id, formData)

    revalidatePath('/projects')
    revalidatePath(`/projects/${projectId}`)
    return { success: true, project }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to update project' }
  }
}

export async function deleteProjectAction(projectId: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { error: 'Not authenticated' }
    }

    await deleteProject(projectId, user.id)

    revalidatePath('/projects')
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to delete project' }
  }
}
