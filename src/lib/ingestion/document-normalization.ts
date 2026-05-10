/**
 * Document normalization — strip repeated headers/footers and project identifier
 * prefixes from PDF-extracted text before submittal parsing.
 *
 * Designed for pdfjs-dist output where pages are joined with \f and text items
 * at the same Y-coordinate are concatenated on the same line with spaces.
 *
 * The primary problem it solves is "running header contamination": DoD/UFGS
 * PDFs embed the project name, contract number, and location on every page.
 * pdfjs merges these with the first line of each page's content, producing:
 *   "FY22 MILCON PROJECT PN 080133 ... WEST LOCH, HAWAII  SECTION 03 30 00 ..."
 * After normalization the same line becomes:
 *   "SECTION 03 30 00 ..."
 */

export interface NormalizationResult {
  cleanedText: string
  removedPatterns: string[]        // human-readable description of each detected pattern
  removedLineCount: number         // lines entirely removed
  prefixStrippedLineCount: number  // lines where a prefix was stripped (content preserved)
  normalizationWarnings: string[]  // informational notes about the document structure
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOP_LINES        = 3    // first N lines per page considered candidate headers
const BOTTOM_LINES     = 2    // last N lines per page considered candidate footers
const PAGE_FREQ_THRESH = 0.30 // pattern in ≥30% of pages → repeated header/footer
const PREFIX_FREQ_THRESH = 0.10 // pattern starts ≥10% of all lines → repeated prefix
const MIN_PATTERN_LEN  = 15   // shorter candidates are ignored
const MIN_PAGES        = 3    // skip frequency detection for very short docs
const MAX_NORM_LEN     = 120  // cap normalized string length for comparison

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collapse whitespace, strip page numbers, lowercase — for frequency comparison. */
function normalizeForComparison(line: string): string {
  return line
    .replace(/\s+/g, ' ')
    .replace(/\bpage\s+\d+\s+of\s+\d+\b/gi, '')
    .replace(/\bprevious\s+edition\s+is\s+obsolete\b/gi, '')
    .replace(/\b\d{1,4}\b/g, 'N')   // page numbers etc.
    .trim()
    .toLowerCase()
    .slice(0, MAX_NORM_LEN)
}

/**
 * Return true if the line looks like a DoD/military project identifier that
 * typically appears as a running header in UFGS / NAVFAC / USACE spec PDFs.
 */
function isProjectIdentifierLine(line: string): boolean {
  return (
    /^FY\d{2}\s+MILCON\b/i.test(line) ||
    /^NAVFAC\s+(PACIFIC|ATLANTIC|SE|SW|NW|MW|HI|WNY|EURAFCEN)\b/i.test(line) ||
    /^USACE\s+DISTRICT\b/i.test(line) ||
    /^U\.S\.\s+ARMY\s+CORPS\b/i.test(line)
  )
}

/**
 * Given a list of whitespace-collapsed strings, return the longest word-aligned
 * prefix shared by at least `minFraction` of strings (case-insensitive).
 * Using < 1.0 gracefully handles minor formatting variants (e.g. 2 of 1542
 * lines missing a facility number) without breaking the full-header match.
 * Returns original-case text from strings[0].
 */
function longestMajorityWordPrefix(strings: string[], minFraction = 0.95): string {
  if (strings.length === 0) return ''
  const lower = strings.map(s => s.toLowerCase())
  const words = lower[0].split(' ')
  for (let n = words.length; n >= 1; n--) {
    const candidate = words.slice(0, n).join(' ')
    const matchCount = lower.filter(s => s.startsWith(candidate)).length
    if (matchCount / strings.length >= minFraction) {
      return strings[0].split(' ').slice(0, n).join(' ')
    }
  }
  return ''
}

/**
 * Build a regex that matches the prefix (originally whitespace-collapsed) against
 * a line that may contain multi-space gaps between tokens.
 */
function buildPrefixRegex(collapsedPrefix: string): RegExp {
  const escaped = collapsedPrefix
    .split(' ')
    .filter(w => w.length > 0)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  return new RegExp(`^${escaped}\\s*`, 'i')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Detect the page-separator style used by the parser and return it. */
function detectPageSeparator(text: string): string {
  if (text.includes('\n\n---PAGE-BREAK---\n\n')) return '\n\n---PAGE-BREAK---\n\n'
  if (text.includes('\f')) return '\f'
  return '\f'   // default — produces a single "page"
}

export function normalizeDocumentText(rawText: string): NormalizationResult {
  const warnings: string[] = []
  const removedPatterns: string[] = []
  let removedLineCount = 0
  let prefixStrippedLineCount = 0

  // Detect and split into pages
  const pageSep = detectPageSeparator(rawText)
  const pages = rawText.split(pageSep)
  const meaningfulPages = pages.filter(p => p.trim().length > 0)
  const totalPages = meaningfulPages.length

  // ── Phase 1: frequency-based header/footer detection ──────────────────────

  const headerFreq = new Map<string, number>()
  const footerFreq = new Map<string, number>()

  if (totalPages >= MIN_PAGES) {
    for (const page of meaningfulPages) {
      const lines = page
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length >= MIN_PATTERN_LEN)

      for (const line of lines.slice(0, TOP_LINES)) {
        const key = normalizeForComparison(line)
        if (key.length >= MIN_PATTERN_LEN)
          headerFreq.set(key, (headerFreq.get(key) ?? 0) + 1)
      }

      for (const line of lines.slice(-BOTTOM_LINES)) {
        const key = normalizeForComparison(line)
        if (key.length >= MIN_PATTERN_LEN)
          footerFreq.set(key, (footerFreq.get(key) ?? 0) + 1)
      }
    }
  }

  const repeatedHeaders = new Set<string>()
  for (const [key, count] of headerFreq) {
    if (count / totalPages >= PAGE_FREQ_THRESH) repeatedHeaders.add(key)
  }

  const repeatedFooters = new Set<string>()
  for (const [key, count] of footerFreq) {
    if (count / totalPages >= PAGE_FREQ_THRESH) repeatedFooters.add(key)
  }

  if (repeatedHeaders.size > 0) {
    warnings.push(`${repeatedHeaders.size} repeated page header(s) detected — will remove`)
    for (const h of repeatedHeaders)
      removedPatterns.push(`[HEADER] ${h.slice(0, 80)}`)
  }
  if (repeatedFooters.size > 0) {
    warnings.push(`${repeatedFooters.size} repeated page footer(s) detected — will remove`)
    for (const f of repeatedFooters)
      removedPatterns.push(`[FOOTER] ${f.slice(0, 80)}`)
  }

  // ── Phase 2: project identifier prefix detection ───────────────────────────

  const allLines = rawText.split('\n').map(l => l.trim()).filter(Boolean)
  const identifierLines = allLines.filter(isProjectIdentifierLine)
  const identifierRatio = allLines.length > 0 ? identifierLines.length / allLines.length : 0

  let prefixRegex: RegExp | null = null
  let prefixDescription = ''

  if (identifierLines.length > 0 && identifierRatio >= PREFIX_FREQ_THRESH) {
    // Collapse whitespace so longestCommonWordPrefix works on clean tokens
    const collapsed = identifierLines.map(l => l.replace(/\s+/g, ' ').trim())
    const commonPrefix = longestMajorityWordPrefix(collapsed)

    if (commonPrefix.length >= MIN_PATTERN_LEN) {
      prefixRegex = buildPrefixRegex(commonPrefix)
      prefixDescription = commonPrefix.slice(0, 80)
      removedPatterns.push(`[PREFIX] ${prefixDescription}${commonPrefix.length > 80 ? '…' : ''}`)
      warnings.push(
        `Project identifier prefix in ${(identifierRatio * 100).toFixed(1)}% of lines` +
        ` ("${prefixDescription}${commonPrefix.length > 80 ? '…' : ''}") — stripping from matching lines`,
      )
    }
  }

  // ── Phase 3: apply removals page by page ──────────────────────────────────

  const cleanedPages = pages.map(page => {
    const inputLines = page.split('\n')
    const outputLines: string[] = []

    for (const rawLine of inputLines) {
      const line = rawLine.trim()

      if (line.length === 0) {
        outputLines.push(rawLine)
        continue
      }

      const normalized = normalizeForComparison(line)

      // Exact repeated header/footer match → drop
      if (repeatedHeaders.has(normalized) || repeatedFooters.has(normalized)) {
        removedLineCount++
        continue
      }

      // Project identifier prefix match → strip prefix, keep remainder
      if (prefixRegex && prefixRegex.test(line)) {
        const remainder = line.replace(prefixRegex, '').trim()
        if (remainder.length === 0) {
          removedLineCount++   // nothing left — drop entirely
          continue
        }
        prefixStrippedLineCount++
        outputLines.push(remainder)
        continue
      }

      outputLines.push(rawLine)
    }

    return outputLines.join('\n')
  })

  // ── Phase 4: structural warnings ──────────────────────────────────────────

  // Detect the DoD DD-form submittal appendix (table-format, not CSI narrative)
  const sfLineCount = allLines.filter(l =>
    /^SUBMITTAL FORM[,\s]/i.test(l) || /^ENG FORM 4025/i.test(l),
  ).length
  if (sfLineCount > 10) {
    warnings.push(
      `${sfLineCount} "SUBMITTAL FORM" table lines detected — ` +
      `this appendix contains tabular submittal data (not parsed by current extractor)`,
    )
  }

  if (totalPages < MIN_PAGES) {
    warnings.push('Document too short for frequency-based header detection (< 3 pages)')
  }

  return {
    cleanedText:            cleanedPages.join(pageSep),
    removedPatterns,
    removedLineCount,
    prefixStrippedLineCount,
    normalizationWarnings:  warnings,
  }
}
