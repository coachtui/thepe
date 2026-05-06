/**
 * POST /api/projects/[id]/submittal-register/review
 *
 * Update the review state of a persisted `submittal_register_items` row.
 *
 * Auth: any project member.
 * Write path: service-role (matches the persistence + corrections + memory/confirm pattern).
 *
 * Body:
 *   {
 *     item_id: string,                      // required
 *     review_status: SubmittalRegisterReviewStatus,  // required
 *     review_notes?: string | null          // optional; empty/whitespace → cleared
 *   }
 *
 * The route enforces:
 *   1. authenticated user
 *   2. user is a member of the project (any role)
 *   3. item_id belongs to this project
 *   4. review_status is one of ALLOWED_REVIEW_STATUSES
 *
 * `reviewed_by_user_id` is taken from the authenticated user.
 * `reviewed_by_role` is taken from `project_members.role` for that user.
 * `reviewed_at` is set to "now" by the validator.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'
import {
  ALLOWED_REVIEW_STATUSES,
  validateSubmittalRegisterReviewUpdate,
} from '@/lib/chat/submittal-register'
import { updateSubmittalRegisterItemReview } from '@/lib/chat/submittal-register-review'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id

  // ── Auth ─────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
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
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const itemId = body.item_id
  if (typeof itemId !== 'string' || itemId.length === 0) {
    return NextResponse.json(
      { error: 'item_id is required (string)' },
      { status: 400 }
    )
  }

  const validation = validateSubmittalRegisterReviewUpdate({
    reviewStatus: body.review_status,
    reviewNotes: body.review_notes,
    reviewedByUserId: user.id,
    reviewedByRole: membership.role ?? null,
  })

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  // ── Service-role update ───────────────────────────────────────────────────
  let svc: ReturnType<typeof createServiceRoleClient>
  try {
    svc = createServiceRoleClient()
  } catch (err) {
    console.error('[SubmittalRegisterReview] Service-role client unavailable:', err)
    return NextResponse.json(
      { error: 'Service-role client unavailable' },
      { status: 500 }
    )
  }

  const outcome = await updateSubmittalRegisterItemReview(svc, {
    projectId,
    itemId,
    update: validation.update,
  })

  if (outcome.status === 'not_found') {
    return NextResponse.json(
      { error: 'Submittal register item not found in this project' },
      { status: 404 }
    )
  }

  if (outcome.status === 'error') {
    console.error('[SubmittalRegisterReview] Update error:', outcome.error)
    return NextResponse.json(
      { error: 'Failed to update submittal register item review' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    item: outcome.item,
    allowedReviewStatuses: ALLOWED_REVIEW_STATUSES,
  })
}
