import { createServiceRoleClient } from '../db/supabase/service'
import {
  reconstructLatestSubmittalRegisterRun,
  type LatestSubmittalRegisterRun,
} from './submittal-register'

export type LoadLatestSubmittalRegisterRunOutcome =
  | { status: 'found'; run: LatestSubmittalRegisterRun }
  | { status: 'not_found' }
  | { status: 'error'; error: string }

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

  const itemsResult = await supabase
    .from('submittal_register_items')
    .select('item_payload')
    .eq('project_id', projectId)
    .eq('workflow_run_id', runResult.data.id)
    .order('created_at', { ascending: true })

  if (itemsResult.error) {
    return { status: 'error', error: itemsResult.error.message }
  }

  return {
    status: 'found',
    run: reconstructLatestSubmittalRegisterRun(
      runResult.data,
      itemsResult.data ?? []
    ),
  }
}
