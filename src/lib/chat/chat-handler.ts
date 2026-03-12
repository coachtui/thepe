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
import type { PEAgentConfig } from '@/agents/constructionPEAgent'
import type { AiTrace } from './types'

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

  console.log('[ChatHandler] Query:', rawQuery.slice(0, 120))

  // 1. Analyze the query
  const analysis = analyzeQuery(rawQuery)
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

  // 3. Evaluate sufficiency
  const sufficiency = evaluateSufficiency(packet, analysis)
  console.log('[ChatHandler] Sufficiency:', {
    level: sufficiency.level,
    score: sufficiency.score,
    unsupported: sufficiency.isUnsupportedDomain,
  })

  // 3.5. Apply reasoning layer — transforms evidence into structured findings
  const reasoning = applyReasoning(analysis, packet, sufficiency)
  console.log('[ChatHandler] Reasoning:', {
    mode: reasoning.mode,
    activated: reasoning.wasActivated,
    findings: reasoning.findings.length,
    gaps: reasoning.gaps.length,
    frame: reasoning.recommendedAnswerFrame,
  })

  // 4. Write a streaming response with full conversation history
  const streamResponse = writeResponse(analysis, packet, sufficiency, reasoning, messages)

  // --- Debug trace ---
  if (traceEnabled) {
    const legacyUsed = packet.retrievalMethod === 'complete_data' ||
      packet.retrievalMethod === 'vector_search' ||
      packet.retrievalMethod === 'direct_quantity_lookup'

    const evidenceBySource: Record<string, number> = {}
    for (const item of packet.items) {
      evidenceBySource[item.source] = (evidenceBySource[item.source] ?? 0) + 1
    }

    const supportMix = { explicit: 0, inferred: 0, unknown: 0 }
    for (const f of reasoning.findings) {
      supportMix[f.supportLevel]++
    }

    const warnings: string[] = []
    if (sufficiency.isUnsupportedDomain) warnings.push('unsupported_domain')
    if (sufficiency.level === 'partial') warnings.push('partial_evidence')
    if (packet.liveAnalysisMeta?.wasCapped) warnings.push('live_pdf_sheet_cap_hit')
    if ((packet.liveAnalysisMeta?.sheetsSkipped ?? 0) > 0) warnings.push(`skipped_sheets: ${packet.liveAnalysisMeta!.sheetsSkipped}`)
    if (sufficiency.gaps.length > 0) warnings.push(...sufficiency.gaps.map(g => `gap: ${g}`))
    if (analysis.requestedSystems.length > 1) warnings.push('multiple_systems_in_query')

    // Detect Water Line A / utility bias risks
    if (legacyUsed && analysis.entities.utilitySystem === 'WATER LINE' && !analysis.entities.itemName) {
      warnings.push('legacy_auto_detect_system_used: utility bias risk — verify autoDetectSystem() resolved correct water line')
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
      retrievalMethod: packet.retrievalMethod,
      evidenceItemCount: packet.items.length,
      evidenceBySource,
      legacySmartRouterUsed: legacyUsed,
      livePDFUsed: !!packet.liveAnalysisMeta,
      livePDFMeta: packet.liveAnalysisMeta ? {
        attempted: packet.liveAnalysisMeta.sheetsAttempted,
        analyzed: packet.liveAnalysisMeta.sheetsAnalyzed,
        skipped: packet.liveAnalysisMeta.sheetsSkipped,
        wasCapped: packet.liveAnalysisMeta.wasCapped,
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

    // Attach trace as response header so client can inspect it
    const headers = new Headers(streamResponse.headers)
    headers.set('X-AI-Trace', JSON.stringify(trace))
    return new Response(streamResponse.body, {
      status: streamResponse.status,
      headers,
    })
  }

  return streamResponse
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
    .select('name, location, project_value, start_date, end_date')
    .eq('id', projectId)
    .single()

  if (!project) return undefined

  // Build only the partial context fields we have data for.
  // PEAgentConfig['projectContext'] is Partial<ProjectContext>, so nested
  // objects must match the full interface shape. We cast to avoid listing
  // every required field for contract/schedule which we don't have.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = {
    projectName: project.name,
  }

  if (project.location) {
    ctx.location = {
      city: project.location.city,
      state: project.location.state,
      county: project.location.county,
    }
  }

  if (project.project_value) {
    ctx.projectValue = project.project_value
  }

  if (project.start_date && project.end_date) {
    ctx.startDate = project.start_date
    ctx.endDate = project.end_date
  }

  return ctx as PEAgentConfig['projectContext']
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any
