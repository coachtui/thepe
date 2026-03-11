// @ts-nocheck
/**
 * Pipeline Evaluation Harness
 *
 * Exercises analyzeQuery() and evaluateSufficiency() across all answer modes
 * without touching the database or network.
 *
 * Run: npx tsx src/lib/chat/__tests__/pipeline-eval.ts
 *
 * Sections:
 *   1. analyzeQuery() — answer mode routing (includes correction-layer cases)
 *   2. evaluateSufficiency() — evidence gating (includes tuning cases)
 *   3. Threshold analysis — score math across evidence scenarios
 *   4. Correction layer validation — before/after for correction-specific queries
 */

import { analyzeQuery } from '../query-analyzer'
import { evaluateSufficiency } from '../evidence-evaluator'
import type {
  AnswerMode,
  EvidencePacket,
  EvidenceItem,
  EvidenceSourceType,
  QueryAnalysis,
} from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0

function check(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.log(`  ✗ ${label}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
    failed++
  }
}

function checkTruthy(label: string, actual: unknown): void {
  if (actual) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.log(`  ✗ ${label}`)
    console.log(`      expected truthy, got: ${JSON.stringify(actual)}`)
    failed++
  }
}

function makePacket(
  analysis: QueryAnalysis,
  items: EvidenceItem[],
  retrievalMethod = 'test'
): EvidencePacket {
  return {
    answerMode: analysis.answerMode,
    query: analysis.rawQuery,
    items,
    formattedContext: '',
    sources: [],
    retrievalMethod,
  }
}

function makeItem(
  source: EvidenceSourceType,
  confidence = 0.85,
  content = 'sample evidence'
): EvidenceItem {
  return { source, confidence, content }
}

function makeItemWithCitation(
  source: EvidenceSourceType,
  confidence = 0.85,
  sheetNumber?: string,
  content = 'sample evidence'
): EvidenceItem {
  return {
    source,
    confidence,
    content,
    citation: sheetNumber ? { sheetNumber } : undefined,
  }
}

// ---------------------------------------------------------------------------
// Section 1 — Analysis cases
// ---------------------------------------------------------------------------

interface TestCase {
  label: string
  query: string
  expectedMode: AnswerMode
  expectedInferenceAllowed?: boolean
  expectedSupport?: 'supported' | 'partial' | 'unsupported'
  expectedVisionLookup?: boolean
  expectedVisionSubtype?: 'component' | 'crossing' | 'length'
}

const ANALYSIS_CASES: TestCase[] = [
  // ── Quantity / Component ──────────────────────────────────────────────────
  {
    label: 'Quantity: gate valve count with size filter',
    query: 'How many 12-IN gate valves are on Water Line A?',
    expectedMode: 'quantity_lookup',
    expectedInferenceAllowed: false,
    expectedVisionLookup: true,
    expectedVisionSubtype: 'component',
  },
  {
    label: 'Quantity: hydrant count',
    query: 'How many fire hydrants are in the project?',
    expectedMode: 'quantity_lookup',
    expectedInferenceAllowed: false,
    expectedVisionLookup: true,
    expectedVisionSubtype: 'component',
  },
  {
    label: 'Quantity variant: "count" phrasing',
    query: 'Count the air release valves on Water Line B',
    expectedMode: 'quantity_lookup',
    expectedInferenceAllowed: false,
  },
  {
    label: 'Quantity variant: "total number of" phrasing',
    query: 'Total number of gate valves on Water Line A?',
    expectedMode: 'quantity_lookup',
    expectedInferenceAllowed: false,
  },
  {
    label: 'Quantity: total pipe count',
    query: 'What is the total pipe count for Storm Drain C?',
    expectedMode: 'quantity_lookup',
    expectedInferenceAllowed: false,
    expectedVisionLookup: true,
  },

  // ── Length (including correction-layer cases) ─────────────────────────────
  {
    label: 'Length: LF query on specific system',
    query: 'What is the total length of 8-IN PVC on Storm Drain C?',
    expectedMode: 'quantity_lookup',
    expectedInferenceAllowed: false,
    expectedVisionLookup: true,
    expectedVisionSubtype: 'length',
  },
  {
    label: '[CORRECTION] Length: plain "linear feet" — was component, now length',
    // determineVisionQueryType matches "how many" → component before "linear feet".
    // Correction 2 overrides visionQuerySubtype to 'length'.
    query: 'How many linear feet of water main are being installed?',
    expectedMode: 'quantity_lookup',
    expectedInferenceAllowed: false,
    expectedVisionLookup: true,
    expectedVisionSubtype: 'length',
  },
  {
    label: '[CORRECTION] Length: "total footage" phrasing',
    query: 'What is the total footage of 8-IN PVC on Water Line A?',
    expectedMode: 'quantity_lookup',
    expectedVisionLookup: true,
    expectedVisionSubtype: 'length',
  },
  {
    label: '[CORRECTION] Length: "feet of pipe" phrasing',
    query: 'How many feet of pipe are there on the water main?',
    expectedMode: 'quantity_lookup',
    expectedVisionLookup: true,
    expectedVisionSubtype: 'length',
  },

  // ── Crossing lookup ───────────────────────────────────────────────────────
  {
    label: 'Crossing: explicit crossing question',
    query: 'What utilities cross Water Line B?',
    expectedMode: 'crossing_lookup',
    expectedInferenceAllowed: false,
    expectedVisionLookup: true,
    expectedVisionSubtype: 'crossing',
  },
  {
    label: 'Crossing: conflict check phrasing',
    query: 'Any conflicts with existing utilities at station 15+00?',
    expectedMode: 'crossing_lookup',
    expectedInferenceAllowed: false,
    expectedVisionLookup: true,
    expectedVisionSubtype: 'crossing',
  },
  {
    label: 'Crossing: intersection phrasing',
    query: 'List all utility intersections on the sewer profile',
    expectedMode: 'crossing_lookup',
    expectedInferenceAllowed: false,
  },
  {
    label: 'Crossing variant: "below" phrasing',
    query: 'Do any utilities cross below the water main?',
    expectedMode: 'crossing_lookup',
    expectedInferenceAllowed: false,
  },
  {
    label: 'Control: crossing + project mention — explicit signal preserved',
    // "utilities cross" is an explicit crossing signal; project-scope guard must NOT fire.
    query: 'What utilities cross Water Line A across all stations?',
    expectedMode: 'crossing_lookup',
    expectedInferenceAllowed: false,
  },

  // ── Sheet lookup ──────────────────────────────────────────────────────────
  {
    label: 'Sheet lookup: plan view reference',
    query: 'Which sheet shows the plan view for Water Line A?',
    expectedMode: 'sheet_lookup',
  },
  {
    label: 'Sheet lookup: sheet number reference',
    query: 'What is on sheet C-201?',
    expectedMode: 'sheet_lookup',
  },

  // ── Scope / Project summary ───────────────────────────────────────────────
  {
    label: 'Scope summary: project description request',
    query: 'Give me an overview of the project scope',
    expectedMode: 'scope_summary',
  },
  {
    label: 'Scope summary: tell me about phrasing',
    query: 'Tell me about this project',
    expectedMode: 'scope_summary',
  },
  {
    label: 'Project summary: adjacent keyword pattern',
    query: 'Give me a project summary',
    expectedMode: 'project_summary',
  },
  {
    label: '[CORRECTION] Project-scope guard: "across the whole project" — was crossing_lookup',
    // "across" triggers crossing detection. Correction 3 checks for explicit
    // utility-crossing signal and, finding none, reverts to project_summary.
    query: 'Summarize all quantities across the whole project',
    expectedMode: 'project_summary',
  },
  {
    label: '[CORRECTION] Project-scope guard: "across the whole project" aggregation',
    // "across" triggers crossing detector; "whole project" triggers scope guard.
    query: 'What are the overall totals across the whole project?',
    expectedMode: 'project_summary',
  },

  // ── Sequence inference (including correction-layer cases) ─────────────────
  {
    label: 'Sequence: step-by-step phrasing (base classifier)',
    query: 'What are the steps for installing a gate valve?',
    expectedMode: 'sequence_inference',
  },
  {
    label: '[CORRECTION] Sequence: "typical construction sequence" — was document_lookup',
    // classifyQuery() returns 'detail' for "installing a water main"; the sequence
    // regex only fires on classification.type === 'general'. Correction 1 catches it.
    query: 'What is the typical construction sequence for installing a water main?',
    expectedMode: 'sequence_inference',
  },
  {
    label: '[CORRECTION] Sequence: "installation order" phrasing',
    query: 'What is the installation order for gate valves?',
    expectedMode: 'sequence_inference',
  },
  {
    label: '[CORRECTION] Sequence: "in what order" phrasing',
    query: 'In what order should I install the pipe sections?',
    expectedMode: 'sequence_inference',
  },
  {
    label: '[CORRECTION] Sequence: "what comes first" phrasing',
    query: 'What comes first, bedding or laying the pipe?',
    expectedMode: 'sequence_inference',
  },

  // ── Unsupported spec queries ──────────────────────────────────────────────
  {
    label: 'Spec: section reference query',
    query: 'What does Section 02720 say about pipe bedding requirements?',
    expectedMode: 'requirement_lookup',
    expectedSupport: 'unsupported',
  },
  {
    label: 'Spec: material standard query',
    query: 'What are the specification requirements for PVC pipe class?',
    expectedMode: 'requirement_lookup',
    expectedSupport: 'unsupported',
  },

  // ── General / Domain knowledge ────────────────────────────────────────────
  {
    label: 'General chat: domain knowledge question',
    query: 'What is a butterfly valve and how does it work?',
    expectedMode: 'general_chat',
  },
  {
    label: 'General chat: PE domain question',
    query: 'What is the difference between a tee and a wye fitting?',
    expectedMode: 'general_chat',
  },

  // ── Ambiguous / Conversational follow-ups ─────────────────────────────────
  {
    label: 'Ambiguous: bare quantity phrase',
    query: 'how much',
    expectedMode: 'general_chat',
  },
  {
    label: 'Conversational: follow-up without context',
    query: 'what about the 6-inch ones?',
    // No system name, no action verb — static analysis can't resolve without history.
    expectedMode: 'general_chat',
  },
  {
    label: 'Conversational: system follow-up',
    query: 'What about Water Line B?',
    expectedMode: 'general_chat',
  },
  {
    label: 'Conversational: ambiguous total request',
    query: "What's the total?",
    expectedMode: 'general_chat',
  },
  {
    label: 'Conversational: break-down request',
    query: 'Can you break that down by system?',
    expectedMode: 'general_chat',
  },
]

function runAnalysisCases(): void {
  console.log('\n' + '='.repeat(70))
  console.log('SECTION 1: analyzeQuery() — answer mode routing')
  console.log('  [CORRECTION] labels indicate correction-layer overrides')
  console.log('='.repeat(70))

  for (const tc of ANALYSIS_CASES) {
    console.log(`\n${tc.label}`)
    console.log(`  Query: "${tc.query}"`)

    const analysis = analyzeQuery(tc.query)
    console.log(`  Mode: ${analysis.answerMode}  |  Support: ${analysis.supportLevelExpected}  |  VisionDB: ${analysis.retrievalHints.needsVisionDBLookup}`)

    check('answerMode', analysis.answerMode, tc.expectedMode)

    if (tc.expectedInferenceAllowed !== undefined) {
      check('inferenceAllowed', analysis.inferenceAllowed, tc.expectedInferenceAllowed)
    }
    if (tc.expectedSupport !== undefined) {
      check('supportLevelExpected', analysis.supportLevelExpected, tc.expectedSupport)
    }
    if (tc.expectedVisionLookup !== undefined) {
      check('needsVisionDBLookup', analysis.retrievalHints.needsVisionDBLookup, tc.expectedVisionLookup)
    }
    if (tc.expectedVisionSubtype !== undefined) {
      check('visionQuerySubtype', analysis.retrievalHints.visionQuerySubtype, tc.expectedVisionSubtype)
    }

    checkTruthy('_routing populated', analysis._routing)
    checkTruthy('needsConversationContext always true', analysis.needsConversationContext)
  }
}

// ---------------------------------------------------------------------------
// Section 2 — Sufficiency cases
// ---------------------------------------------------------------------------

interface SufficiencyCase {
  label: string
  query: string
  items: EvidenceItem[]
  expectedLevel: 'sufficient' | 'partial' | 'insufficient'
  liveAnalysisMeta?: import('../types').LiveAnalysisMeta
}

const SUFFICIENCY_CASES: SufficiencyCase[] = [
  // ── General chat / sequence — always sufficient ───────────────────────────
  {
    label: 'General chat — no evidence: always sufficient (domain knowledge)',
    query: 'What is a gate valve?',
    items: [],
    expectedLevel: 'sufficient',
  },
  {
    label: 'Sequence inference — no evidence: always sufficient',
    query: 'What is the sequence for installing water pipe?',
    items: [],
    expectedLevel: 'sufficient',
  },

  // ── Spec queries — always insufficient ───────────────────────────────────
  {
    label: 'Spec query — unsupported domain: insufficient regardless of evidence',
    query: 'What are the specification requirements for pipe bedding?',
    items: [makeItem('vector_search', 0.9)],
    expectedLevel: 'insufficient',
  },

  // ── Quantity — no evidence ────────────────────────────────────────────────
  {
    label: 'Quantity lookup — no evidence: insufficient',
    query: 'How many gate valves are on Water Line A?',
    items: [],
    expectedLevel: 'insufficient',
  },

  // ── Quantity — vision DB ──────────────────────────────────────────────────
  {
    label: 'Quantity lookup — 2 vision_db items: sufficient',
    // Score: structured +0.40, mode bonus +0.10, avg conf 0.92 → +0.15 = 0.65 ✓
    query: 'How many gate valves are on Water Line A?',
    items: [
      makeItem('vision_db', 0.95),
      makeItem('vision_db', 0.90),
    ],
    expectedLevel: 'sufficient',
  },

  // ── Quantity — vector only ────────────────────────────────────────────────
  {
    label: 'Quantity lookup — 2 vector items: insufficient (not enough for partial)',
    // Score: 0.10 (2 vector) + 0 (conf < 0.80) + 0 (mode, no penalty since vector exists) = 0.10
    // Precise partial threshold: ≥ 0.35. 0.10 → insufficient.
    query: 'How many gate valves are on Water Line A?',
    items: [
      makeItem('vector_search', 0.75),
      makeItem('vector_search', 0.70),
    ],
    expectedLevel: 'insufficient',
  },
  {
    label: 'Quantity lookup — 4 high-confidence vector items: partial (post-tuning)',
    // Score: 0.20 (4 vector * 0.05) + 0.15 (avg conf 0.81 ≥ 0.80) + 0 (mode, neutral) = 0.35
    // Precisely at the partial threshold — vector-only can now reach partial.
    query: 'How many gate valves are on Water Line A?',
    items: [
      makeItem('vector_search', 0.85),
      makeItem('vector_search', 0.82),
      makeItem('vector_search', 0.80),
      makeItem('vector_search', 0.78),
    ],
    expectedLevel: 'partial',
  },

  // ── Crossing ──────────────────────────────────────────────────────────────
  {
    label: 'Crossing lookup — no evidence: insufficient',
    query: 'What utilities cross Water Line B?',
    items: [],
    expectedLevel: 'insufficient',
  },
  {
    label: 'Crossing lookup — 2 vision_db items: sufficient (post-tuning)',
    // Score: structured +0.40, mode bonus +0.10, avg conf 0.90 → +0.15 = 0.65 ✓
    // Correction adds +0.10 mode bonus (matching quantity_lookup), clearing the 0.65 threshold.
    query: 'What utilities cross Water Line B?',
    items: [
      makeItem('vision_db', 0.92),
      makeItem('vision_db', 0.88),
    ],
    expectedLevel: 'sufficient',
  },

  // ── Sheet lookup ──────────────────────────────────────────────────────────
  {
    label: 'Sheet lookup — 3 vector items, no citations: insufficient',
    // Score: 0.15 (3 vector) + 0 (conf 0.75) + 0 (mode, no citations) = 0.15
    // Non-precise partial threshold: ≥ 0.20. 0.15 → insufficient.
    query: 'Which sheet shows Water Line A?',
    items: [
      makeItem('vector_search', 0.80),
      makeItem('vector_search', 0.75),
      makeItem('vector_search', 0.70),
    ],
    expectedLevel: 'insufficient',
  },
  {
    label: 'Sheet lookup — 3 high-confidence items with citations: sufficient (post-tuning)',
    // Score: 0.15 (3 vector) + 0.15 (avg conf 0.82 ≥ 0.80) + 0.20 (3 citations, capped) = 0.50
    // Non-precise sufficient threshold: ≥ 0.40. 0.50 → sufficient.
    query: 'Which sheet shows Water Line A?',
    items: [
      makeItemWithCitation('vector_search', 0.85, 'C-101'),
      makeItemWithCitation('vector_search', 0.82, 'C-101'),
      makeItemWithCitation('vector_search', 0.78, 'C-102'),
    ],
    expectedLevel: 'sufficient',
  },

  // ── Project summary ───────────────────────────────────────────────────────
  {
    label: 'Project summary — project_summary item: sufficient',
    query: 'Summarize the full project',
    items: [makeItem('project_summary', 0.95)],
    expectedLevel: 'sufficient',
  },

  // ── Live PDF edge cases ───────────────────────────────────────────────────
  {
    label: 'Live PDF — capped at 5 of 20 sheets: insufficient for quantity',
    // Score: +0.30 (live), -0.15 (capped), mode: no structured → 0 penalty = 0.15
    // But wait: mode check — no structured and has live_pdf items. Has vector? No.
    // Actually live_pdf is neither structured nor vector, so mode penalty fires:
    // -0.10 (no structured, no vector_search) → 0.15 - 0.10 = 0.05 → insufficient.
    query: 'How many gate valves are on Water Line A?',
    items: [makeItem('live_pdf_analysis', 0.70)],
    expectedLevel: 'insufficient',
    liveAnalysisMeta: {
      sheetsAttempted: 20,
      sheetsAnalyzed: 5,
      sheetsSkipped: 0,
      skipReasons: [],
      wasCapped: true,
      capLimit: 5,
    },
  },
  {
    label: 'Live PDF — uncapped + vision_db: sufficient for quantity',
    // Score: +0.40 (structured) + 0.30 (live) + mode +0.10 (has structured)
    //        + conf bonus 0.15 (avg ≥ 0.80) = 0.95 → capped at 1.0 → sufficient.
    query: 'How many gate valves are on Water Line A?',
    items: [
      makeItem('vision_db', 0.90),
      makeItem('live_pdf_analysis', 0.80),
    ],
    expectedLevel: 'sufficient',
    liveAnalysisMeta: {
      sheetsAttempted: 10,
      sheetsAnalyzed: 10,
      sheetsSkipped: 0,
      skipReasons: [],
      wasCapped: false,
      capLimit: 15,
    },
  },
]

function runSufficiencyCases(): void {
  console.log('\n' + '='.repeat(70))
  console.log('SECTION 2: evaluateSufficiency() — evidence gating')
  console.log('  (post-tuning) labels indicate behavior changed by scoring fixes')
  console.log('='.repeat(70))

  for (const tc of SUFFICIENCY_CASES) {
    console.log(`\n${tc.label}`)
    console.log(`  Query: "${tc.query}"`)

    const analysis = analyzeQuery(tc.query)
    const packet = makePacket(analysis, tc.items)
    if (tc.liveAnalysisMeta) {
      packet.liveAnalysisMeta = tc.liveAnalysisMeta
    }

    const result = evaluateSufficiency(packet, analysis)
    const levelIcon = result.level === 'sufficient' ? '✓' : result.level === 'partial' ? '~' : '✗'
    console.log(`  Level: ${levelIcon} ${result.level}  |  Score: ${result.score}  |  Unsupported: ${result.isUnsupportedDomain}`)
    if (result.gaps.length > 0) {
      result.gaps.slice(0, 3).forEach(g => console.log(`    gap: ${g}`))
    }

    check('sufficiency level', result.level, tc.expectedLevel)
  }
}

// ---------------------------------------------------------------------------
// Section 3 — Threshold analysis
// ---------------------------------------------------------------------------

function runThresholdAnalysis(): void {
  console.log('\n' + '='.repeat(70))
  console.log('SECTION 3: Threshold analysis — score math across evidence scenarios')
  console.log('='.repeat(70))

  const scenarios = [
    // Quantity
    { label: 'QTY: 2 vision_db, high conf',              query: 'How many gate valves?', items: [makeItem('vision_db', 0.95), makeItem('vision_db', 0.90)] },
    { label: 'QTY: 1 vision_db + 3 vector, high conf',   query: 'How many gate valves?', items: [makeItem('vision_db', 0.90), makeItem('vector_search', 0.85), makeItem('vector_search', 0.82), makeItem('vector_search', 0.80)] },
    { label: 'QTY: 4 vector, high conf (partial)',        query: 'How many gate valves?', items: [makeItem('vector_search', 0.85), makeItem('vector_search', 0.82), makeItem('vector_search', 0.80), makeItem('vector_search', 0.78)] },
    { label: 'QTY: 2 vector, low conf',                  query: 'How many gate valves?', items: [makeItem('vector_search', 0.65), makeItem('vector_search', 0.60)] },
    // Crossing
    { label: 'CROSS: 2 vision_db, high conf (now suff)', query: 'What utilities cross Water Line B?', items: [makeItem('vision_db', 0.92), makeItem('vision_db', 0.88)] },
    { label: 'CROSS: 2 vision_db, low conf',             query: 'What utilities cross Water Line B?', items: [makeItem('vision_db', 0.70), makeItem('vision_db', 0.65)] },
    // Sheet
    { label: 'SHEET: 3 vector, no citations',            query: 'Which sheet shows Water Line A?', items: [makeItem('vector_search', 0.80), makeItem('vector_search', 0.75), makeItem('vector_search', 0.70)] },
    { label: 'SHEET: 3 vector + citations, high conf',   query: 'Which sheet shows Water Line A?', items: [makeItemWithCitation('vector_search', 0.85, 'C-101'), makeItemWithCitation('vector_search', 0.82, 'C-101'), makeItemWithCitation('vector_search', 0.78, 'C-102')] },
    { label: 'SHEET: 1 cited, high conf',                query: 'Which sheet shows Water Line A?', items: [makeItemWithCitation('vector_search', 0.90, 'C-101')] },
    // Live PDF
    { label: 'LIVE: uncapped, full run',                 query: 'How many gate valves?', items: [makeItem('live_pdf_analysis', 0.80)], liveAnalysisMeta: { sheetsAttempted: 10, sheetsAnalyzed: 10, sheetsSkipped: 0, skipReasons: [], wasCapped: false, capLimit: 15 } },
    { label: 'LIVE: capped 5/20',                        query: 'How many gate valves?', items: [makeItem('live_pdf_analysis', 0.80)], liveAnalysisMeta: { sheetsAttempted: 20, sheetsAnalyzed: 5, sheetsSkipped: 0, skipReasons: [], wasCapped: true, capLimit: 5 } },
    { label: 'LIVE: 2 skipped sheets',                   query: 'How many gate valves?', items: [makeItem('live_pdf_analysis', 0.75)], liveAnalysisMeta: { sheetsAttempted: 10, sheetsAnalyzed: 8, sheetsSkipped: 2, skipReasons: ['Sheet-03.pdf: too large', 'Sheet-07.pdf: download failed'], wasCapped: false, capLimit: 15 } },
  ]

  console.log('')
  console.log('Mode'.padEnd(22) + 'Scenario'.padEnd(40) + 'Score'.padEnd(8) + 'Level')
  console.log('-'.repeat(78))

  for (const s of scenarios) {
    const analysis = analyzeQuery(s.query)
    const packet = makePacket(analysis, s.items)
    if (s.liveAnalysisMeta) packet.liveAnalysisMeta = s.liveAnalysisMeta
    const result = evaluateSufficiency(packet, analysis)

    const modeStr = analysis.answerMode.slice(0, 20).padEnd(22)
    const scenStr = s.label.slice(0, 38).padEnd(40)
    const scoreStr = result.score.toFixed(2).padEnd(8)
    const levelIcon = result.level === 'sufficient' ? '✓' : result.level === 'partial' ? '~' : '✗'
    console.log(`${modeStr}${scenStr}${scoreStr}${levelIcon} ${result.level}`)
  }
}

// ---------------------------------------------------------------------------
// Section 4 — Correction layer validation
// ---------------------------------------------------------------------------

interface CorrectionCase {
  label: string
  query: string
  preCorrectionNote: string   // what the pre-correction mode/subtype would have been
  expectedMode: AnswerMode
  expectedVisionSubtype?: 'component' | 'crossing' | 'length'
  checkVisionLookupFalse?: boolean  // true → assert visionDBLookup was cleared
}

const CORRECTION_CASES: CorrectionCase[] = [
  // ── Correction 1: Sequence ────────────────────────────────────────────────
  {
    label: 'SEQ-1: "typical construction sequence"',
    query: 'What is the typical construction sequence for installing a water main?',
    preCorrectionNote: 'was document_lookup (classifyQuery → detail)',
    expectedMode: 'sequence_inference',
    checkVisionLookupFalse: true,
  },
  {
    label: 'SEQ-2: "installation order"',
    query: 'What is the installation order for gate valves?',
    preCorrectionNote: 'was document_lookup (classifyQuery → detail)',
    expectedMode: 'sequence_inference',
    checkVisionLookupFalse: true,
  },
  {
    label: 'SEQ-3: "in what order"',
    query: 'In what order should I install the pipe sections?',
    preCorrectionNote: 'was document_lookup',
    expectedMode: 'sequence_inference',
    checkVisionLookupFalse: true,
  },
  {
    label: 'SEQ-4: "what comes first"',
    query: 'What comes first, bedding or laying the pipe?',
    preCorrectionNote: 'was general_chat or document_lookup',
    expectedMode: 'sequence_inference',
  },
  // ── Correction 2: Length subtype ──────────────────────────────────────────
  {
    label: 'LEN-1: "linear feet" — subtype corrected',
    query: 'How many linear feet of water main are being installed?',
    preCorrectionNote: 'was visionQuerySubtype: component ("how many" matched first)',
    expectedMode: 'quantity_lookup',
    expectedVisionSubtype: 'length',
  },
  {
    label: 'LEN-2: "total footage"',
    query: 'What is the total footage of 8-IN PVC?',
    preCorrectionNote: 'was visionQuerySubtype: component',
    expectedMode: 'quantity_lookup',
    expectedVisionSubtype: 'length',
  },
  {
    label: 'LEN-3: "feet of pipe"',
    query: 'How many feet of pipe are there on the water main?',
    preCorrectionNote: 'was visionQuerySubtype: component',
    expectedMode: 'quantity_lookup',
    expectedVisionSubtype: 'length',
  },
  // ── Correction 3: Project-scope guard ────────────────────────────────────
  {
    label: 'SCOPE-1: "across the whole project"',
    query: 'Summarize all quantities across the whole project',
    preCorrectionNote: 'was crossing_lookup ("across" triggered crossing detector)',
    expectedMode: 'project_summary',
    checkVisionLookupFalse: true,
  },
  {
    label: 'SCOPE-2: "across the whole project" aggregation',
    // Must use "across" to trigger the crossing detector before the guard fires.
    // "for the entire project" doesn't trigger crossing — so no false positive, no guard needed.
    query: 'What are the overall totals across the whole project?',
    preCorrectionNote: 'was crossing_lookup ("across" triggered crossing detector)',
    expectedMode: 'project_summary',
    checkVisionLookupFalse: true,
  },
  // ── Control: genuine crossing still routes correctly ──────────────────────
  {
    label: 'CTRL-1: explicit "utilities cross" + project scope → stays crossing',
    query: 'What utilities cross Water Line A across all stations?',
    preCorrectionNote: 'no correction — EXPLICIT_CROSSING_SIGNALS prevents guard from firing',
    expectedMode: 'crossing_lookup',
  },
  {
    label: 'CTRL-2: "what crosses" without project scope → stays crossing',
    query: 'What utilities cross Water Line B?',
    preCorrectionNote: 'no correction needed',
    expectedMode: 'crossing_lookup',
  },
]

function runCorrectionLayerTests(): void {
  console.log('\n' + '='.repeat(70))
  console.log('SECTION 4: Correction layer validation')
  console.log('  Shows before → after for each correction type')
  console.log('='.repeat(70))

  for (const tc of CORRECTION_CASES) {
    const analysis = analyzeQuery(tc.query)
    const modeIcon = analysis.answerMode === tc.expectedMode ? '✓' : '✗'
    console.log(`\n${tc.label}`)
    console.log(`  Query:  "${tc.query}"`)
    console.log(`  Before: ${tc.preCorrectionNote}`)
    console.log(`  After:  ${analysis.answerMode}  ${modeIcon}`)

    if (tc.expectedVisionSubtype) {
      const subtypeIcon = analysis.retrievalHints.visionQuerySubtype === tc.expectedVisionSubtype ? '✓' : '✗'
      console.log(`  Subtype: ${analysis.retrievalHints.visionQuerySubtype}  ${subtypeIcon}`)
    }

    check('answerMode', analysis.answerMode, tc.expectedMode)

    if (tc.expectedVisionSubtype !== undefined) {
      check('visionQuerySubtype', analysis.retrievalHints.visionQuerySubtype, tc.expectedVisionSubtype)
    }

    if (tc.checkVisionLookupFalse) {
      check('visionDBLookup cleared', analysis.retrievalHints.needsVisionDBLookup, false)
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function printSummary(): void {
  const total = passed + failed
  console.log('\n' + '='.repeat(70))
  console.log(`RESULTS: ${passed}/${total} passed`)
  if (failed > 0) {
    console.log(`         ${failed} FAILED — review output above`)
    process.exitCode = 1
  } else {
    console.log('         All checks passed')
  }
  console.log('='.repeat(70))
}

console.log('='.repeat(70))
console.log('CHAT PIPELINE EVALUATION HARNESS')
console.log('Tests analyzeQuery() + evaluateSufficiency() without network/DB')
console.log('='.repeat(70))

runAnalysisCases()
runSufficiencyCases()
runThresholdAnalysis()
runCorrectionLayerTests()
printSummary()
