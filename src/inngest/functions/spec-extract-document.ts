/**
 * Inngest function: spec/document.extract
 *
 * Manual-trigger spec extraction for a single document. Uses a three-phase
 * batched approach to avoid the stale-connection failure that occurs when all
 * ~80 LLM calls are packed into a single long-running step:
 *
 *   Step 1  load-document    — verify doc type + status
 *   Step 2  discover-sections — load all chunks, run CSI regex, return manifest
 *   Step 3  delete-existing   — one-time clean delete for this document
 *   Steps 4..N extract-batch-{i} — LLM extraction + immediate persistence per batch
 *
 * Idempotency / retry semantics:
 *   - delete-existing runs once per function invocation (memoised on retry).
 *   - Each extract-batch step starts with a scoped delete of its own sections
 *     so partial inserts from a failed previous attempt are cleaned up before
 *     re-insert. This makes every batch step fully idempotent.
 *   - A fresh function invocation (user re-triggers extraction) always runs
 *     delete-existing first, replacing all stale spec state for the document.
 *
 * Supabase client hygiene:
 *   - A new service-role client is created inside each step.run() call.
 *   - No client is held open across step boundaries.
 *
 * No auto-trigger: only the manual endpoint at
 * POST /api/projects/[id]/documents/[documentId]/extract-specs sends this event.
 */

import { inngest } from '@/inngest/client'
import { createServiceRoleClient } from '@/lib/db/supabase/service'
import {
  discoverSpecSections,
  extractSectionBatch,
  buildSpecPersistenceRows,
  type SectionManifestEntry,
  type DiscoverSpecSectionsResult,
} from '@/lib/chat/spec-extraction-pipeline.ts'
import { persistSpecExtractionResult } from '@/lib/chat/spec-extraction-persistence.ts'
import { createAnthropicSpecLlmCaller } from '@/lib/chat/spec-extraction-llm.ts'
import { logProduction } from '@/lib/utils/debug'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface DocumentRow {
  id: string
  project_id: string | null
  document_type: string | null
  processing_status: string | null
  filename: string
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

interface BatchOutcome {
  batchIndex: number
  sectionsAttempted: number
  sectionsSucceeded: number
  costUsd: number
  requirementsWritten: number
  citationsWritten: number
  findingsWritten: number
  sectionsSkippedByBuilder: number
  persistStatus: 'persisted' | 'skipped' | 'failed'
  failedAt?: string
  warning?: string
}

// Number of sections processed + persisted per Inngest step.
const BATCH_SIZE = 5

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable = any

export const specExtractDocument = inngest.createFunction(
  {
    id: 'spec-extract-document',
    name: 'Spec Extract Document',
    retries: 3,
    concurrency: {
      limit: 5,
    },
    onFailure: async ({ event, error }) => {
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
    const docCheck = await step.run(
      'load-document',
      async (): Promise<DocumentRow | SkipResult> => {
        const supabase = createServiceRoleClient()
        const { data, error } = await supabase
          .from('documents')
          .select('id, project_id, document_type, processing_status, filename')
          .eq('id', documentId)
          .maybeSingle()

        if (error) throw new Error(`load-document query failed: ${error.message}`)
        if (!data) {
          return { kind: 'skip', reason: 'document_not_found', documentId, projectId }
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
      }
    )

    if ('kind' in docCheck && docCheck.kind === 'skip') {
      logProduction.info(
        'Spec Extraction',
        `[SKIP] document=${documentId} reason=${docCheck.reason}`
      )
      return { status: 'skipped', documentId, projectId, reason: docCheck.reason }
    }

    const doc = docCheck as DocumentRow

    // -----------------------------------------------------------------------
    // Step 2: Load all chunks + discover sections (no LLM)
    // Returns a lightweight section manifest safe for Inngest step memoisation.
    // -----------------------------------------------------------------------
    const discoverResult = await step.run(
      'discover-sections',
      async (): Promise<DiscoverSpecSectionsResult | SkipResult> => {
        const supabase = createServiceRoleClient()
        const PAGE_SIZE = 1000
        const chunkRows: ChunkRow[] = []
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data, error } = await supabase
            .from('document_chunks')
            .select('id, chunk_index, content, page_number, metadata')
            .eq('document_id', documentId)
            .order('chunk_index', { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
          if (error) throw new Error(`load-chunks query failed: ${error.message}`)
          if (!data || data.length === 0) break
          for (const row of data as unknown as ChunkRow[]) chunkRows.push(row)
          if (data.length < PAGE_SIZE) break
        }

        if (chunkRows.length === 0) {
          return { kind: 'skip', reason: 'no_chunks_for_document', documentId, projectId }
        }

        const result = discoverSpecSections({
          documentMeta: { title: doc.filename, filename: doc.filename },
          chunks: chunkRows,
        })

        logProduction.info(
          'Spec Extraction',
          `[DISCOVER] document=${documentId} chunks=${chunkRows.length} rawSections=${result.totalRawSections} manifest=${result.manifest.length} warnings=${result.warnings.length}`
        )

        return result
      }
    )

    if ('kind' in discoverResult && discoverResult.kind === 'skip') {
      logProduction.info(
        'Spec Extraction',
        `[SKIP] document=${documentId} reason=${discoverResult.reason}`
      )
      return { status: 'skipped', documentId, projectId, reason: discoverResult.reason }
    }

    const discover = discoverResult as DiscoverSpecSectionsResult

    if (discover.manifest.length === 0) {
      logProduction.info(
        'Spec Extraction',
        `[SKIP] document=${documentId} reason=no_sections_discovered warnings=${JSON.stringify(discover.warnings)}`
      )
      return {
        status: 'skipped',
        documentId,
        projectId,
        reason: 'no_sections_discovered',
        warnings: discover.warnings,
      }
    }

    // -----------------------------------------------------------------------
    // Step 3: Full delete of all existing spec entities for this document.
    // Runs once per function invocation. On Inngest retry, this step is
    // memoised and skipped; per-batch scoped deletes handle retry idempotency.
    // -----------------------------------------------------------------------
    await step.run('delete-existing', async () => {
      const supabase = createServiceRoleClient()
      const { error } = await (supabase.from('project_entities') as AnyTable)
        .delete()
        .eq('project_id', projectId)
        .eq('discipline', 'spec')
        .eq('source_document_id', documentId)
      if (error) throw new Error(`delete-existing failed: ${error.message}`)
      logProduction.info(
        'Spec Extraction',
        `[DELETE] document=${documentId} project=${projectId} spec entities cleared`
      )
      return { deleted: true }
    })

    // -----------------------------------------------------------------------
    // Steps 4..N: Extract + persist in batches of BATCH_SIZE sections.
    // Each step:
    //   1. Creates a fresh Supabase client (no stale connections).
    //   2. Runs LLM extraction for this batch only.
    //   3. Does a scoped delete of this batch's section canonical names
    //      (idempotent: cleans up partial inserts from failed prior attempts).
    //   4. Persists results immediately with skipDelete=true.
    // -----------------------------------------------------------------------
    const manifest = discover.manifest
    const batches: SectionManifestEntry[][] = []
    for (let i = 0; i < manifest.length; i += BATCH_SIZE) {
      batches.push(manifest.slice(i, i + BATCH_SIZE))
    }

    const batchOutcomes: BatchOutcome[] = []

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]

      const outcome = await step.run(
        `extract-batch-${batchIndex}`,
        async (): Promise<BatchOutcome> => {
          const supabase = createServiceRoleClient()
          const llmCaller = createAnthropicSpecLlmCaller()

          // 1. LLM extraction for this batch.
          const batchExtract = await extractSectionBatch({
            batchEntries: batch,
            llmCaller,
          })

          // 2. Scoped delete: remove any existing entities for these sections
          //    (section + all its requirements via LIKE prefix).
          for (const entry of batch) {
            const norm = entry.sectionNumber.trim().replace(/\s+/g, '_')
            const prefix = `SPEC_${norm}`
            await (supabase.from('project_entities') as AnyTable)
              .delete()
              .eq('project_id', projectId)
              .eq('discipline', 'spec')
              .eq('source_document_id', documentId)
              .like('canonical_name', `${prefix}%`)
          }

          // 3. Build a minimal pipeline result containing only this batch.
          const batchPipelineResult = {
            projectId,
            documentId,
            documentClassification: discover.documentClassification,
            sections: batchExtract.sections,
            totalSections: batch.length,
            sectionsAttempted: batchExtract.sectionsAttempted,
            sectionsSucceeded: batchExtract.sectionsSucceeded,
            totalCostUsd: batchExtract.totalCostUsd,
            warnings: [],
          }

          // 4. Persist with skipDelete (caller already handled delete above).
          const persistOutcome = await persistSpecExtractionResult({
            projectId,
            documentId,
            result: batchPipelineResult,
            skipDelete: true,
            supabase,
          })

          const batchSectionNums = batch.map(s => s.sectionNumber).join(',')
          logProduction.info(
            'Spec Extraction',
            `[BATCH-${batchIndex}] document=${documentId} sections=[${batchSectionNums}] costUsd=${batchExtract.totalCostUsd} succeeded=${batchExtract.sectionsSucceeded}/${batchExtract.sectionsAttempted} reqWritten=${persistOutcome.requirementsWritten} persistStatus=${persistOutcome.status}${persistOutcome.failedAt ? ` failedAt=${persistOutcome.failedAt}` : ''}${persistOutcome.warning ? ` warning="${String(persistOutcome.warning).slice(0, 200)}"` : ''}`
          )

          return {
            batchIndex,
            sectionsAttempted: batchExtract.sectionsAttempted,
            sectionsSucceeded: batchExtract.sectionsSucceeded,
            costUsd: batchExtract.totalCostUsd,
            requirementsWritten: persistOutcome.requirementsWritten,
            citationsWritten: persistOutcome.citationsWritten,
            findingsWritten: persistOutcome.findingsWritten,
            sectionsSkippedByBuilder: persistOutcome.sectionsSkippedByBuilder,
            persistStatus: persistOutcome.status,
            failedAt: persistOutcome.failedAt,
            warning: persistOutcome.warning,
          }
        }
      )

      batchOutcomes.push(outcome)
    }

    // -----------------------------------------------------------------------
    // Aggregate batch outcomes and return final summary.
    // -----------------------------------------------------------------------
    const totalSectionsAttempted = batchOutcomes.reduce((s, b) => s + b.sectionsAttempted, 0)
    const totalSectionsSucceeded = batchOutcomes.reduce((s, b) => s + b.sectionsSucceeded, 0)
    const totalCostUsd = batchOutcomes.reduce((s, b) => s + b.costUsd, 0)
    const totalRequirementsWritten = batchOutcomes.reduce((s, b) => s + b.requirementsWritten, 0)
    const totalCitationsWritten = batchOutcomes.reduce((s, b) => s + b.citationsWritten, 0)
    const totalFindingsWritten = batchOutcomes.reduce((s, b) => s + b.findingsWritten, 0)
    const failedBatches = batchOutcomes.filter(b => b.persistStatus === 'failed')

    logProduction.info(
      'Spec Extraction',
      `[DONE] document=${documentId} batches=${batches.length} sectionsAttempted=${totalSectionsAttempted} sectionsSucceeded=${totalSectionsSucceeded} requirementsWritten=${totalRequirementsWritten} costUsd=${totalCostUsd.toFixed(4)} failedBatches=${failedBatches.length}`
    )

    return {
      status: failedBatches.length === 0 ? 'persisted' : 'partial',
      documentId,
      projectId,
      discover: {
        chunkCount: discover.chunkCount,
        totalRawSections: discover.totalRawSections,
        manifestSections: discover.manifest.length,
        documentClassification: discover.documentClassification,
        warnings: discover.warnings,
      },
      batches: batchOutcomes.length,
      totalSectionsAttempted,
      totalSectionsSucceeded,
      totalRequirementsWritten,
      totalCitationsWritten,
      totalFindingsWritten,
      totalCostUsd,
      failedBatches: failedBatches.length,
    }
  }
)
