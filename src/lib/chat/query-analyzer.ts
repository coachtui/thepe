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

  return {
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

    // Spec/requirement queries have no supporting pipeline yet.
    supportLevelExpected: answerMode === 'requirement_lookup' ? 'unsupported' : 'supported',

    // Internal: pre-computed classification for retrieval-orchestrator so
    // smart-router does not need to re-run classifyQuery() or
    // determineVisionQueryType() on the same string.
    _routing: { classification: effectiveClassification, visionQueryType },
  }
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
      // No spec ingestion pipeline exists. Return requirement_lookup which
      // the evidence-evaluator will flag as unsupported domain.
      return 'requirement_lookup'

    case 'reference':
      return 'sheet_lookup'

    case 'location':
      return 'sheet_lookup'

    case 'detail':
      return 'document_lookup'

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

  // Unsupported domains should not attempt retrieval at all.
  if (answerMode === 'requirement_lookup') {
    return []
  }

  return sources
}
