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

    case 'demo_scope':
      return 'demo_scope_reasoning'

    case 'demo_constraint':
      return 'demo_constraint_reasoning'

    case 'arch_element_lookup':
      return 'arch_element_reasoning'

    case 'arch_room_scope':
    case 'arch_schedule_query':
      return 'arch_room_scope_reasoning'

    // Phase 5A — structural
    case 'struct_element_lookup':
      return 'struct_element_reasoning'

    case 'struct_area_scope':
      return 'struct_area_reasoning'

    // Phase 5A — MEP
    case 'mep_element_lookup':
      return 'mep_element_reasoning'

    case 'mep_area_scope':
      return 'mep_area_reasoning'

    // Phase 5B — coordination
    case 'trade_coordination':
      return 'trade_overlap_reasoning'

    case 'coordination_sequence':
      return 'coordination_constraint_reasoning'

    case 'affected_area':
      return 'affected_area_reasoning'

    // Phase 6A — spec
    case 'spec_section_lookup':
    case 'spec_requirement_lookup':
      return 'requirement_reasoning'

    // Phase 6B — RFI / changes
    case 'rfi_lookup':
    case 'change_impact_lookup':
      return 'change_reasoning'

    // Phase 6C — governing / submittal
    case 'governing_document_query':
      return 'governing_document_reasoning'

    case 'submittal_lookup': {
      // Only activate when we have structured data to reason over
      const hasData = packet.items.some(i => i.source === 'vision_db')
      return hasData ? 'governing_document_reasoning' : 'none'
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
    case 'demo_scope_reasoning':
      return generateDemoScopeFindings(packet)
    case 'demo_constraint_reasoning':
      return generateDemoConstraintFindings(packet)
    case 'arch_element_reasoning':
      return generateArchElementFindings(packet)
    case 'arch_room_scope_reasoning':
      return generateArchRoomScopeFindings(packet)
    // Phase 5A
    case 'struct_element_reasoning':
      return generateStructuralElementFindings(packet)
    case 'struct_area_reasoning':
      return generateStructuralAreaFindings(packet)
    case 'mep_element_reasoning':
      return generateMEPElementFindings(packet)
    case 'mep_area_reasoning':
      return generateMEPAreaFindings(packet)
    // Phase 5B
    case 'trade_overlap_reasoning':
      return generateTradeOverlapFindings(analysis, packet)
    case 'coordination_constraint_reasoning':
      return generateCoordinationConstraintFindings(packet)
    case 'affected_area_reasoning':
      return generateAffectedAreaFindings(packet)
    // Phase 6
    case 'requirement_reasoning':
      return generateRequirementFindings(packet)
    case 'change_reasoning':
      return generateChangeFindings(packet)
    case 'governing_document_reasoning':
      return generateGoverningDocFindings(packet)
    case 'requirement_gap_reasoning':
      return generateRequirementGapFindings(packet)
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

// ── demo_scope_reasoning ───────────────────────────────────────────────────

const DEMO_SCOPE_CONTENT_KEYWORDS =
  /remov|demo(?:lish)?|remain|protect|relocat|dispose/i

/**
 * Generate findings for demo scope queries.
 *
 * Support level rules:
 *   explicit  — entity came from vision_db (demo graph extraction)
 *   inferred  — entity came from vector/text search
 *   unknown   — entity has status='unknown' (surfaced as gap, not finding)
 */
function generateDemoScopeFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  // Vision DB items are pre-formatted demo scope content → explicit
  const demoGraphItems = packet.items.filter(i => i.source === 'vision_db')

  for (const item of demoGraphItems) {
    // Split the formatted content into sections (each section is a status group)
    const sections = item.content
      .split('\n\n')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('Based on') && !s.startsWith('No demo'))

    for (const section of sections.slice(0, 6)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Vision-extracted from demo drawing',
      })
    }
  }

  // Vector search items with demo language → inferred
  const vectorDemoItems = packet.items.filter(
    i =>
      (i.source === 'vector_search' || i.source === 'complete_data') &&
      DEMO_SCOPE_CONTENT_KEYWORDS.test(i.content)
  )

  for (const item of vectorDemoItems.slice(0, 3)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — demolition scope language detected',
    })
  }

  return findings
}

// ── demo_constraint_reasoning ──────────────────────────────────────────────

const DEMO_CONSTRAINT_CONTENT_KEYWORDS =
  /verify|confirm|check|coordinate|risk|hazard|protect|isolat|prior\s+to|before\s+demo|asbestos|lead/i

/** Standard pre-demolition cautions — always inferred (industry practice). */
const STANDARD_DEMO_CAUTIONS = [
  {
    statement:
      'Confirm all utilities serving the demolition area are isolated and capped prior to work.',
    trigger: /utility.*isolat|isolat.*utilit|utilities.*disconn/i,
  },
  {
    statement:
      'Verify a hazardous material survey (ACM/LBP) is complete before disturbing any wall finishes, ceiling tiles, or mastic.',
    trigger: /asbestos|lead\s+paint|hazmat|acm|lbp/i,
  },
  {
    statement:
      'Confirm structural engineer has reviewed any walls or elements to be removed near load-bearing lines.',
    trigger: /structural|load.?bearing|shear\s+wall/i,
  },
  {
    statement:
      'Coordinate fire protection (sprinkler) shutoff sequence with fire protection contractor before demo starts.',
    trigger: /sprinkler|fire\s+protect/i,
  },
]

/**
 * Generate findings for demo constraint queries ("what to verify before demo").
 *
 * Support level:
 *   explicit  — risk notes / requirements from the demo entity graph
 *   inferred  — industry-practice cautions not explicitly documented
 */
function generateDemoConstraintFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []
  const explicitStatements = new Set<string>()

  // Vision DB constraint data → explicit
  const demoGraphItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of demoGraphItems) {
    const lines = item.content
      .split('\n')
      .filter(l => l.startsWith('•'))

    for (const line of lines.slice(0, 8)) {
      const stmt = line.replace(/^•\s*/, '').trim()
      if (!stmt) continue
      findings.push({
        statement:    stmt,
        supportLevel: 'explicit',
        basis:        'Vision-extracted from demo notes / keynotes',
      })
      explicitStatements.add(stmt.toLowerCase().substring(0, 40))
    }
  }

  // Apply standard inferred cautions that aren't already covered explicitly
  const combinedExplicit = findings.map(f => f.statement).join(' ').toLowerCase()
  for (const caution of STANDARD_DEMO_CAUTIONS) {
    if (!caution.trigger.test(combinedExplicit)) {
      findings.push({
        statement:    caution.statement,
        supportLevel: 'inferred',
        basis:        'Standard pre-demolition practice — not explicitly stated in these drawings',
      })
    }
  }

  // Vector search items with constraint language → inferred
  const vectorItems = packet.items.filter(
    i =>
      (i.source === 'vector_search' || i.source === 'complete_data') &&
      DEMO_CONSTRAINT_CONTENT_KEYWORDS.test(i.content)
  )
  for (const item of vectorItems.slice(0, 3)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — constraint / verification language detected',
    })
  }

  return findings
}

// ── arch_element_reasoning ─────────────────────────────────────────────────

/**
 * Generate findings for a specific architectural element query (door, window,
 * finish tag, etc.).
 *
 * Support level rules:
 *   explicit — entity from vision_db (arch graph extraction)
 *   inferred — from vector/text search mentioning the tag
 */
function generateArchElementFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  // Vision DB arch graph items → explicit
  const archGraphItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of archGraphItems) {
    const sections = item.content
      .split('\n\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    for (const section of sections.slice(0, 5)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Vision-extracted from architectural drawings',
      })
    }
  }

  // Vector search items → inferred supplemental context
  const vectorItems = packet.items.filter(
    i => i.source === 'vector_search' || i.source === 'complete_data'
  )
  for (const item of vectorItems.slice(0, 3)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — architectural element reference detected',
    })
  }

  return findings
}

// ── arch_room_scope_reasoning ──────────────────────────────────────────────

const ARCH_ROOM_CONTENT_KEYWORDS = /room|space|occupan|finish|door|window|ceiling/i

/**
 * Generate findings for an architectural room scope or schedule query.
 *
 * Support level rules:
 *   explicit — arch entity from vision_db
 *   inferred — vector/text items with room or space language
 */
function generateArchRoomScopeFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  // Vision DB arch graph items → explicit
  const archGraphItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of archGraphItems) {
    const sections = item.content
      .split('\n\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    for (const section of sections.slice(0, 6)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Vision-extracted from architectural floor plan and schedules',
      })
    }
  }

  // Vector items with room/space language → inferred
  const vectorItems = packet.items.filter(
    i =>
      (i.source === 'vector_search' || i.source === 'complete_data') &&
      ARCH_ROOM_CONTENT_KEYWORDS.test(i.content)
  )
  for (const item of vectorItems.slice(0, 3)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — room or space reference detected',
    })
  }

  return findings
}

// ── struct_element_reasoning ───────────────────────────────────────────────

/**
 * Generate findings for a structural element lookup (footing, column, beam, etc.).
 * Support level: explicit = from vision_db; inferred = vector text.
 */
function generateStructuralElementFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  const structItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of structItems) {
    const sections = item.content.split('\n\n').map(s => s.trim()).filter(s => s.length > 0)
    for (const section of sections.slice(0, 5)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Vision-extracted from structural drawings',
      })
    }
  }

  const vectorItems = packet.items.filter(
    i => i.source === 'vector_search' || i.source === 'complete_data'
  )
  for (const item of vectorItems.slice(0, 3)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — structural element reference',
    })
  }

  return findings
}

// ── struct_area_reasoning ──────────────────────────────────────────────────

function generateStructuralAreaFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  const structItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of structItems) {
    const sections = item.content.split('\n\n').map(s => s.trim()).filter(s => s.length > 0)
    for (const section of sections.slice(0, 6)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Vision-extracted from structural plans',
      })
    }
  }

  const vectorItems = packet.items.filter(
    i => i.source === 'vector_search' || i.source === 'complete_data'
  )
  for (const item of vectorItems.slice(0, 2)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — structural area reference',
    })
  }

  return findings
}

// ── mep_element_reasoning ──────────────────────────────────────────────────

function generateMEPElementFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  const mepItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of mepItems) {
    const sections = item.content.split('\n\n').map(s => s.trim()).filter(s => s.length > 0)
    for (const section of sections.slice(0, 5)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Vision-extracted from MEP drawings',
      })
    }
  }

  const vectorItems = packet.items.filter(
    i => i.source === 'vector_search' || i.source === 'complete_data'
  )
  for (const item of vectorItems.slice(0, 3)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — MEP element reference',
    })
  }

  return findings
}

// ── mep_area_reasoning ─────────────────────────────────────────────────────

function generateMEPAreaFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  const mepItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of mepItems) {
    const sections = item.content.split('\n\n').map(s => s.trim()).filter(s => s.length > 0)
    for (const section of sections.slice(0, 6)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Vision-extracted from MEP plans',
      })
    }
  }

  const vectorItems = packet.items.filter(
    i => i.source === 'vector_search' || i.source === 'complete_data'
  )
  for (const item of vectorItems.slice(0, 2)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — MEP area reference',
    })
  }

  return findings
}

// ── trade_overlap_reasoning ────────────────────────────────────────────────

/**
 * Standard coordination cautions triggered by detected discipline combinations.
 * These are ALWAYS inferred (industry practice).
 * trigger: regex tested against the combined formattedAnswer content.
 */
const STANDARD_COORDINATION_CAUTIONS: Array<{
  statement: string
  trigger: RegExp
}> = [
  {
    statement:
      'Coordinate MEP utility isolation with demo contractor before demolition begins in this area — confirm which MEP services are live vs. capped.',
    trigger: /demo.*mep|mep.*demo|mechanical.*demo|electrical.*demo|plumbing.*demo/i,
  },
  {
    statement:
      'Structural penetrations for duct, pipe, or conduit require engineer review and proper framing — do not core or cut structural members without approved drawings.',
    trigger: /structural.*(mechanical|electrical|plumbing|duct|pipe|conduit)|structural.*mep/i,
  },
  {
    statement:
      'ACT (acoustic ceiling tile) grid layout must coordinate with mechanical diffuser, sprinkler head, and light fixture locations — set out grid to center devices in tile modules.',
    trigger: /ceiling|act|architectural.*mechanical|mechanical.*architectural/i,
  },
  {
    statement:
      'Maintain minimum 6-inch clearance between parallel electrical conduit runs and plumbing piping; separate by at least 12 inches from high-voltage conduit.',
    trigger: /electrical.*plumbing|plumbing.*electrical/i,
  },
  {
    statement:
      'HVAC duct routing through structural bays requires coordination with structural drawings — verify header and joist clearances before duct shop drawings are released.',
    trigger: /mechanical.*structural|structural.*duct|hvac.*structural/i,
  },
  {
    statement:
      'With multiple disciplines present, a pre-installation coordination meeting is recommended before rough-in begins.',
    trigger: /./, // Always fires when 3+ trades present (checked in function)
  },
]

/**
 * Generate findings for trade coordination / what trades are in this room.
 */
function generateTradeOverlapFindings(
  analysis: QueryAnalysis,
  packet: EvidencePacket
): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  // Vision DB coordination data → explicit
  const coordItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of coordItems) {
    const sections = item.content.split('\n\n').map(s => s.trim()).filter(s => s.length > 0)
    for (const section of sections.slice(0, 8)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Entity graph — cross-discipline location data',
      })
    }
  }

  // Apply standard coordination cautions based on discipline combinations found
  const combinedContent = packet.items.map(i => i.content).join(' ').toLowerCase()
  const explicitStatements = findings.map(f => f.statement.toLowerCase())
  const tradeCount = (combinedContent.match(
    /\b(architectural|structural|electrical|mechanical|plumbing|demo)\b/g
  ) ?? []).length

  for (let i = 0; i < STANDARD_COORDINATION_CAUTIONS.length; i++) {
    const caution = STANDARD_COORDINATION_CAUTIONS[i]
    // Last caution (general meeting) only fires when 3+ trades are present
    if (i === STANDARD_COORDINATION_CAUTIONS.length - 1 && tradeCount < 3) continue

    if (
      caution.trigger.test(combinedContent) &&
      !explicitStatements.some(s => s.includes(caution.statement.substring(0, 40).toLowerCase()))
    ) {
      findings.push({
        statement:    caution.statement,
        supportLevel: 'inferred',
        basis:        'Standard construction coordination practice — not drawn explicitly',
      })
    }
  }

  // Vector items → inferred supplemental
  const vectorItems = packet.items.filter(
    i => i.source === 'vector_search' || i.source === 'complete_data'
  )
  for (const item of vectorItems.slice(0, 2)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — coordination reference',
    })
  }

  void analysis
  return findings
}

// ── coordination_constraint_reasoning ─────────────────────────────────────

const CONSTRAINT_KEYWORDS_COORD =
  /remain|protect|to_remain|to_protect|constraint|hold|block|prevent|sequence|prior\s+to|before\s+start/i

/**
 * Generate findings for coordination constraint queries ("what could hold this up").
 */
function generateCoordinationConstraintFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  const coordItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of coordItems) {
    const sections = item.content.split('\n\n').map(s => s.trim()).filter(s => s.length > 0)
    for (const section of sections.slice(0, 8)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Entity graph — coordination and constraint data',
      })
    }
  }

  const vectorItems = packet.items.filter(
    i =>
      (i.source === 'vector_search' || i.source === 'complete_data') &&
      CONSTRAINT_KEYWORDS_COORD.test(i.content)
  )
  for (const item of vectorItems.slice(0, 3)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — constraint or sequencing language detected',
    })
  }

  return findings
}

// ── affected_area_reasoning ────────────────────────────────────────────────

function generateAffectedAreaFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  const areaItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of areaItems) {
    const sections = item.content.split('\n\n').map(s => s.trim()).filter(s => s.length > 0)
    for (const section of sections.slice(0, 8)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Entity graph — affected area discipline count',
      })
    }
  }

  const vectorItems = packet.items.filter(
    i => i.source === 'vector_search' || i.source === 'complete_data'
  )
  for (const item of vectorItems.slice(0, 2)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — area scope reference',
    })
  }

  return findings
}

// ── requirement_reasoning (Phase 6A) ───────────────────────────────────────

/**
 * Generate findings for spec requirement queries.
 *
 * Support level rules:
 *   explicit — requirement from spec entity in vision_db (ingested spec section)
 *   inferred — from vector_search text mentioning requirement keywords
 */
function generateRequirementFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  // Vision DB spec graph items → explicit
  const specItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of specItems) {
    const sections = item.content
      .split('\n\n')
      .map(s => s.trim())
      .filter(s => s.length > 20)

    for (const section of sections.slice(0, 12)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Extracted from ingested specification section',
      })
    }
  }

  // Vector search items with requirement language → inferred supplemental
  const REQUIREMENT_KEYWORDS = /\bshall\b|\brequired?\b|\bmust\b|\bspecified?\b/i
  const vectorItems = packet.items.filter(
    i =>
      (i.source === 'vector_search' || i.source === 'complete_data') &&
      REQUIREMENT_KEYWORDS.test(i.content)
  )
  for (const item of vectorItems.slice(0, 4)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — requirement language detected',
    })
  }

  return findings
}

// ── change_reasoning (Phase 6B) ─────────────────────────────────────────────

/**
 * Generate findings for RFI / change document queries.
 *
 * Support level rules:
 *   explicit — answered RFI / ASI / addendum from vision_db
 *   inferred — open/unanswered RFI, or vector search hit mentioning change language
 */
function generateChangeFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  const rfiItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of rfiItems) {
    // Open RFI warning
    if (/OPEN\s*\/\s*Unanswered/i.test(item.content)) {
      const lines = item.content.split('\n').filter(l => l.trim().length > 0).slice(0, 6)
      for (const line of lines) {
        findings.push({
          statement:    line.replace(/^\*\*|\*\*$/g, ''),
          supportLevel: 'inferred',
          basis:        'Open / unanswered change document — resolution not confirmed',
        })
      }
      continue
    }

    // Answered RFI → explicit
    const sections = item.content.split('\n\n').map(s => s.trim()).filter(s => s.length > 10)
    for (const section of sections.slice(0, 8)) {
      findings.push({
        statement:    section,
        supportLevel: 'explicit',
        basis:        'Answered change document — issued and acknowledged',
      })
    }
  }

  // Vector items with change language → inferred
  const CHANGE_KEYWORDS = /\bRFI\b|\baddendum\b|\bclarif|\bsupersed|\brevise|\bchange\b/i
  const vectorItems = packet.items.filter(
    i =>
      (i.source === 'vector_search' || i.source === 'complete_data') &&
      CHANGE_KEYWORDS.test(i.content)
  )
  for (const item of vectorItems.slice(0, 3)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — change or clarification language detected',
    })
  }

  return findings
}

// ── governing_document_reasoning (Phase 6C) ────────────────────────────────

/**
 * Generate findings for governing document queries.
 *
 * Support level rules:
 *   explicit — from resolved authority in the governing doc result
 *   inferred — from vector search or unresolved conflict
 */
function generateGoverningDocFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  const govItems = packet.items.filter(i => i.source === 'vision_db')
  for (const item of govItems) {
    // Flag conflicts as inferred
    const hasConflict = /⚠️|conflict|unresolved/i.test(item.content)

    const sections = item.content
      .split('\n\n')
      .map(s => s.trim())
      .filter(s => s.length > 15)

    for (const section of sections.slice(0, 10)) {
      const supportLevel: SupportLevel = hasConflict && /⚠️|conflict|unresolved/i.test(section)
        ? 'inferred'
        : 'explicit'

      findings.push({
        statement:    section,
        supportLevel,
        basis:        supportLevel === 'inferred'
          ? 'Unresolved conflict between documents — verify with project team'
          : 'Governing document analysis — precedence applied per industry default',
      })
    }
  }

  // Vector items → inferred supplemental (precedence language)
  const PREC_KEYWORDS = /\bgovern|\bprecedence\b|\bsupersed|\bcontrol/i
  const vectorItems = packet.items.filter(
    i =>
      (i.source === 'vector_search' || i.source === 'complete_data') &&
      PREC_KEYWORDS.test(i.content)
  )
  for (const item of vectorItems.slice(0, 2)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Document text — governing / precedence language detected',
    })
  }

  return findings
}

// ── requirement_gap_reasoning (Phase 6) ────────────────────────────────────

/**
 * Generate gap-focused findings when spec data is partial.
 */
function generateRequirementGapFindings(packet: EvidencePacket): ReasoningFinding[] {
  const findings: ReasoningFinding[] = []

  // Passthrough: treat all items as inferred since this mode fires when data is sparse
  for (const item of packet.items.slice(0, 5)) {
    findings.push({
      statement:    trimToSentences(item.content, 2),
      supportLevel: 'inferred',
      citations:    item.citation ? [item.citation] : undefined,
      basis:        'Partial spec data — section may not yet be fully ingested',
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

  // Arch-specific gaps
  if (
    analysis.answerMode === 'arch_element_lookup' ||
    analysis.answerMode === 'arch_room_scope'     ||
    analysis.answerMode === 'arch_schedule_query'
  ) {
    const hasArchData = packet.items.some(i => i.source === 'vision_db')

    if (!hasArchData && !gaps.some(g => g.gapType === 'insufficient_structured_data')) {
      gaps.push({
        description:
          'No architectural entities extracted yet — architectural floor plan or schedule sheets may not have been processed',
        gapType: 'insufficient_structured_data',
        actionable:
          'Process architectural sheets (A-xxx) using the Analyze function to extract rooms, doors, windows, and schedule data',
      })
    }
  }

  // Phase 5A: Structural-specific gaps
  if (
    analysis.answerMode === 'struct_element_lookup' ||
    analysis.answerMode === 'struct_area_scope'
  ) {
    const hasStructData = packet.items.some(i => i.source === 'vision_db')
    if (!hasStructData && !gaps.some(g => g.gapType === 'insufficient_structured_data')) {
      gaps.push({
        description:
          'No structural entities extracted yet — structural plan sheets (S-xxx) may not have been processed',
        gapType: 'insufficient_structured_data',
        actionable:
          'Process structural sheets (S-xxx) using the Analyze function to extract footings, columns, beams, and grid data',
      })
    }
  }

  // Phase 5A: MEP-specific gaps
  if (analysis.answerMode === 'mep_element_lookup' || analysis.answerMode === 'mep_area_scope') {
    const hasMEPData = packet.items.some(i => i.source === 'vision_db')
    if (!hasMEPData && !gaps.some(g => g.gapType === 'insufficient_structured_data')) {
      gaps.push({
        description:
          'No MEP entities extracted yet — mechanical (M-xxx), electrical (E-xxx), or plumbing (P-xxx) sheets may not have been processed',
        gapType: 'insufficient_structured_data',
        actionable:
          'Process MEP sheets using the Analyze function to extract panels, equipment, fixtures, and schedule data',
      })
    }
  }

  // Phase 5B: Coordination-specific gaps
  if (
    analysis.answerMode === 'trade_coordination'    ||
    analysis.answerMode === 'coordination_sequence' ||
    analysis.answerMode === 'affected_area'
  ) {
    const hasCoordData = packet.items.some(i => i.source === 'vision_db')
    if (!hasCoordData && !gaps.some(g => g.gapType === 'insufficient_structured_data')) {
      gaps.push({
        description:
          'No cross-discipline entity data found for this location — sheets from one or more disciplines may not have been processed',
        gapType: 'insufficient_structured_data',
        actionable:
          'Process plan sheets for all relevant disciplines (A-xxx, S-xxx, M-xxx, E-xxx, P-xxx) to enable coordination queries',
      })
    }
  }

  // Phase 6A: Spec-specific gaps
  if (
    analysis.answerMode === 'spec_section_lookup' ||
    analysis.answerMode === 'spec_requirement_lookup'
  ) {
    const hasSpecData = packet.items.some(i => i.source === 'vision_db')
    if (!hasSpecData && !gaps.some(g => g.gapType === 'spec_section_not_ingested')) {
      gaps.push({
        description:
          'No specification sections found in the project database. ' +
          'Specification documents have not been ingested yet.',
        gapType: 'spec_section_not_ingested',
        actionable:
          'Upload and process specification documents (PDF or text) to enable requirement queries.',
      })
    }
  }

  // Phase 6B: RFI-specific gaps
  if (
    analysis.answerMode === 'rfi_lookup' ||
    analysis.answerMode === 'change_impact_lookup'
  ) {
    const hasRFIData = packet.items.some(i => i.source === 'vision_db')
    if (!hasRFIData && !gaps.some(g => g.gapType === 'insufficient_structured_data')) {
      gaps.push({
        description:
          'No change documents (RFIs, ASIs, addenda, bulletins) found in the project database.',
        gapType: 'insufficient_structured_data',
        actionable:
          'Upload RFI logs, individual RFIs, or addenda to enable change impact queries.',
      })
    }

    // Warn about open/unanswered RFIs in the result
    const hasOpenRFIs = packet.items.some(
      i => i.source === 'vision_db' && /OPEN\s*\/\s*Unanswered/i.test(i.content)
    )
    if (hasOpenRFIs && !gaps.some(g => g.gapType === 'missing_rfi_resolution')) {
      gaps.push({
        description:
          'One or more RFIs are open and unanswered. The clarification is not yet confirmed.',
        gapType: 'missing_rfi_resolution',
        actionable:
          'Verify RFI response status with the project team or architect before proceeding.',
      })
    }
  }

  // Phase 6C: Governing document gaps
  if (analysis.answerMode === 'governing_document_query') {
    const hasConflict = packet.items.some(
      i => i.source === 'vision_db' && /conflict|unresolved|⚠️/i.test(i.content)
    )
    if (hasConflict && !gaps.some(g => g.gapType === 'conflicting_documents')) {
      gaps.push({
        description:
          'Document conflict detected. The governing precedence cannot be fully determined from available data.',
        gapType: 'conflicting_documents',
        actionable:
          'Consult with the project architect or engineer to obtain a written ruling on precedence.',
      })
    }
  }

  // Demo-specific gaps
  if (analysis.answerMode === 'demo_scope' || analysis.answerMode === 'demo_constraint') {
    const hasDemoData = packet.items.some(i => i.source === 'vision_db')

    if (!hasDemoData && !gaps.some(g => g.gapType === 'insufficient_structured_data')) {
      gaps.push({
        description:
          'No demo entities extracted yet — demo plan sheets may not have been processed',
        gapType: 'insufficient_structured_data',
        actionable:
          'Process demo plan sheets (D-xxx, DM-xxx, DRCP-xxx) using the Analyze function',
      })
    }

    // Flag unknown-status entities if we have demo data
    if (hasDemoData) {
      const hasUnknown = packet.items.some(
        i => i.source === 'vision_db' && i.content.includes('STATUS UNKNOWN')
      )
      if (hasUnknown && !gaps.some(g => g.description.includes('unknown status'))) {
        gaps.push({
          description:
            'Some entities have unknown demo status — marking, hatch patterns, or keynotes were unclear in the drawing',
          gapType: 'unknown_scope',
          actionable:
            'Review original demo sheets to confirm status of items marked STATUS UNKNOWN',
        })
      }
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

    case 'demo_scope_reasoning':
      return hasExplicit ? 'demo_scope_with_citations' : 'demo_scope_inferred'

    case 'demo_constraint_reasoning':
      return hasExplicit ? 'demo_constraints_documented' : 'demo_constraints_inferred'

    case 'arch_element_reasoning':
      return hasExplicit ? 'arch_element_with_schedule' : 'arch_element_inferred'

    case 'arch_room_scope_reasoning':
      return hasExplicit ? 'arch_room_scope_detailed' : 'arch_room_scope_partial'

    // Phase 5A
    case 'struct_element_reasoning':
      return hasExplicit ? 'struct_element_with_data' : 'struct_element_inferred'

    case 'struct_area_reasoning':
      return hasExplicit ? 'struct_area_grouped' : 'struct_area_inferred'

    case 'mep_element_reasoning':
      return hasExplicit ? 'mep_element_with_schedule' : 'mep_element_inferred'

    case 'mep_area_reasoning':
      return hasExplicit ? 'mep_area_by_trade' : 'mep_area_inferred'

    // Phase 5B
    case 'trade_overlap_reasoning':
      return hasExplicit ? 'trade_coordination_detailed' : 'trade_coordination_inferred'

    case 'coordination_constraint_reasoning':
      return hasExplicit ? 'coordination_constraints_documented' : 'coordination_constraints_inferred'

    case 'affected_area_reasoning':
      return hasExplicit ? 'affected_area_by_discipline' : 'affected_area_inferred'

    // Phase 6
    case 'requirement_reasoning':
      return hasExplicit ? 'requirements_with_citations' : 'requirements_from_text'

    case 'change_reasoning':
      return hasExplicit ? 'change_impact_documented' : 'change_impact_inferred'

    case 'governing_document_reasoning':
      return hasExplicit ? 'governing_doc_hierarchy' : 'governing_doc_partial'

    case 'requirement_gap_reasoning':
      return 'requirement_gaps_identified'

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
  // Phase 6 specific gaps (check first — more specific)
  if (/rfi.*open|open.*rfi|unanswered|resolution.*not.*confirm/.test(lower))
    return 'missing_rfi_resolution'
  if (/conflict|discrepancy|preceden/.test(lower)) return 'conflicting_documents'
  if (/submittal.*not.*link|unlink.*submittal/.test(lower)) return 'unlinked_submittal'
  if (/specification.*not.*ingest|spec.*section.*not.*found|spec.*not.*yet/.test(lower))
    return 'spec_section_not_ingested'
  // Existing
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
