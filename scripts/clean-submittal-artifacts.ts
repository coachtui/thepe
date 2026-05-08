/**
 * clean-submittal-artifacts.ts
 *
 * Audits and cleans PDF page-break artifact text from submittal_register_items.
 *
 * ARTIFACT PATTERNS DETECTED
 *   Page-break markers from PDF text extraction appear as fragments like:
 *     "-PAGE-BREAK---"   "--PAGE-BREAK---"   "GE-BREAK---"
 *     "Fabric GE-BREAK---"   "Surge Arresters BREAK---"
 *   The defining signature is: item ends with trailing dashes after BREAK/REAK/PAGE-BREAK.
 *
 * CLASSIFICATION
 *   safe_delete  — entire item is an artifact marker (no meaningful content remains)
 *   safe_clean   — real text precedes the artifact; stripped text ≥ 3 non-conjunction words
 *   manual_review — real text is truncated, ambiguous, or ends with a conjunction/preposition
 *   false_positive — contains the word stem but is a real construction item (no trailing dashes)
 *
 * WHAT IS PRESERVED
 *   item_payload.rawExcerpt is never modified.
 *   For safe_delete rows: item is deleted from the run.
 *   For safe_clean rows: submittal_item and item_payload.submittalItem are updated;
 *     item_payload.notes is appended with a cleanup notice.
 *
 * USAGE
 *   Dry-run (default — no writes):
 *     npx tsx scripts/clean-submittal-artifacts.ts
 *
 *   Execute writes:
 *     npx tsx scripts/clean-submittal-artifacts.ts --execute
 *
 *   Target a specific project:
 *     npx tsx scripts/clean-submittal-artifacts.ts --project=<uuid>
 *
 *   Combine:
 *     npx tsx scripts/clean-submittal-artifacts.ts --project=<uuid> --execute
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

// ── env ───────────────────────────────────────────────────────────────────────
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

// ── supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const PAGE_SIZE = 1000

// ── artifact detection ────────────────────────────────────────────────────────
//
// A break artifact ends with trailing dashes after a BREAK/REAK fragment.
// Key: "Breakers" or "Breaking" (real words) do NOT end with dashes.
// This regex matches the artifact suffix including any preceding break word fragment.
//
//   " REAK---"           ←  end of "---PAGE-BREAK---" cut mid-word
//   " BREAK---"          ←  full suffix
//   " GE-BREAK---"       ←  "-PAGE-BREAK---" with "PA" stripped
//   " E-BREAK---"        ←  "-PAGE-BREAK---" with "PAG" stripped
//   " AGE-BREAK---"      ←  "-PAGE-BREAK---" with "P" stripped
//   " --PAGE-BREAK---"   ←  full marker embedded in text
//   "-PAGE-BREAK---"     ←  standalone marker
//
const BREAK_SUFFIX_RE = /\s*(?:--+\s*)?(?:[A-Z]{0,4}-)?(?:PAGE[-\s]*)?BREAK[-–—]+\s*$/i
const PAGE_BREAK_INLINE_RE = /\s*--+\s*PAGE[-\s]*BREAK[-–—]+\s*/ig
const REAK_SUFFIX_RE = /\s+REAK[-–—]+\s*$/i
const DASH_ONLY_RE = /^[-\s–—]+$/

const CONJUNCTIONS = new Set([
  'and', 'or', 'of', 'for', 'the', 'a', 'an', 'to', 'in', 'from',
  'with', 'by', 'at', 'as', 'but', 'nor', 'so', 'yet', 'both',
  'either', 'neither', 'whether', 'but', 'however',
])

type ArtifactKind = 'safe_delete' | 'safe_clean' | 'manual_review' | 'none'

interface ArtifactResult {
  isArtifact: boolean
  kind: ArtifactKind
  cleanedText: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

function classifyStripped(stripped: string, reason: string): ArtifactResult {
  const words = stripped.split(/\s+/).filter(w => w.replace(/[,;.]+$/, '').length > 0)

  if (words.length === 0) {
    return { isArtifact: true, kind: 'safe_delete', cleanedText: '', confidence: 'high', reason }
  }

  const lastWord = words[words.length - 1].replace(/[,;.]+$/, '').toLowerCase()
  const secondLastWord = words.length >= 2 ? words[words.length - 2].replace(/[,;.]+$/, '').toLowerCase() : ''
  const endsWithConjunction = CONJUNCTIONS.has(lastWord) || CONJUNCTIONS.has(secondLastWord)

  if (endsWithConjunction) {
    return { isArtifact: true, kind: 'manual_review', cleanedText: stripped, confidence: 'medium', reason: `${reason} — stripped text ends mid-phrase` }
  }

  if (words.length === 1) {
    return { isArtifact: true, kind: 'manual_review', cleanedText: stripped, confidence: 'medium', reason: `${reason} — single word remaining, likely truncated` }
  }

  if (words.length === 2) {
    return { isArtifact: true, kind: 'manual_review', cleanedText: stripped, confidence: 'medium', reason: `${reason} — two-word remainder, may be truncated` }
  }

  return { isArtifact: true, kind: 'safe_clean', cleanedText: stripped, confidence: 'high', reason }
}

function detectArtifact(text: string): ArtifactResult {
  const t = text.trim()

  // Rule 1: entirely dashes/spaces
  if (DASH_ONLY_RE.test(t)) {
    return { isArtifact: true, kind: 'safe_delete', cleanedText: '', confidence: 'high', reason: 'dash-only string' }
  }

  // Rule 2: ends with REAK--- (truncated BREAK)
  if (REAK_SUFFIX_RE.test(t)) {
    const stripped = t.replace(REAK_SUFFIX_RE, '').trim()
    return classifyStripped(stripped, 'ends with REAK--- fragment')
  }

  // Rule 3: ends with BREAK--- or PAGE-BREAK--- (with leading fragment variants)
  if (BREAK_SUFFIX_RE.test(t)) {
    const stripped = t.replace(BREAK_SUFFIX_RE, '').trim()
    return classifyStripped(stripped, 'ends with BREAK/PAGE-BREAK artifact')
  }

  // Rule 4: PAGE-BREAK embedded inline (marker in middle of string)
  if (PAGE_BREAK_INLINE_RE.test(t)) {
    PAGE_BREAK_INLINE_RE.lastIndex = 0
    const stripped = t.replace(PAGE_BREAK_INLINE_RE, ' ').replace(/\s{2,}/g, ' ').trim()
    // Strip trailing dashes that may remain
    const finalStripped = stripped.replace(/[-–—]+\s*$/, '').trim()
    return classifyStripped(finalStripped, 'contains inline PAGE-BREAK marker')
  }

  return { isArtifact: false, kind: 'none', cleanedText: '', confidence: 'high', reason: '' }
}

// ── row type ──────────────────────────────────────────────────────────────────
interface ItemRow {
  id: string
  spec_section: string | null
  section_title: string | null
  submittal_item: string
  item_payload: Record<string, unknown>
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`=== SUBMITTAL REGISTER ARTIFACT CLEANUP ===`)
  console.log(`Project:  ${TARGET_PROJECT_ID}`)
  console.log(`Mode:     ${DRY_RUN ? 'DRY RUN (no writes)' : 'EXECUTE'}`)
  console.log()

  // 1. Find latest completed run
  const { data: runData, error: runErr } = await supabase
    .from('workflow_runs')
    .select('id, status, completed_at')
    .eq('project_id', TARGET_PROJECT_ID)
    .eq('workflow_type', 'submittal_register')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single()

  if (runErr || !runData) {
    console.error('No completed submittal_register run found:', runErr?.message)
    process.exit(1)
  }

  console.log(`Run: ${runData.id}`)
  console.log(`Completed: ${runData.completed_at}`)
  console.log()

  // 2. Fetch all items for the run
  let all: ItemRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('submittal_register_items')
      .select('id, spec_section, section_title, submittal_item, item_payload')
      .eq('workflow_run_id', runData.id)
      .eq('project_id', TARGET_PROJECT_ID)
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      console.error('Fetch error:', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    all = all.concat(data as ItemRow[])
    if (data.length < PAGE_SIZE) break
  }

  console.log(`Total items loaded: ${all.length}`)

  // 3. Classify each item
  const toDelete: Array<ItemRow & { reason: string }> = []
  const toClean: Array<ItemRow & { cleanedText: string; reason: string }> = []
  const manualReview: Array<ItemRow & { cleanedText: string; reason: string; confidence: string }> = []

  for (const row of all) {
    const result = detectArtifact(row.submittal_item)
    if (!result.isArtifact) continue

    if (result.kind === 'safe_delete') {
      toDelete.push({ ...row, reason: result.reason })
    } else if (result.kind === 'safe_clean') {
      toClean.push({ ...row, cleanedText: result.cleanedText, reason: result.reason })
    } else if (result.kind === 'manual_review') {
      manualReview.push({ ...row, cleanedText: result.cleanedText, reason: result.reason, confidence: result.confidence })
    }
  }

  // 4. Report
  console.log()
  console.log(`=== ARTIFACT REPORT ===`)
  console.log(`  safe_delete:    ${toDelete.length} rows (entire item is artifact — will be deleted)`)
  console.log(`  safe_clean:     ${toClean.length} rows (artifact suffix — will strip and update text)`)
  console.log(`  manual_review:  ${manualReview.length} rows (truncated or ambiguous — no auto-action)`)
  console.log()

  if (toDelete.length > 0) {
    console.log(`--- SAFE DELETE (${toDelete.length} rows) ---`)
    for (const r of toDelete) {
      console.log(`  id: ${r.id}`)
      console.log(`  section: ${r.spec_section ?? '—'} · ${r.section_title ?? '—'}`)
      console.log(`  item: "${r.submittal_item}"`)
      console.log(`  reason: ${r.reason}`)
      console.log()
    }
  }

  if (toClean.length > 0) {
    console.log(`--- SAFE CLEAN (${toClean.length} rows) ---`)
    for (const r of toClean) {
      console.log(`  id: ${r.id}`)
      console.log(`  section: ${r.spec_section ?? '—'} · ${r.section_title ?? '—'}`)
      console.log(`  before: "${r.submittal_item}"`)
      console.log(`  after:  "${r.cleanedText}"`)
      console.log(`  reason: ${r.reason}`)
      console.log()
    }
  }

  if (manualReview.length > 0) {
    console.log(`--- MANUAL REVIEW (${manualReview.length} rows — no auto-action) ---`)
    for (const r of manualReview) {
      const proposed = r.cleanedText ? `→ "${r.cleanedText}"` : '→ DELETE'
      console.log(`  id: ${r.id}`)
      console.log(`  section: ${r.spec_section ?? '—'} · ${r.section_title ?? '—'}`)
      console.log(`  item: "${r.submittal_item}" ${proposed}`)
      console.log(`  reason: ${r.reason}`)
      console.log()
    }
  }

  if (DRY_RUN) {
    console.log(`Dry run complete. No writes performed.`)
    console.log(`To execute: npx tsx scripts/clean-submittal-artifacts.ts --execute`)
    return
  }

  // 5. Execute writes
  const totalChanges = toDelete.length + toClean.length
  if (totalChanges === 0) {
    console.log(`Nothing to execute. Exiting.`)
    return
  }

  console.log(`=== EXECUTING WRITES ===`)

  let deleted = 0
  let deleteFailed = 0
  let cleaned = 0
  let cleanFailed = 0

  // 5a. Delete full artifact rows
  for (const r of toDelete) {
    const { error } = await supabase
      .from('submittal_register_items')
      .delete()
      .eq('id', r.id)

    if (error) {
      console.error(`  DELETE FAIL ${r.id}: ${error.message}`)
      deleteFailed++
    } else {
      console.log(`  DELETED ${r.id} · "${r.submittal_item}"`)
      deleted++
    }
  }

  // 5b. Clean partial artifact rows
  for (const r of toClean) {
    const { data: current, error: fetchErr } = await supabase
      .from('submittal_register_items')
      .select('item_payload')
      .eq('id', r.id)
      .single()

    if (fetchErr || !current) {
      console.error(`  FETCH FAIL ${r.id}: ${fetchErr?.message ?? 'not found'}`)
      cleanFailed++
      continue
    }

    const existingPayload = current.item_payload as Record<string, unknown>
    const existingNotes = typeof existingPayload.notes === 'string' ? existingPayload.notes : ''
    const newNotes = [
      existingNotes,
      `Artifact cleaned: original text was "${r.submittal_item}"; PDF page-break marker stripped.`,
    ].filter(Boolean).join(' ')

    const updatedPayload: Record<string, unknown> = {
      ...existingPayload,
      submittalItem: r.cleanedText,
      notes: newNotes,
    }

    const { error: updateErr } = await supabase
      .from('submittal_register_items')
      .update({ submittal_item: r.cleanedText, item_payload: updatedPayload })
      .eq('id', r.id)

    if (updateErr) {
      console.error(`  CLEAN FAIL ${r.id}: ${updateErr.message}`)
      cleanFailed++
    } else {
      console.log(`  CLEANED ${r.id} · "${r.submittal_item}" → "${r.cleanedText}"`)
      cleaned++
    }
  }

  // 5c. Mark manual-review rows as artifact_suspected in item_payload
  //     These are queued in the UI review workflow — submittal_item is NOT changed here.
  let marked = 0
  let markFailed = 0

  for (const r of manualReview) {
    const { data: current, error: fetchErr } = await supabase
      .from('submittal_register_items')
      .select('item_payload')
      .eq('id', r.id)
      .single()

    if (fetchErr || !current) {
      console.error(`  FETCH FAIL ${r.id}: ${fetchErr?.message ?? 'not found'}`)
      markFailed++
      continue
    }

    const existingPayload = current.item_payload as Record<string, unknown>

    // Skip rows already resolved or ignored by a previous review session
    const existingStatus = existingPayload.artifactReviewStatus as string | undefined
    if (existingStatus === 'resolved' || existingStatus === 'ignored') {
      console.log(`  SKIP ${r.id} · already ${existingStatus} — not overwriting`)
      continue
    }

    const updatedPayload: Record<string, unknown> = {
      ...existingPayload,
      artifactReviewStatus: 'artifact_suspected',
      artifactReviewReason: r.reason,
      artifactSuggestedName: r.cleanedText || null,
    }

    const { error: updateErr } = await supabase
      .from('submittal_register_items')
      .update({ item_payload: updatedPayload })
      .eq('id', r.id)

    if (updateErr) {
      console.error(`  MARK FAIL ${r.id}: ${updateErr.message}`)
      markFailed++
    } else {
      console.log(`  QUEUED ${r.id} · "${r.submittal_item}" → artifact_suspected`)
      marked++
    }
  }

  console.log()
  console.log(`=== DONE ===`)
  console.log(`  Deleted:         ${deleted}`)
  console.log(`  Delete fail:     ${deleteFailed}`)
  console.log(`  Cleaned:         ${cleaned}`)
  console.log(`  Clean fail:      ${cleanFailed}`)
  console.log(`  Queued for review: ${marked}`)
  console.log(`  Queue fail:      ${markFailed}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
