/**
 * Test the full routing for "how many 12 inch valves?"
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

async function testRouting() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: doc } = await supabase
    .from('documents')
    .select('project_id')
    .ilike('filename', '%Ammunition%')
    .single()

  if (!doc) {
    console.error('No document found matching "Ammunition"')
    process.exit(1)
  }

  const query = 'how many 12 inch valves are there?'

  console.log('Testing query:', query)
  console.log('Project ID:', doc.project_id)
  console.log('')

  // Test search_quantities directly
  console.log('=== DIRECT SEARCH TEST ===')
  const { data: searchResults } = await supabase.rpc('search_quantities', {
    p_project_id: doc.project_id,
    p_search_term: '12 inch valves',
    p_limit: 10
  })

  console.log(`Found ${searchResults?.length || 0} quantities`)
  if (searchResults) {
    const unique = new Set(searchResults.map((r: any) => `${r.item_name} @ ${r.station_from}`))
    console.log(`Unique items: ${unique.size}`)

    const twelveInchValves = searchResults.filter((r: any) =>
      r.item_name.includes('12') && r.item_name.includes('VALVE')
    )
    console.log(`12-inch valves: ${twelveInchValves.length}`)

    console.log('\nAll results:')
    searchResults.forEach((r: any, i: number) => {
      console.log(`${i + 1}. ${r.item_name} @ ${r.station_from || 'N/A'} (similarity: ${(r.similarity * 100).toFixed(0)}%, confidence: ${(r.confidence * 100).toFixed(0)}%)`)
    })
  }
}

testRouting().catch(console.error)
