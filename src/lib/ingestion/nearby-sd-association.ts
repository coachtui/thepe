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
 *
 * Use mode: 'reconstructed_pdf' or 'ufgs' (or maxDistance: 5) when processing
 * visually reconstructed PDF text — UFGS table formatting separates SD codes
 * from item descriptions by more than 2 visual lines.
 */

import { extractSdCode, isLikelySubmittalRequirement } from '../chat/submittal-register.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NearbysdOptions {
  /**
   * Max lines to search forward or backward from an SD-only line.
   * Explicit value overrides the mode default.
   */
  maxDistance?: number
  /**
   * Preset mode that controls default maxDistance:
   *   'default'          → 2  (standard CSI spec text)
   *   'reconstructed_pdf' → 5  (visually reconstructed PDF lines)
   *   'ufgs'             → 5  (UFGS table-column format)
   */
  mode?: 'default' | 'reconstructed_pdf' | 'ufgs'
}

export interface NearbySdAssociationMetrics {
  sdCodeOnlyLinesDetected: number
  forwardAssociations: number    // SD-only line before a single item
  backwardAssociations: number   // SD-only line after a single item
  ambiguousAssociations: number  // both forward and backward found different codes — skipped
  skippedMultiCandidate: number  // window contained multiple candidate items — skipped
  skippedBoundary: number        // boundary (page-break / heading) terminated scan before any candidate
  // Block association (reconstructed_pdf / ufgs mode only)
  blockHeadersDetected: number     // SD-only headers that triggered a block scan with ≥1 new assignment
  blockAssociations: number        // items assigned SD code via block pass
  blockSkippedDueToInline: number  // items in block skipped — had inline SD code already
  blockTerminatedByBoundary: number // block scans terminated by a hard boundary
}

export interface NearbySdAssociationResult {
  /** Maps original line-array index → SD code to use as fallback. */
  associations: Map<number, string>
  metrics: NearbySdAssociationMetrics
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default max distance (in non-empty lines) to search forward or backward. */
const MAX_DISTANCE_DEFAULT = 2
const MAX_DISTANCE_WIDE    = 5  // for reconstructed_pdf / ufgs mode

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
 *
 * Association safety rule: if the search window contains multiple candidate
 * items the association is skipped (ambiguous which item the SD code labels).
 * This prevents false assignments when an SD category header covers several
 * items. Ambiguous cases are counted in metrics.skippedMultiCandidate.
 */
export function associateNearbySdCodes(
  lines: string[],
  options?: NearbysdOptions
): NearbySdAssociationResult {
  const mode = options?.mode ?? 'default'
  const maxDist =
    options?.maxDistance !== undefined
      ? options.maxDistance
      : mode === 'reconstructed_pdf' || mode === 'ufgs'
        ? MAX_DISTANCE_WIDE
        : MAX_DISTANCE_DEFAULT

  const metrics: NearbySdAssociationMetrics = {
    sdCodeOnlyLinesDetected:   0,
    forwardAssociations:       0,
    backwardAssociations:      0,
    ambiguousAssociations:     0,
    skippedMultiCandidate:     0,
    skippedBoundary:           0,
    blockHeadersDetected:      0,
    blockAssociations:         0,
    blockSkippedDueToInline:   0,
    blockTerminatedByBoundary: 0,
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
  // SD-only at i → scan ahead up to maxDist lines for candidate items.
  // Exactly 1 candidate in window → associate.
  // 0 candidates + hit boundary → count skippedBoundary.
  // >1 candidates in window → count skippedMultiCandidate (ambiguous which gets the code).

  const forwardMap = new Map<number, string>()   // item index → sdCode
  const sdOnlyUsedForward = new Set<number>()    // SD-only indices consumed by fwd pass

  for (let i = 0; i < lines.length; i++) {
    const code = sdOnlyAt[i]
    if (code === null) continue

    const candidates: number[] = []
    let hitBoundary = false

    for (let j = i + 1; j <= Math.min(i + maxDist, lines.length - 1); j++) {
      if (isBoundaryLine(lines[j])) { hitBoundary = true; break }
      if (sdOnlyAt[j] !== null) break                          // another SD-only stops scan
      if (!isLikelySubmittalRequirement(lines[j])) continue
      if (extractSdCode(lines[j]) !== null) break              // item already has inline code
      candidates.push(j)
    }

    if (candidates.length === 0) {
      if (hitBoundary) metrics.skippedBoundary++
      continue
    }
    if (candidates.length > 1) {
      metrics.skippedMultiCandidate++
      continue
    }

    forwardMap.set(candidates[0], code)
    sdOnlyUsedForward.add(i)
    metrics.forwardAssociations++
  }

  // ── Pass 3: backward associations ────────────────────────────────────────
  // SD-only at i → scan back up to maxDist lines for candidate items.
  // Same single-candidate safety rule as the forward pass.

  const backwardMap = new Map<number, string>()  // item index → sdCode

  for (let i = 0; i < lines.length; i++) {
    const code = sdOnlyAt[i]
    if (code === null) continue
    if (sdOnlyUsedForward.has(i)) continue      // already consumed by forward pass

    const candidates: number[] = []
    let hitBoundary = false

    for (let j = i - 1; j >= Math.max(i - maxDist, 0); j--) {
      if (isBoundaryLine(lines[j])) { hitBoundary = true; break }
      if (sdOnlyAt[j] !== null) break                          // another SD-only stops scan
      if (!isLikelySubmittalRequirement(lines[j])) continue
      if (extractSdCode(lines[j]) !== null) break              // item already has inline code
      if (forwardMap.has(j)) break                             // already covered forward
      candidates.push(j)
    }

    if (candidates.length === 0) {
      if (hitBoundary) metrics.skippedBoundary++
      continue
    }
    if (candidates.length > 1) {
      metrics.skippedMultiCandidate++
      continue
    }

    backwardMap.set(candidates[0], code)
    metrics.backwardAssociations++
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
      metrics.forwardAssociations--
      metrics.backwardAssociations--
      continue
    }

    associations.set(idx, fwd ?? bwd!)
  }

  // ── Pass 5: block association (reconstructed_pdf / ufgs mode only) ────────
  // When a single SD category header line applies to a contiguous forward block
  // of submittal items (UFGS table-column format), assign that SD code to ALL
  // items in the block.
  //
  // Termination conditions: another SD header, boundary line, or end of lines.
  // Non-item lines within the block are skipped (not assigned) but do not stop
  // the scan — filler text between block items is tolerated.
  //
  // Never overwrites inline SD codes or associations already made in passes 2–4.

  if (mode === 'reconstructed_pdf' || mode === 'ufgs') {
    for (let i = 0; i < lines.length; i++) {
      const code = sdOnlyAt[i]
      if (code === null) continue

      let newAssignments = 0
      let terminatedByBoundary = false

      for (let j = i + 1; j < lines.length; j++) {
        if (isBoundaryLine(lines[j])) {
          terminatedByBoundary = true
          break
        }
        if (sdOnlyAt[j] !== null) break  // next SD header ends this block

        if (!isLikelySubmittalRequirement(lines[j])) continue  // non-item filler — skip over

        if (extractSdCode(lines[j]) !== null) {
          metrics.blockSkippedDueToInline++
          continue  // item has inline code — don't overwrite, but don't stop the block
        }
        if (associations.has(j)) continue  // already covered by forward/backward pass

        associations.set(j, code)
        newAssignments++
        metrics.blockAssociations++
      }

      if (terminatedByBoundary) metrics.blockTerminatedByBoundary++
      if (newAssignments > 0)   metrics.blockHeadersDetected++
    }
  }

  return { associations, metrics }
}
