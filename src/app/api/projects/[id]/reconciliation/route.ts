/**
 * GET  /api/projects/[id]/reconciliation
 *   Returns the most recent reconciliation session for the project
 *   plus all decisions for that session.
 *
 * POST /api/projects/[id]/reconciliation
 *   Creates a new session, replacing the previous one.
 *   Body: { source_file_name: string, external_rows: NormalizedExternalRow[] }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id
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

  const svc = createServiceRoleClient()

  const { data: session, error: sessionErr } = await svc
    .from('reconciliation_sessions')
    .select('id, source_file_name, external_rows, status, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 })
  if (!session) return NextResponse.json({ session: null, decisions: [] })

  const { data: decisions, error: decisionsErr } = await svc
    .from('reconciliation_decisions')
    .select('external_row_id, generated_item_id, decision')
    .eq('session_id', session.id)

  if (decisionsErr) return NextResponse.json({ error: decisionsErr.message }, { status: 500 })

  return NextResponse.json({ session, decisions: decisions ?? [] })
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id
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

  let body: { source_file_name: string; external_rows: unknown[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.source_file_name || !Array.isArray(body.external_rows)) {
    return NextResponse.json({ error: 'source_file_name and external_rows are required' }, { status: 400 })
  }

  const svc = createServiceRoleClient()

  const { data: session, error } = await svc
    .from('reconciliation_sessions')
    .insert({
      project_id: projectId,
      source_file_name: body.source_file_name,
      external_rows: body.external_rows as unknown as import('@/lib/db/supabase/types').Json,
      created_by: user.id,
    })
    .select('id, source_file_name, status, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ session }, { status: 201 })
}
