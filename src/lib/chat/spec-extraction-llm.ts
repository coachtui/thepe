/**
 * Spec extraction LLM adapter (A3c).
 *
 * Builds a `SpecLlmCaller` (the dependency-injected interface accepted by
 * `runSpecExtractionPipeline`) backed by Anthropic's API.
 *
 * Defaults to Haiku 4.5 — same model the existing plan-reader / vision
 * extractors default to. Pricing values match `claude-vision.ts`'s
 * `getModelPricing()` (kept in sync by hand; both should update together
 * when prices change).
 *
 * Per the routed-specialists architecture (memory: project_routed_specialists_architecture):
 * spec extraction is a structured-extraction specialist task. Haiku-first
 * is the right default. A future wrapper can read a `modelHint` and swap
 * to Sonnet on validation-failure / low-confidence escalation; for v1 we
 * always use Haiku.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { SpecLlmCaller } from './spec-extraction-pipeline.ts'

const DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_TEMPERATURE = 0.0

// Per-million-token pricing. Mirrors `getModelPricing()` in claude-vision.ts.
const HAIKU_INPUT_PRICE_PER_M = 0.4
const HAIKU_OUTPUT_PRICE_PER_M = 2.0

export interface CreateAnthropicSpecLlmCallerOptions {
  /** Override the default model. Defaults to Haiku 4.5. */
  model?: string
  /** Override max output tokens. Defaults to 4096. */
  maxTokens?: number
  /** Override sampling temperature. Defaults to 0.0 (deterministic). */
  temperature?: number
  /** Inject a custom Anthropic client (for tests). */
  client?: Anthropic
}

export function createAnthropicSpecLlmCaller(
  options: CreateAnthropicSpecLlmCallerOptions = {}
): SpecLlmCaller {
  const model = options.model ?? DEFAULT_HAIKU_MODEL
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE

  // Lazily resolve the client per call so a missing API key only blocks
  // when extraction actually runs (not at module load).
  return async function anthropicSpecLlmCaller(input) {
    let client: Anthropic
    try {
      client = options.client ?? buildClient()
    } catch (err) {
      return {
        rawText: '',
        modelUsed: model,
        error: err instanceof Error ? err.message : String(err),
      }
    }

    const userContent = `${input.prompt}\n\n=== SECTION TEXT ===\nSection number: ${input.sectionContext.sectionNumber}\nSection title: ${input.sectionContext.sectionTitle}\n\n${input.sectionText}`

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: userContent }],
      })

      const rawText =
        response.content[0]?.type === 'text' ? response.content[0].text : ''
      const costUsd = estimateCostHaiku(
        response.usage.input_tokens,
        response.usage.output_tokens
      )
      return { rawText, modelUsed: model, costUsd }
    } catch (err) {
      return {
        rawText: '',
        modelUsed: model,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

function buildClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }
  return new Anthropic({ apiKey })
}

function estimateCostHaiku(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * HAIKU_INPUT_PRICE_PER_M
  const outputCost = (outputTokens / 1_000_000) * HAIKU_OUTPUT_PRICE_PER_M
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
}
