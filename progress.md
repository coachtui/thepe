# Progress Log

Append one line per completed task: `YYYY-MM-DD — [task] — [files affected]`

---

2026-03-10 — Phase 1+2: Vision extraction, entity graph tables, utility pipeline — migrations/00038, 00039, src/lib/chat/graph-queries.ts, graph-validator.ts, reasoning-engine.ts
2026-03-10 — Phase 3: Demo-plan ingestion and reasoning — migrations/00040, src/lib/chat/demo-queries.ts, demo-validator.ts, src/lib/vision/demo-extractor.ts
2026-03-11 — Phase 4: Architectural floor plans + schedule linkage — migrations/00041, src/lib/chat/arch-queries.ts, arch-validator.ts, src/lib/vision/arch-extractor.ts
2026-03-11 — Phase 5: Structural + MEP + coordination reasoning — migrations/00042, src/lib/chat/structural-queries.ts, mep-queries.ts, coordination-queries.ts, coordination-validator.ts
2026-03-11 — Phase 6: Spec + RFI + submittal ingestion — migrations/00043, src/lib/chat/spec-queries.ts, rfi-queries.ts, submittal-queries.ts, spec-validator.ts
2026-03-13 — Phase 7 design: Project-scoped memory architecture — plans/phase7-project-memory-architecture.md
2026-03-14 — Repo workflow setup: CTO/Builder roles, CLAUDE.md rewrite, commands, architecture.md, roadmap.md — CLAUDE.md, plans/*, .claude/commands/*, handoff.md, progress.md, reports/latest-build.md
2026-03-14 — Phase 7A: Fix Manual Analyze button bug (indexDocumentPage) — src/lib/processing/vision-processor.ts
2026-03-14 — Phase 7A: Add query_id + source_confidence_at_retrieval to EvidenceItem; DataSourceCounts + ChatResponse types — src/lib/chat/types.ts
2026-03-14 — Phase 7A: queryId generation, trace store, data_source_counts, X-Query-Id/X-Data-Source-Counts headers — src/lib/chat/chat-handler.ts
2026-03-14 — Phase 7A: Debug trace endpoint — src/app/api/projects/[id]/query-trace/[queryId]/route.ts
2026-03-14 — Phase 7B: Migration 00047 (project_memory_items, project_corrections, memory_confirmations, project_source_quality, recheck_sessions) — supabase/migrations/00047_project_memory.sql
2026-03-14 — Phase 7B: project-memory.ts (loadProjectMemory, resolveAliases, getSourceQuality, prompt helpers) — src/lib/chat/project-memory.ts
2026-03-14 — Phase 7B: applyAliasExpansions export — src/lib/chat/query-analyzer.ts
2026-03-14 — Phase 7B: calloutPatterns threaded through plan reader — src/lib/chat/plan-reader.ts
2026-03-14 — Phase 7B: Steps 0 + 0.5 wired in chat handler — src/lib/chat/chat-handler.ts
