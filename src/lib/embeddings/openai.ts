/**
 * OpenAI Embeddings service
 * Phase 2: Document Management & RAG
 */

import OpenAI from 'openai'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY not found in environment variables')
}

// Initialize OpenAI client
let openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: OPENAI_API_KEY,
    })
  }

  return openaiClient
}

// Embedding model configuration
const EMBEDDING_MODEL = 'text-embedding-3-small' // 1536 dimensions, cost-effective
// Alternative: 'text-embedding-3-large' for higher quality (3072 dimensions)

export interface EmbeddingResult {
  embedding: number[]
  model: string
  usage: {
    promptTokens: number
    totalTokens: number
  }
}

/**
 * Generate embedding for a single text string
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty')
  }

  const client = getOpenAIClient()

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.trim(),
      encoding_format: 'float',
    })

    const embedding = response.data[0].embedding
    const usage = response.usage

    return {
      embedding,
      model: EMBEDDING_MODEL,
      usage: {
        promptTokens: usage.prompt_tokens,
        totalTokens: usage.total_tokens,
      },
    }
  } catch (error) {
    console.error('OpenAI embedding error:', error)
    throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Generate embeddings for multiple text strings in batch
 * More efficient than calling generateEmbedding() multiple times
 */
export async function generateEmbeddingsBatch(
  texts: string[]
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) {
    return []
  }

  // Filter out empty texts
  const validTexts = texts.filter((t) => t && t.trim().length > 0)

  if (validTexts.length === 0) {
    return []
  }

  const client = getOpenAIClient()

  try {
    // OpenAI API supports up to 2048 inputs per request
    const batchSize = 100 // Conservative batch size
    const results: EmbeddingResult[] = []

    for (let i = 0; i < validTexts.length; i += batchSize) {
      const batch = validTexts.slice(i, i + batchSize)

      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch.map((t) => t.trim()),
        encoding_format: 'float',
      })

      const batchResults = response.data.map((item, index) => ({
        embedding: item.embedding,
        model: EMBEDDING_MODEL,
        usage: {
          promptTokens: Math.floor(response.usage.prompt_tokens / batch.length),
          totalTokens: Math.floor(response.usage.total_tokens / batch.length),
        },
      }))

      results.push(...batchResults)
    }

    return results
  } catch (error) {
    console.error('OpenAI batch embedding error:', error)
    throw new Error(`Failed to generate embeddings batch: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Calculate cosine similarity between two embeddings
 * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
 */
export function cosineSimilarity(embedding1: number[], embedding2: number[]): number {
  if (embedding1.length !== embedding2.length) {
    throw new Error('Embeddings must have the same length')
  }

  let dotProduct = 0
  let magnitude1 = 0
  let magnitude2 = 0

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i]
    magnitude1 += embedding1[i] * embedding1[i]
    magnitude2 += embedding2[i] * embedding2[i]
  }

  magnitude1 = Math.sqrt(magnitude1)
  magnitude2 = Math.sqrt(magnitude2)

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0
  }

  return dotProduct / (magnitude1 * magnitude2)
}

/**
 * Get the expected embedding dimension for the current model
 */
export function getEmbeddingDimension(): number {
  return 1536 // text-embedding-3-small dimensions
  // For text-embedding-3-large: return 3072
}

/**
 * Estimate cost for generating embeddings
 * Based on OpenAI pricing (as of 2024)
 */
export function estimateEmbeddingCost(tokenCount: number): number {
  // text-embedding-3-small: $0.02 per 1M tokens
  const costPerToken = 0.02 / 1_000_000
  return tokenCount * costPerToken
}

/**
 * Validate embedding array
 */
export function isValidEmbedding(embedding: number[]): boolean {
  if (!Array.isArray(embedding)) return false
  if (embedding.length !== getEmbeddingDimension()) return false
  return embedding.every((val) => typeof val === 'number' && !isNaN(val))
}
