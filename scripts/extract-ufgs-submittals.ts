/**
 * UFGS Submittal Register Extractor
 *
 * This spec contains a 75-page SUBMITTAL FORM in section 01 33 00.
 * Format within each page block:
 *   SECTION_NUMBER SD-XX Type Description
 *   PARA_REF [G] Item Name
 *   PARA_REF [G] Item Name
 *   SECTION_NUMBER SD-XX ...
 *
 * Run: npx tsx --env-file=.env.local scripts/extract-ufgs-submittals.ts
 */

import { createClient } from '@supabase/supabase-js'

const DOCUMENT_ID = '531866b0-c055-49fc-9681-9e7c771e356f'
const PROJECT_ID  = 'c455e726-b3b4-4f87-97e9-70a89ec17228'

const SD_TYPES: Record<string, string> = {
  '01': 'Preconstruction Submittals',
  '02': 'Shop Drawings',
  '03': 'Product Data',
  '04': 'Samples',
  '06': 'Test Reports',
  '07': 'Certificates',
  '08': "Manufacturer's Instructions",
  '09': "Manufacturer's Field Reports",
  '10': 'Operation and Maintenance Data',
  '11': 'Closeout Submittals',
}

interface ParsedItem {
  specSection: string
  sdCode: string
  sdType: string
  paraRef: string
  itemName: string
  govApproval: boolean
}

function db() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/"/g, '')
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/"/g, '')
  return createClient(url, key)
}

function parseSubmittalForm(text: string): ParsedItem[] {
  const items: ParsedItem[] = []

  // Find all SUBMITTAL FORM page blocks
  // Each page starts after "PAGE N OF 75 PAGES ... AMMUNITION STORAGE"
  const pageBlocks = text.split(/SUBMITTAL FORM,Jan 96 PREVIOUS EDITION IS OBSOLETE PAGE \d+ OF 75 PAGES[^\n]*\n/)

  for (const block of pageBlocks) {
    if (!block.trim()) continue

    // Parse the block line by line
    let currentSection = ''
    let currentSdCode = ''
    let currentSdType = ''

    // Section header pattern: "01 11 00 SD-01 Preconstruction Submittals"
    // or "01 32 17.00 20 SD-11 Closeout Submittals"
    const sectionSdRe = /^(\d{2}\s+\d{2}\s+[\d.]+(?:\s+\d+)?)\s+(SD-(\d{2}))\s+(.+)$/

    // Item line pattern: "1.5 Digging Permit" or "1.4.2 G As-Built NAS"
    const itemRe = /^(\d+(?:\.\d+)*(?:\.\d+)*)\s+(G\s+)?(.+)$/

    const lines = block.split('\n')
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('---') || line.startsWith('FY22') || line.startsWith('AMMUNITION')) continue

      const secMatch = sectionSdRe.exec(line)
      if (secMatch) {
        currentSection = secMatch[1].replace(/\s+/g, ' ').trim()
        // Normalize to XX XX XX format (trim extra digits from UFGS numbering)
        const parts = currentSection.split(' ')
        if (parts.length >= 3) {
          currentSection = parts.slice(0, 3).join(' ')
        }
        currentSdCode = secMatch[2]
        const sdNum = secMatch[3]
        currentSdType = SD_TYPES[sdNum] ?? secMatch[4].trim()
        continue
      }

      if (!currentSection || !currentSdCode) continue

      const itemMatch = itemRe.exec(line)
      if (itemMatch) {
        const paraRef = itemMatch[1]
        const govApproval = !!itemMatch[2]
        const itemName = itemMatch[3].trim()

        // Skip empty or noise
        if (itemName.length < 3 || itemName.length > 200) continue
        if (/^[a-z]/.test(itemName)) continue
        if (/^(SUBMITTAL|FY22|PAGE|AMMUN|PART\s+[123]|End of)/i.test(itemName)) continue

        items.push({
          specSection: currentSection,
          sdCode: currentSdCode,
          sdType: currentSdType,
          paraRef,
          itemName,
          govApproval,
        })
      }
    }
  }

  return items
}

async function main() {
  const supabase = db()

  // Load all chunks
  const PAGE = 1000
  const chunks: { chunk_index: number; content: string }[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('document_chunks')
      .select('chunk_index, content')
      .eq('document_id', DOCUMENT_ID)
      .order('chunk_index')
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    chunks.push(...(data as typeof chunks))
    if (data.length < PAGE) break
  }
  console.log(`Loaded ${chunks.length} chunks`)

  const fullText = chunks.map(c => c.content).join('\n')

  // Check if the submittal form is present
  const formStart = fullText.indexOf('SUBMITTAL FORM,Jan 96')
  if (formStart === -1) {
    console.error('SUBMITTAL FORM not found in document text')
    process.exit(1)
  }
  console.log(`Found SUBMITTAL FORM at position ${formStart}`)

  // Extract just the submittal form section (75 pages)
  const formText = fullText.slice(formStart)
  const items = parseSubmittalForm(formText)

  console.log(`Extracted ${items.length} raw items`)

  // Dedupe by section + sdCode + itemName
  const seen = new Set<string>()
  const deduped = items.filter(item => {
    const key = `${item.specSection}|${item.sdCode}|${item.itemName.toLowerCase().slice(0, 60)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  console.log(`After dedup: ${deduped.length} items`)

  // Summary by section
  const bySec: Record<string, number> = {}
  for (const i of deduped) bySec[i.specSection] = (bySec[i.specSection] || 0) + 1
  console.log(`\nSections with submittals: ${Object.keys(bySec).length}`)
  console.log('Top 10 sections:', Object.entries(bySec).sort((a,b) => b[1]-a[1]).slice(0,10).map(([s,n]) => `${s}(${n})`).join(', '))

  console.log('\nSample items:')
  deduped.slice(0, 15).forEach(i =>
    console.log(`  ${i.specSection} | ${i.sdCode} | ${i.itemName}${i.govApproval ? ' [G]' : ''}`)
  )

  if (deduped.length === 0) {
    console.log('No items to write.')
    return
  }

  // Create workflow run
  const { data: runData, error: runErr } = await supabase
    .from('workflow_runs')
    .insert({
      project_id: PROJECT_ID,
      workflow_type: 'submittal_register',
      status: 'completed',
      source_type: 'chat_tool',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 0,
    })
    .select('id')
    .single()
  if (runErr) throw runErr
  const workflowRunId = runData.id
  console.log('\nWorkflow run:', workflowRunId)

  // Insert in batches of 100
  let written = 0
  const BATCH = 100
  for (let i = 0; i < deduped.length; i += BATCH) {
    const batch = deduped.slice(i, i + BATCH)
    const rows = batch.map(item => ({
      project_id: PROJECT_ID,
      workflow_run_id: workflowRunId,
      dedupe_key: `${item.specSection}|${item.sdCode}|${item.itemName.toLowerCase().slice(0, 60)}`,
      spec_section: item.specSection,
      section_title: `Section ${item.specSection}`,
      submittal_item: item.itemName,
      submittal_type: item.sdCode,
      required_action: 'Submit',
      approval_required: item.govApproval,
      confidence: 0.92,
      source_quality: 'high',
      citation_completeness: 3,
      review_status: 'pending',
      item_payload: {
        sdCode: item.sdCode,
        sdType: item.sdType,
        itemName: item.itemName,
        paraRef: item.paraRef,
        specSection: item.specSection,
        govApproval: item.govApproval,
        extractionMethod: 'ufgs_submittal_form',
      },
    }))
    const { error } = await supabase.from('submittal_register_items').insert(rows)
    if (error) { console.error('Insert error batch', Math.floor(i/BATCH), error.message); continue }
    written += batch.length
    process.stdout.write(`\rWritten: ${written}/${deduped.length}`)
  }

  console.log(`\n\nDone. ${written} items written. Refresh the submittal register page.`)
}

main().catch(e => { console.error(e); process.exit(1) })
