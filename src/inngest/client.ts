/**
 * Inngest Client Configuration
 *
 * Initializes the Inngest client for serverless background job processing.
 * Used for batch vision processing of large construction plan sets (500-5000 pages).
 */

import { Inngest } from 'inngest';

/**
 * Inngest Event Schema
 * Defines all events that can be sent to Inngest
 */
export type InngestEvents = {
  // Batch processing events
  'vision/batch.started': {
    data: {
      jobId: string;
      documentId: string;
      projectId: string;
      totalPages: number;
      totalChunks: number;
      chunkSize: number;
      maxParallel: number;
    };
  };

  'vision/batch.completed': {
    data: {
      jobId: string;
      documentId: string;
      projectId: string;
      totalChunks: number;
      chunksCompleted: number;
      chunksFailed: number;
      pagesProcessed: number;
      quantitiesExtracted: number;
      totalCost: number;
    };
  };

  'vision/batch.failed': {
    data: {
      jobId: string;
      documentId: string;
      projectId: string;
      error: string;
      chunksCompleted: number;
      chunksFailed: number;
    };
  };

  // Chunk processing events
  'vision/chunk.process': {
    data: {
      jobId: string;
      chunkId: string;
      chunkIndex: number;
      pageStart: number;
      pageEnd: number;
      documentId: string;
      projectId: string;
    };
  };

  'vision/chunk.completed': {
    data: {
      jobId: string;
      chunkId: string;
      chunkIndex: number;
      pagesProcessed: number;
      quantitiesFound: number;
      terminationPointsFound: number;
      crossingsFound: number;
      cost: number;
      tokensUsed: {
        input: number;
        output: number;
      };
    };
  };

  'vision/chunk.failed': {
    data: {
      jobId: string;
      chunkId: string;
      chunkIndex: number;
      error: string;
      retryCount: number;
    };
  };

  // Progress update events
  'vision/progress.updated': {
    data: {
      jobId: string;
      chunksCompleted: number;
      totalChunks: number;
      percentComplete: number;
      estimatedTimeRemaining: number; // in minutes
    };
  };
};

/**
 * Initialize Inngest client
 *
 * Environment variables required:
 * - INNGEST_EVENT_KEY: For sending events to Inngest
 * - INNGEST_SIGNING_KEY: For webhook verification
 */
export const inngest = new Inngest<InngestEvents>({
  id: 'construction-plan-processor',
  name: 'Construction Plan Vision Processor',

  // Event key for sending events (optional in development)
  eventKey: process.env.INNGEST_EVENT_KEY,

  // Additional configuration
  env: process.env.NODE_ENV === 'production' ? 'production' : 'development',

  // Logging configuration
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  },
});

/**
 * Helper: Check if Inngest is properly configured
 */
export function isInngestConfigured(): boolean {
  // Event key not required in development mode
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  return !!(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);
}

/**
 * Helper: Get Inngest configuration status
 */
export function getInngestStatus(): {
  configured: boolean;
  hasEventKey: boolean;
  hasSigningKey: boolean;
  environment: string;
} {
  return {
    configured: isInngestConfigured(),
    hasEventKey: !!process.env.INNGEST_EVENT_KEY,
    hasSigningKey: !!process.env.INNGEST_SIGNING_KEY,
    environment: process.env.NODE_ENV || 'development',
  };
}
