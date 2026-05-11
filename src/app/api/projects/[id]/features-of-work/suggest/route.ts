/**
 * POST /api/projects/[id]/features-of-work/suggest
 *
 * Auto-generates draft FOWs by grouping the project's submittal spec
 * sections by CSI division. Each suggestion is created with
 * status='needs_review' and extraction_source='inferred_from_csi_division'.
 *
 * Idempotent: skips creation of any FOW whose canonical name already exists
 * for the project, but appends new spec sections into its existing list.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'
import { loadLatestSubmittalRegisterRun } from '@/lib/chat/submittal-register-read'
import {
  suggestFowsFromSubmittals,
  normalizeFowName,
} from '@/lib/graph/fow-readiness'

interface FowMetadata {
  specSections?: string[]
  trade?: string | null
  subcontractor?: string | null
  sequence?: number
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('project_members').select('role').eq('project_id', projectId).eq('user_id', user.id).single()
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const svc = createServiceRoleClient()

  // Load submittals
  const runOutcome = await loadLatestSubmittalRegisterRun(svc, projectId)
  if (runOutcome.status === 'error') {
    return NextResponse.json({ error: runOutcome.error }, { status: 500 })
  }
  const submittals = runOutcome.status === 'found' ? runOutcome.run.items : []
  if (submittals.length === 0) {
    return NextResponse.json({ created: 0, updated: 0, suggestions: [] })
  }

  const suggestions = suggestFowsFromSubmittals(submittals)

  // Fetch any existing FOWs to compare canonical names
  const { data: existingRows } = await svc
    .from('project_entities')
    .select('id, canonical_name, metadata')
    .eq('project_id', projectId)
    .eq('entity_type', 'feature_of_work')

  const existingByCanonical = new Map(
    (existingRows ?? []).map(r => [r.canonical_name, r])
  )

  let created = 0
  let updated = 0
  let sequence = (existingRows ?? []).reduce((max, r) => {
    const meta = (r.metadata ?? {}) as FowMetadata
    return Math.max(max, meta.sequence ?? 0)
  }, 0)

  for (const sug of suggestions) {
    const canonical = normalizeFowName(sug.name)
    const existing = existingByCanonical.get(canonical)

    if (existing) {
      // Merge new spec sections into existing FOW
      const meta = (existing.metadata ?? {}) as FowMetadata
      const merged = Array.from(new Set([...(meta.specSections ?? []), ...sug.specSections]))
      if (merged.length === (meta.specSections ?? []).length) continue
      const newMeta: FowMetadata = { ...meta, specSections: merged }
      await svc
        .from('project_entities')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ metadata: newMeta as any })
        .eq('id', existing.id)
      updated++
    } else {
      sequence++
      const meta: FowMetadata = {
        specSections: sug.specSections,
        trade: sug.trade,
        subcontractor: null,
        sequence,
      }
      const { error } = await svc.from('project_entities').insert({
        project_id: projectId,
        entity_type: 'feature_of_work',
        discipline: 'general',
        canonical_name: canonical,
        display_name: sug.name,
        status: 'needs_review',
        extraction_source: 'inferred_from_csi_division',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: meta as any,
      })
      if (!error) created++
    }
  }

  return NextResponse.json({ created, updated, suggestions: suggestions.length })
}
