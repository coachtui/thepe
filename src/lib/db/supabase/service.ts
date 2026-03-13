import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * Service-role Supabase client.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY — bypasses Row Level Security.
 * Safe to use in Inngest functions and other server-side jobs that run
 * outside the Next.js request lifecycle (no cookies available).
 *
 * Never expose this client to the browser.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable'
    )
  }

  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
