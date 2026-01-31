# Phase 2 Testing Guide - Document Processing Pipeline

> **Status:** Ready for testing
> **Date:** 2026-01-28
> **Phase:** Phase 2 - Document Management & RAG (Week 3 of 31)

---

## What We Just Implemented

✅ **DocumentSearch component integrated** into project detail page
- Shows search UI when documents exist
- Full semantic search with OpenAI embeddings
- Beautiful results display with similarity scores

---

## Prerequisites

### 1. Verify Environment Variables

Check your `.env.local` has these keys:

```bash
# Already configured ✅
OPENAI_API_KEY=sk-proj-...        # For embeddings
ANTHROPIC_API_KEY=sk-ant-...      # For future Phase 3
LLAMA_CLOUD_API_KEY=llx-...       # For document parsing
NEXT_PUBLIC_SUPABASE_URL=...      # Supabase connection
NEXT_PUBLIC_SUPABASE_ANON_KEY=... # Supabase auth
```

### 2. Start Development Server

```bash
npm run dev
# → http://localhost:3000
```

---

## Phase 2 End-to-End Testing Checklist

### Test 1: Document Upload ✅ (Already Working)

1. Navigate to http://localhost:3000
2. Sign in to your account
3. Go to Projects page
4. Click on a project (or create a new one)
5. In the Documents section, upload a PDF file
6. ✅ **Expected:** File uploads successfully, appears in document list

### Test 2: Document Processing Pipeline ⏳ (Needs Testing)

**What happens behind the scenes:**
1. File uploads to Supabase Storage
2. Document record created with status: `pending`
3. Processing API endpoint is called
4. LlamaParse extracts text from PDF
5. Text is chunked into 1000-char pieces with 200-char overlap
6. OpenAI generates embeddings for each chunk
7. Chunks and embeddings stored in database
8. Document status updated to: `completed`

**How to test:**

1. After uploading a document, check the browser console (F12)
2. You should see processing starting automatically
3. Watch for these console logs:
   - "Parsing document {id} with LlamaParse..."
   - "Chunking document {id}..."
   - "Created X chunks"
   - "Generating embeddings for X chunks..."
   - "Storing X embeddings..."
   - "Document {id} processed successfully"

4. **Check in Supabase Dashboard:**
   - Go to: https://supabase.com/dashboard/project/frhzemhbgcjjprfxgmgq
   - Table Editor → `documents` → Find your document
   - ✅ `processing_status` should be `completed`
   - ✅ `page_count` should be populated

   - Table Editor → `document_chunks` → Filter by your `document_id`
   - ✅ Should see multiple rows (one per chunk)
   - ✅ Each has `content`, `chunk_index`, `page_number`

   - Table Editor → `document_embeddings` → Join to chunks
   - ✅ Should see embeddings (1536-dimensional vectors)
   - ✅ Each embedding linked to a chunk via `chunk_id`

### Test 3: Semantic Search 🆕 (Ready to Test)

**What the search does:**
1. Takes your natural language query
2. Generates embedding for the query using OpenAI
3. Searches for similar embeddings using pgvector
4. Returns relevant document chunks with similarity scores
5. Displays results with source document and page number

**How to test:**

1. Upload at least one document and wait for processing to complete
2. Scroll to the "Search Documents" section on the project page
3. Enter a natural language query, e.g.:
   - "What are the concrete specifications?"
   - "Fire safety requirements"
   - "Schedule milestones"
   - "Electrical system details"
4. Click "Search"
5. ✅ **Expected Results:**
   - Shows "X results found"
   - Each result displays:
     - Document filename
     - Page number and chunk index
     - Similarity percentage (e.g., "85.2% match")
     - Text excerpt from the document
     - "View in document" button
6. ✅ **Expected Behavior:**
   - Results are ranked by relevance
   - Higher similarity scores appear first
   - Content is relevant to your query

### Test 4: Error Handling

**Test unsupported file types:**
1. Try uploading a .txt file or .jpg
2. ✅ **Expected:** Should fail gracefully with error message

**Test with no API keys:**
1. Temporarily remove `OPENAI_API_KEY` from `.env.local`
2. Restart dev server
3. Try to search
4. ✅ **Expected:** Should show error message

---

## Troubleshooting

### Issue: Document stuck in "processing" status

**Check:**
1. Browser console for error messages
2. Terminal running `npm run dev` for API errors
3. Supabase logs in dashboard

**Common causes:**
- LlamaParse API key invalid or expired
- OpenAI API key invalid or rate limited
- PDF is password-protected or corrupted
- File is too large (>50MB)

**Fix:**
- Manually update document status in Supabase:
  ```sql
  UPDATE documents
  SET processing_status = 'failed'
  WHERE id = 'YOUR_DOCUMENT_ID';
  ```
- Try uploading again

### Issue: Search returns no results

**Check:**
1. Document status is `completed` (not `pending` or `processing`)
2. `document_chunks` table has entries for your document
3. `document_embeddings` table has embeddings
4. Your search query is relevant to document content

**Debug:**
- Try a very generic search like "the" or "and" to see if ANY results return
- Check similarity threshold (default 0.5 = 50% match)
- Lower threshold in search API if needed

### Issue: "Unauthorized" error

**Check:**
1. You're logged in (check `/sign-in`)
2. You're a member of the project
3. Session hasn't expired (try refreshing page)

---

## API Endpoints

### POST /api/documents/process

Processes a document: parses, chunks, generates embeddings

**Request:**
```json
{
  "documentId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "documentId": "uuid",
  "chunks": 25,
  "pageCount": 5
}
```

### POST /api/documents/search

Searches documents using semantic similarity

**Request:**
```json
{
  "queryEmbedding": [0.123, 0.456, ...], // 1536-dim array
  "projectId": "uuid",
  "limit": 10,
  "similarityThreshold": 0.5
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "chunk_id": "uuid",
      "document_id": "uuid",
      "chunk_index": 0,
      "content": "Text content...",
      "page_number": 1,
      "similarity": 0.856,
      "document_filename": "specs.pdf",
      "project_id": "uuid"
    }
  ],
  "count": 5
}
```

---

## Database Queries for Verification

### Check document processing status

```sql
SELECT
  id,
  filename,
  processing_status,
  page_count,
  created_at,
  updated_at
FROM documents
WHERE project_id = 'YOUR_PROJECT_ID'
ORDER BY created_at DESC;
```

### Check chunks created

```sql
SELECT
  d.filename,
  COUNT(dc.id) as chunk_count,
  AVG(LENGTH(dc.content)) as avg_chunk_size
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.project_id = 'YOUR_PROJECT_ID'
GROUP BY d.id, d.filename;
```

### Check embeddings generated

```sql
SELECT
  d.filename,
  COUNT(de.id) as embedding_count,
  de.model_version
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
LEFT JOIN document_embeddings de ON dc.id = de.chunk_id
WHERE d.project_id = 'YOUR_PROJECT_ID'
GROUP BY d.id, d.filename, de.model_version;
```

### Test vector search directly in SQL

```sql
-- First, get an embedding (use the one from a recent search)
-- Then run similarity search
SELECT
  dc.content,
  d.filename,
  dc.page_number,
  1 - (de.embedding <=> '[YOUR_EMBEDDING_VECTOR]'::vector) as similarity
FROM document_embeddings de
JOIN document_chunks dc ON de.chunk_id = dc.id
JOIN documents d ON dc.document_id = d.id
WHERE d.project_id = 'YOUR_PROJECT_ID'
ORDER BY de.embedding <=> '[YOUR_EMBEDDING_VECTOR]'::vector
LIMIT 10;
```

---

## Success Criteria for Phase 2

Phase 2 is **COMPLETE** when all these work:

- ✅ Users can upload PDF documents to projects
- ✅ Documents are automatically parsed with LlamaParse
- ✅ Text is chunked intelligently (preserving sentences)
- ✅ Embeddings are generated with OpenAI
- ✅ Embeddings stored in pgvector database
- ✅ Semantic search returns relevant results
- ✅ Search results show source document and page number
- ✅ Search UI is integrated into project page
- ✅ Error handling works for failed uploads/processing

---

## What's Next: Phase 3 Preview

After Phase 2 testing is complete, we move to **Phase 3: Basic Q&A (4 weeks)**

**Phase 3 Goals:**
- Chat interface with Claude AI
- Context-aware responses using RAG
- Streaming responses for better UX
- Source citations in answers
- Query history tracking

**Estimated Start:** 2026-02-03 (2-3 days from now)

---

## Quick Test Commands

```bash
# Start dev server
npm run dev

# Run TypeScript checks
npx tsc --noEmit

# Build for production
npm run build

# Check Supabase connection
curl http://localhost:3000/api/test-rls
```

---

## Resources

- **Supabase Dashboard:** https://supabase.com/dashboard/project/frhzemhbgcjjprfxgmgq
- **LlamaParse Docs:** https://docs.llamaindex.ai/en/stable/llama_cloud/llama_parse/
- **OpenAI Embeddings:** https://platform.openai.com/docs/guides/embeddings
- **pgvector Guide:** https://github.com/pgvector/pgvector

---

**Happy Testing! 🚀**

If you encounter issues, check:
1. Browser console (F12)
2. Terminal logs (`npm run dev`)
3. Supabase logs (Dashboard → Logs)
4. This testing guide's troubleshooting section
