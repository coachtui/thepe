/**
 * POST /api/projects/[id]/submittal-register/lifecycle
 *
 * Advances a submittal_register_items row through its lifecycle.
 *
 * Validates the transition against the engine's allowed transitions map,
 * appends a history entry to item_payload.lifecycleStatusHistory, sets
 * lifecycle timestamps, and optionally updates metadata fields
 * (responsibleParty, dueDate, etc.).
 *
 * Auth: any project member.
 * Write path: service-role.
 *
 * Body:
 *   {
 *     item_id:               string,            // required
 *     to_status:             SubmittalLifecycleStatus,  // required
 *     note?:                 string,
 *     responsible_party?:    string | null,
 *     assigned_reviewer?:    string | null,
 *     due_date?:             string | null,     // YYYY-MM-DD
 *     lead_time_days?:       number | null,
 *     long_lead_flag?:       boolean,
 *   }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'
import {
  ALL_LIFECYCLE_STATUSES,
  buildTransition,
  timestampFieldForStatus,
  type SubmittalLifecycleStatus,
  type LifecycleHistoryEntry,
} from '@/lib/chat/submittal-lifecycle'

function isLifecycleStatus(v: unknown): v is SubmittalLifecycleStatus {
  return typeof v === 'string' && (ALL_LIFECYCLE_STATUSES as string[]).includes(v)
}

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

  const itemId = body.item_id
  if (typeof itemId !== 'string' || !itemId) {
    return NextResponse.json({ error: 'item_id is required' }, { status: 400 })
  }

  const toStatus = body.to_status
  if (!isLifecycleStatus(toStatus)) {
    return NextResponse.json(
      { error: `to_status must be one of: ${ALL_LIFECYCLE_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }

  const note = typeof body.note === 'string' ? body.note.trim() || undefined : undefined

  let svc: ReturnType<typeof createServiceRoleClient>
  try {
    svc = createServiceRoleClient()
  } catch (err) {
    console.error('[LifecycleRoute] Service-role client unavailable:', err)
    return NextResponse.json({ error: 'Service-role client unavailable' }, { status: 500 })
  }

  const { data: current, error: fetchErr } = await svc
    .from('submittal_register_items')
    .select('id, item_payload')
    .eq('id', itemId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }
  if (!current) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  const payload = current.item_payload as Record<string, unknown>
  const fromStatus = (payload.lifecycleStatus as SubmittalLifecycleStatus | undefined) ?? 'draft'

  const result = buildTransition(fromStatus, toStatus, membership.role ?? undefined, note)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  const history: LifecycleHistoryEntry[] = Array.isArray(payload.lifecycleStatusHistory)
    ? (payload.lifecycleStatusHistory as LifecycleHistoryEntry[])
    : []

  const updatedPayload: Record<string, unknown> = {
    ...payload,
    lifecycleStatus: toStatus,
    lifecycleStatusHistory: [...history, result.entry],
  }

  // Set lifecycle timestamps for key transitions
  const tsField = timestampFieldForStatus(toStatus)
  if (tsField) updatedPayload[tsField] = result.entry.changedAt

  // Optional metadata updates (only update if key present in body)
  if ('responsible_party' in body) updatedPayload.lifecycleResponsibleParty = body.responsible_party ?? null
  if ('assigned_reviewer' in body) updatedPayload.lifecycleAssignedReviewer = body.assigned_reviewer ?? null
  if ('due_date' in body) updatedPayload.lifecycleDueDate = body.due_date ?? null
  if ('lead_time_days' in body) updatedPayload.lifecycleLeadTimeDays = body.lead_time_days ?? null
  if ('long_lead_flag' in body) updatedPayload.lifecycleLongLeadFlag = Boolean(body.long_lead_flag)

  const { error: updateErr } = await svc
    .from('submittal_register_items')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ item_payload: updatedPayload as any })
    .eq('id', itemId)
    .eq('project_id', projectId)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    itemId,
    fromStatus,
    toStatus,
    changedAt: result.entry.changedAt,
    updatedFields: {
      lifecycleStatus: toStatus,
      ...(tsField ? { [tsField]: updatedPayload[tsField] } : {}),
      lifecycleResponsibleParty: updatedPayload.lifecycleResponsibleParty ?? null,
      lifecycleAssignedReviewer: updatedPayload.lifecycleAssignedReviewer ?? null,
      lifecycleDueDate: updatedPayload.lifecycleDueDate ?? null,
      lifecycleLeadTimeDays: updatedPayload.lifecycleLeadTimeDays ?? null,
      lifecycleLongLeadFlag: updatedPayload.lifecycleLongLeadFlag ?? false,
      lifecycleStatusHistory: updatedPayload.lifecycleStatusHistory,
    },
  })
}
