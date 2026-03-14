# Latest Build Report

Last updated: 2026-03-14 (Phase 7B)

---

## TypeScript Compile

**Status: PASS** — `npx tsc --noEmit --skipLibCheck` clean.
Last tested: 2026-03-14 (Phase 7B session)

## Known Issues

- `DataSourceCounts.graph` always 0 — graph source type not yet in `EvidenceSourceType`
- In-memory trace store (`getStoredTrace`) does not persist across serverless instances — dev-only limitation
- `supabase as any` cast used in project-memory.ts and throughout graph queries — regenerate types after migration 00047 is applied
- Migration 00047 written but not yet applied — run `supabase db push` before Phase 7C

## Environment Notes

- Vercel Pro required for `maxDuration=300` on `/api/inngest/route.ts`
- `EVAL_ENABLED=true` required to run eval harness

---

*Update this file at the end of every Lead Builder session.*
