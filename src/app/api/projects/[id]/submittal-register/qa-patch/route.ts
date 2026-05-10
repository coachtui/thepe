/**
 * POST /api/projects/[id]/submittal-register/qa-patch
 *
 * Applies QA resolution patches to a submittal_register_items row.
 *
 * Two modes:
 *   Field update — sets sdCode, approvalAuthority, or lifecycleDueDate (via `dueDate`) in
 *   item_payload. These clear fixable QA findings once the field is populated.
 *
 *   Acknowledgement — records that a reviewer intentionally accepted a QA issue.
 *   Supported types: duplicate_submittal, missing_source_excerpt.
 *   Acknowledgements are group-aware: duplicate suppression only occurs when all
 *   members of a duplicate group are acknowledged.
 *
 * Auth: any project member.
 * Write path: service-role.
 *
 * Body (camelCase throughout):
 *   {
 *     itemId:              string,                                   // required
 *     // Field updates (pick at most one):
 *     sdCode?:             string | null,
 *     approvalAuthority?:  string | null,
 *     dueDate?:            string | null,  // YYYY-MM-DD → stored as lifecycleDueDate
 *     // Acknowledgement (mutually exclusive with field updates in spirit, not enforced):
 *     acknowledge?:        'duplicate_submittal' | 'missing_source_excerpt',
 *     note?:               string,
 *   }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'

const ACKNOWLEDGE_TYPES = ['duplicate_submittal', 'missing_source_excerpt'] as const
type AcknowledgeType = (typeof ACKNOWLEDGE_TYPES)[number]

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const itemId = body.itemId
  if (typeof itemId !== 'string' || !itemId) {
    return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
  }

  const hasFieldUpdate =
    'sdCode' in body ||
    'approvalAuthority' in body ||
    'dueDate' in body ||
    'relatedFOW' in body ||
    'scheduleActivity' in body ||
    'activityNeedByDate' in body ||
    'blocksWork' in body
  const hasAcknowledge = 'acknowledge' in body

  if (!hasFieldUpdate && !hasAcknowledge) {
    return NextResponse.json(
      { error: 'At least one of sdCode, approvalAuthority, dueDate, relatedFOW, scheduleActivity, activityNeedByDate, blocksWork, or acknowledge is required' },
      { status: 400 },
    )
  }

  if (hasAcknowledge && !(ACKNOWLEDGE_TYPES as readonly string[]).includes(body.acknowledge as string)) {
    return NextResponse.json(
      { error: `acknowledge must be one of: ${ACKNOWLEDGE_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  let svc: ReturnType<typeof createServiceRoleClient>
  try {
    svc = createServiceRoleClient()
  } catch (err) {
    console.error('[QAPatchRoute] Service-role client unavailable:', err)
    return NextResponse.json({ error: 'Service-role client unavailable' }, { status: 500 })
  }

  const { data: current, error: fetchErr } = await svc
    .from('submittal_register_items')
    .select('id, item_payload')
    .eq('id', itemId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const payload = current.item_payload as Record<string, unknown>
  const updatedPayload: Record<string, unknown> = { ...payload }
  const updatedFields: Record<string, unknown> = {}

  if (hasFieldUpdate) {
    if ('sdCode' in body) {
      updatedPayload.sdCode = body.sdCode ?? null
      updatedFields.sdCode = updatedPayload.sdCode
    }
    if ('approvalAuthority' in body) {
      updatedPayload.approvalAuthority = body.approvalAuthority ?? null
      updatedFields.approvalAuthority = updatedPayload.approvalAuthority
    }
    if ('dueDate' in body) {
      updatedPayload.lifecycleDueDate = body.dueDate ?? null
      updatedFields.lifecycleDueDate = updatedPayload.lifecycleDueDate
    }
    if ('relatedFOW' in body) {
      updatedPayload.relatedFOW = body.relatedFOW ?? null
      updatedFields.relatedFOW = updatedPayload.relatedFOW
    }
    if ('scheduleActivity' in body) {
      updatedPayload.scheduleActivity = body.scheduleActivity ?? null
      updatedFields.scheduleActivity = updatedPayload.scheduleActivity
    }
    if ('activityNeedByDate' in body) {
      updatedPayload.activityNeedByDate = body.activityNeedByDate ?? null
      updatedFields.activityNeedByDate = updatedPayload.activityNeedByDate
    }
    if ('blocksWork' in body) {
      updatedPayload.blocksWork = typeof body.blocksWork === 'boolean' ? body.blocksWork : null
      updatedFields.blocksWork = updatedPayload.blocksWork
    }
  }

  if (hasAcknowledge) {
    const ackType = body.acknowledge as AcknowledgeType
    const note =
      typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined
    const acknowledgedBy = user.email ?? user.id

    const existing = (payload.qaAcknowledgements as Record<string, unknown> | undefined) ?? {}
    const merged = {
      ...existing,
      [ackType]: {
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy,
        ...(note ? { note } : {}),
      },
    }
    updatedPayload.qaAcknowledgements = merged
    updatedFields.qaAcknowledgements = merged
  }

  const { error: updateErr } = await svc
    .from('submittal_register_items')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ item_payload: updatedPayload as any })
    .eq('id', itemId)
    .eq('project_id', projectId)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ success: true, itemId, updatedFields })
}
