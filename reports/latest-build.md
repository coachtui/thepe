# Latest Build Report

Last updated: 2026-05-07 21:05 HST (artifact review workflow)

---

## TypeScript / Build

```
npm run build
```
**Status: PASS** — 0 errors, clean output

New route in build: `/api/projects/[id]/submittal-register/artifact-review`

## Harness

```
npm run router:harness
```
**Status: PASS — 12/12**

## Known Issues

None. Artifact cleanup script ready to execute — `--execute` not yet run against production DB.

## Environment Notes

- Vercel Pro required for `maxDuration=300` on `/api/inngest/route.ts`
- Inngest version: 3.54.2
- Spec extraction: batched BATCH_SIZE=5
