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
  // Phase 5A — structural + MEP
  | 'struct_element_lookup'  // What is column C-4? What footing at Grid A-3?
  | 'struct_area_scope'      // What structural elements are on Level 1?
  | 'mep_element_lookup'     // What panel is LP-1? What's AHU-1?
  | 'mep_area_scope'         // What MEP is in Room 105?
  // Phase 5B — coordination
  | 'trade_coordination'     // What trades touch Room 105?
  | 'coordination_sequence'  // What could hold this work up?
  | 'affected_area'          // What systems are affected on Level 1?
  // Phase 6A — specifications
  | 'spec_section_lookup'     // What does spec section 03 30 00 require?
  | 'spec_requirement_lookup' // What testing is required for concrete work?
  // Phase 6B — RFI / change documents
  | 'rfi_lookup'              // Did an RFI address footing F-1?
  | 'change_impact_lookup'    // What changed in Addendum 1?
  // Phase 6C — submittals + governing
  | 'submittal_lookup'        // What submittal covers LP-1?
  | 'governing_document_query' // What governs here: plan, spec, or RFI?

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
    // Phase 5A — structural routing
    /** Structural mark extracted from query (e.g. "F-1", "C-4") */
    structMark?: string | null
    /** Structural entity type hint */
    structEntityType?: 'footing' | 'column' | 'beam' | 'foundation_wall' | 'grid_line' | null
    /** Grid reference extracted from query (e.g. "A-3", "B/3-4") */
    structGrid?: string | null
    /** Level extracted from structural query (e.g. "L1", "Level 2") */
    structLevel?: string | null
    // Phase 5A — MEP routing
    /** MEP equipment tag (e.g. "LP-1", "AHU-1", "T-1") */
    mepTag?: string | null
    /** MEP discipline hint from query */
    mepDiscipline?: 'electrical' | 'mechanical' | 'plumbing' | null
    // Phase 5B — coordination routing
    /** Room for coordination queries */
    coordRoom?: string | null
    /** Level for coordination queries */
    coordLevel?: string | null
    // Phase 6A — spec routing
    /** Spec section number extracted from query (e.g. "03 30 00", "03300") */
    specSection?: string | null
    /** Requirement type hint (material/execution/testing/submittal/closeout/inspection) */
    specRequirementType?: 'material' | 'execution' | 'testing' | 'submittal' | 'closeout' | 'inspection' | 'protection' | null
    // Phase 6B — RFI routing
    /** RFI/change document identifier (e.g. "RFI-023", "ASI-002", "Addendum 1") */
    rfiNumber?: string | null
    /** Change document type */
    changeDocType?: 'rfi' | 'asi' | 'bulletin' | 'addendum' | null
    // Phase 6C — submittal / governing routing
    /** Submittal identifier (e.g. "03-01", "16-02") */
    submittalId?: string | null
    /** Free-text scope description for governing document queries */
    governingDocScope?: string | null
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
  /** Unique ID of the chat request that produced this item. Threaded through all retrieval steps. */
  query_id?: string
  /** Raw confidence assigned at retrieval time, before any source-quality modifier is applied. */
  source_confidence_at_retrieval?: number
}

// ---------------------------------------------------------------------------
// Chat response metadata
// ---------------------------------------------------------------------------

/** Counts of evidence items by retrieval source, returned as a response header. */
export interface DataSourceCounts {
  vision_db: number
  vector: number
  plan_reader: number
  graph: number
}

/** Structured metadata attached to every chat response (via X-Chat-Meta header when debug is on). */
export interface ChatResponse {
  data_source_counts: DataSourceCounts
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
  routingWarnings?: string[] // Warnings from smart-router fallback decisions

  /**
   * Sheet verification result — present only for Type B/C/D queries.
   * When present the response-writer MUST enforce evidence-based citations.
   */
  verificationMeta?: import('./sheet-verifier').SheetVerificationResult

  /**
   * Plan Reader result — present when actual sheet images were inspected
   * at query time for a Type B/C/D question.
   * Findings here are direct visual evidence and rank above all other sources.
   */
  planReaderMeta?: import('./plan-reader').PlanReaderResult
}

/**
 * How well a finding is supported by evidence.
 *
 *   explicit  = came from vision_db / direct_lookup / project_summary
 *   inferred  = came from vector_search / live_pdf, or from construction practice rules
 *   unknown   = no evidence; this is a gap
 */
export type SupportLevel = 'explicit' | 'inferred' | 'unknown'

// ---------------------------------------------------------------------------
// Debug trace (AI_DEBUG_TRACE=true or debugAi request flag)
// ---------------------------------------------------------------------------

/**
 * Human-readable trace of a single pipeline execution.
 * Populated by chat-handler and logged / returned when debug mode is active.
 */
export interface AiTrace {
  /** ISO timestamp of this request */
  timestamp: string
  /** Raw user query */
  query: string

  // --- Query analysis ---
  answerMode: AnswerMode
  /** Post-analysis corrections applied by query-analyzer */
  correctionsApplied: string[]
  visionQuerySubtype: string
  preferredSources: string[]
  requestedSystems: string[]
  extractedEntities: Record<string, string | undefined>

  // --- Retrieval ---
  retrievalMethod: string
  evidenceItemCount: number
  evidenceBySource: Record<string, number>
  /** Whether smart-router legacy fallback was used */
  legacySmartRouterUsed: boolean
  /** Whether live PDF analysis ran */
  livePDFUsed: boolean
  livePDFMeta?: {
    attempted: number
    analyzed: number
    skipped: number
    wasCapped: boolean
  }

  // --- Sufficiency ---
  sufficiencyLevel: string
  sufficiencyScore: number
  sufficiencyReasons: string[]
  isUnsupportedDomain: boolean

  // --- Reasoning ---
  reasoningMode: string
  reasoningActivated: boolean
  findingCount: number
  gapCount: number
  evidenceStrength: string
  recommendedAnswerFrame: string
  /** Breakdown: explicit / inferred / unknown finding counts */
  supportMix: { explicit: number; inferred: number; unknown: number }

  // --- Response ---
  model: string
  temperature: number

  // --- Warnings ---
  warnings: string[]
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

// ---------------------------------------------------------------------------
// Structural entities (Phase 5A)
// ---------------------------------------------------------------------------

/** A single finding attached to a structural entity. */
export interface StructuralFinding {
  findingType: string  // 'dimension' | 'material' | 'note' | 'load_bearing' | 'capacity' | 'specification_ref'
  statement: string
  supportLevel: SupportLevel
  textValue: string | null
  numericValue: number | null
  unit: string | null
  confidence: number
}

/** A single structural entity, hydrated with location and findings. */
export interface StructuralEntity {
  id: string
  entityType: string   // 'footing' | 'column' | 'beam' | 'foundation_wall' | 'slab_edge' | 'structural_opening' | 'grid_line' | 'structural_note'
  subtype: string | null
  canonicalName: string
  displayName: string
  label: string | null  // structural mark ("F-1", "C-4", "W12×26")
  status: string        // 'existing' | 'new' | 'proposed' | 'unknown'
  confidence: number
  room: string | null
  level: string | null
  gridRef: string | null
  area: string | null
  sheetNumber: string | null
  findings: StructuralFinding[]
}

/** Return value of queryStructuralElement / queryStructuralByArea. */
export interface StructuralQueryResult {
  success: boolean
  projectId: string
  queryType: 'element' | 'area'
  mark: string | null
  gridFilter: string | null
  levelFilter: string | null
  entities: StructuralEntity[]
  totalCount: number
  sheetsCited: string[]
  confidence: number
  formattedAnswer: string
}

// ---------------------------------------------------------------------------
// MEP entities (Phase 5A)
// ---------------------------------------------------------------------------

/** A single finding attached to a MEP entity. */
export interface MEPFinding {
  findingType: string  // 'dimension' | 'material' | 'capacity' | 'equipment_tag' | 'circuit_ref' | 'note' | 'schedule_row' | 'coordination_note'
  statement: string
  supportLevel: SupportLevel
  textValue: string | null
  numericValue: number | null
  unit: string | null
  confidence: number
}

/** A parsed MEP schedule entry (panel schedule row, equipment schedule row). */
export interface MEPScheduleEntry {
  id: string
  tag: string                                             // "LP-1", "AHU-1"
  scheduleType: 'panel' | 'equipment' | 'plumbing_fixture'
  canonicalName: string
  displayName: string
  sheetNumber: string | null
  findings: MEPFinding[]
}

/** A single MEP entity, hydrated with location, trade, findings, and optional schedule linkage. */
export interface MEPEntity {
  id: string
  entityType: string  // 'panel' | 'transformer' | 'electrical_fixture' | 'conduit' | 'air_handler' | 'vav_box' | 'diffuser' | 'duct_run' | 'mechanical_equipment' | 'plumbing_fixture' | 'floor_drain' | 'cleanout' | 'piping_segment' | 'plumbing_equipment' | 'schedule_entry'
  subtype: string | null
  canonicalName: string
  displayName: string
  label: string | null    // equipment tag ("LP-1", "AHU-1", "WC-3")
  trade: 'electrical' | 'mechanical' | 'plumbing' | 'unknown'  // derived from entity_type
  status: string
  confidence: number
  room: string | null
  level: string | null
  area: string | null
  gridRef: string | null
  sheetNumber: string | null
  findings: MEPFinding[]
  scheduleEntry: MEPScheduleEntry | null
}

/** Return value of queryMEPElement / queryMEPByArea. */
export interface MEPQueryResult {
  success: boolean
  projectId: string
  queryType: 'element' | 'area'
  tag: string | null
  roomFilter: string | null
  levelFilter: string | null
  disciplineFilter: 'electrical' | 'mechanical' | 'plumbing' | null
  entities: MEPEntity[]
  totalCount: number
  sheetsCited: string[]
  confidence: number
  formattedAnswer: string
}

// ---------------------------------------------------------------------------
// Coordination (Phase 5B)
// ---------------------------------------------------------------------------

/** Summary of one trade's presence in a room or area. */
export interface TradePresence {
  trade: string            // 'structural' | 'electrical' | 'mechanical' | 'plumbing' | 'architectural' | 'demo' | 'utility'
  entityCount: number
  entityTypes: string[]    // deduplicated entity_type values in this trade
  representativeLabels: string[]  // first 3 labels/marks
  sheetsCited: string[]
}

/** Return value of coordination queries. */
export interface CoordinationQueryResult {
  success: boolean
  projectId: string
  roomFilter: string | null
  levelFilter: string | null
  tradesPresent: TradePresence[]
  coordinationNotes: string[]  // explicit coordination_note finding statements
  totalDisciplineCount: number
  confidence: number
  formattedAnswer: string
}

// ---------------------------------------------------------------------------
// Spec entities (Phase 6A)
// ---------------------------------------------------------------------------

/** A single finding attached to a spec entity. */
export interface SpecFinding {
  findingType: string  // 'material_requirement' | 'execution_requirement' | 'testing_requirement' |
                       // 'submittal_requirement' | 'closeout_requirement' | 'protection_requirement' |
                       // 'inspection_requirement' | 'note'
  statement: string
  supportLevel: SupportLevel
  textValue: string | null
  partReference: string | null  // "PART 2 - PRODUCTS, 2.1.A"
  confidence: number
}

/** A single spec section or requirement entity, hydrated with findings. */
export interface SpecEntity {
  id: string
  entityType: string   // 'spec_section' | 'spec_part' | 'spec_requirement' | 'spec_note'
  subtype: string | null  // requirement family: 'material' | 'execution' | 'testing' | etc.
  canonicalName: string
  displayName: string
  label: string | null  // section number: "03 30 00"
  status: string
  confidence: number
  sectionNumber: string | null  // normalized section: "03 30 00"
  divisionNumber: string | null // "03"
  sheetNumber: string | null    // used as section citation
  findings: SpecFinding[]
}

/** Grouped spec requirements by family for display. */
export interface SpecRequirementGroup {
  family: string  // 'material' | 'execution' | 'testing' | 'submittal' | 'closeout' | 'protection' | 'inspection'
  requirements: SpecFinding[]
}

/** Return value of querySpecSection / querySpecRequirements. */
export interface SpecQueryResult {
  success: boolean
  projectId: string
  queryType: 'section' | 'requirement_family' | 'all'
  sectionFilter: string | null     // "03 30 00"
  requirementTypeFilter: string | null
  sections: SpecEntity[]
  requirementGroups: SpecRequirementGroup[]
  totalRequirements: number
  sectionsCited: string[]
  confidence: number
  formattedAnswer: string
}

// ---------------------------------------------------------------------------
// RFI / change-document entities (Phase 6B)
// ---------------------------------------------------------------------------

/** A single finding attached to an RFI or change-document entity. */
export interface RFIFinding {
  findingType: string  // 'clarification_statement' | 'superseding_language' | 'revision_metadata' | 'note'
  statement: string
  supportLevel: SupportLevel
  textValue: string | null
  confidence: number
}

/** A referenced entity/sheet in a change document. */
export interface RFIReference {
  refType: 'sheet' | 'detail' | 'spec_section' | 'entity'
  ref: string      // "S-201", "5/S-201", "03 30 00", "F-1"
  entityId: string | null  // linked project_entity id if resolved
}

/** A single RFI / change-document entity. */
export interface RFIEntity {
  id: string
  entityType: string   // 'rfi' | 'asi' | 'addendum' | 'bulletin' | 'clarification'
  subtype: string | null
  canonicalName: string
  displayName: string
  label: string | null  // "RFI-023", "ASI-002"
  status: string        // 'new'=open | 'existing'=answered | 'to_remove'=voided
  confidence: number
  dateIssued: string | null    // ISO date string
  dateAnswered: string | null  // ISO date string
  sheetNumber: string | null
  findings: RFIFinding[]
  references: RFIReference[]   // resolved references via entity_relationships
}

/** Return value of queryRFIs / queryRFIsByEntity. */
export interface RFIQueryResult {
  success: boolean
  projectId: string
  queryType: 'by_number' | 'by_entity' | 'by_area' | 'recent_changes'
  rfiFilter: string | null        // RFI number queried
  entityFilter: string | null     // entity tag or ID queried
  answered: RFIEntity[]
  open: RFIEntity[]
  voided: RFIEntity[]
  totalCount: number
  hasOpenItems: boolean
  confidence: number
  formattedAnswer: string
}

// ---------------------------------------------------------------------------
// Submittal entities (Phase 6C)
// ---------------------------------------------------------------------------

/** A single finding attached to a submittal entity. */
export interface SubmittalFinding {
  findingType: string  // 'approval_status' | 'manufacturer_info' | 'product_tag' | 'note'
  statement: string
  supportLevel: SupportLevel
  textValue: string | null
  confidence: number
}

/** A single submittal entity. */
export interface SubmittalEntity {
  id: string
  entityType: string   // 'submittal' | 'product_data' | 'shop_drawing'
  subtype: string | null  // 'product_data' | 'shop_drawing' | 'sample' | 'certificate'
  canonicalName: string
  displayName: string
  label: string | null  // submittal ID: "03-01", "16-02"
  status: string        // 'to_remain'=approved | 'new'=submitted | 'proposed'=pending | 'to_remove'=rejected
  specSection: string | null  // spec section this covers
  confidence: number
  sheetNumber: string | null
  findings: SubmittalFinding[]
}

/** Return value of querySubmittals. */
export interface SubmittalQueryResult {
  success: boolean
  projectId: string
  queryType: 'by_id' | 'by_entity' | 'by_spec_section'
  submittalFilter: string | null
  entityFilter: string | null
  approved: SubmittalEntity[]
  pending: SubmittalEntity[]
  rejected: SubmittalEntity[]
  totalCount: number
  confidence: number
  formattedAnswer: string
}

// ---------------------------------------------------------------------------
// Governing document result (Phase 6C)
// ---------------------------------------------------------------------------

/** A single governing authority with support level and citation. */
export interface GoverningAuthority {
  document: string         // "RFI-023", "Spec 03 30 00", "Sheet S-201"
  discipline: string       // 'rfi' | 'spec' | 'architectural' | 'structural' etc.
  governs: string          // what it governs: "depth requirement", "material specification"
  supportLevel: SupportLevel
  citation: StructuredCitation | null
  conflictsWith: string | null  // if in conflict with another authority
}

/** Return value of resolveGoverningDocument. */
export interface GoverningDocResult {
  success: boolean
  projectId: string
  scope: string            // what was queried
  authorities: GoverningAuthority[]
  conflicts: Array<{
    descr: string
    between: [string, string]
    resolution: string | null  // explicit resolution text if found; null = unresolved
  }>
  hasUnresolvedConflicts: boolean
  confidence: number
  formattedAnswer: string
}
