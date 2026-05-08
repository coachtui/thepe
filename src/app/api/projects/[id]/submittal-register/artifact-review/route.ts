/**
 * POST /api/projects/[id]/submittal-register/artifact-review
 *
 * Resolves an artifact_suspected submittal_register_items row via human review.
 *
 * Actions:
 *   accept — apply the artifact_suggested_name stored in item_payload as the new submittal_item
 *   edit   — apply a caller-supplied clean_name as the new submittal_item
 *   ignore — mark as ignored; submittal_item is not changed
 *
 * Auth: any project member.
 * Write path: service-role.
 *
 * Body:
 *   {
 *     item_id:    string,                           // required
 *     action:     'accept' | 'edit' | 'ignore',     // required
 *     clean_name?: string                            // required for 'edit'; used for 'accept' if provided
 *   }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'

const ALLOWED_ACTIONS = ['accept', 'edit', 'ignore'] as const
type ArtifactReviewAction = (typeof ALLOWED_ACTIONS)[number]

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
  if (typeof itemId !== 'string' || itemId.length === 0) {
    return NextResponse.json({ error: 'item_id is required' }, { status: 400 })
  }

  const action = body.action as ArtifactReviewAction
  if (!ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${ALLOWED_ACTIONS.join(', ')}` },
      { status: 400 }
    )
  }

  const cleanName =
    typeof body.clean_name === 'string' ? body.clean_name.trim() : null

  if (action === 'edit' && !cleanName) {
    return NextResponse.json(
      { error: 'clean_name is required for action "edit"' },
      { status: 400 }
    )
  }

  let svc: ReturnType<typeof createServiceRoleClient>
  try {
    svc = createServiceRoleClient()
  } catch (err) {
    console.error('[ArtifactReview] Service-role client unavailable:', err)
    return NextResponse.json(
      { error: 'Service-role client unavailable' },
      { status: 500 }
    )
  }

  // Verify item belongs to this project and fetch current payload
  const { data: current, error: fetchErr } = await svc
    .from('submittal_register_items')
    .select('id, submittal_item, item_payload')
    .eq('id', itemId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json(
      { error: 'Fetch failed: ' + fetchErr.message },
      { status: 500 }
    )
  }
  if (!current) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  const payload = current.item_payload as Record<string, unknown>

  let newSubmittalItem: string | null = null
  let newArtifactStatus: 'resolved' | 'ignored'

  if (action === 'accept') {
    const suggested =
      cleanName ?? (payload.artifactSuggestedName as string | null) ?? null
    if (!suggested) {
      return NextResponse.json(
        { error: 'No suggested name available for accept — use edit to provide a name' },
        { status: 400 }
      )
    }
    newSubmittalItem = suggested
    newArtifactStatus = 'resolved'
  } else if (action === 'edit') {
    newSubmittalItem = cleanName!
    newArtifactStatus = 'resolved'
  } else {
    // ignore
    newArtifactStatus = 'ignored'
  }

  const updatedPayload: Record<string, unknown> = {
    ...payload,
    artifactReviewStatus: newArtifactStatus,
    ...(newSubmittalItem !== null ? { submittalItem: newSubmittalItem } : {}),
  }

  const updateData: Record<string, unknown> = { item_payload: updatedPayload }
  if (newSubmittalItem !== null) {
    updateData.submittal_item = newSubmittalItem
  }

  const { error: updateErr } = await svc
    .from('submittal_register_items')
    .update(updateData)
    .eq('id', itemId)
    .eq('project_id', projectId)

  if (updateErr) {
    return NextResponse.json(
      { error: 'Update failed: ' + updateErr.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    itemId,
    action,
    newSubmittalItem: newSubmittalItem ?? current.submittal_item,
    artifactReviewStatus: newArtifactStatus,
  })
}
