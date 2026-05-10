# Latest Build Report

Last updated: 2026-05-09 20:08 HST (Publish Register gate)

---

## TypeScript / Build

```
npx tsc --noEmit --skipLibCheck
npm run build
```
**Status: PASS** — 0 errors, clean output

## Harness

```
npm run qa:harness
```
**Status: PASS — 114/114** (was 96; +18 for 7 publish readiness test cases)

```
npm run ingestion:harness
```
**Status: PASS** — 6 fixtures, NEEDS REVIEW run grade (adversarial fixtures by design; no regression)

## Known Issues

None.

## Environment Notes

- Vercel Pro required for `maxDuration=300` on `/api/inngest/route.ts`
- Inngest version: 3.54.2
- Spec extraction: batched BATCH_SIZE=5
