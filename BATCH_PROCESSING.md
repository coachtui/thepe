# Batch Vision Processing System

Complete documentation for the scalable batch vision processing system that handles construction plan sets of 500-5,000+ pages.

## Overview

The batch processing system automatically chunks large PDF documents and processes them in parallel using Claude Haiku 4.5 vision, coordinated by Inngest for reliable background job orchestration.

### Key Features

- ✅ **Automatic Routing:** Documents >200 pages automatically use batch processing
- ✅ **Parallel Processing:** 5 concurrent chunks for 5x faster processing
- ✅ **Cost-Effective:** ~$4.80 for 5,000 pages using Claude Haiku 4.5
- ✅ **Reliable:** Auto-retries, error recovery, and progress tracking
- ✅ **Scalable:** Handles documents from 200 to 5,000+ pages

### Performance

| Document Size | Chunks | Processing Time | Cost (Est.) |
|---------------|--------|-----------------|-------------|
| 500 pages     | 10     | ~20 minutes     | $0.48       |
| 1,000 pages   | 20     | ~40 minutes     | $0.96       |
| 2,500 pages   | 50     | ~100 minutes    | $2.40       |
| 5,000 pages   | 100    | ~200 minutes    | $4.80       |

## Setup Instructions

### 1. Apply Database Migration

The migration creates 3 new tables for job orchestration.

**Option A: Supabase CLI (Recommended)**
```bash
supabase migration up
```

**Option B: Supabase Dashboard**
1. Go to https://app.supabase.com/project/YOUR_PROJECT/editor
2. Navigate to SQL Editor
3. Copy contents of `supabase/migrations/00036_add_vision_batch_processing.sql`
4. Run the migration

**Option C: Direct SQL**
```bash
psql -h YOUR_HOST -U postgres -d YOUR_DB -f supabase/migrations/00036_add_vision_batch_processing.sql
```

**Verify Migration:**
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE 'vision_%';

-- Should return:
-- vision_processing_jobs
-- vision_processing_chunks
-- vision_job_events
```

### 2. Set Up Inngest

#### Development Setup (Local)

1. **Install Inngest Dev Server:**
   ```bash
   npx inngest-cli@latest dev
   ```

2. **Update `.env.local`:**
   ```bash
   # Inngest (optional in development)
   INNGEST_EVENT_KEY=    # Leave empty for local dev
   INNGEST_SIGNING_KEY=  # Leave empty for local dev

   # Site URL for internal API calls
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

3. **Start your Next.js app:**
   ```bash
   npm run dev
   ```

4. **Open Inngest Dev Server:**
   - Navigate to http://localhost:8288
   - You should see your registered functions:
     - `vision-batch-processor`
     - `vision-chunk-processor`
     - `vision-job-completion-handler`
     - `vision-chunk-failure-handler`

#### Production Setup

1. **Create Inngest Account:**
   - Go to https://app.inngest.com/
   - Create a new project: "Construction Plan Processor"

2. **Get API Keys:**
   - Navigate to Settings → Keys
   - Copy your Event Key and Signing Key

3. **Update Production Environment Variables:**
   ```bash
   # In your hosting platform (Vercel, Railway, etc.)
   INNGEST_EVENT_KEY=your-production-event-key
   INNGEST_SIGNING_KEY=your-production-signing-key
   NEXT_PUBLIC_SITE_URL=https://your-domain.com
   ```

4. **Register Webhook:**
   - Inngest will automatically discover your functions at:
     `https://your-domain.com/api/inngest`

### 3. Verify Setup

Run these checks to ensure everything is configured correctly:

**Check 1: Database Tables**
```sql
SELECT COUNT(*) FROM vision_processing_jobs;
-- Should return 0 (empty, but table exists)
```

**Check 2: Inngest Functions**
```bash
# With Inngest Dev Server running
curl http://localhost:8288/functions
# Should show your 4 registered functions
```

**Check 3: API Endpoint**
```bash
# Check batch-vision endpoint exists
curl http://localhost:3000/api/inngest
# Should return 200 OK or 405 Method Not Allowed (both are good)
```

**Check 4: Inngest Client Status**
```typescript
// In your app or Node REPL
import { isInngestConfigured, getInngestStatus } from '@/inngest/client';

console.log('Configured:', isInngestConfigured());
console.log('Status:', getInngestStatus());
// Should show: configured: true, environment: 'development'
```

## Usage

### Automatic Processing (Recommended)

When a user uploads a PDF:

1. **Small documents (≤200 pages):**
   - Uses existing fire-and-forget processing
   - Completes in 5-20 minutes
   - No change to user experience

2. **Large documents (>200 pages):**
   - Automatically routes to batch processing
   - Returns immediately with job ID
   - Processes in background with progress tracking

### Manual Triggering (API)

You can also manually trigger batch processing:

```bash
# Start batch processing
curl -X POST http://localhost:3000/api/documents/{documentId}/batch-vision \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "uuid-here",
    "chunkSize": 50,
    "maxParallel": 5
  }'

# Response:
{
  "success": true,
  "jobId": "uuid-here",
  "status": "processing",
  "estimate": {
    "totalPages": 5000,
    "totalChunks": 100,
    "estimatedCostUsd": 4.80,
    "estimatedTimeMinutes": 200,
    "confirmationLevel": "confirmation"
  }
}
```

### Monitoring Progress

**Option 1: Polling**
```bash
# Get job status
curl http://localhost:3000/api/documents/{documentId}/batch-vision/{jobId}

# Response:
{
  "success": true,
  "job": {
    "id": "uuid",
    "status": "processing",
    "progress": {
      "percentComplete": 45,
      "chunksCompleted": 45,
      "totalChunks": 100,
      "estimatedTimeRemaining": 55
    },
    "results": {
      "pagesProcessed": 2250,
      "quantitiesFound": 487,
      "totalCostUsd": 2.16
    }
  }
}
```

**Option 2: Inngest Dev Server**
- Open http://localhost:8288
- View running jobs and their progress in real-time
- See detailed logs and event history

**Option 3: Database Query**
```sql
-- Get job status
SELECT
  id,
  status,
  chunks_completed,
  total_chunks,
  ROUND((chunks_completed::NUMERIC / total_chunks) * 100) as percent_complete,
  pages_processed,
  quantities_extracted,
  total_cost_usd
FROM vision_processing_jobs
WHERE document_id = 'your-document-id'
ORDER BY created_at DESC
LIMIT 1;

-- Get chunk breakdown
SELECT
  chunk_index,
  status,
  page_start,
  page_end,
  pages_processed,
  quantities_found,
  cost_usd,
  processing_time_ms,
  error_message
FROM vision_processing_chunks
WHERE job_id = 'your-job-id'
ORDER BY chunk_index;
```

### Canceling Jobs

```bash
curl -X POST http://localhost:3000/api/documents/{documentId}/batch-vision/{jobId} \
  -H "Content-Type: application/json" \
  -d '{"action": "cancel"}'
```

## Testing

### Test 1: Small Document (Sanity Check)

Test that existing processing still works for small documents:

```bash
# Upload a PDF with <200 pages
# Should use existing fire-and-forget processing
# Check: documents.vision_status should be 'completed' after processing
```

### Test 2: Batch Processing (Manual)

Test batch processing with a medium-sized document:

```bash
# 1. Upload a 200-300 page PDF
# 2. Manually trigger batch processing:
curl -X POST http://localhost:3000/api/documents/{documentId}/batch-vision \
  -H "Content-Type: application/json" \
  -d '{"projectId": "uuid", "chunkSize": 25, "maxParallel": 3}'

# 3. Monitor in Inngest Dev Server (http://localhost:8288)
# 4. Check database for results
```

### Test 3: Automatic Routing

Test that large documents automatically use batch processing:

```bash
# 1. Upload a PDF with >200 pages
# 2. Wait for text processing to complete
# 3. Check that batch processing is triggered automatically
# 4. Verify in database:

SELECT
  d.id,
  d.filename,
  d.vision_status,
  j.id as job_id,
  j.status as job_status,
  j.chunks_completed,
  j.total_chunks
FROM documents d
LEFT JOIN vision_processing_jobs j ON j.document_id = d.id
WHERE d.id = 'your-document-id';
```

### Test 4: Error Handling

Test that errors are handled gracefully:

```bash
# Test case 1: Invalid document ID
curl -X POST http://localhost:3000/api/documents/invalid-id/batch-vision \
  -H "Content-Type: application/json" \
  -d '{"projectId": "uuid"}'
# Should return 404

# Test case 2: Already processing
# Upload document, start batch processing twice quickly
# Second call should return 409 Conflict

# Test case 3: Chunk failure simulation
# (This requires temporarily breaking the vision API or using a corrupted PDF)
# Verify that failed chunks are retried 3 times, then marked as failed
# Job should continue processing remaining chunks
```

## Troubleshooting

### Issue: Functions Not Showing in Inngest Dev Server

**Solution:**
```bash
# 1. Restart Inngest Dev Server
pkill -f inngest
npx inngest-cli@latest dev

# 2. Restart Next.js
npm run dev

# 3. Check logs for registration errors
# 4. Verify endpoint is accessible: curl http://localhost:3000/api/inngest
```

### Issue: Jobs Stuck in "Processing"

**Symptoms:** Job never completes, chunks remain "pending"

**Diagnosis:**
```sql
-- Check chunk status
SELECT status, COUNT(*)
FROM vision_processing_chunks
WHERE job_id = 'your-job-id'
GROUP BY status;

-- Check if chunks are being processed
SELECT * FROM vision_processing_chunks
WHERE job_id = 'your-job-id'
AND status = 'processing'
AND started_at < NOW() - INTERVAL '30 minutes';
```

**Solution:**
1. Check Inngest Dev Server logs for errors
2. Verify Anthropic API key is valid
3. Check rate limits on Claude API
4. Restart job with fewer parallel chunks:
   ```bash
   # Cancel existing job
   curl -X POST .../batch-vision/{jobId} -d '{"action":"cancel"}'

   # Start new job with maxParallel: 2
   curl -X POST .../batch-vision -d '{"projectId":"...", "maxParallel":2}'
   ```

### Issue: High Costs

**Symptoms:** Costs higher than estimated

**Diagnosis:**
```sql
-- Check actual costs per chunk
SELECT
  AVG(cost_usd) as avg_cost_per_chunk,
  SUM(cost_usd) as total_cost,
  COUNT(*) as chunks_processed
FROM vision_processing_chunks
WHERE job_id = 'your-job-id'
AND status = 'completed';

-- Compare to estimate
SELECT metadata->'costEstimate' as estimated_cost
FROM vision_processing_jobs
WHERE id = 'your-job-id';
```

**Solution:**
1. Verify using Claude Haiku 4.5 (not Sonnet or Opus)
2. Reduce image scale in `vision-processor.ts` (from 2.0 to 1.5)
3. Increase chunk size to reduce API overhead (50 → 100 pages)

### Issue: "Cannot find module '@/inngest/client'"

**Solution:**
```bash
# Restart TypeScript server
# In VS Code: Cmd+Shift+P → "TypeScript: Restart TS Server"

# Or rebuild
rm -rf .next
npm run dev
```

## Architecture Reference

### File Structure
```
src/
├── inngest/
│   ├── client.ts                         # Inngest client config
│   ├── functions/
│   │   ├── vision-batch-processor.ts     # Main orchestrator
│   │   └── vision-chunk-processor.ts     # Chunk worker
│   └── utils/
│       ├── chunking-strategy.ts          # PDF splitting logic
│       └── cost-estimator.ts             # Cost calculations
├── lib/
│   ├── batch-processing/
│   │   ├── job-manager.ts                # Job CRUD operations
│   │   └── chunk-manager.ts              # Chunk CRUD operations
│   ├── processing/
│   │   └── vision-processor.ts           # Vision analysis (refactored)
│   └── vision/
│       └── auto-process.ts               # Auto-routing logic
└── app/api/
    ├── inngest/route.ts                  # Inngest webhook
    └── documents/[id]/batch-vision/
        ├── route.ts                      # Start/list jobs
        └── [jobId]/route.ts              # Job status/cancel
```

### Event Flow
```
1. User uploads PDF
   ↓
2. Text processing completes
   ↓
3. auto-process.ts checks page count
   ↓
4. If >200 pages: POST /api/documents/{id}/batch-vision
   ↓
5. API creates job & chunks, sends 'vision/batch.started' event
   ↓
6. visionBatchProcessor receives event
   ↓
7. For each batch of 5 chunks:
   - Send 5 'vision/chunk.process' events
   - Wait for 5 'vision/chunk.completed' events
   - Update progress
   ↓
8. visionChunkProcessor processes each chunk:
   - Download PDF
   - Process pages 1-50 with Claude Vision
   - Store results in database
   - Emit 'vision/chunk.completed'
   ↓
9. After all batches: 'vision/batch.completed' event
   ↓
10. visionJobCompletionHandler sends notification
```

## Cost Optimization Tips

1. **Adjust chunk size for your workload:**
   - Smaller chunks (25-50 pages): Faster start, more API overhead
   - Larger chunks (75-100 pages): Slower start, less API overhead

2. **Use appropriate parallelism:**
   - Start with `maxParallel: 5` (recommended)
   - Reduce to `maxParallel: 2-3` if hitting rate limits
   - Increase to `maxParallel: 10` if you have high rate limits

3. **Optimize image quality:**
   ```typescript
   // In vision-processor.ts, reduce scale for lower costs
   const image = await convertPdfPageToImage(pdfBuffer, pageNumber, {
     scale: 1.5,  // Instead of 2.0 (saves ~30% on vision costs)
     maxWidth: 2048,
     maxHeight: 2048,
   });
   ```

4. **Monitor actual vs estimated costs:**
   ```sql
   SELECT
     j.id,
     j.metadata->>'costEstimate' as estimated,
     j.total_cost_usd as actual,
     j.total_cost_usd - (j.metadata->>'costEstimate')::NUMERIC as difference
   FROM vision_processing_jobs j
   WHERE j.status = 'completed'
   ORDER BY j.created_at DESC
   LIMIT 10;
   ```

## Support

For issues or questions:
1. Check Inngest Dev Server logs: http://localhost:8288
2. Check database: `SELECT * FROM vision_processing_jobs ORDER BY created_at DESC LIMIT 5`
3. Enable debug logging: `DEBUG=vision,inngest npm run dev`
4. Review plan file: `/Users/tui/.claude/plans/parallel-wandering-thacker.md`
