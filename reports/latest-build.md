# Latest Build Report

Last updated: 2026-05-07 20:17 HST (submittal register UI improvements)

---

## TypeScript

```
npm run build
```
**Status: PASS** — 0 errors

## Harness

```
npm run router:harness
```
**Status: PASS — 12/12** — all cases pass including:
- Spec extraction happy path (CSI sections + parts + submittal requirements)
- Malformed JSON case
- Oversize section guardrail
- Persistence row builder (happy path + skip + oversize preservation)
- Approval/record-only phrase detection
- Submittal register (read path, pure transform, review-status validator, reconstruction)

## Production Build

```
npm run build
```
**Status: CLEAN** — no errors or warnings
- Pre-existing warning: `outputFileTracingIncludes` in next.config.js (non-blocking)

## Known Issues

None.

## Environment Notes

- Vercel Pro required for `maxDuration=300` on `/api/inngest/route.ts`
- Inngest version: 3.54.2
- Spec extraction: batched BATCH_SIZE=5, ~16 batches for ~80-section MILCON spec
