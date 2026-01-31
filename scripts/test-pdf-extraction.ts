/**
 * Test script to inspect what LlamaParse actually extracted
 * Run with: npx tsx scripts/test-pdf-extraction.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

async function testExtraction() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in environment')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Get the most recent document
  const { data: docs, error: docError } = await supabase
    .from('documents')
    .select('*')
    .ilike('filename', '%Ammunition%')
    .order('created_at', { ascending: false })
    .limit(5)

  if (docError) {
    console.error('Error fetching document:', docError)
    return
  }

  if (!docs || docs.length === 0) {
    console.error('No documents found matching "Ammunition"')
    console.log('\nSearching for ANY documents...')
    const { data: allDocs } = await supabase
      .from('documents')
      .select('id, filename, created_at')
      .order('created_at', { ascending: false })
      .limit(5)

    if (allDocs && allDocs.length > 0) {
      console.log('Recent documents:')
      allDocs.forEach(d => console.log(`  - ${d.filename} (${d.id})`))
    }
    return
  }

  const doc = docs[0]
  console.log(`Found ${docs.length} matching documents, using most recent:`)
  console.log(`  ID: ${doc.id}`)
  console.log(`  Filename: ${doc.filename}`)
  console.log(`  Created: ${doc.created_at}`)

  console.log('')
  console.log('=== DOCUMENT INFO ===')
  console.log('Columns:', Object.keys(doc))
  console.log('')

  // Check all chunks
  const { data: chunks } = await supabase
    .from('document_chunks')
    .select('id, chunk_index, content, chunk_type, contains_components')
    .eq('document_id', doc.id)
    .order('chunk_index')

  console.log('=== CHUNKS INFO ===')
  console.log(`Total chunks: ${chunks?.length || 0}`)

  if (chunks) {
    const calloutChunks = chunks.filter(c => c.chunk_type === 'callout_box')
    console.log(`Callout chunks: ${calloutChunks.length}`)

    console.log('\nChunk types:')
    const types = chunks.reduce((acc, c) => {
      acc[c.chunk_type || 'null'] = (acc[c.chunk_type || 'null'] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    console.log(types)

    console.log('\nFirst 5 chunks (full content):')
    for (let i = 0; i < Math.min(5, chunks.length); i++) {
      const chunk = chunks[i]
      let content = chunk.content

      // Parse JSON if needed
      if (typeof content === 'string' && content.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(content)
          content = parsed.text || parsed.markdown || content
        } catch (e) {
          console.log(`Chunk ${i} has unparseable JSON`)
        }
      }

      console.log(`\n--- CHUNK ${i} (type: ${chunk.chunk_type}) ---`)
      console.log(content)
      console.log('--- END CHUNK ---')
    }

    console.log('\n=== SEARCH RESULTS ===')
    const searches = [
      'GATE VALVE',
      '12-IN',
      'VALVE',
      'TEE',
      'CONC BLOCK',
      'STA 32',
      'Q/S'
    ]

    for (const search of searches) {
      let found = false
      for (const chunk of chunks) {
        let content = chunk.content
        if (typeof content === 'string' && content.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(content)
            content = parsed.text || parsed.markdown || content
          } catch (e) {
            continue
          }
        }
        if (typeof content === 'string' && content.toUpperCase().includes(search.toUpperCase())) {
          found = true
          break
        }
      }
      console.log(`${found ? '✅' : '❌'} "${search}"`)
    }
  }
}

testExtraction().catch(console.error)
