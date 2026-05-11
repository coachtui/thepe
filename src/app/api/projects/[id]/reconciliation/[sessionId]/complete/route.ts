/**
 * POST /api/projects/[id]/reconciliation/[sessionId]/complete
 *
 * Marks the session complete and pushes lifecycle updates to the submittal
 * register for every confirmed match that has a meaningful external status.
 *
 * Only advances lifecycle (never regresses). Skips items where the external
 * status would be invalid or would move the item backward.
 *
 * Returns: { updatedCount, skippedCount, updatedItemIds }
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
import type { NormalizedExternalRow } from '@/lib/reconciliation/submittal-log-normalizer'

// External status strings → lifecycle statuses we'll write back
const EXTERNAL_TO_LIFECYCLE: Record<string, SubmittalLifecycleStatus> = {
  approved:           'approved',
  submitted:          'submitted',
  pending_review:     'pending_review',
  revise_resubmit:    'revise_resubmit',
  pending_submission: 'pending_submission',
}

function isLifecycleStatus(v: unknown): v is SubmittalLifecycleStatus {
  return typeof v === 'string' && (ALL_LIFECYCLE_STATUSES as string[]).includes(v)
}

export async function POST(
  _request: Request,
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

  const svc = createServiceRoleClient()

  // Load session
  const { data: session, error: sessionErr } = await svc
    .from('reconciliation_sessions')
    .select('id, external_rows, status')
    .eq('id', sessionId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status === 'complete') return NextResponse.json({ error: 'Session already complete' }, { status: 409 })

  // Load confirmed decisions that have a generated item ID
  const { data: decisions, error: decisionsErr } = await svc
    .from('reconciliation_decisions')
    .select('external_row_id, generated_item_id, decision')
    .eq('session_id', sessionId)
    .eq('decision', 'confirmed')

  if (decisionsErr) return NextResponse.json({ error: decisionsErr.message }, { status: 500 })

  const externalRows = (session.external_rows as unknown as NormalizedExternalRow[]) ?? []
  const extById = new Map(externalRows.map(r => [r.externalId, r]))

  let updatedCount = 0
  let skippedCount = 0
  const updatedItemIds: string[] = []

  for (const d of decisions ?? []) {
    const extRow = extById.get(d.external_row_id)
    if (!extRow?.status) { skippedCount++; continue }

    const toStatus = EXTERNAL_TO_LIFECYCLE[extRow.status]
    if (!toStatus) { skippedCount++; continue }

    const generatedItemId = d.generated_item_id
    if (!generatedItemId) { skippedCount++; continue }

    // Load current item payload
    const { data: item, error: fetchErr } = await svc
      .from('submittal_register_items')
      .select('id, item_payload')
      .eq('id', generatedItemId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (fetchErr || !item) { skippedCount++; continue }

    const payload = item.item_payload as Record<string, unknown>
    const fromStatus = (payload.lifecycleStatus as SubmittalLifecycleStatus | undefined) ?? 'draft'

    const result = buildTransition(fromStatus, toStatus, membership.role ?? undefined, 'Updated via reconciliation')
    if (!result.ok) { skippedCount++; continue }

    const history: LifecycleHistoryEntry[] = Array.isArray(payload.lifecycleStatusHistory)
      ? (payload.lifecycleStatusHistory as LifecycleHistoryEntry[])
      : []

    const updatedPayload: Record<string, unknown> = {
      ...payload,
      lifecycleStatus: toStatus,
      lifecycleStatusHistory: [...history, result.entry],
    }
    const tsField = timestampFieldForStatus(toStatus)
    if (tsField) updatedPayload[tsField] = result.entry.changedAt

    const { error: updateErr } = await svc
      .from('submittal_register_items')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ item_payload: updatedPayload as any })
      .eq('id', generatedItemId)
      .eq('project_id', projectId)

    if (updateErr) { skippedCount++; continue }

    updatedCount++
    updatedItemIds.push(generatedItemId)
  }

  // Mark session complete
  await svc
    .from('reconciliation_sessions')
    .update({ status: 'complete', updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  return NextResponse.json({ ok: true, updatedCount, skippedCount, updatedItemIds })
}
