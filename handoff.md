# Handoff

Last updated: 2026-05-07 20:17 HST (submittal register UI improvements)

---

## What Was Done This Session

### Submittal register review panel — UI improvements (`SubmittalRegisterReview.tsx`)

**RunSummary expanded:**
- 8 stats in two rows: Submittal Items, Spec Sections, Ungrouped Items, Review Confidence / Reviewed, Pending Review, Approval Required, Low Confidence
- CSS-only review progress bar showing reviewed % across all items
- Contextual readiness message: "Review pending" / "X of N reviewed (P%)" / "All reviewed — ready for export" / high-item-count suffix
- Better label names (construction-specific)
- Better timestamp format + monospace run ID span

**SectionCard headers enhanced:**
- Section-level reviewed/pending counts computed from `section.items`
- "X/Y reviewed" displayed inline next to item count
- Thin CSS progress bar under each section header

**Tests:**
- router:harness: 12/12 PASS
- build: clean

---

## What Is Currently In Progress

Nothing. Session completed cleanly.

---

## What To Do Next

1. **Next quality fix:** ~82 duplicate rows — items with the same `dedupeKey` within a run. Deduplicate at read time using the existing `dedupeKey` field in `item_payload`. (Tracked in prior handoff.)
2. **Page-break artifacts** ("GE-BREAK---", "Special REAK---") — 3+ rows with corrupted names from the UFGS parser. Filter at read time or fix in next extraction.
3. **Ungrouped items card** — doesn't get a per-group progress bar yet; could add if needed.
4. **Phase 7A** — Manual Analyze button bug fix is still the top unstarted phase item per `plans/current-phase.md`.

---

## Open Questions / Blockers

- None for the UI changes.
- 50 sections (out of ~81) still lack titles — standard pipeline didn't extract them. Requires re-run of spec extraction or UFGS master lookup.
- Supabase MCP session may need re-auth for any DB query work.
