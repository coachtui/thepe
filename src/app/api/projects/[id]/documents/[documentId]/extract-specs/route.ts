/**
 * POST /api/projects/[id]/documents/[documentId]/extract-specs
 *
 * Manually trigger spec extraction for a single document. Sends the
 * `spec/document.extract` Inngest event. The function runs durably outside
 * the request lifecycle.
 *
 * This is the only path today that fires the event — auto-trigger on
 * upload is intentionally NOT wired (deferred). Use this endpoint to:
 *   - Backfill specs uploaded before A3 was available.
 *   - Re-run extraction after a prompt change. The Inngest function +
 *     persistence layer are idempotent — each run deletes existing
 *     `discipline='spec'` entities for the document and re-inserts.
 *
 * Auth: project member (any role).
 * Validation: document belongs to the project, has `document_type='spec'`,
 * and has finished text processing (`processing_status='completed'`).
 *
 * Inngest event id is `spec-extract-${documentId}` so duplicate triggers
 * within Inngest's dedup window queue only one job — same pattern as the
 * vision pipeline's `triggerVisionWithInngest()`.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
import { inngest } from '@/inngest/client'

export async function POST(
  _request: Request,
  { params }: { params: { id: string; documentId: string } }
) {
  const projectId = params.id
  const documentId = params.documentId

  // ── Auth ─────────────────────────────────────────────────────────────────
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

  // ── Document validation ──────────────────────────────────────────────────
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, project_id, document_type, processing_status, filename')
    .eq('id', documentId)
    .maybeSingle()

  if (docError) {
    console.error('[ExtractSpecs] Document lookup error:', docError)
    return NextResponse.json(
      { error: 'Failed to look up document' },
      { status: 500 }
    )
  }
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  if (doc.project_id !== projectId) {
    return NextResponse.json(
      { error: 'Document does not belong to this project' },
      { status: 403 }
    )
  }
  if (doc.document_type !== 'spec') {
    return NextResponse.json(
      {
        error: `Spec extraction requires document_type='spec'; this document is ${doc.document_type ?? 'null'}.`,
      },
      { status: 400 }
    )
  }
  if (doc.processing_status !== 'completed') {
    return NextResponse.json(
      {
        error: `Document text processing is not complete (status='${doc.processing_status ?? 'null'}'). Wait for parsing to finish before extracting specs.`,
      },
      { status: 409 }
    )
  }

  // ── Send Inngest event ───────────────────────────────────────────────────
  try {
    const eventResult = await inngest.send({
      // Dedupe key: same document within Inngest's dedup window queues only
      // one job. Mirrors `triggerVisionWithInngest()`.
      id: `spec-extract-${documentId}`,
      name: 'spec/document.extract',
      data: {
        projectId,
        documentId,
        trigger: 'manual-extract-specs-endpoint',
      },
    })

    return NextResponse.json({
      success: true,
      accepted: true,
      eventId: eventResult.ids[0] ?? null,
      documentId,
      projectId,
      filename: doc.filename,
    })
  } catch (err) {
    console.error('[ExtractSpecs] Failed to enqueue event:', err)
    return NextResponse.json(
      {
        error: 'Failed to enqueue spec extraction',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    )
  }
}
