/**
 * First-pass parser for UFGS DD-form submittal register appendix.
 *
 * UFGS specs include a 75-page "SUBMITTAL FORM, Jan 96" appendix that is the
 * authoritative register for the project. Each page lists spec sections,
 * SD codes, item descriptions, and approval authorities.
 *
 * PDF.js visual line reconstruction reads the landscape-orientation table
 * column-by-column. Each column becomes a blob line:
 *
 *   ITEM SUBMITTED          <- column (d) header
 *   {item descriptions}     <- all item titles concatenated
 *   {SD codes blob}         <- all SD codes concatenated (e.g. "SD-03 Product DataSD-07...")
 *   S P E C S E C T (c)    <- column (c) header
 *   {spec sections blob}    <- CSI numbers concatenated (e.g. "03 30 0005 12 00")
 *   ...
 *   SUBMITTAL FORM,Jan 96  <- page title / boundary anchor
 *
 * Parser strategy: for each page block, extract the SD codes blob and spec
 * sections blob, then create one row per SD code entry. Spec section
 * attribution is best-effort: single-section pages pair exactly; multi-section
 * pages use the first section found as representative.
 *
 * This is evaluation-only output. Do not write to database or replace
 * production extraction until rows are reviewed.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DDFormRow {
  specSection: string | null   // e.g. "03 30 00" (normalized), or null
  sectionTitle: string | null  // always null (not in table)
  submittalItem: string        // SD description, e.g. "Product Data"
  sdCode: string               // e.g. "SD-03"
  approvalAuthority: string | null  // "G" (Government) or null
  actionCode: string | null    // not extracted in first pass
  sourcePage: number           // 1-indexed within DD-form appendix
  sourceExcerpt: string        // raw spec+SD snippet for provenance
  parserSource: 'ufgs_dd_form'
}

export interface DDFormParseResult {
  rows: DDFormRow[]
  uniquePairs: number          // unique (specSection, sdCode) combinations
  pagesDetected: number
  isPresent: boolean
  parseWarnings: string[]
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Returns true if the text contains a UFGS "SUBMITTAL FORM, Jan 96" appendix. */
export function hasUfgsDDFormAppendix(text: string): boolean {
  return /SUBMITTAL FORM[,\s]+Jan\s*96/i.test(text)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SdEntry {
  code: string         // "SD-03"
  description: string  // "Product Data"
}

function extractCsiSections(blob: string): string[] {
  const sections: string[] = []
  // Matches 6-digit CSI section number. Works on concatenated blobs like
  // "01 11 0001 14 00" because each section starts with a clean \d{2}\s \d{2}.
  const re = /\b(\d{2}\s+\d{2}\s+\d{2})\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(blob)) !== null) {
    sections.push(m[1].replace(/\s+/g, ' ').trim())
  }
  return [...new Set(sections)]
}

function extractSdEntries(blob: string): SdEntry[] {
  const results: SdEntry[] = []
  // Each SD entry: "SD-XX <description>" — stops at next "SD-" or end.
  const re = /SD-(\d{2})\s+((?:[A-Za-z][^S]*?)?)(?=SD-\d{2}|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(blob)) !== null) {
    const code = `SD-${m[1]}`
    const description = (m[2] ?? '').trim().replace(/\s+/g, ' ')
    if (description.length > 0) {
      results.push({ code, description })
    }
  }
  return results
}

function extractApprovalAuthority(pageLines: string[]): string | null {
  const classIdx = pageLines.findIndex(l =>
    /^C\s+L\s+A\s+S\s+S\s+I\s+F\s+I\s+C/i.test(l)
  )
  if (classIdx === -1 || classIdx + 1 >= pageLines.length) return null
  const gLine = pageLines[classIdx + 1]
  return /\bG\b/.test(gLine) ? 'G' : null
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

export function parseUfgsDDFormAppendix(text: string): DDFormParseResult {
  if (!hasUfgsDDFormAppendix(text)) {
    return { rows: [], uniquePairs: 0, pagesDetected: 0, isPresent: false, parseWarnings: [] }
  }

  const allLines = text.split('\n').filter(l => l.trim().length > 0)

  // Collect indices of all "SUBMITTAL FORM,Jan 96" page anchor lines.
  // Each anchor marks the END of a page data block.
  const anchorIndices: number[] = []
  for (let i = 0; i < allLines.length; i++) {
    if (/SUBMITTAL FORM[,\s]+Jan\s*96/i.test(allLines[i])) {
      anchorIndices.push(i)
    }
  }

  if (anchorIndices.length === 0) {
    return { rows: [], uniquePairs: 0, pagesDetected: 0, isPresent: false, parseWarnings: [] }
  }

  const rows: DDFormRow[] = []
  const warnings: string[] = []
  const seenPairs = new Set<string>()

  for (let pageIdx = 0; pageIdx < anchorIndices.length; pageIdx++) {
    const anchorLine = anchorIndices[pageIdx]
    const blockStart = pageIdx === 0 ? 0 : anchorIndices[pageIdx - 1] + 1
    const pageLines  = allLines.slice(blockStart, anchorLine + 1)
    const ddPage     = pageIdx + 1

    // Find the spec section column header ("S P E C S E C T")
    const specHeaderIdx = pageLines.findIndex(l =>
      /^S\s+P\s+E\s+C\s+S\s+E\s+C\s+T/i.test(l)
    )
    if (specHeaderIdx === -1) {
      // Repeated right-side tracking column blocks — skip silently.
      continue
    }

    const specBlob = specHeaderIdx + 1 < pageLines.length
      ? pageLines[specHeaderIdx + 1]
      : ''

    // SD codes blob: nearest line above spec header that contains SD-XX patterns
    let sdBlob = ''
    for (let j = specHeaderIdx - 1; j >= 0; j--) {
      if (/SD-\d{2}/i.test(pageLines[j])) {
        sdBlob = pageLines[j]
        break
      }
    }

    if (!sdBlob && !/SD-\d{2}/i.test(specBlob)) {
      warnings.push(`DD-form page ${ddPage}: no SD codes found`)
      continue
    }

    // Extract inline spec+SD pairs from the spec blob.
    // Pattern matches: "03 30 00 SD-03 Product Data"
    const inlinePairRe = /(\d{2}\s+\d{2}\s+\d{2}[\d. ]*?)\s+(SD-\d{2}\s+[A-Za-z][^S]*?)(?=\d{2}\s+\d{2}|SD-\d{2}|$)/g
    const inlinePairs: Array<{specSection: string; sdCode: string; description: string}> = []
    let pm: RegExpExecArray | null
    while ((pm = inlinePairRe.exec(specBlob)) !== null) {
      const raw = pm[1].replace(/\s+/g, ' ').trim()
      const specSection = raw.replace(/\.\d{2}(?:\s+\d+)?$/, '').trim()
      const sdFull = pm[2].trim()
      const sdM = sdFull.match(/^(SD-\d{2})\s+(.+)$/)
      if (sdM) {
        inlinePairs.push({ specSection, sdCode: sdM[1], description: sdM[2].trim() })
      }
    }

    const sdEntries      = extractSdEntries(sdBlob)
    const specSections   = extractCsiSections(specBlob)
    const primarySection = specSections[0] ?? null
    const authority      = extractApprovalAuthority(pageLines)

    // 1. Inline paired rows (spec+SD extracted directly from spec blob)
    for (const pair of inlinePairs) {
      const key = `${pair.specSection}|${pair.sdCode}`
      if (!seenPairs.has(key)) {
        seenPairs.add(key)
        rows.push({
          specSection: pair.specSection,
          sectionTitle: null,
          submittalItem: pair.description,
          sdCode: pair.sdCode,
          approvalAuthority: authority,
          actionCode: null,
          sourcePage: ddPage,
          sourceExcerpt: `${pair.specSection} ${pair.sdCode} ${pair.description}`,
          parserSource: 'ufgs_dd_form',
        })
      }
    }

    // 2. SD blob rows — pair each SD entry with the primary spec section
    for (const sd of sdEntries) {
      const key = `${primarySection ?? 'null'}|${sd.code}`
      if (!seenPairs.has(key)) {
        seenPairs.add(key)
        rows.push({
          specSection: primarySection,
          sectionTitle: null,
          submittalItem: sd.description || sd.code,
          sdCode: sd.code,
          approvalAuthority: authority,
          actionCode: null,
          sourcePage: ddPage,
          sourceExcerpt: primarySection
            ? `${primarySection} ${sd.code} ${sd.description}`
            : `${sd.code} ${sd.description}`,
          parserSource: 'ufgs_dd_form',
        })
      }
    }

    // 3. Fallback: SD codes embedded in spec blob when no separate SD blob found
    if (sdEntries.length === 0 && /SD-\d{2}/.test(specBlob)) {
      for (const sd of extractSdEntries(specBlob)) {
        const key = `${primarySection ?? 'null'}|${sd.code}`
        if (!seenPairs.has(key)) {
          seenPairs.add(key)
          rows.push({
            specSection: primarySection,
            sectionTitle: null,
            submittalItem: sd.description || sd.code,
            sdCode: sd.code,
            approvalAuthority: authority,
            actionCode: null,
            sourcePage: ddPage,
            sourceExcerpt: `${primarySection ?? ''} ${sd.code} ${sd.description}`.trim(),
            parserSource: 'ufgs_dd_form',
          })
        }
      }
    }
  }

  return {
    rows,
    uniquePairs: seenPairs.size,
    pagesDetected: anchorIndices.length,
    isPresent: true,
    parseWarnings: warnings,
  }
}
