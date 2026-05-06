/**
 * GET /api/projects/[id]/submittal-register/latest
 *
 * Returns the latest *completed* submittal_register workflow run for the
 * project, with its persisted items reconstructed into the same grouped
 * review shape produced by the live tool path.
 *
 * Auth: any project member.
 * Read path: service-role (matches the persistence helper pattern for
 * project-scoped workflow data).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'
import { loadLatestSubmittalRegisterRun } from '@/lib/chat/submittal-register-read'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let svc: ReturnType<typeof createServiceRoleClient>
  try {
    svc = createServiceRoleClient()
  } catch (err) {
    console.error('[SubmittalRegisterLatest] Service-role client unavailable:', err)
    return NextResponse.json(
      { error: 'Service-role client unavailable' },
      { status: 500 }
    )
  }

  const outcome = await loadLatestSubmittalRegisterRun(svc, projectId)

  if (outcome.status === 'error') {
    console.error('[SubmittalRegisterLatest] Read error:', outcome.error)
    return NextResponse.json(
      { error: 'Failed to load latest submittal register run', detail: outcome.error },
      { status: 500 }
    )
  }

  if (outcome.status === 'not_found') {
    return NextResponse.json(
      { success: true, found: false, run: null },
      { status: 200 }
    )
  }

  return NextResponse.json({ success: true, found: true, run: outcome.run })
}
