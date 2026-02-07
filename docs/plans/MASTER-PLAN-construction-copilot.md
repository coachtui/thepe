# Construction Copilot - Master Plan

> **Document Type:** Master Architecture & Implementation Plan
> **Created:** 2025-01-27
> **Last Updated:** 2026-01-31
> **Status:** Phase 4 Core Complete - Testing Required 🟡
> **Target:** Solo Founder, mobile-first field app
> **Architecture:** Expo/React Native + Next.js API backend
> **Mobile App:** `pe/mobile/` - Expo SDK 54, Zustand, SecureStore
> **Vision Standard:** See [VISION-QUERY-STANDARD.md](../standards/VISION-QUERY-STANDARD.md) for canonical query pattern

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
| **Mobile App** | Expo / React Native | Native iOS/Android, single codebase |
| Mobile UI | React Native Paper / Tamagui | Native components, fast |
| Backend API | Next.js API Routes | Existing infrastructure |
| Database | Supabase (PostgreSQL) | RLS, real-time, storage, auth |
| Vector DB | pgvector (via Supabase) | Native PostgreSQL, no extra service |
| AI/LLM | Claude 3.5 Sonnet | Best reasoning for construction |
| Embeddings | OpenAI text-embedding-ada-002 | Cost-effective |
| Doc Parsing | LlamaParse | $0.003/page, handles tables |
| **Voice Input** | Whisper API | Speech-to-text for field |
| **Voice Output** | expo-speech | Native TTS |
| **Offline** | MMKV + AsyncStorage | Fast local caching |
| Hosting | Vercel + Supabase | API backend |
| App Distribution | Expo EAS | TestFlight, Play Store |

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

### Completed Phases (Web Foundation)

### Phase 0: Setup (1 week) ✅ COMPLETE
- [x] Initialize Next.js project with TypeScript
- [x] Configure Supabase project
- [x] Set up development environment
- [x] Deploy base infrastructure to Vercel

### Phase 1: Auth & Projects (2 weeks) ✅ COMPLETE
- [x] Supabase Auth integration
- [x] Base database schema deployment
- [x] RLS policies for multi-tenancy
- [x] Project CRUD operations
- [x] Basic dashboard UI

### Phase 2: Document Upload (3 weeks) ✅ COMPLETE
- [x] Document upload UI (drag-drop)
- [x] Supabase Storage integration
- [x] LlamaParse integration for PDF processing
- [x] Document chunking logic
- [x] Embedding generation (OpenAI)
- [x] Document listing and preview

### Phase 3: Basic Q&A + Vision (4 weeks) ✅ COMPLETE
- [x] Vector similarity search
- [x] Query orchestrator (document mode)
- [x] Chat UI with streaming responses
- [x] Source citations
- [x] Query history tracking
- [x] **PDF Attachment Vision System** (see Part 3.5)
- [x] **Vision Query Standard Established** ([VISION-QUERY-STANDARD.md](../standards/VISION-QUERY-STANDARD.md))

**WEB MVP CHECKPOINT - ACHIEVED ✅**

---

### Mobile-First Phases (Current Focus)

### Phase 4: Mobile Foundation (3-4 weeks) 🟡 CORE COMPLETE
**Goal:** Native iOS/Android app with core functionality
**Status:** Core built, device testing required

- [x] Expo/React Native project setup (`pe/mobile/`)
- [x] Navigation structure (tabs: Projects, Chat, Documents, Settings)
- [x] Supabase Auth integration (expo-secure-store)
- [x] Connect to existing Next.js API endpoints
- [x] Project list screen with pull-to-refresh
- [x] Chat interface with streaming responses
- [x] Document list with status badges
- [x] Settings screen with sign out
- [ ] Device testing (iOS/Android)
- [ ] PDF viewer implementation
- [ ] TestFlight build

### Phase 5: Voice + Offline (3-4 weeks) 🔴 CRITICAL
**Goal:** Hands-free operation for field workers

**Voice:**
- [ ] Whisper API integration (speech-to-text)
- [ ] Voice activation button (push-to-talk)
- [ ] Text-to-speech for responses (expo-speech)
- [ ] Voice feedback (beeps, confirmations)

**Offline:**
- [ ] Document metadata caching (AsyncStorage/MMKV)
- [ ] Recent chats available offline
- [ ] PDF caching for key documents
- [ ] Background sync when connection restored
- [ ] Offline indicator UI

### Phase 6: Performance & Polish (2-3 weeks) 🔴 CRITICAL
**Goal:** Fast, reliable, field-ready

- [ ] Cold start < 2 seconds
- [ ] Optimistic UI updates
- [ ] Image/PDF lazy loading
- [ ] Native gestures (swipe, pull-to-refresh)
- [ ] Push notifications (new responses, sync complete)
- [ ] Error handling (graceful offline degradation)
- [ ] Haptic feedback
- [ ] Dark mode (for indoor/outdoor)

**MOBILE MVP CHECKPOINT 📱**

---

### Feature Expansion Phases (Post Mobile MVP)

### Phase 7: Schedule Integration (3 weeks)
- [ ] Schedule database schema
- [ ] CSV/Excel import via mobile
- [ ] "When is X activity?" voice queries
- [ ] 3-week lookahead view
- [ ] Schedule mode in orchestrator

### Phase 8: Advanced Schedule (4 weeks)
- [ ] XER import (p6-xer-reader)
- [ ] Critical path display
- [ ] Activity-document linking
- [ ] Schedule impact calculations

### Phase 9: RFI Generation (3 weeks)
- [ ] RFI mode in orchestrator
- [ ] Voice-to-RFI creation
- [ ] Auto-generate RFI from question
- [ ] Link to source documents
- [ ] Photo attachment from field

### Phase 10: Takeoff (4 weeks)
- [ ] Takeoff mode in orchestrator
- [ ] Quantity extraction queries
- [ ] Area/volume calculations
- [ ] Spec reference linking

### Phase 11: Visual Query Expansion (3 weeks)
Following the [VISION-QUERY-STANDARD.md](../standards/VISION-QUERY-STANDARD.md):
- [ ] Length queries ("how long is water line A")
- [ ] Location queries ("where is the fire hydrant")
- [ ] Multi-system support (sewer, storm, gas)
- [ ] Cross-reference intelligence

### Phase 12: Enterprise Polish (4 weeks)
- [ ] Advanced error handling
- [ ] Performance optimization
- [ ] Security audit
- [ ] Usage analytics dashboard
- [ ] Team onboarding flow
- [ ] App Store / Play Store submission

**FULL LAUNCH**

---

## Part 3.5: Vision Analysis & Smart Query Routing ✅ COMPLETE

> **Status:** PRODUCTION READY - Vision Query Standard Established
> **Standard Document:** [VISION-QUERY-STANDARD.md](../standards/VISION-QUERY-STANDARD.md)

### Problem Statement (SOLVED ✅)

**Old AI Response**: Finds station numbers scattered across chunks, tries to do math, gives uncertain answer, confuses components with crossings.

**Working Solution**: Direct PDF attachment to Claude with task-specific prompts that include construction terminology education and scanning methodology.

### The Working Architecture

```
User Query: "How many 12 inch gate valves are there?"
    │
    ▼
┌─────────────────────────────────────┐
│  Query Classification (smart-router) │
│  - needsVision: true                 │
│  - componentType: "gate valve"       │
│  - sizeFilter: "12-IN"               │
│  - visualTask: "count_components"    │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  PDF Attachment (pdf-attachment.ts)  │
│  - Fetch PDFs from Supabase storage  │
│  - Convert to base64                 │
│  - Attach directly to Claude API     │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Task-Specific Visual Prompt         │
│  - Construction terminology          │
│  - Profile view scanning method      │
│  - Size filtering instructions       │
│  - Sanity checks & examples          │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Claude Sonnet 4.5 with PDFs         │
│  - Reads actual PDF documents        │
│  - Scans profile view left-to-right  │
│  - Finds vertical text labels        │
│  - Returns per-sheet breakdown       │
└─────────────────────────────────────┘
    │
    ▼
Response: "5 twelve-inch gate valves"
- CU102: 1 (STA 0+00)
- CU107: 2 (STA 24+93, STA 25+98)
- CU109: 2 (STA 32+44, STA 32+62)
```

### Core Implementation (WORKING)

#### 1. PDF Attachment (Not Image Conversion)
```typescript
// src/lib/chat/pdf-attachment.ts
export function buildMessageWithPdfAttachments(
  attachments: PdfAttachment[],
  userQuery: string
) {
  const content = [];

  // Attach each PDF directly
  for (const attachment of attachments) {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: attachment.base64
      }
    });
  }

  // Add the user query
  content.push({
    type: 'text',
    text: `**Documents Attached:**\n${labels}\n\n**Question:** ${userQuery}`
  });

  return content;
}
```

#### 2. Task-Specific Prompts with Terminology Education
```typescript
// src/app/api/chat/route.ts
function buildVisualCountingPrompt(componentType, sizeFilter, visualTask) {
  if (visualTask === 'find_crossings') {
    return buildCrossingAnalysisPrompt(); // Separate prompt for crossings
  }

  return `## CONSTRUCTION PLAN ANALYSIS ASSISTANT

**CRITICAL: Read the actual PDFs attached. COUNT WHAT YOU SEE.**

## SHEET LAYOUT
- PLAN VIEW (Top 50-60%): Aerial view, callout boxes
- PROFILE VIEW (Bottom 40-50%): Station scale, VERTICAL TEXT LABELS

## SCANNING METHOD
1. Look at PROFILE VIEW (bottom section)
2. Start LEFT, scan slowly RIGHT
3. Look for VERTICAL TEXT along utility line
4. Each "12-IN GATE VALVE" label = 1 component
5. Record station from scale below

## SIZE FILTERING
- "12-IN" = twelve inch ✓ COUNT
- "8-IN" = eight inch ✗ EXCLUDE
- "1-1/2-IN" = NOT twelve inch ✗ EXCLUDE

## CONSTRUCTION TERMINOLOGY (CRITICAL!)
**WATER LINE COMPONENTS (NOT crossings):**
- VERT DEFL = Vertical deflection fitting
- TEE = Tee fitting
- GATE VALVE, BEND, CAP = Water line parts

**ACTUAL UTILITY CROSSINGS:**
- ELEC = Electrical line
- SS = Sanitary Sewer
- STM = Storm Drain

**Test:** Contains "12-IN" or "8-IN" → Part of water line → NOT crossing
...`;
}
```

#### 3. Crossing Analysis Prompt (Separate)
```typescript
function buildCrossingAnalysisPrompt() {
  return `## UTILITY CROSSING ANALYSIS

**CRITICAL:** Understand what IS and IS NOT a crossing.

## WHAT IS A UTILITY CROSSING?
A crossing = DIFFERENT utility (not Water Line A) crosses over/under.

Pattern in profile view:
ELEC        ← Utility label
28.71±      ← Reference elevation
  |         ← Crossing line
════╪════   ← Water Line A

## WHAT IS NOT A CROSSING
❌ VERT DEFL = Vertical deflection (part of water line!)
❌ 12-IN X 8-IN TEE = Tee fitting (part of water line!)
❌ Any label with "12-IN" or "8-IN" = Water line component!

## SANITY CHECK
- Projects typically have 0-5 crossings
- Finding 10+ means you're counting water line fittings by mistake
...`;
}
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
1. MS Project support
2. Earned value features
3. Real-time collaboration
4. Web app polish (mobile-first)

### What to Skip Entirely
1. Custom CPM engine
2. Self-hosted LLMs
3. Complex admin dashboards
4. Multi-language support (initially)

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
