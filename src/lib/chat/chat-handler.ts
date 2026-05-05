/**
 * Chat Handler — shared agentic loop for web and mobile chat endpoints.
 *
 * Both src/app/api/chat/route.ts and src/app/api/mobile/chat/route.ts
 * delegate here after handling their own auth differences.
 *
 * Architecture:
 *   Claude drives investigation using tools until satisfied, then writes answer.
 *   Tools are defined in ./tools/index.ts (Task 1).
 */

import { streamText, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { PEAgentConfig } from '@/agents/constructionPEAgent'
import { loadProjectMemory, sanitizeForPrompt } from './project-memory'
import { buildTools, type ProjectMemoryContext } from './tools/index'
import {
  classifyConstructionTask,
  getRetrievalStrategyForTask,
  type RetrievalStrategy,
  type TaskRouteResult,
} from './task-router'
import { randomUUID } from 'crypto'

const anthropicAI = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

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
  /** Initial task classification scaffold. Retrieval still falls back to existing behavior. */
  taskRoute?: TaskRouteResult
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the agentic chat loop and return a streaming Response.
 * Called by both route.ts files after they have authenticated the user.
 */
export async function handleChatRequest(
  opts: ChatHandlerOptions
): Promise<Response> {
  const { messages, projectId, supabase, projectContext, debugAi, taskRoute } = opts

  const latestMessage = messages[messages.length - 1]
  if (!latestMessage || latestMessage.role !== 'user') {
    return new Response('Last message must be from user', { status: 400 })
  }

  const rawQuery = typeof latestMessage.content === 'string'
    ? latestMessage.content
    : String(latestMessage.content)

  const queryId = randomUUID()
  console.log('[ChatHandler] Query:', rawQuery.slice(0, 120), '| queryId:', queryId)

  const resolvedTaskRoute = taskRoute ?? classifyConstructionTask(rawQuery)
  const retrievalStrategy = getRetrievalStrategyForTask(resolvedTaskRoute.route)
  const taskStrategyDebug = buildTaskStrategyDebug(resolvedTaskRoute, retrievalStrategy)

  if (process.env.NODE_ENV !== 'production') {
    console.log('[ChatHandler] Task strategy:', taskStrategyDebug)
  }

  // Load project memory for context (aliases, callout patterns)
  const memoryCtx = await loadProjectMemory(projectId)

  // Build tools with projectId + supabase in closure
  const tools = buildTools(projectId, supabase, memoryCtx, retrievalStrategy)

  // Build system prompt
  const systemPrompt = buildAgentSystemPrompt(projectContext, memoryCtx, retrievalStrategy)

  // Agentic stream — Claude calls tools until satisfied, then writes answer
  let result
  try {
    result = streamText({
      model: anthropicAI('claude-sonnet-4-5-20250929'),
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      tools,
      stopWhen: stepCountIs(12),
    })
  } catch (err) {
    console.error('[ChatHandler] streamText init error:', err)
    return new Response('AI stream initialization failed', { status: 500 })
  }

  const response = result.toTextStreamResponse()
  const headers = new Headers(response.headers)
  headers.set('X-Query-Id', queryId)
  headers.set('X-Task-Route', resolvedTaskRoute.route)
  if (
    process.env.NODE_ENV !== 'production' &&
    (debugAi || process.env.AI_DEBUG_TRACE === 'true')
  ) {
    headers.set('X-Task-Route-Debug', JSON.stringify(resolvedTaskRoute))
    headers.set('X-Task-Strategy-Debug', JSON.stringify(taskStrategyDebug))
  }
  return new Response(response.body, { status: response.status, headers })
}

function buildTaskStrategyDebug(
  taskRoute: TaskRouteResult,
  strategy: RetrievalStrategy
) {
  return {
    taskType: taskRoute.route,
    confidence: taskRoute.confidence,
    retrievalMode: strategy.retrievalMode,
    defaultTopK: strategy.defaultTopK,
    citationRequired: strategy.citationRequired,
    structuredOutputRequired: strategy.structuredOutputRequired,
  }
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildAgentSystemPrompt(
  projectContext: PEAgentConfig['projectContext'] | undefined,
  memoryCtx: ProjectMemoryContext,
  retrievalStrategy?: RetrievalStrategy
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = projectContext as any

  const lines = [
    'You are a construction PE (Professional Engineer) assistant with access to project drawings,',
    'specifications, RFIs, submittals, and other construction documents.',
    '',
  ]

  if (ctx?.projectName) {
    lines.push(`Project: ${ctx.projectName}`)
  }
  if (ctx?.address) {
    lines.push(`Location: ${ctx.address}`)
  }
  if (ctx?.projectName || ctx?.address) {
    lines.push('')
  }

  lines.push(
    'When answering questions:',
    '1. Use the available tools to investigate before answering. Never guess from memory.',
    '2. Start with searchEntities or searchComponents for general questions.',
    '3. Use getSpecSection when the question involves material standards or requirements.',
    '4. Use readDrawingPage to verify specific details from actual drawing sheets.',
    '5. Use checkSheetCoverage before readDrawingPage when you do not already know which sheets to read — it is faster and cheaper.',
    '6. If initial results are incomplete, search again with different keywords.',
    '7. Cite your sources: sheet numbers, spec sections, RFI numbers.',
    '8. If information genuinely does not exist in the project documents, say so clearly.',
    '9. Be direct and specific. Construction decisions depend on accurate answers.',
    '',
  )

  if (memoryCtx.aliases.length > 0) {
    lines.push('Known aliases in this project:')
    for (const a of memoryCtx.aliases) {
      lines.push(`  ${sanitizeForPrompt(a.original_text ?? a.normalized_value)} → ${sanitizeForPrompt(a.normalized_value)}`)
    }
    lines.push('')
  }

  if (retrievalStrategy?.taskType === 'spec_lookup') {
    appendSpecLookupPrompt(lines)
  }

  if (retrievalStrategy?.taskType === 'submittal_register') {
    appendSubmittalRegisterPrompt(lines)
  }

  return lines.join('\n')
}

function appendSpecLookupPrompt(lines: string[]): void {
  lines.push(
    'Spec lookup workflow:',
    '1. Treat specifications as the primary source of truth for this question.',
    '2. Start with getSpecSection when a CSI section is provided or implied; otherwise use spec-focused searches before relying on general project search.',
    '3. Cite the strongest available source metadata: spec section, part/paragraph reference, page, document, chunk, or filename.',
    '4. Format the answer with clear labels: Requirement, Interpretation, Recommended action.',
    '5. If the relevant spec section or requirement is not found, say that directly and explain what was searched.',
    '6. Do not present an uncited interpretation as a confirmed contract requirement.',
    '7. If only general document context is available, answer cautiously and mark the limitation.',
    '',
    'TODO: preferredDocumentTypes for spec_lookup are not enforced by the current retrieval layer yet; use available spec tools and preserve fallback behavior.',
    '',
  )
}

function appendSubmittalRegisterPrompt(lines: string[]): void {
  lines.push(
    'Submittal register workflow:',
    '1. Start with buildSubmittalRegister to extract structured submittal requirements from project specifications.',
    '2. If that tool returns no items, continue with getSpecSection and searchEntities before answering.',
    '3. Return register rows as JSON-compatible structured items with specSection, sectionTitle, submittalItem, submittalType, requiredAction, approvalRequired, sourceReference, excerpt, confidence, and notes.',
    '4. Cite sourceReference fields when available. Do not invent section, page, document, or approval metadata.',
    '5. If project specs are missing or do not contain submittal requirements, state that the register cannot be completed from available evidence.',
    '',
    'TODO: submittal_register preferredDocumentTypes are not enforced by the current generic retrieval layer yet; the dedicated register tool uses available spec entity findings and preserves fallback behavior.',
    '',
  )
}

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

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
