import { NextResponse, type NextRequest } from 'next/server'

// Middleware is intentionally a pass-through. Auth is handled in each
// page/route via createClient() + supabase.auth.getUser(). The previous
// middleware called getUser() at the edge which caused
// MIDDLEWARE_INVOCATION_TIMEOUT when the Supabase auth round-trip was slow.
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [],
}
