/**
 * UFGS multi-line SD code association.
 *
 * UFGS spec bodies frequently put the SD code on its own line before
 * (or occasionally after) the submittal item description:
 *
 *   SD-03 Product Data          ← SD-only line (16 chars, short)
 *   Concrete mix design         ← submittal item (no inline SD code)
 *   Aggregate gradation data    ← submittal item (no inline SD code)
 *
 * This module detects those patterns and returns an association map
 * (original-line-index → sdCode) used as fallback enrichment during
 * extraction. Inline SD codes always take priority.
 */

import { extractSdCode, isLikelySubmittalRequirement } from '../chat/submittal-register.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NearbySdAssociationMetrics {
  sdCodeOnlyLinesDetected: number
  forwardAssociations: number   // SD-only line before an item
  backwardAssociations: number  // SD-only line after an item
  ambiguousAssociations: number // both forward and backward found — skipped
}

export interface NearbySdAssociationResult {
  /** Maps original line-array index → SD code to use as fallback. */
  associations: Map<number, string>
  metrics: NearbySdAssociationMetrics
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max distance (in non-empty lines) to search forward or backward. */
const MAX_DISTANCE = 2

/** SD-only lines are short — they carry a category header, not a full statement. */
const SD_ONLY_MAX_LENGTH = 60

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the SD code if this line is an "SD-only" category header line
 * (e.g. "SD-03 Product Data", "SD-07 Certificates", bare "SD-03"),
 * or null if it is a full submittal statement with an incidental SD mention.
 */
function extractSdOnlyCode(line: string): string | null {
  if (line.length > SD_ONLY_MAX_LENGTH) return null
  return extractSdCode(line)
}

/**
 * True if the line is a boundary that should prevent SD code carry-across:
 * page breaks, CSI section numbers, PART headers, numbered clause headings.
 */
function isBoundaryLine(line: string): boolean {
  return (
    line.includes('---PAGE-BREAK---') ||
    /^SECTION\s+\d{2}[\s_]/i.test(line) ||
    /^\d{2}\s+\d{2}\s+\d{2}\b/.test(line) ||  // bare CSI section number
    /^PART\s+\d+\s+/i.test(line) ||
    /^\d+\.\d+\s+[A-Z]/.test(line)             // numbered clause e.g. "1.3 SUBMITTALS"
  )
}

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

/**
 * Given the full non-empty lines of a spec text block, return an association
 * map and metrics describing detected nearby SD code patterns.
 *
 * The returned map uses original array indices — callers must preserve the
 * original index when filtering or mapping over the same lines array.
 *
 * Priority: inline extractSdCode() always wins. This map is fallback-only.
 */
export function associateNearbySdCodes(lines: string[]): NearbySdAssociationResult {
  const metrics: NearbySdAssociationMetrics = {
    sdCodeOnlyLinesDetected: 0,
    forwardAssociations:     0,
    backwardAssociations:    0,
    ambiguousAssociations:   0,
  }

  // ── Pass 1: locate SD-only lines ─────────────────────────────────────────

  // sdOnlyAt[i] = SD code if line i is an SD-only line, else null
  const sdOnlyAt: (string | null)[] = lines.map(line => extractSdOnlyCode(line))

  for (const code of sdOnlyAt) {
    if (code !== null) metrics.sdCodeOnlyLinesDetected++
  }

  if (metrics.sdCodeOnlyLinesDetected === 0) {
    return { associations: new Map(), metrics }
  }

  // ── Pass 2: forward associations ─────────────────────────────────────────
  // SD-only at i → look ahead for an item without an inline SD code.
  // Covers: "SD-03 Product Data\nConcrete mix design" (SD code before item).

  const forwardMap = new Map<number, string>()   // item index → sdCode
  const sdOnlyUsedForward = new Set<number>()    // SD-only indices consumed by fwd pass

  for (let i = 0; i < lines.length; i++) {
    const code = sdOnlyAt[i]
    if (code === null) continue

    for (let j = i + 1; j <= Math.min(i + MAX_DISTANCE, lines.length - 1); j++) {
      if (isBoundaryLine(lines[j])) break
      if (sdOnlyAt[j] !== null) break          // another SD-only cancels carry
      if (!isLikelySubmittalRequirement(lines[j])) continue
      if (extractSdCode(lines[j]) !== null) break  // item already has inline code
      forwardMap.set(j, code)
      sdOnlyUsedForward.add(i)
      metrics.forwardAssociations++
      break
    }
  }

  // ── Pass 3: backward associations ────────────────────────────────────────
  // SD-only at i → look back for an item without an inline SD code.
  // Covers: "Concrete mix design\nSD-03 Product Data" (SD code after item).
  // Only runs for SD-only lines NOT already consumed by forward pass.

  const backwardMap = new Map<number, string>()  // item index → sdCode

  for (let i = 0; i < lines.length; i++) {
    const code = sdOnlyAt[i]
    if (code === null) continue
    if (sdOnlyUsedForward.has(i)) continue      // already used in a forward association

    for (let j = i - 1; j >= Math.max(i - MAX_DISTANCE, 0); j--) {
      if (isBoundaryLine(lines[j])) break
      if (sdOnlyAt[j] !== null) break           // another SD-only line — stop
      if (!isLikelySubmittalRequirement(lines[j])) continue
      if (extractSdCode(lines[j]) !== null) break  // item already has inline code
      if (forwardMap.has(j)) break              // item already covered by forward pass
      backwardMap.set(j, code)
      metrics.backwardAssociations++
      break
    }
  }

  // ── Pass 4: merge and detect ambiguity ────────────────────────────────────

  const associations = new Map<number, string>()

  const allTargets = new Set([...forwardMap.keys(), ...backwardMap.keys()])
  for (const idx of allTargets) {
    const fwd = forwardMap.get(idx)
    const bwd = backwardMap.get(idx)

    if (fwd && bwd && fwd !== bwd) {
      // Different codes from each direction — ambiguous, skip both
      metrics.ambiguousAssociations++
      // Adjust counters (these were incremented optimistically)
      metrics.forwardAssociations--
      metrics.backwardAssociations--
      continue
    }

    associations.set(idx, fwd ?? bwd!)
  }

  return { associations, metrics }
}
