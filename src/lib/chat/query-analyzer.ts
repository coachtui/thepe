/**
 * Query Analyzer — single source of truth for query analysis.
 *
 * Replaces three separate visual-detection functions that previously lived in:
 *   - src/app/api/chat/route.ts              (needsVisualAnalysis)
 *   - src/app/api/mobile/chat/route.ts       (needsVisualAnalysis — duplicate)
 *   - src/lib/chat/visual-analysis.ts        (requiresVisualAnalysis)
 *
 * Also replaces the ad-hoc answer-mode decisions spread through smart-router.ts
 * and both route files.
 *
 * Output: QueryAnalysis — fully describes what kind of answer is needed and
 * what retrieval sources should be tried, before touching any DB or PDF.
 */

import { classifyQuery, type QueryClassification } from './query-classifier'
import {
  determineVisionQueryType,
  detectComponentType,
  extractSizeFromQuery,
} from './vision-queries'
import type { QueryAnalysis, AnswerMode, RetrievalSource } from './types'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a user query and return a fully typed QueryAnalysis.
 *
 * This is the ONLY function that should be called at the top of the pipeline
 * to understand what the user wants. All downstream modules receive the
 * QueryAnalysis object — they do not re-classify the query.
 */
export function analyzeQuery(rawQuery: string): QueryAnalysis {
  const classification = classifyQuery(rawQuery)
  // determineVisionQueryType runs second — it has finer-grained knowledge of
  // component/crossing/length than classifyQuery's 'quantity' bucket.
  const visionQueryType = determineVisionQueryType(rawQuery)

  // When visionQueryType is 'crossing', it overrides classifyQuery's type so
  // we always route crossing questions to crossing_lookup regardless of how
  // the base classifier categorized them.
  const effectiveClassification =
    visionQueryType === 'crossing'
      ? { ...classification, type: 'utility_crossing' as const }
      : classification

  const answerMode = mapToAnswerMode(effectiveClassification, rawQuery)
  const preferredSources = buildPreferredSources(effectiveClassification, answerMode, visionQueryType)

  const analysis: QueryAnalysis = {
    rawQuery,
    answerMode,

    entities: {
      itemName:      classification.itemName,
      componentType: visionQueryType === 'component'
        ? detectComponentType(rawQuery) ?? undefined
        : undefined,
      utilitySystem: classification.searchHints.systemName,
      station:       classification.station,
      sheetNumber:   classification.sheetNumber,
      sizeFilter:    extractSizeFromQuery(rawQuery) ?? undefined,
      material:      classification.material,
    },

    requestedSystems: classification.searchHints.systemName
      ? [classification.searchHints.systemName]
      : [],

    retrievalHints: {
      preferredSources,
      keywords:            classification.searchHints.keywords ?? [],
      needsCompleteDataset: classification.needsCompleteData,
      isAggregation:       classification.isAggregationQuery,
      needsVisionDBLookup: visionQueryType !== 'none',
      visionQuerySubtype:  visionQueryType !== 'none' ? visionQueryType : undefined,
    },

    // Inference is risky for precise counts and crossings — constrain it.
    inferenceAllowed: !['quantity_lookup', 'crossing_lookup'].includes(answerMode),

    // Always preserve conversation history — no path gets to be stateless.
    needsConversationContext: true,

    // requirement_lookup (legacy/unmatched spec) has no pipeline — mark unsupported.
    // Phase 6 spec/rfi/submittal modes are now supported.
    supportLevelExpected: answerMode === 'requirement_lookup' ? 'unsupported' : 'supported',

    // Internal: pre-computed classification for retrieval-orchestrator so
    // smart-router does not need to re-run classifyQuery() or
    // determineVisionQueryType() on the same string.
    _routing: {
      classification: effectiveClassification,
      visionQueryType,
      demoRoom:        effectiveClassification.demoRoom        ?? null,
      demoLevel:       effectiveClassification.demoLevel       ?? null,
      demoStatusHint:  effectiveClassification.demoStatusHint  ?? null,
      archTag:         effectiveClassification.archTag         ?? null,
      archTagType:     effectiveClassification.archTagType     ?? null,
      archRoom:        effectiveClassification.archRoom        ?? null,
      archScheduleType: effectiveClassification.archScheduleType ?? null,
      // Phase 5A — structural
      structMark:       effectiveClassification.structMark       ?? null,
      structEntityType: effectiveClassification.structEntityType ?? null,
      structGrid:       effectiveClassification.structGrid       ?? null,
      structLevel:      effectiveClassification.structLevel      ?? null,
      // Phase 5A — MEP
      mepTag:           effectiveClassification.mepTag           ?? null,
      mepDiscipline:    effectiveClassification.mepDiscipline    ?? null,
      // Phase 5B — coordination
      coordRoom:        (effectiveClassification.coordRoom ?? effectiveClassification.archRoom) ?? null,
      coordLevel:       effectiveClassification.coordLevel ?? null,
      // Phase 6A — spec
      specSection:           effectiveClassification.specSection          ?? null,
      specRequirementType:   effectiveClassification.specRequirementType  ?? null,
      // Phase 6B — RFI
      rfiNumber:             effectiveClassification.rfiNumber            ?? null,
      changeDocType:         effectiveClassification.changeDocType        ?? null,
      // Phase 6C — submittal / governing
      submittalId:           effectiveClassification.submittalId          ?? null,
      governingDocScope:     effectiveClassification.governingDocScope    ?? null,
    },
  }

  return applyPostAnalysisCorrections(analysis, rawQuery)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapToAnswerMode(
  classification: QueryClassification,
  rawQuery: string
): AnswerMode {
  switch (classification.type) {
    case 'quantity':
      return 'quantity_lookup'

    case 'utility_crossing':
      return 'crossing_lookup'

    case 'project_summary':
      return 'project_summary'

    case 'specification':
      // Legacy 'specification' type from base classifier — map to requirement_lookup
      // (still unsupported — use spec_section_lookup / spec_requirement_lookup instead)
      return 'requirement_lookup'

    case 'spec_section_lookup':
      return 'spec_section_lookup'

    case 'spec_requirement_lookup':
      return 'spec_requirement_lookup'

    case 'rfi_lookup':
      return 'rfi_lookup'

    case 'change_impact_lookup':
      return 'change_impact_lookup'

    case 'submittal_lookup':
      return 'submittal_lookup'

    case 'governing_document_query':
      return 'governing_document_query'

    case 'reference':
      return 'sheet_lookup'

    case 'location':
      return 'sheet_lookup'

    case 'detail':
      return 'document_lookup'

    case 'demo_scope':
      return 'demo_scope'

    case 'demo_constraint':
      return 'demo_constraint'

    case 'arch_element_lookup':
      return 'arch_element_lookup'

    case 'arch_room_scope':
      return 'arch_room_scope'

    case 'arch_schedule_query':
      return 'arch_schedule_query'

    // Phase 5A — structural
    case 'struct_element_lookup':
      return 'struct_element_lookup'

    case 'struct_area_scope':
      return 'struct_area_scope'

    // Phase 5A — MEP
    case 'mep_element_lookup':
      return 'mep_element_lookup'

    case 'mep_area_scope':
      return 'mep_area_scope'

    // Phase 5B — coordination
    case 'trade_coordination':
      return 'trade_coordination'

    case 'coordination_sequence':
      return 'coordination_sequence'

    case 'affected_area':
      return 'affected_area'

    case 'general': {
      const q = rawQuery.toLowerCase()
      if (/overview|summary|scope|describe.*project|tell me about|what.*(is|are).*project/i.test(q)) {
        return 'scope_summary'
      }
      if (/sequence|order|first.*then|step|procedure|how.*install|how.*construct/i.test(q)) {
        return 'sequence_inference'
      }
      return 'general_chat'
    }

    default:
      return 'general_chat'
  }
}

function buildPreferredSources(
  classification: QueryClassification,
  answerMode: AnswerMode,
  visionQueryType: 'component' | 'crossing' | 'length' | 'none'
): RetrievalSource[] {
  const sources: RetrievalSource[] = []

  // Project summary view is authoritative for scope/summary queries.
  if (answerMode === 'project_summary' || answerMode === 'scope_summary') {
    sources.push('project_summary_view')
  }

  // Vision DB lookups (component counts, crossings, lengths) have highest
  // precision — always try them first when the query warrants it.
  if (visionQueryType !== 'none') {
    sources.push('vision_db')
  }

  // Direct quantity lookup for specific item searches.
  if (classification.needsDirectLookup) {
    sources.push('direct_quantity_lookup')
  }

  // Full chunk retrieval for complete takeoff queries.
  if (classification.needsCompleteData) {
    sources.push('complete_chunk_data')
  }

  // Vector search as fallback for informational / locational queries.
  if (classification.needsVectorSearch) {
    sources.push('vector_search')
  }

  // Live PDF analysis is a last-resort source added by the retrieval
  // orchestrator if everything above returns empty. Not listed here as
  // "preferred" — it's a fallback.

  // Arch modes: vision_db first (graph lookup), then vector_search fallback.
  if (
    answerMode === 'arch_element_lookup' ||
    answerMode === 'arch_room_scope'     ||
    answerMode === 'arch_schedule_query'
  ) {
    if (!sources.includes('vision_db'))     sources.push('vision_db')
    if (!sources.includes('vector_search')) sources.push('vector_search')
  }

  // Phase 5A: structural + MEP modes — vision_db first, then vector_search.
  if (
    answerMode === 'struct_element_lookup' ||
    answerMode === 'struct_area_scope'     ||
    answerMode === 'mep_element_lookup'    ||
    answerMode === 'mep_area_scope'
  ) {
    if (!sources.includes('vision_db'))     sources.push('vision_db')
    if (!sources.includes('vector_search')) sources.push('vector_search')
  }

  // Phase 5B: coordination modes — vision_db first (cross-discipline graph), then vector_search.
  if (
    answerMode === 'trade_coordination'    ||
    answerMode === 'coordination_sequence' ||
    answerMode === 'affected_area'
  ) {
    if (!sources.includes('vision_db'))     sources.push('vision_db')
    if (!sources.includes('vector_search')) sources.push('vector_search')
  }

  // Phase 6: spec, rfi, submittal, governing — vision_db (entity graph) first, then vector_search.
  if (
    answerMode === 'spec_section_lookup'    ||
    answerMode === 'spec_requirement_lookup'||
    answerMode === 'rfi_lookup'             ||
    answerMode === 'change_impact_lookup'   ||
    answerMode === 'submittal_lookup'       ||
    answerMode === 'governing_document_query'
  ) {
    if (!sources.includes('vision_db'))     sources.push('vision_db')
    if (!sources.includes('vector_search')) sources.push('vector_search')
  }

  // Unsupported domains should not attempt retrieval at all.
  if (answerMode === 'requirement_lookup') {
    return []
  }

  return sources
}

// ---------------------------------------------------------------------------
// Post-analysis correction layer
// ---------------------------------------------------------------------------
// These patterns catch predictable classifier errors on specific phrasings
// without touching the underlying classifyQuery() or determineVisionQueryType().

/** Sequence phrasing that the base classifier misses when install/construct
 *  nouns get caught by the 'detail' branch before the 'general' sequence check. */
const SEQUENCE_CORRECTION_PATTERNS = [
  /\btypical\s+(?:construction\s+)?sequence\b/i,
  /\bstandard\s+(?:construction\s+)?sequence\b/i,
  /\binstallation\s+(?:sequence|order|procedure)\b/i,
  /\bconstruction\s+(?:sequence|order|procedure)\b/i,
  /\border\s+of\s+(?:installation|construction|operations?|work)\b/i,
  /\bwhat\s+comes\s+first\b/i,
  /\bsteps?\s+(?:to\s+install|for\s+installing|to\s+construct|for\s+constructing)\b/i,
  /\bhow\s+(?:do\s+(?:i|you|we)\s+)?(?:install|construct)\b/i,
  /\bin\s+what\s+order\b/i,
]

/** Plain-English length phrasing that fires AFTER the "how many" component
 *  pattern in determineVisionQueryType(), leaving subtype as 'component'. */
const PLAIN_LENGTH_PATTERNS = [
  /\blinear\s+feet\b/i,
  /\btotal\s+(?:length|footage|lf)\b/i,
  /\bhow\s+(?:many|much)\s+(?:linear\s+)?feet\b/i,
  /\bfeet\s+of\s+(?:\w+\s+)?(?:pipe|main|line|conduit)\b/i,
]

/** "across/entire/whole/overall project" aggregation context that accidentally
 *  triggers the crossing detector because "across" is a crossing keyword. */
const PROJECT_SCOPE_PHRASES = [
  /\bacross\s+(?:the|this|all|whole|entire)\s+project\b/i,
  /\bfor\s+(?:the|this)\s+(?:whole|entire)\s+project\b/i,
  /\b(?:whole|entire|overall)\s+project\b/i,
  /\bproject[\s-]wide\b/i,
  /\boverall\s+(?:total|summary)\b/i,
]

/** Confirm the user actually wants crossing data (prevents false negatives
 *  from Correction 3 on genuine crossing questions that mention "project"). */
const EXPLICIT_CROSSING_SIGNALS = [
  /\butilities?\s+cross\b/i,
  /\bwhat\s+(?:cross|intersect)\b/i,
  /\butility\s+crossing\b/i,
  /\bcrossing\s+utilities\b/i,
  /\bcross(?:es|ing)\s+(?:the|water|storm|sewer|gas|elec|line)/i,
]

/**
 * Apply deterministic post-analysis corrections.
 *
 * Corrections (applied in priority order):
 *   1. Sequence   — detail/general → sequence_inference for construction sequence phrasing
 *   2. Length     — component subtype → length for plain-English length queries
 *   3. Scope guard— crossing_lookup → project_summary when "across/entire project" with
 *                   no explicit utility-crossing signal
 */
function applyPostAnalysisCorrections(
  analysis: QueryAnalysis,
  rawQuery: string
): QueryAnalysis {
  // ── Correction 1: Sequence inference ──────────────────────────────────────
  if (
    analysis.answerMode !== 'sequence_inference' &&
    SEQUENCE_CORRECTION_PATTERNS.some(p => p.test(rawQuery))
  ) {
    return {
      ...analysis,
      answerMode: 'sequence_inference',
      retrievalHints: {
        ...analysis.retrievalHints,
        needsVisionDBLookup: false,
        visionQuerySubtype: undefined,
      },
      _routing: analysis._routing
        ? {
            classification: {
              ...analysis._routing.classification,
              type: 'general',
              needsVectorSearch: true,
              needsCompleteData: false,
              needsDirectLookup: false,
            },
            visionQueryType: 'none' as const,
          }
        : analysis._routing,
    }
  }

  // ── Correction 2: Length subtype ───────────────────────────────────────────
  if (
    analysis.retrievalHints.needsVisionDBLookup &&
    analysis.retrievalHints.visionQuerySubtype === 'component' &&
    PLAIN_LENGTH_PATTERNS.some(p => p.test(rawQuery))
  ) {
    return {
      ...analysis,
      retrievalHints: {
        ...analysis.retrievalHints,
        visionQuerySubtype: 'length',
      },
    }
  }

  // ── Correction 3: Project-scope guard ─────────────────────────────────────
  if (
    analysis.answerMode === 'crossing_lookup' &&
    PROJECT_SCOPE_PHRASES.some(p => p.test(rawQuery)) &&
    !EXPLICIT_CROSSING_SIGNALS.some(p => p.test(rawQuery))
  ) {
    return {
      ...analysis,
      answerMode: 'project_summary',
      retrievalHints: {
        ...analysis.retrievalHints,
        preferredSources: ['project_summary_view', 'direct_quantity_lookup'],
        needsVisionDBLookup: false,
        visionQuerySubtype: undefined,
        needsCompleteDataset: true,
        isAggregation: true,
      },
      _routing: analysis._routing
        ? {
            classification: {
              ...analysis._routing.classification,
              type: 'project_summary',
              needsDirectLookup: true,
              needsVectorSearch: false,
              needsCompleteData: true,
              needsVision: false,
            },
            visionQueryType: 'none' as const,
          }
        : analysis._routing,
    }
  }

  return analysis
}
