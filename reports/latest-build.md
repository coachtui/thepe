# Latest Build Report

Last updated: 2026-05-06 (Spec extraction batched refactor)

---

## TypeScript

```
npx tsc --noEmit --skipLibCheck
```
**Status: PASS** — 0 errors

## Harness

```
npm run router:harness
```
**Status: PASS** — all cases pass including:
- Spec extraction happy path (CSI sections + parts + submittal requirements)
- Malformed JSON case
- Oversize section guardrail (57,537-char section skips LLM, includes regex evidence)
- Persistence row builder (happy path + skip case + oversize preservation)
- Approval/record-only phrase detection
- Submittal register (read path, pure transform, review-status validator)

## Production Build

```
npm run build
```
**Status: CLEAN** — no errors or warnings

## Known Issues

None.

## Environment Notes

- Vercel Pro required for `maxDuration=300` on `/api/inngest/route.ts`
- Inngest version: 3.54.2 (CVE-2026-42047 cleared — PUT 200 confirmed)
- Spec extraction now batched: BATCH_SIZE=5, ~16 batches for ~80-section MILCON spec
