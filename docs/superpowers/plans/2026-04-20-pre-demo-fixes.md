# thepe Pre-Demo Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five highest-impact issues blocking a credible demo to a paying construction customer.

**Architecture:** thepe is a Next.js app with a Supabase backend. The chat system is an agentic Claude loop — Claude calls tools, tools call retrieval functions. There is no fixed pipeline; Claude drives investigation. All changes are either API routes, tool response formatting, or UI components.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres + RLS), Vercel AI SDK `streamText`, Tailwind CSS, Claude claude-sonnet-4-5 via `@ai-sdk/anthropic`

---

## Files Modified / Created

| File | Action | Purpose |
|---|---|---|
| `src/lib/chat/tools/index.ts` | Modify | Surface routing warnings to Claude via searchEntities tool response |
| `src/app/api/chat/route.ts` | Modify | Remove stack trace from error response |
| `src/app/api/mobile/chat/route.ts` | Modify | Remove stack trace from error response |
| `src/app/api/projects/[id]/corrections/route.ts` | Create | POST correction capture endpoint |
| `src/components/chat/ChatInterface.tsx` | Modify | Add markdown rendering, Flag Issue button, correction modal, fix example prompts |

---

## Task 1: Apply Migration 00047 + Verify TypeScript

Migration 00047 creates the 5 tables needed for Phase 7 (project_memory_items, project_corrections, memory_confirmations, project_source_quality, recheck_sessions). It is written but not applied.

**Files:** N/A (shell commands only)

- [ ] **Step 1: Apply the migration**

```bash
cd /Users/tui/thepe
npx supabase db push
```

Expected output: `Applying migration 00047_project_memory...` then `Done.`

If you see auth errors, ensure `SUPABASE_SERVICE_ROLE_KEY` is in `.env`.

- [ ] **Step 2: Verify TypeScript still compiles clean**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no output (zero errors). If you see `as any` errors in `project-memory.ts`, they are pre-existing and acceptable until types are regenerated.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: apply migration 00047 (project memory tables)"
```

---

## Task 2: Surface Multi-System Warning to Claude

**Problem:** When a project has Water Line A and Water Line B, `autoDetectSystem()` in `smart-router.ts` returns `{ system: undefined, warnings: ['multiple_named_water_lines_detected...'] }`. The `searchEntities` tool in `tools/index.ts` calls `routeQuery()` but only returns `result.formattedContext` — it discards `result.routingWarnings`. Claude never sees the warning and can't ask for clarification. The user gets a silent over-broad result.

**Fix:** In `searchEntities` execute, check for the multi-system warning and prepend a system note to the tool response. Claude will then ask the user to specify which line they mean.

**Files:**
- Modify: `src/lib/chat/tools/index.ts:60-71`

- [ ] **Step 1: Read the current searchEntities execute block**

Current code at lines 60–71 of `src/lib/chat/tools/index.ts`:
```typescript
execute: async ({ query, system }: { query: string; system?: string }): Promise<string> => {
  try {
    const result = await routeQuery(
      system ? `${query} ${system}` : query,
      projectId,
      { skipVisionDBLookup: false }
    )
    return result.formattedContext || 'No results found for that search.'
  } catch (err) {
    return `searchEntities error: ${err instanceof Error ? err.message : String(err)}`
  }
},
```

- [ ] **Step 2: Replace with warning-aware version**

Replace lines 60–71 with:
```typescript
execute: async ({ query, system }: { query: string; system?: string }): Promise<string> => {
  try {
    const result = await routeQuery(
      system ? `${query} ${system}` : query,
      projectId,
      { skipVisionDBLookup: false }
    )

    const warnings = result.routingWarnings ?? []
    const multiLineWarning = warnings.find(w => w.includes('multiple_named_water_lines_detected'))

    if (multiLineWarning && !system) {
      // Extract which lines exist from the warning or leave generic
      const baseResponse = result.formattedContext
        ? `Results searched across all systems:\n\n${result.formattedContext}`
        : 'No results found.'
      return `SYSTEM NOTE: This project has multiple named water lines. You must ask the user to specify which water line they mean (e.g., "Water Line A" or "Water Line B") before giving a count or quantity answer. Do not aggregate across lines without asking.\n\n${baseResponse}`
    }

    return result.formattedContext || 'No results found for that search.'
  } catch (err) {
    return `searchEntities error: ${err instanceof Error ? err.message : String(err)}`
  }
},
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chat/tools/index.ts
git commit -m "fix: surface multi-system routing warning to Claude in searchEntities tool"
```

---

## Task 3: Remove Stack Trace from Error Responses

**Problem:** Both chat routes return `error.stack` to the client on failure. Stack traces expose internal file paths and can reveal implementation details to a customer's browser devtools.

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/app/api/mobile/chat/route.ts`

- [ ] **Step 1: Find the error response in chat/route.ts**

```bash
grep -n "stack\|details" /Users/tui/thepe/src/app/api/chat/route.ts
```

Expected: a line like `details: error instanceof Error ? error.stack : String(error)`

- [ ] **Step 2: Remove the `details` field from chat/route.ts**

Find the error return block and change it from:
```typescript
return new Response(
  JSON.stringify({
    error: error instanceof Error ? error.message : 'Chat request failed',
    details: error instanceof Error ? error.stack : String(error),
  }),
  { status: 500, headers: { 'Content-Type': 'application/json' } }
)
```

To:
```typescript
return new Response(
  JSON.stringify({
    error: error instanceof Error ? error.message : 'Chat request failed',
  }),
  { status: 500, headers: { 'Content-Type': 'application/json' } }
)
```

- [ ] **Step 3: Do the same in mobile/chat/route.ts**

```bash
grep -n "stack\|details" /Users/tui/thepe/src/app/api/mobile/chat/route.ts
```

Apply the same removal. If there is no `details` field there, skip this step.

- [ ] **Step 4: Compile check and commit**

```bash
npx tsc --noEmit --skipLibCheck
git add src/app/api/chat/route.ts src/app/api/mobile/chat/route.ts
git commit -m "fix: remove stack traces from chat error responses"
```

---

## Task 4: Correction Capture API

**Purpose:** Field workers need a way to flag wrong answers. This endpoint stores the correction and auto-promotes it to project memory if submitted by a superintendent or PE (trust weight ≥ 2.0). Without this, the system can never learn from mistakes.

**Depends on:** Task 1 (migration 00047 must be applied — creates `project_corrections` and `project_memory_items` tables).

**Files:**
- Create: `src/app/api/projects/[id]/corrections/route.ts`

Trust weights (from architecture doc):
- `PE`: 3.0
- `superintendent`: 2.0
- `admin`: 2.5
- `engineer`: 1.0
- `foreman`: 1.0

- [ ] **Step 1: Create the route file**

Create `src/app/api/projects/[id]/corrections/route.ts` with this content:

```typescript
/**
 * POST /api/projects/[id]/corrections
 *
 * Captures a user correction on a chat answer.
 * If submitted by a superintendent, PE, or admin (trust weight >= 2.0),
 * the correction is auto-promoted to project_memory_items (accepted).
 * Lower-trust submissions stay pending until confirmed.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'

const TRUST_WEIGHTS: Record<string, number> = {
  PE: 3.0,
  superintendent: 2.0,
  admin: 2.5,
  engineer: 1.0,
  foreman: 1.0,
}

const AUTO_ACCEPT_THRESHOLD = 2.0

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = params.id
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Verify project membership
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership || !['owner', 'editor'].includes(membership.role)) {
      return new Response('Forbidden — owner or editor role required', { status: 403 })
    }

    const body = await request.json()

    const {
      query_text,
      query_answer_mode,
      sheet_number,
      discipline,
      system_queried,
      expected_item,
      missed_item_type,
      how_it_appeared,
      ai_response_excerpt,
      ai_detected_value,
      ai_confidence,
      expected_value,
      submitted_by_role,
      evidence_reference,
      notes,
    } = body

    if (!query_text || !expected_value || !submitted_by_role) {
      return NextResponse.json(
        { error: 'query_text, expected_value, and submitted_by_role are required' },
        { status: 400 }
      )
    }

    const trustWeight = TRUST_WEIGHTS[submitted_by_role] ?? 1.0

    // Write the correction
    const { data: correction, error: correctionError } = await supabase
      .from('project_corrections')
      .insert({
        project_id: projectId,
        user_id: user.id,
        query_text,
        query_answer_mode: query_answer_mode ?? null,
        sheet_number: sheet_number ?? null,
        discipline: discipline ?? null,
        system_queried: system_queried ?? null,
        expected_item: expected_item ?? null,
        missed_item_type: missed_item_type ?? null,
        how_it_appeared: how_it_appeared ?? null,
        ai_response_excerpt: ai_response_excerpt ?? null,
        ai_detected_value: ai_detected_value ?? null,
        ai_confidence: ai_confidence ?? null,
        expected_value,
        submitted_by_role,
        evidence_reference: evidence_reference ?? null,
        notes: notes ?? null,
        validation_status: 'pending',
      })
      .select()
      .single()

    if (correctionError || !correction) {
      console.error('[Corrections] Insert error:', correctionError)
      return NextResponse.json(
        { error: 'Failed to save correction' },
        { status: 500 }
      )
    }

    // Auto-promote to project memory if trust weight meets threshold
    let memoryItemId: string | null = null
    if (trustWeight >= AUTO_ACCEPT_THRESHOLD) {
      const { data: memoryItem, error: memoryError } = await supabase
        .from('project_memory_items')
        .insert({
          project_id: projectId,
          item_type: 'correction',
          original_text: ai_detected_value ?? query_text,
          normalized_value: expected_value,
          discipline: discipline ?? null,
          system_context: system_queried ?? null,
          source_type: 'user_correction',
          submitted_by: user.id,
          submitted_by_role,
          validation_status: 'accepted',
          correction_id: correction.id,
        })
        .select()
        .single()

      if (memoryError) {
        console.error('[Corrections] Memory item insert error:', memoryError)
        // Non-fatal — correction was saved, memory promotion failed
      } else {
        memoryItemId = memoryItem?.id ?? null
      }
    }

    return NextResponse.json({
      success: true,
      correctionId: correction.id,
      autoAccepted: trustWeight >= AUTO_ACCEPT_THRESHOLD,
      memoryItemId,
    })
  } catch (error) {
    console.error('[Corrections] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process correction' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Compile check**

```bash
npx tsc --noEmit --skipLibCheck
```

If you see errors about missing columns (e.g., `correction_id` not in `project_memory_items`), check the migration 00047 schema and adjust the insert to match the actual column names.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/[id]/corrections/route.ts
git commit -m "feat: add correction capture API (Phase 7C)"
```

---

## Task 5: Flag Issue Button + Modal in ChatInterface

**Purpose:** Give field workers a visible way to flag wrong answers. This completes the Phase 7C loop — without the UI, no one will use the corrections API.

**Also fixes:**
- Example prompts ("ammunition storage requirements" → construction-appropriate examples)
- Renders assistant messages as formatted text (markdown-like whitespace handling was already there via `whitespace-pre-wrap`)

**Files:**
- Modify: `src/components/chat/ChatInterface.tsx`

- [ ] **Step 1: Read the current message rendering block**

Current at lines 178–215 of `ChatInterface.tsx`:
```tsx
{messages.map((message) => (
  <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
    <div className={`max-w-[80%] rounded-lg px-4 py-2 ${message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
      {/* ... assistant header ... */}
      <div className="text-sm whitespace-pre-wrap">{message.content}</div>
    </div>
  </div>
))}
```

- [ ] **Step 2: Add modal state and submission logic**

At the top of the `ChatInterface` component body, after the existing `useState` hooks, add:

```tsx
const [flagModal, setFlagModal] = useState<{
  messageId: string
  messageContent: string
} | null>(null)
const [flagForm, setFlagForm] = useState({
  expected_value: '',
  submitted_by_role: 'engineer',
  sheet_number: '',
  notes: '',
})
const [flagSubmitting, setFlagSubmitting] = useState(false)
const [flagSuccess, setFlagSuccess] = useState(false)

const handleFlagSubmit = async () => {
  if (!flagModal || !flagForm.expected_value) return
  setFlagSubmitting(true)
  try {
    await fetch(`/api/projects/${projectId}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query_text: messages[messages.findIndex(m => m.id === flagModal.messageId) - 1]?.content ?? '',
        ai_response_excerpt: flagModal.messageContent.slice(0, 500),
        expected_value: flagForm.expected_value,
        submitted_by_role: flagForm.submitted_by_role,
        sheet_number: flagForm.sheet_number || null,
        notes: flagForm.notes || null,
      }),
    })
    setFlagSuccess(true)
    setTimeout(() => {
      setFlagModal(null)
      setFlagSuccess(false)
      setFlagForm({ expected_value: '', submitted_by_role: 'engineer', sheet_number: '', notes: '' })
    }, 1500)
  } catch {
    // silent — user already flagged
  } finally {
    setFlagSubmitting(false)
  }
}
```

- [ ] **Step 3: Replace the message map block to add Flag Issue button**

Replace the `{messages.map((message) => (...))}` block with:

```tsx
{messages.map((message) => (
  <div
    key={message.id}
    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
  >
    <div className="max-w-[80%] space-y-1">
      <div
        className={`rounded-lg px-4 py-2 ${
          message.role === 'user'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-900'
        }`}
      >
        {message.role === 'assistant' && (
          <div className="flex items-center space-x-2 mb-2">
            <svg className="h-5 w-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span className="text-xs font-medium text-gray-500">Assistant</span>
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
      </div>
      {message.role === 'assistant' && message.content && (
        <div className="flex justify-start pl-1">
          <button
            onClick={() => setFlagModal({ messageId: message.id, messageContent: message.content })}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center space-x-1"
          >
            <span>⚑</span>
            <span>Flag Issue</span>
          </button>
        </div>
      )}
    </div>
  </div>
))}
```

- [ ] **Step 4: Add the modal just before the closing `</div>` of the component**

Before the final `</div>` closing tag of the `ChatInterface` return, add:

```tsx
{/* Flag Issue Modal */}
{flagModal && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Flag an Issue</h3>
        <button onClick={() => setFlagModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
      </div>

      {flagSuccess ? (
        <p className="text-green-600 text-sm font-medium">Correction saved. Thank you.</p>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              What should the correct answer be? *
            </label>
            <textarea
              value={flagForm.expected_value}
              onChange={e => setFlagForm(f => ({ ...f, expected_value: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              rows={3}
              placeholder="e.g. There are 14 gate valves, not 12. Sheet C-003 shows 2 additional at Sta 12+50."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Role</label>
              <select
                value={flagForm.submitted_by_role}
                onChange={e => setFlagForm(f => ({ ...f, submitted_by_role: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              >
                <option value="PE">PE</option>
                <option value="superintendent">Superintendent</option>
                <option value="admin">Admin</option>
                <option value="engineer">Engineer</option>
                <option value="foreman">Foreman</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sheet Number</label>
              <input
                value={flagForm.sheet_number}
                onChange={e => setFlagForm(f => ({ ...f, sheet_number: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                placeholder="e.g. C-003"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input
              value={flagForm.notes}
              onChange={e => setFlagForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              placeholder="Additional context..."
            />
          </div>

          <div className="flex justify-end space-x-2">
            <button
              onClick={() => setFlagModal(null)}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleFlagSubmit}
              disabled={flagSubmitting || !flagForm.expected_value}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              {flagSubmitting ? 'Saving...' : 'Submit Correction'}
            </button>
          </div>
        </>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 5: Fix the example prompts**

Find the placeholder text block at lines 168–173:
```tsx
<p>"What are the ammunition storage requirements?"</p>
<p>"Summarize the safety protocols"</p>
<p>"When is the project timeline?"</p>
```

Replace with:
```tsx
<p>"How many gate valves are on Water Line A?"</p>
<p>"What is the bedding requirement for 12-inch DI pipe?"</p>
<p>"What does Sheet C-003 show at Sta 12+50?"</p>
```

- [ ] **Step 6: Compile check**

```bash
npx tsc --noEmit --skipLibCheck
```

Fix any TypeScript errors. Common issue: `setFlagModal` type mismatch — make sure `flagModal` state type matches what you pass in.

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/ChatInterface.tsx
git commit -m "feat: add Flag Issue button, correction modal, fix example prompts"
```

---

## Self-Review

**Spec coverage:**
- ✅ Apply migration 00047 — Task 1
- ✅ Surface multi-system suppression to Claude — Task 2
- ✅ Remove stack trace from error responses — Task 3
- ✅ Correction capture API (Phase 7C) — Task 4
- ✅ Flag Issue UI (Phase 7C) — Task 5
- ✅ Fix example prompts — Task 5 Step 5

**Not covered (deferred to Phase 7D–7F):**
- Crossing elevation enforcement — lower priority than the above
- Evidence evaluator — full Phase 7E
- Memory dashboard — Phase 7F
- Item_type schema ambiguity — requires migration

**Placeholder scan:** No TBD, no TODO, no "similar to above" patterns. All code blocks are complete.

**Type consistency:**
- `flagModal` used as `{ messageId: string; messageContent: string } | null` consistently
- `flagForm` used as `{ expected_value, submitted_by_role, sheet_number, notes }` consistently
- Corrections API body shape matches the insert object in Task 4
