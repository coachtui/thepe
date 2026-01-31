import { createClient } from '@/lib/db/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const url = new URL(request.url)
  const origin = url.origin

  return NextResponse.redirect(`${origin}/sign-in`)
}
