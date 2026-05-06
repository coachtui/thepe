import { createServiceRoleClient } from '../db/supabase/service'
import {
  buildOutputSummary,
  buildSubmittalRegisterItemRows,
  buildSubmittalRegisterPersistedPayload,
  type SubmittalRegisterResult,
} from './submittal-register'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceRoleClient = any

export interface SubmittalRegisterRunInputs {
  sectionFilter: string | null
  keyword: string | null
  limit: number
  taskType?: string
}

export interface PersistSubmittalRegisterRunOptions {
  projectId: string
  result: SubmittalRegisterResult
  inputs: SubmittalRegisterRunInputs
  triggeredByUserId?: string | null
  triggeredByRole?: string | null
  startedAt?: Date
}

export interface PersistSubmittalRegisterRunOutcome {
  workflowRunId: string | null
  status: 'completed' | 'failed' | 'skipped'
  itemsWritten: number
  warning?: string
}

export async function persistSubmittalRegisterRun(
  opts: PersistSubmittalRegisterRunOptions
): Promise<PersistSubmittalRegisterRunOutcome> {
  const startedAt = opts.startedAt ?? new Date()
  const startedAtMs = startedAt.getTime()

  let supabase: ServiceRoleClient
  try {
    supabase = createServiceRoleClient() as ServiceRoleClient
  } catch (err) {
    const warning = `[SubmittalRegisterPersistence] Skipping persistence — service-role client unavailable: ${
      err instanceof Error ? err.message : String(err)
    }`
    console.warn(warning)
    return { workflowRunId: null, status: 'skipped', itemsWritten: 0, warning }
  }

  const summary = buildOutputSummary(opts.result)
  const baseRow = {
    project_id: opts.projectId,
    workflow_type: 'submittal_register',
    inputs: {
      sectionFilter: opts.inputs.sectionFilter,
      keyword: opts.inputs.keyword,
      limit: opts.inputs.limit,
      taskType: opts.inputs.taskType ?? 'submittal_register',
    },
    source_type: 'chat_tool',
    triggered_by_user_id: opts.triggeredByUserId ?? null,
    triggered_by_role: opts.triggeredByRole ?? null,
    started_at: startedAt.toISOString(),
  }

  let workflowRunId: string | null = null

  try {
    const insertRun = await supabase
      .from('workflow_runs')
      .insert({ ...baseRow, status: 'running' })
      .select('id')
      .single()

    if (insertRun.error || !insertRun.data?.id) {
      const warning = `[SubmittalRegisterPersistence] workflow_runs insert failed: ${
        insertRun.error?.message ?? 'no row returned'
      }`
      console.warn(warning)
      return { workflowRunId: null, status: 'skipped', itemsWritten: 0, warning }
    }

    workflowRunId = insertRun.data.id as string

    const itemRows = buildSubmittalRegisterItemRows(workflowRunId, opts.projectId, opts.result.items)
    let itemsWritten = 0

    if (itemRows.length > 0) {
      const insertItems = await supabase.from('submittal_register_items').insert(itemRows)
      if (insertItems.error) {
        throw new Error(`submittal_register_items insert failed: ${insertItems.error.message}`)
      }
      itemsWritten = itemRows.length
    }

    const completedAt = new Date()
    const updateRun = await supabase
      .from('workflow_runs')
      .update({
        status: 'completed',
        output_payload: buildSubmittalRegisterPersistedPayload(opts.result, summary),
        output_summary: summary,
        completed_at: completedAt.toISOString(),
        duration_ms: completedAt.getTime() - startedAtMs,
      })
      .eq('id', workflowRunId)

    if (updateRun.error) {
      throw new Error(`workflow_runs completion update failed: ${updateRun.error.message}`)
    }

    return { workflowRunId, status: 'completed', itemsWritten }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(
      `[SubmittalRegisterPersistence] Persistence failed for workflow_run=${workflowRunId ?? 'unallocated'}: ${message}`
    )
    if (workflowRunId) {
      try {
        const failedAt = new Date()
        await supabase
          .from('workflow_runs')
          .update({
            status: 'failed',
            error: message,
            completed_at: failedAt.toISOString(),
            duration_ms: failedAt.getTime() - startedAtMs,
          })
          .eq('id', workflowRunId)
      } catch (markErr) {
        console.warn(
          `[SubmittalRegisterPersistence] Failed to mark workflow_run=${workflowRunId} as failed: ${
            markErr instanceof Error ? markErr.message : String(markErr)
          }`
        )
      }
    }
    return { workflowRunId, status: 'failed', itemsWritten: 0, warning: message }
  }
}
