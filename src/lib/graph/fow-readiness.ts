/**
 * FOW readiness — pure logic + thin Supabase wrappers.
 *
 * Phase 8A revision: model after pebs-app DFOWs.
 *
 * FOW carries `specSections: string[]` (in project_entities.metadata).
 * A submittal belongs to a FOW if its specSection is in that FOW's specSections.
 * No fowEntityId on submittal — relationship is fully derived.
 */

import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FowReviewStatus = 'needs_review' | 'active' | 'approved'

export interface FowEntity {
  id: string
  projectId: string
  canonicalName: string
  displayName: string
  discipline: string
  status: FowReviewStatus
  sequence: number
  specSections: string[]
  trade: string | null
  subcontractor: string | null
}

export interface FowReadiness {
  fow: FowEntity
  requiredSubmittals: SubmittalRegisterItem[]
  approvedCount: number
  pendingCount: number
  blockedCount: number
  totalCount: number
  readinessPercent: number
  blockers: SubmittalRegisterItem[]
}

// ---------------------------------------------------------------------------
// Status classification (submittal lifecycle, not FOW status)
// ---------------------------------------------------------------------------

const APPROVED_STATUSES = new Set(['approved', 'approved_as_noted', 'closed'])
const BLOCKED_STATUSES = new Set(['revise_resubmit', 'rejected'])

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
// Spec section normalization
// ---------------------------------------------------------------------------

/** Strip non-digits, cap at 6, left-pad to 6. Matches reconciliation's logic. */
export function normalizeSpecSectionForFow(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0')
}

/** Returns the CSI division (first 2 digits) of a normalized spec section. */
export function getCsiDivision(s: string | null | undefined): string {
  const normalized = normalizeSpecSectionForFow(s)
  if (normalized.length < 2) return ''
  return normalized.slice(0, 2)
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
 * Group submittals into FOWs by spec section membership.
 * A submittal belongs to every FOW whose specSections array contains its
 * normalized spec section. The same submittal can appear in multiple FOWs
 * (e.g. "Concrete" and "Slab on Grade — Bldg 2" may overlap).
 */
export function groupSubmittalsByFowSpecSections(
  fows: FowEntity[],
  submittals: SubmittalRegisterItem[]
): Map<string, SubmittalRegisterItem[]> {
  const out = new Map<string, SubmittalRegisterItem[]>()
  for (const fow of fows) out.set(fow.id, [])

  // Pre-normalize FOW spec sections into Sets for O(1) lookup
  const fowSections = new Map<string, Set<string>>()
  for (const fow of fows) {
    fowSections.set(
      fow.id,
      new Set(fow.specSections.map(s => normalizeSpecSectionForFow(s)).filter(Boolean))
    )
  }

  for (const s of submittals) {
    const normalized = normalizeSpecSectionForFow(s.specSection)
    if (!normalized) continue
    for (const fow of fows) {
      if (fowSections.get(fow.id)?.has(normalized)) {
        out.get(fow.id)!.push(s)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

export function normalizeFowName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

// ---------------------------------------------------------------------------
// CSI division → FOW suggestion
// ---------------------------------------------------------------------------

const CSI_DIVISION_NAMES: Record<string, { name: string; trade: string }> = {
  '01': { name: 'General Requirements', trade: 'General' },
  '02': { name: 'Existing Conditions', trade: 'Demolition' },
  '03': { name: 'Concrete', trade: 'Concrete' },
  '04': { name: 'Masonry', trade: 'Masonry' },
  '05': { name: 'Metals', trade: 'Steel' },
  '06': { name: 'Wood, Plastics, and Composites', trade: 'Carpentry' },
  '07': { name: 'Thermal and Moisture Protection', trade: 'Roofing/Waterproofing' },
  '08': { name: 'Openings', trade: 'Doors/Windows' },
  '09': { name: 'Finishes', trade: 'Finishes' },
  '10': { name: 'Specialties', trade: 'Specialties' },
  '11': { name: 'Equipment', trade: 'Equipment' },
  '12': { name: 'Furnishings', trade: 'Furnishings' },
  '13': { name: 'Special Construction', trade: 'Special Construction' },
  '14': { name: 'Conveying Equipment', trade: 'Conveying' },
  '21': { name: 'Fire Suppression', trade: 'Fire Protection' },
  '22': { name: 'Plumbing', trade: 'Plumbing' },
  '23': { name: 'HVAC', trade: 'Mechanical' },
  '25': { name: 'Integrated Automation', trade: 'Controls' },
  '26': { name: 'Electrical', trade: 'Electrical' },
  '27': { name: 'Communications', trade: 'Low Voltage' },
  '28': { name: 'Electronic Safety and Security', trade: 'Security' },
  '31': { name: 'Earthwork', trade: 'Earthwork' },
  '32': { name: 'Exterior Improvements', trade: 'Site' },
  '33': { name: 'Utilities', trade: 'Utilities' },
  '34': { name: 'Transportation', trade: 'Civil' },
  '35': { name: 'Waterway and Marine Construction', trade: 'Marine' },
  '40': { name: 'Process Integration', trade: 'Process' },
  '41': { name: 'Material Processing and Handling', trade: 'Process' },
  '42': { name: 'Process Heating/Cooling', trade: 'Process' },
  '43': { name: 'Process Gas/Liquid Handling', trade: 'Process' },
  '44': { name: 'Pollution and Waste Control', trade: 'Environmental' },
  '45': { name: 'Industry-Specific Manufacturing', trade: 'Industrial' },
  '46': { name: 'Water and Wastewater', trade: 'Utilities' },
  '48': { name: 'Electrical Power Generation', trade: 'Electrical' },
}

export function csiDivisionName(division: string): { name: string; trade: string } {
  return CSI_DIVISION_NAMES[division] ?? { name: `Division ${division}`, trade: 'Other' }
}

/**
 * Given a set of submittals, group their spec sections by CSI division and
 * produce a suggested FOW per division. Pure.
 */
export function suggestFowsFromSubmittals(
  submittals: SubmittalRegisterItem[]
): Array<{ name: string; trade: string; specSections: string[]; division: string }> {
  const sectionsByDiv = new Map<string, Set<string>>()
  for (const s of submittals) {
    if (!s.specSection) continue
    const div = getCsiDivision(s.specSection)
    if (!div) continue
    const set = sectionsByDiv.get(div) ?? new Set()
    set.add(s.specSection.trim())
    sectionsByDiv.set(div, set)
  }

  return Array.from(sectionsByDiv.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([division, sections]) => {
      const meta = csiDivisionName(division)
      return {
        name: meta.name,
        trade: meta.trade,
        specSections: Array.from(sections).sort(),
        division,
      }
    })
}
