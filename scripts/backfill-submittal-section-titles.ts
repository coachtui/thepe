/**
 * backfill-submittal-section-titles.ts
 *
 * One-time backfill: resolves real section titles for submittal_register_items.
 *
 * Resolution priority:
 *   1. project_entities.display_name  — titles extracted by the spec pipeline
 *   2. UFGS_SECTION_TITLES static map — covers sections the pipeline didn't index
 *   3. Placeholder unchanged          — if neither source has a title
 *
 * The UFGS submittal form extraction set sectionTitle = "Section XX XX XX"
 * for every item because the embedded form only contains section numbers, not
 * titles.
 *
 * USAGE
 *   Dry-run (default — no writes):
 *     npx tsx scripts/backfill-submittal-section-titles.ts
 *
 *   Execute writes:
 *     npx tsx scripts/backfill-submittal-section-titles.ts --execute
 *
 *   Target a specific project:
 *     npx tsx scripts/backfill-submittal-section-titles.ts --project=<uuid>
 *
 *   Combine:
 *     npx tsx scripts/backfill-submittal-section-titles.ts --project=<uuid> --execute
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

// ── env load ──────────────────────────────────────────────────────────────────
const envRaw = fs.readFileSync('/Users/tui/thepe/.env.local', 'utf8')
for (const line of envRaw.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="?(.*?)"?\s*$/)
  if (m) process.env[m[1]] = m[2]
}

// ── args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY_RUN = !args.includes('--execute')
const PROJECT_ARG = args.find(a => a.startsWith('--project='))
const TARGET_PROJECT_ID = PROJECT_ARG
  ? PROJECT_ARG.replace('--project=', '')
  : 'c455e726-b3b4-4f87-97e9-70a89ec17228'

const PAGE_SIZE = 1000

// ── supabase client ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── static UFGS/CSI section title fallback ────────────────────────────────────
// Covers the 50 sections found in the Ammunition Storage UFGS SUBMITTAL FORM
// that were not indexed by the standard spec extraction pipeline.
// Titles sourced from the UFGS master specification catalog and CSI MasterFormat.
const UFGS_SECTION_TITLES: Record<string, string> = {
  // Division 01 — General Requirements
  '01 20 00': 'PRICE AND PAYMENT PROCEDURES',
  '01 45 00': 'QUALITY CONTROL',
  '01 50 00': 'TEMPORARY FACILITIES AND CONTROLS',
  '01 58 00': 'PROJECT IDENTIFICATION',
  '01 74 19': 'CONSTRUCTION WASTE MANAGEMENT',
  '01 78 00': 'CLOSEOUT SUBMITTALS',
  // Division 02 — Existing Conditions
  '02 41 00': 'DEMOLITION',
  '02 83 00': 'LEAD IN CONSTRUCTION',
  // Division 03 — Concrete
  '03 37 13': 'SHOTCRETE',
  '03 45 33': 'PRECAST STRUCTURAL CONCRETE',
  // Division 04 — Masonry
  '04 20 00': 'UNIT MASONRY',
  // Division 05 — Metals
  '05 12 00': 'STRUCTURAL STEEL FRAMING',
  '05 30 00': 'STEEL DECK',
  '05 40 00': 'COLD-FORMED METAL FRAMING',
  '05 52 00': 'PIPE AND TUBE RAILINGS',
  // Division 06 — Wood, Plastics, and Composites
  '06 61 16': 'FIBERGLASS PANELING',
  // Division 07 — Thermal and Moisture Protection
  '07 13 53': 'ELASTOMERIC SHEET WATERPROOFING',
  '07 21 16': 'BLANKET INSULATION',
  '07 84 00': 'FIRESTOPPING',
  '07 92 00': 'JOINT SEALANTS',
  // Division 08 — Openings
  '08 11 13': 'HOLLOW METAL DOORS AND FRAMES',
  '08 39 53': 'BLAST-RESISTANT DOORS',
  '08 71 00': 'DOOR HARDWARE',
  // Division 09 — Finishes
  '09 29 00': 'GYPSUM BOARD',
  '09 30 10': 'CERAMIC TILE',
  '09 51 00': 'ACOUSTICAL CEILINGS',
  '09 65 00': 'RESILIENT FLOORING AND ACCESSORIES',
  '09 90 00': 'PAINTS AND COATINGS',
  '09 96 10': 'HIGH-PERFORMANCE COATINGS',
  // Division 10 — Specialties
  '10 14 53': 'DIRECTORY BOARDS',
  '10 28 13': 'TOILET ACCESSORIES',
  // Division 22 — Plumbing
  '22 13 29': 'SANITARY SEWERAGE',
  // Division 23 — HVAC
  '23 05 93': 'TESTING, ADJUSTING, AND BALANCING FOR HVAC',
  // Division 25 — Integrated Automation
  '25 10 10': 'FACILITY AUTOMATION SYSTEMS, GENERAL PURPOSE',
  // Division 26 — Electrical
  '26 13 00': 'MEDIUM-VOLTAGE SWITCHGEAR',
  '26 29 23': 'VARIABLE-FREQUENCY MOTOR CONTROLLERS',
  '26 41 00': 'FACILITY LIGHTNING PROTECTION',
  '26 56 00': 'EXTERIOR LIGHTING',
  // Division 27 — Communications
  '27 10 00': 'STRUCTURED CABLING',
  // Division 32 — Exterior Improvements
  '32 11 20': 'AGGREGATE SUBBASE COURSES',
  '32 11 23': 'AGGREGATE BASE COURSES',
  '32 11 26': 'FLEXIBLE PAVEMENT BASE COURSES',
  '32 15 00': 'PORTLAND CEMENT CONCRETE PAVEMENT',
  '32 17 23': 'PAVEMENT MARKINGS',
  '32 31 13': 'CHAIN LINK FENCES AND GATES',
  // Division 33 — Utilities
  '33 30 00': 'SANITARY SEWERAGE UTILITIES',
  '33 40 00': 'STORM DRAINAGE UTILITIES',
  '33 46 16': 'SUBDRAINAGE',
  '33 71 01': 'UNDERGROUND ELECTRICAL DISTRIBUTION',
  '33 82 00': 'COMMUNICATIONS OUTSIDE PLANT',
}

// ── helpers ───────────────────────────────────────────────────────────────────

function normalizeSection(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

function sectionFromCanonical(canonical: string): string | null {
  const m = canonical.match(/^SPEC_(\d{2}_\d{2}_\d{2})$/)
  if (!m) return null
  return m[1].replace(/_/g, ' ')
}

// ── step 1: load spec_section entities ───────────────────────────────────────
async function loadEntityTitleMap(projectId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('project_entities')
      .select('canonical_name, display_name, metadata')
      .eq('project_id', projectId)
      .eq('entity_type', 'spec_section')
      .eq('discipline', 'spec')
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('Error loading project_entities:', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      const meta = row.metadata as Record<string, unknown> | null
      const sectionNumber =
        (typeof meta?.sectionNumber === 'string' ? meta.sectionNumber : null) ??
        sectionFromCanonical(row.canonical_name as string)
      if (!sectionNumber) continue

      const title = typeof row.display_name === 'string' ? row.display_name.trim() : null
      if (!title || title.length === 0) continue
      if (/^section\s+\d/i.test(title)) continue

      map.set(normalizeSection(sectionNumber), title)
    }

    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return map
}

// ── step 2: load all submittal_register_items ─────────────────────────────────
type ItemRow = {
  id: string
  spec_section: string | null
  section_title: string | null
  item_payload: Record<string, unknown>
}

async function loadAllItems(projectId: string): Promise<ItemRow[]> {
  const rows: ItemRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('submittal_register_items')
      .select('id, spec_section, section_title, item_payload')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('Error loading submittal_register_items:', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    rows.push(...(data as ItemRow[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return rows
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nBackfill: submittal register section titles`)
  console.log(`Project:  ${TARGET_PROJECT_ID}`)
  console.log(`Mode:     ${DRY_RUN ? 'DRY RUN (no writes)' : 'EXECUTE (writes enabled)'}`)
  console.log(`Static fallback entries: ${Object.keys(UFGS_SECTION_TITLES).length}`)
  console.log()

  // 1. Load entity title map (priority 1)
  const entityMap = await loadEntityTitleMap(TARGET_PROJECT_ID)
  console.log(`project_entities titles loaded: ${entityMap.size}`)

  // 2. Load all items
  const items = await loadAllItems(TARGET_PROJECT_ID)
  console.log(`submittal_register_items loaded: ${items.length}\n`)

  // 3. Classify
  type Source = 'entity' | 'static'
  type ChangeRecord = {
    id: string
    specSection: string
    oldTitle: string
    newTitle: string
    source: Source
  }

  const toUpdate: ChangeRecord[] = []
  const noMatch: string[] = []
  let alreadyCorrect = 0
  const sampleRows: { section: string; old: string; new: string; source: Source }[] = []

  for (const row of items) {
    const specSection = (row.item_payload.specSection as string | null) ?? row.spec_section ?? ''
    const normalized = normalizeSection(specSection)

    // Priority 1: project_entities
    let resolvedTitle = entityMap.get(normalized)
    let source: Source = 'entity'

    // Priority 2: static UFGS fallback
    if (!resolvedTitle) {
      const fallback = UFGS_SECTION_TITLES[normalized]
      if (fallback) {
        resolvedTitle = fallback
        source = 'static'
      }
    }

    if (!resolvedTitle) {
      if (!noMatch.includes(normalized)) noMatch.push(normalized)
      continue
    }

    const currentTitle =
      (row.item_payload.sectionTitle as string | null) ?? row.section_title ?? ''

    if (currentTitle === resolvedTitle) {
      alreadyCorrect++
      continue
    }

    toUpdate.push({ id: row.id, specSection: normalized, oldTitle: currentTitle, newTitle: resolvedTitle, source })

    // Collect one sample per section for the before/after log
    if (sampleRows.length < 60 && !sampleRows.find(s => s.section === normalized)) {
      sampleRows.push({ section: normalized, old: currentTitle, new: resolvedTitle, source })
    }
  }

  // 4. Count by source
  const entityUpdates = toUpdate.filter(c => c.source === 'entity')
  const staticUpdates = toUpdate.filter(c => c.source === 'static')

  const entitySections = new Set(entityUpdates.map(c => c.specSection))
  const staticSections = new Set(staticUpdates.map(c => c.specSection))

  // 5. Report
  console.log(`=== CHANGE PLAN ===`)
  console.log(`  Total rows to update:              ${toUpdate.length}`)
  console.log(`  Already correct:                   ${alreadyCorrect}`)
  console.log(`  Resolved from project_entities:    ${entityUpdates.length} rows (${entitySections.size} sections)`)
  console.log(`  Resolved from static UFGS map:     ${staticUpdates.length} rows (${staticSections.size} sections)`)
  console.log(`  Still unresolved (no match):       ${noMatch.length} distinct sections`)

  if (noMatch.length > 0) {
    console.log(`\n  Unresolved sections:`)
    noMatch.sort().forEach(s => console.log(`    "${s}"`))
  }

  // Section-level summary for static fallback sections
  if (staticSections.size > 0) {
    const bySec = new Map<string, { newTitle: string; count: number }>()
    for (const c of staticUpdates) {
      const entry = bySec.get(c.specSection)
      if (entry) entry.count++
      else bySec.set(c.specSection, { newTitle: c.newTitle, count: 1 })
    }
    console.log(`\n  Static fallback sections to update:`)
    for (const [sec, { newTitle, count }] of [...bySec.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`    ${sec.padEnd(12)} → "${newTitle}"  (${count} rows)`)
    }
  }

  // Sample before/after
  if (sampleRows.length > 0) {
    console.log(`\n  Sample before/after (one per section, source noted):`)
    sampleRows
      .sort((a, b) => a.section.localeCompare(b.section))
      .forEach(r => {
        const src = r.source === 'entity' ? '[entity]' : '[static]'
        console.log(`    ${r.section}  ${src}  "${r.old.slice(0, 30)}" → "${r.new.slice(0, 50)}"`)
      })
  }

  if (DRY_RUN) {
    console.log(`\nDry run complete. No writes performed.`)
    console.log(`To execute: npx tsx scripts/backfill-submittal-section-titles.ts --execute`)
    return
  }

  // 6. Execute writes
  if (toUpdate.length === 0) {
    console.log(`\nNothing to update. Exiting.`)
    return
  }

  console.log(`\n=== EXECUTING WRITES (${toUpdate.length} rows) ===`)

  let updated = 0
  let failed = 0
  const WRITE_BATCH = 100

  for (let i = 0; i < toUpdate.length; i += WRITE_BATCH) {
    const batch = toUpdate.slice(i, i + WRITE_BATCH)

    for (const change of batch) {
      const { data: current, error: fetchErr } = await supabase
        .from('submittal_register_items')
        .select('item_payload')
        .eq('id', change.id)
        .single()

      if (fetchErr || !current) {
        console.error(`  FAIL ${change.id}: ${fetchErr?.message ?? 'not found'}`)
        failed++
        continue
      }

      const updatedPayload = {
        ...(current.item_payload as Record<string, unknown>),
        sectionTitle: change.newTitle,
      }

      const { error: updateErr } = await supabase
        .from('submittal_register_items')
        .update({ section_title: change.newTitle, item_payload: updatedPayload })
        .eq('id', change.id)

      if (updateErr) {
        console.error(`  FAIL ${change.id}: ${updateErr.message}`)
        failed++
      } else {
        updated++
        if (updated % 100 === 0) {
          console.log(`  ... ${updated}/${toUpdate.length} updated`)
        }
      }
    }
  }

  console.log(`\n=== DONE ===`)
  console.log(`  Updated: ${updated}`)
  console.log(`  Failed:  ${failed}`)
  console.log(`  Still unresolved: ${noMatch.length} distinct sections`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
