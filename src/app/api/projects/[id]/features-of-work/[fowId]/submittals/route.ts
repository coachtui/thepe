/**
 * POST /api/projects/[id]/features-of-work/[fowId]/submittals
 * Body: { submittalIds: string[] }
 * Bulk-assigns submittals to a FOW by writing fowEntityId into item_payload.
 *
 * DELETE /api/projects/[id]/features-of-work/[fowId]/submittals
 * Body: { submittalIds: string[] }
 * Unassigns submittals from any FOW (clears fowEntityId).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'

async function authorize(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!membership) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, membership }
}

async function applyAssignment(
  projectId: string,
  fowId: string | null,
  submittalIds: string[]
): Promise<{ updatedCount: number; failedCount: number }> {
  const svc = createServiceRoleClient()
  let updatedCount = 0
  let failedCount = 0

  for (const submittalId of submittalIds) {
    const { data: row, error: fetchErr } = await svc
      .from('submittal_register_items')
      .select('id, item_payload')
      .eq('id', submittalId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (fetchErr || !row) { failedCount++; continue }

    const payload = (row.item_payload ?? {}) as Record<string, unknown>
    const updatedPayload = fowId
      ? { ...payload, fowEntityId: fowId }
      : { ...payload, fowEntityId: null }

    const { error: updateErr } = await svc
      .from('submittal_register_items')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ item_payload: updatedPayload as any })
      .eq('id', submittalId)
      .eq('project_id', projectId)

    if (updateErr) { failedCount++; continue }
    updatedCount++
  }

  return { updatedCount, failedCount }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string; fowId: string } }
) {
  const { id: projectId, fowId } = params

  const auth = await authorize(projectId)
  if ('error' in auth) return auth.error

  let body: { submittalIds?: string[] }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!Array.isArray(body.submittalIds) || body.submittalIds.length === 0) {
    return NextResponse.json({ error: 'submittalIds (non-empty array) is required' }, { status: 400 })
  }

  const svc = createServiceRoleClient()
  // Verify FOW belongs to project
  const { data: fow } = await svc
    .from('project_entities')
    .select('id')
    .eq('id', fowId)
    .eq('project_id', projectId)
    .eq('entity_type', 'feature_of_work')
    .maybeSingle()
  if (!fow) return NextResponse.json({ error: 'FOW not found' }, { status: 404 })

  const result = await applyAssignment(projectId, fowId, body.submittalIds)
  return NextResponse.json(result)
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; fowId: string } }
) {
  const { id: projectId } = params

  const auth = await authorize(projectId)
  if ('error' in auth) return auth.error

  let body: { submittalIds?: string[] }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!Array.isArray(body.submittalIds) || body.submittalIds.length === 0) {
    return NextResponse.json({ error: 'submittalIds (non-empty array) is required' }, { status: 400 })
  }

  const result = await applyAssignment(projectId, null, body.submittalIds)
  return NextResponse.json(result)
}
