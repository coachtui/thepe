/**
 * Retrieval Orchestrator — unified retrieval across all data sources.
 *
 * Responsibility: Given a QueryAnalysis, return a normalized EvidencePacket.
 *
 * Order of retrieval attempts:
 *   1. Vision DB (component counts, crossings, lengths from pre-extracted data)
 *   2. Smart router (direct quantity lookup + vector/complete data search)
 *   3. Live PDF analysis (last resort — explicit, tracked, and confidence-capped)
 *
 * Classification contract:
 *   - classifyQuery() and determineVisionQueryType() run ONCE in query-analyzer.
 *   - Their results are stored in analysis._routing and passed to routeQuery()
 *     via precomputedClassification / skipVisionDBLookup, so those functions
 *     are never called a second time on the same string.
 *
 * Context contract:
 *   - formattedContext in the returned EvidencePacket is built ONLY from
 *     normalized EvidenceItem[] by buildContextFromEvidence().
 *   - routingResult.context (smart-router's legacy string) is never passed
 *     through to the response-writer.
 */

import { routeQuery } from './smart-router'
import type { QueryClassification } from './query-classifier'
import {
  queryComponentCount,
  queryCrossings,
  queryUtilityLength,
  detectComponentType,
  extractSizeFromQuery,
} from './vision-queries'
import {
  queryDemoScope,
  queryDemoConstraints,
  formatDemoConstraintsAsContext,
} from './demo-queries'
import {
  queryArchElement,
  queryArchRoom,
  queryArchSchedule,
  formatArchElementAnswer,
  formatArchRoomAnswer,
} from './arch-queries'
import {
  queryStructuralElement,
  queryStructuralByArea,
  formatStructuralElementAnswer,
  formatStructuralAreaAnswer,
} from './structural-queries'
import {
  queryMEPElement,
  queryMEPByArea,
  formatMEPElementAnswer,
  formatMEPAreaAnswer,
} from './mep-queries'
import {
  queryTradesInRoom,
  queryCoordinationConstraints,
  queryAffectedArea,
} from './coordination-queries'
import { createDocumentAnalyzer, type PEAgentConfig } from '@/agents/constructionPEAgent'
import type {
  QueryAnalysis,
  EvidencePacket,
  EvidenceItem,
  EvidenceSourceType,
  LiveAnalysisMeta,
} from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PDF_SIZE_MB = 10
const MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024
const MAX_SHEETS = 15

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve evidence for a query and return a normalized EvidencePacket.
 *
 * @param analysis    Output of analyzeQuery()
 * @param projectId   Supabase project UUID
 * @param supabase    Authenticated Supabase client (caller owns auth)
 * @param projectCtx  Optional project context for live PDF analysis
 */
export async function retrieveEvidence(
  analysis: QueryAnalysis,
  projectId: string,
  supabase: SupabaseClient,
  projectCtx?: PEAgentConfig['projectContext']
): Promise<EvidencePacket> {
  const items: EvidenceItem[] = []
  let retrievalMethod = 'none'
  let liveAnalysisMeta: LiveAnalysisMeta | undefined

  // ------------------------------------------------------------------
  // Step 1: Unsupported domains — skip all retrieval.
  // ------------------------------------------------------------------
  if (analysis.supportLevelExpected === 'unsupported') {
    return {
      answerMode: analysis.answerMode,
      query: analysis.rawQuery,
      items: [],
      formattedContext: '',
      sources: [],
      retrievalMethod: 'skipped_unsupported_domain',
    }
  }

  // ------------------------------------------------------------------
  // Step 2: Vision DB lookups (highest precision for structured data).
  // ------------------------------------------------------------------
  let visionDBAttempted = false

  if (analysis.retrievalHints.needsVisionDBLookup) {
    visionDBAttempted = true
    const visionItems = await attemptVisionDBLookup(analysis, projectId)
    if (visionItems.length > 0) {
      items.push(...visionItems)
      retrievalMethod = 'vision_db'
    }
  }

  // ------------------------------------------------------------------
  // Step 2.5: Demo graph queries (for demo_scope and demo_constraint modes).
  // Runs before smart router so that demo entity data takes priority over
  // generic vector search. Falls through if no demo entities exist yet.
  // ------------------------------------------------------------------
  if (
    items.length === 0 &&
    (analysis.answerMode === 'demo_scope' || analysis.answerMode === 'demo_constraint')
  ) {
    const demoItem = await attemptDemoGraphLookup(analysis, projectId)
    if (demoItem) {
      items.push(demoItem)
      retrievalMethod = 'demo_graph'
    }
  }

  // ------------------------------------------------------------------
  // Step 2.75: Arch graph queries (for arch_element_lookup, arch_room_scope,
  // arch_schedule_query). Runs after demo graph so arch data takes priority
  // over generic vector search. Falls through if no arch entities exist yet.
  // ------------------------------------------------------------------
  if (
    items.length === 0 &&
    (analysis.answerMode === 'arch_element_lookup' ||
     analysis.answerMode === 'arch_room_scope'     ||
     analysis.answerMode === 'arch_schedule_query')
  ) {
    const archItem = await attemptArchGraphLookup(analysis, projectId)
    if (archItem) {
      items.push(archItem)
      retrievalMethod = 'arch_graph'
    }
  }

  // ------------------------------------------------------------------
  // Step 2.8: Structural graph queries (for struct_element_lookup and
  // struct_area_scope). Runs after arch graph so structural data takes
  // priority over generic vector search.
  // ------------------------------------------------------------------
  if (
    items.length === 0 &&
    (analysis.answerMode === 'struct_element_lookup' ||
     analysis.answerMode === 'struct_area_scope')
  ) {
    const structItem = await attemptStructuralGraphLookup(analysis, projectId)
    if (structItem) {
      items.push(structItem)
      retrievalMethod = 'structural_graph'
    }
  }

  // ------------------------------------------------------------------
  // Step 2.85: MEP graph queries (for mep_element_lookup and mep_area_scope).
  // ------------------------------------------------------------------
  if (
    items.length === 0 &&
    (analysis.answerMode === 'mep_element_lookup' ||
     analysis.answerMode === 'mep_area_scope')
  ) {
    const mepItem = await attemptMEPGraphLookup(analysis, projectId)
    if (mepItem) {
      items.push(mepItem)
      retrievalMethod = 'mep_graph'
    }
  }

  // ------------------------------------------------------------------
  // Step 2.9: Coordination graph queries (Phase 5B).
  // Cross-discipline room/level lookup — always runs before smart router
  // for coordination modes.
  // ------------------------------------------------------------------
  if (
    items.length === 0 &&
    (analysis.answerMode === 'trade_coordination'    ||
     analysis.answerMode === 'coordination_sequence' ||
     analysis.answerMode === 'affected_area')
  ) {
    const coordItem = await attemptCoordinationGraphLookup(analysis, projectId)
    if (coordItem) {
      items.push(coordItem)
      retrievalMethod = 'coordination_graph'
    }
  }

  // ------------------------------------------------------------------
  // Step 3: Smart router (project summary, direct lookup, vector/complete search).
  // Only runs if vision DB didn't fully satisfy the query.
  // Passes pre-computed classification so smart-router skips re-classification.
  // ------------------------------------------------------------------
  if (items.length === 0) {
    const routing = analysis._routing as
      | { classification: QueryClassification; visionQueryType: string }
      | undefined

    const routingResult = await routeQuery(analysis.rawQuery, projectId, {
      includeMetadata: false,
      maxResults: 50,
      precomputedClassification:  routing?.classification,
      // Vision DB was already attempted above — tell smart-router to skip it.
      skipVisionDBLookup: visionDBAttempted,
    })

    if (routingResult.directLookup?.success && routingResult.directLookup.answer) {
      items.push({
        source: 'direct_lookup',
        content: routingResult.directLookup.answer,
        confidence: routingResult.directLookup.confidence,
        rawData: routingResult.directLookup,
      })
    }

    // The smart-router normalizes complete_data chunks into vectorResults.
    // We tag them as complete_data when the method was complete_data,
    // otherwise vector_search. This lets buildContextFromEvidence() label
    // them correctly.
    const vectorSourceType: EvidenceSourceType =
      routingResult.method === 'complete_data' ? 'complete_data' : 'vector_search'

    const vectorItems = routingResult.vectorResults
      .slice(0, 20)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any): EvidenceItem => ({
        source: vectorSourceType,
        content: r.content,
        citation: {
          sheetNumber: r.sheet_number ?? undefined,
          filename:    r.document_filename ?? undefined,
        },
        confidence: r.boosted_score ?? r.similarity ?? 0.5,
        rawData: r,
      }))

    items.push(...vectorItems)

    if (items.length > 0) {
      retrievalMethod = routingResult.method
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Live PDF analysis — explicit last resort.
  // Only attempted when no evidence was found above, and the query
  // mode warrants it.
  // ------------------------------------------------------------------
  if (items.length === 0 && shouldAttemptLivePDF(analysis.answerMode)) {
    const pdfResult = await attemptLivePDFAnalysis(
      analysis,
      projectId,
      supabase,
      projectCtx
    )

    if (pdfResult) {
      items.push(...pdfResult.items)
      liveAnalysisMeta = pdfResult.meta
      retrievalMethod = 'live_pdf_analysis'
    }
  }

  return {
    answerMode: analysis.answerMode,
    query: analysis.rawQuery,
    items,
    // Context is built from normalized items — never from smart-router's
    // legacy context string.
    formattedContext: buildContextFromEvidence(items),
    sources: extractSources(items),
    liveAnalysisMeta,
    retrievalMethod,
  }
}

// ---------------------------------------------------------------------------
// Context builder — single canonical builder from EvidenceItem[]
// ---------------------------------------------------------------------------

/**
 * Build the model-facing context string from normalized evidence items.
 *
 * This replaces buildContextFromHybridSearch() and buildContextFromCompleteData()
 * from smart-router / station-aware-search. Those functions built context from
 * their own internal shapes. This function builds context from EvidenceItem[],
 * which is the canonical form.
 *
 * Ordering: vision_db → direct_lookup → project_summary → complete_data →
 *           vector_search → live_pdf_analysis
 */
export function buildContextFromEvidence(items: EvidenceItem[]): string {
  if (items.length === 0) return ''

  const parts: string[] = []
  const bySource = groupBySource(items)

  // Vision DB first — most precise, pre-extracted from drawings
  const visionItems = bySource.vision_db ?? []
  if (visionItems.length > 0) {
    parts.push('## Vision-Extracted Data\n')
    parts.push(visionItems.map(i => i.content).join('\n\n'))
  }

  // Direct lookup — structured DB quantities
  const directItems = bySource.direct_lookup ?? []
  if (directItems.length > 0) {
    parts.push('\n## Direct Quantity Lookup\n')
    for (const item of directItems) {
      parts.push(item.content)
      if (item.citation?.sheetNumber) {
        parts.push(`Source: Sheet ${item.citation.sheetNumber}`)
      }
    }
  }

  // Project summary
  const summaryItems = bySource.project_summary ?? []
  if (summaryItems.length > 0) {
    parts.push('\n## Project Summary\n')
    parts.push(summaryItems.map(i => i.content).join('\n\n'))
  }

  // Complete system data (all chunks for a system — used for full takeoffs)
  const completeItems = bySource.complete_data ?? []
  if (completeItems.length > 0) {
    parts.push('\n## Complete System Data\n')
    parts.push(`You have ALL component data for this system (${completeItems.length} records).`)
    parts.push('Count accurately from every entry below.\n')
    completeItems.forEach((item, idx) => {
      let header = `[${idx + 1}]`
      if (item.citation?.filename)    header += ` ${item.citation.filename}`
      if (item.citation?.sheetNumber) header += ` — Sheet ${item.citation.sheetNumber}`
      parts.push(`${header}:\n${item.content}\n`)
    })
  }

  // Vector search results — semantically relevant document chunks
  const vectorItems = bySource.vector_search ?? []
  if (vectorItems.length > 0) {
    parts.push('\n## Relevant Document Sections\n')
    vectorItems.forEach((item, idx) => {
      let header = `[${idx + 1}]`
      if (item.citation?.filename)    header += ` ${item.citation.filename}`
      if (item.citation?.sheetNumber) header += ` — Sheet ${item.citation.sheetNumber}`
      parts.push(`${header}:\n${item.content}\n`)
    })
  }

  // Live PDF analysis — built from documentAnalyzer output
  const liveItems = bySource.live_pdf_analysis ?? []
  if (liveItems.length > 0) {
    parts.push('\n## Live Analysis Results\n')
    parts.push(liveItems.map(i => i.content).join('\n\n'))
  }

  return parts.join('\n')
}

function groupBySource(
  items: EvidenceItem[]
): Partial<Record<EvidenceSourceType, EvidenceItem[]>> {
  const result: Partial<Record<EvidenceSourceType, EvidenceItem[]>> = {}
  for (const item of items) {
    const arr = result[item.source] ?? []
    arr.push(item)
    result[item.source] = arr
  }
  return result
}

// ---------------------------------------------------------------------------
// Arch graph lookup (Phase 4)
// ---------------------------------------------------------------------------

/**
 * Query the entity graph for architectural entities. Returns a single EvidenceItem
 * wrapping the formatted arch content, or null when no arch entities exist yet.
 */
async function attemptArchGraphLookup(
  analysis: QueryAnalysis,
  projectId: string
): Promise<EvidenceItem | null> {
  const archTag          = analysis._routing?.archTag          ?? undefined
  const archTagType      = analysis._routing?.archTagType      ?? undefined
  const archRoom         = analysis._routing?.archRoom         ?? undefined
  const archScheduleType = analysis._routing?.archScheduleType ?? undefined

  try {
    if (analysis.answerMode === 'arch_schedule_query') {
      const schedType = (archScheduleType ?? 'door') as 'door' | 'window' | 'room_finish'
      const entries = await queryArchSchedule(projectId, schedType, archTag)

      if (entries.length === 0) return null

      const lines = entries.slice(0, 15).map(e =>
        `- ${e.tag}: ${e.displayName}${e.sheetNumber ? ` (Sheet ${e.sheetNumber})` : ''}`
      )
      const content =
        `${schedType.replace('_', ' ')} schedule — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} found.\n` +
        lines.join('\n')

      return {
        source:     'vision_db',
        content,
        confidence: 0.9,
        rawData:    entries,
      }
    }

    if (analysis.answerMode === 'arch_room_scope') {
      const result = await queryArchRoom(projectId, archRoom ?? null)

      if (!result.success || result.totalCount === 0) return null

      return {
        source:     'vision_db',
        content:    formatArchRoomAnswer(result),
        confidence: result.confidence,
        rawData:    result,
      }
    }

    // arch_element_lookup — requires a tag
    if (!archTag) return null

    const safeArchTagType = (archTagType && archTagType !== 'room') ? archTagType : undefined
    const result = await queryArchElement(projectId, archTag, safeArchTagType)

    if (!result.success || result.totalCount === 0) return null

    return {
      source:     'vision_db',
      content:    formatArchElementAnswer(result),
      confidence: result.confidence,
      rawData:    result,
    }
  } catch (err) {
    console.error('[RetrievalOrchestrator] Arch graph lookup error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Structural graph lookup (Phase 5A)
// ---------------------------------------------------------------------------

/**
 * Query the entity graph for structural entities. Returns a single EvidenceItem
 * wrapping the formatted structural content, or null when no structural entities exist.
 */
async function attemptStructuralGraphLookup(
  analysis: QueryAnalysis,
  projectId: string
): Promise<EvidenceItem | null> {
  const structMark       = analysis._routing?.structMark       ?? undefined
  const structEntityType = analysis._routing?.structEntityType ?? undefined
  const structGrid       = analysis._routing?.structGrid       ?? undefined
  const structLevel      = analysis._routing?.structLevel      ?? undefined

  try {
    if (analysis.answerMode === 'struct_element_lookup') {
      if (!structMark) return null

      const result = await queryStructuralElement(
        projectId,
        structMark,
        structEntityType as 'footing' | 'column' | 'beam' | 'foundation_wall' | 'grid_line' | null ?? undefined
      )

      if (!result.success || result.totalCount === 0) return null

      return {
        source:     'vision_db',
        content:    formatStructuralElementAnswer(result),
        confidence: result.confidence,
        rawData:    result,
      }
    }

    // struct_area_scope
    const result = await queryStructuralByArea(projectId, structGrid, structLevel)

    if (!result.success || result.totalCount === 0) return null

    return {
      source:     'vision_db',
      content:    formatStructuralAreaAnswer(result),
      confidence: result.confidence,
      rawData:    result,
    }
  } catch (err) {
    console.error('[RetrievalOrchestrator] Structural graph lookup error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// MEP graph lookup (Phase 5A)
// ---------------------------------------------------------------------------

/**
 * Query the entity graph for MEP entities. Returns a single EvidenceItem
 * wrapping the formatted MEP content, or null when no MEP entities exist.
 */
async function attemptMEPGraphLookup(
  analysis: QueryAnalysis,
  projectId: string
): Promise<EvidenceItem | null> {
  const mepTag        = analysis._routing?.mepTag        ?? undefined
  const mepDiscipline = analysis._routing?.mepDiscipline ?? undefined
  const coordRoom     = analysis._routing?.coordRoom     ?? undefined
  const coordLevel    = analysis._routing?.coordLevel    ?? undefined

  try {
    if (analysis.answerMode === 'mep_element_lookup') {
      if (!mepTag) return null

      const result = await queryMEPElement(
        projectId,
        mepTag,
        mepDiscipline as 'electrical' | 'mechanical' | 'plumbing' | undefined
      )

      if (!result.success || result.totalCount === 0) return null

      return {
        source:     'vision_db',
        content:    formatMEPElementAnswer(result),
        confidence: result.confidence,
        rawData:    result,
      }
    }

    // mep_area_scope — query by room/level, optionally discipline-filtered
    const result = await queryMEPByArea(
      projectId,
      coordRoom   ?? null,
      coordLevel  ?? null,
      mepDiscipline as 'electrical' | 'mechanical' | 'plumbing' | undefined
    )

    if (!result.success || result.totalCount === 0) return null

    return {
      source:     'vision_db',
      content:    formatMEPAreaAnswer(result),
      confidence: result.confidence,
      rawData:    result,
    }
  } catch (err) {
    console.error('[RetrievalOrchestrator] MEP graph lookup error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Coordination graph lookup (Phase 5B)
// ---------------------------------------------------------------------------

/**
 * Query the entity graph for cross-discipline coordination data.
 * Returns a single EvidenceItem with the formatted coordination content,
 * or null when no entities exist at the specified location.
 */
async function attemptCoordinationGraphLookup(
  analysis: QueryAnalysis,
  projectId: string
): Promise<EvidenceItem | null> {
  const coordRoom  = analysis._routing?.coordRoom  ?? undefined
  const coordLevel = analysis._routing?.coordLevel ?? undefined

  try {
    if (analysis.answerMode === 'trade_coordination') {
      if (!coordRoom) return null

      const result = await queryTradesInRoom(projectId, coordRoom)

      if (!result.success || result.tradesPresent.length === 0) return null

      return {
        source:     'vision_db',
        content:    result.formattedAnswer,
        confidence: result.confidence,
        rawData:    result,
      }
    }

    if (analysis.answerMode === 'coordination_sequence') {
      const result = await queryCoordinationConstraints(projectId, coordRoom, coordLevel)

      if (!result.success || result.tradesPresent.length === 0) return null

      return {
        source:     'vision_db',
        content:    result.formattedAnswer,
        confidence: result.confidence,
        rawData:    result,
      }
    }

    // affected_area
    const result = await queryAffectedArea(projectId, coordRoom, coordLevel)

    if (!result.success || result.tradesPresent.length === 0) return null

    return {
      source:     'vision_db',
      content:    result.formattedAnswer,
      confidence: result.confidence,
      rawData:    result,
    }
  } catch (err) {
    console.error('[RetrievalOrchestrator] Coordination graph lookup error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Demo graph lookup (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Query the entity graph for demo entities. Returns a single EvidenceItem
 * wrapping the formatted demo content, or null when no demo entities exist.
 */
async function attemptDemoGraphLookup(
  analysis: QueryAnalysis,
  projectId: string
): Promise<EvidenceItem | null> {
  const demoRoom       = analysis._routing?.demoRoom       ?? undefined
  const demoStatusHint = analysis._routing?.demoStatusHint ?? undefined

  try {
    if (analysis.answerMode === 'demo_constraint') {
      const result = await queryDemoConstraints(projectId)

      if (
        result.riskNotes.length === 0 &&
        result.requirements.length === 0 &&
        result.verifyItems.length === 0
      ) {
        return null
      }

      return {
        source:     'vision_db',
        content:    formatDemoConstraintsAsContext(result),
        confidence: 0.85,
        rawData:    result,
      }
    }

    // demo_scope
    const result = await queryDemoScope(
      projectId,
      demoRoom   ?? null,
      demoStatusHint ?? null
    )

    if (!result.success || result.totalCount === 0) return null

    return {
      source:     'vision_db',
      content:    result.formattedAnswer,
      confidence: result.confidence,
      rawData:    result,
    }
  } catch (err) {
    console.error('[RetrievalOrchestrator] Demo graph lookup error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Vision DB lookup
// ---------------------------------------------------------------------------

async function attemptVisionDBLookup(
  analysis: QueryAnalysis,
  projectId: string
): Promise<EvidenceItem[]> {
  const { visionQuerySubtype } = analysis.retrievalHints

  if (!visionQuerySubtype) return []

  try {
    if (visionQuerySubtype === 'component') {
      const componentType = analysis.entities.componentType
        ?? detectComponentType(analysis.rawQuery)
        ?? undefined
      if (!componentType) return []

      const sizeFilter = analysis.entities.sizeFilter
        ?? extractSizeFromQuery(analysis.rawQuery)
        ?? undefined

      const result = await queryComponentCount(
        projectId,
        componentType,
        analysis.entities.utilitySystem,
        sizeFilter
      )

      if (!result.success) return []

      return [{
        source: 'vision_db',
        content: result.formattedAnswer,
        confidence: result.confidence,
        rawData: result,
      }]
    }

    if (visionQuerySubtype === 'crossing') {
      const result = await queryCrossings(projectId, analysis.entities.utilitySystem)

      if (!result.success) return []

      return [{
        source: 'vision_db',
        content: result.formattedAnswer,
        confidence: result.confidence,
        rawData: result,
      }]
    }

    if (visionQuerySubtype === 'length') {
      const utilityName = analysis.entities.itemName ?? analysis.entities.utilitySystem
      if (!utilityName) return []

      const result = await queryUtilityLength(projectId, utilityName)

      if (!result.success) return []

      return [{
        source: 'vision_db',
        content: result.formattedAnswer,
        confidence: result.confidence,
        rawData: result,
      }]
    }
  } catch (err) {
    console.error('[RetrievalOrchestrator] Vision DB lookup error:', err)
  }

  return []
}

// ---------------------------------------------------------------------------
// Live PDF analysis
// ---------------------------------------------------------------------------

function shouldAttemptLivePDF(answerMode: string): boolean {
  const supported = [
    'quantity_lookup',
    'crossing_lookup',
    'project_summary',
    'scope_summary',
    'sheet_lookup',
    'document_lookup',
    'demo_scope',
    'demo_constraint',
    'arch_element_lookup',
    'arch_room_scope',
    'arch_schedule_query',
    // Phase 5A
    'struct_element_lookup',
    'struct_area_scope',
    'mep_element_lookup',
    'mep_area_scope',
    // Phase 5B
    'trade_coordination',
    'coordination_sequence',
    'affected_area',
  ]
  return supported.includes(answerMode)
}

async function attemptLivePDFAnalysis(
  analysis: QueryAnalysis,
  projectId: string,
  supabase: SupabaseClient,
  projectCtx?: PEAgentConfig['projectContext']
): Promise<{ items: EvidenceItem[]; meta: LiveAnalysisMeta } | null> {
  const { data: documents, error } = await supabase
    .from('documents')
    .select('id, filename, file_path, sheet_number, document_type')
    .eq('project_id', projectId)
    .order('filename')

  if (error || !documents || documents.length === 0) {
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocs = documents.filter((d: any) => d.filename.toLowerCase().endsWith('.pdf'))

  const docsToProcess = selectRelevantSheets(pdfDocs, analysis)

  const meta: LiveAnalysisMeta = {
    sheetsAttempted: docsToProcess.length,
    sheetsAnalyzed: 0,
    sheetsSkipped: 0,
    skipReasons: [],
    wasCapped: pdfDocs.length > MAX_SHEETS,
    capLimit: MAX_SHEETS,
  }

  type PDFBuffer = { buffer: Buffer; filename: string; sheetNumber: string }
  const pdfBuffers: PDFBuffer[] = []

  for (const doc of docsToProcess) {
    try {
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('documents')
        .download(doc.file_path)

      if (dlErr || !fileData) {
        meta.sheetsSkipped++
        meta.skipReasons.push(`${doc.filename}: download failed — ${dlErr?.message ?? 'unknown'}`)
        continue
      }

      const buffer = Buffer.from(await fileData.arrayBuffer())

      if (buffer.length > MAX_PDF_SIZE_BYTES) {
        meta.sheetsSkipped++
        meta.skipReasons.push(
          `${doc.filename}: ${(buffer.length / 1024 / 1024).toFixed(1)} MB > ${MAX_PDF_SIZE_MB} MB limit`
        )
        continue
      }

      pdfBuffers.push({
        buffer,
        filename: doc.filename,
        sheetNumber: doc.sheet_number || doc.filename.replace('.pdf', ''),
      })
      meta.sheetsAnalyzed++
    } catch (err) {
      meta.sheetsSkipped++
      meta.skipReasons.push(`${doc.filename}: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  if (pdfBuffers.length === 0) {
    return null
  }

  try {
    const docAnalyzer = createDocumentAnalyzer({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      projectContext: projectCtx,
      debug: false,
    })

    const analysisResults = await docAnalyzer.analyzeSheetSet(
      pdfBuffers.map(p => ({ buffer: p.buffer, sheetNumber: p.sheetNumber })),
      { concurrency: 2, combineResults: true }
    )

    const content = buildLivePDFContent(analysisResults, meta)
    const items: EvidenceItem[] = [{
      source: 'live_pdf_analysis',
      content,
      confidence: meta.wasCapped || meta.sheetsSkipped > 0 ? 0.6 : 0.85,
      rawData: analysisResults,
    }]

    return { items, meta }
  } catch (err) {
    console.error('[RetrievalOrchestrator] Live PDF analysis failed:', err)
    return null
  }
}

function selectRelevantSheets(
  pdfDocs: Array<{ filename: string; file_path: string; sheet_number: string | null }>,
  analysis: QueryAnalysis
): typeof pdfDocs {
  const q = analysis.rawQuery.toLowerCase()

  const patterns: Array<{ test: RegExp; filePattern: RegExp }> = [
    { test: /arch|floor plan|room|door schedule|window schedule|finish schedule/i,
                                         filePattern: /^a[-_]?\d|arch|floor|elev|a\d{3}/i },
    { test: /demo|demolition/i,         filePattern: /demo|d-\d+|dm-\d+|drcp/i },
    // Phase 5A
    { test: /structural|foundation|framing|footing|column|beam|load.?bearing/i,
                                         filePattern: /^s[-_]?\d|struct/i },
    { test: /mechanical|hvac|ahu|vav|duct|air.handler/i,
                                         filePattern: /^m[-_]?\d|mech/i },
    { test: /electrical|panel|circuit|conduit/i,
                                         filePattern: /^e[-_]?\d|elec|power/i },
    { test: /plumbing|drain|fixture|sanitary|cleanout/i,
                                         filePattern: /^p[-_]?\d|plumb/i },
    // Existing
    { test: /electrical|elec|power/i,   filePattern: /elect|elec|power|e-\d+/i },
    { test: /gas\b|gas line/i,           filePattern: /gas|g-\d+/i },
    { test: /storm|stm\b/i,             filePattern: /storm|stm|sd-\d+/i },
    { test: /sewer|sanitary|ss\b/i,     filePattern: /sewer|sanitary|ss-\d+/i },
    { test: /telecom|fiber|fo\b|catv/i, filePattern: /telecom|tel|fiber|fo|comm|c-\d+/i },
  ]

  for (const { test, filePattern } of patterns) {
    if (test.test(q)) {
      const filtered = pdfDocs.filter(d => filePattern.test(d.filename))
      if (filtered.length > 0) return filtered.slice(0, MAX_SHEETS)
    }
  }

  return pdfDocs.slice(0, MAX_SHEETS)
}

function buildLivePDFContent(
  analysisResults: Awaited<ReturnType<ReturnType<typeof createDocumentAnalyzer>['analyzeSheetSet']>>,
  meta: LiveAnalysisMeta
): string {
  let summary = `Live PDF analysis of ${meta.sheetsAnalyzed} plan sheet(s).\n\n`

  if (meta.wasCapped) {
    summary += `⚠️ Analysis capped at ${meta.capLimit} sheets — not all project sheets reviewed.\n\n`
  }

  if (meta.sheetsSkipped > 0) {
    summary += `⚠️ ${meta.sheetsSkipped} sheet(s) skipped:\n`
    meta.skipReasons.forEach(r => (summary += `  - ${r}\n`))
    summary += '\n'
  }

  const combined = analysisResults.combined
  if (!combined) return summary

  const { totalComponents, totalCrossings, quantitySummary } = combined

  const byUtility = new Map<string, typeof totalComponents>()
  for (const c of totalComponents) {
    let ut = 'water'
    if (/elec|power/i.test(c.name))        ut = 'electrical'
    else if (/gas/i.test(c.name))           ut = 'gas'
    else if (/storm|stm|sd/i.test(c.name)) ut = 'storm'
    else if (/sewer|sanitary|ss/i.test(c.name)) ut = 'sewer'
    else if (/tel|fiber|fo|catv/i.test(c.name)) ut = 'telecom'
    const arr = byUtility.get(ut) ?? []
    arr.push(c)
    byUtility.set(ut, arr)
  }

  if (byUtility.size > 0) {
    summary += '## Components Found\n\n'
    for (const [utilityType, components] of byUtility) {
      summary += `### ${utilityType.toUpperCase()}\n`
      const counts = new Map<string, number>()
      for (const c of components) {
        const key = `${c.size ?? ''} ${c.name}`.trim()
        counts.set(key, (counts.get(key) ?? 0) + c.quantity)
      }
      for (const [comp, count] of counts) {
        summary += `- ${comp}: ${count} EA\n`
      }
      summary += '\n'
    }
  }

  if (totalCrossings.length > 0) {
    summary += '## Utility Crossings\n\n'
    const byCrossing = new Map<string, number>()
    for (const c of totalCrossings) {
      const t = c.utilityType.toLowerCase()
      byCrossing.set(t, (byCrossing.get(t) ?? 0) + 1)
    }
    for (const [type, count] of byCrossing) {
      summary += `- ${type.toUpperCase()}: ${count} crossing(s)\n`
    }
    summary += '\n'
  }

  if (quantitySummary.length > 0) {
    summary += '## Quantities\n\n'
    for (const q of quantitySummary) {
      const qty = q.quantity ? `${q.quantity.toLocaleString()} ${q.unit}` : 'TBD'
      summary += `- ${q.item}: ${qty}\n`
    }
  }

  return summary
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSources(items: EvidenceItem[]): string[] {
  const sources = new Set<string>()
  for (const item of items) {
    if (item.citation?.sheetNumber) sources.add(`Sheet ${item.citation.sheetNumber}`)
    if (item.citation?.filename)    sources.add(item.citation.filename)
    sources.add(item.source)
  }
  return Array.from(sources)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any
