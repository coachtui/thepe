/**
 * Local runner for spec extraction — bypasses Inngest.
 * Run: npx tsx --env-file=.env.local scripts/run-spec-extract.ts
 */

import { createClient } from '@supabase/supabase-js'
import {
  discoverSpecSections,
  extractSectionBatch,
  type SectionManifestEntry,
} from '../src/lib/chat/spec-extraction-pipeline.ts'
import { persistSpecExtractionResult } from '../src/lib/chat/spec-extraction-persistence.ts'
import { createAnthropicSpecLlmCaller } from '../src/lib/chat/spec-extraction-llm.ts'

const DOCUMENT_ID = '531866b0-c055-49fc-9681-9e7c771e356f'
const PROJECT_ID  = 'c455e726-b3b4-4f87-97e9-70a89ec17228'
const BATCH_SIZE  = 5

function supabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/"/g, '')
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/"/g, '')
  return createClient(url, key)
}

async function main() {
  const db = supabase()

  // Load all chunks (paginated)
  const PAGE = 1000
  const chunks: { id: string; chunk_index: number; content: string; page_number: number | null; metadata: Record<string, unknown> | null }[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('document_chunks')
      .select('id, chunk_index, content, page_number, metadata')
      .eq('document_id', DOCUMENT_ID)
      .order('chunk_index', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    chunks.push(...(data as typeof chunks))
    if (data.length < PAGE) break
  }
  console.log(`Loaded ${chunks.length} chunks`)

  // Discover CSI sections
  const { data: doc } = await db
    .from('documents')
    .select('filename')
    .eq('id', DOCUMENT_ID)
    .single()

  const discovery = discoverSpecSections({
    documentMeta: { title: doc?.filename ?? '', filename: doc?.filename ?? '' },
    chunks,
  })
  console.log(`Discovered ${discovery.manifest.length} sections (${discovery.totalRawSections} raw), warnings: ${discovery.warnings.length}`)
  if (discovery.manifest.length === 0) {
    console.error('No sections found — check the spec PDF has CSI-format section headers')
    process.exit(1)
  }

  // Clear existing spec entities for this document
  const { error: delErr } = await (db.from('project_entities') as any)
    .delete()
    .eq('project_id', PROJECT_ID)
    .eq('discipline', 'spec')
    .eq('source_document_id', DOCUMENT_ID)
  if (delErr) throw delErr
  console.log('Cleared existing spec entities')

  // Extract in batches
  const batches: SectionManifestEntry[][] = []
  for (let i = 0; i < discovery.manifest.length; i += BATCH_SIZE) {
    batches.push(discovery.manifest.slice(i, i + BATCH_SIZE))
  }

  let totalSections = 0
  let totalReqs = 0
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    process.stdout.write(`\rBatch ${i + 1}/${batches.length} (sections: ${batch.map(s => s.sectionNumber).join(',')})...`)

    const llm = createAnthropicSpecLlmCaller()
    const extracted = await extractSectionBatch({ batchEntries: batch, llmCaller: llm })

    const persist = await persistSpecExtractionResult({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      result: {
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        documentClassification: discovery.documentClassification,
        sections: extracted.sections,
        totalSections: batch.length,
        sectionsAttempted: extracted.sectionsAttempted,
        sectionsSucceeded: extracted.sectionsSucceeded,
        totalCostUsd: extracted.totalCostUsd,
        warnings: [],
      },
      skipDelete: true,
      supabase: supabase(),
    })

    totalSections += extracted.sectionsSucceeded
    totalReqs += persist.requirementsWritten
    console.log(` → ${extracted.sectionsSucceeded}/${extracted.sectionsAttempted} ok, ${persist.requirementsWritten} reqs, $${extracted.totalCostUsd.toFixed(4)}`)
  }

  console.log(`\nDone. ${totalSections} sections, ${totalReqs} requirements written.`)
}

main().catch(e => { console.error(e); process.exit(1) })
