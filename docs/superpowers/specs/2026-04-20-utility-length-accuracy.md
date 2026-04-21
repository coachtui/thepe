# Utility Length Accuracy — Design Spec

**Date:** 2026-04-20
**Scope:** Global pipeline fix for utility length calculation accuracy

---

## Problem

When a field user asks "how long is Water Line A?", thepe gives wrong answers. Root cause analysis on the Ammunition Storage project confirmed three compounding failures:

1. **Name fragmentation.** Vision extraction stores "Water Line 'A'" and "Water Line A" as separate entities. Queries that match on name miss half the records or return results from the wrong utility.

2. **Cross-sheet contamination.** Non-utility sheets (site plans, road plans) reference utility names in notes. The extraction treats these as termination points, creating records with wrong stations at high confidence. Example: the first water line sheet (CU102) produced a 0.95-confidence END record at STA 44+00 — completely wrong.

3. **Vision misread on the actual utility sheet.** Even the correct last sheet (CU109) returned STA 36+00 instead of the actual END at STA 32+62.01. The END label is rotated 90°, small font, and the model gets distracted by match line stations and profile grid lines when given a general-purpose prompt.

Confidence filtering does not solve this — the highest-confidence records are among the most wrong.

**Observed error for Ammunition project:**
- Water Line A: AI reported ~4,231 LF, actual is 3,262 LF
- Water Line B: AI reported ~2,941 LF, actual is 3,111 LF

---

## Architecture

Three changes that stack:

```
WRITE PATH
  termination-extractor.ts
    → normalizeUtilityName()        [NEW: strip quotes before insert]
    → utility_termination_points    [existing, cleaner data]

CONSOLIDATION PATH (new, runs after batch analysis)
  consolidateUtilityLengths(projectId)
    → document_pages (sheet_title ILIKE match)  → dedicated sheet list
    → last dedicated sheet (highest page number) → focused re-extraction
    → focused vision prompt                      → end station string
    → sheet-scoped termination points            → begin station
    → utility_length_canonical                   [NEW: one row per utility]

READ PATH
  calculateLengthFromTerminations()
    → utility_length_canonical (first)           [NEW: authoritative]
    → sheet-scoped termination_points (fallback)
    → unscoped termination_points (last resort, LOW CONFIDENCE flag)
```

---

## Files Modified

| File | Change |
|---|---|
| `src/lib/vision/termination-extractor.ts` | Add `normalizeUtilityName()`, call before insert |
| `src/lib/vision/termination-extractor.ts` | Update `calculateLengthFromTerminations()` to query canonical table first |
| `src/lib/vision/termination-extractor.ts` | Add `consolidateUtilityLengths(projectId)` |
| `src/lib/vision/claude-vision.ts` | Add `buildFocusedEndStationPrompt(utilityName)` and `parseFocusedEndStationResult()` |
| `src/app/api/projects/[id]/analyze-complete/route.ts` | Call `consolidateUtilityLengths()` after batch processing |
| `supabase/migrations/00048_utility_length_canonical.sql` | New table + index |

---

## Section 1: Name Normalization

**File:** `src/lib/vision/termination-extractor.ts`

Add a pure function at the top of the file:

```typescript
function normalizeUtilityName(name: string): string {
  return name
    .replace(/['"]/g, '')   // strip all quote characters
    .replace(/\s+/g, ' ')   // collapse whitespace
    .trim()
}
```

Call it in `storeTerminationPoints()` before building insert records:

```typescript
utility_name: normalizeUtilityName(point.utilityName),
```

**Invariant:** Every row in `utility_termination_points` has a quote-free utility name after this change. Historical data is not backfilled (it would require a migration that's out of scope — new projects benefit immediately).

---

## Section 2: `utility_length_canonical` Table

**File:** `supabase/migrations/00048_utility_length_canonical.sql`

```sql
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

CREATE INDEX idx_utility_length_canonical_project ON utility_length_canonical(project_id);
```

---

## Section 3: Focused Re-Extraction Prompt

**File:** `src/lib/vision/claude-vision.ts`

Add a focused prompt builder used only during consolidation (not the main extraction prompt):

```typescript
export function buildFocusedEndStationPrompt(utilityName: string): string {
  return `This is the LAST sheet of ${utilityName} in this project.
Your ONLY task: find the explicit END station label for ${utilityName}.

Look for text like "END ${utilityName.toUpperCase()} STA 32+62.01" — it is often:
- Rotated 90° vertically along the pipe in the profile view
- Near the right edge of the profile section
- Small font, stacked with other annotation text

Return ONLY valid JSON:
{ "endStation": "32+62.01", "confidence": 0.95 }

If you cannot find an explicit END label, return:
{ "endStation": null, "confidence": 0 }

Do NOT guess. Do NOT use match line stations. Do NOT use profile grid labels.
The END label explicitly says "END ${utilityName.toUpperCase()}"`;
}

export function parseFocusedEndStationResult(
  raw: string
): { endStation: string | null; confidence: number } {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed.endStation === 'string' && parsed.endStation.trim()) {
      return { endStation: parsed.endStation.trim(), confidence: parsed.confidence ?? 0.9 }
    }
    return { endStation: null, confidence: 0 }
  } catch {
    return { endStation: null, confidence: 0 }
  }
}
```

---

## Section 4: Consolidation Function

**File:** `src/lib/vision/termination-extractor.ts`

New exported function called after batch analysis:

```typescript
export async function consolidateUtilityLengths(projectId: string): Promise<void> {
  const supabase = createServiceRoleClient()

  // 1. Get all distinct normalized utility names for this project
  const { data: names } = await supabase
    .from('utility_termination_points')
    .select('utility_name')
    .eq('project_id', projectId)

  const uniqueNames = [...new Set((names ?? []).map(r => r.utility_name))]

  for (const utilityName of uniqueNames) {
    // 2. Find dedicated sheets: document_pages where sheet_title mentions this utility
    //    Use a loose match: split utility name into words, match all present
    const words = utilityName.split(' ').filter(w => w.length > 1)
    const likePattern = `%${words.join('%')}%`

    const { data: pages } = await supabase
      .from('document_pages')
      .select('page_number, sheet_number')
      .eq('project_id', projectId)  // if column exists; else join via document
      .ilike('sheet_title', likePattern)
      .order('page_number', { ascending: false })

    const dedicatedSheets = pages ?? []
    const dedicatedSheetNumbers = dedicatedSheets.map(p => p.sheet_number)

    // 3. Find begin station: min BEGIN from dedicated sheets only
    let beginStation = '0+00'
    let beginStationNumeric = 0
    let beginSheet = dedicatedSheets[dedicatedSheets.length - 1]?.sheet_number ?? null

    if (dedicatedSheetNumbers.length > 0) {
      const { data: begins } = await supabase
        .from('utility_termination_points')
        .select('station, station_numeric, sheet_number')
        .eq('project_id', projectId)
        .eq('utility_name', utilityName)
        .eq('termination_type', 'BEGIN')
        .in('sheet_number', dedicatedSheetNumbers)
        .order('station_numeric', { ascending: true })
        .limit(1)

      if (begins && begins[0]) {
        beginStation = begins[0].station
        beginStationNumeric = begins[0].station_numeric
        beginSheet = begins[0].sheet_number
      }
    }

    // 4. Focused re-extraction on the last dedicated sheet
    let endStation: string | null = null
    let endStationNumeric: number | null = null
    let endSheet: string | null = null
    let confidence = 0.6
    let method: 'focused_reextraction' | 'sheet_scoped' | 'unscoped' = 'unscoped'

    const lastPage = dedicatedSheets[0] // already sorted desc
    if (lastPage) {
      const focusedResult = await runFocusedEndStationExtraction(
        projectId,
        lastPage.page_number,
        utilityName
      )
      if (focusedResult.endStation) {
        endStation = focusedResult.endStation
        endStationNumeric = stationToNumeric(focusedResult.endStation)
        endSheet = lastPage.sheet_number
        confidence = focusedResult.confidence
        method = 'focused_reextraction'
      }
    }

    // 5. Fallback: max END from dedicated sheets
    if (!endStation && dedicatedSheetNumbers.length > 0) {
      const { data: ends } = await supabase
        .from('utility_termination_points')
        .select('station, station_numeric, sheet_number')
        .eq('project_id', projectId)
        .eq('utility_name', utilityName)
        .eq('termination_type', 'END')
        .in('sheet_number', dedicatedSheetNumbers)
        .order('station_numeric', { ascending: false })
        .limit(1)

      if (ends && ends[0]) {
        endStation = ends[0].station
        endStationNumeric = ends[0].station_numeric
        endSheet = ends[0].sheet_number
        confidence = 0.65
        method = 'sheet_scoped'
      }
    }

    // 6. Skip utilities with no usable end station
    if (!endStation || endStationNumeric === null) {
      console.warn(`[Consolidate] No end station found for "${utilityName}" — skipping`)
      continue
    }

    const lengthLf = endStationNumeric - beginStationNumeric
    const utilityType = inferUtilityType(utilityName)

    // 7. Upsert canonical record
    await supabase
      .from('utility_length_canonical')
      .upsert({
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
      }, { onConflict: 'project_id,utility_name' })

    console.log(`[Consolidate] ${utilityName}: ${lengthLf.toFixed(2)} LF (${method}, confidence ${confidence})`)
  }
}
```

**Helper** (new private function in same file):

```typescript
async function runFocusedEndStationExtraction(
  projectId: string,
  pageNumber: number,
  utilityName: string
): Promise<{ endStation: string | null; confidence: number }> {
  const supabase = createServiceRoleClient()

  // Run focused vision call using existing analyzeSheetWithVision infrastructure
  // document_pages.page_image_url is the pre-rendered image URL for this page
  const { data: page } = await supabase
    .from('document_pages')
    .select('page_image_url, sheet_number')
    .eq('project_id', projectId)
    .eq('page_number', pageNumber)
    .single()

  if (!page?.page_image_url) return { endStation: null, confidence: 0 }

  const prompt = buildFocusedEndStationPrompt(utilityName)
  const result = await analyzeSheetWithVision(page.page_image_url, { customPrompt: prompt })
  return parseFocusedEndStationResult(result.rawAnalysis ?? '')
}
```

---

## Section 5: Updated `calculateLengthFromTerminations()`

**File:** `src/lib/vision/termination-extractor.ts`

Update the existing function to query canonical first:

```typescript
export async function calculateLengthFromTerminations(
  projectId: string,
  utilityName: string
): Promise<{
  utilityName: string; beginStation: string; endStation: string;
  beginSheet: string; endSheet: string; lengthLf: number;
  confidence: number; method: string;
} | null> {
  const supabase = createServiceRoleClient()
  const normalizedName = normalizeUtilityName(utilityName)

  // 1. Try canonical table first (most accurate)
  const { data: canonical } = await supabase
    .from('utility_length_canonical')
    .select('*')
    .eq('project_id', projectId)
    .ilike('utility_name', normalizedName)
    .single()

  if (canonical) {
    return {
      utilityName: canonical.utility_name,
      beginStation: canonical.begin_station,
      endStation: canonical.end_station,
      beginSheet: canonical.begin_sheet,
      endSheet: canonical.end_sheet,
      lengthLf: canonical.length_lf,
      confidence: canonical.confidence,
      method: canonical.method,
    }
  }

  // 2. Fall back to existing RPC (unscoped, lower accuracy)
  // (existing calculate_utility_length RPC call stays here as before)
  const { data, error } = await (supabase as any).rpc('calculate_utility_length', {
    p_project_id: projectId,
    p_utility_name: utilityName,
  })
  // ... existing handling unchanged
}
```

---

## Section 6: Trigger Consolidation After Batch Analysis

**File:** `src/app/api/projects/[id]/analyze-complete/route.ts`

After the existing batch processing loop completes, add:

```typescript
// Run length consolidation after all documents are processed
console.log('[Batch Analysis] Running utility length consolidation...')
try {
  await consolidateUtilityLengths(projectId)
  console.log('[Batch Analysis] Utility length consolidation complete')
} catch (err) {
  // Non-fatal: log and continue, main processing already succeeded
  console.error('[Batch Analysis] Consolidation error (non-fatal):', err)
}
```

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Utility name has quotes in sheet_title ILIKE match | Loose `%WATER%LINE%A%` pattern matches regardless of quote style |
| No dedicated sheets found | Skip re-extraction; fall back to unscoped RPC with LOW CONFIDENCE flag |
| Focused re-extraction returns null end station | Fall back to max END from dedicated-sheet-scoped termination points |
| `consolidateUtilityLengths()` called twice (reprocessing) | Upsert on `(project_id, utility_name)` overwrites with fresh result |
| Sub-line utilities (Water Line A1, Water Line A2) | Each gets its own canonical row; name normalization keeps them distinct |
| Utility spans multiple documents in one project | `document_pages` query covers all documents if project_id is available on that table; otherwise join via documents table |

---

## Testing

**Unit tests:**
- `normalizeUtilityName()` with: `"Water Line 'A'"`, `"WATER LINE \"B\""`, `" Road  'A' "`, `"Storm Drain A"` (no quotes — passthrough)

**Integration test (Ammunition project):**
- Call `consolidateUtilityLengths('c455e726-b3b4-4f87-97e9-70a89ec17228')`
- Assert `utility_length_canonical` row for "Water Line A": `length_lf` within 5 LF of 3262.01
- Assert `utility_length_canonical` row for "Water Line B": `length_lf` within 5 LF of 3111.05
- Assert `method = 'focused_reextraction'` on both rows

**Regression check:**
- After changes, query "how long is Water Line A?" via thepe chat and confirm the answer cites 3,262 LF with method `focused_reextraction`
