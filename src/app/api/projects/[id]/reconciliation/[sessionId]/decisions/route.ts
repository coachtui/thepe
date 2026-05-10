/**
 * POST /api/projects/[id]/reconciliation/[sessionId]/decisions
 *
 * Upserts a single match decision. Called immediately on each user
 * accept/reject action in the ReconciliationTab.
 *
 * Body: { external_row_id: string, generated_item_id: string, decision: 'confirmed' | 'rejected' }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'

export async function POST(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const { id: projectId, sessionId } = params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { external_row_id: string; generated_item_id: string; decision: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.external_row_id || !body.generated_item_id) {
    return NextResponse.json({ error: 'external_row_id and generated_item_id are required' }, { status: 400 })
  }
  if (body.decision !== 'confirmed' && body.decision !== 'rejected') {
    return NextResponse.json({ error: 'decision must be confirmed or rejected' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceRoleClient() as any

  // Verify session belongs to this project
  const { data: session } = await svc
    .from('reconciliation_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const { error } = await svc
    .from('reconciliation_decisions')
    .upsert(
      {
        session_id: sessionId,
        external_row_id: body.external_row_id,
        generated_item_id: body.generated_item_id,
        decision: body.decision,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
      },
      { onConflict: 'session_id,external_row_id,generated_item_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
