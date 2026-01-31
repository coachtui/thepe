/**
 * Reset vision status and reprocess document
 * This will force Vision to re-analyze all pages with the updated logic
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

async function reprocessVision() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Get the Ammunition WL-A document
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, filename, project_id, vision_status, vision_sheets_processed')
    .ilike('filename', '%Ammunition%')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (docError || !doc) {
    console.error('Error finding document:', docError)
    return
  }

  console.log(`Found document: ${doc.filename} (${doc.id})`)
  console.log(`Current vision status: ${doc.vision_status}`)
  console.log(`Previously processed: ${doc.vision_sheets_processed || 0} sheets\n`)

  // Clear existing vision quantities
  console.log('Clearing existing vision-extracted quantities...')
  const { error: deleteError } = await supabase
    .from('project_quantities')
    .delete()
    .eq('document_id', doc.id)
    .eq('extraction_method', 'vision')

  if (deleteError) {
    console.error('Error clearing quantities:', deleteError)
  } else {
    console.log('✓ Cleared old quantities\n')
  }

  // Reset vision status to pending to allow reprocessing
  console.log('Resetting vision status to pending...')
  const { error: updateError } = await supabase
    .from('documents')
    .update({
      vision_status: 'pending',
      vision_processed_at: null,
      vision_sheets_processed: null,
      vision_quantities_extracted: null,
      vision_cost_usd: null,
      vision_error: null
    })
    .eq('id', doc.id)

  if (updateError) {
    console.error('Error resetting status:', updateError)
    return
  }

  console.log('✓ Reset vision status\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Vision status reset successfully!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('\nNext steps:')
  console.log('1. The document will be automatically reprocessed with Vision')
  console.log('2. This will process ALL 8 pages (not just 4)')
  console.log('3. Check terminal logs to verify all pages are processed')
  console.log('4. Run check-vision-quantities.ts to verify results')
  console.log('\nTrigger reprocessing by running:')
  console.log(`  curl -X POST http://localhost:3000/api/documents/${doc.id}/process-vision`)
  console.log('\nOr the processing will happen automatically on next document view.')
}

reprocessVision().catch(console.error)
