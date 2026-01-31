import { createClient } from '@/lib/db/supabase/server'

export async function createOrganization(name: string, ownerId: string) {
  const supabase = await createClient()

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name,
    })
    .select()
    .single()

  if (orgError) throw orgError

  // Update user's organization_id
  const { error: userError } = await supabase
    .from('users')
    .update({ organization_id: org.id })
    .eq('id', ownerId)

  if (userError) throw userError

  return org
}

export async function getOrganization(orgId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single()

  if (error) throw error
  return data
}

export async function updateOrganization(
  orgId: string,
  updates: { name?: string }
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('organizations')
    .update(updates)
    .eq('id', orgId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getOrganizationMembers(orgId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, avatar_url, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data
}
