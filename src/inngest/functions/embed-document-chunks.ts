/**
 * Inngest function: document/embeddings.requested
 *
 * Generates and stores embeddings for all un-embedded chunks of a document.
 * Runs outside the Vercel request lifecycle — no 300s deadline, no 38MB payload.
 *
 * Each batch of 100 chunks is a separate step.run() with its own retry budget,
 * so a transient OpenAI or Supabase error only re-runs the failed batch.
 *
 * Deduplication: event sent with id=`embed-${documentId}` so uploading the
 * same document twice only enqueues one embedding job.
 */

import { inngest } from '@/inngest/client'
import { createServiceRoleClient } from '@/lib/db/supabase/service'
import { generateEmbeddingsBatch } from '@/lib/embeddings/openai'

const BATCH_SIZE = 100

export const embedDocumentChunks = inngest.createFunction(
  {
    id: 'embed-document-chunks',
    name: 'Embed Document Chunks',
    retries: 3,
    concurrency: { limit: 3 },
  },
  { event: 'document/embeddings.requested' },
  async ({ event, step }) => {
    const { documentId } = event.data

    const chunks = await step.run('fetch-unembed-chunks', async () => {
      const supabase = createServiceRoleClient()

      const { data: allChunks, error: chunksError } = await supabase
        .from('document_chunks')
        .select('id, content')
        .eq('document_id', documentId)
        .order('chunk_index')

      if (chunksError) throw chunksError
      if (!allChunks?.length) return []

      const { data: existingEmbeds } = await supabase
        .from('document_embeddings')
        .select('chunk_id')
        .in('chunk_id', allChunks.map((c) => c.id))

      const embeddedIds = new Set(existingEmbeds?.map((e) => e.chunk_id) ?? [])
      return allChunks.filter((c) => !embeddedIds.has(c.id))
    })

    if (!chunks.length) return { documentId, chunksEmbedded: 0, skipped: true }

    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE)

    for (let i = 0; i < totalBatches; i++) {
      const batch = chunks.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)

      await step.run(`embed-batch-${i + 1}-of-${totalBatches}`, async () => {
        const embeddings = await generateEmbeddingsBatch(batch.map((c) => c.content))

        const toInsert = embeddings.map((emb, idx) => ({
          chunk_id: batch[idx].id,
          embedding: `[${emb.embedding.join(',')}]`,
          model_version: emb.model,
        }))

        const supabase = createServiceRoleClient()
        const { error } = await supabase.from('document_embeddings').insert(toInsert)
        if (error) throw error
      })
    }

    return { documentId, chunksEmbedded: chunks.length }
  }
)
