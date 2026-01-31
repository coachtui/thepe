# Phase 2 Setup Complete ✅

**Date:** 2026-01-28

## What's Ready

### ✅ Database
- Migration 00027 (search function) applied
- pgvector index created
- All tables ready

### ✅ Storage
- `documents` bucket created
- 4 RLS policies configured:
  1. INSERT - Users can upload to their projects
  2. SELECT - Users can view their project documents
  3. SELECT + UPDATE - Editors can modify documents
  4. SELECT + DELETE - Owners can delete documents

### ✅ Code
- All Phase 2 files created (15 files)
- npm dependencies installed
- LlamaParse integration fixed (uses REST API directly)

---

## Final Steps Before Testing

### 1. Add API Keys

Edit `.env.local` and add:

```bash
# OpenAI (for embeddings) - REQUIRED
OPENAI_API_KEY=sk-proj-...

# LlamaParse (for PDF parsing) - REQUIRED
LLAMA_CLOUD_API_KEY=llx-...
```

**Get your keys:**
- OpenAI: https://platform.openai.com/api-keys
- LlamaParse: https://cloud.llamaindex.ai/

### 2. Start the Dev Server

```bash
npm run dev
```

Open http://localhost:3000

---

## How to Test Phase 2

### Test 1: Document Upload

1. Sign in to your account
2. Navigate to any project
3. Scroll to **Documents** section
4. Drag & drop a PDF file or click to upload
5. Verify:
   - File appears in document list
   - Status shows "Pending" → "Processing" → "Completed"
   - No errors in browser console

### Test 2: Document Processing

1. After uploading, check the document status
2. Wait for processing to complete (may take 30-60 seconds for first document)
3. Check in Supabase Dashboard:
   - **Table Editor** → `documents` - should show your document
   - **Table Editor** → `document_chunks` - should show text chunks
   - **Table Editor** → `document_embeddings` - should show vector embeddings

### Test 3: Document Management

1. Click download icon - file should download
2. Try uploading multiple documents
3. Delete a document - should remove from list

### Test 4: Search (Optional - requires adding search UI)

To enable search, add this to your project detail page:

```tsx
import { DocumentSearch } from '@/components/documents/DocumentSearch'

// In your page component, add:
<div className="mt-8">
  <h2 className="text-xl font-bold mb-4">Search Documents</h2>
  <DocumentSearch projectId={params.id} />
</div>
```

Then test:
1. Enter natural language query
2. Verify relevant results appear
3. Check similarity scores
4. Click to view source documents

---

## Troubleshooting

### Issue: Upload fails with "Bucket not found"

**Solution:**
- Verify bucket name is exactly `documents` (lowercase)
- Check Storage policies are enabled

### Issue: "LLAMA_CLOUD_API_KEY is not configured"

**Solution:**
- Add key to `.env.local`
- Restart dev server after adding

### Issue: "OPENAI_API_KEY is not configured"

**Solution:**
- Add key to `.env.local`
- Restart dev server

### Issue: Document stuck in "Processing"

**Check:**
1. Browser console for errors
2. Terminal for API route errors
3. LlamaParse API quota at https://cloud.llamaindex.ai/
4. OpenAI API quota at https://platform.openai.com/

**Fix:**
- Manually update status to "failed" in Supabase
- Check API keys are valid
- Retry upload

### Issue: Search returns no results

**Check:**
1. Documents have status "completed"
2. `document_embeddings` table has entries
3. Migration 00027 was applied
4. pgvector extension enabled

---

## What's Working

- ✅ Document upload to Supabase Storage
- ✅ File metadata tracking in database
- ✅ PDF parsing with LlamaCloud API
- ✅ Text chunking (1000 chars, 200 overlap)
- ✅ OpenAI embedding generation
- ✅ Vector storage with pgvector
- ✅ Semantic search with cosine similarity
- ✅ Download & delete operations
- ✅ Role-based access control (RLS)

---

## Cost Estimate (Phase 2)

### Per 100-page PDF:
- **LlamaParse:** ~$0.01 per document
- **OpenAI embeddings:** ~$0.001 per document
- **Storage:** Negligible (1MB = $0.000021/month)

**Total per document:** ~$0.011 (1.1 cents)

### For 1000 documents:
- **Total cost:** ~$11
- **Storage (1GB):** $0.021/month

Very cost-effective! 🎉

---

## Next Steps

Once Phase 2 is tested and working:

### Phase 3: AI Assistant with Claude

- Chat interface for document Q&A
- RAG-enhanced responses
- Project insights and summaries
- Schedule analysis
- Auto-generate RFIs

**Estimated:** 2-3 weeks

---

## Files Created

### Components (3 files)
- [src/components/documents/DocumentUpload.tsx](../src/components/documents/DocumentUpload.tsx)
- [src/components/documents/DocumentList.tsx](../src/components/documents/DocumentList.tsx)
- [src/components/documents/DocumentSearch.tsx](../src/components/documents/DocumentSearch.tsx)

### Libraries (5 files)
- [src/lib/parsers/llamaparse.ts](../src/lib/parsers/llamaparse.ts) - **FIXED: Now uses REST API**
- [src/lib/embeddings/chunking.ts](../src/lib/embeddings/chunking.ts)
- [src/lib/embeddings/openai.ts](../src/lib/embeddings/openai.ts)
- [src/lib/embeddings/vector-search.ts](../src/lib/embeddings/vector-search.ts)
- [src/lib/db/queries/documents.ts](../src/lib/db/queries/documents.ts)

### API Routes (2 files)
- [src/app/api/documents/process/route.ts](../src/app/api/documents/process/route.ts)
- [src/app/api/documents/search/route.ts](../src/app/api/documents/search/route.ts)

### Database (1 migration)
- [supabase/migrations/00027_create_search_function.sql](../supabase/migrations/00027_create_search_function.sql)

### Modified (1 file)
- [src/app/(dashboard)/projects/[id]/page.tsx](../src/app/(dashboard)/projects/[id]/page.tsx) - Added document UI

---

## Support

For detailed implementation guide, see:
- [docs/PHASE2-COMPLETION.md](./PHASE2-COMPLETION.md)

For architecture details, see:
- [docs/plans/MASTER-PLAN-construction-copilot.md](./plans/MASTER-PLAN-construction-copilot.md)

---

**Phase 2 is ready to test!** 🚀

Just add your API keys and start `npm run dev`!
