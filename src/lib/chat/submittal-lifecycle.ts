/**
 * submittal-lifecycle.ts
 *
 * Lifecycle status engine for submittal register items.
 * Centralises transitions, labels, colours, and timestamp helpers so every
 * layer (API route, UI, future schedule/FOW integration) uses the same rules.
 */

// ── Status type ───────────────────────────────────────────────────────────────

export type SubmittalLifecycleStatus =
  | 'draft'
  | 'pending_submission'
  | 'submitted'
  | 'pending_review'
  | 'approved'
  | 'approved_as_noted'
  | 'revise_resubmit'
  | 'rejected'
  | 'closed'

export const ALL_LIFECYCLE_STATUSES: SubmittalLifecycleStatus[] = [
  'draft',
  'pending_submission',
  'submitted',
  'pending_review',
  'approved',
  'approved_as_noted',
  'revise_resubmit',
  'rejected',
  'closed',
]

// ── History entry ─────────────────────────────────────────────────────────────

export interface LifecycleHistoryEntry {
  fromStatus: SubmittalLifecycleStatus | null
  toStatus: SubmittalLifecycleStatus
  changedAt: string   // ISO timestamp
  changedBy?: string
  note?: string
}

// ── Valid transitions ─────────────────────────────────────────────────────────
//
// Direction: from → allowed destinations
// Extending this map is the only change needed to add new transitions.

const TRANSITIONS: Record<SubmittalLifecycleStatus, SubmittalLifecycleStatus[]> = {
  draft:              ['pending_submission'],
  pending_submission: ['submitted', 'draft'],
  submitted:          ['pending_review'],
  pending_review:     ['approved', 'approved_as_noted', 'revise_resubmit', 'rejected'],
  approved:           ['closed'],
  approved_as_noted:  ['closed', 'revise_resubmit'],
  revise_resubmit:    ['submitted', 'draft'],
  rejected:           ['closed', 'draft'],
  closed:             [],
}

// ── Transition helpers ────────────────────────────────────────────────────────

export function canTransition(
  from: SubmittalLifecycleStatus,
  to: SubmittalLifecycleStatus
): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

export function getNextStatuses(
  from: SubmittalLifecycleStatus
): SubmittalLifecycleStatus[] {
  return TRANSITIONS[from] ?? []
}

export type TransitionResult =
  | { ok: true; entry: LifecycleHistoryEntry }
  | { ok: false; error: string }

export function buildTransition(
  from: SubmittalLifecycleStatus,
  to: SubmittalLifecycleStatus,
  changedBy?: string,
  note?: string
): TransitionResult {
  if (!canTransition(from, to)) {
    return {
      ok: false,
      error: `Invalid transition: ${from} → ${to}`,
    }
  }
  return {
    ok: true,
    entry: {
      fromStatus: from,
      toStatus: to,
      changedAt: new Date().toISOString(),
      changedBy,
      note,
    },
  }
}

// ── Timestamp fields updated on specific transitions ──────────────────────────

export function timestampFieldForStatus(
  status: SubmittalLifecycleStatus
): 'lifecycleSubmittedAt' | 'lifecycleApprovedAt' | 'lifecycleClosedAt' | null {
  if (status === 'submitted') return 'lifecycleSubmittedAt'
  if (status === 'approved' || status === 'approved_as_noted') return 'lifecycleApprovedAt'
  if (status === 'closed') return 'lifecycleClosedAt'
  return null
}

// ── Display helpers ───────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<SubmittalLifecycleStatus, string> = {
  draft:              'Draft',
  pending_submission: 'Pending Submission',
  submitted:          'Submitted',
  pending_review:     'Pending Review',
  approved:           'Approved',
  approved_as_noted:  'Approved as Noted',
  revise_resubmit:    'Revision Required',
  rejected:           'Rejected',
  closed:             'Closed',
}

// Tailwind classes — background + text (safe for both light and print)
export const STATUS_COLORS: Record<SubmittalLifecycleStatus, string> = {
  draft:              'bg-gray-100 text-gray-600',
  pending_submission: 'bg-sky-100 text-sky-800',
  submitted:          'bg-blue-100 text-blue-800',
  pending_review:     'bg-amber-100 text-amber-800',
  approved:           'bg-green-100 text-green-800',
  approved_as_noted:  'bg-emerald-100 text-emerald-800',
  revise_resubmit:    'bg-orange-100 text-orange-800',
  rejected:           'bg-red-100 text-red-800',
  closed:             'bg-gray-200 text-gray-500',
}

// ── Effective status (display logic) ─────────────────────────────────────────
//
// An artifact_suspected item surfaces as pending_review so it appears in
// operational queues even before an explicit lifecycle transition is made.

export function resolveEffectiveStatus(item: {
  lifecycleStatus?: SubmittalLifecycleStatus
  artifactReviewStatus?: string
}): SubmittalLifecycleStatus {
  if (item.artifactReviewStatus === 'artifact_suspected') return 'pending_review'
  return item.lifecycleStatus ?? 'draft'
}

// ── Due-date helpers ──────────────────────────────────────────────────────────

export function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

export function formatDueDate(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null
  return new Date(dueDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
