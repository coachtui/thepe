/**
 * Reasoning Engine — transforms retrieved evidence into structured project interpretation.
 *
 * Sits between evidence-evaluator and response-writer in the pipeline:
 *   query-analyzer → retrieval-orchestrator → evidence-evaluator
 *     → reasoning-engine → response-writer
 *
 * Design principles:
 *   1. Deterministic first: support levels are assigned by evidence source, not model judgment
 *   2. No LLM calls: all classification is rule-based TypeScript
 *   3. Preserves sufficiency guardrails: insufficient/unsupported paths bypass this layer
 *   4. Construction knowledge is encoded as lookup tables and pattern rules
 *
 * The output (ReasoningPacket) gives the response-writer pre-classified findings
 * so the model cannot re-categorize evidence — it can only narrate the structure
 * it's been given.
 */

import type {
  QueryAnalysis,
  EvidencePacket,
  EvidenceItem,
  EvidenceSourceType,
  SufficiencyResult,
  ReasoningPacket,
  ReasoningMode,
  ReasoningFinding,
  ReasoningGap,
  ProjectContextAssembly,
  SupportLevel,
  GapType,
  EvidenceStrength,
  StructuredCitation,
} from './types'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply the reasoning layer.
 *
 * Returns a ReasoningPacket. When wasActivated=false the writer skips the
 * reasoning block and answers from evidence directly (same as pre-reasoning).
 */
export function applyReasoning(
  analysis: QueryAnalysis,
  packet: EvidencePacket,
  sufficiency: SufficiencyResult
): ReasoningPacket {
  const mode = selectReasoningMode(analysis, packet, sufficiency)

  if (mode === 'none') {
    return buildPassThrough(analysis, packet, sufficiency)
  }

  const context = assembleProjectContext(analysis, packet)
  const findings = generateFindings(mode, analysis, packet)
  const gaps = identifyGaps(analysis, packet, sufficiency)
  const evidenceStrength = computeEvidenceStrength(sufficiency)

  return {
    mode,
    wasActivated: true,
    context,
    findings,
    gaps,
    recommendedAnswerFrame: selectAnswerFrame(mode, findings),
    evidenceStrength,
  }
}

// ---------------------------------------------------------------------------
// Mode selection — deterministic
// ---------------------------------------------------------------------------

function selectReasoningMode(
  analysis: QueryAnalysis,
  packet: EvidencePacket,
  sufficiency: SufficiencyResult
): ReasoningMode {
  // Never activate when there is nothing to reason over
  if (sufficiency.level === 'insufficient') return 'none'
  if (sufficiency.isUnsupportedDomain) return 'none'

  switch (analysis.answerMode) {
    case 'sequence_inference':
      return 'sequence_reasoning'

    case 'scope_summary':
    case 'project_summary':
      return 'scope_reasoning'

    case 'quantity_lookup': {
      // Only worth activating when evidence spans multiple systems
      const systems = extractUniqueSystemNames(packet)
      return systems.length > 1 ? 'quantity_reasoning' : 'none'
    }

    case 'general_chat': {
      // Activate constraint reasoning when there is substantive structured data
      const hasStructuredData = packet.items.some(
        i =>
          i.source === 'vision_db' ||
          i.source === 'direct_lookup' ||
          i.source === 'project_summary'
      )
      return hasStructuredData ? 'constraint_reasoning' : 'none'
    }

    default:
      return 'none'
  }
}

// ---------------------------------------------------------------------------
// Project context assembly
// ---------------------------------------------------------------------------

function assembleProjectContext(
  analysis: QueryAnalysis,
  packet: EvidencePacket
): ProjectContextAssembly {
  const evidenceSystems = extractUniqueSystemNames(packet)

  // Systems explicitly queried are primary; additional systems found in evidence are related
  const primarySystems =
    analysis.requestedSystems.length > 0
      ? analysis.requestedSystems
      : evidenceSystems.slice(0, 3)

  const relatedSystems = evidenceSystems.filter(s => !primarySystems.includes(s))

  const relevantSheets = packet.items
    .filter(i => i.citation?.sheetNumber)
    .map(i => i.citation!.sheetNumber!)
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .sort()

  const relevantStations = packet.items
    .filter(i => i.citation?.station)
    .map(i => i.citation!.station!)
    .filter((v, idx, arr) => arr.indexOf(v) === idx)

  return {
    primarySystems,
    relatedSystems,
    relevantSheets,
    relevantStations,
    dataCompleteness: computeDataCompleteness(packet),
  }
}

function computeDataCompleteness(packet: EvidencePacket): 'full' | 'partial' | 'sparse' {
  const structuredCount = packet.items.filter(
    i =>
      i.source === 'vision_db' ||
      i.source === 'direct_lookup' ||
      i.source === 'project_summary'
  ).length
  const total = packet.items.length

  if (total === 0) return 'sparse'
  if (structuredCount === 0) return 'sparse'
  if (structuredCount >= total * 0.5) return 'full'
  return 'partial'
}

// ---------------------------------------------------------------------------
// Finding generation — one function per mode
// ---------------------------------------------------------------------------

function generateFindings(
  mode: ReasoningMode,
  analysis: QueryAnalysis,
  packet: EvidencePacket
): ReasoningFinding[] {
  switch (mode) {
    case 'sequence_reasoning':
      return generateSequenceFindings(analysis, packet)
    case 'scope_reasoning':
      return generateScopeFindings(packet)
    case 'quantity_reasoning':
      return generateQuantityFindings(packet)
    case 'constraint_reasoning':
      return generateConstraintFindings(packet)
    default:
      return []
  }
}

// ── sequence_reasoning ─────────────────────────────────────────────────────

/**
 * Standard installation steps by utility type.
 * These are always tagged `inferred` — they reflect industry practice, not plan data.
 */
const STANDARD_SEQUENCE_STEPS: Record<string, string[]> = {
  water: [
    'Establish traffic control and construction staging area',
    'Locate and pothole (daylight) existing utilities within work corridor',
    'Trench excavation to required pipe invert depth',
    'Install pipe bedding material (typically imported sand or crushed rock per spec)',
    'Lower pipe sections, complete joints and fittings',
    'Install valves, hydrant laterals, and appurtenances',
    'Pressure test (typically 150 psi or 1.5x working pressure for 2 hours)',
    'Chlorinate, flush, and bacteriological testing before tie-in',
    'Backfill and compact in lifts to required density',
    'Surface restoration: subbase, base, and final paving',
  ],
  sewer: [
    'Establish traffic control and bypass pumping if active flow diversion needed',
    'Locate and pothole existing utilities',
    'Excavate trench working upstream-to-downstream (inlet to outlet) to maintain grade',
    'Install pipe bedding',
    'Install pipe from downstream end (outlet to inlet) maintaining positive grade',
    'Set precast manholes, adjust frames and covers to finish grade',
    'Air pressure test or exfiltration test per agency standard',
    'CCTV inspection (required by most public agencies prior to acceptance)',
    'Backfill and compact',
    'Surface restoration',
  ],
  storm: [
    'Establish traffic control and erosion/sediment controls (BMP installation first)',
    'Locate and pothole existing utilities',
    'Excavate structure pits first (catch basins, inlets, manholes)',
    'Set inlet/outlet structures and connect to existing system',
    'Install pipe from outlet (downstream) working toward inlet (upstream)',
    'Install outlet protection (rip-rap, energy dissipator) per plans',
    'Backfill and compact',
    'Surface restoration and erosion control finalization',
  ],
  conduit: [
    'Establish traffic control',
    'Trench excavation — coordinate depth with existing utilities and crossing clearances',
    'Install conduit with pull boxes/handholes at required spacing',
    'Install warning tape or detectable marking above conduit (min 12" cover)',
    'Backfill and compact',
    'Surface restoration',
    'Wire pull is typically a separate activity coordinated with the utility owner',
  ],
}

const MULTI_UTILITY_SEQUENCE_NOTE =
  'When multiple utilities share the same trench or corridor: install the deepest utility first ' +
  '(typically sanitary sewer), then storm drain, then water main, then conduit/electrical. ' +
  'This minimizes over-excavation and protects previously installed pipe.'

const SEQUENCE_KEYWORDS = /sequen|order|step|procedure|first.*then|prior\s+to|before\s+|after\s+|shall\s+(?:install|complete|establish)/i

function generateSequenceFindings(
  analysis: QueryAnalysis,
  packet: EvidencePacket
): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  // 1. Surface explicit sequence language from documents
  const docItems = packet.items.filter(
    i =>
      (i.source === 'vector_search' ||
        i.source === 'complete_data' ||
        i.source === 'live_pdf_analysis') &&
      SEQUENCE_KEYWORDS.test(i.content)
  )

  for (const item of docItems.slice(0, 3)) {
    findings.push({
      statement: trimToSentences(item.content, 2),
      supportLevel: sourceToSupportLevel(item.source),
      citations: item.citation ? [item.citation] : undefined,
      basis: 'Project document — sequence language detected',
    })
  }

  // 2. Apply standard sequences for identified utility systems (inferred)
  const systems = extractUniqueSystemNames(packet)
  const systemsToSequence =
    systems.length > 0 ? systems : analysis.requestedSystems

  const typesFound = new Set<string>()

  for (const systemName of systemsToSequence.slice(0, 3)) {
    const systemKey = classifySystemType(systemName)
    const steps = systemKey ? STANDARD_SEQUENCE_STEPS[systemKey] : null

    if (steps && systemKey) {
      typesFound.add(systemKey)
      findings.push({
        statement:
          `Standard ${systemName} installation sequence (${steps.length} steps):\n` +
          steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n'),
        supportLevel: 'inferred',
        basis: 'Standard heavy civil construction practice — verify specific requirements against project specifications',
      })
    }
  }

  // 3. Multi-utility sequencing note (inferred)
  if (typesFound.size > 1) {
    findings.push({
      statement: MULTI_UTILITY_SEQUENCE_NOTE,
      supportLevel: 'inferred',
      basis: 'Standard utility installation practice',
    })
  }

  return findings
}

// ── scope_reasoning ────────────────────────────────────────────────────────

function generateScopeFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  // Structured items → explicit findings
  const structuredItems = packet.items.filter(
    i =>
      i.source === 'vision_db' ||
      i.source === 'direct_lookup' ||
      i.source === 'project_summary'
  )

  for (const item of structuredItems.slice(0, 6)) {
    findings.push({
      statement: trimToSentences(item.content, 3),
      supportLevel: 'explicit',
      citations: item.citation ? [item.citation] : undefined,
      basis: `Structured data from ${item.source}`,
    })
  }

  // High-confidence vector items → inferred supplemental context
  const vectorItems = packet.items.filter(
    i =>
      (i.source === 'vector_search' || i.source === 'complete_data') &&
      i.confidence > 0.6
  )

  for (const item of vectorItems.slice(0, 3)) {
    findings.push({
      statement: trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations: item.citation ? [item.citation] : undefined,
      basis: 'Document text — high-confidence vector search result',
    })
  }

  return findings
}

// ── quantity_reasoning ─────────────────────────────────────────────────────

function generateQuantityFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []
  const grouped = groupItemsBySystem(packet.items)

  for (const [systemName, items] of Object.entries(grouped)) {
    if (systemName === 'General' && items.length === 0) continue

    const structuredCount = items.filter(
      i => i.source === 'vision_db' || i.source === 'direct_lookup'
    ).length
    const supportLevel: SupportLevel = structuredCount > 0 ? 'explicit' : 'inferred'

    findings.push({
      statement: `${systemName}: ${items.length} evidence item(s) — ${structuredCount} from structured vision data`,
      supportLevel,
      basis:
        structuredCount > 0
          ? 'Vision-extracted structured records'
          : 'Vector search document chunks only — cross-check against plan sheets',
    })
  }

  return findings
}

// ── constraint_reasoning ───────────────────────────────────────────────────

const CROSSING_KEYWORDS = /cross|intersect|elevation|depth|clearance|separation|conflict/i
const CONSTRAINT_KEYWORDS =
  /clearance|conflict|constraint|separation|maintain|protect|existing|interfere|cannot|shall\s+not|prohibited|minimum/i

function generateConstraintFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  // Vision DB crossing records → explicit
  const crossingItems = packet.items.filter(
    i => i.source === 'vision_db' && CROSSING_KEYWORDS.test(i.content)
  )
  for (const item of crossingItems.slice(0, 5)) {
    findings.push({
      statement: trimToSentences(item.content, 2),
      supportLevel: 'explicit',
      citations: item.citation ? [item.citation] : undefined,
      basis: 'Vision-extracted crossing record from structured DB',
    })
  }

  // All vision DB items that aren't crossings (project data is still explicit)
  const otherStructured = packet.items.filter(
    i =>
      (i.source === 'vision_db' ||
        i.source === 'direct_lookup' ||
        i.source === 'project_summary') &&
      !CROSSING_KEYWORDS.test(i.content)
  )
  for (const item of otherStructured.slice(0, 3)) {
    findings.push({
      statement: trimToSentences(item.content, 2),
      supportLevel: 'explicit',
      citations: item.citation ? [item.citation] : undefined,
      basis: `From ${item.source}`,
    })
  }

  // Vector search items containing constraint language → inferred
  const constraintItems = packet.items.filter(
    i =>
      (i.source === 'vector_search' || i.source === 'complete_data') &&
      CONSTRAINT_KEYWORDS.test(i.content)
  )
  for (const item of constraintItems.slice(0, 4)) {
    findings.push({
      statement: trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations: item.citation ? [item.citation] : undefined,
      basis: 'Document text — constraint language detected',
    })
  }

  return findings
}

// ---------------------------------------------------------------------------
// Gap identification
// ---------------------------------------------------------------------------

function identifyGaps(
  analysis: QueryAnalysis,
  packet: EvidencePacket,
  sufficiency: SufficiencyResult
): ReasoningGap[] {
  const gaps: ReasoningGap[] = []

  // Carry forward sufficiency gaps with type and resolution
  for (const gap of sufficiency.gaps) {
    gaps.push({
      description: gap,
      gapType: classifyGapType(gap),
      actionable: suggestGapResolution(gap, analysis),
    })
  }

  // Live analysis cap
  if (packet.liveAnalysisMeta?.wasCapped) {
    const meta = packet.liveAnalysisMeta
    if (!gaps.some(g => g.gapType === 'partial_live_analysis')) {
      gaps.push({
        description: `Live analysis was capped at ${meta.capLimit} of ${meta.sheetsAttempted} sheets — remaining sheets not analyzed`,
        gapType: 'partial_live_analysis',
        actionable:
          'Run background vision processing via the Analyze button to build the full structured database',
      })
    }
  }

  // Skipped sheets not already mentioned
  if (packet.liveAnalysisMeta && packet.liveAnalysisMeta.sheetsSkipped > 0) {
    if (!gaps.some(g => g.gapType === 'missing_sheet_coverage')) {
      gaps.push({
        description: `${packet.liveAnalysisMeta.sheetsSkipped} sheet(s) could not be processed`,
        gapType: 'missing_sheet_coverage',
        actionable:
          'Check file sizes — sheets over 10 MB require optimization before processing',
      })
    }
  }

  // Precision queries without structured data
  const hasStructured = packet.items.some(
    i => i.source === 'vision_db' || i.source === 'direct_lookup'
  )
  if (!hasStructured && ['quantity_lookup', 'crossing_lookup'].includes(analysis.answerMode)) {
    if (!gaps.some(g => g.gapType === 'insufficient_structured_data')) {
      gaps.push({
        description:
          'No structured vision-extracted data found — results rely on document text only',
        gapType: 'insufficient_structured_data',
        actionable:
          'Use the Analyze button to run vision processing and build the structured quantity/crossing database',
      })
    }
  }

  return gaps
}

// ---------------------------------------------------------------------------
// Evidence strength
// ---------------------------------------------------------------------------

function computeEvidenceStrength(sufficiency: SufficiencyResult): EvidenceStrength {
  if (sufficiency.score >= 0.7) return 'strong'
  if (sufficiency.score >= 0.4) return 'moderate'
  return 'weak'
}

// ---------------------------------------------------------------------------
// Answer frame selection
// ---------------------------------------------------------------------------

function selectAnswerFrame(mode: ReasoningMode, findings: ReasoningFinding[]): string {
  const hasExplicit = findings.some(f => f.supportLevel === 'explicit')
  const hasInferred = findings.some(f => f.supportLevel === 'inferred')

  switch (mode) {
    case 'sequence_reasoning':
      if (hasExplicit && hasInferred) return 'mixed_sequence'
      if (hasExplicit) return 'document_supported_sequence'
      return 'standard_practice_sequence'

    case 'scope_reasoning':
      return hasExplicit ? 'data_driven_scope' : 'partial_scope'

    case 'quantity_reasoning':
      return 'system_grouped_quantities'

    case 'constraint_reasoning':
      return hasExplicit ? 'document_supported_constraints' : 'inferred_constraints'

    default:
      return 'standard'
  }
}

// ---------------------------------------------------------------------------
// Pass-through (reasoning not activated)
// ---------------------------------------------------------------------------

function buildPassThrough(
  analysis: QueryAnalysis,
  packet: EvidencePacket,
  sufficiency: SufficiencyResult
): ReasoningPacket {
  return {
    mode: 'none',
    wasActivated: false,
    context: {
      primarySystems: analysis.requestedSystems,
      relatedSystems: [],
      relevantSheets: [],
      relevantStations: [],
      dataCompleteness: 'sparse',
    },
    findings: [],
    gaps: sufficiency.gaps.map(g => ({
      description: g,
      gapType: classifyGapType(g),
      actionable: suggestGapResolution(g, analysis),
    })),
    recommendedAnswerFrame: 'standard',
    evidenceStrength: computeEvidenceStrength(sufficiency),
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Map evidence source to support level.
 * This is the single source of truth for support level assignment.
 * The model never overrides these values.
 */
function sourceToSupportLevel(source: EvidenceSourceType): SupportLevel {
  switch (source) {
    case 'vision_db':
    case 'direct_lookup':
    case 'project_summary':
      return 'explicit'
    case 'vector_search':
    case 'complete_data':
    case 'live_pdf_analysis':
      return 'inferred'
    default:
      return 'unknown'
  }
}

/** Extract unique system names from evidence content using pattern matching. */
function extractUniqueSystemNames(packet: EvidencePacket): string[] {
  const patterns = [
    /\bWATER\s+LINE\s+[A-Z\d]+\b/gi,
    /\bSTORM\s+DRAIN\s*[A-Z\d]*\b/gi,
    /\bSANITARY\s+SEWER\s*[A-Z\d]*\b/gi,
    /\bRECLAIMED\s+WATER\s*[A-Z\d]*\b/gi,
    /\bCONDUIT\s*[A-Z\d]*\b/gi,
    /\bGAS\s+LINE\s*[A-Z\d]*\b/gi,
    /\bFORCE\s+MAIN\s*[A-Z\d]*\b/gi,
  ]

  const names = new Set<string>()

  for (const item of packet.items) {
    for (const pattern of patterns) {
      // Reset lastIndex since we're reusing the regex across items
      pattern.lastIndex = 0
      const matches = item.content.match(pattern)
      if (matches) {
        matches.forEach(m => names.add(m.trim().toUpperCase().replace(/\s+/g, ' ')))
      }
    }
  }

  return Array.from(names)
}

/** Map a system name to a canonical type key for sequence lookup. */
function classifySystemType(systemName: string): string | null {
  const upper = systemName.toUpperCase()
  if (/WATER/.test(upper) && !/RECLAIM/.test(upper)) return 'water'
  if (/STORM|DRAIN/.test(upper)) return 'storm'
  if (/SEWER|SANITARY|SS\b/.test(upper)) return 'sewer'
  if (/CONDUIT|ELECTRICAL|ELEC/.test(upper)) return 'conduit'
  return null
}

/** Group evidence items by detected system name (best-effort). */
function groupItemsBySystem(items: EvidenceItem[]): Record<string, EvidenceItem[]> {
  const groups: Record<string, EvidenceItem[]> = { General: [] }
  const systemPattern =
    /\b(WATER\s+LINE\s+[A-Z\d]+|STORM\s+DRAIN\s*[A-Z\d]*|SANITARY\s+SEWER\s*[A-Z\d]*|CONDUIT\s*[A-Z\d]*|GAS\s+LINE\s*[A-Z\d]*)\b/i

  for (const item of items) {
    const match = item.content.match(systemPattern)
    if (match) {
      const key = match[1].toUpperCase().replace(/\s+/g, ' ').trim()
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    } else {
      groups['General'].push(item)
    }
  }

  return groups
}

/** Trim text to approximately N sentences. */
function trimToSentences(text: string, n: number): string {
  // Split on sentence-ending punctuation followed by whitespace or end-of-string
  const sentences = text.split(/(?<=[.!?])(?:\s+|$)/).filter(Boolean)
  return sentences.slice(0, n).join(' ').trim()
}

/** Classify a gap description into a GapType. */
function classifyGapType(description: string): GapType {
  const lower = description.toLowerCase()
  if (/spec|requirement|standard|section/.test(lower)) return 'missing_spec'
  if (/cap|limit.*sheet|sheet.*limit/.test(lower)) return 'partial_live_analysis'
  if (/structured|vision.*data|database|vision.*process/.test(lower))
    return 'insufficient_structured_data'
  if (/sheet|coverage|skip|not.*process|not.*analyz/.test(lower)) return 'missing_sheet_coverage'
  if (/scope|overall|entire|project-wide/.test(lower)) return 'unknown_scope'
  if (/system|pipeline|utility|missing.*data/.test(lower)) return 'incomplete_system_coverage'
  return 'unknown_scope'
}

/** Suggest an actionable resolution for a known gap. */
function suggestGapResolution(gap: string, analysis: QueryAnalysis): string | undefined {
  const lower = gap.toLowerCase()
  if (/vision|structured|database/.test(lower)) {
    return 'Run vision processing using the Analyze button to extract structured data from PDF sheets'
  }
  if (/spec|requirement|standard/.test(lower)) {
    return 'Upload and ingest specification documents to enable spec queries'
  }
  if (/sheet|coverage|skip/.test(lower)) {
    return 'Ensure all project sheets are uploaded and have been processed'
  }
  if (/cap|limit/.test(lower)) {
    return 'Run full background vision processing via the Analyze button'
  }
  void analysis
  return undefined
}
