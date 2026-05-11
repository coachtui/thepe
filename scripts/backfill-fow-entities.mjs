#!/usr/bin/env node
/**
 * Phase 8A backfill: promote `relatedFOW` strings on submittals to first-class
 * FOW entities in `project_entities`, and update each submittal's item_payload
 * to point at its FOW entity via `fowEntityId`.
 *
 * Idempotent: re-runnable safely. Skips submittals already linked. Reuses
 * existing FOW entities by canonical name (normalized whitespace + case).
 *
 * Usage:
 *   npm run dev > /dev/null &  # ensure .env.local loaded if needed
 *   node --no-warnings scripts/backfill-fow-entities.mjs [--project=<uuid>] [--dry-run]
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run with dotenv or export from .env.local')
  process.exit(1)
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const projectFilter = args.find(a => a.startsWith('--project='))?.split('=')[1] ?? null

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

function normalizeFowName(raw) {
  return String(raw).trim().replace(/\s+/g, ' ').toLowerCase()
}

async function getProjects() {
  if (projectFilter) return [{ id: projectFilter }]
  const { data, error } = await supabase.from('projects').select('id')
  if (error) throw new Error(`Failed to list projects: ${error.message}`)
  return data ?? []
}

async function getSubmittalsForProject(projectId) {
  // Fetch in pages to bypass 1000-row default
  const all = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('submittal_register_items')
      .select('id, item_payload')
      .eq('project_id', projectId)
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`Failed to fetch submittals for ${projectId}: ${error.message}`)
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    offset += PAGE
  }
  return all
}

async function getExistingFowEntities(projectId) {
  const { data, error } = await supabase
    .from('project_entities')
    .select('id, canonical_name, display_name')
    .eq('project_id', projectId)
    .eq('entity_type', 'feature_of_work')
  if (error) throw new Error(`Failed to fetch FOW entities for ${projectId}: ${error.message}`)
  const map = new Map()
  for (const r of data ?? []) map.set(r.canonical_name, r)
  return map
}

async function processProject(projectId) {
  console.log(`\n── Project ${projectId} ──`)

  const submittals = await getSubmittalsForProject(projectId)
  console.log(`  ${submittals.length} submittal rows`)

  // Group submittals by canonical FOW name; track which already have fowEntityId
  const groups = new Map() // canonical → { displayName, submittals: [{id, payload, currentFowId}] }
  let skippedNoFow = 0
  let alreadyLinked = 0

  for (const row of submittals) {
    const payload = row.item_payload ?? {}
    const raw = payload.relatedFOW
    if (!raw || !String(raw).trim()) { skippedNoFow++; continue }

    const canonical = normalizeFowName(raw)
    const displayName = String(raw).trim()

    const existing = groups.get(canonical)
    if (existing) {
      existing.submittals.push({ id: row.id, payload, currentFowId: payload.fowEntityId ?? null })
    } else {
      groups.set(canonical, {
        displayName,
        submittals: [{ id: row.id, payload, currentFowId: payload.fowEntityId ?? null }],
      })
    }
  }

  console.log(`  ${skippedNoFow} submittals have no relatedFOW (skipped)`)
  console.log(`  ${groups.size} unique FOW names`)

  // Fetch existing FOW entities for this project
  const existingFows = await getExistingFowEntities(projectId)

  let fowsCreated = 0
  let submittalsUpdated = 0

  for (const [canonical, group] of groups.entries()) {
    let fowId = existingFows.get(canonical)?.id

    if (!fowId) {
      // Insert FOW entity
      if (dryRun) {
        console.log(`  [dry-run] would create FOW: "${group.displayName}"`)
        continue
      }
      const { data: inserted, error } = await supabase
        .from('project_entities')
        .insert({
          project_id: projectId,
          entity_type: 'feature_of_work',
          discipline: 'general',
          canonical_name: canonical,
          display_name: group.displayName,
          status: 'planned',
          extraction_source: 'backfill_from_submittal_string_field',
        })
        .select('id')
        .single()
      if (error) {
        console.error(`  ✗ Failed to create FOW "${group.displayName}": ${error.message}`)
        continue
      }
      fowId = inserted.id
      fowsCreated++
    }

    // Link submittals — only update those not already linked or linked to a different FOW
    for (const s of group.submittals) {
      if (s.currentFowId === fowId) { alreadyLinked++; continue }
      if (dryRun) {
        console.log(`  [dry-run] would link submittal ${s.id} → FOW ${fowId}`)
        continue
      }
      const updatedPayload = { ...s.payload, fowEntityId: fowId }
      const { error } = await supabase
        .from('submittal_register_items')
        .update({ item_payload: updatedPayload })
        .eq('id', s.id)
      if (error) {
        console.error(`  ✗ Failed to link submittal ${s.id}: ${error.message}`)
        continue
      }
      submittalsUpdated++
    }
  }

  console.log(`  ✓ ${fowsCreated} FOW entities created`)
  console.log(`  ✓ ${submittalsUpdated} submittals linked`)
  console.log(`  • ${alreadyLinked} submittals already linked (skipped)`)
}

async function main() {
  console.log(`FOW backfill — ${dryRun ? 'DRY RUN' : 'LIVE'}`)
  if (projectFilter) console.log(`Project filter: ${projectFilter}`)

  const projects = await getProjects()
  console.log(`Processing ${projects.length} project(s)`)

  for (const p of projects) {
    try {
      await processProject(p.id)
    } catch (err) {
      console.error(`✗ Project ${p.id} failed: ${err.message}`)
    }
  }

  console.log('\nDone.')
}

main().catch(err => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
