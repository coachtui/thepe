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
import { writeResponse, type ChatMessage } from './response-writer'
import type { PEAgentConfig } from '@/agents/constructionPEAgent'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatHandlerOptions {
  messages: ChatMessage[]
  projectId: string
  supabase: SupabaseClient
  projectContext?: PEAgentConfig['projectContext']
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
  const { messages, projectId, supabase, projectContext } = opts

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
  return writeResponse(analysis, packet, sufficiency, reasoning, messages)
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
