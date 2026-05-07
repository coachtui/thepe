/**
 * backfill-submittal-section-titles.ts
 *
 * One-time backfill: resolves real section titles for submittal_register_items
 * from project_entities (entity_type='spec_section', discipline='spec').
 *
 * The UFGS submittal form extraction set sectionTitle = "Section XX XX XX"
 * for every item because the embedded form only contains section numbers, not
 * titles. This script reads the titles that the standard spec extraction
 * pipeline stored in project_entities.display_name and writes them back into
 * submittal_register_items.section_title (column) and
 * item_payload.sectionTitle (JSON field).
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

// ── helpers ───────────────────────────────────────────────────────────────────

/** Normalize a raw section number to a stable lookup key: trim + collapse whitespace */
function normalizeSection(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/** Derive section number from canonical_name as fallback.
 *  "SPEC_03_30_00" → "03 30 00"
 *  "SPEC_03_30_00_REQ_..." → skip (not a section entity)
 */
function sectionFromCanonical(canonical: string): string | null {
  const m = canonical.match(/^SPEC_(\d{2}_\d{2}_\d{2})$/)
  if (!m) return null
  return m[1].replace(/_/g, ' ')
}

// ── step 1: load spec_section entities ───────────────────────────────────────
async function loadSectionTitleMap(projectId: string): Promise<Map<string, string>> {
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
      // Prefer metadata.sectionNumber — this is the canonical field set by buildSpecPersistenceRows
      const sectionNumber =
        (typeof meta?.sectionNumber === 'string' ? meta.sectionNumber : null) ??
        sectionFromCanonical(row.canonical_name as string)

      if (!sectionNumber) continue

      const title = typeof row.display_name === 'string' ? row.display_name.trim() : null
      if (!title || title.length === 0) continue

      // Skip placeholder titles that look like "Section XX XX XX"
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
  console.log()

  // 1. Load section title map
  const titleMap = await loadSectionTitleMap(TARGET_PROJECT_ID)
  console.log(`Found ${titleMap.size} spec_section entities with resolvable titles:`)
  for (const [k, v] of titleMap.entries()) {
    console.log(`  ${k.padEnd(12)} → "${v}"`)
  }
  console.log()

  // 2. Load all submittal_register_items
  const items = await loadAllItems(TARGET_PROJECT_ID)
  console.log(`Loaded ${items.length} submittal_register_items\n`)

  // 3. Classify each item
  type ChangeRecord = {
    id: string
    specSection: string
    oldTitle: string
    newTitle: string
  }

  const toUpdate: ChangeRecord[] = []
  const noMatch: string[] = []
  let alreadyCorrect = 0

  for (const row of items) {
    const specSection = (row.item_payload.specSection as string | null) ?? row.spec_section ?? ''
    const normalized = normalizeSection(specSection)
    const resolvedTitle = titleMap.get(normalized)

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

    toUpdate.push({
      id: row.id,
      specSection: normalized,
      oldTitle: currentTitle,
      newTitle: resolvedTitle,
    })
  }

  // 4. Report
  console.log(`=== CHANGE PLAN ===`)
  console.log(`  Would update: ${toUpdate.length} rows`)
  console.log(`  Already correct: ${alreadyCorrect} rows`)
  console.log(`  No match (section not in project_entities): ${noMatch.length} distinct sections`)
  if (noMatch.length > 0) {
    console.log(`\n  Unresolved sections:`)
    noMatch.sort().forEach(s => console.log(`    "${s}"`))
  }

  if (toUpdate.length > 0) {
    // Group by specSection for readable summary
    const bySec = new Map<string, { newTitle: string; count: number }>()
    for (const c of toUpdate) {
      const entry = bySec.get(c.specSection)
      if (entry) entry.count++
      else bySec.set(c.specSection, { newTitle: c.newTitle, count: 1 })
    }
    console.log(`\n  Sections to update:`)
    for (const [sec, { newTitle, count }] of bySec.entries()) {
      console.log(`    ${sec.padEnd(12)} → "${newTitle}"  (${count} rows)`)
    }
  }

  if (DRY_RUN) {
    console.log(`\nDry run complete. No writes performed.`)
    console.log(`To execute: npx tsx scripts/backfill-submittal-section-titles.ts --execute`)
    return
  }

  // 5. Execute writes
  if (toUpdate.length === 0) {
    console.log(`\nNothing to update. Exiting.`)
    return
  }

  console.log(`\n=== EXECUTING WRITES (${toUpdate.length} rows) ===`)

  let updated = 0
  let failed = 0

  // Process in batches to avoid overwhelming the API
  const WRITE_BATCH = 100
  for (let i = 0; i < toUpdate.length; i += WRITE_BATCH) {
    const batch = toUpdate.slice(i, i + WRITE_BATCH)

    for (const change of batch) {
      // Fetch current item_payload to merge safely
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
        .update({
          section_title: change.newTitle,
          item_payload: updatedPayload,
        })
        .eq('id', change.id)

      if (updateErr) {
        console.error(`  FAIL ${change.id}: ${updateErr.message}`)
        failed++
      } else {
        updated++
        if (updated % 50 === 0) {
          console.log(`  ... ${updated}/${toUpdate.length} updated`)
        }
      }
    }
  }

  console.log(`\n=== DONE ===`)
  console.log(`  Updated: ${updated}`)
  console.log(`  Failed:  ${failed}`)
  console.log(`  No-match (unchanged): ${noMatch.length} distinct sections × their item counts`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
