/**
 * API Route: Search Documents
 * Phase 2: Document Management & RAG
 *
 * Performs semantic search across document embeddings
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { searchDocuments } from '@/lib/embeddings/vector-search'
import { generateEmbedding } from '@/lib/embeddings/openai'

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get search parameters from request body
    const { query, projectId, limit, similarityThreshold } =
      await request.json()

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query text is required' },
        { status: 400 }
      )
    }

    // Generate embedding for the search query (server-side, securely)
    const { embedding } = await generateEmbedding(query)

    // Perform vector search
    const results = await searchDocuments(embedding, {
      limit: limit || 10,
      similarityThreshold: similarityThreshold || 0.5,
      projectId: projectId || undefined,
    })

    return NextResponse.json({
      success: true,
      results,
      count: results.length,
    })
  } catch (error) {
    console.error('Search API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    )
  }
}
