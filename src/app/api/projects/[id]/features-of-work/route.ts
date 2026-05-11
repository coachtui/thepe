/**
 * GET /api/projects/[id]/features-of-work
 *
 * Returns every FOW for the project plus its readiness state — required
 * submittals, blocker counts, and readiness percentage. Sorted worst-first.
 *
 * FOWs live in `project_entities` with `entity_type='feature_of_work'`.
 * Submittals link via `item_payload.fowEntityId`.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'
import { loadLatestSubmittalRegisterRun } from '@/lib/chat/submittal-register-read'
import {
  computeFowReadiness,
  rankFowByReadiness,
  groupSubmittalsByFowEntity,
  normalizeFowName,
  type FowEntity,
} from '@/lib/graph/fow-readiness'

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

  // Load FOW entities
  const { data: fowRows, error: fowErr } = await svc
    .from('project_entities')
    .select('id, project_id, canonical_name, display_name, discipline, status')
    .eq('project_id', projectId)
    .eq('entity_type', 'feature_of_work')

  if (fowErr) return NextResponse.json({ error: fowErr.message }, { status: 500 })

  const fows: FowEntity[] = (fowRows ?? []).map(r => ({
    id: r.id,
    projectId: r.project_id,
    canonicalName: r.canonical_name,
    displayName: r.display_name ?? r.canonical_name,
    discipline: r.discipline,
    status: r.status,
  }))

  // Load latest submittal register
  const runOutcome = await loadLatestSubmittalRegisterRun(svc, projectId)
  if (runOutcome.status === 'error') {
    return NextResponse.json({ error: runOutcome.error }, { status: 500 })
  }
  const submittals = runOutcome.status === 'found' ? runOutcome.run.items : []

  // Group + compute
  const grouped = groupSubmittalsByFowEntity(fows, submittals)
  const readinesses = fows.map(fow => computeFowReadiness(fow, grouped.get(fow.id) ?? []))
  const ranked = rankFowByReadiness(readinesses)

  // Slim submittal payload for the picker modal — full SubmittalRegisterItem is too heavy
  const allSubmittals = submittals.map(s => ({
    id: s.persistedItemId ?? '',
    title: s.submittalItem,
    specSection: s.specSection ?? null,
    lifecycleStatus: s.lifecycleStatus ?? 'draft',
    fowEntityId: s.fowEntityId ?? null,
  })).filter(s => s.id)

  return NextResponse.json({
    features: ranked,
    totals: {
      fowCount: fows.length,
      submittalsLinked: submittals.filter(s => s.fowEntityId).length,
      submittalsUnlinked: submittals.filter(s => !s.fowEntityId).length,
    },
    allSubmittals,
  })
}

/**
 * POST /api/projects/[id]/features-of-work
 * Body: { name: string, discipline?: string }
 * Creates (or returns existing) FOW entity for the project.
 */
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

  let body: { name?: string; discipline?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const discipline = typeof body.discipline === 'string' ? body.discipline : 'general'
  const canonicalName = normalizeFowName(name)

  const svc = createServiceRoleClient()

  // Idempotent: return existing FOW with this canonical name if present
  const { data: existing } = await svc
    .from('project_entities')
    .select('id, project_id, canonical_name, display_name, discipline, status')
    .eq('project_id', projectId)
    .eq('entity_type', 'feature_of_work')
    .eq('canonical_name', canonicalName)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ fow: existing, created: false })
  }

  const { data: inserted, error } = await svc
    .from('project_entities')
    .insert({
      project_id: projectId,
      entity_type: 'feature_of_work',
      discipline,
      canonical_name: canonicalName,
      display_name: name,
      status: 'planned',
      extraction_source: 'user_created',
    })
    .select('id, project_id, canonical_name, display_name, discipline, status')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ fow: inserted, created: true }, { status: 201 })
}
