import { createServiceRoleClient } from '../db/supabase/service'
import {
  reconstructLatestSubmittalRegisterRun,
  type LatestSubmittalRegisterRun,
} from './submittal-register'

export type LoadLatestSubmittalRegisterRunOutcome =
  | { status: 'found'; run: LatestSubmittalRegisterRun }
  | { status: 'not_found' }
  | { status: 'error'; error: string }

type SubmittalRegisterItemRow = {
  id: string
  item_payload: unknown
  review_status: string | null
  review_notes: string | null
  reviewed_at: string | null
  reviewed_by_role: string | null
}

const PAGE_SIZE = 1000

// Fetches all rows for a workflow run across multiple pages, bypassing the
// default PostgREST 1,000-row cap. Preserves created_at ASC order.
async function fetchAllSubmittalRegisterItems(
  supabase: ReturnType<typeof createServiceRoleClient>,
  projectId: string,
  workflowRunId: string
): Promise<{ data: SubmittalRegisterItemRow[]; error: string | null }> {
  const allRows: SubmittalRegisterItemRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('submittal_register_items')
      .select(
        'id, item_payload, review_status, review_notes, reviewed_at, reviewed_by_role'
      )
      .eq('project_id', projectId)
      .eq('workflow_run_id', workflowRunId)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) return { data: [], error: error.message }

    allRows.push(...(data as SubmittalRegisterItemRow[]))

    if (!data || data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[SubmittalRegisterRead] fetchAllSubmittalRegisterItems: ${allRows.length} rows loaded in ${Math.ceil(allRows.length / PAGE_SIZE)} page(s)`
    )
  }

  return { data: allRows, error: null }
}

export async function loadLatestSubmittalRegisterRun(
  supabase: ReturnType<typeof createServiceRoleClient>,
  projectId: string
): Promise<LoadLatestSubmittalRegisterRunOutcome> {
  const runResult = await supabase
    .from('workflow_runs')
    .select(
      'id, project_id, workflow_type, status, source_type, started_at, completed_at, duration_ms, triggered_by_user_id, triggered_by_role, inputs, error'
    )
    .eq('project_id', projectId)
    .eq('workflow_type', 'submittal_register')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (runResult.error) {
    return { status: 'error', error: runResult.error.message }
  }
  if (!runResult.data) {
    return { status: 'not_found' }
  }

  const itemsResult = await fetchAllSubmittalRegisterItems(
    supabase,
    projectId,
    runResult.data.id
  )

  if (itemsResult.error) {
    return { status: 'error', error: itemsResult.error }
  }

  const run = reconstructLatestSubmittalRegisterRun(runResult.data, itemsResult.data)

  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[SubmittalRegisterRead] run=${runResult.data.id}` +
        ` rawRows=${itemsResult.data.length}` +
        ` items=${run.items.length}` +
        ` sections=${run.groupedSections.length}` +
        ` ungrouped=${run.ungrouped?.length ?? 0}` +
        ` totalItemCount=${run.summary.totalItemCount}`
    )
  }

  return { status: 'found', run }
}
