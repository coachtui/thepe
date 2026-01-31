/**
 * Force reprocess document with Vision
 * Directly calls the vision processor to reprocess all pages
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Import vision dependencies directly
import {
  convertPdfPageToImage,
  getPdfMetadata
} from '../src/lib/vision/pdf-to-image'
import {
  analyzeSheetWithVision
} from '../src/lib/vision/claude-vision'
import {
  processVisionForQuantities,
  storeQuantitiesInDatabase
} from '../src/lib/metadata/quantity-extractor'
import { getDocumentSignedUrl } from '../src/lib/db/queries/documents'

dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

async function forceReprocessVision() {
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
    .select('id, filename, file_path, project_id, vision_status')
    .ilike('filename', '%Ammunition%')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (docError || !doc) {
    console.error('Error finding document:', docError)
    return
  }

  console.log(`Found document: ${doc.filename}`)
  console.log(`Document ID: ${doc.id}`)
  console.log(`Project ID: ${doc.project_id}`)
  console.log(`Current status: ${doc.vision_status}\n`)

  // Clear existing vision quantities
  console.log('Clearing existing vision-extracted quantities...')
  const { error: deleteError } = await supabase
    .from('project_quantities')
    .delete()
    .eq('document_id', doc.id)

  if (deleteError) {
    console.error('Error clearing quantities:', deleteError)
  } else {
    console.log('✓ Cleared old quantities\n')
  }

  // Reset vision status
  console.log('Resetting vision status...')
  await supabase
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

  console.log('✓ Status reset\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Starting Vision Processing...')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const startTime = Date.now()
  let sheetsProcessed = 0
  let quantitiesExtracted = 0
  let totalCost = 0
  const errors: string[] = []
  let metadata: any

  try {
    // Get signed URL
    const signedUrl = await getDocumentSignedUrl(supabase, doc.file_path)
    if (!signedUrl) {
      throw new Error('Failed to get signed URL')
    }

    console.log('Downloading PDF...')
    const response = await fetch(signedUrl)
    const arrayBuffer = await response.arrayBuffer()
    const pdfBuffer = Buffer.from(arrayBuffer)

    // Get metadata
    metadata = await getPdfMetadata(pdfBuffer)
    console.log(`PDF has ${metadata.numPages} pages\n`)

    // Update status to processing
    await supabase
      .from('documents')
      .update({ vision_status: 'processing' })
      .eq('id', doc.id)

    // Process each page
    for (let pageNumber = 1; pageNumber <= metadata.numPages; pageNumber++) {
      try {
        console.log(`[Page ${pageNumber}/${metadata.numPages}] Converting to image...`)

        const image = await convertPdfPageToImage(pdfBuffer, pageNumber, {
          scale: 2.0,
          maxWidth: 2048,
          maxHeight: 2048,
          format: 'png'
        })

        console.log(`[Page ${pageNumber}/${metadata.numPages}] Analyzing with Vision...`)

        let sheetType: string = 'unknown'
        if (pageNumber === 1) {
          sheetType = 'title'
        } else if (pageNumber <= 3) {
          sheetType = 'summary'
        } else {
          sheetType = 'plan'
        }

        const visionResult = await analyzeSheetWithVision(image.buffer, {
          sheetType: sheetType as any
        })

        totalCost += visionResult.costUsd
        sheetsProcessed++

        console.log(`[Page ${pageNumber}/${metadata.numPages}] Found ${visionResult.quantities.length} quantities, cost: $${visionResult.costUsd.toFixed(4)}`)

        // Store quantities using the deduplicated storage function
        if (visionResult.quantities.length > 0) {
          const quantities = processVisionForQuantities(visionResult, `Page ${pageNumber}`)

          try {
            const stored = await storeQuantitiesInDatabase(
              doc.project_id,
              doc.id,
              null,
              quantities
            )
            quantitiesExtracted += stored
            console.log(`[Page ${pageNumber}/${metadata.numPages}] Stored ${stored} quantities (after dedup)`)
          } catch (insertError) {
            console.error(`[Page ${pageNumber}/${metadata.numPages}] Error storing quantities:`, insertError)
          }
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (pageError) {
        const errorMsg = `Error on page ${pageNumber}: ${pageError instanceof Error ? pageError.message : 'Unknown'}`
        console.error(`[Page ${pageNumber}/${metadata.numPages}] ❌ ${errorMsg}`)
        errors.push(errorMsg)
      }
    }

    // Update final status
    await supabase
      .from('documents')
      .update({
        vision_status: 'completed',
        vision_processed_at: new Date().toISOString(),
        vision_sheets_processed: sheetsProcessed,
        vision_quantities_extracted: quantitiesExtracted,
        vision_cost_usd: totalCost
      })
      .eq('id', doc.id)

  } catch (error) {
    console.error('Fatal error:', error)
    await supabase
      .from('documents')
      .update({
        vision_status: 'failed',
        vision_error: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', doc.id)
    throw error
  }

  const processingTimeMs = Date.now() - startTime

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Vision Processing Complete!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log(`Sheets processed: ${sheetsProcessed}/${metadata.numPages}`)
  console.log(`Quantities extracted: ${quantitiesExtracted}`)
  console.log(`Total cost: $${totalCost.toFixed(4)}`)
  console.log(`Processing time: ${(processingTimeMs / 1000).toFixed(1)}s`)

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`)
    errors.forEach(err => console.log(`  - ${err}`))
  }

  console.log('\nNext step: Run check-vision-quantities.ts to verify all 7 valves were found')
}

forceReprocessVision().catch(console.error)
