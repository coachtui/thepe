'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/db/supabase/types'

export async function signUpWithEmail(
  email: string,
  password: string,
  fullName: string,
  organizationName: string
) {
  // Use regular client for auth
  const cookieStore = await cookies()
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  // Create auth user with metadata (trigger will auto-create user profile)
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/callback`,
      data: {
        full_name: fullName,
      },
    },
  })

  if (authError) {
    return { error: authError.message }
  }

  if (!authData.user) {
    return { error: 'Failed to create user' }
  }

  try {
    // Check if service role key is available
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set')
      throw new Error('Server configuration error')
    }

    // Use service role client to bypass RLS for signup
    const supabaseAdmin = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    // Create organization
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert({ name: organizationName })
      .select()
      .single()

    if (orgError) {
      console.error('Organization creation error:', orgError)
      throw new Error(`Failed to create organization: ${orgError.message}`)
    }

    // Update user's organization_id (user profile was auto-created by trigger)
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ organization_id: org.id })
      .eq('id', authData.user.id)

    if (updateError) {
      console.error('User update error:', updateError)
      throw new Error(`Failed to link user to organization: ${updateError.message}`)
    }

    return { success: true }
  } catch (error) {
    console.error('Signup error:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create profile' }
  }
}
