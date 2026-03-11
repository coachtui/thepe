// @ts-nocheck
/**
 * Vision Processing Chunk Manager
 *
 * Database operations for managing vision processing chunks.
 * Used by Inngest functions to track individual chunk status and results.
 */

import { createClient as createServiceClient } from '@/lib/db/supabase/server';
import type { Database } from '@/types/supabase';

type VisionChunk = Database['public']['Tables']['vision_processing_chunks']['Row'];
type VisionChunkInsert = Database['public']['Tables']['vision_processing_chunks']['Insert'];
type VisionChunkUpdate = Database['public']['Tables']['vision_processing_chunks']['Update'];

/**
 * Get a chunk by ID
 */
export async function getVisionChunk(chunkId: string): Promise<VisionChunk | null> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_chunks')
    .select('*')
    .eq('id', chunkId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to get vision processing chunk: ${error.message}`);
  }

  return data;
}

/**
 * Get all chunks for a job
 */
export async function getJobChunks(jobId: string): Promise<VisionChunk[]> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_chunks')
    .select('*')
    .eq('job_id', jobId)
    .order('chunk_index');

  if (error) {
    throw new Error(`Failed to get job chunks: ${error.message}`);
  }

  return data || [];
}

/**
 * Get chunks by status for a job
 */
export async function getChunksByStatus(
  jobId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'
): Promise<VisionChunk[]> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_chunks')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', status)
    .order('chunk_index');

  if (error) {
    throw new Error(`Failed to get chunks by status: ${error.message}`);
  }

  return data || [];
}

/**
 * Update a chunk
 */
export async function updateVisionChunk(
  chunkId: string,
  updates: VisionChunkUpdate
): Promise<VisionChunk> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_chunks')
    .update(updates)
    .eq('id', chunkId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update vision processing chunk: ${error.message}`);
  }

  return data;
}

/**
 * Mark chunk as processing
 */
export async function startVisionChunk(chunkId: string): Promise<VisionChunk> {
  return updateVisionChunk(chunkId, {
    status: 'processing',
    started_at: new Date().toISOString(),
  });
}

/**
 * Mark chunk as completed with results
 */
export async function completeVisionChunk(
  chunkId: string,
  results: {
    pagesProcessed: number;
    quantitiesFound: number;
    terminationPointsFound?: number;
    crossingsFound?: number;
    cost: number;
    tokensInput?: number;
    tokensOutput?: number;
    processingTimeMs?: number;
  }
): Promise<VisionChunk> {
  const updates: VisionChunkUpdate = {
    status: 'completed',
    completed_at: new Date().toISOString(),
    pages_processed: results.pagesProcessed,
    quantities_found: results.quantitiesFound,
    cost_usd: results.cost,
  };

  if (results.terminationPointsFound !== undefined) {
    updates.termination_points_found = results.terminationPointsFound;
  }
  if (results.crossingsFound !== undefined) {
    updates.crossings_found = results.crossingsFound;
  }
  if (results.tokensInput !== undefined) {
    updates.tokens_input = results.tokensInput;
  }
  if (results.tokensOutput !== undefined) {
    updates.tokens_output = results.tokensOutput;
  }
  if (results.processingTimeMs !== undefined) {
    updates.processing_time_ms = results.processingTimeMs;
  }

  return updateVisionChunk(chunkId, updates);
}

/**
 * Mark chunk as failed
 */
export async function failVisionChunk(
  chunkId: string,
  errorMessage: string,
  retryCount?: number
): Promise<VisionChunk> {
  const updates: VisionChunkUpdate = {
    status: 'failed',
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  };

  if (retryCount !== undefined) {
    updates.retry_count = retryCount;
  }

  return updateVisionChunk(chunkId, updates);
}

/**
 * Increment chunk retry count
 */
export async function incrementChunkRetry(chunkId: string): Promise<VisionChunk> {
  const chunk = await getVisionChunk(chunkId);
  if (!chunk) {
    throw new Error(`Chunk not found: ${chunkId}`);
  }

  return updateVisionChunk(chunkId, {
    retry_count: (chunk.retry_count || 0) + 1,
  });
}

/**
 * Get chunk progress summary for a job
 */
export async function getJobChunkSummary(jobId: string): Promise<{
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  skipped: number;
}> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_chunks')
    .select('status')
    .eq('job_id', jobId);

  if (error) {
    throw new Error(`Failed to get chunk summary: ${error.message}`);
  }

  const chunks = data || [];

  return {
    total: chunks.length,
    pending: chunks.filter((c) => c.status === 'pending').length,
    processing: chunks.filter((c) => c.status === 'processing').length,
    completed: chunks.filter((c) => c.status === 'completed').length,
    failed: chunks.filter((c) => c.status === 'failed').length,
    skipped: chunks.filter((c) => c.status === 'skipped').length,
  };
}

/**
 * Get aggregated results for a job
 */
export async function getJobAggregatedResults(jobId: string): Promise<{
  pagesProcessed: number;
  quantitiesFound: number;
  terminationPointsFound: number;
  crossingsFound: number;
  totalCost: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  averageProcessingTimeMs: number;
}> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_chunks')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'completed');

  if (error) {
    throw new Error(`Failed to get aggregated results: ${error.message}`);
  }

  const chunks = data || [];

  if (chunks.length === 0) {
    return {
      pagesProcessed: 0,
      quantitiesFound: 0,
      terminationPointsFound: 0,
      crossingsFound: 0,
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      averageProcessingTimeMs: 0,
    };
  }

  const totals = chunks.reduce(
    (acc, chunk) => ({
      pagesProcessed: acc.pagesProcessed + (chunk.pages_processed || 0),
      quantitiesFound: acc.quantitiesFound + (chunk.quantities_found || 0),
      terminationPointsFound:
        acc.terminationPointsFound + (chunk.termination_points_found || 0),
      crossingsFound: acc.crossingsFound + (chunk.crossings_found || 0),
      totalCost: acc.totalCost + parseFloat(chunk.cost_usd?.toString() || '0'),
      totalTokensInput: acc.totalTokensInput + (chunk.tokens_input || 0),
      totalTokensOutput: acc.totalTokensOutput + (chunk.tokens_output || 0),
      totalProcessingTimeMs:
        acc.totalProcessingTimeMs + (chunk.processing_time_ms || 0),
    }),
    {
      pagesProcessed: 0,
      quantitiesFound: 0,
      terminationPointsFound: 0,
      crossingsFound: 0,
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalProcessingTimeMs: 0,
    }
  );

  return {
    ...totals,
    averageProcessingTimeMs: Math.round(totals.totalProcessingTimeMs / chunks.length),
  };
}

/**
 * Get pending chunks for a job (for parallel processing)
 */
export async function getPendingChunks(
  jobId: string,
  limit?: number
): Promise<VisionChunk[]> {
  const supabase = await createServiceClient();

  let query = supabase
    .from('vision_processing_chunks')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'pending')
    .order('chunk_index');

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get pending chunks: ${error.message}`);
  }

  return data || [];
}

/**
 * Get failed chunks that can be retried
 */
export async function getRetryableChunks(
  jobId: string,
  maxRetries: number = 3
): Promise<VisionChunk[]> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_chunks')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'failed')
    .lt('retry_count', maxRetries)
    .order('chunk_index');

  if (error) {
    throw new Error(`Failed to get retryable chunks: ${error.message}`);
  }

  return data || [];
}
