/**
 * Chat Handler — shared pipeline for web and mobile chat endpoints.
 *
 * Both src/app/api/chat/route.ts and src/app/api/mobile/chat/route.ts
 * delegate here after handling their own auth differences.
 *
 * Pipeline:
 *   1. query-analyzer        → QueryAnalysis
 *   2. retrieval-orchestrator → EvidencePacket
 *   3. evidence-evaluator    → SufficiencyResult
 *   3.5 reasoning-engine     → ReasoningPacket
 *   4. response-writer       → streaming Response
 *
 * All paths are streaming. There is no separate "vision mode" that returns
 * a plain text Response. The model always has full conversation history.
 */

import { analyzeQuery } from './query-analyzer'
import { retrieveEvidence } from './retrieval-orchestrator'
import { evaluateSufficiency } from './evidence-evaluator'
import { applyReasoning } from './reasoning-engine'
import { writeResponse, selectTemperature, type ChatMessage } from './response-writer'
import { verifyBeforeAnswering, verificationToEvidenceItems } from './sheet-verifier'
import { runPlanReader, planReaderToEvidenceItems } from './plan-reader'
import type { PEAgentConfig } from '@/agents/constructionPEAgent'
import type { AiTrace, EvidenceItem, DataSourceCounts } from './types'
import { loadProjectMemory, resolveAliases } from './project-memory'
import { applyAliasExpansions } from './query-analyzer'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// In-memory trace store (dev / debug only)
// Keyed by queryId. TTL: 30 minutes. Not persistent across serverless instances.
// ---------------------------------------------------------------------------

interface StoredTrace {
  queryId: string
  projectId: string
  items: EvidenceItem[]
  expiresAt: number
}

const traceStore = new Map<string, StoredTrace>()
const TRACE_TTL_MS = 30 * 60 * 1000 // 30 minutes

function storeTrace(queryId: string, projectId: string, items: EvidenceItem[]): void {
  // Evict expired entries
  const now = Date.now()
  for (const [k, v] of traceStore.entries()) {
    if (v.expiresAt < now) traceStore.delete(k)
  }
  traceStore.set(queryId, { queryId, projectId, items, expiresAt: now + TRACE_TTL_MS })
}

export function getStoredTrace(queryId: string): StoredTrace | undefined {
  const entry = traceStore.get(queryId)
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    traceStore.delete(queryId)
    return undefined
  }
  return entry
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatHandlerOptions {
  messages: ChatMessage[]
  projectId: string
  supabase: SupabaseClient
  projectContext?: PEAgentConfig['projectContext']
  /** Return trace as X-AI-Trace response header and log to console */
  debugAi?: boolean
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full chat pipeline and return a streaming Response.
 * Called by both route.ts files after they have authenticated the user.
 */
export async function handleChatRequest(
  opts: ChatHandlerOptions
): Promise<Response> {
  const { messages, projectId, supabase, projectContext, debugAi } = opts
  const traceEnabled = debugAi || process.env.AI_DEBUG_TRACE === 'true'

  const latestMessage = messages[messages.length - 1]
  if (!latestMessage || latestMessage.role !== 'user') {
    return new Response('Last message must be from user', { status: 400 })
  }

  const rawQuery = typeof latestMessage.content === 'string'
    ? latestMessage.content
    : String(latestMessage.content)

  const queryId = randomUUID()
  console.log('[ChatHandler] Query:', rawQuery.slice(0, 120), '| queryId:', queryId)

  // Step 0: Load project memory (aliases, callout patterns, sheet hints, source quality)
  const memoryCtx = await loadProjectMemory(projectId)
  console.log('[ChatHandler] ProjectMemory:', {
    aliases: memoryCtx.aliases.length,
    calloutPatterns: memoryCtx.calloutPatterns.length,
    sheetHints: memoryCtx.sheetHints.length,
    sourceQuality: memoryCtx.sourceQuality.length,
  })

  // 1. Analyze the query
  let analysis = analyzeQuery(rawQuery)

  // Step 0.5: Resolve aliases on extracted entities and apply expansions
  if (memoryCtx.aliases.length > 0) {
    const entityCandidates = [
      analysis.entities.itemName,
      analysis.entities.utilitySystem,
      analysis.entities.componentType,
      ...analysis.requestedSystems,
    ].filter((e): e is string => !!e)

    const expansions = resolveAliases(
      entityCandidates,
      memoryCtx,
      analysis._routing?.mepDiscipline ?? null
    )

    if (Object.keys(expansions).length > 0) {
      analysis = applyAliasExpansions(analysis, expansions)
      console.log('[ChatHandler] AliasExpansions applied:', expansions)
    }
  }

  console.log('[ChatHandler] Analysis:', {
    answerMode: analysis.answerMode,
    supportLevel: analysis.supportLevelExpected,
    visionSubtype: analysis.retrievalHints.visionQuerySubtype,
    sources: analysis.retrievalHints.preferredSources,
  })

  // 2. Retrieve evidence
  const packet = await retrieveEvidence(analysis, projectId, supabase, projectContext)
  console.log('[ChatHandler] Evidence:', {
    items: packet.items.length,
    method: packet.retrievalMethod,
    liveAnalysis: !!packet.liveAnalysisMeta,
  })

  // 2.5. Sheet verification — for Type B/C/D queries, confirm all relevant
  //      sheets have been consulted and every finding is cited.
  const verification = await verifyBeforeAnswering(analysis, projectId, supabase)
  console.log('[ChatHandler] Verification:', {
    class: verification.verificationClass,
    verified: verification.wasVerified,
    findings: verification.verifiedFindings.length,
    sheets: verification.sheetsInspected.length,
  })

  // Merge verified findings into the evidence packet (prepended = highest priority)
  const verifiedItems = verificationToEvidenceItems(verification)
  let augmentedPacket = verification.wasVerified
    ? {
        ...packet,
        items: [...verifiedItems, ...packet.items],
        formattedContext: verification.confirmedContext
          ? `${verification.confirmedContext}\n\n---\n\n## ADDITIONAL RETRIEVED CONTEXT\n\n${packet.formattedContext}`
          : packet.formattedContext,
        verificationMeta: verification,
      }
    : packet

  // 2.7. Plan Reader — for Type B/C/D queries, inspect actual sheet images.
  //      This stage runs AFTER structural-table verification so that the candidate
  //      sheets gathered there drive which pages to load.
  //      Findings take precedence over all other evidence sources.
  if (verification.verificationClass !== 'skip') {
    const planReader = await runPlanReader(analysis, verification, projectId, supabase, memoryCtx.calloutPatterns)
    console.log('[ChatHandler] PlanReader:', {
      wasRun: planReader.wasRun,
      pages: planReader.pagesInspected.length,
      findings: planReader.findings.length,
      coverage: planReader.coverageAssessment,
      matchLines: planReader.matchLinesFollowed.length,
      costUsd: planReader.totalCostUsd.toFixed(4),
      skipReason: planReader.skipReason,
    })

    if (planReader.wasRun) {
      const planReaderItems = planReaderToEvidenceItems(planReader)

      // Plan reader findings are highest-priority — prepend before verified items
      augmentedPacket = {
        ...augmentedPacket,
        items: [...planReaderItems, ...augmentedPacket.items],
        formattedContext: planReader.findings.length > 0
          ? `${planReader.formattedContext}\n\n---\n\n${augmentedPacket.formattedContext}`
          : augmentedPacket.formattedContext,
        planReaderMeta: planReader,
      }

      // If the structured-table verification found nothing but the plan reader
      // did, upgrade the verification coverageStatus from 'insufficient' to
      // 'partial' so the hard gate in evidence-evaluator allows an answer.
      if (
        augmentedPacket.verificationMeta?.coverageStatus === 'insufficient' &&
        planReader.findings.length > 0 &&
        augmentedPacket.verificationMeta
      ) {
        augmentedPacket = {
          ...augmentedPacket,
          verificationMeta: {
            ...augmentedPacket.verificationMeta,
            coverageStatus: 'partial',
            missingEvidence: [
              ...augmentedPacket.verificationMeta.missingEvidence,
              'Structured tables had no data — answer sourced from direct plan inspection only.',
            ],
          },
        }
      }
    }
  }

  // Stamp query_id and source_confidence_at_retrieval on all evidence items
  const stampedItems = augmentedPacket.items.map(item => ({
    ...item,
    query_id: queryId,
    source_confidence_at_retrieval: item.source_confidence_at_retrieval ?? item.confidence,
  }))
  augmentedPacket = { ...augmentedPacket, items: stampedItems }

  // Store evidence in trace store for debug endpoint
  storeTrace(queryId, projectId, stampedItems)

  // 3. Evaluate sufficiency
  const sufficiency = evaluateSufficiency(augmentedPacket, analysis)
  console.log('[ChatHandler] Sufficiency:', {
    level: sufficiency.level,
    score: sufficiency.score,
    unsupported: sufficiency.isUnsupportedDomain,
  })

  // 3.5. Apply reasoning layer — transforms evidence into structured findings
  const reasoning = applyReasoning(analysis, augmentedPacket, sufficiency)
  console.log('[ChatHandler] Reasoning:', {
    mode: reasoning.mode,
    activated: reasoning.wasActivated,
    findings: reasoning.findings.length,
    gaps: reasoning.gaps.length,
    frame: reasoning.recommendedAnswerFrame,
  })

  // 4. Write a streaming response with full conversation history
  const streamResponse = writeResponse(analysis, augmentedPacket, sufficiency, reasoning, messages)

  // Compute data_source_counts and attach as X-Data-Source-Counts header on every response
  const dataSourceCounts: DataSourceCounts = { vision_db: 0, vector: 0, plan_reader: 0, graph: 0 }
  for (const item of augmentedPacket.items) {
    if (item.source === 'vision_db' || item.source === 'direct_lookup' || item.source === 'project_summary') {
      dataSourceCounts.vision_db++
    } else if (item.source === 'vector_search') {
      dataSourceCounts.vector++
    } else if (item.source === 'live_pdf_analysis') {
      dataSourceCounts.plan_reader++
    }
  }
  // plan_reader items are marked live_pdf_analysis but prepended from plan reader — count separately
  if (augmentedPacket.planReaderMeta?.wasRun) {
    const planReaderCount = augmentedPacket.planReaderMeta.findings.length
    dataSourceCounts.plan_reader = planReaderCount
    dataSourceCounts.vision_db = Math.max(0, dataSourceCounts.vision_db - planReaderCount)
  }

  // --- Debug trace ---
  if (traceEnabled) {
    const legacyUsed = augmentedPacket.retrievalMethod === 'complete_data' ||
      augmentedPacket.retrievalMethod === 'vector_search' ||
      augmentedPacket.retrievalMethod === 'direct_quantity_lookup'

    const evidenceBySource: Record<string, number> = {}
    for (const item of augmentedPacket.items) {
      evidenceBySource[item.source] = (evidenceBySource[item.source] ?? 0) + 1
    }

    const supportMix = { explicit: 0, inferred: 0, unknown: 0 }
    for (const f of reasoning.findings) {
      supportMix[f.supportLevel]++
    }

    const warnings: string[] = []
    if (sufficiency.isUnsupportedDomain) warnings.push('unsupported_domain')
    if (sufficiency.level === 'partial') warnings.push('partial_evidence')
    if (augmentedPacket.liveAnalysisMeta?.wasCapped) warnings.push('live_pdf_sheet_cap_hit')
    if ((augmentedPacket.liveAnalysisMeta?.sheetsSkipped ?? 0) > 0) warnings.push(`skipped_sheets: ${augmentedPacket.liveAnalysisMeta!.sheetsSkipped}`)
    if (sufficiency.gaps.length > 0) warnings.push(...sufficiency.gaps.map(g => `gap: ${g}`))
    if (analysis.requestedSystems.length > 1) warnings.push('multiple_systems_in_query')

    // Verification status
    if (verification.wasVerified) {
      warnings.push(
        `sheet_verification: type=${verification.questionType} class=${verification.verificationClass} ` +
        `coverage=${verification.coverageStatus} findings=${verification.verifiedFindings.length} ` +
        `inspected=${verification.sheetsInspected.length} candidates=${verification.candidateSheets.length}`
      )
    }
    if (verification.missingEvidence.length > 0) {
      warnings.push(...verification.missingEvidence.map(g => `verification_gap: ${g}`))
    }

    // Plan Reader status
    const planReader = augmentedPacket.planReaderMeta
    if (planReader?.wasRun) {
      warnings.push(
        `plan_reader: pages=${planReader.pagesInspected.map(p => p.sheetNumber).join(',')} ` +
        `findings=${planReader.findings.length} coverage=${planReader.coverageAssessment} ` +
        `matchLines=${planReader.matchLinesFollowed.join(',') || 'none'} ` +
        `cost=$${planReader.totalCostUsd.toFixed(4)}`
      )
    } else if (planReader) {
      warnings.push(`plan_reader_skipped: ${planReader.skipReason}`)
    }

    // Detect Water Line A / utility bias risks
    if (legacyUsed && analysis.entities.utilitySystem === 'WATER LINE' && !analysis.entities.itemName) {
      warnings.push('legacy_auto_detect_system_used: utility bias risk — verify autoDetectSystem() resolved correct water line')
    }

    // Surface routing warnings from smart-router fallback decisions
    if (augmentedPacket.routingWarnings?.length) {
      warnings.push(...augmentedPacket.routingWarnings.map(w => `smart_router: ${w}`))
    }

    const temp = selectTemperature(analysis.answerMode, sufficiency.level)

    const trace: AiTrace = {
      timestamp: new Date().toISOString(),
      query: rawQuery,
      answerMode: analysis.answerMode,
      correctionsApplied: analysis._routing ? [] : ['(routing cache missing — corrections unknown)'],
      visionQuerySubtype: analysis.retrievalHints.visionQuerySubtype ?? 'none',
      preferredSources: analysis.retrievalHints.preferredSources,
      requestedSystems: analysis.requestedSystems,
      extractedEntities: {
        itemName: analysis.entities.itemName,
        componentType: analysis.entities.componentType,
        utilitySystem: analysis.entities.utilitySystem,
        station: analysis.entities.station,
        sheetNumber: analysis.entities.sheetNumber,
        sizeFilter: analysis.entities.sizeFilter,
        material: analysis.entities.material,
      },
      retrievalMethod: augmentedPacket.retrievalMethod,
      evidenceItemCount: augmentedPacket.items.length,
      evidenceBySource,
      legacySmartRouterUsed: legacyUsed,
      livePDFUsed: !!augmentedPacket.liveAnalysisMeta,
      livePDFMeta: augmentedPacket.liveAnalysisMeta ? {
        attempted: augmentedPacket.liveAnalysisMeta.sheetsAttempted,
        analyzed: augmentedPacket.liveAnalysisMeta.sheetsAnalyzed,
        skipped: augmentedPacket.liveAnalysisMeta.sheetsSkipped,
        wasCapped: augmentedPacket.liveAnalysisMeta.wasCapped,
      } : undefined,
      sufficiencyLevel: sufficiency.level,
      sufficiencyScore: Math.round(sufficiency.score * 100) / 100,
      sufficiencyReasons: sufficiency.reasons,
      isUnsupportedDomain: sufficiency.isUnsupportedDomain,
      reasoningMode: reasoning.mode,
      reasoningActivated: reasoning.wasActivated,
      findingCount: reasoning.findings.length,
      gapCount: reasoning.gaps.length,
      evidenceStrength: reasoning.evidenceStrength,
      recommendedAnswerFrame: reasoning.recommendedAnswerFrame,
      supportMix,
      model: 'claude-sonnet-4-5-20250929',
      temperature: temp,
      warnings,
    }

    emitTrace(trace)

    // Attach trace + data source counts as response headers so client can inspect them
    const headers = new Headers(streamResponse.headers)
    headers.set('X-AI-Trace', JSON.stringify(trace))
    headers.set('X-Query-Id', queryId)
    headers.set('X-Data-Source-Counts', JSON.stringify(dataSourceCounts))
    return new Response(streamResponse.body, {
      status: streamResponse.status,
      headers,
    })
  }

  const baseHeaders = new Headers(streamResponse.headers)
  baseHeaders.set('X-Query-Id', queryId)
  baseHeaders.set('X-Data-Source-Counts', JSON.stringify(dataSourceCounts))
  return new Response(streamResponse.body, {
    status: streamResponse.status,
    headers: baseHeaders,
  })
}

/** Emit a human-readable trace block to the server console. */
function emitTrace(t: AiTrace): void {
  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════════╗',
    '║                        AI TRACE                             ║',
    '╚══════════════════════════════════════════════════════════════╝',
    `  query              : ${t.query.slice(0, 120)}`,
    `  timestamp          : ${t.timestamp}`,
    '',
    '  ── Query Analysis ──',
    `  answer mode        : ${t.answerMode}`,
    `  vision subtype     : ${t.visionQuerySubtype}`,
    `  preferred sources  : ${t.preferredSources.join(', ')}`,
    `  requested systems  : ${t.requestedSystems.join(', ') || '(none)'}`,
    `  entities           : ${JSON.stringify(Object.fromEntries(Object.entries(t.extractedEntities).filter(([,v]) => v)))}`,
    `  corrections        : ${t.correctionsApplied.join(', ') || 'none'}`,
    '',
    '  ── Retrieval ──',
    `  method             : ${t.retrievalMethod}`,
    `  evidence items     : ${t.evidenceItemCount}`,
    `  by source          : ${JSON.stringify(t.evidenceBySource)}`,
    `  legacy smart-router: ${t.legacySmartRouterUsed ? 'YES ⚠' : 'no'}`,
    `  live PDF used      : ${t.livePDFUsed ? 'YES' : 'no'}`,
    ...(t.livePDFMeta ? [
      `  live PDF meta      : attempted=${t.livePDFMeta.attempted} analyzed=${t.livePDFMeta.analyzed} skipped=${t.livePDFMeta.skipped} capped=${t.livePDFMeta.wasCapped}`,
    ] : []),
    '',
    '  ── Sufficiency ──',
    `  level              : ${t.sufficiencyLevel}`,
    `  score              : ${t.sufficiencyScore}`,
    `  unsupported domain : ${t.isUnsupportedDomain}`,
    `  reasons            : ${t.sufficiencyReasons.join(' | ')}`,
    '',
    '  ── Reasoning ──',
    `  mode               : ${t.reasoningMode}`,
    `  activated          : ${t.reasoningActivated}`,
    `  findings           : ${t.findingCount} (explicit=${t.supportMix.explicit} inferred=${t.supportMix.inferred} unknown=${t.supportMix.unknown})`,
    `  gaps               : ${t.gapCount}`,
    `  evidence strength  : ${t.evidenceStrength}`,
    `  answer frame       : ${t.recommendedAnswerFrame}`,
    '',
    '  ── Response ──',
    `  model              : ${t.model}`,
    `  temperature        : ${t.temperature}`,
    '',
    ...(t.warnings.length > 0 ? [
      '  ── Warnings ──',
      ...t.warnings.map(w => `  ⚠  ${w}`),
      '',
    ] : []),
    '══════════════════════════════════════════════════════════════════',
    '',
  ]
  console.log(lines.join('\n'))
}

/**
 * Load project context from the database.
 * Shared between web and mobile routes.
 */
export async function loadProjectContext(
  supabase: SupabaseClient,
  projectId: string
): Promise<PEAgentConfig['projectContext']> {
  const { data: project } = await supabase
    .from('projects')
    .select('name, address, start_date, end_date, metadata')
    .eq('id', projectId)
    .single()

  if (!project) return undefined

  // Build only the partial context fields we have data for.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = {
    projectName: project.name,
  }

  if (project.address) {
    ctx.address = project.address
  }

  if (project.start_date && project.end_date) {
    ctx.startDate = project.start_date
    ctx.endDate = project.end_date
  }

  return ctx as PEAgentConfig['projectContext']
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any
