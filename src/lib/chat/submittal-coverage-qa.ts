import type { SubmittalRegisterItem } from './submittal-register'

export type QASeverity = 'info' | 'warning' | 'critical'

export type QAFindingType =
  | 'missing_sd_code'
  | 'missing_approval_authority'
  | 'conditional_approval_authority'
  | 'blocking_risk_no_due_date'
  | 'blocking_risk_missing_work_linkage'
  | 'missing_source_excerpt'
  | 'duplicate_submittal'
  | 'cross_section_duplicate_submittal'
  | 'spec_section_no_submittals'
  | 'low_extraction_confidence'

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

  // 3. Conditional approval authority — authority present but conditioned on circumstances
  const conditionalAuthEntries = items
    .map((item, i) => ({ item, key: keys[i] }))
    .filter(({ item }) => !!(item as SubmittalRegisterItem & { approvalAuthorityCondition?: string | null }).approvalAuthorityCondition)
  for (const { item, key } of conditionalAuthEntries) {
    const condition = (item as SubmittalRegisterItem & { approvalAuthorityCondition?: string | null }).approvalAuthorityCondition!
    findings.push({
      id: `conditional_auth_${key}`,
      severity: 'warning',
      type: 'conditional_approval_authority',
      message: `Approval authority may vary: "${condition.slice(0, 80)}"`,
      affectedItemIds: [key],
      suggestedAction: 'Confirm the applicable approval authority — language contains a condition or dual-approval requirement.',
    })
  }

  // Cross-section duplicate: same normalized name in different spec sections
  const byNormalizedName = new Map<string, Array<{ key: string; specSection: string | null }>>()
  for (const [i, item] of items.entries()) {
    const normalized = normalizeName(item.submittalItem)
    const arr = byNormalizedName.get(normalized) ?? []
    arr.push({ key: keys[i], specSection: item.specSection })
    byNormalizedName.set(normalized, arr)
  }
  for (const [name, occurrences] of byNormalizedName) {
    const sections = new Set(occurrences.map(o => o.specSection))
    if (sections.size < 2) continue
    findings.push({
      id: `cross_section_dup_${name.slice(0, 20).replace(/\s+/g, '_')}`,
      severity: 'warning',
      type: 'cross_section_duplicate_submittal',
      message: `"${name}" appears in ${sections.size} different spec sections`,
      affectedItemIds: occurrences.map(o => o.key),
      suggestedAction: 'Verify these are distinct requirements — do not merge without manual review.',
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

  // 9. Low extraction confidence — triggered when extractionConfidence is set on items.
  //    Items from the source selector carry this field; legacy items without it are skipped.
  //    severity: warning for < 0.50, info for 0.50–0.79, no finding for ≥ 0.80.
  const lowConfEntries = items
    .map((item, i) => ({ item, key: keys[i] }))
    .filter(({ item }) => {
      const conf = item.extractionConfidence
      return conf !== undefined && conf < 0.80
    })

  if (lowConfEntries.length > 0) {
    const veryLow  = lowConfEntries.filter(({ item }) => (item.extractionConfidence ?? 1) < 0.50)
    const moderate = lowConfEntries.filter(({ item }) => {
      const c = item.extractionConfidence ?? 1
      return c >= 0.50 && c < 0.80
    })
    const severity: QASeverity = veryLow.length > 0 ? 'warning' : 'info'

    // Count by extractionSource for source-aware messaging
    const sourceCounts: Record<string, number> = {}
    for (const { item } of lowConfEntries) {
      const src = item.extractionSource ?? 'narrative'
      sourceCounts[src] = (sourceCounts[src] ?? 0) + 1
    }

    const total = lowConfEntries.length
    const breakdown = veryLow.length > 0 && moderate.length > 0
      ? ` (${veryLow.length} very low <50%, ${moderate.length} low 50–79%)`
      : veryLow.length > 0
        ? ` (${veryLow.length} very low <50%)`
        : ` (${moderate.length} low 50–79%)`

    const actionParts: string[] = []
    if (sourceCounts['ufgs_dd_form']) {
      actionParts.push(
        `${sourceCounts['ufgs_dd_form']} item(s): Authoritative DD-form source — low confidence unexpected, check parser.`
      )
    }
    if (sourceCounts['hybrid_fill']) {
      actionParts.push(
        `${sourceCounts['hybrid_fill']} item(s): Fallback narrative extraction — review recommended.`
      )
    }
    if (sourceCounts['narrative']) {
      actionParts.push(
        `${sourceCounts['narrative']} item(s): Narrative extraction confidence below threshold — verify SD code and authority.`
      )
    }

    findings.push({
      id: 'low_extraction_confidence',
      severity,
      type: 'low_extraction_confidence',
      message: `${total} item${total === 1 ? '' : 's'} with low extraction confidence${breakdown}`,
      affectedItemIds: lowConfEntries.map(({ key }) => key),
      suggestedAction: actionParts.join(' ') ||
        'Review these items — extraction confidence is below acceptable threshold.',
    })
  }

  return { findings, checkedAt, totalItems: items.length }
}
