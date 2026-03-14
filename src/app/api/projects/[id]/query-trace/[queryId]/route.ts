/**
 * GET /api/projects/[id]/query-trace/[queryId]
 *
 * Returns all EvidenceItems for the given queryId from the in-memory trace store.
 * Scope: server-side debug only. Requires project membership.
 * Traces expire 30 minutes after the originating chat request.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { getStoredTrace } from '@/lib/chat/chat-handler'

export async function GET(
  _req: Request,
  { params }: { params: { id: string; queryId: string } }
) {
  const { id: projectId, queryId } = params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const trace = getStoredTrace(queryId)

  if (!trace) {
    return NextResponse.json(
      { error: 'Trace not found or expired. Traces are kept for 30 minutes.' },
      { status: 404 }
    )
  }

  if (trace.projectId !== projectId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    queryId: trace.queryId,
    projectId: trace.projectId,
    itemCount: trace.items.length,
    items: trace.items,
  })
}
