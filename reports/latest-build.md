# Latest Build Report

Last updated: 2026-03-14

---

## TypeScript Compile

Last known result: **PASS** — `npx tsc --noEmit --skipLibCheck`
Last tested: 2026-03-11 (Phase 6 delivery)

## Known Issues

- Manual Analyze button does not populate `document_pages` / `sheet_entities` — Phase 7A fix pending
- `supabase as any` cast used throughout graph queries — regenerate types after next schema deploy
- Phase 7 tables (migration 00047) not yet written or applied

## Environment Notes

- Vercel Pro required for `maxDuration=300` on `/api/inngest/route.ts`
- `EVAL_ENABLED=true` required to run eval harness

---

*Update this file at the end of every Lead Builder session.*
