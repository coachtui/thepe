import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

// Load .env.local manually (no dotenv dependency)
const envRaw = fs.readFileSync('/Users/tui/thepe/.env.local', 'utf8')
for (const line of envRaw.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="?(.*?)"?\s*$/)
  if (m) process.env[m[1]] = m[2]
}

const PROJECT_ID = 'c455e726-b3b4-4f87-97e9-70a89ec17228'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function main() {
  // ── 1. Latest workflow runs ─────────────────────────────────────────────
  const { data: runs, error: runsErr } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('project_id', PROJECT_ID)
    .eq('workflow_type', 'submittal_register')
    .order('completed_at', { ascending: false })
    .limit(5)

  if (runsErr) { console.error('workflow_runs error:', runsErr); process.exit(1) }
  console.log('\n=== WORKFLOW RUNS (latest 5) ===')
  runs?.forEach(r => {
    console.log(`  id=${r.id} status=${r.status} created=${r.created_at} completed=${r.completed_at} source=${r.source_type}`)
  })

  const latestRun = runs?.find(r => r.status === 'completed') ?? runs?.[0]
  if (!latestRun) { console.log('No runs found'); process.exit(0) }
  console.log(`\nUsing run: ${latestRun.id}`)

  // ── 2. All items for latest run ─────────────────────────────────────────
  const { data: items, error: itemsErr } = await supabase
    .from('submittal_register_items')
    .select('id, item_payload, review_status, created_at')
    .eq('project_id', PROJECT_ID)
    .eq('workflow_run_id', latestRun.id)
    .order('created_at', { ascending: true })

  if (itemsErr) { console.error('items error:', itemsErr); process.exit(1) }
  console.log(`\n=== TOTAL ITEMS IN RUN: ${items?.length ?? 0} ===`)

  type Item = {
    id: string
    review_status: string
    specSection: string
    sectionTitle: string
    itemName: string
    submittalType: string
    approvalRequired: boolean | null
    confidence: number
    sourceQuality: string
    citationCompleteness: number
    partReference: string
    pageNumber: string | number | null
    documentId: string
    chunkId: string | number | null
    notes: string
    rawPayload: Record<string, unknown>
  }

  const parsed: Item[] = (items ?? []).map(row => {
    const p = (row.item_payload as Record<string, unknown>) ?? {}
    return {
      id: row.id,
      review_status: row.review_status ?? 'pending',
      specSection: String(p.specSection ?? p.spec_section ?? ''),
      sectionTitle: String(p.sectionTitle ?? p.section_title ?? ''),
      itemName: String(p.itemName ?? p.item_name ?? p.name ?? ''),
      submittalType: String(p.submittalType ?? p.submittal_type ?? p.sdCategory ?? ''),
      approvalRequired: p.approvalRequired != null ? Boolean(p.approvalRequired) : null,
      confidence: Number(p.confidence ?? 0),
      sourceQuality: String(p.sourceQuality ?? p.source_quality ?? 'unknown'),
      citationCompleteness: Number(p.citationCompleteness ?? p.citation_completeness ?? 0),
      partReference: String(p.partReference ?? p.part_reference ?? ''),
      pageNumber: (p.pageNumber ?? p.page_number ?? null) as string | number | null,
      documentId: String(p.documentId ?? p.document_id ?? ''),
      chunkId: (p.chunkId ?? p.chunk_id ?? null) as string | number | null,
      notes: String(p.notes ?? ''),
      rawPayload: p,
    }
  })

  // ── 3. Metrics ──────────────────────────────────────────────────────────
  console.log('\n=== REVIEW STATUS COUNTS ===')
  const byStatus: Record<string, number> = {}
  parsed.forEach(i => { byStatus[i.review_status] = (byStatus[i.review_status] ?? 0) + 1 })
  Object.entries(byStatus).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`))

  console.log('\n=== SOURCE QUALITY COUNTS ===')
  const byQuality: Record<string, number> = {}
  parsed.forEach(i => { byQuality[i.sourceQuality] = (byQuality[i.sourceQuality] ?? 0) + 1 })
  Object.entries(byQuality).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`))

  console.log('\n=== APPROVAL REQUIRED COUNTS ===')
  const byApproval: Record<string, number> = { 'true': 0, 'false': 0, 'null': 0 }
  parsed.forEach(i => {
    const k = i.approvalRequired === null ? 'null' : String(i.approvalRequired)
    byApproval[k] = (byApproval[k] ?? 0) + 1
  })
  Object.entries(byApproval).forEach(([k, v]) => console.log(`  approvalRequired=${k}: ${v}`))

  console.log('\n=== CITATION COMPLETENESS BUCKETS ===')
  const byCit: Record<string, number> = { '0_uncited': 0, '1-2_weak': 0, '3_partial': 0, '4_strong': 0, '5+_full': 0 }
  parsed.forEach(i => {
    const c = i.citationCompleteness
    if (c === 0) byCit['0_uncited']++
    else if (c <= 2) byCit['1-2_weak']++
    else if (c === 3) byCit['3_partial']++
    else if (c === 4) byCit['4_strong']++
    else byCit['5+_full']++
  })
  Object.entries(byCit).forEach(([k, v]) => console.log(`  ${k}: ${v}`))

  const avgConf = parsed.reduce((s, i) => s + i.confidence, 0) / (parsed.length || 1)
  console.log(`\nAverage confidence: ${(avgConf * 100).toFixed(1)}%`)

  console.log('\n=== SECTIONS (all, sorted by item count) ===')
  const bySection: Record<string, { count: number; title: string; totalConf: number }> = {}
  parsed.forEach(i => {
    const k = i.specSection || '(none)'
    if (!bySection[k]) bySection[k] = { count: 0, title: i.sectionTitle, totalConf: 0 }
    bySection[k].count++
    bySection[k].totalConf += i.confidence
  })
  const sectionEntries = Object.entries(bySection).sort((a, b) => b[1].count - a[1].count)
  sectionEntries.forEach(([k, v]) =>
    console.log(`  ${k.padEnd(12)} "${v.title.slice(0, 45).padEnd(45)}" ${v.count} items, avg ${(v.totalConf / v.count * 100).toFixed(0)}% conf`)
  )
  console.log(`\nTotal sections: ${sectionEntries.length}`)

  const ungroupedCount = parsed.filter(i => !i.specSection || i.specSection === 'null' || i.specSection === '').length
  console.log(`Ungrouped items (no specSection): ${ungroupedCount}`)

  console.log('\n=== SUBMITTAL TYPE COUNTS (top 30) ===')
  const byType: Record<string, number> = {}
  parsed.forEach(i => { byType[i.submittalType || '(none)'] = (byType[i.submittalType || '(none)'] ?? 0) + 1 })
  Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log(`  ${k}: ${v}`))

  // ── 4. Samples ─────────────────────────────────────────────────────────
  const high = parsed.filter(i => i.confidence >= 0.8).slice(0, 20)
  const medium = parsed.filter(i => i.confidence >= 0.5 && i.confidence < 0.8).slice(0, 20)
  const low = parsed.filter(i => i.confidence < 0.5).slice(0, 20)
  const approvalReq = parsed.filter(i => i.approvalRequired === true).slice(0, 20)
  const infoOnly = parsed.filter(i => i.approvalRequired === false).slice(0, 20)
  const ungrouped = parsed.filter(i => !i.specSection || i.specSection === 'null' || i.specSection === '').slice(0, 50)
  const largestSectionKey = sectionEntries[0]?.[0] ?? ''
  const largestSectionItems = parsed.filter(i => (i.specSection || '(none)') === largestSectionKey).slice(0, 20)

  function printSample(label: string, sample: Item[]) {
    console.log(`\n=== SAMPLE: ${label} (${sample.length} shown) ===`)
    sample.forEach((i, idx) => {
      const citStr = `cit=${i.citationCompleteness}`
      const confStr = `conf=${(i.confidence * 100).toFixed(0)}%`
      const appStr = `approval=${i.approvalRequired}`
      console.log(`  [${idx + 1}] sec=${i.specSection.padEnd(10)} type=${i.submittalType.slice(0, 25).padEnd(25)} ${appStr.padEnd(18)} ${confStr.padEnd(10)} ${citStr.padEnd(8)} name="${i.itemName.slice(0, 75)}"`)
    })
  }

  printSample('HIGH CONFIDENCE (>=0.8)', high)
  printSample('MEDIUM CONFIDENCE (0.5-0.8)', medium)
  printSample('LOW CONFIDENCE (<0.5)', low)
  printSample('APPROVAL REQUIRED=TRUE', approvalReq)
  printSample('INFO/RECORD ONLY (approvalRequired=false)', infoOnly)
  printSample(`LARGEST SECTION ${largestSectionKey}`, largestSectionItems)
  if (ungrouped.length > 0) printSample('UNGROUPED (no specSection)', ungrouped)

  // ── 5. Raw payload shape ────────────────────────────────────────────────
  console.log('\n=== RAW PAYLOAD SHAPE (first 2 items) ===')
  parsed.slice(0, 2).forEach((item, idx) => {
    console.log(`\n[${idx + 1}] keys: ${Object.keys(item.rawPayload).join(', ')}`)
    console.log(JSON.stringify(item.rawPayload, null, 2).slice(0, 800))
  })

  // ── 6. Duplicate detection ──────────────────────────────────────────────
  console.log('\n=== DUPLICATE DETECTION ===')
  const sectionNameKey: Record<string, number> = {}
  parsed.forEach(i => {
    const k = `${i.specSection}|${i.itemName.toLowerCase().trim()}`
    sectionNameKey[k] = (sectionNameKey[k] ?? 0) + 1
  })
  const dupes = Object.entries(sectionNameKey).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1])
  console.log(`Exact duplicates (same section+name): ${dupes.length}`)
  dupes.slice(0, 15).forEach(([k, v]) => console.log(`  x${v}: "${k.slice(0, 90)}"`))

  const nameOnly: Record<string, string[]> = {}
  parsed.forEach(i => {
    const k = i.itemName.toLowerCase().trim()
    if (!nameOnly[k]) nameOnly[k] = []
    nameOnly[k].push(i.specSection || '(none)')
  })
  const crossSection = Object.entries(nameOnly).filter(([, v]) => new Set(v).size > 1)
  console.log(`\nNames in 2+ sections (potential near-dupes): ${crossSection.length}`)
  crossSection.slice(0, 10).forEach(([k, v]) => {
    const secs = [...new Set(v)].slice(0, 6).join(', ')
    console.log(`  "${k.slice(0, 60)}" → ${secs}`)
  })

  // ── 7. Noise detection ──────────────────────────────────────────────────
  console.log('\n=== NOISE / NON-SUBMITTAL INDICATORS ===')
  const noisy = parsed.filter(i => {
    const n = i.itemName.toLowerCase().trim()
    return n.length < 4
      || n === 'n/a'
      || n === 'na'
      || n.includes('submittal register')
      || n.includes('approval needed by')
      || n.includes('not applicable')
      || /^\d{1,4}$/.test(n)
  })
  console.log(`Potentially noisy rows: ${noisy.length}`)
  noisy.slice(0, 20).forEach(i => console.log(`  sec=${i.specSection} name="${i.itemName.slice(0, 80)}"`))

  // ── 8. Suspicious section sizes ─────────────────────────────────────────
  console.log('\n=== SECTIONS WITH >50 ITEMS ===')
  sectionEntries.filter(([, v]) => v.count > 50).forEach(([k, v]) =>
    console.log(`  ${k}: ${v.count} items`)
  )

  console.log('\n=== SECTIONS WITH <=2 ITEMS ===')
  sectionEntries.filter(([k, v]) => v.count <= 2 && k !== '(none)').forEach(([k, v]) =>
    console.log(`  ${k} "${v.title.slice(0, 50)}": ${v.count} items`)
  )

  console.log('\n\n=== AUDIT COMPLETE ===')
}

main().catch(e => { console.error(e); process.exit(1) })
