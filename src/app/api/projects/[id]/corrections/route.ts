/**
 * POST /api/projects/[id]/corrections
 *
 * Capture a user correction to an AI answer.
 *
 * Auth: project member with role 'owner' or 'editor'.
 *
 * Auto-accept logic:
 *   - submitted_by_role weight >= 2.0 (PE=3.0, superintendent=2.0, admin=2.5):
 *     correction is immediately accepted and a linked project_memory_items row
 *     is written with validation_status='accepted'.
 *   - Otherwise: correction stays 'pending' until confirmed by another user.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { createServiceRoleClient } from '@/lib/db/supabase/service'

// Trust weights — matches plans/phase7-project-memory-architecture.md
const ROLE_WEIGHTS: Record<string, number> = {
  PE: 3.0,
  admin: 2.5,
  superintendent: 2.0,
  engineer: 1.0,
  foreman: 1.0,
}

const HIGH_TRUST_THRESHOLD = 2.0

function getRoleWeight(role: string): number {
  return ROLE_WEIGHTS[role] ?? 0.5
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id

  // ── Auth ─────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['owner', 'editor'].includes(membership.role ?? '')) {
    return NextResponse.json(
      { error: 'Only project owners and editors can submit corrections' },
      { status: 403 }
    )
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    query_text,
    query_answer_mode,
    sheet_number,
    discipline,
    system_queried,
    expected_item,
    missed_item_type,
    how_it_appeared,
    ai_response_excerpt,
    ai_detected_value,
    ai_confidence,
    expected_value,
    submitted_by_role,
    evidence_reference,
    notes,
  } = body as {
    query_text?: string
    query_answer_mode?: string
    sheet_number?: string
    discipline?: string
    system_queried?: string
    expected_item?: string
    missed_item_type?: string
    how_it_appeared?: string
    ai_response_excerpt?: string
    ai_detected_value?: string
    ai_confidence?: number
    expected_value?: string
    submitted_by_role?: string
    evidence_reference?: string
    notes?: string
  }

  if (!query_text || !expected_value || !submitted_by_role) {
    return NextResponse.json(
      { error: 'query_text, expected_value, and submitted_by_role are required' },
      { status: 400 }
    )
  }

  const VALID_ROLES = Object.keys(ROLE_WEIGHTS)
  if (!VALID_ROLES.includes(submitted_by_role)) {
    return NextResponse.json(
      { error: `Invalid submitted_by_role. Must be one of: ${VALID_ROLES.join(', ')}` },
      { status: 400 }
    )
  }

  const validHowItAppeared = [
    'text', 'symbol', 'detail', 'legend', 'note',
    'profile', 'schedule', 'plan_view', 'unknown',
  ]
  if (how_it_appeared && !validHowItAppeared.includes(how_it_appeared)) {
    return NextResponse.json({ error: 'Invalid how_it_appeared value' }, { status: 400 })
  }

  // ── Write with service role ───────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceRoleClient() as any
  const roleWeight = getRoleWeight(submitted_by_role)
  const isHighTrust = roleWeight >= HIGH_TRUST_THRESHOLD

  // Determine initial validation status
  const correctionStatus = isHighTrust ? 'accepted' : 'pending'

  // 1. Write correction row
  const { data: correction, error: corrErr } = await svc
    .from('project_corrections')
    .insert({
      project_id: projectId,
      query_text,
      query_answer_mode: query_answer_mode ?? null,
      sheet_number: sheet_number ?? null,
      discipline: discipline ?? null,
      system_queried: system_queried ?? null,
      expected_item: expected_item ?? null,
      missed_item_type: missed_item_type ?? null,
      how_it_appeared: how_it_appeared ?? null,
      ai_response_excerpt: ai_response_excerpt ?? null,
      ai_detected_value: ai_detected_value ?? null,
      ai_confidence: ai_confidence ?? null,
      expected_value,
      submitted_by_user_id: user.id,
      submitted_by_name: user.email ?? null,
      submitted_by_role,
      source_type: 'user_correction',
      evidence_reference: evidence_reference ?? null,
      notes: notes ?? null,
      validation_status: correctionStatus,
    })
    .select('id')
    .single()

  if (corrErr || !correction) {
    console.error('[Corrections] Insert error:', corrErr)
    return NextResponse.json({ error: 'Failed to save correction' }, { status: 500 })
  }

  // 2. High-trust: also write accepted memory item
  let memoryItemId: string | null = null

  if (isHighTrust) {
    const { data: memItem, error: memErr } = await svc
      .from('project_memory_items')
      .insert({
        project_id: projectId,
        item_type: 'correction',
        discipline: discipline ?? null,
        system_context: system_queried ?? null,
        sheet_numbers: sheet_number ? [sheet_number] : null,
        original_text: ai_detected_value ?? null,
        normalized_value: expected_value,
        submitted_by_user_id: user.id,
        submitted_by_name: user.email ?? null,
        submitted_by_role,
        source_type: 'user_correction',
        evidence_reference: evidence_reference ?? null,
        notes: notes ?? null,
        validation_status: 'accepted',
        confirmed_by_count: 1,
      })
      .select('id')
      .single()

    if (memErr) {
      console.error('[Corrections] Memory item insert error:', memErr)
      // Non-fatal — correction row was saved; memory item is a bonus
    } else if (memItem) {
      memoryItemId = memItem.id

      // Link correction → memory item
      const { error: linkErr } = await svc
        .from('project_corrections')
        .update({ memory_item_id: memoryItemId })
        .eq('id', correction.id)
      if (linkErr) {
        console.error('[Corrections] Failed to link correction to memory item:', linkErr)
      }
    }
  }

  return NextResponse.json({
    success: true,
    correctionId: correction.id,
    memoryItemId,
    autoAccepted: isHighTrust,
    validationStatus: correctionStatus,
  })
}
