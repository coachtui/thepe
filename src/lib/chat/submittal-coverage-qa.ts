import type { SubmittalRegisterItem } from './submittal-register'

export type QASeverity = 'info' | 'warning' | 'critical'

export type QAFindingType =
  | 'missing_sd_code'
  | 'missing_approval_authority'
  | 'blocking_risk_no_due_date'
  | 'blocking_risk_missing_work_linkage'
  | 'missing_source_excerpt'
  | 'duplicate_submittal'
  | 'spec_section_no_submittals'

export interface QAFinding {
  id: string
  severity: QASeverity
  type: QAFindingType
  message: string
  affectedItemIds: string[]
  suggestedAction: string
}

export type SpecSectionInput = string | { sectionNumber: string; title?: string }

export interface QAInput {
  items: SubmittalRegisterItem[]
  specSections?: SpecSectionInput[]
}

export interface QAResult {
  findings: QAFinding[]
  checkedAt: string
  totalItems: number
}

export function getSubmittalItemKey(item: SubmittalRegisterItem, index: number): string {
  return (
    item.persistedItemId ??
    item.dedupeKey ??
    `${item.submittalItem}|${item.specSection ?? ''}|${index}`
  )
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function evaluateSubmittalCoverageQA(input: QAInput): QAResult {
  const { items, specSections } = input
  const findings: QAFinding[] = []
  const checkedAt = new Date().toISOString()

  if (items.length === 0) {
    return { findings, checkedAt, totalItems: 0 }
  }

  const keys = items.map((item, i) => getSubmittalItemKey(item, i))

  // 1. Missing SD code
  const missingSdIds = keys.filter((_, i) => !items[i].sdCode)
  if (missingSdIds.length > 0) {
    findings.push({
      id: 'missing_sd_code',
      severity: 'warning',
      type: 'missing_sd_code',
      message: `${missingSdIds.length} item${missingSdIds.length === 1 ? '' : 's'} missing an SD code`,
      affectedItemIds: missingSdIds,
      suggestedAction: 'Re-run extraction with SD code detection enabled, or manually assign SD codes.',
    })
  }

  // 2. Missing approval authority
  const missingAuthIds = keys.filter((_, i) => !items[i].approvalAuthority)
  if (missingAuthIds.length > 0) {
    findings.push({
      id: 'missing_approval_authority',
      severity: 'warning',
      type: 'missing_approval_authority',
      message: `${missingAuthIds.length} item${missingAuthIds.length === 1 ? '' : 's'} missing approval authority`,
      affectedItemIds: missingAuthIds,
      suggestedAction:
        'Review spec language to determine if Government or Contracting Officer approval is required.',
    })
  }

  // 3. Blocking risk without due date — check both dueDate (future field) and lifecycleDueDate
  const blockingNoDueDateIds = keys.filter((_, i) => {
    const item = items[i] as SubmittalRegisterItem & { dueDate?: string | null }
    const isHighRisk = item.blockingRisk === 'high' || item.blockingRisk === 'medium'
    const dueDate = item.dueDate ?? item.lifecycleDueDate
    return isHighRisk && !dueDate
  })
  if (blockingNoDueDateIds.length > 0) {
    findings.push({
      id: 'blocking_risk_no_due_date',
      severity: 'critical',
      type: 'blocking_risk_no_due_date',
      message: `${blockingNoDueDateIds.length} high/medium-risk item${blockingNoDueDateIds.length === 1 ? '' : 's'} with no due date`,
      affectedItemIds: blockingNoDueDateIds,
      suggestedAction:
        'Assign due dates — these items may block downstream schedule activities.',
    })
  }

  // 4. Blocking risk without work linkage — high/medium items missing both relatedFOW and scheduleActivity.
  const missingWorkLinkageIds = keys.filter((_, i) => {
    const item = items[i]
    const isHighRisk = item.blockingRisk === 'high' || item.blockingRisk === 'medium'
    return isHighRisk && !item.relatedFOW && !item.scheduleActivity
  })
  if (missingWorkLinkageIds.length > 0) {
    findings.push({
      id: 'blocking_risk_missing_work_linkage',
      severity: 'warning',
      type: 'blocking_risk_missing_work_linkage',
      message: `${missingWorkLinkageIds.length} high/medium-risk item${missingWorkLinkageIds.length === 1 ? '' : 's'} not linked to a Feature of Work or schedule activity`,
      affectedItemIds: missingWorkLinkageIds,
      suggestedAction:
        'Link these items to a Feature of Work or schedule activity so blocking risk becomes operationally traceable.',
    })
  }

  // 6. Missing source excerpt — info by default; warning if any affected item has blocking risk.
  //    Skips items where the user has acknowledged the issue via qaAcknowledgements.
  const missingExcerptEntries = items
    .map((item, i) => ({ item, key: keys[i] }))
    .filter(({ item }) => !item.sourceExcerpt && !item.rawExcerpt && !item.qaAcknowledgements?.missing_source_excerpt)
  if (missingExcerptEntries.length > 0) {
    const hasBlockingRisk = missingExcerptEntries.some(
      ({ item }) => item.blockingRisk === 'high' || item.blockingRisk === 'medium',
    )
    findings.push({
      id: 'missing_source_excerpt',
      severity: hasBlockingRisk ? 'warning' : 'info',
      type: 'missing_source_excerpt',
      message: `${missingExcerptEntries.length} item${missingExcerptEntries.length === 1 ? '' : 's'} with no source excerpt`,
      affectedItemIds: missingExcerptEntries.map(({ key }) => key),
      suggestedAction:
        'Source excerpts improve traceability. Re-extract or manually record the spec language.',
    })
  }

  // 7. Duplicate-looking submittals (conservative — flag only, never merge).
  //    Suppression is group-based: a group is suppressed only when ALL members are acknowledged.
  //    If any member is unacknowledged, the entire group stays visible for context.
  const dupGroups = new Map<string, { key: string; item: SubmittalRegisterItem }[]>()
  items.forEach((item, i) => {
    const groupKey = `${normalizeName(item.submittalItem)}::${item.specSection ?? ''}::${item.sdCode ?? ''}`
    const group = dupGroups.get(groupKey) ?? []
    group.push({ key: keys[i], item })
    dupGroups.set(groupKey, group)
  })
  const activeGroups = [...dupGroups.values()].filter(members => {
    if (members.length < 2) return false
    return !members.every(({ item }) => !!item.qaAcknowledgements?.duplicate_submittal)
  })
  const allDupeIds = activeGroups.flatMap(members => members.map(({ key }) => key))
  if (allDupeIds.length > 0) {
    findings.push({
      id: 'duplicate_submittal',
      severity: 'warning',
      type: 'duplicate_submittal',
      message: `${activeGroups.length} group${activeGroups.length === 1 ? '' : 's'} of likely duplicate submittals (${allDupeIds.length} items total)`,
      affectedItemIds: allDupeIds,
      suggestedAction:
        'Review these items — they share the same name, spec section, and SD code. Do not merge without manual verification.',
    })
  }

  // 8. Spec sections with no submittals — skip gracefully when specSections not provided
  if (specSections && specSections.length > 0) {
    const coveredSections = new Set(items.map(i => i.specSection).filter(Boolean))
    const uncovered = specSections
      .map(s => (typeof s === 'string' ? s : s.sectionNumber))
      .filter(sn => !coveredSections.has(sn))
    if (uncovered.length > 0) {
      findings.push({
        id: 'spec_section_no_submittals',
        severity: 'info',
        type: 'spec_section_no_submittals',
        message: `${uncovered.length} spec section${uncovered.length === 1 ? '' : 's'} with no extracted submittals`,
        affectedItemIds: uncovered,
        suggestedAction:
          'These sections may contain submittals not yet extracted. Review manually or re-run extraction.',
      })
    }
  }

  return { findings, checkedAt, totalItems: items.length }
}
