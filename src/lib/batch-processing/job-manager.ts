// @ts-nocheck
/**
 * Vision Processing Job Manager
 *
 * Database operations for managing vision processing jobs.
 * Used by Inngest functions to track batch processing progress.
 */

import { createClient as createServiceClient } from '@/lib/db/supabase/server';
import type { Database } from '@/types/supabase';

type VisionJob = Database['public']['Tables']['vision_processing_jobs']['Row'];
type VisionJobInsert = Database['public']['Tables']['vision_processing_jobs']['Insert'];
type VisionJobUpdate = Database['public']['Tables']['vision_processing_jobs']['Update'];

/**
 * Create a new vision processing job
 */
export async function createVisionJob(data: {
  jobKey: string;
  projectId: string;
  documentId: string;
  totalPages: number;
  pagesPerChunk: number;
  totalChunks: number;
  processingMode?: 'sequential' | 'parallel';
  maxParallelChunks?: number;
  metadata?: Record<string, any>;
}): Promise<VisionJob> {
  const supabase = await createServiceClient();

  const jobData: VisionJobInsert = {
    job_key: data.jobKey,
    project_id: data.projectId,
    document_id: data.documentId,
    total_pages: data.totalPages,
    pages_per_chunk: data.pagesPerChunk,
    total_chunks: data.totalChunks,
    processing_mode: data.processingMode || 'parallel',
    max_parallel_chunks: data.maxParallelChunks || 5,
    status: 'pending',
    metadata: data.metadata || {},
  };

  const { data: job, error } = await supabase
    .from('vision_processing_jobs')
    .insert(jobData)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create vision processing job: ${error.message}`);
  }

  return job;
}

/**
 * Get a vision processing job by ID
 */
export async function getVisionJob(jobId: string): Promise<VisionJob | null> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to get vision processing job: ${error.message}`);
  }

  return data;
}

/**
 * Get a vision processing job by job key (Inngest ID)
 */
export async function getVisionJobByKey(jobKey: string): Promise<VisionJob | null> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_jobs')
    .select('*')
    .eq('job_key', jobKey)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to get vision processing job by key: ${error.message}`);
  }

  return data;
}

/**
 * Update a vision processing job
 */
export async function updateVisionJob(
  jobId: string,
  updates: VisionJobUpdate
): Promise<VisionJob> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_jobs')
    .update(updates)
    .eq('id', jobId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update vision processing job: ${error.message}`);
  }

  return data;
}

/**
 * Mark job as processing and set started_at
 */
export async function startVisionJob(jobId: string): Promise<VisionJob> {
  return updateVisionJob(jobId, {
    status: 'processing',
    started_at: new Date().toISOString(),
  });
}

/**
 * Mark job as completed
 */
export async function completeVisionJob(jobId: string): Promise<VisionJob> {
  return updateVisionJob(jobId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
  });
}

/**
 * Mark job as failed
 */
export async function failVisionJob(
  jobId: string,
  errorMessage: string
): Promise<VisionJob> {
  return updateVisionJob(jobId, {
    status: 'failed',
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  });
}

/**
 * Update job progress (chunks completed, pages processed, etc.)
 */
export async function updateJobProgress(
  jobId: string,
  data: {
    chunksCompleted?: number;
    chunksFailed?: number;
    pagesProcessed?: number;
    quantitiesExtracted?: number;
    totalCost?: number;
  }
): Promise<VisionJob> {
  const updates: VisionJobUpdate = {};

  if (data.chunksCompleted !== undefined) {
    updates.chunks_completed = data.chunksCompleted;
  }
  if (data.chunksFailed !== undefined) {
    updates.chunks_failed = data.chunksFailed;
  }
  if (data.pagesProcessed !== undefined) {
    updates.pages_processed = data.pagesProcessed;
  }
  if (data.quantitiesExtracted !== undefined) {
    updates.quantities_extracted = data.quantitiesExtracted;
  }
  if (data.totalCost !== undefined) {
    updates.total_cost_usd = data.totalCost;
  }

  return updateVisionJob(jobId, updates);
}

/**
 * Increment job progress counters
 */
export async function incrementJobProgress(
  jobId: string,
  data: {
    chunksCompleted?: number;
    chunksFailed?: number;
    pagesProcessed?: number;
    quantitiesExtracted?: number;
    addCost?: number;
  }
): Promise<VisionJob> {
  const supabase = await createServiceClient();

  // Get current job state
  const job = await getVisionJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  // Calculate new values
  const updates: VisionJobUpdate = {};

  if (data.chunksCompleted !== undefined) {
    updates.chunks_completed = (job.chunks_completed || 0) + data.chunksCompleted;
  }
  if (data.chunksFailed !== undefined) {
    updates.chunks_failed = (job.chunks_failed || 0) + data.chunksFailed;
  }
  if (data.pagesProcessed !== undefined) {
    updates.pages_processed = (job.pages_processed || 0) + data.pagesProcessed;
  }
  if (data.quantitiesExtracted !== undefined) {
    updates.quantities_extracted = (job.quantities_extracted || 0) + data.quantitiesExtracted;
  }
  if (data.addCost !== undefined) {
    const currentCost = parseFloat(job.total_cost_usd?.toString() || '0');
    updates.total_cost_usd = currentCost + data.addCost;
  }

  return updateVisionJob(jobId, updates);
}

/**
 * Get job progress percentage
 */
export async function getJobProgress(jobId: string): Promise<{
  percentComplete: number;
  chunksCompleted: number;
  totalChunks: number;
  estimatedTimeRemaining: number | null; // in minutes
}> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .rpc('get_job_progress', { job_id: jobId });

  if (error) {
    throw new Error(`Failed to get job progress: ${error.message}`);
  }

  // Get estimated time remaining
  const { data: timeData } = await supabase
    .rpc('get_estimated_time_remaining', { job_id: jobId });

  const job = await getVisionJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  return {
    percentComplete: data || 0,
    chunksCompleted: job.chunks_completed || 0,
    totalChunks: job.total_chunks,
    estimatedTimeRemaining: timeData || null,
  };
}

/**
 * Get jobs for a document
 */
export async function getJobsForDocument(documentId: string): Promise<VisionJob[]> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_jobs')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get jobs for document: ${error.message}`);
  }

  return data || [];
}

/**
 * Get active jobs (pending or processing)
 */
export async function getActiveJobs(): Promise<VisionJob[]> {
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from('vision_processing_jobs')
    .select('*')
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to get active jobs: ${error.message}`);
  }

  return data || [];
}

/**
 * Log a job event
 */
export async function logJobEvent(
  jobId: string,
  eventType: string,
  eventData?: Record<string, any>,
  chunkId?: string
): Promise<void> {
  const supabase = await createServiceClient();

  const { error } = await supabase
    .from('vision_job_events')
    .insert({
      job_id: jobId,
      chunk_id: chunkId || null,
      event_type: eventType,
      event_data: eventData || {},
    });

  if (error) {
    console.error('Failed to log job event:', error);
    // Don't throw - event logging is non-critical
  }
}
