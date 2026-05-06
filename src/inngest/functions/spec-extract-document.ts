/**
 * Inngest function: spec/document.extract
 *
 * Manual-trigger spec extraction for a single document. Reads the document
 * + its chunks, runs `runSpecExtractionPipeline` with the Haiku-backed LLM
 * caller, then writes results to the entity graph via
 * `persistSpecExtractionResult`.
 *
 * Idempotency / retry semantics (from the task spec):
 *   - The persistence helper does delete-then-reinsert keyed on
 *     (project_id, discipline='spec', source_document_id). The schema's
 *     `ON DELETE CASCADE` foreign keys clean up entity_findings and
 *     entity_citations automatically.
 *   - Therefore retries — whether at the step level (Inngest re-runs only
 *     the failed step using memoized step results) or at the function
 *     level — are ALWAYS safe. A retry deletes any partial state from the
 *     previous attempt and re-inserts.
 *   - Mid-flow failures inside the persist step (e.g., the citation insert
 *     succeeds but the finding insert fails) leave a partial state on
 *     disk. The next persist call notices nothing — it deletes everything
 *     and re-inserts, self-healing. The Inngest function's retry keeps
 *     this loop closed.
 *
 * Defense-in-depth: even though the manual endpoint validates the document
 * before sending the event, the function re-checks `document_type === 'spec'`
 * and `processing_status === 'completed'` before doing any LLM work.
 *
 * No auto-trigger: nothing in the upload pipeline sends this event today.
 * Only the manual endpoint at
 * `POST /api/projects/[id]/documents/[documentId]/extract-specs` does.
 */

import { inngest } from '@/inngest/client'
import { createServiceRoleClient } from '@/lib/db/supabase/service'
import {
  runSpecExtractionPipeline,
  type SpecExtractionPipelineResult,
} from '@/lib/chat/spec-extraction-pipeline.ts'
import { persistSpecExtractionResult } from '@/lib/chat/spec-extraction-persistence.ts'
import { createAnthropicSpecLlmCaller } from '@/lib/chat/spec-extraction-llm.ts'
import { logProduction } from '@/lib/utils/debug'

interface DocumentRow {
  id: string
  project_id: string | null
  document_type: string | null
  processing_status: string | null
  filename: string
  // `documents` may or may not have a `title` column depending on schema
  // history; treat as optional.
  title?: string | null
}

interface ChunkRow {
  id: string
  chunk_index: number
  content: string
  page_number: number | null
  metadata: Record<string, unknown> | null
}

interface SkipResult {
  kind: 'skip'
  reason: string
  documentId: string
  projectId: string
}

interface ExtractedResult {
  kind: 'extracted'
  result: SpecExtractionPipelineResult
}

export const specExtractDocument = inngest.createFunction(
  {
    id: 'spec-extract-document',
    name: 'Spec Extract Document',
    retries: 3,
    concurrency: {
      // Conservative limit. Haiku has higher rate limits than vision, but
      // capping at 5 concurrent extractions matches the existing vision
      // function and gives consistent operational behavior.
      limit: 5,
    },
    onFailure: async ({ event, error }) => {
      // Runs when every retry has been exhausted.
      const documentId = event.data?.event?.data?.documentId
      const projectId = event.data?.event?.data?.projectId
      const msg = error instanceof Error ? error.message : String(error)
      logProduction.error(
        'Spec Extraction',
        `[FAILED-FINAL] document=${documentId} project=${projectId} error="${msg}"`
      )
    },
  },
  { event: 'spec/document.extract' },
  async ({ event, step }) => {
    const { documentId, projectId, trigger } = event.data
    logProduction.info(
      'Spec Extraction',
      `[START] document=${documentId} project=${projectId} trigger=${trigger}`
    )

    // -----------------------------------------------------------------------
    // Step 1: Load document + verify type / status
    // -----------------------------------------------------------------------
    const docCheck = await step.run('load-document', async (): Promise<DocumentRow | SkipResult> => {
      const supabase = createServiceRoleClient()
      const { data, error } = await supabase
        .from('documents')
        .select('id, project_id, document_type, processing_status, filename, title')
        .eq('id', documentId)
        .maybeSingle()

      if (error) {
        // Throwing here lets Inngest retry on transient DB errors.
        throw new Error(`load-document query failed: ${error.message}`)
      }
      if (!data) {
        return {
          kind: 'skip',
          reason: 'document_not_found',
          documentId,
          projectId,
        }
      }
      const doc = data as unknown as DocumentRow
      if (doc.project_id !== projectId) {
        return {
          kind: 'skip',
          reason: `project_mismatch: doc.project_id=${doc.project_id ?? 'null'} but event projectId=${projectId}`,
          documentId,
          projectId,
        }
      }
      if (doc.document_type !== 'spec') {
        return {
          kind: 'skip',
          reason: `document_type=${doc.document_type ?? 'null'} (expected 'spec')`,
          documentId,
          projectId,
        }
      }
      if (doc.processing_status !== 'completed') {
        return {
          kind: 'skip',
          reason: `processing_status=${doc.processing_status ?? 'null'} (expected 'completed')`,
          documentId,
          projectId,
        }
      }
      return doc
    })

    if ('kind' in docCheck && docCheck.kind === 'skip') {
      logProduction.info(
        'Spec Extraction',
        `[SKIP] document=${documentId} reason=${docCheck.reason}`
      )
      return {
        status: 'skipped',
        documentId,
        projectId,
        reason: docCheck.reason,
      }
    }

    const doc = docCheck as DocumentRow

    // -----------------------------------------------------------------------
    // Step 2: Load chunks + run pipeline. Combined in one step so the
    // potentially-large chunks array doesn't have to round-trip through
    // Inngest's step memoization. Only the (smaller) pipeline result is
    // memoized — and on retry, the LLM cost is paid again only if this step
    // failed; the persist step re-runs against the memoized result alone.
    // -----------------------------------------------------------------------
    const extractOutcome = await step.run(
      'extract',
      async (): Promise<ExtractedResult | SkipResult> => {
        const supabase = createServiceRoleClient()
        const { data: chunks, error } = await supabase
          .from('document_chunks')
          .select('id, chunk_index, content, page_number, metadata')
          .eq('document_id', documentId)
          .order('chunk_index', { ascending: true })

        if (error) throw new Error(`load-chunks query failed: ${error.message}`)
        const chunkRows = (chunks ?? []) as unknown as ChunkRow[]

        if (chunkRows.length === 0) {
          return {
            kind: 'skip',
            reason: 'no_chunks_for_document',
            documentId,
            projectId,
          }
        }

        const llmCaller = createAnthropicSpecLlmCaller()

        const result = await runSpecExtractionPipeline({
          projectId,
          documentId,
          documentMeta: {
            title: doc.title ?? null,
            filename: doc.filename,
          },
          chunks: chunkRows,
          llmCaller,
        })

        return { kind: 'extracted', result }
      }
    )

    if ('kind' in extractOutcome && extractOutcome.kind === 'skip') {
      logProduction.info(
        'Spec Extraction',
        `[SKIP] document=${documentId} reason=${extractOutcome.reason}`
      )
      return {
        status: 'skipped',
        documentId,
        projectId,
        reason: extractOutcome.reason,
      }
    }

    const pipelineResult = (extractOutcome as ExtractedResult).result

    // -----------------------------------------------------------------------
    // Step 3: Persist. Idempotent — delete existing then re-insert. Safe to
    // retry independently from the extract step because the persist helper
    // is its own delete-then-reinsert boundary.
    // -----------------------------------------------------------------------
    const persistOutcome = await step.run('persist', async () => {
      return persistSpecExtractionResult({
        projectId,
        documentId,
        result: pipelineResult,
      })
    })

    logProduction.info(
      'Spec Extraction',
      `[DONE] document=${documentId} status=${persistOutcome.status} sections=${persistOutcome.sectionsWritten} requirements=${persistOutcome.requirementsWritten} costUsd=${pipelineResult.totalCostUsd}`
    )

    return {
      status: persistOutcome.status,
      documentId,
      projectId,
      pipeline: {
        documentClassification: pipelineResult.documentClassification,
        totalSections: pipelineResult.totalSections,
        sectionsAttempted: pipelineResult.sectionsAttempted,
        sectionsSucceeded: pipelineResult.sectionsSucceeded,
        totalCostUsd: pipelineResult.totalCostUsd,
        warnings: pipelineResult.warnings,
      },
      persist: {
        sectionsWritten: persistOutcome.sectionsWritten,
        requirementsWritten: persistOutcome.requirementsWritten,
        citationsWritten: persistOutcome.citationsWritten,
        findingsWritten: persistOutcome.findingsWritten,
        sectionsSkippedByBuilder: persistOutcome.sectionsSkippedByBuilder,
        failedAt: persistOutcome.failedAt,
        warning: persistOutcome.warning,
      },
    }
  }
)
