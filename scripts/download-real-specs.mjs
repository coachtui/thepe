#!/usr/bin/env node
/**
 * Downloads up to 5 real spec PDFs from Supabase storage for harness testing.
 * Writes files to test-fixtures/real-specs/.
 *
 * Usage: node --no-warnings scripts/download-real-specs.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run with dotenv or export from .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
const OUT_DIR  = './test-fixtures/real-specs'
const LIMIT    = 5

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  // Query documents — prefer spec docs, pick PDFs, spread across projects
  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, project_id, file_name, storage_path, created_at, projects(name)')
    .order('created_at', { ascending: false })
    .limit(LIMIT * 4)  // over-fetch so we can pick diverse ones

  if (error) {
    console.error('DB query failed:', error.message)
    process.exit(1)
  }

  if (!docs?.length) {
    console.log('No documents found in database.')
    process.exit(0)
  }

  // Prefer docs with PDF extension; deduplicate by project; take up to LIMIT
  const seen = new Set()
  const selected = []
  for (const doc of docs) {
    if (!doc.storage_path) continue
    const isPdf = /\.pdf$/i.test(doc.file_name ?? doc.storage_path)
    if (!isPdf) continue
    if (seen.has(doc.project_id)) continue
    seen.add(doc.project_id)
    selected.push(doc)
    if (selected.length >= LIMIT) break
  }

  // If not enough cross-project PDFs, fill with any PDF
  if (selected.length < LIMIT) {
    for (const doc of docs) {
      if (!doc.storage_path) continue
      const isPdf = /\.pdf$/i.test(doc.file_name ?? doc.storage_path)
      if (!isPdf) continue
      if (selected.some(s => s.id === doc.id)) continue
      selected.push(doc)
      if (selected.length >= LIMIT) break
    }
  }

  if (!selected.length) {
    console.log('No PDF documents found in storage paths.')
    console.log('Available docs:', docs.slice(0, 5).map(d => d.file_name).join(', '))
    process.exit(0)
  }

  console.log(`\nDownloading ${selected.length} spec PDF(s) to ${OUT_DIR}/\n`)

  const manifest = []

  for (const doc of selected) {
    const projectName = doc.projects?.name ?? doc.project_id.slice(0, 8)
    const safeName = `${projectName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}_${doc.id.slice(0, 6)}.pdf`
    const outPath = path.join(OUT_DIR, safeName)

    process.stdout.write(`  ${safeName} (from "${projectName}") ... `)

    // Determine bucket — check storage_path prefix
    const storagePath = doc.storage_path
    // Common pattern: "bucket/path/file.pdf" or just "path/file.pdf"
    const bucket = storagePath.includes('/') && !storagePath.startsWith('project')
      ? storagePath.split('/')[0]
      : 'documents'
    const filePath = storagePath.startsWith(bucket + '/')
      ? storagePath.slice(bucket.length + 1)
      : storagePath

    const { data: blob, error: dlErr } = await supabase.storage
      .from(bucket)
      .download(filePath)

    if (dlErr || !blob) {
      // Try without bucket prefix stripping
      const { data: blob2, error: dlErr2 } = await supabase.storage
        .from('documents')
        .download(storagePath)

      if (dlErr2 || !blob2) {
        console.log(`FAILED — ${dlErr?.message ?? dlErr2?.message}`)
        continue
      }
      const buf = Buffer.from(await blob2.arrayBuffer())
      await writeFile(outPath, buf)
    } else {
      const buf = Buffer.from(await blob.arrayBuffer())
      await writeFile(outPath, buf)
    }

    console.log(`OK (${Math.round(require('fs').statSync(outPath).size / 1024)}KB)`)
    manifest.push({ localFile: safeName, projectName, documentId: doc.id, storagePath })
  }

  console.log('\nManifest:')
  for (const m of manifest) {
    console.log(`  ${m.localFile}  ←  project "${m.projectName}"  doc ${m.documentId}`)
  }

  console.log(`\nNow run:\n  npm run ingestion:harness -- --dir ${OUT_DIR}\n`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
