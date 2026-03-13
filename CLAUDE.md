# CLAUDE.md — thepe Project Instructions

## What This System Is

A **field-first construction document intelligence system** — not a generic PDF chatbot. It serves superintendents, foremen, and engineers who may act immediately on its answers. Wrong data = rework, safety risk, budget impact.

**Optimize for:** evidence-backed answers, sheet citations, honest refusals when evidence is incomplete.
**Never optimize for:** speed at expense of accuracy, answering from general knowledge when project data is absent, burying uncertainty in confident prose.

A correct refusal is always better than a plausible-sounding wrong answer.

---

## Tech Stack

- **Framework:** Next.js 14 (App Router), TypeScript
- **Database:** Supabase (PostgreSQL) — anon client for user-facing reads, service role client for all writes and backend queries
- **AI:** Anthropic Claude (Sonnet 4.6 for chat, Haiku 4.5 for vision extraction at temp 0.0)
- **Embeddings:** OpenAI text-embedding-ada-002 (1536-dim)
- **Job queue:** Inngest 3.x — durable, step-based, outside Vercel request lifecycle
- **PDF parsing:** pdfjs-dist + LlamaParse

---

## Chat Pipeline (in order)

```
query-analyzer → smart-router → retrieval-orchestrator
  → sheet-verifier (Type B/C/D queries)
  → plan-reader (targeted page inspection)
  → evidence-evaluator → reasoning-engine → response-writer
```

All files live in `src/lib/chat/`. Key files:

| File | Role |
|---|---|
| `chat-handler.ts` | Orchestrates all steps |
| `query-analyzer.ts` | Classifies query + extracts entities |
| `sheet-verifier.ts` | Mandatory pre-answer verification (Types B/C/D) |
| `evidence-evaluator.ts` | Scores sufficiency; hard-gates on `insufficient` |
| `response-writer.ts` | Discipline-aware persona; temp 0.2 for all factual modes |
| `sheet-narrower.ts` | 11-signal ranked candidate sheet selection |
| `plan-reader.ts` | Multimodal page inspection at query time |

---

## Verification System

Queries are classified before answering:

- **Type A** — skip verification (general chat, procedural)
- **Type B** — enumeration (count/list all X)
- **Type C** — measurement (size/length of specific X)
- **Type D** — global (project-wide scope)

`coverageStatus: insufficient` from the verifier is a **hard refuse** — code-level, not prompt-level. The evidence-evaluator enforces this regardless of what other retrieval sources found.

---

## Vision Processing

Two paths — **they are not equivalent**:

| Path | Trigger | Calls `indexDocumentPage`? |
|---|---|---|
| Inngest | Auto on upload, `vision/document.process` event | YES — populates `document_pages` + `sheet_entities` |
| Manual Analyze button | `/api/projects/{id}/analyze-complete` → `processDocumentWithVision()` | NO — Phase 2 indexes never populated |

**Known bug:** Manual Analyze button does not populate `document_pages` / `sheet_entities`. Only Inngest path produces complete Phase 2 data.

Vision extraction prompt: `src/lib/vision/claude-vision.ts` → `buildVisionPrompt()`

Inngest function: `src/inngest/functions/vision-process-document.ts`
- 5 pages per chunk (each chunk = one Vercel step invocation)
- `maxDuration = 300` on `/api/inngest/route.ts` (requires Vercel Pro)
- Concurrency limit: 5 documents

---

## Key Database Tables

| Table | Purpose |
|---|---|
| `documents` | PDFs — `vision_status`, `file_path`, `page_count` |
| `document_chunks` | Text chunks with `vision_data` JSONB |
| `document_pages` | One row per PDF page — sheet metadata, disciplines, station range |
| `sheet_entities` | One row per detected entity per page |
| `project_quantities` | Vision-extracted components (valves, pipe segments, etc.) |
| `utility_crossings` | Detected utility crossings |
| `utility_termination_points` | Line start/end points |
| `project_entities` | Universal entity graph |
| `vision_job_logs` | Batch processing audit trail |

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
OPENAI_API_KEY
LLAMA_CLOUD_API_KEY
NEXT_PUBLIC_APP_URL
```

Optional: `DEBUG`, `AI_DEBUG_TRACE`, `EVAL_ENABLED`, `EVAL_SECRET`

---

## Key Rules for Code Changes

1. **Structured data over vector search** — always prefer `vision_db` / `direct_lookup` sources over `vector_search`
2. **Service role client for all writes** — never use anon client for inserts/updates
3. **Temperature 0.2** for all factual answer modes — do not raise it
4. **No hallucination helpers** — never add phrases like "typically", "standard practice", "industry standard" to factual responses
5. **Every new pipeline step:** ask "does this make the answer more trustworthy or less?"
6. **Re-processing documents:** delete `project_quantities` rows first — dedup logic will skip re-insertion otherwise

---

## Evaluation Harness

`src/lib/eval/` — 5 disciplines × 4 question classes, 20 benchmark cases.
API: `POST /api/eval/run` (requires `EVAL_ENABLED=true` + optional `EVAL_SECRET` header)
5 scoring dimensions: factual_correctness, citation_correctness, coverage_behavior, hallucination_avoidance, refusal_appropriateness
