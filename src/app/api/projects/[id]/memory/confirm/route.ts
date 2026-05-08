/**
 * POST /api/projects/[id]/memory/confirm
 *
 * Confirm or dispute a project_memory_items row.
 *
 * Auth: any project member.
 * UNIQUE(memory_item_id, user_id) prevents double-voting.
 *
 * Side effects:
 *   - Increments confirmed_by_count or rejected_by_count on the memory item
 *   - If rejected_by_count > confirmed_by_count: sets validation_status = 'disputed'
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id

  // ── Auth ─────────────────────────────────────────────────────────────────
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

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { memory_item_id, vote, note } = body as {
    memory_item_id?: string
    vote?: string
    note?: string
  }

  if (!memory_item_id || !vote) {
    return NextResponse.json(
      { error: 'memory_item_id and vote are required' },
      { status: 400 }
    )
  }

  if (vote !== 'confirm' && vote !== 'dispute') {
    return NextResponse.json(
      { error: 'vote must be "confirm" or "dispute"' },
      { status: 400 }
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceRoleClient() as any

  // Verify the memory item belongs to this project
  const { data: memItem } = await svc
    .from('project_memory_items')
    .select('id, confirmed_by_count, rejected_by_count, validation_status')
    .eq('id', memory_item_id)
    .eq('project_id', projectId)
    .single()

  if (!memItem) {
    return NextResponse.json(
      { error: 'Memory item not found in this project' },
      { status: 404 }
    )
  }

  // ── Write confirmation (UNIQUE constraint prevents double-vote) ──────────
  const { error: voteErr } = await svc
    .from('memory_confirmations')
    .insert({
      memory_item_id,
      user_id: user.id,
      user_role: membership.role,
      vote,
      note: note ?? null,
    })

  if (voteErr) {
    if (voteErr.code === '23505') {
      // Unique violation — user already voted
      return NextResponse.json(
        { error: 'You have already voted on this memory item' },
        { status: 409 }
      )
    }
    console.error('[MemoryConfirm] Vote insert error:', voteErr)
    return NextResponse.json({ error: 'Failed to record vote' }, { status: 500 })
  }

  // ── Update counts on parent item ─────────────────────────────────────────
  const newConfirmed =
    vote === 'confirm'
      ? (memItem.confirmed_by_count ?? 0) + 1
      : (memItem.confirmed_by_count ?? 0)

  const newRejected =
    vote === 'dispute'
      ? (memItem.rejected_by_count ?? 0) + 1
      : (memItem.rejected_by_count ?? 0)

  // Determine updated validation_status
  let newStatus = memItem.validation_status
  if (newRejected > newConfirmed) {
    newStatus = 'disputed'
  } else if (
    memItem.validation_status === 'disputed' &&
    newConfirmed >= newRejected
  ) {
    // Votes swung back to confirmed majority — restore 'accepted'
    newStatus = 'accepted'
  }

  const { error: updateErr } = await svc
    .from('project_memory_items')
    .update({
      confirmed_by_count: newConfirmed,
      rejected_by_count: newRejected,
      validation_status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', memory_item_id)

  if (updateErr) {
    console.error('[MemoryConfirm] Count update error:', updateErr)
    // Non-fatal — vote was recorded even if count update failed
  }

  return NextResponse.json({
    success: true,
    vote,
    confirmedByCount: newConfirmed,
    rejectedByCount: newRejected,
    validationStatus: newStatus,
  })
}
