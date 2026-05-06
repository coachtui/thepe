import { createServiceRoleClient } from '../db/supabase/service'
import type { Database } from '../db/supabase/types'
import type { SubmittalRegisterReviewUpdate } from './submittal-register'

type SubmittalRegisterItemUpdate =
  Database['public']['Tables']['submittal_register_items']['Update']

export interface UpdateSubmittalRegisterItemReviewOptions {
  projectId: string
  itemId: string
  update: SubmittalRegisterReviewUpdate
}

export interface ReviewedSubmittalRegisterItem {
  id: string
  projectId: string
  workflowRunId: string
  reviewStatus: string
  reviewNotes: string | null
  reviewedByUserId: string | null
  reviewedByRole: string | null
  reviewedAt: string | null
  updatedAt: string
}

export type UpdateSubmittalRegisterItemReviewOutcome =
  | { status: 'updated'; item: ReviewedSubmittalRegisterItem }
  | { status: 'not_found' }
  | { status: 'error'; error: string }

export async function updateSubmittalRegisterItemReview(
  supabase: ReturnType<typeof createServiceRoleClient>,
  opts: UpdateSubmittalRegisterItemReviewOptions
): Promise<UpdateSubmittalRegisterItemReviewOutcome> {
  // Defense in depth: the composite FK guarantees project/run consistency,
  // but verify the item is actually in this project before issuing the update
  // so a wrong-project caller gets a 404, not a silent zero-row update.
  const existing = await supabase
    .from('submittal_register_items')
    .select('id')
    .eq('id', opts.itemId)
    .eq('project_id', opts.projectId)
    .maybeSingle()

  if (existing.error) {
    return { status: 'error', error: existing.error.message }
  }
  if (!existing.data) {
    return { status: 'not_found' }
  }

  const updatePayload: SubmittalRegisterItemUpdate = {
    review_status: opts.update.reviewStatus,
    review_notes: opts.update.reviewNotes,
    reviewed_by_user_id: opts.update.reviewedByUserId,
    reviewed_by_role: opts.update.reviewedByRole,
    reviewed_at: opts.update.reviewedAt,
  }

  const updated = await supabase
    .from('submittal_register_items')
    .update(updatePayload)
    .eq('id', opts.itemId)
    .eq('project_id', opts.projectId)
    .select(
      'id, project_id, workflow_run_id, review_status, review_notes, reviewed_by_user_id, reviewed_by_role, reviewed_at, updated_at'
    )
    .single()

  if (updated.error || !updated.data) {
    return {
      status: 'error',
      error: updated.error?.message ?? 'Update returned no row',
    }
  }

  return {
    status: 'updated',
    item: {
      id: updated.data.id,
      projectId: updated.data.project_id,
      workflowRunId: updated.data.workflow_run_id,
      reviewStatus: updated.data.review_status,
      reviewNotes: updated.data.review_notes,
      reviewedByUserId: updated.data.reviewed_by_user_id,
      reviewedByRole: updated.data.reviewed_by_role,
      reviewedAt: updated.data.reviewed_at,
      updatedAt: updated.data.updated_at,
    },
  }
}
