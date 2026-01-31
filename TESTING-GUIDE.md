# Testing Guide - Smart RAG System

## Quick Start Testing (5 minutes)

### 1. Test Fixed Vector Search

The `search_documents` function parameters have been fixed. Test that queries now work:

```bash
# Start dev server
npm run dev
```

1. **Navigate to your project** with uploaded construction documents
2. **Open the chat interface**
3. **Ask:** "what is the length of waterline a"

**Expected Result:**
- ✅ Query should classify as "quantity" type
- ✅ Vector search should execute successfully (no more PGRST202 error)
- ✅ Should return relevant chunks from documents
- ⚠️ If no vision processing has run, answer will come from vector search only

**Check terminal logs for:**
```
[Smart Router] Query classification: { type: 'quantity', confidence: 0.9, ... }
[Smart Router] Attempting direct quantity lookup...
[Smart Router] Direct lookup found no results  <-- Expected if vision not run
[Smart Router] Performing station-aware vector search...
✅ Success - should see search results, not errors
```

---

## Vision Processing Setup

Vision processing is **optional** but significantly improves quantity query accuracy.

### Option 1: Use the API Endpoint (Recommended)

**A. Via Browser (if you add the button to UI)**

Import the VisionProcessButton component in your document list:

```tsx
// In src/app/(dashboard)/projects/[id]/page.tsx or DocumentList.tsx
import { VisionProcessButton } from '@/components/VisionProcessButton';

// Add to each document row:
<VisionProcessButton
  documentId={document.id}
  projectId={projectId}
  documentName={document.filename}
  onSuccess={() => {
    // Optionally refresh the document list
    console.log('Vision processing complete!');
  }}
/>
```

**B. Via cURL (for testing)**

```bash
# Replace with your actual IDs
DOCUMENT_ID="your-document-id-here"
PROJECT_ID="your-project-id-here"

curl -X POST http://localhost:3000/api/documents/${DOCUMENT_ID}/process-vision \
  -H "Content-Type: application/json" \
  -d "{\"projectId\": \"${PROJECT_ID}\", \"maxSheets\": 5}"
```

**C. Via Browser Console**

Open browser dev tools while on the project page:

```javascript
// Get IDs from the page
const documentId = 'paste-document-id-here';
const projectId = 'paste-project-id-here';

// Trigger vision processing
fetch(`/api/documents/${documentId}/process-vision`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId, maxSheets: 5 })
})
.then(r => r.json())
.then(data => console.log('Result:', data));
```

### Option 2: Use the Test Script

```bash
# Get your document and project IDs from the database or UI
npm install -g tsx  # If not already installed

# Run the script
npx tsx scripts/test-vision-processing.ts <documentId> <projectId>
```

---

## Complete Testing Workflow

### Step 1: Verify Vector Search Fix ✅

Test that the basic query routing works:

**Query:** "what is the length of waterline a"

**Expected Terminal Output:**
```
[Smart Router] Query classification: {
  type: 'quantity',
  confidence: 0.9,
  itemName: 'length of waterline',
  needsDirectLookup: true
}
[Smart Router] Attempting direct quantity lookup...
[Smart Router] Direct lookup found no results
[Smart Router] Performing station-aware vector search...
✅ Vector search completes successfully (no PGRST202 error)
```

**Expected Web App Response:**
- Should return context from construction documents
- Answer will be based on vector search (since no vision data yet)

---

### Step 2: Run Vision Processing (Optional)

Process a document to extract quantities:

**Using cURL:**
```bash
DOCUMENT_ID="abc-123"  # Replace with actual ID
PROJECT_ID="def-456"    # Replace with actual ID

curl -X POST http://localhost:3000/api/documents/${DOCUMENT_ID}/process-vision \
  -H "Content-Type: application/json" \
  -H "Cookie: $(cat .cookies)"  \
  -d "{\"projectId\": \"${PROJECT_ID}\", \"maxSheets\": 5}"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Successfully processed 5 sheets",
  "data": {
    "sheetsProcessed": 5,
    "quantitiesExtracted": 12,
    "totalCost": 0.0234,
    "processingTimeMs": 45000
  }
}
```

**Cost:** ~$0.02-$0.06 per document (5 sheets)

---

### Step 3: Test Direct Quantity Lookup

After vision processing, test the same query again:

**Query:** "what is the length of waterline a"

**Expected Terminal Output:**
```
[Smart Router] Query classification: { type: 'quantity', ... }
[Smart Router] Attempting direct quantity lookup...
[Smart Router] Direct lookup successful: Water Line A: 2,450 LF
✅ Fast response from database (not vector search)
```

**Expected Web App Response:**
- ⚡ Faster response (~1-2 seconds vs 2-3 seconds)
- 📊 Direct answer: "Water Line A: 2,450 LF from Sheet C-001"
- Higher accuracy from structured data

---

## Test Query Types

### 1. Quantity Queries (Direct Lookup)
```
✅ "What is the total length of waterline A?"
✅ "How much storm drain B is there?"
✅ "Total linear feet of 8-inch pipe"
✅ "Quantity of water line A"
```

**Expected:**
- Classification: `quantity`
- Method: `hybrid` or `direct_only` (if vision data exists)
- Fast response with sheet citation

### 2. Location Queries (Station-Aware Search)
```
✅ "Where is the waterline at station 15+00?"
✅ "What's at STA 36+00?"
✅ "Show me the location of storm drain B"
```

**Expected:**
- Classification: `location`
- Method: `vector_only`
- Station proximity boosting applied

### 3. Specification Queries (Vector Search)
```
✅ "What is the bedding material requirement?"
✅ "Pipe size for water line A"
✅ "Backfill specification for trenching"
```

**Expected:**
- Classification: `specification`
- Method: `vector_only`
- Sheet type preference: summary/legend

### 4. Detail Queries (Vector Search)
```
✅ "Show me detail 3/C-003"
✅ "How to install water line connections"
```

**Expected:**
- Classification: `detail`
- Method: `vector_only`
- Sheet type preference: detail

---

## Verify Database Tables

Check that new tables and functions exist:

```sql
-- Connect to Supabase SQL Editor and run:

-- Check tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('project_quantities', 'query_analytics');

-- Expected: 2 rows

-- Check new columns on document_chunks
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'document_chunks'
  AND column_name IN ('vision_data', 'stations', 'sheet_type', 'is_critical_sheet', 'project_id');

-- Expected: 5 rows

-- Check functions
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('search_documents', 'normalize_station', 'search_quantities', 'station_distance');

-- Expected: 4 rows
```

---

## Performance Benchmarks

| Metric | Target | Expected |
|--------|--------|----------|
| Query Classification | < 100ms | ~50ms |
| Direct Quantity Lookup | < 200ms | ~100ms |
| Vector Search | < 1s | ~500ms |
| **Total Response Time** | **< 3s** | **~1.5-2.5s** |

---

## Troubleshooting

### Issue: Still getting PGRST202 error

**Cause:** Old build cached

**Solution:**
```bash
rm -rf .next
npm run build
npm run dev
```

### Issue: Vision processing fails with "Canvas not found"

**Cause:** Native module not installed

**Solution (macOS):**
```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg pixman
npm install canvas
```

**Solution (Linux):**
```bash
sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
npm install canvas
```

### Issue: No quantities extracted

**Possible causes:**
1. Document doesn't have a quantity table on title/summary sheets
2. Quantity table format not recognized by vision
3. Vision processing limited to first 5 sheets (increase `maxSheets`)

**Check:**
```sql
SELECT COUNT(*) FROM project_quantities WHERE project_id = 'your-project-id';
```

If 0, try:
- Process more sheets (`maxSheets: 10`)
- Check if title sheet has a clear quantity table
- Review vision logs for extraction errors

### Issue: Direct lookup not finding quantities

**Cause:** Fuzzy matching threshold too strict

**Check database:**
```sql
SELECT item_name FROM project_quantities WHERE project_id = 'your-project-id';
```

Compare with your query. If names don't match closely, the fuzzy matching may not find them.

---

## Success Criteria

After completing this testing guide:

- ✅ Vector search executes without PGRST202 errors
- ✅ All query types classify correctly
- ✅ Responses include proper source citations
- ✅ Vision processing successfully extracts quantities (if run)
- ✅ Direct quantity lookup returns fast results (if vision data exists)
- ✅ Query analytics logged to database
- ✅ No TypeScript compilation errors
- ✅ Build completes successfully

---

## Next Steps

1. **Add VisionProcessButton to UI** - Import and add to document list for easy vision processing
2. **Test with real construction plans** - Upload actual project documents
3. **Monitor query analytics** - Check `query_analytics` table for performance metrics
4. **Tune thresholds** - Adjust similarity thresholds based on results
5. **Enable auto-processing** - Trigger vision processing automatically after document upload

---

## API Endpoints Added

### POST `/api/documents/[id]/process-vision`
Triggers vision processing on a document

**Request:**
```json
{
  "projectId": "uuid",
  "maxSheets": 5
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sheetsProcessed": 5,
    "quantitiesExtracted": 12,
    "totalCost": 0.0234,
    "processingTimeMs": 45000
  }
}
```

### GET `/api/documents/[id]/process-vision`
Check vision processing status

**Response:**
```json
{
  "documentId": "uuid",
  "filename": "Civil Plans.pdf",
  "visionProcessed": true,
  "sheetsProcessed": 5,
  "quantitiesExtracted": 12,
  "lastProcessedAt": "2026-01-28T10:30:00Z",
  "criticalSheets": 3
}
```

---

## Files Created/Modified

**New Files:**
- ✅ `src/app/api/documents/[id]/process-vision/route.ts` - Vision processing API
- ✅ `src/components/VisionProcessButton.tsx` - UI component for triggering processing
- ✅ `scripts/test-vision-processing.ts` - Command-line test script
- ✅ `TESTING-GUIDE.md` - This file

**Modified Files:**
- ✅ `src/lib/db/supabase/types.ts` - Updated function signatures
- ✅ `src/lib/embeddings/station-aware-search.ts` - Fixed parameter names

---

**Status:** ✅ Ready for Testing
**Last Updated:** 2026-01-28
