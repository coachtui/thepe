/**
 * Submittal extraction source selector.
 *
 * Evaluates narrative body extraction vs DD-form appendix parsing and picks
 * the better source (or a hybrid of both) based on SD code coverage and
 * spec section overlap.
 *
 * All returned items carry extraction provenance labels:
 *   extractionSource         'narrative' | 'ufgs_dd_form' | 'hybrid_fill'
 *   extractionConfidence     number 0-1
 *   extractionSourceReason   human-readable explanation
 *
 * This is evaluation-only logic. It does not write to the database.
 */

import type { SubmittalRegisterItem } from '../chat/submittal-register.ts'
import type { DDFormRow } from '../parsers/ufgs-submittal-register-parser.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceSelectorInput {
  narrativeItems: SubmittalRegisterItem[]
  ddFormRows: DDFormRow[]
  narrativeSdCoverage: number   // 0-100
}

export interface SourceBreakdown {
  count: number
  sdCoverage: number     // 0-100, % of items with sdCode
  avgConfidence: number  // mean extractionConfidence
}

export interface SourceSelectionResult {
  selectedSource: 'narrative' | 'dd_form' | 'hybrid'
  reason: string
  selectedItems: SubmittalRegisterItem[]
  fallbackItems: SubmittalRegisterItem[]
  warnings: string[]
  sourceBreakdown: {
    dd_form:     SourceBreakdown
    narrative:   SourceBreakdown
    hybrid_fill: SourceBreakdown
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DD_FORM_SD_THRESHOLD    = 80    // min DD-form SD% to prefer over narrative
const HYBRID_COVERAGE_THRESHOLD = 0.70  // if DD-form covers < 70% of narrative sections → hybrid

// ---------------------------------------------------------------------------
// SD code → submittal type label
// ---------------------------------------------------------------------------

const SD_TYPE_MAP: Record<string, string> = {
  'SD-01': 'Preconstruction Submittals',
  'SD-02': 'Shop Drawings',
  'SD-03': 'Product Data',
  'SD-04': 'Samples',
  'SD-05': 'Design Data',
  'SD-06': 'Test Reports',
  'SD-07': 'Certificates',
  'SD-08': "Manufacturer's Instructions",
  'SD-09': "Manufacturer's Field Reports",
  'SD-10': 'Operation and Maintenance Data',
  'SD-11': 'Closeout Submittals',
}

// ---------------------------------------------------------------------------
// Labeling helpers
// ---------------------------------------------------------------------------

/** Label a narrative item as 'narrative' source. Does not mutate input. */
function labelNarrative(item: SubmittalRegisterItem): SubmittalRegisterItem {
  return {
    ...item,
    extractionSource:       'narrative',
    extractionConfidence:   item.confidence,
    extractionSourceReason: 'Parsed from specification body text.',
  }
}

/**
 * Label a narrative item as 'hybrid_fill' and lower confidence when the item
 * is missing quality signals (SD code or approval authority).
 * Does not mutate input.
 */
function labelHybridFill(item: SubmittalRegisterItem): SubmittalRegisterItem {
  let conf = item.confidence ?? 0.72
  if (!item.sdCode)           conf = Math.max(conf - 0.10, 0.30)
  if (!item.approvalAuthority) conf = Math.max(conf - 0.05, 0.30)
  return {
    ...item,
    extractionSource:       'hybrid_fill',
    extractionConfidence:   Math.round(conf * 1000) / 1000,
    extractionSourceReason: 'Narrative extraction used because DD-form did not cover this spec section.',
    confidence:             Math.round(conf * 1000) / 1000,
  }
}

// ---------------------------------------------------------------------------
// Mapping: DDFormRow → SubmittalRegisterItem
// ---------------------------------------------------------------------------

/**
 * Convert a DDFormRow into the SubmittalRegisterItem shape.
 * Always sets extractionSource='ufgs_dd_form' and confidence=0.92.
 */
export function mapDDFormRowToSubmittalItem(row: DDFormRow): SubmittalRegisterItem {
  const submittalType = SD_TYPE_MAP[row.sdCode] ?? null
  return {
    specSection:    row.specSection,
    sectionTitle:   null,
    submittalItem:  row.submittalItem || row.sdCode,
    submittalType,
    requiredAction: null,
    approvalRequired: row.approvalAuthority === 'G' ? true : null,
    sourceReference: {
      sourceType:        'specification',
      specSection:       row.specSection ?? undefined,
      pageNumber:        row.sourcePage,
      extractionSource:  'ufgs_dd_form',
    },
    excerpt:           row.sourceExcerpt || null,
    confidence:        0.92,
    notes:             'Extracted from UFGS DD-form submittal register appendix.',
    sdCode:            row.sdCode,
    approvalAuthority: row.approvalAuthority,
    sourcePage:        row.sourcePage,
    sourceExcerpt:     row.sourceExcerpt || null,
    blockingRisk:      'none',
    // Extraction provenance
    extractionSource:       'ufgs_dd_form',
    extractionConfidence:   0.92,
    extractionSourceReason: 'Parsed from UFGS DD-form submittal register appendix.',
  }
}

// ---------------------------------------------------------------------------
// Source breakdown utility
// ---------------------------------------------------------------------------

export function computeSourceBreakdown(items: SubmittalRegisterItem[]): SourceSelectionResult['sourceBreakdown'] {
  const groups: Record<'dd_form' | 'narrative' | 'hybrid_fill', SubmittalRegisterItem[]> = {
    dd_form:     [],
    narrative:   [],
    hybrid_fill: [],
  }

  for (const item of items) {
    const src = item.extractionSource ?? 'narrative'
    if (src === 'ufgs_dd_form') groups.dd_form.push(item)
    else if (src === 'hybrid_fill') groups.hybrid_fill.push(item)
    else groups.narrative.push(item)
  }

  function breakdownFor(group: SubmittalRegisterItem[]): SourceBreakdown {
    if (group.length === 0) return { count: 0, sdCoverage: 0, avgConfidence: 0 }
    const sdCount   = group.filter(i => i.sdCode).length
    const confSum   = group.reduce((s, i) => s + (i.extractionConfidence ?? i.confidence ?? 0), 0)
    return {
      count:         group.length,
      sdCoverage:    Math.round(sdCount / group.length * 1000) / 10,
      avgConfidence: Math.round(confSum / group.length * 1000) / 1000,
    }
  }

  return {
    dd_form:     breakdownFor(groups.dd_form),
    narrative:   breakdownFor(groups.narrative),
    hybrid_fill: breakdownFor(groups.hybrid_fill),
  }
}

// ---------------------------------------------------------------------------
// Source selection
// ---------------------------------------------------------------------------

/**
 * Choose the best extraction source and return labeled items.
 *
 * Decision tree:
 *  1. No DD-form rows  → narrative (all items labeled 'narrative')
 *  2. DD-form SD%  < 80% threshold → narrative
 *  3. Narrative SD% >= DD-form SD% → narrative
 *  4. DD-form covers < 70% of narrative spec sections → hybrid
 *  5. Otherwise → dd_form
 */
export function chooseSubmittalExtractionSource(
  input: SourceSelectorInput
): SourceSelectionResult {
  const { narrativeItems, ddFormRows, narrativeSdCoverage } = input
  const warnings: string[] = []

  const emptyBreakdown = (): SourceSelectionResult['sourceBreakdown'] => ({
    dd_form:     { count: 0, sdCoverage: 0, avgConfidence: 0 },
    narrative:   { count: 0, sdCoverage: 0, avgConfidence: 0 },
    hybrid_fill: { count: 0, sdCoverage: 0, avgConfidence: 0 },
  })

  // Case 1: no DD-form rows
  if (ddFormRows.length === 0) {
    const labeled = narrativeItems.map(labelNarrative)
    return {
      selectedSource: 'narrative',
      reason:         'No DD-form rows extracted — using narrative extraction.',
      selectedItems:  labeled,
      fallbackItems:  [],
      warnings,
      sourceBreakdown: computeSourceBreakdown(labeled),
    }
  }

  const ddFormSdCoverage = 100  // always 100 by construction

  // Case 2: DD-form SD coverage below threshold
  if (ddFormSdCoverage < DD_FORM_SD_THRESHOLD) {
    warnings.push(`DD-form SD coverage ${ddFormSdCoverage}% below ${DD_FORM_SD_THRESHOLD}% threshold.`)
    const labeled = narrativeItems.map(labelNarrative)
    return {
      selectedSource: 'narrative',
      reason:         `DD-form SD coverage ${ddFormSdCoverage}% below threshold — using narrative.`,
      selectedItems:  labeled,
      fallbackItems:  ddFormRows.map(mapDDFormRowToSubmittalItem),
      warnings,
      sourceBreakdown: computeSourceBreakdown(labeled),
    }
  }

  // Case 3: narrative already as good as DD-form
  if (narrativeSdCoverage >= ddFormSdCoverage) {
    const labeled = narrativeItems.map(labelNarrative)
    return {
      selectedSource: 'narrative',
      reason:
        `Narrative SD coverage (${narrativeSdCoverage.toFixed(1)}%) >= ` +
        `DD-form (${ddFormSdCoverage}%) — using narrative.`,
      selectedItems:  labeled,
      fallbackItems:  ddFormRows.map(mapDDFormRowToSubmittalItem),
      warnings,
      sourceBreakdown: computeSourceBreakdown(labeled),
    }
  }

  // DD-form is better. Check spec section coverage overlap.
  const ddFormSpecSections   = new Set<string>()
  const narrativeSpecSections = new Set<string>()
  for (const row  of ddFormRows)      if (row.specSection)  ddFormSpecSections.add(row.specSection)
  for (const item of narrativeItems)  if (item.specSection) narrativeSpecSections.add(item.specSection)

  const coveredCount     = [...narrativeSpecSections].filter(s => ddFormSpecSections.has(s)).length
  const missingFromDD    = [...narrativeSpecSections].filter(s => !ddFormSpecSections.has(s))
  const coverageFraction = narrativeSpecSections.size > 0
    ? coveredCount / narrativeSpecSections.size
    : 1

  // Case 4: hybrid
  if (coverageFraction < HYBRID_COVERAGE_THRESHOLD && missingFromDD.length > 0) {
    const preview  = missingFromDD.slice(0, 3).join(', ')
    const ellipsis = missingFromDD.length > 3 ? `… +${missingFromDD.length - 3}` : ''
    warnings.push(
      `DD-form covers ${coveredCount}/${narrativeSpecSections.size} narrative spec sections. ` +
      `Hybrid: narrative fills ${missingFromDD.length} missing sections (${preview}${ellipsis}).`
    )

    const ddFormItems = ddFormRows.map(mapDDFormRowToSubmittalItem)
    const missingSet  = new Set(missingFromDD)
    const fillItems   = narrativeItems
      .filter(item => item.specSection !== null && missingSet.has(item.specSection))
      .map(labelHybridFill)

    const combined = [...ddFormItems]
    const seen     = new Set(ddFormItems.map(simpleDedupeKey))
    for (const item of fillItems) {
      const k = simpleDedupeKey(item)
      if (!seen.has(k)) { seen.add(k); combined.push(item) }
    }

    const fallbackLabeled = narrativeItems
      .filter(item => item.specSection === null || !missingSet.has(item.specSection))
      .map(labelNarrative)

    return {
      selectedSource: 'hybrid',
      reason:
        `DD-form covers ${Math.round(coverageFraction * 100)}% of narrative spec sections — ` +
        `hybrid: DD-form primary + narrative fill for ${missingFromDD.length} missing sections.`,
      selectedItems:  combined,
      fallbackItems:  fallbackLabeled,
      warnings,
      sourceBreakdown: computeSourceBreakdown(combined),
    }
  }

  // Case 5: dd_form
  if (missingFromDD.length > 0) {
    const preview = missingFromDD.slice(0, 3).join(', ')
    warnings.push(
      `${missingFromDD.length} narrative spec sections not in DD-form ` +
      `(${preview}${missingFromDD.length > 3 ? '…' : ''}).`
    )
  }

  const ddFormItems      = ddFormRows.map(mapDDFormRowToSubmittalItem)
  const fallbackLabeled  = narrativeItems.map(labelNarrative)

  return {
    selectedSource:  'dd_form',
    reason:          `DD-form SD coverage ${ddFormSdCoverage}% >> narrative ${narrativeSdCoverage.toFixed(1)}%.`,
    selectedItems:   ddFormItems,
    fallbackItems:   fallbackLabeled,
    warnings,
    sourceBreakdown: computeSourceBreakdown(ddFormItems),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function simpleDedupeKey(item: SubmittalRegisterItem): string {
  const sec  = (item.specSection  ?? '').replace(/\s+/g, '').toLowerCase()
  const sd   = (item.sdCode       ?? '').toLowerCase()
  const name = (item.submittalItem ?? '').toLowerCase().slice(0, 40)
  return `${sec}|${sd}|${name}`
}
