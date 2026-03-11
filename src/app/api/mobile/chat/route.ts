/**
 * Mobile API Route: Chat with Construction PE Agent (Bearer Token Auth)
 *
 * Identical pipeline to /api/chat — only auth differs.
 * Business logic lives in src/lib/chat/chat-handler.ts.
 *
 * Pipeline (in chat-handler):
 *   query-analyzer → retrieval-orchestrator → evidence-evaluator → response-writer
 */

import { NextRequest } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/supabase/types'
import { handleChatRequest, loadProjectContext } from '@/lib/chat/chat-handler'

function createAuthenticatedClient(token: string) {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    }
  )
}

export async function POST(request: NextRequest) {
  try {
    // Auth — Bearer token (mobile clients send this instead of session cookie)
    const authHeader = request.headers.get('authorization')

    if (!authHeader?.startsWith('Bearer ')) {
      return new Response('Unauthorized - Bearer token required', { status: 401 })
    }

    const token = authHeader.slice(7)
    const supabase = createAuthenticatedClient(token)

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('[Mobile Chat] Auth error:', authError?.message)
      return new Response('Unauthorized - Invalid token', { status: 401 })
    }

    // Input validation
    const { messages, projectId } = await request.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response('Messages array is required', { status: 400 })
    }

    if (!projectId) {
      return new Response('Project ID is required', { status: 400 })
    }

    // Load project context
    const projectContext = await loadProjectContext(supabase, projectId)

    // Run the unified chat pipeline (same as web route)
    return handleChatRequest({ messages, projectId, supabase, projectContext })
  } catch (error) {
    console.error('[Mobile Chat] Error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Chat request failed',
        details: error instanceof Error ? error.stack : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
