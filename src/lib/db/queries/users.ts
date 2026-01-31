import { createClient } from '@/lib/db/supabase/server'

export async function createUserProfile(userId: string, email: string, fullName?: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('users')
    .insert({
      id: userId,
      email,
      full_name: fullName || email.split('@')[0],
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getUserProfile(userId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data
}

export async function updateUserProfile(
  userId: string,
  updates: { full_name?: string; avatar_url?: string }
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}
