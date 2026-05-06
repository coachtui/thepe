import { Inngest } from 'inngest'

/**
 * Shared Inngest client.
 * Import this in functions and API route handlers — never create a second instance.
 */
export const inngest = new Inngest({
  id: 'thepe',
  name: 'ThePE',
})

/**
 * Typed event map for all Inngest events in this app.
 * Add new events here as the system grows.
 */
export type Events = {
  'vision/document.process': {
    data: {
      documentId: string
      projectId: string
      /** Label identifying which code path triggered this event */
      trigger: string
      /** Max pages to process (default 500) */
      maxPages?: number
    }
  }
  /**
   * Triggered to extract CSI spec sections + requirements from a document
   * with `document_type='spec'`. Idempotent — safe to retry. Each run
   * deletes existing `discipline='spec'` entities for the document and
   * re-inserts from scratch via `persistSpecExtractionResult`.
   */
  'spec/document.extract': {
    data: {
      documentId: string
      projectId: string
      /** Label identifying which code path triggered this event */
      trigger: string
    }
  }
  'document/embeddings.requested': {
    data: {
      documentId: string
      /** Label identifying which code path triggered this event */
      trigger: string
    }
  }
}
