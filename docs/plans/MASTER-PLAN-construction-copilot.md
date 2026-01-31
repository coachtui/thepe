# Construction Copilot - Master Plan

> **Document Type:** Master Architecture & Implementation Plan
> **Created:** 2025-01-27
> **Status:** Approved
> **Target:** Solo Founder, 8-month timeline

---

## Executive Summary

**Construction Copilot** - An AI-powered assistant for construction professionals that answers questions about project documents and schedules.

**Core Value Proposition:** "Ask your construction documents anything, get schedule-aware answers."

| Metric | Target |
|--------|--------|
| MVP | 10 weeks |
| Full Launch | 31 weeks (~8 months) |
| Monthly Infrastructure | $100-200 to start |

---

## Part 1: System Architecture

### 1.1 High-Level Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         CONSTRUCTION COPILOT                                │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌─────────────┐    ┌─────────────────────────────────────────────────┐   │
│  │   Client    │    │              API Layer (Next.js)                │   │
│  │  (Web/App)  │───▶│  - Authentication (Supabase Auth)               │   │
│  │             │    │  - File Upload Endpoints                        │   │
│  │  - Voice UI │    │  - Query Endpoints                              │   │
│  │  - Chat UI  │    │  - WebSocket for streaming                      │   │
│  └─────────────┘    └───────────────────┬─────────────────────────────┘   │
│                                         │                                  │
│                     ┌───────────────────▼───────────────────┐              │
│                     │         QUERY ORCHESTRATOR            │              │
│                     │  - Intent classification              │              │
│                     │  - Mode routing (document/schedule)   │              │
│                     │  - Response synthesis                 │              │
│                     └───────────────────┬───────────────────┘              │
│                                         │                                  │
│  ┌──────────────────────────────────────┼──────────────────────────────┐  │
│  │                         MODES (Single Orchestrator)                  │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │  │
│  │  │  Document   │  │  Schedule   │  │   Takeoff   │  │    RFI     │ │  │
│  │  │    Mode     │  │    Mode     │  │    Mode     │  │    Mode    │ │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                         │                                  │
│  ┌────────────────────────────────────▼───────────────────────────────┐  │
│  │                    SUPABASE (PostgreSQL + Storage)                  │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │  │
│  │  │  projects   │  │  documents  │  │  schedule_  │  │  vectors  │ │  │
│  │  │  users      │  │  embeddings │  │  activities │  │  (pgvector)│ │  │
│  │  │  orgs       │  │  chunks     │  │  rfis       │  │           │ │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘ │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend | Next.js 14 (App Router) | SSR, API routes, unified codebase |
| UI | shadcn/ui + Tailwind | Fast development, accessible |
| Backend | Next.js API Routes | Single deployment |
| Database | Supabase (PostgreSQL) | RLS, real-time, storage, auth |
| Vector DB | pgvector (via Supabase) | Native PostgreSQL, no extra service |
| AI/LLM | Claude 3.5 Sonnet | Best reasoning for construction |
| Embeddings | OpenAI text-embedding-ada-002 | Cost-effective |
| Doc Parsing | LlamaParse | $0.003/page, handles tables |
| Voice | Whisper API + Browser TTS | Simple, works |
| Hosting | Vercel + Supabase | Minimal DevOps |

### 1.3 Project Structure

```
construction-copilot/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   ├── (auth)/            # Auth pages
│   ├── (dashboard)/       # Main app
│   └── layout.tsx
├── components/            # UI components
├── lib/
│   ├── orchestrator/     # Single orchestrator with modes
│   ├── db/               # Database utilities
│   ├── embeddings/       # Vector operations
│   └── parsers/          # Document parsers
└── supabase/
    └── migrations/       # Database migrations
```

---

## Part 2: Database Schema

### 2.1 Core Tables

```sql
-- Organizations (multi-tenant)
CREATE TABLE organizations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  subscription_tier text DEFAULT 'starter',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Users
CREATE TABLE users (
  id uuid REFERENCES auth.users(id) PRIMARY KEY,
  email text UNIQUE NOT NULL,
  full_name text,
  role text CHECK (role IN ('admin', 'project_manager', 'superintendent', 'viewer')),
  organization_id uuid REFERENCES organizations(id),
  created_at timestamptz DEFAULT now()
);

-- Projects
CREATE TABLE projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  address text,
  project_number text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'on_hold')),
  start_date date,
  end_date date,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Project Members (access control)
CREATE TABLE project_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role text CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- Documents
CREATE TABLE documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  filename text NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL,
  document_type text,
  sheet_number text,
  discipline text,
  revision text,
  description text,
  page_count integer,
  file_size_bytes bigint,
  processing_status text DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  metadata jsonb DEFAULT '{}',
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Document Chunks (for RAG)
CREATE TABLE document_chunks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  page_number integer,
  chunk_type text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Vector Embeddings
CREATE TABLE document_embeddings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chunk_id uuid REFERENCES document_chunks(id) ON DELETE CASCADE,
  embedding vector(1536),
  model_version text DEFAULT 'text-embedding-ada-002',
  created_at timestamptz DEFAULT now()
);

-- RFIs
CREATE TABLE rfis (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  rfi_number text NOT NULL,
  subject text NOT NULL,
  question text NOT NULL,
  response text,
  status text DEFAULT 'open' CHECK (status IN ('draft', 'open', 'responded', 'closed')),
  priority text DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  due_date date,
  submitted_by uuid REFERENCES users(id),
  assigned_to text,
  related_documents uuid[],
  related_activities uuid[],
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_document_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_document_embeddings_chunk ON document_embeddings(chunk_id);
CREATE INDEX idx_rfis_project ON rfis(project_id);

-- Vector similarity search
CREATE INDEX idx_document_embeddings_vector ON document_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 2.2 Schedule Tables

```sql
-- Schedule Activities
CREATE TABLE schedule_activities (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  activity_id text NOT NULL,
  activity_name text NOT NULL,
  description text,
  early_start date,
  early_finish date,
  late_start date,
  late_finish date,
  actual_start date,
  actual_finish date,
  duration_days integer,
  percent_complete numeric(5,2) DEFAULT 0,
  is_critical boolean DEFAULT false,
  total_float_days integer,
  wbs_code text,
  responsible_party text,
  cost_code text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT chk_dates CHECK (early_start <= early_finish),
  CONSTRAINT chk_percent CHECK (percent_complete >= 0 AND percent_complete <= 100)
);

-- Activity Predecessors
CREATE TABLE activity_predecessors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id uuid REFERENCES schedule_activities(id) ON DELETE CASCADE,
  predecessor_id uuid REFERENCES schedule_activities(id) ON DELETE CASCADE,
  relationship_type text CHECK (relationship_type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Activity-Document Links
CREATE TABLE activity_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id uuid REFERENCES schedule_activities(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  relevance_type text,
  created_at timestamptz DEFAULT now()
);

-- Schedule Indexes
CREATE INDEX idx_schedule_activities_project ON schedule_activities(project_id);
CREATE INDEX idx_schedule_activities_dates ON schedule_activities(early_start, early_finish);
CREATE INDEX idx_schedule_activities_critical ON schedule_activities(is_critical);
```

---

## Part 3: Implementation Phases

### Phase 0: Setup (1 week)
- [ ] Initialize Next.js project with TypeScript
- [ ] Configure Supabase project
- [ ] Set up development environment
- [ ] Deploy base infrastructure to Vercel

### Phase 1: Auth & Projects (2 weeks)
- [ ] Supabase Auth integration
- [ ] Base database schema deployment
- [ ] RLS policies for multi-tenancy
- [ ] Project CRUD operations
- [ ] Basic dashboard UI

### Phase 2: Document Upload (3 weeks)
- [ ] Document upload UI (drag-drop)
- [ ] Supabase Storage integration
- [ ] LlamaParse integration for PDF processing
- [ ] Document chunking logic
- [ ] Embedding generation (OpenAI)
- [ ] Document listing and preview

### Phase 3: Basic Q&A (4 weeks)
- [ ] Vector similarity search
- [ ] Query orchestrator (document mode)
- [ ] Chat UI with streaming responses
- [ ] Source citations
- [ ] Query history tracking

**MVP CHECKPOINT - Week 10**

### Phase 4: Schedule Basic (3 weeks)
- [ ] Schedule database schema
- [ ] CSV/Excel import
- [ ] Basic schedule queries
- [ ] Schedule mode in orchestrator
- [ ] "When is X activity?" queries
- [ ] 2-week lookahead report

### Phase 5: Schedule Advanced (4 weeks)
- [ ] XER import (p6-xer-reader library)
- [ ] Critical path display
- [ ] Activity-document linking (manual)
- [ ] Schedule impact calculations
- [ ] RFI schedule impact

### Phase 6: RFI Generation (3 weeks)
- [ ] RFI mode in orchestrator
- [ ] RFI CRUD operations
- [ ] Auto-generate RFI from question
- [ ] Link to source documents

### Phase 7: Takeoff (4 weeks)
- [ ] Takeoff mode in orchestrator
- [ ] Basic quantity extraction
- [ ] Area/volume calculations
- [ ] Spec reference linking

### Phase 8: Voice (3 weeks)
- [ ] Whisper speech-to-text
- [ ] Voice query processing
- [ ] Browser TTS for responses
- [ ] Mobile-responsive UI

### Phase 9: Vision Analysis & Smart Query Routing (5 weeks) 🆕
- [ ] Vision API integration for critical sheets
- [ ] Structured quantity extraction
- [ ] Query classification and routing
- [ ] Direct SQL lookup for quantities
- [ ] Station-aware vector search
- [ ] Cross-reference intelligence

### Phase 10: Polish (4 weeks)
- [ ] Error handling
- [ ] Performance optimization
- [ ] Security audit
- [ ] Usage analytics
- [ ] User onboarding flow

**FULL LAUNCH - Week 36**

---

## Part 3.5: Vision Analysis & Smart Query Routing 🆕

### Problem Statement

**Current AI Response**: Finds station numbers scattered across chunks, tries to do math (STA 36+00 minus STA 13+68.83 = 2,231 LF), gives uncertain answer.

**What's Actually Happening**:
- LlamaParse extracts station callouts as isolated text snippets
- Can't see the plan view showing the continuous waterline alignment
- Misses the quantity table (usually on title/summary sheet) that has the actual answer
- Doesn't understand spatial relationships between station references

**What Should Happen**:
AI should find and cite the exact source (e.g., "Per the Quantity Summary on Sheet C-001, Water Line A is 2,450 LF total")

### Implementation Strategy

Build a construction project copilot that answers ANY query accurately by:
1. Understanding what type of question is being asked
2. Routing to the best data source(s)
3. Combining multiple sources when needed
4. Citing sources clearly

### PHASE 1: Vision API for Sheets with Answers (START HERE)

The answer to "total length of waterline A" is almost certainly on:
- Title sheet (project summary table)
- General notes sheet (quantities listed)
- A dedicated "Quantities" or "Summary" sheet
- Possibly in a table on the first plan sheet

**Implementation Steps:**

#### 1. Create Vision Analysis Module
```typescript
// File: src/lib/vision/claude-vision.ts
function analyzeSheetWithVision(imageBuffer, sheetType, sheetNumber)
```

#### 2. Identify High-Value Sheets During Upload
```typescript
const criticalSheets = {
  title: /title|cover|index/i,
  summary: /summary|quantities|general.*notes/i,
  legend: /legend|symbols|abbreviations/i,
  details: /details/i,
  firstSheet: pageNumber === 1 // Often has summary table
};
```

#### 3. Vision Prompt - Optimized for Quantities
```typescript
const visionPrompt = `You are analyzing a construction plan sheet. Extract:

CRITICAL - QUANTITY TABLES:
- Any tables with columns like: Item, Description, Quantity, Unit, Length, etc.
- Preserve exact numbers and units
- Note which row corresponds to which item (e.g., "Water Line A: 2,450 LF")

SPATIAL INFORMATION:
- Station numbers and their spatial positions (top/bottom/left/right of sheet)
- Line labels (Water Line A, Storm Drain B, etc.) and what they connect to
- Profile views showing elevation and station relationships

CROSS-REFERENCES:
- Any text like "See Sheet X", "Detail Y/Z", "Typical Section A"

TEXT AT ALL ANGLES:
- Extract text even if rotated 90°, 180°, 270°, or vertical
- Preserve relationships (what label goes with what line/feature)

Return as structured JSON or clear markdown that preserves table formatting.`;
```

#### 4. Storage Strategy (✅ COMPLETED)
```sql
-- Migration 00030 - Already deployed
ALTER TABLE document_chunks ADD COLUMN project_id UUID;
ALTER TABLE document_chunks ADD COLUMN vision_data JSONB;
ALTER TABLE document_chunks ADD COLUMN is_critical_sheet BOOLEAN DEFAULT FALSE;
ALTER TABLE document_chunks ADD COLUMN extracted_quantities JSONB;
ALTER TABLE document_chunks ADD COLUMN stations JSONB;
ALTER TABLE document_chunks ADD COLUMN sheet_type TEXT;
ALTER TABLE document_chunks ADD COLUMN vision_processed_at TIMESTAMPTZ;
ALTER TABLE document_chunks ADD COLUMN vision_model_version TEXT;

CREATE TABLE project_quantities (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  document_id UUID REFERENCES documents(id),
  chunk_id UUID REFERENCES document_chunks(id),
  item_name TEXT NOT NULL,
  item_type TEXT,
  item_number TEXT,
  quantity NUMERIC,
  unit TEXT,
  station_from TEXT,
  station_to TEXT,
  location_description TEXT,
  sheet_number TEXT,
  source_type TEXT CHECK (source_type IN ('vision', 'text', 'calculated', 'manual')),
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 5. PDF to Image Conversion
```typescript
import { pdf } from 'pdf-to-img';

async function convertPdfPageToImage(pdfBuffer: Buffer, pageNum: number) {
  const document = await pdf(pdfBuffer, { scale: 2.0 }); // 2x for quality
  for await (const image of document) {
    if (image.pageNumber === pageNum) {
      return image; // PNG buffer
    }
  }
}
```

#### 6. Cost Control
- Resize images to max 2048px (Claude Vision accepts up to 8000px but costs more)
- Only process ~10-20% of sheets (title, summary, first few sheets)
- Log cost per sheet: ~$0.03 per 2048px image

### PHASE 2: Structured Quantity Extraction

After vision analysis, parse quantities into queryable format:

#### 1. Create Extraction Function
```typescript
// src/lib/metadata/quantity-extractor.ts

interface ExtractedQuantity {
  item_name: string;          // "Water Line A"
  quantity: number;           // 2450
  unit: string;               // "LF"
  station_from?: string;      // "13+00"
  station_to?: string;        // "36+00"
  sheet_number: string;       // "C-001"
  source_type: 'vision' | 'text' | 'calculated';
  confidence: number;         // 0.0 to 1.0
}

async function extractQuantities(visionAnalysis: string): Promise<ExtractedQuantity[]> {
  // Use Claude to parse vision output into structured format
  const prompt = `Parse this construction sheet analysis and extract quantities.

  Return JSON array with: item_name, quantity, unit, station_from, station_to, confidence

  Analysis: ${visionAnalysis}`;

  // Call Claude API to structure the data
}
```

#### 2. Fuzzy Matching for Queries
```typescript
import { distance } from 'fastest-levenshtein';

function findMatchingItem(query: string, items: string[]): string | null {
  const normalized = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matches = items.map(item => ({
    item,
    score: distance(normalized, item.toLowerCase().replace(/[^a-z0-9]/g, ''))
  }));

  const best = matches.sort((a, b) => a.score - b.score)[0];
  return best.score < 3 ? best.item : null; // Allow 2 char difference
}
```

### PHASE 3: Query Classification & Routing

Before hitting vector search, check if it's a quantity query:

#### 1. Detect Query Type
```typescript
// src/lib/chat/query-classifier.ts

function classifyQuery(query: string): QueryType {
  const patterns = {
    quantity: /(?:length|total|how much|how many|quantity|amount|linear feet|LF|footage).*(?:of|for)\s+(.+)/i,
    location: /(?:where|location|station|at STA)/i,
    specification: /(?:spec|specification|requirement|shall|must)/i,
    detail: /(?:detail|section|typical)/i
  };

  if (patterns.quantity.test(query)) {
    const match = query.match(patterns.quantity);
    return {
      type: 'quantity',
      itemName: match?.[1] || null, // Extract "waterline A"
      needsDirectAnswer: true
    };
  }
  // ... other types
}
```

#### 2. Direct SQL Query for Quantities
```typescript
// src/lib/chat/quantity-retrieval.ts

async function getQuantityDirectly(projectId: string, itemName: string) {
  // First, try exact match in quantities table
  const { data, error } = await supabase
    .from('project_quantities')
    .select('*')
    .eq('project_id', projectId)
    .ilike('item_name', `%${itemName}%`)
    .order('confidence', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    return {
      answer: `${data[0].item_name}: ${data[0].quantity} ${data[0].unit}`,
      source: `Sheet ${data[0].sheet_number}`,
      confidence: data[0].confidence,
      method: 'direct_lookup'
    };
  }

  return null; // Fall back to vector search
}
```

#### 3. Hybrid Retrieval Flow
```typescript
// In your chat API route

async function handleChatQuery(query: string, projectId: string) {
  // Step 1: Classify query
  const queryType = classifyQuery(query);

  // Step 2: Try direct lookup for quantities
  if (queryType.type === 'quantity' && queryType.itemName) {
    const directAnswer = await getQuantityDirectly(projectId, queryType.itemName);

    if (directAnswer && directAnswer.confidence > 0.8) {
      // High confidence - return immediately
      return {
        answer: directAnswer.answer,
        source: directAnswer.source,
        method: 'direct_quantity_lookup'
      };
    }
  }

  // Step 3: Fall back to enhanced vector search
  const vectorResults = await enhancedVectorSearch(query, projectId, queryType);

  // Step 4: Combine direct + vector context
  const context = [
    directAnswer && `Known quantity: ${directAnswer.answer}`,
    ...vectorResults
  ].filter(Boolean);

  // Step 5: Send to Claude with instruction
  const systemPrompt = directAnswer
    ? `A quantity was found in the project database: ${directAnswer.answer} from ${directAnswer.source}. Use this if it answers the user's question. Otherwise, analyze the provided context.`
    : `Analyze the provided context to answer the user's question.`;

  return await claudeChat(query, context, systemPrompt);
}
```

### PHASE 4: Enhanced Vector Search (Fallback)

If direct lookup fails, improve the vector search:

#### Station-Aware Boosting
```typescript
// src/lib/embeddings/station-aware-search.ts

async function searchWithStationContext(query: string, projectId: string) {
  // Extract any station numbers from query
  const stations = extractStations(query); // ["15+00", "36+00"]

  // Get base vector results
  const baseResults = await vectorSearch(query, projectId, 20); // Get more initially

  // Re-rank based on station proximity
  const reranked = baseResults.map(chunk => {
    let boost = 0;

    if (stations.length > 0 && chunk.metadata.stations) {
      // Check if chunk contains nearby stations
      const hasNearbyStation = chunk.metadata.stations.some(chunkSta =>
        stations.some(querySta => stationsAreClose(querySta, chunkSta, 500)) // Within 5 stations
      );
      if (hasNearbyStation) boost += 0.2;
    }

    // Boost if sheet type matches query intent
    if (query.match(/total|length|quantity/i) && chunk.metadata.sheetType === 'title') {
      boost += 0.3;
    }

    return {
      ...chunk,
      adjustedScore: chunk.similarity + boost
    };
  });

  return reranked.sort((a, b) => b.adjustedScore - a.adjustedScore).slice(0, 15);
}
```

### PHASE 5: Cross-Reference Intelligence

When user asks "Show me everything about Storm Drain B":
1. Find quantity from table
2. Find all plan sheets mentioning "Storm Drain B"
3. Find spec sections referenced on those sheets
4. Find detail callouts
5. Combine into comprehensive answer

### PHASE 6: Visual Understanding (Strategic Vision Use)

Apply vision API strategically based on query type:
- Plan sheets (when query asks "where is X")
- Profile sheets (when query asks about elevations/depths)
- Detail sheets (when query asks "how to install X")

Not just title sheets - use vision strategically based on query type.

### PHASE 7: Continuous Improvement

Log which strategies work:
- Track success rate by query type
- Identify patterns in failed queries
- Auto-suggest which sheets need better processing

### Implementation Files Structure

```
src/
├── lib/
│   ├── vision/
│   │   ├── claude-vision.ts          # NEW - Vision API calls
│   │   └── pdf-to-image.ts           # NEW - PDF page conversion
│   ├── metadata/
│   │   ├── quantity-extractor.ts     # NEW - Parse quantities from vision
│   │   └── station-extractor.ts      # NEW - Extract/normalize stations
│   ├── chat/
│   │   ├── query-classifier.ts       # NEW - Detect query type
│   │   └── quantity-retrieval.ts     # NEW - Direct SQL lookup
│   └── embeddings/
│       └── station-aware-search.ts   # NEW - Enhanced vector search
```

### Testing Strategy

Test with these specific queries on civil plans:

**Quantity Queries (Should hit direct lookup):**
1. ✓ "What is the total length of waterline A?"
2. ✓ "How much Storm Drain B is there?"
3. ✓ "Total quantity of 8-inch pipe"

**Location Queries (Should use enhanced vector search):**
4. "What's the pipe diameter at Station 15+00?"
5. "Where does Water Line A cross under the road?"

**Spec Queries (Current system should work fine):**
6. "What's the trench backfill requirement?"
7. "Bedding material for water line?"

### Success Criteria

After implementation:
- "What is the total length of waterline A?" → Direct answer with sheet citation in <2 seconds
- 90%+ accuracy on quantity queries
- Cost: <$3 per plan set for vision processing
- No regression on existing query types

### Implementation Priority

**Week 1 (Do This Now):**
1. Vision API integration for title/summary sheets only
2. Structured quantity extraction
3. Direct SQL lookup before vector search

**This solves the immediate problem** - "total length of waterline A" will get a direct answer from the quantity table.

**Week 2-3 (If time):**
4. Station-aware vector search re-ranking
5. Cross-reference tracking
6. Better chunking for plan sheets

---

## Part 4: Solo Founder Guidelines

### Buy vs Build

| Component | Decision | Service |
|-----------|----------|---------|
| Auth | BUY | Supabase Auth |
| Document parsing | BUY | LlamaParse ($0.003/page) |
| Embeddings | BUY | OpenAI API |
| Vector DB | USE | pgvector (in Supabase) |
| XER parsing | USE | p6-xer-reader npm |
| CPM calculation | SKIP | Import from P6 |
| UI components | USE | shadcn/ui |
| Speech-to-text | BUY | Whisper API |
| Text-to-speech | USE | Browser native (free) |

### What to Obsess Over
1. **Document Q&A quality** - Core value prop
2. **Data model correctness** - Hard to change later
3. **User onboarding** - Must be self-service

### What to Defer
1. Perfect UI (functional > beautiful)
2. MS Project support
3. Earned value features
4. Real-time collaboration

### What to Skip Entirely
1. Mobile app (responsive web is fine)
2. Offline mode
3. Custom CPM engine
4. Self-hosted LLMs

### Weekly Rhythm

```
Monday:    Plan the week, review feedback
Tue-Thu:   Build (3 focused coding days)
Friday:    Deploy, test, document
Weekend:   OFF (8 months is a marathon)
```

---

## Part 5: Cost Projections

### Monthly Infrastructure

| Service | Starter | Growth |
|---------|---------|--------|
| Vercel | $20 | $100 |
| Supabase | $25 | $100 |
| OpenAI (embeddings) | $10 | $50 |
| Claude API | $50 | $200 |
| LlamaParse | $20 | $100 |
| **Total** | **$125** | **$550** |

### Per-Project Costs
- Document processing: ~$0.50-2.00 per project setup
- Queries: ~$0.02-0.05 each
- Schedule analysis: ~$0.03-0.08 each
- **Estimated:** $20-100/project/month

---

## Part 6: Success Metrics

### Technical
- Query latency < 3 seconds (P95)
- Document processing < 5 minutes per 100 pages
- 99.5% uptime

### Business
- User activation rate > 60%
- Queries per user per day > 5
- NPS > 40

---

## Part 7: Risk Mitigation

| Risk | Mitigation |
|------|------------|
| XER parsing complexity | Use library, start with CSV |
| Voice latency | Pre-compute, streaming |
| Document OCR quality | Manual review option |
| Multi-tenant data leakage | RLS, security audit |
| Cost overruns | Usage caps, caching |
| Burnout | Fixed scope, sustainable pace |
| Getting stuck | Use AI coding assistants |
| No code review | Write tests, strict TypeScript |

---

## Quick Reference

### Key Decisions
- **Single orchestrator** with modes (not separate agents)
- **Import critical path** from P6 (don't calculate)
- **LlamaParse** for documents (don't build parser)
- **CSV first** for schedule import (XER later)
- **pgvector** in Supabase (no separate vector DB)

### Milestones
- **Week 10:** MVP - Document Q&A working
- **Week 17:** Schedule integration complete
- **Week 31:** Full launch

### File Locations
- Master Plan: `docs/plans/MASTER-PLAN-construction-copilot.md`
- Database Migrations: `supabase/migrations/`
- API Routes: `app/api/`
- Orchestrator: `lib/orchestrator/`
