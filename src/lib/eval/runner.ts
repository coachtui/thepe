/**
 * Evaluation runner — orchestrates test case execution against the chat pipeline.
 *
 * For each test case it:
 *   1. Calls handleChatRequest with debugAi=true to capture the X-AI-Trace header
 *   2. Reads the streaming response body to completion
 *   3. Extracts instrumentation from the AiTrace
 *   4. Scores the result via scorer.ts
 *   5. Returns an EvalResult
 */

import { handleChatRequest } from '@/lib/chat/chat-handler'
import { scoreResult } from './scorer'
import type {
  EvalTestCase,
  EvalResult,
  EvalRun,
  EvalRunConfig,
  EvalInstrumentation,
} from './types'
import type { AiTrace } from '@/lib/chat/types'
import type { SheetVerificationResult } from '@/lib/chat/sheet-verifier'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full evaluation suite and return a completed `EvalRun`.
 *
 * @param cases    Test cases to execute (typically from benchmark-cases.ts)
 * @param config   Run configuration including projectId, concurrency, etc.
 * @param supabase An authenticated Supabase client (service role)
 */
export async function runEvaluation(
  cases: EvalTestCase[],
  config: EvalRunConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<EvalRun> {
  const runId = `eval-${Date.now()}`
  const startedAt = new Date().toISOString()

  // Apply filters from config
  let filteredCases = cases
  if (config.testIds?.length) {
    filteredCases = filteredCases.filter(c => config.testIds!.includes(c.id))
  }
  if (config.disciplines?.length) {
    filteredCases = filteredCases.filter(c => config.disciplines!.includes(c.discipline))
  }
  if (config.questionClasses?.length) {
    filteredCases = filteredCases.filter(c => config.questionClasses!.includes(c.questionClass))
  }

  console.log(`[EvalRunner] Starting run ${runId} — ${filteredCases.length} cases`)

  const concurrency = config.concurrency ?? 3
  const results: EvalResult[] = []

  // Process in chunks to respect concurrency limit
  for (let i = 0; i < filteredCases.length; i += concurrency) {
    const chunk = filteredCases.slice(i, i + concurrency)
    const chunkResults = await Promise.all(
      chunk.map(tc => runSingleCase(tc, config, supabase))
    )
    results.push(...chunkResults)

    const doneCount = Math.min(i + concurrency, filteredCases.length)
    console.log(`[EvalRunner] Progress: ${doneCount}/${filteredCases.length}`)
  }

  const completedAt = new Date().toISOString()

  console.log(`[EvalRunner] Run ${runId} complete — ${results.filter(r => r.score.passed).length}/${results.length} passed`)

  return {
    runId,
    config,
    results,
    startedAt,
    completedAt,
  }
}

// ---------------------------------------------------------------------------
// Single case execution
// ---------------------------------------------------------------------------

async function runSingleCase(
  tc: EvalTestCase,
  config: EvalRunConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<EvalResult> {
  const runAt = new Date().toISOString()
  const projectId = tc.projectId ?? config.defaultProjectId
  const startMs = Date.now()

  console.log(`[EvalRunner] Running case ${tc.id}: "${tc.question.slice(0, 80)}"`)

  let responseText = ''
  let trace: AiTrace | null = null
  let httpStatus = 200

  try {
    const response = await handleChatRequest({
      messages: [{ role: 'user', content: tc.question }],
      projectId,
      supabase,
      debugAi: config.debugAi ?? true,
    })

    httpStatus = response.status

    // Extract trace from header
    const traceHeader = response.headers.get('X-AI-Trace')
    if (traceHeader) {
      try {
        trace = JSON.parse(traceHeader) as AiTrace
      } catch {
        console.warn(`[EvalRunner] Failed to parse X-AI-Trace for case ${tc.id}`)
      }
    }

    // Consume the streaming response body
    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const chunks: string[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(decoder.decode(value, { stream: true }))
      }

      const rawBody = chunks.join('')
      responseText = extractTextFromStream(rawBody)
    }
  } catch (err) {
    console.error(`[EvalRunner] Case ${tc.id} threw:`, err)
    responseText = `[ERROR: ${String(err)}]`
    httpStatus = 500
  }

  const latencyMs = Date.now() - startMs

  // Build instrumentation
  const instrumentation = buildInstrumentation(tc.id, trace, responseText, latencyMs)

  // Score
  const { score, failureModes } = scoreResult(tc, instrumentation)

  const logLevel = score.passed ? 'PASS' : 'FAIL'
  console.log(
    `[EvalRunner] ${logLevel} case ${tc.id} score=${score.totalScore} ` +
    `latency=${latencyMs}ms status=${httpStatus}`
  )

  return {
    testCase: tc,
    score,
    instrumentation,
    failureModes,
    runAt,
  }
}

// ---------------------------------------------------------------------------
// Instrumentation extraction
// ---------------------------------------------------------------------------

function buildInstrumentation(
  testId: string,
  trace: AiTrace | null,
  responseText: string,
  latencyMs: number,
): EvalInstrumentation {
  // Parse verification metadata from trace warnings
  const verificationRan = trace?.warnings.some(w => w.startsWith('sheet_verification:')) ?? false
  const planReaderWarning = trace?.warnings.find(w => w.startsWith('plan_reader:')) ?? null
  const planReaderSkipped = trace?.warnings.find(w => w.startsWith('plan_reader_skipped:')) ?? null
  const planReaderRan = planReaderWarning !== null && planReaderSkipped === null

  // Extract type from verification warning: "sheet_verification: type=C class=..."
  let pipelineQueryType: EvalInstrumentation['pipelineQueryType'] = null
  let candidateSheetCount = 0
  let inspectedSheetCount = 0
  let coverageStatus: string | null = null
  let planReaderPages: string[] = []
  let planReaderFindingCount = 0

  if (trace) {
    const verWarn = trace.warnings.find(w => w.startsWith('sheet_verification:'))
    if (verWarn) {
      const typeMatch = verWarn.match(/type=([ABCD])/)
      if (typeMatch) pipelineQueryType = typeMatch[1] as 'A' | 'B' | 'C' | 'D'

      const coverageMatch = verWarn.match(/coverage=(\w+)/)
      if (coverageMatch) coverageStatus = coverageMatch[1]

      const candidatesMatch = verWarn.match(/candidates=(\d+)/)
      if (candidatesMatch) candidateSheetCount = parseInt(candidatesMatch[1], 10)

      const inspectedMatch = verWarn.match(/inspected=(\d+)/)
      if (inspectedMatch) inspectedSheetCount = parseInt(inspectedMatch[1], 10)
    }

    if (planReaderWarning) {
      const pagesMatch = planReaderWarning.match(/pages=([\w,]+)/)
      if (pagesMatch) planReaderPages = pagesMatch[1].split(',').filter(Boolean)

      const findingsMatch = planReaderWarning.match(/findings=(\d+)/)
      if (findingsMatch) planReaderFindingCount = parseInt(findingsMatch[1], 10)
    }
  }

  return {
    testId,
    trace,
    verificationRan,
    pipelineQueryType,
    candidateSheetCount,
    inspectedSheetCount,
    coverageStatus,
    planReaderRan,
    planReaderPages,
    planReaderFindingCount,
    sufficiencyLevel: trace?.sufficiencyLevel ?? 'unknown',
    responseSnippet: responseText.slice(0, 2000),
    responseText,
    latencyMs,
  }
}

// ---------------------------------------------------------------------------
// Stream parsing
// ---------------------------------------------------------------------------

/**
 * Extract plain text content from an AI SDK streaming response body.
 *
 * The AI SDK uses Server-Sent Events format:
 *   data: {"type":"text-delta","textDelta":"Hello"}
 *   data: [DONE]
 *
 * We concatenate all textDelta values to reconstruct the model output.
 */
function extractTextFromStream(rawBody: string): string {
  const lines = rawBody.split('\n')
  const parts: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue

    const jsonStr = trimmed.slice(5).trim()
    if (jsonStr === '[DONE]') continue

    try {
      const parsed = JSON.parse(jsonStr)
      // AI SDK v4 streaming format
      if (parsed.type === 'text-delta' && typeof parsed.textDelta === 'string') {
        parts.push(parsed.textDelta)
      }
      // Vercel AI SDK text_delta
      if (parsed.type === 'text' && typeof parsed.value === 'string') {
        parts.push(parsed.value)
      }
      // OpenAI-compatible format
      if (parsed.choices?.[0]?.delta?.content) {
        parts.push(parsed.choices[0].delta.content)
      }
    } catch {
      // Skip malformed lines
    }
  }

  return parts.join('')
}

// Re-export unused import to satisfy TypeScript (SheetVerificationResult
// is used as a type guard pattern in instr derivation in other contexts)
export type { SheetVerificationResult }
