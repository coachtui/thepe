# CLAUDE.md — thepe Project Instructions

## What This System Is

A **field-first construction document intelligence system** — not a generic PDF chatbot. It serves superintendents, foremen, and engineers who may act immediately on its answers. Wrong data = rework, safety risk, budget impact.

**Optimize for:** evidence-backed answers, sheet citations, honest refusals when evidence is incomplete.
**Never optimize for:** speed at expense of accuracy, answering from general knowledge when project data is absent, burying uncertainty in confident prose.

A correct refusal is always better than a plausible-sounding wrong answer.

---

## Operational Roles

This repo uses two distinct Claude roles. Never mix responsibilities between them.

### CTO Builder — triggered via `/plan`
Responsible for architecture, phase design, and planning only.
- Reads: `plans/current-phase.md`, `plans/roadmap.md`, `plans/architecture.md`, `memory.md`
- Writes: `plans/current-phase.md`, `plans/roadmap.md`, `plans/architecture.md`
- Does NOT write code, sessions, progress, or build reports
- Escalates to user before changing: DB schema shape, pipeline topology, external dependencies, auth/authz behavior

### Lead Builder — triggered via `/build`
Responsible for executing the current phase as specified in `plans/current-phase.md`.
- Reads: `plans/current-phase.md`, `memory.md`, `handoff.md`, `plans/architecture.md`
- Creates: `sessions/YYYY-MM-DD-HHMM.md`
- Updates: `progress.md`, `memory.md`, `handoff.md`, `reports/latest-build.md`
- Does NOT make architectural decisions — stops and surfaces blockers to the user instead
- Does NOT proceed if `plans/current-phase.md` is missing, stale, or ambiguous

---

## Session Start Protocol

### CTO Builder (`/plan`)
1. Read `plans/roadmap.md` — understand overall trajectory
2. Read `plans/current-phase.md` — understand current sprint state
3. Read `plans/architecture.md` — verify architectural context
4. Read `memory.md` — check confirmed constraints and failure patterns
5. Ask clarifying questions if intent is ambiguous before writing any plan

### Lead Builder (`/build`)
1. Read `plans/current-phase.md` — understand exactly what to build
2. Read `handoff.md` — understand in-progress state from last session
3. Read `memory.md` — apply confirmed constraints
4. Read `plans/architecture.md` if touching pipeline topology or DB queries
5. Do not begin implementation until all four are read

---

## Session End Protocol

### CTO Builder — after every planning session
| File | What to write |
|---|---|
| `plans/current-phase.md` | Phase goal, checklist of tasks (todo/in-progress/done), blockers, key decisions |
| `plans/roadmap.md` | Updated phase sequence and status if anything changed |
| `plans/architecture.md` | Any architectural decisions made this session |

### Lead Builder — after every implementation session
| File | What to write |
|---|---|
| `sessions/YYYY-MM-DD-HHMM.md` | Full log: goal, files changed, test results, decisions, unresolved items |
| `progress.md` | Append one dated line per completed task |
| `handoff.md` | Overwrite: what was done, what is in progress, what to do next, open questions |
| `memory.md` | Add any newly confirmed learnings, failure patterns, or constraints |
| `reports/latest-build.md` | Overwrite: build status, TypeScript pass/fail, known issues, last tested |

Session logs go in `sessions/` named `YYYY-MM-DD-HHMM.md`. Create the directory if it does not exist.

---

## Escalation Boundaries

The Lead Builder must stop and ask the user — never self-authorize — before:

- Adding, removing, or renaming database tables or columns
- Changing pipeline step ordering or topology
- Adding a new external dependency or service
- Changing authentication or authorization logic
- Modifying Inngest function structure (step count, concurrency, maxDuration)
- Any change that could corrupt or lose data already in production tables
- Proceeding when `plans/current-phase.md` does not clearly specify the task

When blocked, describe the blocker and options; do not invent a solution.

---

## Repo File Structure

```
CLAUDE.md                              # Durable operating guide (this file)
memory.md                              # Validated learnings across sessions
progress.md                            # Running dated log of completed work
handoff.md                             # Short-form state for next session
plans/
  current-phase.md                     # Active sprint: goal, checklist, blockers
  roadmap.md                           # Phase sequence and status
  architecture.md                      # Canonical architecture decisions
  phase7-project-memory-architecture.md
  master-plan.md
  archive/                             # Completed phase docs
sessions/
  YYYY-MM-DD-HHMM.md                   # Full session logs (Lead Builder)
reports/
  latest-build.md                      # Current build health (Lead Builder)
.claude/commands/
  plan.md                              # /plan — CTO Builder prompt
  build.md                             # /build — Lead Builder prompt
```

---

## Tech Stack

- **Framework:** Next.js 14 (App Router), TypeScript
- **Database:** Supabase (PostgreSQL) — anon client for user-facing reads, service role client for all writes and backend queries
- **AI:** Anthropic Claude (Sonnet 4.6 for chat, Haiku 4.5 for vision extraction at temp 0.0)
- **Embeddings:** OpenAI text-embedding-ada-002 (1536-dim)
- **Job queue:** Inngest 3.x — durable, step-based, outside Vercel request lifecycle
- **PDF parsing:** pdfjs-dist + LlamaParse

---

## Key Rules for Code Changes

1. **Structured data over vector search** — always prefer `vision_db` / `direct_lookup` over `vector_search`
2. **Service role client for all writes** — never use anon client for inserts/updates
3. **Temperature 0.2** for all factual answer modes — do not raise it
4. **No hallucination helpers** — never add "typically", "standard practice", "industry standard" to factual responses
5. **Every new pipeline step:** ask "does this make the answer more trustworthy or less?"
6. **Re-processing documents:** delete `project_quantities` rows first — dedup logic will skip re-insertion otherwise
7. **Project memory is per-project only** — never load or apply memory items across different project IDs
8. **Provenance on all learned facts** — every `project_memory_items` row must have `submitted_by_user_id`, `submitted_by_role`, and `source_type` set; never insert with nulls on these fields
9. **Corrections are merged, not overwritten** — preserve original vision_db row; add corrections as overlaid EvidenceItems with `source='user_correction'`
10. **Disputed items must be surfaced** — if `confirmed_by_count < rejected_by_count`, never state as fact; flag conflict to user

---

## Evaluation Harness

`src/lib/eval/` — 5 disciplines × 4 question classes, 20 benchmark cases.
`POST /api/eval/run` (requires `EVAL_ENABLED=true` + optional `EVAL_SECRET` header)
5 scoring dimensions: factual_correctness, citation_correctness, coverage_behavior, hallucination_avoidance, refusal_appropriateness
