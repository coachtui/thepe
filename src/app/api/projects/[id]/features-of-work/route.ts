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

  return NextResponse.json({
    features: ranked,
    totals: {
      fowCount: fows.length,
      submittalsLinked: submittals.filter(s => s.fowEntityId).length,
      submittalsUnlinked: submittals.filter(s => !s.fowEntityId).length,
    },
  })
}
