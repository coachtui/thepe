import { inngest } from '@/inngest/client'
import { createServiceRoleClient } from '@/lib/db/supabase/service'

const STUCK_THRESHOLD_MINUTES = 15
const MAX_REQUEUE_PER_RUN = 20

export const visionStuckRecovery = inngest.createFunction(
  { id: 'vision-stuck-recovery' },
  { cron: '0 * * * *' },
  async ({ step }) => {
    const results = await step.run('find-and-requeue-stuck-documents', async () => {
      const supabase = createServiceRoleClient()

      const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString()

      const { data: stuckDocs, error } = await supabase
        .from('documents')
        .select('id, project_id, file_type, processing_status, updated_at')
        .eq('vision_status', 'processing')
        .lt('updated_at', cutoff)
        .eq('file_type', 'application/pdf')
        .eq('processing_status', 'completed')
        .limit(MAX_REQUEUE_PER_RUN)

      if (error) {
        console.error('[StuckRecovery] Failed to query stuck documents:', error.message)
        return { found: 0, requeued: 0, errors: [error.message] }
      }

      if (!stuckDocs || stuckDocs.length === 0) {
        console.log('[StuckRecovery] No stuck documents found')
        return { found: 0, requeued: 0, errors: [] }
      }

      console.log(`[StuckRecovery] Found ${stuckDocs.length} stuck document(s)`)

      const errors: string[] = []
      let requeued = 0

      for (const doc of stuckDocs) {
        try {
          const elapsedMin = ((Date.now() - new Date(doc.updated_at ?? new Date().toISOString()).getTime()) / 60000).toFixed(1)

          // Reset to pending so the new Inngest job can start.
          // The original job is dead (Vercel killed it), so there is no active job to race with.
          await supabase
            .from('documents')
            .update({
              vision_status: 'pending',
              vision_error: `Auto-reset from stuck processing state after ${elapsedMin} min`,
            })
            .eq('id', doc.id)

          try {
            await inngest.send({
              id: `vision-${doc.id}-recovery-${Date.now()}`,
              name: 'vision/document.process',
              data: {
                documentId: doc.id,
                projectId: doc.project_id,
                trigger: 'stuck-recovery',
                maxPages: 500,
              },
            })
          } catch (sendErr) {
            // If event send fails, revert to 'processing' so the next hourly run picks it up
            const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
            console.error(`[StuckRecovery] Event send failed for document=${doc.id}, reverting status: ${sendMsg}`)
            await supabase
              .from('documents')
              .update({ vision_status: 'processing' })
              .eq('id', doc.id)
            errors.push(`${doc.id}: event send failed — ${sendMsg}`)
            continue
          }

          console.log(`[StuckRecovery] Requeued document=${doc.id} (stuck ${elapsedMin} min)`)
          requeued++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[StuckRecovery] Failed to requeue document=${doc.id}: ${msg}`)
          errors.push(`${doc.id}: ${msg}`)
        }
      }

      return { found: stuckDocs.length, requeued, errors }
    })

    console.log(`[StuckRecovery] Run complete: found=${results.found} requeued=${results.requeued} errors=${results.errors.length}`)
    return results
  }
)
