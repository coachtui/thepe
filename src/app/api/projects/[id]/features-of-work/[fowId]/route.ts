/**
 * PATCH  /api/projects/[id]/features-of-work/[fowId]
 *   Body: { name?, specSections?, trade?, subcontractor?, sequence?, status? }
 *   Updates a FOW entity. Re-normalizes canonical_name if name changes.
 *
 * DELETE /api/projects/[id]/features-of-work/[fowId]
 *   Deletes the FOW entity. Does not touch submittals (relation is derived).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'
import { normalizeFowName, type FowReviewStatus } from '@/lib/graph/fow-readiness'

interface FowMetadata {
  specSections?: string[]
  trade?: string | null
  subcontractor?: string | null
  sequence?: number
}

async function authorize(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: membership } = await supabase
    .from('project_members').select('role').eq('project_id', projectId).eq('user_id', user.id).single()
  if (!membership) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, membership }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; fowId: string } }
) {
  const { id: projectId, fowId } = params

  const auth = await authorize(projectId)
  if ('error' in auth) return auth.error

  let body: {
    name?: string
    specSections?: string[]
    trade?: string | null
    subcontractor?: string | null
    sequence?: number
    status?: FowReviewStatus
  }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const svc = createServiceRoleClient()

  const { data: current, error: fetchErr } = await svc
    .from('project_entities')
    .select('id, metadata, display_name, canonical_name, status')
    .eq('id', fowId)
    .eq('project_id', projectId)
    .eq('entity_type', 'feature_of_work')
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'FOW not found' }, { status: 404 })

  const currentMeta = (current.metadata ?? {}) as FowMetadata
  const newMeta: FowMetadata = {
    specSections: Array.isArray(body.specSections) ? body.specSections : currentMeta.specSections ?? [],
    trade: 'trade' in body ? body.trade ?? null : currentMeta.trade ?? null,
    subcontractor: 'subcontractor' in body ? body.subcontractor ?? null : currentMeta.subcontractor ?? null,
    sequence: typeof body.sequence === 'number' ? body.sequence : currentMeta.sequence ?? 0,
  }

  const updateRow: Record<string, unknown> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: newMeta as any,
  }
  if (typeof body.name === 'string' && body.name.trim()) {
    updateRow.display_name = body.name.trim()
    updateRow.canonical_name = normalizeFowName(body.name)
  }
  if (body.status) updateRow.status = body.status

  const { data: updated, error: updateErr } = await svc
    .from('project_entities')
    .update(updateRow)
    .eq('id', fowId)
    .eq('project_id', projectId)
    .select('id, project_id, canonical_name, display_name, discipline, status, metadata')
    .single()

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ fow: updated })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; fowId: string } }
) {
  const { id: projectId, fowId } = params

  const auth = await authorize(projectId)
  if ('error' in auth) return auth.error

  const svc = createServiceRoleClient()

  const { error } = await svc
    .from('project_entities')
    .delete()
    .eq('id', fowId)
    .eq('project_id', projectId)
    .eq('entity_type', 'feature_of_work')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
