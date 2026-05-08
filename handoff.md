# Handoff

Last updated: 2026-05-06 (Submittal register section title backfill script)

---

## What Was Done This Session

### 1. Read path pagination fix — `src/lib/chat/submittal-register-read.ts`
Added `fetchAllSubmittalRegisterItems` helper that fetches all rows using `.range()` in batches of 1,000, bypassing the Supabase PostgREST default cap. Confirmed actual item count is **1,250** (not 1,221 as earlier estimated — count grew since last extraction run).

### 2. Section title backfill script — `scripts/backfill-submittal-section-titles.ts`
One-time backfill that:
- Reads 33 spec_section entities from `project_entities` (those extracted by the standard pipeline)
- Builds a `sectionNumber → display_name` map
- Updates `submittal_register_items.section_title` (column) and `item_payload.sectionTitle` (JSON) for matching rows
- Dry-run by default, execute with `--execute` flag
- Dry-run confirmed: **653 of 1,250 rows** will receive real titles (33 of 70 sections resolved)

**Sections that will be resolved (sample):**
- `28 31 70` → "INTERIOR FIRE ALARM SYSTEM, ADDRESSABLE"
- `22 00 00` → "PLUMBING, GENERAL PURPOSE"
- `13 34 19` → "METAL BUILDING SYSTEMS"
- `31 00 00` → "EARTHWORK"
- `21 13 13` → "WET PIPE SPRINKLER SYSTEMS, FIRE PROTECTION"

**50 sections remain unresolved** — not in `project_entities` because the standard spec extraction pipeline did not process those sections (they were found only in the UFGS embedded SUBMITTAL FORM).

---

## What Is Currently In Progress

**Backfill script is ready but not yet executed.** Run to apply:
```
npx tsx scripts/backfill-submittal-section-titles.ts --execute
```

---

## What To Do Next

1. **Execute the backfill** — run the command above in the project directory. Confirm `Updated: 653, Failed: 0`.
2. **Deploy to Vercel** — both the pagination fix and the backfill are production-ready changes. Deploy after backfill.
3. **Verify in production** — open the Ammunition project submittal register. Confirmed sections (e.g., 28 31 70) should now show "INTERIOR FIRE ALARM SYSTEM, ADDRESSABLE" instead of "Section 28 31 70".
4. **Next quality fix:** ~82 duplicate rows — items with the same `dedupeKey` within a run. Deduplicate at read time using the existing `dedupeKey` field in `item_payload`.
5. **Page-break artifacts** ("GE-BREAK---", "Special REAK---") — 3+ rows with corrupted names from the UFGS parser. Filter at read time or fix in next extraction.

---

## Open Questions / Blockers

- 50 sections (out of 70) still have no title because the standard pipeline didn't extract them. To resolve these, either: (a) re-run spec extraction on the document, or (b) add a UFGS master section lookup table.
- Supabase MCP session expired during this session; re-auth needed for DB query work via MCP tools.
- The `scripts/audit-submittal-register.ts` query also hits the 1,000-row limit — update it with `.range()` if reused.
