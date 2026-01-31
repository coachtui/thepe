/**
 * API Route: Process Document
 * Phase 2: Document Management & RAG
 *
 * This endpoint:
 * 1. Parses document with LlamaParse
 * 2. Chunks the text
 * 3. Generates embeddings
 * 4. Stores chunks and embeddings in database
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { getDocument, updateDocumentStatus } from '@/lib/db/queries/documents'
import { parseDocumentFromUrlWithPdfJs } from '@/lib/parsers/pdfjs-parser'
import { canParse } from '@/lib/parsers/llamaparse'
import { chunkTextPreservingCallouts } from '@/lib/embeddings/chunking'
import { generateEmbeddingsBatch } from '@/lib/embeddings/openai'
import {
  createDocumentChunks,
  createDocumentEmbeddings,
} from '@/lib/embeddings/vector-search'
import { getDocumentSignedUrl } from '@/lib/db/queries/documents'
import { triggerVisionProcessingAsync, shouldAutoProcessVision } from '@/lib/vision/auto-process'

export async function POST(request: NextRequest) {
  try {
    // Get document ID from request body
    const { documentId } = await request.json()

    if (!documentId) {
      return NextResponse.json(
        { error: 'Document ID is required' },
        { status: 400 }
      )
    }

    // Verify user is authenticated
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get document from database
    const document = await getDocument(supabase, documentId)

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Check if document can be parsed
    if (!canParse(document.file_type)) {
      await updateDocumentStatus(supabase, documentId, 'failed')
      return NextResponse.json(
        { error: 'Document type not supported for parsing' },
        { status: 400 }
      )
    }

    // Update status to processing
    await updateDocumentStatus(supabase, documentId, 'processing')

    try {
      // Step 1: Get signed URL for document
      const signedUrl = await getDocumentSignedUrl(supabase, document.file_path)

      // Step 2: Parse document with PDF.js (extracts ALL text including small fonts)
      console.log(`[PDF.js] Parsing document ${documentId}...`)
      const parsed = await parseDocumentFromUrlWithPdfJs(signedUrl, document.filename)

      // Step 3: Chunk the text (preserving callout boxes)
      console.log(`Chunking document ${documentId} (preserving callout boxes)...`)
      const chunks = chunkTextPreservingCallouts(parsed.text, {
        chunkSize: 1000,
        overlapSize: 200,
        preserveSentences: true,
        preserveParagraphs: true,
      })

      console.log(`Created ${chunks.length} chunks`)

      // Step 4: Create chunks in database with callout metadata
      const dbChunks = await createDocumentChunks(
        supabase,
        documentId,
        chunks.map((chunk) => ({
          content: chunk.content,
          chunkIndex: chunk.index,
          pageNumber: chunk.metadata?.pageNumber,
          chunkType: chunk.metadata?.chunkType,
          containsComponents: chunk.metadata?.containsComponents,
          componentList: chunk.metadata?.componentList,
          systemName: chunk.metadata?.systemName,
          station: chunk.metadata?.station,
        }))
      )

      // Step 5: Generate embeddings for all chunks
      console.log(`Generating embeddings for ${chunks.length} chunks...`)
      const chunkTexts = chunks.map((c) => c.content)
      const embeddings = await generateEmbeddingsBatch(chunkTexts)

      // Step 6: Store embeddings in database
      console.log(`Storing ${embeddings.length} embeddings...`)
      await createDocumentEmbeddings(
        supabase,
        embeddings.map((emb, index) => ({
          chunkId: dbChunks[index].id,
          embedding: emb.embedding,
          modelVersion: emb.model,
        }))
      )

      // Step 7: Update document status to completed
      await updateDocumentStatus(
        supabase,
        documentId,
        'completed',
        parsed.pageCount
      )

      console.log(`Document ${documentId} processed successfully`)

      // Step 8: Trigger vision processing in background (non-blocking)
      // Only process PDFs automatically
      const shouldProcess = await shouldAutoProcessVision(documentId);
      if (shouldProcess && document.project_id) {
        console.log(`[Document Process] Triggering automatic vision processing for ${documentId}`);
        triggerVisionProcessingAsync(documentId, document.project_id, {
          maxSheets: 50  // Process all pages for construction plans
        });
      } else {
        console.log(`[Document Process] Skipping automatic vision processing (not a PDF, already processed, or missing project_id)`);
      }

      return NextResponse.json({
        success: true,
        documentId,
        chunks: chunks.length,
        pageCount: parsed.pageCount,
        visionProcessingTriggered: shouldProcess
      })
    } catch (processingError) {
      console.error('Document processing error:', processingError)

      // Update status to failed
      await updateDocumentStatus(supabase, documentId, 'failed')

      return NextResponse.json(
        {
          error:
            processingError instanceof Error
              ? processingError.message
              : 'Processing failed',
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
