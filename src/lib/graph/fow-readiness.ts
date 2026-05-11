/**
 * FOW readiness — pure logic + thin Supabase wrappers.
 *
 * Phase 8A: promote `featureOfWork` from a loose string field on
 * `submittal_register_items.item_payload.relatedFOW` into a first-class
 * entity in the existing `project_entities` table (entity_type='feature_of_work').
 *
 * The submittal → FOW link is denormalized as
 * `submittal_register_items.item_payload.fowEntityId` (UUID).
 *
 * Pure functions (no DB) live in this module so the harness can test
 * them with fixtures.
 */

import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Trimmed view of a project_entities row representing a FOW. */
export interface FowEntity {
  id: string
  projectId: string
  canonicalName: string   // normalized for dedup/lookup
  displayName: string     // original-cased name for UI
  discipline: string      // 'general' for FOW; future inference may refine
  status: string | null   // 'planned' | 'active' | 'blocked' | 'complete' | null
}

export interface FowReadiness {
  fow: FowEntity
  requiredSubmittals: SubmittalRegisterItem[]
  approvedCount: number
  pendingCount: number
  blockedCount: number
  totalCount: number
  readinessPercent: number  // 0-100, integer
  blockers: SubmittalRegisterItem[]
}

// ---------------------------------------------------------------------------
// Status classification
// ---------------------------------------------------------------------------

const APPROVED_STATUSES = new Set(['approved', 'approved_as_noted', 'closed'])
const BLOCKED_STATUSES = new Set(['revise_resubmit', 'rejected'])
// Everything else (draft, pending_submission, submitted, pending_review) → pending.

function getLifecycleStatus(item: SubmittalRegisterItem): string {
  return item.lifecycleStatus ?? 'draft'
}

function isApproved(item: SubmittalRegisterItem): boolean {
  return APPROVED_STATUSES.has(getLifecycleStatus(item))
}

function isBlocked(item: SubmittalRegisterItem): boolean {
  return BLOCKED_STATUSES.has(getLifecycleStatus(item))
}

// ---------------------------------------------------------------------------
// Pure computation
// ---------------------------------------------------------------------------

export function computeFowReadiness(
  fow: FowEntity,
  requiredSubmittals: SubmittalRegisterItem[]
): FowReadiness {
  const approved = requiredSubmittals.filter(isApproved)
  const blocked = requiredSubmittals.filter(isBlocked)
  const total = requiredSubmittals.length
  const pending = total - approved.length - blocked.length

  const readinessPercent = total === 0 ? 100 : Math.round((approved.length / total) * 100)

  return {
    fow,
    requiredSubmittals,
    approvedCount: approved.length,
    pendingCount: pending,
    blockedCount: blocked.length,
    totalCount: total,
    readinessPercent,
    blockers: [...blocked, ...requiredSubmittals.filter(i => !isApproved(i) && !isBlocked(i))],
  }
}

export function rankFowByReadiness(results: FowReadiness[]): FowReadiness[] {
  return [...results].sort((a, b) => {
    if (a.readinessPercent !== b.readinessPercent) {
      return a.readinessPercent - b.readinessPercent
    }
    return b.blockers.length - a.blockers.length
  })
}

/**
 * Group submittals by their fowEntityId (read from item_payload).
 * Pure — no DB.
 */
export function groupSubmittalsByFowEntity(
  fows: FowEntity[],
  submittals: SubmittalRegisterItem[]
): Map<string, SubmittalRegisterItem[]> {
  const out = new Map<string, SubmittalRegisterItem[]>()
  for (const fow of fows) out.set(fow.id, [])
  for (const s of submittals) {
    const fowId = s.fowEntityId
    if (!fowId) continue
    const list = out.get(fowId)
    if (list) list.push(s)
  }
  return out
}

// ---------------------------------------------------------------------------
// Backfill helpers — pure
// ---------------------------------------------------------------------------

/** Normalize a FOW string for dedup (whitespace + case). */
export function normalizeFowName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Extract unique FOW entities from a set of submittals.
 * Used by backfill to figure out which FOW rows to insert.
 */
export function extractUniqueFowsFromSubmittals(
  submittals: SubmittalRegisterItem[]
): Array<{ canonicalName: string; displayName: string; submittalIds: string[] }> {
  const map = new Map<string, { displayName: string; submittalIds: string[] }>()
  for (const s of submittals) {
    if (!s.relatedFOW || !s.persistedItemId) continue
    const raw = s.relatedFOW.trim()
    if (!raw) continue
    const canonical = normalizeFowName(raw)
    const entry = map.get(canonical)
    if (entry) {
      entry.submittalIds.push(s.persistedItemId)
    } else {
      map.set(canonical, { displayName: raw, submittalIds: [s.persistedItemId] })
    }
  }
  return Array.from(map.entries()).map(([canonicalName, v]) => ({ canonicalName, ...v }))
}
