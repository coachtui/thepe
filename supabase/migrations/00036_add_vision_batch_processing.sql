-- ============================================================================
-- VISION BATCH PROCESSING SYSTEM
-- Migration 00036: Add tables for Inngest-based batch vision processing
--
-- This enables processing construction plan sets of 500-5,000 pages by:
-- 1. Chunking PDFs into 50-100 page batches
-- 2. Processing chunks in parallel (5 concurrent)
-- 3. Tracking progress and status per chunk
-- 4. Storing job metadata for resumability
-- ============================================================================

-- ============================================================================
-- TABLE: vision_processing_jobs
-- Track batch processing jobs at the document level
-- ============================================================================
CREATE TABLE vision_processing_jobs (
    -- Primary identification
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_key TEXT UNIQUE NOT NULL, -- Inngest job ID for correlation

    -- Relationships
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

    -- Job configuration
    total_pages INTEGER NOT NULL CHECK (total_pages > 0),
    pages_per_chunk INTEGER NOT NULL DEFAULT 50 CHECK (pages_per_chunk > 0 AND pages_per_chunk <= 200),
    total_chunks INTEGER NOT NULL CHECK (total_chunks > 0),

    -- Processing strategy
    processing_mode TEXT NOT NULL DEFAULT 'parallel' CHECK (processing_mode IN ('sequential', 'parallel')),
    max_parallel_chunks INTEGER NOT NULL DEFAULT 5 CHECK (max_parallel_chunks > 0),

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    chunks_completed INTEGER NOT NULL DEFAULT 0 CHECK (chunks_completed >= 0),
    chunks_failed INTEGER NOT NULL DEFAULT 0 CHECK (chunks_failed >= 0),

    -- Progress metrics
    pages_processed INTEGER NOT NULL DEFAULT 0 CHECK (pages_processed >= 0),
    quantities_extracted INTEGER NOT NULL DEFAULT 0 CHECK (quantities_extracted >= 0),
    total_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0 CHECK (total_cost_usd >= 0),

    -- Time tracking
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    estimated_completion_at TIMESTAMPTZ,

    -- Error tracking
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries >= 0),

    -- Metadata (for extensibility)
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chunks_completed_lte_total CHECK (chunks_completed <= total_chunks),
    CONSTRAINT chunks_failed_lte_total CHECK (chunks_failed <= total_chunks),
    CONSTRAINT pages_processed_lte_total CHECK (pages_processed <= total_pages)
);

-- ============================================================================
-- TABLE: vision_processing_chunks
-- Track individual chunk status and results
-- ============================================================================
CREATE TABLE vision_processing_chunks (
    -- Primary identification
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relationships
    job_id UUID NOT NULL REFERENCES vision_processing_jobs(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),

    -- Chunk scope
    page_start INTEGER NOT NULL CHECK (page_start > 0),
    page_end INTEGER NOT NULL CHECK (page_end > 0),
    page_count INTEGER NOT NULL CHECK (page_count > 0),

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),

    -- Results
    pages_processed INTEGER NOT NULL DEFAULT 0 CHECK (pages_processed >= 0),
    quantities_found INTEGER NOT NULL DEFAULT 0 CHECK (quantities_found >= 0),
    termination_points_found INTEGER NOT NULL DEFAULT 0 CHECK (termination_points_found >= 0),
    crossings_found INTEGER NOT NULL DEFAULT 0 CHECK (crossings_found >= 0),

    -- Cost tracking
    cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
    tokens_input INTEGER NOT NULL DEFAULT 0 CHECK (tokens_input >= 0),
    tokens_output INTEGER NOT NULL DEFAULT 0 CHECK (tokens_output >= 0),

    -- Time tracking
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    processing_time_ms INTEGER CHECK (processing_time_ms >= 0),

    -- Error handling
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),

    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT page_end_gte_page_start CHECK (page_end >= page_start),
    CONSTRAINT page_count_matches CHECK (page_count = page_end - page_start + 1),
    CONSTRAINT pages_processed_lte_page_count CHECK (pages_processed <= page_count),
    CONSTRAINT unique_chunk_per_job UNIQUE(job_id, chunk_index)
);

-- ============================================================================
-- TABLE: vision_job_events
-- Audit log for debugging and monitoring
-- ============================================================================
CREATE TABLE vision_job_events (
    -- Primary identification
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relationships
    job_id UUID NOT NULL REFERENCES vision_processing_jobs(id) ON DELETE CASCADE,
    chunk_id UUID REFERENCES vision_processing_chunks(id) ON DELETE CASCADE,

    -- Event details
    event_type TEXT NOT NULL CHECK (event_type != ''),
    event_data JSONB DEFAULT '{}'::jsonb,

    -- Timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES for performance
-- ============================================================================

-- Jobs table indexes
CREATE INDEX idx_vision_jobs_project ON vision_processing_jobs(project_id);
CREATE INDEX idx_vision_jobs_document ON vision_processing_jobs(document_id);
CREATE INDEX idx_vision_jobs_status ON vision_processing_jobs(status) WHERE status IN ('pending', 'processing');
CREATE INDEX idx_vision_jobs_created ON vision_processing_jobs(created_at DESC);
CREATE INDEX idx_vision_jobs_job_key ON vision_processing_jobs(job_key);

-- Chunks table indexes
CREATE INDEX idx_vision_chunks_job ON vision_processing_chunks(job_id, chunk_index);
CREATE INDEX idx_vision_chunks_status ON vision_processing_chunks(status) WHERE status IN ('pending', 'processing', 'failed');
CREATE INDEX idx_vision_chunks_job_status ON vision_processing_chunks(job_id, status);

-- Events table indexes
CREATE INDEX idx_vision_events_job ON vision_job_events(job_id, created_at DESC);
CREATE INDEX idx_vision_events_chunk ON vision_job_events(chunk_id, created_at DESC) WHERE chunk_id IS NOT NULL;
CREATE INDEX idx_vision_events_type ON vision_job_events(event_type, created_at DESC);

-- ============================================================================
-- TRIGGERS for updated_at timestamps
-- ============================================================================

CREATE TRIGGER update_vision_jobs_updated_at
    BEFORE UPDATE ON vision_processing_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vision_chunks_updated_at
    BEFORE UPDATE ON vision_processing_chunks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE vision_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vision_processing_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE vision_job_events ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES: vision_processing_jobs
-- ============================================================================

-- Policy: Users can view jobs for projects they have access to
CREATE POLICY "Users can view jobs for their projects"
ON vision_processing_jobs FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = vision_processing_jobs.project_id
        AND pm.user_id = auth.uid()
    )
);

-- Policy: Users can insert jobs for projects they are members of
CREATE POLICY "Users can create jobs for projects they can edit"
ON vision_processing_jobs FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = vision_processing_jobs.project_id
        AND pm.user_id = auth.uid()
    )
);

-- Policy: Users can update jobs for projects they are members of
CREATE POLICY "Users can update jobs for projects they can edit"
ON vision_processing_jobs FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = vision_processing_jobs.project_id
        AND pm.user_id = auth.uid()
    )
);

-- Policy: Service role can do everything (for Inngest background jobs)
CREATE POLICY "Service role has full access to jobs"
ON vision_processing_jobs FOR ALL
USING (auth.jwt()->>'role' = 'service_role')
WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- RLS POLICIES: vision_processing_chunks
-- ============================================================================

-- Policy: Users can view chunks for jobs they have access to
CREATE POLICY "Users can view chunks for their jobs"
ON vision_processing_chunks FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM vision_processing_jobs j
        JOIN project_members pm ON pm.project_id = j.project_id
        WHERE j.id = vision_processing_chunks.job_id
        AND pm.user_id = auth.uid()
    )
);

-- Policy: Service role can do everything (for Inngest background jobs)
CREATE POLICY "Service role has full access to chunks"
ON vision_processing_chunks FOR ALL
USING (auth.jwt()->>'role' = 'service_role')
WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- RLS POLICIES: vision_job_events
-- ============================================================================

-- Policy: Users can view events for jobs they have access to
CREATE POLICY "Users can view events for their jobs"
ON vision_job_events FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM vision_processing_jobs j
        JOIN project_members pm ON pm.project_id = j.project_id
        WHERE j.id = vision_job_events.job_id
        AND pm.user_id = auth.uid()
    )
);

-- Policy: Service role can do everything (for Inngest background jobs)
CREATE POLICY "Service role has full access to events"
ON vision_job_events FOR ALL
USING (auth.jwt()->>'role' = 'service_role')
WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function: Get job progress percentage
CREATE OR REPLACE FUNCTION get_job_progress(job_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE
AS $$
    SELECT
        CASE
            WHEN j.total_chunks = 0 THEN 0
            ELSE ROUND((j.chunks_completed::NUMERIC / j.total_chunks::NUMERIC) * 100)::INTEGER
        END
    FROM vision_processing_jobs j
    WHERE j.id = job_id;
$$;

-- Function: Get estimated time remaining (in minutes)
CREATE OR REPLACE FUNCTION get_estimated_time_remaining(job_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE
AS $$
    SELECT
        CASE
            WHEN j.chunks_completed = 0 OR j.started_at IS NULL THEN NULL
            WHEN j.chunks_completed = j.total_chunks THEN 0
            ELSE
                ROUND(
                    (EXTRACT(EPOCH FROM (NOW() - j.started_at)) / 60) -- Minutes elapsed
                    * (j.total_chunks - j.chunks_completed) -- Chunks remaining
                    / j.chunks_completed -- Chunks completed (avg rate)
                )::INTEGER
        END
    FROM vision_processing_jobs j
    WHERE j.id = job_id;
$$;

-- ============================================================================
-- COMMENTS for documentation
-- ============================================================================

COMMENT ON TABLE vision_processing_jobs IS 'Tracks batch vision processing jobs for large PDF documents (500-5000 pages)';
COMMENT ON TABLE vision_processing_chunks IS 'Tracks individual chunks (50-100 pages each) within a processing job';
COMMENT ON TABLE vision_job_events IS 'Audit log for job and chunk events (debugging and monitoring)';

COMMENT ON COLUMN vision_processing_jobs.job_key IS 'Inngest job ID for correlation with Inngest events';
COMMENT ON COLUMN vision_processing_jobs.processing_mode IS 'sequential: process chunks one at a time, parallel: process multiple chunks concurrently';
COMMENT ON COLUMN vision_processing_jobs.max_parallel_chunks IS 'Maximum number of chunks to process concurrently (default 5)';
COMMENT ON COLUMN vision_processing_chunks.chunk_index IS 'Zero-based index of chunk within job (0, 1, 2, ...)';
COMMENT ON COLUMN vision_processing_chunks.page_start IS 'First page number in chunk (1-indexed)';
COMMENT ON COLUMN vision_processing_chunks.page_end IS 'Last page number in chunk (inclusive, 1-indexed)';
