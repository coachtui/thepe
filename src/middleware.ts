import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session if expired - handle errors gracefully
  let user = null
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      // Log auth errors but don't crash - treat as unauthenticated
      // This handles cases like "Invalid Refresh Token: Refresh Token Not Found"
      console.warn('[Middleware] Auth error:', error.message)
    } else {
      user = data.user
    }
  } catch (error) {
    // Handle unexpected errors (network issues, etc.)
    console.error('[Middleware] Unexpected auth error:', error)
  }

  // Protected routes - require authentication
  if (request.nextUrl.pathname.startsWith('/dashboard') ||
      request.nextUrl.pathname.startsWith('/projects')) {
    if (!user) {
      // Redirect to sign-in page
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/sign-in'
      redirectUrl.searchParams.set('redirectedFrom', request.nextUrl.pathname)
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Auth routes - redirect to dashboard if already logged in with complete profile
  if (request.nextUrl.pathname.startsWith('/sign-in')) {
    if (user) {
      // Check if user has a profile
      const { data: profile } = await supabase
        .from('users')
        .select('id')
        .eq('id', user.id)
        .single()

      const redirectUrl = request.nextUrl.clone()

      if (profile) {
        // User has profile, redirect to dashboard
        redirectUrl.pathname = '/dashboard'
      } else {
        // User doesn't have profile, redirect to sign-up to complete it
        redirectUrl.pathname = '/sign-up'
      }

      return NextResponse.redirect(redirectUrl)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
