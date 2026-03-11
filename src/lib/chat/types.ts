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
  | 'demo_scope'           // What gets demolished / what remains / what is protected
  | 'demo_constraint'      // Pre-demo checks, risk notes, protection requirements
  | 'arch_element_lookup'  // What is Door D-14? What wall type WT-A?
  | 'arch_room_scope'      // What's in Room 105? Which rooms affected?
  | 'arch_schedule_query'  // What does the door schedule say for D-14?

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
    /** Room number extracted from demo queries (e.g. "104") */
    demoRoom?: string | null
    /** Level extracted from demo queries (e.g. "L1") */
    demoLevel?: string | null
    /** Status hint from demo remain/protect queries (e.g. "to_remain") */
    demoStatusHint?: string | null
    /** Drawing tag extracted from arch queries (e.g. "D-14", "W-3A", "WT-A") */
    archTag?: string | null
    /** Entity type the tag refers to */
    archTagType?: 'door' | 'window' | 'wall_type' | 'room' | 'keynote' | null
    /** Room number extracted from arch room queries (e.g. "105") */
    archRoom?: string | null
    /** Schedule type for arch_schedule_query mode */
    archScheduleType?: 'door' | 'window' | 'room_finish' | null
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

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

/**
 * Which reasoning mode the engine selected for this request.
 * 'none' means pass-through — the writer uses evidence directly.
 */
export type ReasoningMode =
  | 'scope_reasoning'            // scope_summary, project_summary
  | 'sequence_reasoning'         // sequence_inference
  | 'constraint_reasoning'       // general_chat with substantive project evidence
  | 'quantity_reasoning'         // quantity_lookup with multi-system data
  | 'demo_scope_reasoning'       // demo_scope: groups entities by status with citations
  | 'demo_constraint_reasoning'  // demo_constraint: risk notes, requirements, inferred cautions
  | 'arch_element_reasoning'     // arch_element_lookup / arch_schedule_query: element + schedule linkage
  | 'arch_room_scope_reasoning'  // arch_room_scope: room contents + finish schedule + notes
  | 'none'                       // pass-through

/**
 * How well a finding is supported by evidence.
 * Assigned deterministically by the reasoning engine — NEVER by the model.
 *
 *   explicit  = came from vision_db / direct_lookup / project_summary
 *   inferred  = came from vector_search / live_pdf, or from construction practice rules
 *   unknown   = no evidence; this is a gap
 */
export type SupportLevel = 'explicit' | 'inferred' | 'unknown'

export type EvidenceStrength = 'strong' | 'moderate' | 'weak'

export type GapType =
  | 'missing_spec'
  | 'partial_live_analysis'
  | 'insufficient_structured_data'
  | 'missing_sheet_coverage'
  | 'unknown_scope'
  | 'incomplete_system_coverage'

export interface ReasoningFinding {
  statement: string
  supportLevel: SupportLevel
  citations?: StructuredCitation[]
  /** Why this is inferred, or what knowledge source it comes from */
  basis?: string
}

export interface ReasoningGap {
  description: string
  gapType: GapType
  actionable?: string
}

export interface ProjectContextAssembly {
  primarySystems: string[]
  relatedSystems: string[]
  relevantSheets: string[]
  relevantStations: string[]
  dataCompleteness: 'full' | 'partial' | 'sparse'
}

/**
 * Normalized output of the reasoning engine.
 * Consumed by response-writer to produce answers that separate:
 *   1. what documents explicitly support (explicit)
 *   2. what is inferred from construction practice or patterns (inferred)
 *   3. what is unknown / missing (gaps)
 *
 * When wasActivated=false, the writer uses the evidence packet directly
 * (same behaviour as before the reasoning layer was added).
 */
export interface ReasoningPacket {
  mode: ReasoningMode
  wasActivated: boolean
  context: ProjectContextAssembly
  findings: ReasoningFinding[]
  gaps: ReasoningGap[]
  /** Hint to the writer about how to structure the answer */
  recommendedAnswerFrame: string
  evidenceStrength: EvidenceStrength
}

export interface SufficiencyResult {
  level: SufficiencyLevel
  score: number          // 0.0 – 1.0
  reasons: string[]      // Why this level was assigned
  gaps: string[]         // What's missing / what would improve the answer
  isUnsupportedDomain: boolean  // True when no pipeline exists for this query type
}

// ---------------------------------------------------------------------------
// Demo entities (Phase 3)
// ---------------------------------------------------------------------------

/** A single finding attached to a demo entity. */
export interface DemoFinding {
  findingType: string       // 'demo_scope' | 'note' | 'risk_note' | 'requirement' | 'dimension'
  statement: string
  supportLevel: SupportLevel
  textValue: string | null
  confidence: number
}

/** A single entity in the demo discipline, hydrated with its primary location and findings. */
export interface DemoEntity {
  id: string
  entityType: string        // 'wall' | 'ceiling' | 'floor' | 'equipment' | 'surface' | 'keynote' | 'note' | 'opening'
  subtype: string | null
  canonicalName: string
  displayName: string
  label: string | null
  status: string            // 'to_remove' | 'to_remain' | 'to_protect' | 'to_relocate' | 'existing' | 'temporary' | 'unknown'
  confidence: number
  room: string | null       // from entity_locations.room_number
  level: string | null      // from entity_locations.level
  area: string | null       // from entity_locations.area
  sheetNumber: string | null
  findings: DemoFinding[]
}

/** Return value of queryDemoScope / queryDemoByRoom. */
export interface DemoQueryResult {
  success: boolean
  projectId: string
  filterRoom: string | null
  filterStatus: string | null
  toRemove: DemoEntity[]
  toRemain: DemoEntity[]
  toProtect: DemoEntity[]
  toRelocate: DemoEntity[]
  notes: DemoEntity[]         // keynote/note entities
  unknownStatus: DemoEntity[] // status='unknown' — needs field verification
  totalCount: number          // physical entity count (excludes notes)
  sheetsCited: string[]
  confidence: number
  formattedAnswer: string
}

// ---------------------------------------------------------------------------
// Architectural entities (Phase 4)
// ---------------------------------------------------------------------------

/** A single finding attached to an architectural entity. */
export interface ArchFinding {
  findingType: string   // 'schedule_row' | 'dimension' | 'material' | 'note' | 'constraint' | 'specification_ref'
  statement: string
  supportLevel: SupportLevel
  textValue: string | null
  numericValue: number | null
  unit: string | null
  confidence: number
}

/**
 * A parsed schedule entry (door schedule row, window schedule row, or
 * room finish schedule row) stored as a schedule_entry entity.
 */
export interface ArchScheduleEntry {
  id: string
  tag: string                            // "D-14", "W-3A", "105"
  scheduleType: 'door' | 'window' | 'room_finish' | 'hardware'
  canonicalName: string
  displayName: string
  sheetNumber: string | null
  findings: ArchFinding[]
}

/** A single architectural entity, hydrated with location, findings, and optional schedule linkage. */
export interface ArchEntity {
  id: string
  entityType: string        // 'room' | 'door' | 'window' | 'wall' | 'finish_tag' | 'schedule_entry' | 'keynote' | 'note' | 'detail_ref'
  subtype: string | null
  canonicalName: string
  displayName: string
  label: string | null
  status: string            // 'existing' | 'new' | 'proposed' | 'unknown'
  confidence: number
  room: string | null       // from entity_locations.room_number
  level: string | null      // from entity_locations.level
  area: string | null       // from entity_locations.area
  gridRef: string | null    // from entity_locations.grid_ref
  sheetNumber: string | null
  findings: ArchFinding[]
  scheduleEntry: ArchScheduleEntry | null  // linked via described_by relationship
}

/** Return value of queryArchElement / queryArchRoom. */
export interface ArchQueryResult {
  success: boolean
  projectId: string
  queryType: 'element' | 'room' | 'schedule'
  tag: string | null            // extracted tag ("D-14", "W-3A") or null for room queries
  roomFilter: string | null     // extracted room number or null
  entities: ArchEntity[]        // all non-room entities returned
  rooms: ArchEntity[]           // entity_type='room' entities
  scheduleEntries: ArchScheduleEntry[]
  totalCount: number
  sheetsCited: string[]
  confidence: number
  formattedAnswer: string
}
