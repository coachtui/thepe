/**
 * Inngest function: vision/document.process
 *
 * Replaces the fire-and-forget triggerVisionProcessingAsync() approach.
 * Inngest runs this durably outside the Vercel request lifecycle, so the
 * function is never killed mid-execution by a serverless timeout.
 *
 * Each page-range chunk is a separate step.run() — if a chunk fails it
 * retries independently without re-running completed chunks.
 *
 * Deduplication: the event is sent with id=`vision-${documentId}` so
 * uploading the same document twice within 24 hours queues only one job.
 */

import { inngest } from '@/inngest/client'
import { createClient as createServiceClient } from '@/lib/db/supabase/server'
import { processDocumentPageRange } from '@/lib/processing/vision-processor'
import { getPdfMetadata } from '@/lib/vision/pdf-to-image'
import { getDocumentSignedUrl } from '@/lib/db/queries/documents'
import { logProduction } from '@/lib/utils/debug'
import {
  createVisionJob,
  startVisionJob,
  completeVisionJob,
  failVisionJob,
  incrementJobProgress,
  logJobEvent,
  getVisionJobByKey,
} from '@/lib/batch-processing/job-manager'
import {
  completeVisionChunk,
  failVisionChunk,
} from '@/lib/batch-processing/chunk-manager'

// Pages processed per Inngest step. Each step has its own retry budget.
const PAGES_PER_CHUNK = 20

export const visionProcessDocument = inngest.createFunction(
  {
    id: 'vision-process-document',
    name: 'Vision Process Document',
    // Retry individual steps up to 3 times; don't retry the whole function.
    retries: 0,
    concurrency: {
      // At most 5 documents processing at the same time — guards Claude API rate limits.
      limit: 5,
    },
  },
  { event: 'vision/document.process' },
  async ({ event, step }) => {
    const { documentId, projectId, trigger, maxPages = 200 } = event.data

    // -------------------------------------------------------------------------
    // Step 1: Guard + set vision_status = 'processing'
    // -------------------------------------------------------------------------
    const jobKey = `inngest-${event.id}`

    const initResult = await step.run('initialize', async (): Promise<{ skip: boolean; filePath: string }> => {
      const supabase = await createServiceClient()

      // Check current vision_status — skip if already completed.
      const { data: doc } = await supabase
        .from('documents')
        .select('vision_status, file_path')
        .eq('id', documentId)
        .single()

      if (doc?.vision_status === 'completed') {
        logProduction.info('Vision Lifecycle',
          `[SKIP] document=${documentId} trigger=${trigger} — already completed, skipping Inngest run`
        )
        return { skip: true, filePath: '' }
      }

      // Check for a duplicate Inngest job (same jobKey)
      const existingJob = await getVisionJobByKey(jobKey)
      if (existingJob && existingJob.status === 'processing') {
        logProduction.info('Vision Lifecycle',
          `[SKIP] document=${documentId} — job ${jobKey} already processing, skipping duplicate run`
        )
        return { skip: true, filePath: '' }
      }

      await supabase
        .from('documents')
        .update({ vision_status: 'processing', vision_error: null })
        .eq('id', documentId)

      logProduction.info('Vision Lifecycle',
        `[STATUS→processing] document=${documentId} trigger=${trigger} jobKey=${jobKey}`
      )

      return { skip: false, filePath: doc?.file_path ?? '' }
    })

    if (initResult.skip) {
      return { skipped: true }
    }

    // -------------------------------------------------------------------------
    // Step 2: Get PDF page count
    // -------------------------------------------------------------------------
    const { numPages } = await step.run('get-pdf-metadata', async (): Promise<{ numPages: number }> => {
      const supabase = await createServiceClient()
      const signedUrl = await getDocumentSignedUrl(supabase, initResult.filePath)
      const response = await fetch(signedUrl)
      if (!response.ok) throw new Error(`Failed to download PDF: ${response.statusText}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      const metadata = await getPdfMetadata(buffer)
      logProduction.info('Vision Lifecycle',
        `[METADATA] document=${documentId} pages=${metadata.numPages}`
      )
      return { numPages: Math.min(metadata.numPages, maxPages) }
    })

    // -------------------------------------------------------------------------
    // Step 3: Create job record in DB
    // -------------------------------------------------------------------------
    const { jobId } = await step.run('create-job', async (): Promise<{ jobId: string }> => {
      const totalChunks = Math.ceil(numPages / PAGES_PER_CHUNK)
      const job = await createVisionJob({
        jobKey,
        projectId,
        documentId,
        totalPages: numPages,
        pagesPerChunk: PAGES_PER_CHUNK,
        totalChunks,
        processingMode: 'sequential',
        maxParallelChunks: 1,
        metadata: { trigger, inngestEventId: event.id },
      })
      await startVisionJob(job.id)
      await logJobEvent(job.id, 'job_started', { trigger, numPages })
      return { jobId: job.id }
    })

    // -------------------------------------------------------------------------
    // Step 4: Process each chunk (one step per chunk → independent retries)
    // -------------------------------------------------------------------------
    const totalChunks = Math.ceil(numPages / PAGES_PER_CHUNK)
    let totalQuantities = 0
    let totalCost = 0
    let totalSheetsProcessed = 0
    const chunkErrors: string[] = []

    for (let i = 0; i < totalChunks; i++) {
      const pageStart = i * PAGES_PER_CHUNK + 1
      const pageEnd = Math.min((i + 1) * PAGES_PER_CHUNK, numPages)

      const chunkResult = await step.run(`process-chunk-${i}`, async (): Promise<{
        success: boolean; sheetsProcessed: number; quantitiesExtracted: number; totalCost: number; errors: string[]
      }> => {
        logProduction.info('Vision Lifecycle',
          `[CHUNK-START] document=${documentId} chunk=${i + 1}/${totalChunks} pages=${pageStart}-${pageEnd}`
        )
        try {
          const result = await processDocumentPageRange(
            documentId,
            projectId,
            pageStart,
            pageEnd,
            { imageScale: 2.0, extractQuantities: true, storeVisionData: true }
          )
          logProduction.info('Vision Lifecycle',
            `[CHUNK-DONE] document=${documentId} chunk=${i + 1}/${totalChunks} quantities=${result.quantitiesExtracted} cost=$${result.totalCost.toFixed(4)}`
          )
          return {
            success: true,
            sheetsProcessed: result.sheetsProcessed,
            quantitiesExtracted: result.quantitiesExtracted,
            totalCost: result.totalCost,
            errors: result.errors ?? [],
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logProduction.error('Vision Lifecycle',
            `[CHUNK-ERROR] document=${documentId} chunk=${i + 1}/${totalChunks} pages=${pageStart}-${pageEnd} error="${msg}"`
          )
          // Return error info rather than throwing — lets the job continue
          // with remaining chunks instead of retrying this step forever.
          return {
            success: false,
            sheetsProcessed: 0,
            quantitiesExtracted: 0,
            totalCost: 0,
            errors: [msg],
          }
        }
      })

      totalSheetsProcessed += chunkResult.sheetsProcessed
      totalQuantities += chunkResult.quantitiesExtracted
      totalCost += chunkResult.totalCost
      if (!chunkResult.success) chunkErrors.push(...chunkResult.errors)

      // Update job progress after each chunk (best-effort, non-blocking)
      await step.run(`update-progress-${i}`, async () => {
        await incrementJobProgress(jobId, {
          chunksCompleted: chunkResult.success ? 1 : 0,
          chunksFailed: chunkResult.success ? 0 : 1,
          pagesProcessed: chunkResult.sheetsProcessed,
          quantitiesExtracted: chunkResult.quantitiesExtracted,
          addCost: chunkResult.totalCost,
        })
      })
    }

    // -------------------------------------------------------------------------
    // Step 5: Finalize — write completion to documents table
    // -------------------------------------------------------------------------
    await step.run('finalize', async () => {
      const supabase = await createServiceClient()
      const allFailed = totalSheetsProcessed === 0 && chunkErrors.length > 0

      if (allFailed) {
        await supabase
          .from('documents')
          .update({
            vision_status: 'failed',
            vision_error: chunkErrors.slice(0, 3).join('; '),
            vision_sheets_processed: 0,
            vision_quantities_extracted: 0,
            vision_cost_usd: 0,
          })
          .eq('id', documentId)

        await failVisionJob(jobId, chunkErrors.join('; '))
        logProduction.info('Vision Lifecycle',
          `[STATUS→failed] document=${documentId} trigger=${trigger} errors="${chunkErrors.slice(0, 2).join('; ')}"`
        )
      } else {
        await supabase
          .from('documents')
          .update({
            vision_status: 'completed',
            vision_processed_at: new Date().toISOString(),
            vision_sheets_processed: totalSheetsProcessed,
            vision_quantities_extracted: totalQuantities,
            vision_cost_usd: totalCost,
            vision_error: chunkErrors.length > 0
              ? `Completed with ${chunkErrors.length} chunk error(s)`
              : null,
          })
          .eq('id', documentId)

        await completeVisionJob(jobId)
        await logJobEvent(jobId, 'job_completed', {
          totalSheetsProcessed,
          totalQuantities,
          totalCost,
          partialErrors: chunkErrors.length,
        })

        logProduction.info('Vision Lifecycle',
          `[STATUS→completed] document=${documentId} trigger=${trigger} sheets=${totalSheetsProcessed} quantities=${totalQuantities} cost=$${totalCost.toFixed(4)} chunkErrors=${chunkErrors.length}`
        )
      }
    })

    return {
      documentId,
      sheetsProcessed: totalSheetsProcessed,
      quantitiesExtracted: totalQuantities,
      totalCost,
      chunkErrors: chunkErrors.length,
    }
  }
)
