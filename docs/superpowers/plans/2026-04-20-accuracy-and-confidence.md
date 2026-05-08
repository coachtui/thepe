# Accuracy and Confidence Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix silent wrong answers from branched utilities and missing crossings, regenerate TypeScript types from the newly applied migration, and inject confidence signals into tool responses so field workers know when to verify.

**Architecture:** Four independent fixes. Tasks 1–3 are data-accuracy fixes in the extraction and query layers. Task 4 adds confidence language to the `searchEntities` tool response in the agentic tools layer — the only place Claude receives retrieval metadata, since `systemPromptAddition` from the router is discarded by the tools wrapper. No new modules.

**Tech Stack:** TypeScript, Supabase (Postgres), Next.js App Router, Vercel AI SDK

---

## Files Modified

| File | Task | What changes |
|---|---|---|
| `src/lib/db/supabase/types.ts` | 1 | Regenerated to include 5 tables from migration 00047 |
| `src/lib/chat/graph-queries.ts` | 2 | BEGIN/END junction selection changed from `find` (first-only) to filter+sort (min/max station) |
| `src/lib/vision/crossing-extractor.ts` | 3 | Filter out crossings with null/empty elevation before insert |
| `src/lib/chat/tools/index.ts` | 4 | Inject confidence note into `searchEntities` tool response based on `directLookup.confidence` |

---

## Task 1: Regenerate TypeScript Types

Migration 00047 added 5 tables (`project_memory_items`, `project_corrections`, `memory_confirmations`, `project_source_quality`, `recheck_sessions`). The generated types file at `src/lib/db/supabase/types.ts` predates the migration, so every insert into these tables uses `as any` casts. Regenerating types removes that debt.

**Files:**
- Overwrite: `src/lib/db/supabase/types.ts`

- [ ] **Step 1: Generate types from remote DB**

```bash
cd /Users/tui/thepe
npx supabase gen types typescript --project-id frhzemhbgcjjprfxgmgq > src/lib/db/supabase/types.ts
```

Expected: the file is overwritten with a new `Database` type that includes the new tables. Check the output includes them:

```bash
grep -c "project_corrections\|project_memory_items" src/lib/db/supabase/types.ts
```

Expected output: `2` or higher (one line per table).

If the command fails with auth errors, run `npx supabase login` first, then retry.

- [ ] **Step 2: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: no output (zero errors).

If there ARE errors: they will be in files that previously used `as any` to work around missing types, and now the types exist but don't match what was assumed. Read each error and fix the cast — typically removing `as any` from a `.from('project_corrections').insert(...)` call and letting TypeScript infer the correct type.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/supabase/types.ts
git commit -m "chore: regenerate Supabase types to include migration 00047 tables"
```

---

## Task 2: Fix Graph BEGIN/END Junction Selection for Branched Utilities

**Problem:** `queryGraphUtilityLength()` in `src/lib/chat/graph-queries.ts` uses `junctions.find()` to get the BEGIN and END terminations. `find()` returns the **first** match — on a branched or looped utility, there may be multiple BEGINs and multiple ENDs. The code silently picks whichever happens to come first from the database, computing the wrong length with 0.95 confidence.

**Fix:** Use `filter()` to get all BEGINs and all ENDs. Warn if multiple found. Pick the lowest-station BEGIN (true start) and highest-station END (true end) of the main line.

**Files:**
- Modify: `src/lib/chat/graph-queries.ts:388-412`

- [ ] **Step 1: Read the current BEGIN/END block**

The block to replace is at approximately lines 388–412 of `src/lib/chat/graph-queries.ts`. Current code:

```typescript
// Extract BEGIN and END termination types from entity metadata
const beginJunction = junctions.find(
  (j) => (j.metadata as any)?.termination_type === 'BEGIN'
);
const endJunction = junctions.find(
  (j) => (j.metadata as any)?.termination_type === 'END'
);

if (!beginJunction || !endJunction) {
  const types = junctions
    .map((j) => (j.metadata as any)?.termination_type)
    .filter(Boolean)
    .join(', ');
  return {
    success: false,
    utilityName,
    lengthLf: 0,
    beginStation: beginJunction?.entity_locations?.[0]?.station_value ?? '',
    endStation:   endJunction?.entity_locations?.[0]?.station_value ?? '',
    confidence: 0,
    source: 'Entity graph — missing BEGIN or END junction',
    formattedAnswer:
      `Partial junction data for "${utilityName}". Found: ${types || 'none'}. Cannot compute length.`,
  };
}
```

- [ ] **Step 2: Replace with filter+sort version**

Replace that entire block (from the comment through the closing `}` of the `if (!beginJunction || !endJunction)` block) with:

```typescript
// Extract BEGIN and END termination types — handle branched utilities
const beginJunctions = junctions.filter(
  (j) => (j.metadata as any)?.termination_type === 'BEGIN'
);
const endJunctions = junctions.filter(
  (j) => (j.metadata as any)?.termination_type === 'END'
);

if (beginJunctions.length === 0 || endJunctions.length === 0) {
  const types = junctions
    .map((j) => (j.metadata as any)?.termination_type)
    .filter(Boolean)
    .join(', ');
  return {
    success: false,
    utilityName,
    lengthLf: 0,
    beginStation: '',
    endStation: '',
    confidence: 0,
    source: 'Entity graph — missing BEGIN or END junction',
    formattedAnswer:
      `Partial junction data for "${utilityName}". Found: ${types || 'none'}. Cannot compute length.`,
  };
}

if (beginJunctions.length > 1 || endJunctions.length > 1) {
  console.warn(
    `[Graph Queries] Multiple BEGIN/END junctions for "${utilityName}" ` +
    `(${beginJunctions.length} BEGIN, ${endJunctions.length} END) — ` +
    `utility may be branched. Using min-station BEGIN, max-station END.`
  );
}

// Pick lowest-station BEGIN (true start of main line)
const beginJunction = beginJunctions.sort((a, b) => {
  const aS = a.entity_locations?.[0]?.station_numeric ?? Infinity;
  const bS = b.entity_locations?.[0]?.station_numeric ?? Infinity;
  return aS - bS;
})[0];

// Pick highest-station END (true end of main line)
const endJunction = endJunctions.sort((a, b) => {
  const aS = a.entity_locations?.[0]?.station_numeric ?? -Infinity;
  const bS = b.entity_locations?.[0]?.station_numeric ?? -Infinity;
  return bS - aS;
})[0];
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/tui/thepe && npx tsc --noEmit --skipLibCheck
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chat/graph-queries.ts
git commit -m "fix: use min/max station for BEGIN/END selection in branched utilities"
```

---

## Task 3: Reject Crossings Without Elevation

**Problem:** The vision prompt requires elevation for every real utility crossing ("elevation is REQUIRED for real crossings"). But `storeUtilityCrossings()` in `src/lib/vision/crossing-extractor.ts` maps ALL crossings to DB records, including those with `elevation: null`. This inflates crossing counts and can mislead a crew about crossings at a given station.

**Fix:** Filter out crossings without elevation before building the insert records. Log how many were skipped so it's visible in processing logs.

**Files:**
- Modify: `src/lib/vision/crossing-extractor.ts:72-98`

- [ ] **Step 1: Read the current mapping block**

Current code at lines 72–98 of `crossing-extractor.ts`:

```typescript
// Map to DB records
const crossingRecords = visionResult.utilityCrossings.map((crossing) => {
  const stationNumeric = crossing.station ? stationToNumeric(crossing.station) : null;

  return {
    project_id: projectId,
    document_id: documentId,
    chunk_id: chunkId,
    crossing_utility: crossing.crossingUtility,
    utility_full_name: crossing.utilityFullName,
    station: crossing.station || null,
    station_numeric: stationNumeric,
    elevation: crossing.elevation || null,
    is_existing: crossing.isExisting,
    is_proposed: crossing.isProposed,
    size: crossing.size || null,
    sheet_number: sheetNumber,
    notes: crossing.notes || null,
    source_type: 'vision',
    confidence: crossing.confidence,
    vision_data: {
      rawAnalysis: visionResult.rawAnalysis,
      sheetMetadata: visionResult.sheetMetadata,
      utilityCrossing: crossing
    }
  };
});
```

- [ ] **Step 2: Add elevation filter before the map**

Replace the `const crossingRecords = visionResult.utilityCrossings.map(...)` block with:

```typescript
// Filter: elevation is required for a real crossing — skip any without it
const validCrossings = visionResult.utilityCrossings.filter(
  (c) => c.elevation != null && c.elevation !== ''
);
const skippedCount = visionResult.utilityCrossings.length - validCrossings.length;
if (skippedCount > 0) {
  console.warn(
    `[Crossing Extractor] Skipped ${skippedCount} crossing(s) on sheet ${sheetNumber} ` +
    `without elevation data — elevation is required for reliable crossing records`
  );
}

if (validCrossings.length === 0) {
  return 0;
}

// Map to DB records
const crossingRecords = validCrossings.map((crossing) => {
  const stationNumeric = crossing.station ? stationToNumeric(crossing.station) : null;

  return {
    project_id: projectId,
    document_id: documentId,
    chunk_id: chunkId,
    crossing_utility: crossing.crossingUtility,
    utility_full_name: crossing.utilityFullName,
    station: crossing.station || null,
    station_numeric: stationNumeric,
    elevation: crossing.elevation || null,
    is_existing: crossing.isExisting,
    is_proposed: crossing.isProposed,
    size: crossing.size || null,
    sheet_number: sheetNumber,
    notes: crossing.notes || null,
    source_type: 'vision',
    confidence: crossing.confidence,
    vision_data: {
      rawAnalysis: visionResult.rawAnalysis,
      sheetMetadata: visionResult.sheetMetadata,
      utilityCrossing: crossing
    }
  };
});
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/tui/thepe && npx tsc --noEmit --skipLibCheck
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/vision/crossing-extractor.ts
git commit -m "fix: skip crossings without elevation — elevation required for reliable crossing records"
```

---

## Task 4: Confidence Signals in searchEntities Tool Response

**Problem:** Claude's answers look equally authoritative regardless of retrieval confidence. When `directLookup.confidence` is 0.55, the answer reads the same as when it's 0.95. A superintendent can't tell when to verify vs. trust.

**Architecture note:** The `systemPromptAddition` field returned by `routeQuery()` is discarded in `tools/index.ts` — only `result.formattedContext` is returned to Claude. So confidence language must be injected into the tool response text, not the system prompt.

**Thresholds:**
- `directLookup.confidence >= 0.85` → high: no note (the existing quantitative instructions are already authoritative)
- `directLookup.confidence >= 0.60` → medium: "Moderate confidence — field verification recommended for critical decisions"
- `directLookup.confidence < 0.60` → low: "Low confidence — data may be incomplete. Verify against source drawings before acting on this answer"
- No `directLookup` at all and `vectorResultCount === 0` → already handled by existing "no relevant context" message

**Files:**
- Modify: `src/lib/chat/tools/index.ts` (the `searchEntities` execute block)

- [ ] **Step 1: Read the current searchEntities execute block**

After Task 2 from the previous plan, the execute block currently looks like:

```typescript
execute: async ({ query, system }: { query: string; system?: string }): Promise<string> => {
  try {
    const result = await routeQuery(
      system ? `${query} ${system}` : query,
      projectId,
      { skipVisionDBLookup: false }
    )

    const warnings = result.routingWarnings ?? []
    const multiLineWarning = warnings.find(w => w.includes(WARNING_MULTIPLE_WATER_LINES))

    if (multiLineWarning && !system) {
      const baseResponse = result.formattedContext
        ? `Results searched across all systems:\n\n${result.formattedContext}`
        : 'No results found.'
      return `SYSTEM NOTE: This project has multiple named water lines. You must ask the user to specify which water line they mean (e.g., "Water Line A" or "Water Line B") before answering questions about this project's water lines. Do not assume or aggregate across lines without asking.\n\n${baseResponse}`
    }

    return result.formattedContext || 'No results found for that search.'
  } catch (err) {
    return `searchEntities error: ${err instanceof Error ? err.message : String(err)}`
  }
},
```

- [ ] **Step 2: Add confidence signal after the multi-system warning block**

Replace the final `return result.formattedContext || 'No results found for that search.'` with:

```typescript
    // Inject confidence signal based on directLookup quality
    const dl = result.directLookup
    let confidenceNote = ''
    if (dl && typeof dl.confidence === 'number') {
      if (dl.confidence < 0.60) {
        confidenceNote = 'CONFIDENCE: Low — data may be incomplete. Verify against source drawings before acting on this answer.\n\n'
      } else if (dl.confidence < 0.85) {
        confidenceNote = 'CONFIDENCE: Moderate — recommend field verification for critical decisions.\n\n'
      }
      // dl.confidence >= 0.85: high confidence, no note needed
    }

    return confidenceNote + (result.formattedContext || 'No results found for that search.')
```

The full execute block should now read:

```typescript
execute: async ({ query, system }: { query: string; system?: string }): Promise<string> => {
  try {
    const result = await routeQuery(
      system ? `${query} ${system}` : query,
      projectId,
      { skipVisionDBLookup: false }
    )

    const warnings = result.routingWarnings ?? []
    const multiLineWarning = warnings.find(w => w.includes(WARNING_MULTIPLE_WATER_LINES))

    if (multiLineWarning && !system) {
      const baseResponse = result.formattedContext
        ? `Results searched across all systems:\n\n${result.formattedContext}`
        : 'No results found.'
      return `SYSTEM NOTE: This project has multiple named water lines. You must ask the user to specify which water line they mean (e.g., "Water Line A" or "Water Line B") before answering questions about this project's water lines. Do not assume or aggregate across lines without asking.\n\n${baseResponse}`
    }

    // Inject confidence signal based on directLookup quality
    const dl = result.directLookup
    let confidenceNote = ''
    if (dl && typeof dl.confidence === 'number') {
      if (dl.confidence < 0.60) {
        confidenceNote = 'CONFIDENCE: Low — data may be incomplete. Verify against source drawings before acting on this answer.\n\n'
      } else if (dl.confidence < 0.85) {
        confidenceNote = 'CONFIDENCE: Moderate — recommend field verification for critical decisions.\n\n'
      }
    }

    return confidenceNote + (result.formattedContext || 'No results found for that search.')
  } catch (err) {
    return `searchEntities error: ${err instanceof Error ? err.message : String(err)}`
  }
},
```

- [ ] **Step 3: Verify TypeScript**

Check that `result.directLookup` is typed with a `confidence` field:

```bash
grep -n "directLookup\|DirectLookupResult\|confidence" /Users/tui/thepe/src/lib/chat/smart-router.ts | grep -i "type\|interface\|directLookup:" | head -10
```

If TypeScript complains about `dl.confidence` not existing, check the `QueryRoutingResult` type in `smart-router.ts` and use the correct field name.

```bash
cd /Users/tui/thepe && npx tsc --noEmit --skipLibCheck
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chat/tools/index.ts
git commit -m "feat: inject confidence signal into searchEntities tool response (Phase 7E)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Regenerate TypeScript types from migration 00047 — Task 1
- ✅ Graph BEGIN/END uniqueness for branched utilities — Task 2
- ✅ Crossing elevation enforcement — Task 3
- ✅ Phase 7E confidence signals in tool responses — Task 4

**Not covered (separate scope):**
- Phase 7F Memory dashboard (owner/editor view of aliases, corrections, recheck history)
- `item_type` schema ambiguity (requires a migration — separate plan)
- `searchComponents` tool confidence signal (returns pre-formatted strings with no directLookup; addressed separately if needed)

**Placeholder scan:** No TBD, no TODO, no "similar to above" patterns. All code blocks are complete.

**Type consistency:**
- `beginJunctions` / `endJunctions` use same type as the original `junctions` array — correct
- `validCrossings` uses same element type as `visionResult.utilityCrossings` — correct
- `dl.confidence` is a `number` with `typeof` guard before comparison — no type errors
