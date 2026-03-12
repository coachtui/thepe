/**
 * API Route: Chat with Construction PE Agent
 *
 * All business logic lives in src/lib/chat/chat-handler.ts.
 * This file handles only: authentication and request parsing.
 *
 * Pipeline (in chat-handler):
 *   query-analyzer → retrieval-orchestrator → evidence-evaluator → response-writer
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { handleChatRequest, loadProjectContext } from '@/lib/chat/chat-handler'

export async function POST(request: NextRequest) {
  try {
    // Auth
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Input validation
    const { messages, projectId, debugAi } = await request.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response('Messages array is required', { status: 400 })
    }

    if (!projectId) {
      return new Response('Project ID is required', { status: 400 })
    }

    // Load project context (name, location, contract, schedule)
    const projectContext = await loadProjectContext(supabase, projectId)

    // Run the unified chat pipeline
    return handleChatRequest({ messages, projectId, supabase, projectContext, debugAi: !!debugAi })
  } catch (error) {
    console.error('[Chat API] Error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Chat request failed',
        details: error instanceof Error ? error.stack : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
