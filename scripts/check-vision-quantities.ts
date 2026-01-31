/**
 * Check what quantities Vision extracted
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

async function checkVisionQuantities() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Get project ID
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .limit(1)
    .single()

  if (!projects) {
    console.error('No project found')
    return
  }

  console.log(`Project: ${projects.name} (${projects.id})\n`)

  // Get the most recent document
  const { data: doc } = await supabase
    .from('documents')
    .select('id, filename, project_id')
    .ilike('filename', '%Ammunition%')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (doc) {
    console.log(`Checking document: ${doc.filename} (${doc.id})\n`)
  }

  // Get all quantities for this document
  const { data: quantities, error } = await supabase
    .from('project_quantities')
    .select('*')
    .eq('document_id', doc?.id || projects.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log(`=== VISION-EXTRACTED QUANTITIES ===`)
  console.log(`Total: ${quantities?.length || 0}\n`)

  if (quantities && quantities.length > 0) {
    quantities.forEach((q, i) => {
      console.log(`[${i + 1}] ${q.item_name}`)
      console.log(`    Quantity: ${q.quantity || 'N/A'} ${q.unit || ''}`)
      console.log(`    Description: ${q.description || 'N/A'}`)
      console.log(`    Sheet: ${q.sheet_number || 'N/A'}`)
      console.log(`    Station: ${q.station_from || 'N/A'} to ${q.station_to || 'N/A'}`)
      console.log(`    Confidence: ${Math.round((q.confidence || 0) * 100)}%`)
      console.log(`    Source: ${q.source_context || 'N/A'}`)
      console.log('')
    })

    // Search for valve-related items
    console.log('=== SEARCHING FOR VALVE-RELATED QUANTITIES ===')
    const valveRelated = quantities.filter(q =>
      q.item_name?.toLowerCase().includes('valve') ||
      q.description?.toLowerCase().includes('valve')
    )

    if (valveRelated.length > 0) {
      console.log(`Found ${valveRelated.length} valve-related items:`)
      valveRelated.forEach(q => {
        console.log(`  - ${q.item_name}: ${q.description || 'N/A'}`)
      })
    } else {
      console.log('❌ NO valve-related quantities found')
    }
  } else {
    console.log('❌ No quantities extracted by Vision')
  }
}

checkVisionQuantities().catch(console.error)
