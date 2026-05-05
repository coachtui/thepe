# Claude Code Handoff — PE Project → Construction Intelligence Core

## Current Goal

Refactor this PE / project-engineer document intelligence project from generic project chat into a project-aware construction intelligence core.

This is intended to later become reusable inside BedrockOS, but for now all work stays inside this PE repo.

## Current Architecture Progress

Implemented so far:

1. Task router
   - File: `src/lib/chat/task-router.ts`
   - Classifies user messages into construction task types:
     - ask_project
     - spec_lookup
     - plan_lookup
     - rfi_draft
     - submittal_review
     - submittal_register
     - qc_plan
     - schedule_question
     - field_question
     - equipment_question
     - general

2. Retrieval strategy map
   - Also in `src/lib/chat/task-router.ts`
   - Defines config for each task type:
     - retrievalMode
     - preferredDocumentTypes
     - preferredMetadataFields
     - defaultTopK
     - citationRequired
     - includeProjectHistory
     - structuredOutputRequired
     - promptTemplateName
     - notes

3. Router wired into chat flow
   - `src/lib/chat/chat-handler.ts`
   - `src/app/api/chat/route.ts`
   - `src/app/api/mobile/chat/route.ts`
   - `src/lib/chat/tools/index.ts`
   - Currently only applies `defaultTopK` where supported.
   - Other strategy fields remain metadata/TODOs.

4. Spec lookup specialist behavior
   - Prompt-level specialist behavior for `taskType === "spec_lookup"`.
   - Instructs model to prioritize specs, cite source metadata, separate Requirement / Interpretation / Recommended Action, and avoid uncited certainty.

5. Normalized source references
   - File: `src/lib/chat/source-references.ts`
   - Adds `SourceReference` type, normalizer, and formatter.
   - `src/lib/chat/types.ts` now supports optional `sourceReference` on `SpecFinding` and `SpecEntity`.
   - `src/lib/chat/spec-queries.ts` uses normalized citations for spec answers.

6. Submittal register workflow
   - File: `src/lib/chat/submittal-register.ts`
   - Adds `buildSubmittalRegisterFromSpecs(...)`.
   - Reads existing `project_entities`, `entity_findings`, and `entity_citations`.
   - Extracts structured submittal register rows:
     - specSection
     - sectionTitle
     - submittalItem
     - submittalType
     - requiredAction
     - approvalRequired
     - sourceReference
     - excerpt
     - confidence
     - notes

7. Submittal register quality hardening
   - Deterministic dedupe added.
   - Dedupe key:
     - specSection
     - normalized submittalItem
     - submittalType
     - source part/paragraph reference
   - Added optional metadata:
     - rawExcerpt
     - dedupeKey
     - duplicateCount
     - citationCompleteness
     - sourceQuality
     - confidenceReason
   - Confidence logic:
     - high = explicit submittal_requirement finding with section and citation metadata
     - medium = parsed spec-like text with section/page metadata
     - low = uncited or weak parsed text

8. Harness
   - File: `scripts/task-router-harness.mjs`
   - Command: `npm run router:harness`
   - Currently passes.
   - Includes examples for router classification, normalized source references, and submittal register quality cases.

9. Grouped review output shape for `submittal_register`
   - File: `src/lib/chat/submittal-register.ts`
   - Types:
     - `SubmittalRegisterGroup`
     - `SubmittalRegisterReview`
   - Functions:
     - `groupSubmittalRegisterForReview()`
     - `formatSubmittalRegisterReviewAsJson()`
   - Per-group aggregates: itemCount, averageConfidence, confidenceBreakdown (high/medium/low), citationBreakdown (fullyCited/partiallyCited/uncited), submittalTypeCounts, approvalRequiredCount, reviewFlags.
   - Top-level shape: sorted groups, ungrouped items (no specSection), global review flags.
   - Harness coverage added in `scripts/task-router-harness.mjs`.
   - `npm run router:harness` passes.
   - `npm run build` passes.

## Next Recommended Step

Wire the grouped review output into the `submittal_register` chat/tool path conservatively.

## Validation

Run:

```bash
npm run router:harness
npm run build
```
