-- Migration: Add vision processing status tracking to documents table
-- Purpose: Track vision processing lifecycle (pending, processing, completed, failed)
-- Date: 2026-01-28
--
-- VISION PROCESSING PHASES:
-- Phase 1 (Current): Extract utility inventory and station ranges from title/summary sheets
--   - Extracts: "Water Line A: Sta 13+00 to 36+00" (ranges, not calculated quantities)
--   - Provides: Context for semantic search, utility metadata
--   - Accuracy: ~60% (approximate ranges)
--
-- Phase 2 (Next): Calculate quantities from station ranges
--   - Calculates: 36+00 - 13+00 = 23 stations = 2,300 LF
--   - Handles: "to end" by estimating or finding max station
--   - Accuracy: ~85% (calculated from ranges)
--
-- Phase 3 (Future): Full plan sheet analysis
--   - Processes: Plan sheets to extract actual alignments
--   - Measures: Visual station markers and utility lines
--   - Accuracy: ~95% (measured from plans)

-- Add vision status columns to documents table
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS vision_status TEXT DEFAULT 'pending'
    CHECK (vision_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
ADD COLUMN IF NOT EXISTS vision_processed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS vision_error TEXT,
ADD COLUMN IF NOT EXISTS vision_sheets_processed INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS vision_quantities_extracted INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS vision_cost_usd NUMERIC(10, 6) DEFAULT 0;

-- Add index for filtering by vision status
CREATE INDEX IF NOT EXISTS idx_documents_vision_status
ON documents(project_id, vision_status);

-- Add index for recently processed documents
CREATE INDEX IF NOT EXISTS idx_documents_vision_processed
ON documents(vision_processed_at DESC)
WHERE vision_status = 'completed';

-- Add comments
COMMENT ON COLUMN documents.vision_status IS 'Status of vision processing: pending, processing, completed, failed, skipped';
COMMENT ON COLUMN documents.vision_processed_at IS 'Timestamp when vision processing completed';
COMMENT ON COLUMN documents.vision_error IS 'Error message if vision processing failed';
COMMENT ON COLUMN documents.vision_sheets_processed IS 'Number of sheets/pages processed by vision';
COMMENT ON COLUMN documents.vision_quantities_extracted IS 'Number of quantities extracted from vision analysis';
COMMENT ON COLUMN documents.vision_cost_usd IS 'Cost of vision processing in USD';

-- Create view for document processing status
CREATE OR REPLACE VIEW document_processing_status AS
SELECT
    d.id,
    d.filename,
    d.project_id,
    d.processing_status as text_processing_status,
    d.vision_status,
    d.created_at as uploaded_at,
    d.vision_processed_at,
    d.vision_sheets_processed,
    d.vision_quantities_extracted,
    d.vision_cost_usd,
    CASE
        WHEN d.processing_status = 'completed' AND d.vision_status = 'completed' THEN 'fully_processed'
        WHEN d.processing_status = 'completed' AND d.vision_status IN ('pending', 'processing') THEN 'text_only'
        WHEN d.processing_status = 'failed' OR d.vision_status = 'failed' THEN 'failed'
        ELSE 'processing'
    END as overall_status
FROM documents d;

COMMENT ON VIEW document_processing_status IS 'Consolidated view of document text and vision processing status';

-- Grant select on view
GRANT SELECT ON document_processing_status TO authenticated;
