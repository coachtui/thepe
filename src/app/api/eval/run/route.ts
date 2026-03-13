/**
 * POST /api/eval/run
 *
 * Triggers an evaluation run against the benchmark suite.
 * Requires service-role auth (eval runs must not be triggered by end users).
 *
 * Request body:
 * {
 *   projectId: string          // project to run tests against
 *   testIds?: string[]         // subset of test IDs (omit = all)
 *   disciplines?: string[]     // subset of disciplines
 *   questionClasses?: string[] // subset of question classes
 *   debugAi?: boolean          // enable AI trace (default: true for eval)
 *   concurrency?: number       // parallel tests (default: 3)
 * }
 *
 * Response:
 * {
 *   runId: string
 *   summary: EvalSummary
 *   run: EvalRun (full results including per-case instrumentation)
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ALL_CASES } from '@/lib/eval/benchmark-cases'
import { runEvaluation } from '@/lib/eval/runner'
import { buildSummary, printReport } from '@/lib/eval/reporter'
import type { EvalRunConfig } from '@/lib/eval/types'

// Eval endpoint is admin-only — use service role client
function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, serviceKey)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Guard: eval must be explicitly enabled
  if (process.env.EVAL_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Evaluation endpoint is disabled. Set EVAL_ENABLED=true to enable.' },
      { status: 403 }
    )
  }

  // Guard: require eval secret header to prevent accidental triggering
  const evalSecret = process.env.EVAL_SECRET
  if (evalSecret) {
    const provided = req.headers.get('X-Eval-Secret')
    if (provided !== evalSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const projectId = body.projectId as string | undefined
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  const config: EvalRunConfig = {
    name: (body.name as string) ?? `eval-${Date.now()}`,
    testIds: body.testIds as string[] | undefined,
    disciplines: body.disciplines as EvalRunConfig['disciplines'],
    questionClasses: body.questionClasses as EvalRunConfig['questionClasses'],
    defaultProjectId: projectId,
    debugAi: (body.debugAi as boolean) ?? true,
    concurrency: (body.concurrency as number) ?? 3,
  }

  let supabase: ReturnType<typeof createServiceClient>
  try {
    supabase = createServiceClient()
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  console.log('[EvalRoute] Starting evaluation run with config:', {
    projectId,
    testIds: config.testIds ?? 'all',
    disciplines: config.disciplines ?? 'all',
    questionClasses: config.questionClasses ?? 'all',
    concurrency: config.concurrency,
  })

  try {
    const run = await runEvaluation(ALL_CASES, config, supabase)
    const summary = buildSummary(run)

    // Emit formatted report to server console
    printReport(summary)

    return NextResponse.json({
      runId: run.runId,
      summary,
      run,
    })
  } catch (err) {
    console.error('[EvalRoute] Run failed:', err)
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    )
  }
}

/** GET /api/eval/run — returns the benchmark case manifest (no execution). */
export async function GET(): Promise<NextResponse> {
  if (process.env.EVAL_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Evaluation endpoint is disabled.' },
      { status: 403 }
    )
  }

  return NextResponse.json({
    totalCases: ALL_CASES.length,
    cases: ALL_CASES.map(c => ({
      id: c.id,
      discipline: c.discipline,
      questionClass: c.questionClass,
      description: c.description,
      tags: c.tags,
    })),
  })
}
