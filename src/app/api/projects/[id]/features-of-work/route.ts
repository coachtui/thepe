/**
 * GET  /api/projects/[id]/features-of-work
 *   Returns every FOW for the project plus its readiness state. Sorted worst-first.
 *
 * POST /api/projects/[id]/features-of-work
 *   Body: { name, specSections?, trade?, subcontractor?, sequence?, status? }
 *   Creates (or returns existing by canonical name) a FOW entity.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'
import { loadLatestSubmittalRegisterRun } from '@/lib/chat/submittal-register-read'
import {
  computeFowReadiness,
  rankFowByReadiness,
  groupSubmittalsByFowSpecSections,
  normalizeFowName,
  type FowEntity,
  type FowReviewStatus,
} from '@/lib/graph/fow-readiness'

interface FowMetadata {
  specSections?: string[]
  trade?: string | null
  subcontractor?: string | null
  sequence?: number
}

function rowToFowEntity(row: {
  id: string
  project_id: string
  canonical_name: string
  display_name: string | null
  discipline: string
  status: string | null
  metadata: unknown
}): FowEntity {
  const meta = (row.metadata ?? {}) as FowMetadata
  const status = (row.status as FowReviewStatus) ?? 'active'
  return {
    id: row.id,
    projectId: row.project_id,
    canonicalName: row.canonical_name,
    displayName: row.display_name ?? row.canonical_name,
    discipline: row.discipline,
    status,
    sequence: typeof meta.sequence === 'number' ? meta.sequence : 0,
    specSections: Array.isArray(meta.specSections) ? meta.specSections : [],
    trade: meta.trade ?? null,
    subcontractor: meta.subcontractor ?? null,
  }
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const svc = createServiceRoleClient()

  const { data: fowRows, error: fowErr } = await svc
    .from('project_entities')
    .select('id, project_id, canonical_name, display_name, discipline, status, metadata')
    .eq('project_id', projectId)
    .eq('entity_type', 'feature_of_work')

  if (fowErr) return NextResponse.json({ error: fowErr.message }, { status: 500 })

  const fows: FowEntity[] = (fowRows ?? []).map(rowToFowEntity)

  const runOutcome = await loadLatestSubmittalRegisterRun(svc, projectId)
  if (runOutcome.status === 'error') {
    return NextResponse.json({ error: runOutcome.error }, { status: 500 })
  }
  const submittals = runOutcome.status === 'found' ? runOutcome.run.items : []

  const grouped = groupSubmittalsByFowSpecSections(fows, submittals)
  const readinesses = fows.map(fow => computeFowReadiness(fow, grouped.get(fow.id) ?? []))
  const ranked = rankFowByReadiness(readinesses)

  // Count submittals linked to ≥1 FOW
  const linkedSubmittalIds = new Set<string>()
  for (const list of grouped.values()) {
    for (const s of list) if (s.persistedItemId) linkedSubmittalIds.add(s.persistedItemId)
  }

  return NextResponse.json({
    features: ranked,
    totals: {
      fowCount: fows.length,
      submittalsLinked: linkedSubmittalIds.size,
      submittalsUnlinked: submittals.filter(s => s.persistedItemId && !linkedSubmittalIds.has(s.persistedItemId)).length,
    },
  })
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: {
    name?: string
    specSections?: string[]
    trade?: string | null
    subcontractor?: string | null
    sequence?: number
    status?: FowReviewStatus
    discipline?: string
  }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const canonicalName = normalizeFowName(name)
  const discipline = typeof body.discipline === 'string' ? body.discipline : 'general'
  const status: FowReviewStatus = body.status ?? 'active'

  const svc = createServiceRoleClient()

  // Idempotent on canonical name
  const { data: existing } = await svc
    .from('project_entities')
    .select('id, project_id, canonical_name, display_name, discipline, status, metadata')
    .eq('project_id', projectId)
    .eq('entity_type', 'feature_of_work')
    .eq('canonical_name', canonicalName)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ fow: rowToFowEntity(existing), created: false })
  }

  const metadata: FowMetadata = {
    specSections: Array.isArray(body.specSections) ? body.specSections : [],
    trade: body.trade ?? null,
    subcontractor: body.subcontractor ?? null,
    sequence: typeof body.sequence === 'number' ? body.sequence : 0,
  }

  const { data: inserted, error } = await svc
    .from('project_entities')
    .insert({
      project_id: projectId,
      entity_type: 'feature_of_work',
      discipline,
      canonical_name: canonicalName,
      display_name: name,
      status,
      extraction_source: 'user_created',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: metadata as any,
    })
    .select('id, project_id, canonical_name, display_name, discipline, status, metadata')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ fow: rowToFowEntity(inserted), created: true }, { status: 201 })
}
