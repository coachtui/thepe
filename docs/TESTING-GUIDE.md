# Smart RAG System - Testing Guide

## Quick Start Testing

### Prerequisites

1. **Install dependencies:**
```bash
npm install
```

2. **Run database migration:**
```bash
# Apply the new schema
supabase db push
# Or run manually in Supabase Dashboard
```

3. **Verify environment variables:**
```bash
# Required API keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
LLAMA_CLOUD_API_KEY=llx-...
```

---

## Testing Workflow

### Step 1: Upload & Process a Document

1. **Navigate to your project** in the app
2. **Upload a construction plan PDF** (preferably with a title sheet containing quantity tables)
3. **Wait for standard processing** to complete (~30-60 seconds)
   - This creates embeddings via LlamaParse

### Step 2: Run Vision Processing (Optional but Recommended)

To enable direct quantity lookup, run vision analysis on critical sheets:

```typescript
// You can add this as an API endpoint or run via Node script
import { processDocumentWithVision } from '@/lib/processing/vision-processor'

const result = await processDocumentWithVision(
  'document-id-here',
  'project-id-here',
  {
    maxSheets: 5,
    extractQuantities: true
  }
)

console.log(`Processed ${result.sheetsProcessed} sheets`)
console.log(`Extracted ${result.quantitiesExtracted} quantities`)
console.log(`Cost: $${result.totalCost.toFixed(4)}`)
```

**Expected output:**
```
[Vision Processor] PDF has 30 pages
[Vision Processor] Will process 5 sheets: [1, 2, 3, ...]
[Vision Processor] Processing page 1...
[Vision Processor] Analysis complete. Cost: $0.0042
[Vision Processor] Found 8 quantities
[Vision Processor] Stored 8 quantities
...
Processed 5 sheets
Extracted 24 quantities
Cost: $0.0210
```

### Step 3: Test Different Query Types

Navigate to the chat interface and test these queries:

#### ✅ Test 1: Quantity Query (Direct Lookup)

**Query:** "What is the total length of waterline A?"

**Expected Behavior:**
- Classification: `quantity`
- Method: `hybrid` (direct + vector) or `direct_only`
- Response includes exact number from title sheet
- Cites source: "Sheet C-001" or similar

**Sample Response:**
```
Per the Quantity Summary on Sheet C-001, Water Line A is 2,450 LF total.
```

**Check Logs:**
```
[Smart Router] Query classification: { type: 'quantity', confidence: 0.9, itemName: 'waterline A' }
[Smart Router] Attempting direct quantity lookup...
[Smart Router] Direct lookup successful: Water Line A: 2,450 LF
[Smart Router] Routing complete: { method: 'hybrid', totalResults: 6 }
```

---

#### ✅ Test 2: Location Query (Station-Aware Search)

**Query:** "What's at station 15+00?"

**Expected Behavior:**
- Classification: `location`
- Method: `vector_only`
- Station boost applied (+0.1 to +0.2 to nearby chunks)
- Response references plan view

**Sample Response:**
```
At Station 15+00, the plan shows Water Line A crossing under Main Street.
Per Sheet C-003 (Plan View), the waterline is 8-inch PVC at this location.
```

**Check Logs:**
```
[Smart Router] Query classification: { type: 'location', station: '15+00' }
[Smart Router] Performing station-aware vector search...
[Station-Aware Search] Found 5 chunks near station 15+00
[Smart Router] Routing complete: { method: 'vector_only', avgBoost: 0.15 }
```

---

#### ✅ Test 3: Specification Query

**Query:** "What is the bedding material requirement for water line?"

**Expected Behavior:**
- Classification: `specification`
- Method: `vector_only`
- Prefers summary/legend sheets
- Cites specific requirement

**Sample Response:**
```
Per the General Notes on Sheet C-001, water line bedding shall be Class 2
aggregate base, 6 inches minimum thickness, compacted to 95% relative compaction.
```

---

#### ✅ Test 4: Detail Query

**Query:** "Show me detail 3 from sheet C-003"

**Expected Behavior:**
- Classification: `detail` or `reference`
- Method: `vector_only`
- Finds detail callout or description

---

#### ✅ Test 5: General Query

**Query:** "What are the main water lines in this project?"

**Expected Behavior:**
- Classification: `general`
- Method: `hybrid` or `vector_only`
- Summarizes multiple sources

---

## Validation Checklist

After testing, verify:

### ✅ Query Classification
- [ ] Quantity queries correctly identified
- [ ] Location queries detected with station extraction
- [ ] Item names extracted properly ("waterline A", "storm drain B")

### ✅ Direct Lookup
- [ ] Quantities found in database
- [ ] Fuzzy matching works ("waterline a" → "Water Line A")
- [ ] High confidence matches preferred (>0.7)
- [ ] Correct source citation (sheet number)

### ✅ Vector Search
- [ ] Relevant chunks returned
- [ ] Station boosting applied (check logs)
- [ ] Sheet type preferences working
- [ ] Critical sheets boosted

### ✅ Response Quality
- [ ] Answers cite sources clearly
- [ ] Sheet numbers included in citations
- [ ] No hallucination (only uses provided context)
- [ ] Concise and accurate

### ✅ Performance
- [ ] Response time < 3 seconds
- [ ] No timeout errors
- [ ] Query classification < 100ms
- [ ] Direct lookup < 200ms

### ✅ Analytics
- [ ] Queries logged to `query_analytics` table
- [ ] Method tracked (direct_only, vector_only, hybrid)
- [ ] Latency recorded
- [ ] Query type stored

---

## Database Checks

### Check Quantity Extraction

```sql
-- View extracted quantities
SELECT
  item_name,
  quantity,
  unit,
  sheet_number,
  confidence,
  source_type
FROM project_quantities
WHERE project_id = 'YOUR_PROJECT_ID'
ORDER BY confidence DESC;
```

**Expected:** 10-30 quantities per document (if title sheet has quantity table)

---

### Check Vision Processing

```sql
-- Check chunks with vision data
SELECT
  sheet_type,
  is_critical_sheet,
  array_length(stations, 1) as station_count,
  jsonb_array_length(extracted_quantities) as quantity_count,
  COUNT(*) as chunk_count
FROM document_chunks
WHERE project_id = 'YOUR_PROJECT_ID'
  AND vision_data IS NOT NULL
GROUP BY sheet_type, is_critical_sheet;
```

**Expected:** 3-5 critical sheets processed

---

### Check Query Analytics

```sql
-- View query statistics
SELECT
  query_type,
  response_method,
  COUNT(*) as query_count,
  ROUND(AVG(latency_ms)) as avg_latency_ms,
  ROUND(AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) * 100, 1) as success_rate_pct
FROM query_analytics
WHERE project_id = 'YOUR_PROJECT_ID'
GROUP BY query_type, response_method
ORDER BY query_count DESC;
```

**Expected:**
| query_type | response_method | query_count | avg_latency_ms | success_rate_pct |
|------------|----------------|-------------|----------------|------------------|
| quantity   | hybrid         | 5           | 1800           | 100.0            |
| location   | vector_only    | 3           | 1500           | 100.0            |
| specification | vector_only | 2           | 1600           | 100.0            |

---

## Troubleshooting

### Problem: "No relevant context found"

**Diagnosis:**
```sql
-- Check if document has chunks
SELECT COUNT(*) FROM document_chunks
WHERE document_id = 'YOUR_DOC_ID';

-- Check if embeddings exist
SELECT COUNT(*) FROM document_embeddings de
JOIN document_chunks dc ON de.chunk_id = dc.id
WHERE dc.document_id = 'YOUR_DOC_ID';
```

**Solution:** Re-run document processing

---

### Problem: Direct lookup not working

**Diagnosis:**
```sql
-- Check if quantities exist
SELECT COUNT(*) FROM project_quantities
WHERE project_id = 'YOUR_PROJECT_ID';
```

**Solution:** Run vision processing to extract quantities

---

### Problem: Incorrect quantity returned

**Diagnosis:**
```sql
-- Check fuzzy match results
SELECT * FROM search_quantities(
  'YOUR_PROJECT_ID',
  'waterline a',
  10
);
```

**Solution:**
- Verify item_name in database matches query
- Check confidence and similarity scores
- May need to adjust fuzzy matching threshold

---

### Problem: Station boosting not working

**Diagnosis:**
```sql
-- Check if stations are populated
SELECT
  id,
  page_number,
  stations,
  sheet_type
FROM document_chunks
WHERE project_id = 'YOUR_PROJECT_ID'
  AND stations IS NOT NULL;
```

**Solution:** Run vision processing to extract stations

---

## Performance Benchmarks

Based on testing with a typical 30-page civil construction plan:

| Operation | Target | Typical | Notes |
|-----------|--------|---------|-------|
| Document upload | < 5s | 2-3s | Depends on file size |
| LlamaParse processing | < 90s | 45-60s | For 30-page PDF |
| Vision processing (5 sheets) | < 60s | 40-50s | $0.02 cost |
| Query classification | < 100ms | 30-50ms | Regex + simple logic |
| Direct quantity lookup | < 200ms | 80-120ms | SQL fuzzy search |
| Vector search | < 1000ms | 400-600ms | Embedding + pgvector |
| **Total chat response** | **< 3s** | **1.5-2.5s** | End-to-end |

---

## Success Metrics

After testing 20-30 queries of various types:

**Target Accuracy:**
- Quantity queries: 90%+ exact matches
- Location queries: 85%+ relevant responses
- Specification queries: 90%+ correct citations
- Overall user satisfaction: 85%+

**Target Performance:**
- 95%+ queries complete in < 3 seconds
- 99%+ queries complete in < 5 seconds
- Zero timeouts

**Target Cost:**
- Vision processing: $0.02-$0.06 per document (one-time)
- Chat queries: $0.002-$0.005 per query
- **Monthly cost (100 docs, 1000 queries): ~$10-15**

---

## Next Steps After Testing

1. **Tune thresholds** based on results:
   - Similarity threshold (currently 0.2 for quantities, 0.3 for general)
   - Boost factors (currently 0.2 station, 0.3 sheet type, 0.15 critical)
   - Confidence minimums (currently 0.7)

2. **Add monitoring:**
   - Dashboard for query analytics
   - Alert on low success rates
   - Cost tracking by project

3. **Improve based on failures:**
   - Log failed queries
   - Identify patterns
   - Add query expansions or synonyms

4. **Expand coverage:**
   - Process more sheets with vision (if budget allows)
   - Add more query types (e.g., cost, schedule)
   - Cross-reference tracking

---

## Test Data Recommendations

For best testing results, use construction plans with:

✅ **Title sheet** with quantity summary table
✅ **Plan sheets** with station callouts
✅ **General notes** with specifications
✅ **Detail sheets** with construction details
✅ **Legend/symbols** sheet

Ideal test document: **Civil site plan set (C-sheets) for a utility project**

---

## Support

If you encounter issues:

1. Check this testing guide
2. Review [SMART-RAG-IMPLEMENTATION.md](./SMART-RAG-IMPLEMENTATION.md)
3. Examine database logs (query_analytics table)
4. Check application logs for error messages
5. Verify all dependencies installed correctly

**Remember:** The system learns from usage. The more you test, the better you can tune the parameters!
