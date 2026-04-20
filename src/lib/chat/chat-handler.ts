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
import type { EvidenceItem } from './types'
import { loadProjectMemory } from './project-memory'
import { buildTools, type ProjectMemoryContext } from './tools/index'
import { randomUUID } from 'crypto'

const anthropicAI = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

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
  const { messages, projectId, supabase, projectContext, debugAi } = opts

  const latestMessage = messages[messages.length - 1]
  if (!latestMessage || latestMessage.role !== 'user') {
    return new Response('Last message must be from user', { status: 400 })
  }

  const rawQuery = typeof latestMessage.content === 'string'
    ? latestMessage.content
    : String(latestMessage.content)

  const queryId = randomUUID()
  console.log('[ChatHandler] Query:', rawQuery.slice(0, 120), '| queryId:', queryId)

  // Load project memory for context (aliases, callout patterns)
  const memoryCtx = await loadProjectMemory(projectId)

  // Build tools with projectId + supabase in closure
  const tools = buildTools(projectId, supabase, memoryCtx)

  // Build system prompt
  const systemPrompt = buildAgentSystemPrompt(projectContext, memoryCtx)

  // Agentic stream — Claude calls tools until satisfied, then writes answer
  const result = streamText({
    model: anthropicAI('claude-sonnet-4-5-20250929'),
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    tools,
    stopWhen: stepCountIs(12),
  })

  const response = result.toTextStreamResponse()
  const headers = new Headers(response.headers)
  headers.set('X-Query-Id', queryId)
  return new Response(response.body, { status: response.status, headers })
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildAgentSystemPrompt(
  projectContext: PEAgentConfig['projectContext'] | undefined,
  memoryCtx: ProjectMemoryContext
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
    '5. If initial results are incomplete, search again with different keywords.',
    '6. Cite your sources: sheet numbers, spec sections, RFI numbers.',
    '7. If information genuinely does not exist in the project documents, say so clearly.',
    '8. Be direct and specific. Construction decisions depend on accurate answers.',
    '',
  )

  if (memoryCtx.aliases.length > 0) {
    lines.push('Known aliases in this project:')
    for (const a of memoryCtx.aliases) {
      lines.push(`  ${a.original_text ?? a.normalized_value} → ${a.normalized_value}`)
    }
    lines.push('')
  }

  return lines.join('\n')
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
