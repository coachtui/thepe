# Utility Length Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix utility length calculation so thepe gives accurate answers (e.g., "3,262 LF" not "4,231 LF") for any project, globally, without manual corrections.

**Architecture:** Three stacked fixes: (1) normalize utility names at write time to eliminate name fragmentation, (2) add a `utility_length_canonical` table that stores one authoritative length per utility per project, (3) a consolidation step that runs after batch processing — it scopes termination point lookups to sheets dedicated to each utility, then re-runs a focused single-purpose vision prompt on the last sheet to read the END station directly. The read path queries canonical first and falls back to the existing RPC.

**Tech Stack:** TypeScript, Supabase (Postgres), Next.js App Router, Claude Vision API (via existing `analyzeSheetWithVision`)

---

## Files Modified/Created

| File | Action |
|---|---|
| `supabase/migrations/00048_utility_length_canonical.sql` | Create |
| `src/lib/vision/claude-vision.ts` | Modify — add `buildFocusedEndStationPrompt()`, `parseFocusedEndStationResult()` |
| `src/lib/vision/termination-extractor.ts` | Modify — add `normalizeUtilityName()`, `runFocusedEndStationExtraction()`, `consolidateUtilityLengths()`, update `storeTerminationPoints()` and `calculateLengthFromTerminations()` |
| `src/app/api/projects/[id]/analyze-complete/route.ts` | Modify — call `consolidateUtilityLengths()` after batch loop |

---

## Task 1: Migration — `utility_length_canonical` Table

**Files:**
- Create: `supabase/migrations/00048_utility_length_canonical.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/00048_utility_length_canonical.sql
CREATE TABLE utility_length_canonical (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  utility_name text NOT NULL,
  utility_type text,
  begin_station text,
  begin_station_numeric numeric,
  begin_sheet text,
  end_station text,
  end_station_numeric numeric,
  end_sheet text,
  length_lf numeric,
  confidence numeric,
  method text CHECK (method IN ('focused_reextraction', 'sheet_scoped', 'unscoped')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id, utility_name)
);

CREATE INDEX idx_utility_length_canonical_project
  ON utility_length_canonical(project_id);
```

- [ ] **Step 2: Apply the migration**

```bash
cd /Users/tui/thepe
npx supabase db push --linked
```

Expected: migration applies with no errors.

- [ ] **Step 3: Verify table exists**

```bash
cd /Users/tui/thepe && npx supabase db query --linked \
  "SELECT column_name FROM information_schema.columns WHERE table_name = 'utility_length_canonical' ORDER BY ordinal_position;" \
  2>&1 | grep -v "boundary\|warning\|Initialising\|untrusted"
```

Expected: rows for `id`, `project_id`, `utility_name`, `utility_type`, `begin_station`, `begin_station_numeric`, `begin_sheet`, `end_station`, `end_station_numeric`, `end_sheet`, `length_lf`, `confidence`, `method`, `created_at`, `updated_at`.

- [ ] **Step 4: Regenerate TypeScript types**

```bash
cd /Users/tui/thepe
npx supabase gen types typescript --project-id frhzemhbgcjjprfxgmgq > src/lib/db/supabase/types.ts
```

Expected: `utility_length_canonical` appears in the generated types file:
```bash
grep "utility_length_canonical" src/lib/db/supabase/types.ts | head -3
```

- [ ] **Step 5: Commit**

```bash
cd /Users/tui/thepe
git add supabase/migrations/00048_utility_length_canonical.sql src/lib/db/supabase/types.ts
git commit -m "feat: add utility_length_canonical table and regenerate types"
```

---

## Task 2: Name Normalization at Write Time

**Context:** `storeTerminationPoints()` in `src/lib/vision/termination-extractor.ts` maps each termination point to a DB record. It currently stores `point.utilityName` verbatim — quotes included. We add a `normalizeUtilityName()` function and call it before the insert.

**Files:**
- Modify: `src/lib/vision/termination-extractor.ts:34-62` (after `stationToNumeric`, before `inferUtilityType`)

- [ ] **Step 1: Add `normalizeUtilityName()` to termination-extractor.ts**

Insert this function between `stationToNumeric` (ends at line ~34) and `inferUtilityType` (starts at ~38):

```typescript
/**
 * Normalize utility name: strip quotes, collapse whitespace.
 * "Water Line 'A'" → "Water Line A"
 */
function normalizeUtilityName(name: string): string {
  return name
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
```

- [ ] **Step 2: Call normalizeUtilityName in storeTerminationPoints**

In `storeTerminationPoints()`, inside the `.map((point) => { ... })` block, change the `utility_name` line from:

```typescript
utility_name: point.utilityName,
```

to:

```typescript
utility_name: normalizeUtilityName(point.utilityName),
```

The full map block after the change should look like:

```typescript
.map((point) => {
  const stationNumeric = stationToNumeric(point.station);
  const utilityType = inferUtilityType(point.utilityName);

  return {
    project_id: projectId,
    document_id: documentId,
    chunk_id: chunkId,
    utility_name: normalizeUtilityName(point.utilityName),
    utility_type: utilityType,
    termination_type: point.terminationType,
    station: point.station,
    station_numeric: stationNumeric,
    sheet_number: sheetNumber,
    notes: point.notes || null,
    source_type: 'vision',
    confidence: point.confidence,
    vision_data: {
      rawAnalysis: visionResult.rawAnalysis,
      sheetMetadata: visionResult.sheetMetadata,
      terminationPoint: point
    }
  };
})
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/tui/thepe && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/tui/thepe
git add src/lib/vision/termination-extractor.ts
git commit -m "fix: normalize utility names at extraction time (strip quotes)"
```

---

## Task 3: Focused End-Station Prompt in claude-vision.ts

**Context:** `analyzeSheetWithVision(imageBuffer, options)` in `src/lib/vision/claude-vision.ts` accepts a `customPrompt` option that replaces the extraction instructions. We add two exports: a prompt builder for the focused end-station task, and a parser for its JSON output.

**Files:**
- Modify: `src/lib/vision/claude-vision.ts` — add two functions at the end of the file (before the final closing if any, or simply appended)

- [ ] **Step 1: Add buildFocusedEndStationPrompt and parseFocusedEndStationResult**

Append to the end of `src/lib/vision/claude-vision.ts`:

```typescript
/**
 * Focused prompt for reading the END station on the last sheet of a utility.
 * Used by consolidateUtilityLengths() — NOT the main extraction prompt.
 */
export function buildFocusedEndStationPrompt(utilityName: string): string {
  const upper = utilityName.toUpperCase()
  return `This is the LAST sheet of ${utilityName} in this project.
Your ONLY task: find the explicit END station label for ${utilityName}.

Look for text like "END ${upper} STA 32+62.01" — it is often:
- Rotated 90° vertically along the pipe in the profile view
- Near the right edge of the profile section
- Small font, stacked with other annotation text

Return ONLY valid JSON (no markdown, no explanation):
{ "endStation": "32+62.01", "confidence": 0.95 }

If you cannot find an explicit END label, return:
{ "endStation": null, "confidence": 0 }

Do NOT guess. Do NOT use match line stations (e.g. "SEE SHEET CUxxx").
Do NOT use profile grid labels. The END label explicitly says "END ${upper}".`
}

/**
 * Parse the JSON response from a focused end-station extraction call.
 */
export function parseFocusedEndStationResult(
  raw: string
): { endStation: string | null; confidence: number } {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```[a-z]*\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (typeof parsed.endStation === 'string' && parsed.endStation.trim()) {
      return {
        endStation: parsed.endStation.trim(),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
      }
    }
    return { endStation: null, confidence: 0 }
  } catch {
    return { endStation: null, confidence: 0 }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/tui/thepe && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/tui/thepe
git add src/lib/vision/claude-vision.ts
git commit -m "feat: add focused end-station vision prompt and parser"
```

---

## Task 4: consolidateUtilityLengths and runFocusedEndStationExtraction

**Context:** These two functions live in `src/lib/vision/termination-extractor.ts`. They need imports from `claude-vision.ts` that aren't currently imported. The file currently imports only `VisionAnalysisResult` from `./claude-vision`. We extend that import and add the two new functions.

**Files:**
- Modify: `src/lib/vision/termination-extractor.ts` — extend import, add two new exported/private functions

- [ ] **Step 1: Extend the import from claude-vision.ts**

Find the current import at the top of `termination-extractor.ts`:

```typescript
import type { VisionAnalysisResult } from './claude-vision';
```

Replace with:

```typescript
import type { VisionAnalysisResult } from './claude-vision';
import {
  analyzeSheetWithVision,
  buildFocusedEndStationPrompt,
  parseFocusedEndStationResult,
} from './claude-vision';
```

- [ ] **Step 2: Add runFocusedEndStationExtraction (private)**

Append this private function before the final export of the file (before `validateTerminationPoints` or at the end):

```typescript
/**
 * Fetch the last sheet of a utility by page_image_url and run the focused
 * end-station vision prompt against it.
 */
async function runFocusedEndStationExtraction(
  projectId: string,
  pageNumber: number,
  utilityName: string
): Promise<{ endStation: string | null; confidence: number }> {
  const supabase = createServiceRoleClient();

  const { data: page } = await supabase
    .from('document_pages')
    .select('page_image_url, sheet_number')
    .eq('project_id', projectId)
    .eq('page_number', pageNumber)
    .maybeSingle();

  if (!page?.page_image_url) {
    console.warn(`[Consolidate] No page_image_url for project ${projectId} page ${pageNumber}`);
    return { endStation: null, confidence: 0 };
  }

  try {
    // Fetch the pre-rendered image from storage
    const response = await fetch(page.page_image_url);
    if (!response.ok) {
      console.warn(`[Consolidate] Failed to fetch image: ${response.status}`);
      return { endStation: null, confidence: 0 };
    }
    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const customPrompt = buildFocusedEndStationPrompt(utilityName);
    const result = await analyzeSheetWithVision(imageBuffer, {
      customPrompt,
      taskType: 'extraction',
    });

    return parseFocusedEndStationResult(result.rawAnalysis ?? '');
  } catch (err) {
    console.error(`[Consolidate] Vision error for page ${pageNumber}:`, err);
    return { endStation: null, confidence: 0 };
  }
}
```

- [ ] **Step 3: Add consolidateUtilityLengths (exported)**

Append this exported function after `runFocusedEndStationExtraction`:

```typescript
/**
 * Post-processing step: for each distinct utility in utility_termination_points,
 * find its dedicated sheets via document_pages.sheet_title, run focused end-station
 * re-extraction on the last sheet, and write one authoritative row to
 * utility_length_canonical.
 *
 * Called at the end of the batch analyze route. Safe to call multiple times —
 * uses upsert on (project_id, utility_name).
 */
export async function consolidateUtilityLengths(projectId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  // 1. Get all distinct normalized utility names for this project
  const { data: nameRows } = await supabase
    .from('utility_termination_points')
    .select('utility_name')
    .eq('project_id', projectId);

  const uniqueNames = [...new Set((nameRows ?? []).map((r: any) => r.utility_name as string))];
  console.log(`[Consolidate] Processing ${uniqueNames.length} utilities for project ${projectId}`);

  for (const utilityName of uniqueNames) {
    // 2. Find dedicated sheets via sheet_title loose ILIKE match
    //    Split name into meaningful words, build %word1%word2% pattern
    const words = utilityName.split(' ').filter((w) => w.length > 1);
    const likePattern = `%${words.join('%')}%`;

    const { data: pages } = await supabase
      .from('document_pages')
      .select('page_number, sheet_number')
      .eq('project_id', projectId)
      .ilike('sheet_title', likePattern)
      .order('page_number', { ascending: false });

    const dedicatedSheets = pages ?? [];
    const dedicatedSheetNumbers = dedicatedSheets.map((p: any) => p.sheet_number as string);

    // 3. Find begin station: min BEGIN from dedicated sheets
    let beginStation = '0+00';
    let beginStationNumeric = 0;
    let beginSheet: string | null =
      dedicatedSheets[dedicatedSheets.length - 1]?.sheet_number ?? null;

    if (dedicatedSheetNumbers.length > 0) {
      const { data: begins } = await supabase
        .from('utility_termination_points')
        .select('station, station_numeric, sheet_number')
        .eq('project_id', projectId)
        .eq('utility_name', utilityName)
        .eq('termination_type', 'BEGIN')
        .in('sheet_number', dedicatedSheetNumbers)
        .order('station_numeric', { ascending: true })
        .limit(1);

      if (begins && begins[0]) {
        beginStation = (begins[0] as any).station;
        beginStationNumeric = parseFloat((begins[0] as any).station_numeric) || 0;
        beginSheet = (begins[0] as any).sheet_number;
      }
    }

    // 4. Focused re-extraction on the last dedicated sheet (sorted desc, so index 0)
    let endStation: string | null = null;
    let endStationNumeric: number | null = null;
    let endSheet: string | null = null;
    let confidence = 0.6;
    let method: 'focused_reextraction' | 'sheet_scoped' | 'unscoped' = 'unscoped';

    const lastPage = dedicatedSheets[0];
    if (lastPage) {
      const focusedResult = await runFocusedEndStationExtraction(
        projectId,
        (lastPage as any).page_number,
        utilityName
      );
      if (focusedResult.endStation) {
        endStation = focusedResult.endStation;
        endStationNumeric = stationToNumeric(focusedResult.endStation);
        endSheet = (lastPage as any).sheet_number;
        confidence = focusedResult.confidence;
        method = 'focused_reextraction';
      }
    }

    // 5. Fallback: max END station from dedicated sheets
    if (!endStation && dedicatedSheetNumbers.length > 0) {
      const { data: ends } = await supabase
        .from('utility_termination_points')
        .select('station, station_numeric, sheet_number')
        .eq('project_id', projectId)
        .eq('utility_name', utilityName)
        .eq('termination_type', 'END')
        .in('sheet_number', dedicatedSheetNumbers)
        .order('station_numeric', { ascending: false })
        .limit(1);

      if (ends && ends[0]) {
        endStation = (ends[0] as any).station;
        endStationNumeric = parseFloat((ends[0] as any).station_numeric) || null;
        endSheet = (ends[0] as any).sheet_number;
        confidence = 0.65;
        method = 'sheet_scoped';
      }
    }

    // 6. Skip if no end station found
    if (!endStation || endStationNumeric === null) {
      console.warn(`[Consolidate] No end station found for "${utilityName}" — skipping`);
      continue;
    }

    const lengthLf = endStationNumeric - beginStationNumeric;
    const utilityType = inferUtilityType(utilityName);

    // 7. Upsert one authoritative row
    const { error: upsertError } = await supabase
      .from('utility_length_canonical')
      .upsert(
        {
          project_id: projectId,
          utility_name: utilityName,
          utility_type: utilityType,
          begin_station: beginStation,
          begin_station_numeric: beginStationNumeric,
          begin_sheet: beginSheet,
          end_station: endStation,
          end_station_numeric: endStationNumeric,
          end_sheet: endSheet,
          length_lf: lengthLf,
          confidence,
          method,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'project_id,utility_name' }
      );

    if (upsertError) {
      console.error(`[Consolidate] Upsert error for "${utilityName}":`, upsertError);
    } else {
      console.log(
        `[Consolidate] ${utilityName}: ${lengthLf.toFixed(2)} LF (${method}, confidence ${confidence})`
      );
    }
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/tui/thepe && npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: no output. If there are errors about `utility_length_canonical` not being typed, confirm the types were regenerated in Task 1.

- [ ] **Step 5: Commit**

```bash
cd /Users/tui/thepe
git add src/lib/vision/termination-extractor.ts
git commit -m "feat: add consolidateUtilityLengths and focused end-station extraction"
```

---

## Task 5: Update calculateLengthFromTerminations to Query Canonical First

**Context:** `calculateLengthFromTerminations()` in `src/lib/vision/termination-extractor.ts` currently calls only the `calculate_utility_length` RPC. We prepend a canonical table lookup. If a canonical row exists, return it immediately. Otherwise fall through to the existing RPC.

**Files:**
- Modify: `src/lib/vision/termination-extractor.ts:199-242` (the `calculateLengthFromTerminations` function)

- [ ] **Step 1: Read the current function**

```bash
sed -n '199,242p' /Users/tui/thepe/src/lib/vision/termination-extractor.ts
```

Confirm it matches:
```typescript
export async function calculateLengthFromTerminations(
  projectId: string,
  utilityName: string
): Promise<{
  utilityName: string;
  beginStation: string;
  endStation: string;
  beginSheet: string;
  endSheet: string;
  lengthLf: number;
  confidence: number;
  method: string;
} | null> {
  const supabase = createServiceRoleClient();

  try {
    const { data, error } = await (supabase as any).rpc('calculate_utility_length', {
      p_project_id: projectId,
      p_utility_name: utilityName
    });
    // ...
  }
}
```

- [ ] **Step 2: Replace the function body**

Replace the entire `calculateLengthFromTerminations` function with:

```typescript
export async function calculateLengthFromTerminations(
  projectId: string,
  utilityName: string
): Promise<{
  utilityName: string;
  beginStation: string;
  endStation: string;
  beginSheet: string;
  endSheet: string;
  lengthLf: number;
  confidence: number;
  method: string;
} | null> {
  const supabase = createServiceRoleClient();
  const normalizedName = normalizeUtilityName(utilityName);

  // 1. Try canonical table first (most accurate — populated by consolidateUtilityLengths)
  try {
    const { data: canonical } = await supabase
      .from('utility_length_canonical')
      .select('*')
      .eq('project_id', projectId)
      .ilike('utility_name', normalizedName)
      .maybeSingle();

    if (canonical) {
      return {
        utilityName: (canonical as any).utility_name,
        beginStation: (canonical as any).begin_station ?? '0+00',
        endStation: (canonical as any).end_station,
        beginSheet: (canonical as any).begin_sheet ?? '',
        endSheet: (canonical as any).end_sheet ?? '',
        lengthLf: parseFloat((canonical as any).length_lf),
        confidence: parseFloat((canonical as any).confidence),
        method: (canonical as any).method,
      };
    }
  } catch (err) {
    console.warn('[calculateLengthFromTerminations] Canonical lookup failed, falling back:', err);
  }

  // 2. Fall back to existing RPC (unscoped — lower accuracy)
  try {
    const { data, error } = await (supabase as any).rpc('calculate_utility_length', {
      p_project_id: projectId,
      p_utility_name: utilityName,
    });

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return {
      utilityName: data[0].utility_name,
      beginStation: data[0].begin_station,
      endStation: data[0].end_station,
      beginSheet: data[0].begin_sheet,
      endSheet: data[0].end_sheet,
      lengthLf: parseFloat(data[0].length_lf),
      confidence: parseFloat(data[0].confidence),
      method: data[0].method,
    };
  } catch (error) {
    console.error('Error calculating length from terminations:', error);
    return null;
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/tui/thepe && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/tui/thepe
git add src/lib/vision/termination-extractor.ts
git commit -m "feat: query utility_length_canonical first in calculateLengthFromTerminations"
```

---

## Task 6: Trigger Consolidation After Batch Analysis

**Context:** `src/app/api/projects/[id]/analyze-complete/route.ts` runs batch vision processing. After the document loop completes (around line 143), we call `consolidateUtilityLengths()`. It is non-fatal — a consolidation error does not fail the overall response.

**Files:**
- Modify: `src/app/api/projects/[id]/analyze-complete/route.ts`

- [ ] **Step 1: Add the import**

At the top of `route.ts`, find the existing imports. Add:

```typescript
import { consolidateUtilityLengths } from '@/lib/vision/termination-extractor';
```

- [ ] **Step 2: Call consolidation after the batch loop**

Find the log line after the batch results loop:

```typescript
console.log(`[Batch Analysis] Complete! Processed ${totalSheetsProcessed} sheets, extracted ${totalQuantitiesExtracted} quantities`);
```

Insert the consolidation call immediately after that line (before the `project_quantity_summary` query):

```typescript
console.log(`[Batch Analysis] Complete! Processed ${totalSheetsProcessed} sheets, extracted ${totalQuantitiesExtracted} quantities`);

// Run utility length consolidation — non-fatal if it fails
console.log('[Batch Analysis] Running utility length consolidation...');
try {
  await consolidateUtilityLengths(projectId);
  console.log('[Batch Analysis] Utility length consolidation complete');
} catch (consolidationErr) {
  console.error('[Batch Analysis] Consolidation error (non-fatal):', consolidationErr);
}

// Query aggregated summary
const { data: summary } = await supabase
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/tui/thepe && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/tui/thepe
git add src/app/api/projects/[id]/analyze-complete/route.ts
git commit -m "feat: run utility length consolidation after batch analysis"
```

---

## Task 7: Integration Verification on Ammunition Project

**Context:** The Ammunition Storage project (project_id: `c455e726-b3b4-4f87-97e9-70a89ec17228`) is already fully processed. We manually trigger consolidation to verify the pipeline produces correct results. Known ground truth: Water Line A = 3,262.01 LF, Water Line B = 3,111.05 LF.

**Files:** No code changes — this is a manual verification step.

- [ ] **Step 1: Run consolidation manually via a script**

Create a temporary script `/tmp/run-consolidate.mjs`:

```javascript
// /tmp/run-consolidate.mjs
// Run with: node --loader ts-node/esm /tmp/run-consolidate.mjs
// Or: npx tsx /tmp/run-consolidate.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PROJECT_ID = 'c455e726-b3b4-4f87-97e9-70a89ec17228'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const { data, error } = await supabase
  .from('utility_length_canonical')
  .select('utility_name, length_lf, method, confidence')
  .eq('project_id', PROJECT_ID)
  .order('utility_name')

console.log('Before consolidation:')
console.log(JSON.stringify(data, null, 2))
```

Actually — the simplest approach is to trigger it via the API endpoint. Start the dev server and POST to the route:

```bash
cd /Users/tui/thepe && npm run dev &
sleep 5
curl -s -X POST http://localhost:3000/api/projects/c455e726-b3b4-4f87-97e9-70a89ec17228/analyze-complete \
  -H "Content-Type: application/json" \
  -d '{"forceReprocess": false}' | jq '.documentsProcessed, .totalSheetsProcessed'
```

**Or** — since documents are already processed and `forceReprocess: false` will skip them, consolidation will still run. Check the server logs for `[Consolidate]` lines showing the results.

- [ ] **Step 2: Query the canonical table to verify results**

```bash
cd /Users/tui/thepe && npx supabase db query --linked \
  "SELECT utility_name, length_lf, method, confidence FROM utility_length_canonical WHERE project_id = 'c455e726-b3b4-4f87-97e9-70a89ec17228' AND utility_name ILIKE '%water line%' ORDER BY utility_name;" \
  2>&1 | grep -v "boundary\|warning\|Initialising\|untrusted"
```

Expected:
- `Water Line A`: `length_lf` between 3257 and 3267, `method = focused_reextraction`
- `Water Line B`: `length_lf` between 3106 and 3116, `method = focused_reextraction`

If `method = sheet_scoped` instead of `focused_reextraction`, it means the focused vision call couldn't find the END label — check the dev server logs for the specific error.

- [ ] **Step 3: Confirm no TypeScript errors**

```bash
cd /Users/tui/thepe && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

Expected: no output.

---

## Self-Review

**Spec coverage:**
- ✅ Name normalization — Task 2
- ✅ `utility_length_canonical` table — Task 1
- ✅ Focused end-station prompt — Task 3
- ✅ `consolidateUtilityLengths()` + `runFocusedEndStationExtraction()` — Task 4
- ✅ Updated `calculateLengthFromTerminations()` — Task 5
- ✅ Trigger after batch analysis — Task 6
- ✅ Integration verification — Task 7

**Edge cases from spec:**
- ✅ Quote variants in sheet_title ILIKE: loose `%word%word%` pattern handles "WATER LINE 'A'"
- ✅ No dedicated sheets: falls back to `sheet_scoped` or `unscoped` RPC
- ✅ Focused extraction returns null: falls back to max END from dedicated sheets
- ✅ Called twice: upsert on `(project_id, utility_name)` overwrites
- ✅ Sub-line utilities (A1, A2): each gets its own row; normalization keeps them distinct

**No placeholders:** All steps contain actual code. No TBD/TODO.

**Type consistency:** `normalizeUtilityName` defined in Task 2, used in Task 5. `consolidateUtilityLengths` defined in Task 4, imported in Task 6. `buildFocusedEndStationPrompt` / `parseFocusedEndStationResult` defined in Task 3, imported in Task 4. All consistent.
