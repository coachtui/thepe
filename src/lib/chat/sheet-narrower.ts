/**
 * Candidate Sheet Narrower — intelligently selects the most relevant subset
 * of pages from a large plan set (400–500 pages) for a given question.
 *
 * Inspecting every page for every question is operationally and economically
 * infeasible. This engine reduces the candidate set to the N most relevant
 * sheets using a ranked multi-signal strategy, then returns confidence
 * metadata so the caller knows whether to widen.
 *
 * Signal strategy (highest → lowest specificity):
 *   1. entity_match        — named entity appears on the sheet (sheet_entities)
 *   2. station_overlap     — query station falls within the sheet's range
 *   3. utility_designation — named utility system listed on the sheet
 *   4. title_keyword       — keyword appears in sheet_title
 *   5. sheet_type_match    — sheet type matches the question class expectations
 *   6. discipline_match    — sheet discipline matches the query domain
 *   7. text_keyword        — keyword appears in full text_content (weakest direct signal)
 *   8. reference_expansion — sheet is cross-referenced by a top candidate
 *   9. match_line          — sheet continues an alignment from a top candidate
 *  10. schedule_companion  — supporting context (legend, notes, schedule)
 *  11. global_expansion    — added during widening pass for enumeration queries
 *
 * Data model used:
 *   document_pages  — primary metadata (sheet_type, disciplines, utilities,
 *                     utility_designations TEXT[], station range, text_content)
 *   sheet_entities  — per-entity index (entity_type, entity_value, sheet_number)
 *   entity_locations — from the universal entity model (sheet_number)
 *   project_entities — canonical entity names and disciplines
 *   vision_data JSONB — crossReferences array extracted at query time for
 *                        reference expansion (until cross_refs column is added)
 */

import type { QueryAnalysis, AnswerMode } from './types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Classes of questions with distinct sheet-selection strategies.
 */
export type QuestionClass =
  | 'entity_lookup'      // Single named entity: "what size is footing F-3?"
  | 'enumeration'        // Count all: "how many waterlines exist?"
  | 'spatial_global'     // Linear extent: "where does WL-B start and end?"
  | 'demo_scope'         // Demolition survey: "which sheets show demo work?"
  | 'discipline_survey'  // All sheets in a domain: "show me all structural sheets"
  | 'schedule_lookup'    // Schedule/table: "what does the door schedule say?"
  | 'governing_doc'      // Authority: "what governs door D-14?"
  | 'general'            // Fallback

/**
 * The signal type that caused this sheet to be included.
 */
export type SignalType =
  | 'entity_match'        // Direct hit in sheet_entities or entity_locations
  | 'station_overlap'     // Query station within sheet station_start–station_end
  | 'utility_designation' // Named utility in document_pages.utility_designations
  | 'title_keyword'       // Keyword in document_pages.sheet_title
  | 'sheet_type_match'    // Sheet type preferred for this question class
  | 'discipline_match'    // Discipline matches inferred query domain
  | 'text_keyword'        // Keyword in document_pages.text_content
  | 'reference_expansion' // Sheet is cross-referenced by a primary candidate
  | 'match_line'          // Alignment continuation of a primary candidate
  | 'schedule_companion'  // Companion schedule/legend/notes sheet
  | 'global_expansion'    // Added during widening pass

/** Why a specific signal fired for this sheet. */
export interface ExpansionReason {
  signal: SignalType
  /** Human-readable description */
  description: string
  /** 0–1 confidence of this particular signal */
  confidence: number
}

/** A single ranked candidate sheet. */
export interface CandidateSheet {
  sheetNumber: string
  sheetTitle: string
  documentId: string
  pageNumber: number
  /** Normalized 0–100 rank score */
  score: number
  /** 1-based position in final ranked list */
  rank: number
  /** All signals that contributed to selecting this sheet */
  reasons: ExpansionReason[]
  /** Unique set of signal types that fired */
  signalTypes: SignalType[]
  /**
   * True when this sheet was added by reference expansion, match-line
   * traversal, or global widening — not a direct signal hit.
   */
  isExpansionCandidate: boolean
}

/** Full result from the narrowing engine. */
export interface NarrowingResult {
  candidates: CandidateSheet[]
  /** How confident we are that these sheets cover the answer. */
  coverageConfidence: 'high' | 'medium' | 'low'
  /**
   * Whether the caller should widen the search (e.g., inspect more sheets).
   * True for enumeration queries where we want all instances, or when
   * coverage confidence is low.
   */
  isExpansionRecommended: boolean
  expansionReason?: string
  questionClass: QuestionClass
  /** Human-readable log of which strategies ran and what they found. */
  strategyLog: string[]
  /** Total sheets in the project (for coverage ratio). */
  totalSheetsInProject: number
}

// ---------------------------------------------------------------------------
// Signal weights (raw points added per signal type)
// ---------------------------------------------------------------------------

const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  entity_match: 50,
  station_overlap: 40,
  utility_designation: 35,
  title_keyword: 28,
  sheet_type_match: 20,
  discipline_match: 15,
  text_keyword: 12,
  reference_expansion: 10,
  match_line: 12,
  schedule_companion: 8,
  global_expansion: 5,
}

/** Maximum sheets to return unless the query is a global survey. */
const DEFAULT_MAX_CANDIDATES = 10
const GLOBAL_MAX_CANDIDATES = 30

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Narrow a large document set to the most relevant candidate sheets for a
 * given question.
 *
 * @param analysis  The query analysis (mode, entities, retrieval hints)
 * @param projectId The project being queried
 * @param supabase  Authenticated Supabase client
 * @param options   Optional overrides
 */
export async function narrowCandidateSheets(
  analysis: QueryAnalysis,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  options: { maxCandidates?: number } = {}
): Promise<NarrowingResult> {
  const strategyLog: string[] = []
  const questionClass = classifyQuestion(analysis)
  const signals = extractSignals(analysis, questionClass)
  const isGlobal = questionClass === 'enumeration' || questionClass === 'discipline_survey'
  const maxCandidates = options.maxCandidates ?? (isGlobal ? GLOBAL_MAX_CANDIDATES : DEFAULT_MAX_CANDIDATES)

  strategyLog.push(`Question class: ${questionClass}`)
  strategyLog.push(`Signals extracted: entities=[${signals.entityNames.join(',')}] keywords=[${signals.keywords.join(',')}] discipline=${signals.discipline ?? 'none'} utility=[${signals.utilityDesignations.join(',')}]`)

  // ── 1. Get total sheet count (for coverage ratio) ─────────────────────────
  const totalSheetsInProject = await countProjectSheets(projectId, supabase)
  strategyLog.push(`Project has ${totalSheetsInProject} indexed pages`)

  // ── 2. Run all signal queries in parallel ─────────────────────────────────
  const scoredMap = new Map<string, ScoredPage>()

  const [
    entityHits,
    titleHits,
    utilityHits,
    stationHits,
    disciplineHits,
    textHits,
    sheetTypeHits,
  ] = await Promise.all([
    signals.entityNames.length > 0
      ? queryByEntity(signals.entityNames, projectId, supabase)
      : Promise.resolve([] as HitPage[]),
    signals.keywords.length > 0
      ? queryByTitleKeyword(signals.keywords, projectId, supabase)
      : Promise.resolve([] as HitPage[]),
    signals.utilityDesignations.length > 0
      ? queryByUtilityDesignation(signals.utilityDesignations, projectId, supabase)
      : Promise.resolve([] as HitPage[]),
    signals.station !== null
      ? queryByStationOverlap(signals.station, projectId, supabase)
      : Promise.resolve([] as HitPage[]),
    signals.discipline
      ? queryByDiscipline(signals.discipline, projectId, supabase)
      : Promise.resolve([] as HitPage[]),
    signals.keywords.length > 0 && !isGlobal
      ? queryByTextKeyword(signals.keywords, projectId, supabase)
      : Promise.resolve([] as HitPage[]),
    signals.preferredSheetTypes.length > 0
      ? queryBySheetType(signals.preferredSheetTypes, projectId, supabase)
      : Promise.resolve([] as HitPage[]),
  ])

  function merge(hits: HitPage[], signal: SignalType, confidenceModifier = 1.0) {
    for (const hit of hits) {
      const key = `${hit.documentId}::${hit.pageNumber}`
      const existing = scoredMap.get(key)
      const weight = SIGNAL_WEIGHTS[signal] * confidenceModifier * (hit.confidence ?? 1.0)
      if (!existing) {
        scoredMap.set(key, {
          ...hit,
          totalScore: weight,
          reasons: [{ signal, description: hit.matchReason, confidence: hit.confidence ?? 1.0 }],
        })
      } else {
        existing.totalScore += weight
        existing.reasons.push({ signal, description: hit.matchReason, confidence: hit.confidence ?? 1.0 })
      }
    }
  }

  merge(entityHits, 'entity_match')
  merge(titleHits, 'title_keyword')
  merge(utilityHits, 'utility_designation')
  merge(stationHits, 'station_overlap')
  merge(disciplineHits, 'discipline_match', 0.5)   // down-weighted — broad signal
  merge(textHits, 'text_keyword', 0.8)
  merge(sheetTypeHits, 'sheet_type_match', 0.6)

  strategyLog.push(`Entity hits: ${entityHits.length} | Title hits: ${titleHits.length} | Utility hits: ${utilityHits.length} | Station hits: ${stationHits.length} | Discipline hits: ${disciplineHits.length}`)

  // ── 3. Sort primary candidates ────────────────────────────────────────────
  let sorted = [...scoredMap.values()].sort((a, b) => b.totalScore - a.totalScore)

  // ── 4. Apply sheet-type bonus/penalty ─────────────────────────────────────
  sorted = applySheetTypeBonuses(sorted, questionClass, signals.preferredSheetTypes)

  // ── 5. Reference expansion — follow cross-references from top candidates ──
  const topForExpansion = sorted.slice(0, 5)
  const referenceSheets = await expandByReferences(topForExpansion, projectId, supabase)
  for (const ref of referenceSheets) {
    const key = `${ref.documentId}::${ref.pageNumber}`
    if (!scoredMap.has(key)) {
      scoredMap.set(key, {
        ...ref,
        totalScore: SIGNAL_WEIGHTS.reference_expansion * (ref.confidence ?? 0.8),
        reasons: [{ signal: 'reference_expansion', description: ref.matchReason, confidence: ref.confidence ?? 0.8 }],
      })
      strategyLog.push(`Reference expansion: added Sheet ${ref.sheetNumber} (referenced by a top candidate)`)
    }
  }

  // ── 6. Match-line traversal (linear systems) ──────────────────────────────
  if ((questionClass === 'spatial_global' || questionClass === 'enumeration') && signals.utilityDesignations.length > 0) {
    const matchLineSheets = await findMatchLineCandidates(sorted.slice(0, 8), signals.utilityDesignations, projectId, supabase)
    for (const ml of matchLineSheets) {
      const key = `${ml.documentId}::${ml.pageNumber}`
      if (!scoredMap.has(key)) {
        scoredMap.set(key, {
          ...ml,
          totalScore: SIGNAL_WEIGHTS.match_line * (ml.confidence ?? 0.85),
          reasons: [{ signal: 'match_line', description: ml.matchReason, confidence: ml.confidence ?? 0.85 }],
        })
        strategyLog.push(`Match-line expansion: added Sheet ${ml.sheetNumber} (alignment continuation)`)
      }
    }
  }

  // ── 7. Schedule/legend companion inclusion ────────────────────────────────
  if (!isGlobal && sorted.length > 0) {
    const companions = await findScheduleCompanions(sorted.slice(0, 6), signals.discipline, projectId, supabase)
    for (const comp of companions) {
      const key = `${comp.documentId}::${comp.pageNumber}`
      if (!scoredMap.has(key)) {
        scoredMap.set(key, {
          ...comp,
          totalScore: SIGNAL_WEIGHTS.schedule_companion * (comp.confidence ?? 0.7),
          reasons: [{ signal: 'schedule_companion', description: comp.matchReason, confidence: comp.confidence ?? 0.7 }],
        })
        strategyLog.push(`Schedule companion: added Sheet ${comp.sheetNumber} (${comp.matchReason})`)
      }
    }
  }

  // ── 8. Global widening (enumeration / discipline_survey) ──────────────────
  if (isGlobal && scoredMap.size < 5 && signals.discipline) {
    strategyLog.push('Global widening: fewer than 5 candidates after primary signals — widening by discipline')
    const wideHits = await queryByDiscipline(signals.discipline, projectId, supabase)
    for (const hit of wideHits) {
      const key = `${hit.documentId}::${hit.pageNumber}`
      if (!scoredMap.has(key)) {
        scoredMap.set(key, {
          ...hit,
          totalScore: SIGNAL_WEIGHTS.global_expansion,
          reasons: [{ signal: 'global_expansion', description: `All ${signals.discipline} sheets included for enumeration`, confidence: 0.5 }],
        })
      }
    }
    strategyLog.push(`Global widening added ${wideHits.length} additional sheets`)
  }

  // ── 9. Final ranking ──────────────────────────────────────────────────────
  const finalSorted = [...scoredMap.values()]
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, maxCandidates)

  const maxScore = finalSorted[0]?.totalScore ?? 1
  const candidates: CandidateSheet[] = finalSorted.map((p, i) => {
    const signalTypes = [...new Set(p.reasons.map(r => r.signal))]
    const isPrimary = signalTypes.some(s =>
      s === 'entity_match' || s === 'station_overlap' || s === 'utility_designation' || s === 'title_keyword'
    )
    return {
      sheetNumber: p.sheetNumber,
      sheetTitle: p.sheetTitle,
      documentId: p.documentId,
      pageNumber: p.pageNumber,
      score: Math.round((p.totalScore / maxScore) * 100),
      rank: i + 1,
      reasons: p.reasons,
      signalTypes,
      isExpansionCandidate: !isPrimary,
    }
  })

  // ── 10. Coverage assessment ────────────────────────────────────────────────
  const { coverageConfidence, isExpansionRecommended, expansionReason } =
    assessCoverage(candidates, signals, questionClass, totalSheetsInProject, strategyLog)

  return {
    candidates,
    coverageConfidence,
    isExpansionRecommended,
    expansionReason,
    questionClass,
    strategyLog,
    totalSheetsInProject,
  }
}

// ---------------------------------------------------------------------------
// Question classification
// ---------------------------------------------------------------------------

function classifyQuestion(analysis: QueryAnalysis): QuestionClass {
  const mode = analysis.answerMode
  const q = analysis.rawQuery.toLowerCase()

  // Phase 6: governing doc
  if (mode === 'governing_document_query' || /\bgovern\b|\bsupersede\b|\bcontrol.*document\b/.test(q)) {
    return 'governing_doc'
  }

  // Schedule lookup
  if (mode === 'arch_schedule_query' || /\bschedule\b.*\b(door|window|room|finish|panel)\b|\bdoor schedule\b/.test(q)) {
    return 'schedule_lookup'
  }

  // Demo scope
  if (mode === 'demo_scope' || mode === 'demo_constraint' || /\bdemo(lish|lition)?\b|\bremov(al|e)\b|\bprotect.*(in.place|remain)\b/.test(q)) {
    return 'demo_scope'
  }

  // Discipline survey — "show me all structural sheets"
  if (/\b(all|every|list)\b.*(structural|mep|mechanical|electrical|architectural|civil|demolition)\b.*\bsheet/i.test(q)) {
    return 'discipline_survey'
  }

  // Enumeration — counting all instances without a specific name
  if (analysis.retrievalHints.isAggregation && !analysis.entities.itemName) {
    return 'enumeration'
  }
  if (/\bhow many\b.*\b(waterline|water.*line|sewer|storm|utility|utilities|line|system)s?\b/i.test(q)) {
    return 'enumeration'
  }

  // Spatial global — start/end/terminus queries for a named system
  if (
    analysis.entities.itemName &&
    /\bstart\b|\bend\b|\bbegin\b|\bterminus\b|\bwhere does\b|\bspan\b|\bextend\b|\bhow long\b|\blength\b|\blinear feet\b/i.test(q)
  ) {
    return 'spatial_global'
  }
  if (mode === 'crossing_lookup' || mode === 'project_summary') return 'spatial_global'

  // Named entity lookup
  if (analysis.entities.itemName || analysis.entities.componentType) {
    return 'entity_lookup'
  }

  return 'general'
}

// ---------------------------------------------------------------------------
// Signal extraction
// ---------------------------------------------------------------------------

interface QuerySignals {
  entityNames: string[]
  keywords: string[]
  utilityDesignations: string[]
  discipline: string | null
  station: number | null
  preferredSheetTypes: string[]
  isGlobal: boolean
}

function extractSignals(analysis: QueryAnalysis, questionClass: QuestionClass): QuerySignals {
  const entityNames: string[] = []
  const keywords: string[] = []
  const utilityDesignations: string[] = []

  // Named entity
  if (analysis.entities.itemName) {
    entityNames.push(analysis.entities.itemName)
    utilityDesignations.push(analysis.entities.itemName)
  }
  if (analysis.entities.componentType) entityNames.push(analysis.entities.componentType)
  if (analysis.entities.material) keywords.push(analysis.entities.material)
  if (analysis.entities.sizeFilter) keywords.push(analysis.entities.sizeFilter)

  // Systems mentioned
  for (const sys of analysis.requestedSystems) {
    if (!utilityDesignations.includes(sys)) utilityDesignations.push(sys)
    if (!entityNames.includes(sys)) entityNames.push(sys)
  }

  // Extract meaningful words from raw query (stop-word filtered)
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'what', 'where', 'when', 'how', 'which',
    'does', 'do', 'this', 'that', 'and', 'or', 'of', 'in', 'on', 'at', 'to',
    'for', 'with', 'from', 'it', 'its', 'there', 'show', 'me', 'find', 'get',
    'tell', 'give', 'list', 'all', 'any', 'some', 'many', 'much', 'start', 'end',
  ])
  const rawWords = analysis.rawQuery.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w))
  // Only keep words that are plausible drawing terms
  const drawingTerms = rawWords.filter(w =>
    /^[a-z]{3,}/.test(w) && !['that', 'this', 'with', 'from', 'have', 'will', 'been', 'they', 'them'].includes(w)
  )
  keywords.push(...drawingTerms.slice(0, 5))

  // Station from entities
  let station: number | null = null
  if (analysis.entities.station) {
    const parsed = parseStationToNumeric(analysis.entities.station)
    if (parsed !== null) station = parsed
  }

  // Sheet number hint → immediate inclusion
  if (analysis.entities.sheetNumber) {
    entityNames.push(analysis.entities.sheetNumber)
  }

  // Discipline inference
  const discipline = inferDiscipline(analysis)

  // Preferred sheet types
  const preferredSheetTypes = getPreferredSheetTypes(questionClass)

  return {
    entityNames: [...new Set(entityNames)],
    keywords: [...new Set(keywords)],
    utilityDesignations: [...new Set(utilityDesignations)],
    discipline,
    station,
    preferredSheetTypes,
    isGlobal: questionClass === 'enumeration' || questionClass === 'discipline_survey',
  }
}

function inferDiscipline(analysis: QueryAnalysis): string | null {
  const mode = analysis.answerMode
  const q = analysis.rawQuery.toLowerCase()

  if (mode.startsWith('struct_') || /\bstruct\b|\bfooting\b|\bcolumn\b|\bbeam\b|\brebar\b|\bslab\b|\bfoundation\b/.test(q)) return 'structural'
  if (mode.startsWith('mep_') || /\bmep\b|\bmechanical\b|\belectrical\b|\bplumbing\b|\bhvac\b|\bpanel\b|\bahu\b|\bcircuit\b/.test(q)) return 'mep'
  if (mode.startsWith('arch_') || /\barch\b|\bdoor\b|\bwindow\b|\broom\b|\bwall type\b|\bceiling\b|\bfinish\b|\bpartition\b/.test(q)) return 'architectural'
  if (mode.startsWith('demo_') || /\bdemo\b|\bdemoli\b|\bremov/.test(q)) return 'demolition'
  if (/\bwater\s*line\b|\bsewer\b|\bstorm\b|\bgas\b|\butility\b|\bcivil\b|\bstorm drain\b/.test(q) || mode === 'quantity_lookup' || mode === 'crossing_lookup') return 'civil'

  return null
}

function getPreferredSheetTypes(questionClass: QuestionClass): string[] {
  switch (questionClass) {
    case 'entity_lookup':    return ['detail', 'schedule', 'plan']
    case 'enumeration':      return ['summary', 'title', 'schedule', 'plan']
    case 'spatial_global':   return ['plan', 'profile']
    case 'demo_scope':       return ['plan', 'detail', 'profile']
    case 'discipline_survey':return []
    case 'schedule_lookup':  return ['schedule', 'detail']
    case 'governing_doc':    return ['notes', 'title', 'schedule']
    case 'general':          return ['plan', 'profile']
  }
}

// ---------------------------------------------------------------------------
// Signal queries
// ---------------------------------------------------------------------------

/** Internal scoring accumulator */
interface ScoredPage {
  documentId: string
  pageNumber: number
  sheetNumber: string
  sheetTitle: string
  totalScore: number
  reasons: ExpansionReason[]
  confidence: number
  matchReason: string
}

/** Partial scored page returned from individual queries before merging */
interface HitPage {
  documentId: string
  pageNumber: number
  sheetNumber: string
  sheetTitle: string
  confidence: number
  matchReason: string
}

async function queryByEntity(
  entityNames: string[],
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HitPage[]> {
  if (entityNames.length === 0) return []

  try {
    // Build OR filter for all entity names across all useful entity types
    const orClauses = entityNames.flatMap(name => [
      `entity_value.ilike.%${name}%`,
    ]).join(',')

    const { data, error } = await supabase
      .from('sheet_entities')
      .select('document_id, page_number, sheet_number, entity_value, entity_type, confidence')
      .eq('project_id', projectId)
      .or(orClauses)
      .in('entity_type', ['utility_designation', 'structure', 'equipment_label', 'pipe_size', 'callout', 'detail_reference', 'material'])
      .limit(200)

    if (error || !data) return []

    // Join with document_pages for sheet_title
    const pageKeys = [...new Set((data as EntityRow[]).map(r => `${r.document_id}::${r.page_number}`))]
    if (pageKeys.length === 0) return []

    const pageData = await fetchPageMetadata(
      (data as EntityRow[]).map(r => ({ documentId: r.document_id, pageNumber: r.page_number })),
      supabase
    )

    return (data as EntityRow[]).map(row => {
      const meta = pageData.get(`${row.document_id}::${row.page_number}`)
      return {
        documentId: row.document_id,
        pageNumber: row.page_number,
        sheetNumber: row.sheet_number ?? meta?.sheet_number ?? `p${row.page_number}`,
        sheetTitle: meta?.sheet_title ?? '',
        confidence: row.confidence ?? 0.85,
        matchReason: `Entity "${row.entity_value}" (${row.entity_type}) found on sheet`,
      }
    })
  } catch (err) {
    console.warn('[SheetNarrower] queryByEntity error:', err)
    return []
  }
}

async function queryByTitleKeyword(
  keywords: string[],
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HitPage[]> {
  if (keywords.length === 0) return []

  try {
    const orClauses = keywords.map(kw => `sheet_title.ilike.%${kw}%`).join(',')

    const { data, error } = await supabase
      .from('document_pages')
      .select('document_id, page_number, sheet_number, sheet_title')
      .eq('project_id', projectId)
      .not('sheet_title', 'is', null)
      .or(orClauses)
      .limit(100)

    if (error || !data) return []

    return (data as PageRow[]).map(row => ({
      documentId: row.document_id,
      pageNumber: row.page_number,
      sheetNumber: row.sheet_number ?? `p${row.page_number}`,
      sheetTitle: row.sheet_title ?? '',
      confidence: 0.75,
      matchReason: `Keyword match in sheet title "${row.sheet_title}"`,
    }))
  } catch (err) {
    console.warn('[SheetNarrower] queryByTitleKeyword error:', err)
    return []
  }
}

async function queryByUtilityDesignation(
  designations: string[],
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HitPage[]> {
  if (designations.length === 0) return []

  try {
    // TEXT[] overlap using the @> operator isn't great for partial matches.
    // Use a ILIKE approach via sheet_entities which has per-entity rows.
    const orClauses = designations.map(d => `entity_value.ilike.%${d}%`).join(',')

    const { data, error } = await supabase
      .from('sheet_entities')
      .select('document_id, page_number, sheet_number, entity_value, confidence')
      .eq('project_id', projectId)
      .eq('entity_type', 'utility_designation')
      .or(orClauses)
      .limit(150)

    if (error || !data) return []

    const pageData = await fetchPageMetadata(
      (data as EntityRow[]).map(r => ({ documentId: r.document_id, pageNumber: r.page_number })),
      supabase
    )

    return (data as EntityRow[]).map(row => {
      const meta = pageData.get(`${row.document_id}::${row.page_number}`)
      return {
        documentId: row.document_id,
        pageNumber: row.page_number,
        sheetNumber: row.sheet_number ?? meta?.sheet_number ?? `p${row.page_number}`,
        sheetTitle: meta?.sheet_title ?? '',
        confidence: row.confidence ?? 0.9,
        matchReason: `Utility "${row.entity_value}" designation on sheet`,
      }
    })
  } catch (err) {
    console.warn('[SheetNarrower] queryByUtilityDesignation error:', err)
    return []
  }
}

async function queryByStationOverlap(
  stationNumeric: number,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HitPage[]> {
  try {
    const { data, error } = await supabase
      .from('document_pages')
      .select('document_id, page_number, sheet_number, sheet_title, station_start, station_end, station_start_numeric, station_end_numeric')
      .eq('project_id', projectId)
      .eq('has_stations', true)
      .lte('station_start_numeric', stationNumeric)
      .gte('station_end_numeric', stationNumeric)
      .limit(30)

    if (error || !data) return []

    return (data as StationPageRow[]).map(row => ({
      documentId: row.document_id,
      pageNumber: row.page_number,
      sheetNumber: row.sheet_number ?? `p${row.page_number}`,
      sheetTitle: row.sheet_title ?? '',
      confidence: 0.95,
      matchReason: `Station ${formatStation(stationNumeric)} within sheet range ${row.station_start ?? '?'} – ${row.station_end ?? '?'}`,
    }))
  } catch (err) {
    console.warn('[SheetNarrower] queryByStationOverlap error:', err)
    return []
  }
}

async function queryByDiscipline(
  discipline: string,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HitPage[]> {
  try {
    const { data, error } = await supabase
      .from('document_pages')
      .select('document_id, page_number, sheet_number, sheet_title, disciplines')
      .eq('project_id', projectId)
      .contains('disciplines', [discipline])
      .limit(150)

    if (error || !data) return []

    return (data as PageRow[]).map(row => ({
      documentId: row.document_id,
      pageNumber: row.page_number,
      sheetNumber: row.sheet_number ?? `p${row.page_number}`,
      sheetTitle: row.sheet_title ?? '',
      confidence: 0.6,
      matchReason: `Sheet has discipline "${discipline}"`,
    }))
  } catch (err) {
    console.warn('[SheetNarrower] queryByDiscipline error:', err)
    return []
  }
}

async function queryByTextKeyword(
  keywords: string[],
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HitPage[]> {
  if (keywords.length === 0) return []

  try {
    // Only search top-3 most specific keywords to avoid flooding with low-signal results
    const topKeywords = keywords.slice(0, 3)
    const orClauses = topKeywords.map(kw => `text_content.ilike.%${kw}%`).join(',')

    const { data, error } = await supabase
      .from('document_pages')
      .select('document_id, page_number, sheet_number, sheet_title')
      .eq('project_id', projectId)
      .not('text_content', 'is', null)
      .or(orClauses)
      .limit(50)

    if (error || !data) return []

    return (data as PageRow[]).map(row => ({
      documentId: row.document_id,
      pageNumber: row.page_number,
      sheetNumber: row.sheet_number ?? `p${row.page_number}`,
      sheetTitle: row.sheet_title ?? '',
      confidence: 0.5,
      matchReason: `Text content match for: ${topKeywords.join(', ')}`,
    }))
  } catch (err) {
    console.warn('[SheetNarrower] queryByTextKeyword error:', err)
    return []
  }
}

async function queryBySheetType(
  preferredTypes: string[],
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HitPage[]> {
  if (preferredTypes.length === 0) return []

  try {
    const { data, error } = await supabase
      .from('document_pages')
      .select('document_id, page_number, sheet_number, sheet_title, sheet_type')
      .eq('project_id', projectId)
      .in('sheet_type', preferredTypes)
      .limit(50)

    if (error || !data) return []

    return (data as PageRow[]).map(row => ({
      documentId: row.document_id,
      pageNumber: row.page_number,
      sheetNumber: row.sheet_number ?? `p${row.page_number}`,
      sheetTitle: row.sheet_title ?? '',
      confidence: 0.55,
      matchReason: `Sheet type "${row.sheet_type}" matches expected type for this question`,
    }))
  } catch (err) {
    console.warn('[SheetNarrower] queryBySheetType error:', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Sheet-type bonus/penalty (post-scoring adjustment)
// ---------------------------------------------------------------------------

function applySheetTypeBonuses(
  pages: ScoredPage[],
  questionClass: QuestionClass,
  preferredTypes: string[]
): ScoredPage[] {
  return pages.map(p => {
    // We don't have sheet_type in ScoredPage yet. Skip type bonuses when unavailable.
    // This is applied in the full pipeline via the queryBySheetType signal weight.
    // Placeholder for future refinement with cached metadata.
    return p
  })
}

// ---------------------------------------------------------------------------
// Reference expansion — follow cross-references from vision_data
// ---------------------------------------------------------------------------

/**
 * For each top candidate, extract cross-references from vision_data JSONB
 * and find the corresponding document_pages rows for the referenced sheets.
 *
 * Until the cross_references TEXT[] column is added (migration 00045), we
 * query vision_data->crossReferences at query time for the top few pages.
 */
async function expandByReferences(
  topCandidates: ScoredPage[],
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HitPage[]> {
  if (topCandidates.length === 0) return []

  try {
    // Extract page IDs for vision_data fetch
    const ids = topCandidates.map(p => ({ doc: p.documentId, page: p.pageNumber }))

    // Fetch vision_data for top candidates
    const { data: visionRows, error } = await supabase
      .from('document_pages')
      .select('document_id, page_number, sheet_number, vision_data')
      .eq('project_id', projectId)
      .in('document_id', [...new Set(ids.map(i => i.doc))])
      .in('page_number', [...new Set(ids.map(i => i.page))])

    if (error || !visionRows) return []

    // Collect referenced sheet numbers
    const referencedSheets = new Set<string>()
    const topSheets = new Set(topCandidates.map(p => p.sheetNumber?.toUpperCase()))

    for (const row of visionRows as VisionDataRow[]) {
      const vd = row.vision_data as VisionData | null
      if (!vd?.crossReferences) continue

      for (const ref of vd.crossReferences) {
        if (ref.type === 'sheet' && ref.reference) {
          const normalized = ref.reference.trim().toUpperCase()
          if (!topSheets.has(normalized) && normalized.length <= 20) {
            referencedSheets.add(normalized)
          }
        }
      }
    }

    if (referencedSheets.size === 0) return []

    // Find document_pages for the referenced sheets
    const { data: refPages, error: refErr } = await supabase
      .from('document_pages')
      .select('document_id, page_number, sheet_number, sheet_title')
      .eq('project_id', projectId)
      .in('sheet_number', [...referencedSheets])
      .limit(20)

    if (refErr || !refPages) return []

    return (refPages as PageRow[]).map(row => ({
      documentId: row.document_id,
      pageNumber: row.page_number,
      sheetNumber: row.sheet_number ?? `p${row.page_number}`,
      sheetTitle: row.sheet_title ?? '',
      confidence: 0.8,
      matchReason: `Cross-referenced from a top-ranked candidate sheet`,
    }))
  } catch (err) {
    console.warn('[SheetNarrower] expandByReferences error:', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Match-line traversal — fill alignment gaps for linear systems
// ---------------------------------------------------------------------------

/**
 * For a linear system (waterline, sewer), find sheets that fill the station
 * ranges between the already-selected candidate sheets.
 *
 * Strategy: sort candidates by station_start_numeric, detect gaps, then
 * query for sheets covering those gaps.
 */
async function findMatchLineCandidates(
  topCandidates: ScoredPage[],
  utilityDesignations: string[],
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HitPage[]> {
  if (topCandidates.length === 0 || utilityDesignations.length === 0) return []

  try {
    // Fetch station ranges for the top candidates
    const { data: stationRows } = await supabase
      .from('document_pages')
      .select('document_id, page_number, sheet_number, sheet_title, station_start_numeric, station_end_numeric')
      .eq('project_id', projectId)
      .in('document_id', topCandidates.map(p => p.documentId))
      .in('page_number', topCandidates.map(p => p.pageNumber))
      .eq('has_stations', true)
      .not('station_start_numeric', 'is', null)
      .not('station_end_numeric', 'is', null)

    if (!stationRows || stationRows.length < 2) return []

    type StationRow = { station_start_numeric: number; station_end_numeric: number }
    const sorted = (stationRows as StationRow[]).sort((a, b) => a.station_start_numeric - b.station_start_numeric)

    // Find gaps between consecutive sheets
    const gapQueries: Promise<HitPage[]>[] = []

    for (let i = 0; i < sorted.length - 1; i++) {
      const gapStart = sorted[i].station_end_numeric
      const gapEnd = sorted[i + 1].station_start_numeric

      if (gapStart < gapEnd) {
        const midStation = (gapStart + gapEnd) / 2
        gapQueries.push(
          supabase
            .from('document_pages')
            .select('document_id, page_number, sheet_number, sheet_title')
            .eq('project_id', projectId)
            .eq('has_stations', true)
            .lte('station_start_numeric', midStation)
            .gte('station_end_numeric', midStation)
            .limit(5)
            .then(({ data }: { data: PageRow[] | null }) =>
              (data ?? []).map(row => ({
                documentId: row.document_id,
                pageNumber: row.page_number,
                sheetNumber: row.sheet_number ?? `p${row.page_number}`,
                sheetTitle: row.sheet_title ?? '',
                confidence: 0.85,
                matchReason: `Fills station gap ${formatStation(gapStart)}–${formatStation(gapEnd)} in alignment`,
              }))
            )
            .catch(() => [])
        )
      }
    }

    const results = await Promise.all(gapQueries)
    return results.flat()
  } catch (err) {
    console.warn('[SheetNarrower] findMatchLineCandidates error:', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Schedule/legend companion inclusion
// ---------------------------------------------------------------------------

/**
 * For primary candidates that are plan or profile sheets, also include any
 * schedule, legend, or notes sheet from the same discipline.
 * These provide the key/legend context needed to interpret the drawings.
 */
async function findScheduleCompanions(
  topCandidates: ScoredPage[],
  discipline: string | null,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HitPage[]> {
  try {
    const companionTypes = ['schedule', 'legend', 'notes']

    let query = supabase
      .from('document_pages')
      .select('document_id, page_number, sheet_number, sheet_title, sheet_type')
      .eq('project_id', projectId)
      .in('sheet_type', companionTypes)
      .limit(10)

    if (discipline) {
      query = query.contains('disciplines', [discipline])
    }

    const { data, error } = await query
    if (error || !data) return []

    const topSheetNums = new Set(topCandidates.map(p => p.sheetNumber?.toUpperCase()))

    return (data as PageRow[])
      .filter(row => !topSheetNums.has((row.sheet_number ?? '').toUpperCase()))
      .map(row => ({
        documentId: row.document_id,
        pageNumber: row.page_number,
        sheetNumber: row.sheet_number ?? `p${row.page_number}`,
        sheetTitle: row.sheet_title ?? '',
        confidence: 0.65,
        matchReason: `${row.sheet_type ?? 'companion'} sheet provides legend/notes context`,
      }))
  } catch (err) {
    console.warn('[SheetNarrower] findScheduleCompanions error:', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Coverage assessment
// ---------------------------------------------------------------------------

function assessCoverage(
  candidates: CandidateSheet[],
  signals: QuerySignals,
  questionClass: QuestionClass,
  totalSheets: number,
  strategyLog: string[]
): { coverageConfidence: 'high' | 'medium' | 'low'; isExpansionRecommended: boolean; expansionReason?: string } {
  const primaryHits = candidates.filter(c =>
    c.signalTypes.some(s => s === 'entity_match' || s === 'station_overlap' || s === 'utility_designation')
  )
  const hasDirectEvidence = primaryHits.length > 0
  const topScore = candidates[0]?.score ?? 0

  // High coverage: direct entity/station hits with high scores
  if (hasDirectEvidence && topScore >= 70 && candidates.length >= 3) {
    const msg = `${primaryHits.length} direct-signal hit(s), score ${topScore}/100`
    strategyLog.push(`Coverage: HIGH — ${msg}`)
    return {
      coverageConfidence: 'high',
      isExpansionRecommended: questionClass === 'enumeration',
      expansionReason: questionClass === 'enumeration'
        ? 'Enumeration queries should inspect all matching sheets to avoid missing any instances'
        : undefined,
    }
  }

  // Medium coverage: title/text keyword hits or indirect signals
  if (candidates.length >= 2 && topScore >= 40) {
    strategyLog.push(`Coverage: MEDIUM — ${candidates.length} candidates, top score ${topScore}/100`)
    return {
      coverageConfidence: 'medium',
      isExpansionRecommended: questionClass === 'spatial_global' || questionClass === 'enumeration',
      expansionReason: 'Consider inspecting additional adjacent sheets for complete coverage',
    }
  }

  // Low coverage: few or no strong signals
  strategyLog.push(`Coverage: LOW — ${candidates.length} candidates, top score ${topScore}/100`)
  return {
    coverageConfidence: 'low',
    isExpansionRecommended: true,
    expansionReason: candidates.length === 0
      ? 'No matching sheets found. Vision processing may not have run on this project, or the entity name may not match the drawings.'
      : `Only ${candidates.length} weakly-matching sheets found. The entity name or terminology may differ from what appears on the drawings.`,
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

async function countProjectSheets(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('document_pages')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)

    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

/**
 * Fetch sheet_title for a batch of (documentId, pageNumber) pairs.
 * Returns a map keyed by "documentId::pageNumber".
 */
async function fetchPageMetadata(
  pages: Array<{ documentId: string; pageNumber: number }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<Map<string, { sheet_number: string | null; sheet_title: string | null }>> {
  const map = new Map<string, { sheet_number: string | null; sheet_title: string | null }>()
  if (pages.length === 0) return map

  try {
    const docIds = [...new Set(pages.map(p => p.documentId))]
    const pageNums = [...new Set(pages.map(p => p.pageNumber))]

    const { data } = await supabase
      .from('document_pages')
      .select('document_id, page_number, sheet_number, sheet_title')
      .in('document_id', docIds)
      .in('page_number', pageNums)

    for (const row of data ?? []) {
      map.set(`${row.document_id}::${row.page_number}`, {
        sheet_number: row.sheet_number,
        sheet_title: row.sheet_title,
      })
    }
  } catch {
    // Ignore — caller handles missing metadata gracefully
  }

  return map
}

function parseStationToNumeric(station: string): number | null {
  const m = station.trim().match(/^(\d{1,3})\+(\d{2}(?:\.\d{1,2})?)$/)
  if (!m) return null
  return parseFloat(m[1]) * 100 + parseFloat(m[2])
}

function formatStation(numeric: number): string {
  const major = Math.floor(numeric / 100)
  const minor = (numeric % 100).toFixed(2).padStart(5, '0')
  return `${major}+${minor}`
}

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface EntityRow {
  document_id: string
  page_number: number
  sheet_number: string | null
  entity_value: string
  entity_type: string
  confidence: number | null
}

interface PageRow {
  document_id: string
  page_number: number
  sheet_number: string | null
  sheet_title: string | null
  sheet_type?: string | null
  disciplines?: string[]
}

interface StationPageRow extends PageRow {
  station_start: string | null
  station_end: string | null
  station_start_numeric: number | null
  station_end_numeric: number | null
}

interface VisionData {
  crossReferences?: Array<{ type: string; reference: string; description?: string }>
}

interface VisionDataRow {
  document_id: string
  page_number: number
  sheet_number: string | null
  vision_data: VisionData | null
}
