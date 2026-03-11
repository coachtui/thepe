/**
 * Shared types for the unified chat pipeline.
 *
 * Pipeline flow:
 *   query-analyzer → retrieval-orchestrator → evidence-evaluator → response-writer
 *
 * Every step hands off a typed object. No step guesses what the previous step
 * produced.
 */

// ---------------------------------------------------------------------------
// Answer modes
// ---------------------------------------------------------------------------

/**
 * The answer mode determines retrieval strategy, required evidence, and
 * output contract. There is exactly one mode per request.
 */
export type AnswerMode =
  | 'quantity_lookup'      // How many X? Total LF of Y? Material counts.
  | 'crossing_lookup'      // What utilities cross this alignment?
  | 'sheet_lookup'         // Which sheet shows X? Where is Y?
  | 'document_lookup'      // What does sheet X contain? Detail reference.
  | 'scope_summary'        // Describe the project / system scope.
  | 'requirement_lookup'   // Spec requirements (UNSUPPORTED - no spec pipeline)
  | 'sequence_inference'   // Construction sequence / ordering questions
  | 'project_summary'      // Full aggregated project overview
  | 'general_chat'         // Domain knowledge, conversational, no retrieval needed
  | 'insufficient_evidence' // Used when evidence is insufficient to answer

// ---------------------------------------------------------------------------
// Query analysis
// ---------------------------------------------------------------------------

export type RetrievalSource =
  | 'vision_db'            // Vision-extracted structured data already in DB
  | 'project_summary_view' // project_quantity_summary aggregated view
  | 'direct_quantity_lookup'
  | 'vector_search'
  | 'complete_chunk_data'  // All chunks for a system (for full takeoffs)
  | 'live_pdf_analysis'    // Last-resort: real-time PDF download + vision

/**
 * Output of query-analyzer. Fully describes what we know about the request
 * before touching any retrieval systems.
 */
export interface QueryAnalysis {
  rawQuery: string
  answerMode: AnswerMode

  entities: {
    itemName?: string         // "Water Line A", "12-IN gate valve"
    componentType?: string    // "valve", "tee", "hydrant"
    utilitySystem?: string    // "WATER LINE", "STORM DRAIN"
    station?: string          // "15+00"
    sheetNumber?: string      // "C-001"
    sizeFilter?: string       // "12-IN", "8-IN"
    material?: string         // "PVC", "ductile iron"
  }

  requestedSystems: string[]  // Systems mentioned by name in query

  retrievalHints: {
    preferredSources: RetrievalSource[]
    keywords: string[]
    needsCompleteDataset: boolean // True for full takeoffs
    isAggregation: boolean        // True for sum/total queries
    needsVisionDBLookup: boolean  // True for component/crossing/length queries
    visionQuerySubtype?: 'component' | 'crossing' | 'length'
  }

  inferenceAllowed: boolean         // False for quantities/crossings
  needsConversationContext: boolean  // Always true — history preserved everywhere
  supportLevelExpected: 'supported' | 'partial' | 'unsupported'

  /**
   * Internal routing data — populated by query-analyzer, consumed only by
   * retrieval-orchestrator to avoid re-running classifyQuery() and
   * determineVisionQueryType() inside smart-router.
   * Do not read this in response-writer or evidence-evaluator.
   */
  _routing?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    classification: any
    visionQueryType: 'component' | 'crossing' | 'length' | 'none'
  }
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type EvidenceSourceType =
  | 'vision_db'
  | 'project_summary'
  | 'direct_lookup'
  | 'vector_search'
  | 'complete_data'
  | 'live_pdf_analysis'

export interface StructuredCitation {
  sheetNumber?: string
  station?: string
  documentId?: string
  filename?: string
}

export interface EvidenceItem {
  source: EvidenceSourceType
  content: string
  citation?: StructuredCitation
  confidence: number
  rawData?: unknown
}

/**
 * When live PDF analysis was attempted, this records what happened
 * including any limitations so the evidence-evaluator can downgrade
 * confidence appropriately.
 */
export interface LiveAnalysisMeta {
  sheetsAttempted: number
  sheetsAnalyzed: number
  sheetsSkipped: number
  skipReasons: string[]  // e.g. "Sheet-01.pdf: 11.2 MB > 10 MB limit"
  wasCapped: boolean     // Hit sheet limit before all sheets were processed
  capLimit: number
}

/**
 * Normalized evidence output from retrieval-orchestrator.
 * The response-writer only ever receives this — it never needs to know
 * which DB table or PDF file the data came from.
 */
export interface EvidencePacket {
  answerMode: AnswerMode
  query: string
  items: EvidenceItem[]
  formattedContext: string   // Pre-built context string for LLM system prompt
  sources: string[]          // Deduplicated human-readable source list
  liveAnalysisMeta?: LiveAnalysisMeta
  retrievalMethod: string
}

// ---------------------------------------------------------------------------
// Sufficiency
// ---------------------------------------------------------------------------

export type SufficiencyLevel = 'sufficient' | 'partial' | 'insufficient'

export interface SufficiencyResult {
  level: SufficiencyLevel
  score: number          // 0.0 – 1.0
  reasons: string[]      // Why this level was assigned
  gaps: string[]         // What's missing / what would improve the answer
  isUnsupportedDomain: boolean  // True when no pipeline exists for this query type
}
