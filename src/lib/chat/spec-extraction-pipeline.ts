/**
 * Spec extraction pipeline — pure orchestration over `spec-extractor.ts` helpers
 * plus a dependency-injected LLM caller.
 *
 * Scope (A3a):
 *   - NO database writes
 *   - NO Inngest function
 *   - NO network calls except through the caller-supplied `llmCaller`
 *   - NO auto-trigger
 *
 * What it does:
 *   1. Takes ordered chunks for a single document.
 *   2. Concatenates them in `chunk_index` order, tracking per-character
 *      attribution so each extracted section can be linked back to the
 *      chunks (and pages) that contributed to it.
 *   3. Classifies the document, deterministically slices CSI sections,
 *      splits each section into PART 1 / 2 / 3, runs a regex-first-pass
 *      requirement scan grouped by family.
 *   4. For each section, calls the injected `llmCaller` with
 *      `SPEC_SECTION_EXTRACTION_PROMPT` and the section text, parses +
 *      validates the JSON response, enriches each LLM-extracted
 *      requirement with regex cross-check + approval/record-only flags.
 *   5. Returns warnings instead of throwing wherever possible. Surfaces
 *      `validationFailed`, `confidence`, `sectionCharCount`, and
 *      `warnings` per section so a later wrapper can decide when to
 *      escalate from Haiku to Sonnet.
 *
 * Persistence (A3b) consumes the result of this pipeline. Nothing here
 * imports the Supabase client.
 */

import {
  classifySpecDocument,
  extractSpecSections,
  splitIntoParts,
  classifyRequirement,
  extractRequirementStatements,
  buildSpecSectionCanonical,
  buildSpecRequirementCanonical,
  SPEC_SECTION_EXTRACTION_PROMPT,
  type SpecDocumentType,
} from '../vision/spec-extractor.ts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SpecChunkInput {
  id: string
  chunk_index: number
  content: string
  page_number?: number | null
  metadata?: Record<string, unknown> | null
}

export interface SpecDocumentMeta {
  title?: string | null
  filename: string
}

export interface SpecExtractionPipelineOptions {
  /** Maximum number of CSI sections processed per document. Default: 250. */
  maxSectionsPerDocument?: number
  /**
   * Maximum character count of a single section body before the LLM call is
   * skipped (the section is still returned with regex-first-pass metadata).
   * Default: 60000.
   */
  maxSectionChars?: number
}

export interface SpecExtractionPipelineInput {
  projectId: string
  documentId: string
  documentMeta: SpecDocumentMeta
  chunks: SpecChunkInput[]
  llmCaller: SpecLlmCaller
  options?: SpecExtractionPipelineOptions
}

export interface SpecLlmCallContext {
  sectionNumber: string
  sectionTitle: string
  sectionCharCount: number
}

export interface SpecLlmCallInput {
  prompt: string
  sectionText: string
  sectionContext: SpecLlmCallContext
  /**
   * Hint for caller-side model selection. The pipeline never sets this
   * directly today — a future wrapper can pass `'haiku'` first and
   * `'sonnet'` on retry. Pipeline does not interpret this value.
   */
  modelHint?: 'haiku' | 'sonnet'
}

export interface SpecLlmCallOutput {
  /** Raw text output from the model. Expected to be JSON. */
  rawText: string
  /** Identifier of the model the caller actually used (for telemetry). */
  modelUsed?: string
  /** Optional cost reported by the caller. Aggregated into the result. */
  costUsd?: number
  /**
   * Optional non-fatal error string. The pipeline turns this into a section
   * warning rather than throwing.
   */
  error?: string
}

export type SpecLlmCaller = (input: SpecLlmCallInput) => Promise<SpecLlmCallOutput>

export type SpecRequirementType =
  | 'material_requirement'
  | 'execution_requirement'
  | 'testing_requirement'
  | 'submittal_requirement'
  | 'closeout_requirement'
  | 'protection_requirement'
  | 'inspection_requirement'

export interface SpecRequirementExtraction {
  /** Family classification, validated against the allowed set. */
  requirementType: SpecRequirementType
  /** Verbatim requirement statement from the model. */
  statement: string
  /** Article/paragraph reference reported by the model. */
  partReference: string | null
  /** Model-reported confidence, clamped to [0, 1]. */
  confidence: number
  /** Canonical name suitable for `project_entities.canonical_name`. */
  canonicalName: string
  /** Regex first-pass family classification, for cross-check vs the model. */
  regexFamily: SpecRequirementType | null
  /** True when the statement contains explicit approval-gating language. */
  approvalRequired: boolean
  /** True when the statement marks the submittal as record/informational only. */
  recordOnly: boolean
  /**
   * True when the model's `requirementType` was unknown and was mapped to
   * `execution_requirement` (the conservative default per the prompt).
   */
  requirementTypeRemapped: boolean
}

export interface SpecSectionExtractionResult {
  sectionNumber: string
  sectionTitle: string
  /** Canonical name suitable for `project_entities.canonical_name`. */
  canonicalName: string
  /** First two digits of the section number — the CSI division. */
  divisionNumber: string | null
  /** Which PART blocks were detected by the deterministic splitter. */
  parts: { general: boolean; products: boolean; execution: boolean }
  /** Raw text per PART block. Empty string when the part wasn't found. */
  partsText: { general: string; products: string; execution: string }
  /** Validated, enriched requirements from the model. */
  requirements: SpecRequirementExtraction[]
  /** External standards mentioned in the section (ASTM, ACI, etc.). */
  referencedStandards: string[]
  /** Model-reported overall confidence for the section, clamped to [0, 1]. */
  confidence: number
  /**
   * True when the LLM call's output could not be parsed/validated as the
   * expected schema. Used by a future wrapper to decide whether to
   * escalate from Haiku to Sonnet.
   */
  validationFailed: boolean
  /** Per-section warnings (skip reasons, parse errors, schema mismatches). */
  warnings: string[]
  /** Character count of the section body (excludes the cross-section gap). */
  sectionCharCount: number
  /** Source chunk IDs whose text overlaps this section's slice. */
  sourceChunkIds: string[]
  /** Distinct, sorted source page numbers for the section (when available). */
  sourcePageNumbers: number[]
  /** Identifier of the model the caller used, when reported. */
  modelUsed?: string
  /** Cost reported by the caller for this section, aggregated upward. */
  costUsd: number
  /**
   * Regex-first-pass requirement statements grouped by family. Useful as a
   * sanity check against the LLM output and as a fallback when the model
   * call fails entirely. Family keys are the same as
   * `SpecRequirementType`, plus `unclassified` for statements that
   * matched no family pattern.
   */
  regexFirstPassByFamily: Record<string, string[]>
  /** Total count of regex-first-pass statements across all families. */
  regexFirstPassTotal: number
}

export interface SpecExtractionPipelineResult {
  projectId: string
  documentId: string
  /** Output of `classifySpecDocument` against title + filename. */
  documentClassification: SpecDocumentType
  sections: SpecSectionExtractionResult[]
  /** Number of sections detected by the regex section splitter. */
  totalSections: number
  /**
   * Number of sections passed to the LLM caller (capped by
   * `maxSectionsPerDocument`).
   */
  sectionsAttempted: number
  /**
   * Number of sections where the LLM caller returned a parseable, validated
   * payload AND `validationFailed === false`.
   */
  sectionsSucceeded: number
  /** Sum of `costUsd` across all sections. */
  totalCostUsd: number
  /** Document-level warnings (classification, section cap, etc.). */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SECTIONS_PER_DOCUMENT = 250
const DEFAULT_MAX_SECTION_CHARS = 60_000

const ALLOWED_REQUIREMENT_TYPES = new Set<SpecRequirementType>([
  'material_requirement',
  'execution_requirement',
  'testing_requirement',
  'submittal_requirement',
  'closeout_requirement',
  'protection_requirement',
  'inspection_requirement',
])

/**
 * Approval-gating phrases. Used to set `approvalRequired = true` on
 * requirement statements (especially submittals) where the contractor must
 * wait for written approval before proceeding.
 */
const APPROVAL_PHRASES: RegExp[] = [
  /\bsubmit\s+for\s+approval\b/i,
  /\bapproval\s+(?:required|necessary)\b/i,
  /\bprior\s+to\s+(?:installation|placement|fabrication|construction|use|trenching)\b/i,
  /\bbefore\s+(?:fabrication|installation|placement|use)\b/i,
  /\bobtain\s+(?:engineer|architect|owner)['’]s?\s+(?:approval|written\s+approval)/i,
  /\b(?:engineer|architect|owner)\s+(?:approval|review)\s+required\b/i,
]

/**
 * Record-only phrases. Used to set `recordOnly = true` — these submittals
 * are informational and do not gate construction.
 */
const RECORD_ONLY_PHRASES: RegExp[] = [
  /\bfor\s+record\s+only\b/i,
  /\bfor\s+information(?:al)?\s+(?:only|purposes)\b/i,
  /\binformational\s+submittal\b/i,
  /\bsubmit\s+for\s+(?:record|information)\b/i,
  /\bno\s+approval\s+required\b/i,
]

const REGEX_FIRST_PASS_FAMILIES: SpecRequirementType[] = [
  'material_requirement',
  'execution_requirement',
  'testing_requirement',
  'submittal_requirement',
  'closeout_requirement',
  'protection_requirement',
  'inspection_requirement',
]

// ---------------------------------------------------------------------------
// Pipeline entrypoint
// ---------------------------------------------------------------------------

export async function runSpecExtractionPipeline(
  input: SpecExtractionPipelineInput
): Promise<SpecExtractionPipelineResult> {
  const opts = {
    maxSectionsPerDocument:
      input.options?.maxSectionsPerDocument ?? DEFAULT_MAX_SECTIONS_PER_DOCUMENT,
    maxSectionChars: input.options?.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS,
  }
  const warnings: string[] = []

  // 1. Sort chunks deterministically — never trust caller ordering.
  const sorted = [...input.chunks].sort((a, b) => a.chunk_index - b.chunk_index)

  // 2. Concatenate; track per-chunk byte offsets for citation linkage.
  const { fullText, indexMap } = concatChunks(sorted)

  // 3. Classify document type by title + filename.
  const documentClassification = classifySpecDocument(
    input.documentMeta.title ?? '',
    input.documentMeta.filename
  )

  if (documentClassification === null) {
    warnings.push(
      'Document was not classified as a spec by title/filename heuristic — attempting section detection anyway.'
    )
  }

  // 4. Split into CSI sections (regex first-pass; deterministic).
  const rawSections = extractSpecSections(fullText)
  if (rawSections.length === 0) {
    warnings.push(
      'No CSI section headers detected in the concatenated document text — nothing to extract.'
    )
    return {
      projectId: input.projectId,
      documentId: input.documentId,
      documentClassification,
      sections: [],
      totalSections: 0,
      sectionsAttempted: 0,
      sectionsSucceeded: 0,
      totalCostUsd: 0,
      warnings,
    }
  }

  // 5. Slice each section, attaching contributing chunks + pages.
  const sectionSlices = sliceSections(fullText, rawSections, indexMap)

  // 6. Dedupe sections by sectionNumber. CSI section numbers commonly appear
  // in multiple places in a project manual — TOC entries, section title
  // pages, cross-references in other sections — and `extractSpecSections`
  // matches every occurrence. Keep the slice with the longest body per
  // sectionNumber: that's almost always the actual section content rather
  // than a TOC entry or in-line reference.
  const dedupedSlices = dedupeSlicesBySectionNumber(sectionSlices)
  const dedupedDropCount = sectionSlices.length - dedupedSlices.length
  if (dedupedDropCount > 0) {
    warnings.push(
      `Detected ${sectionSlices.length} section header occurrences; deduped to ${dedupedSlices.length} unique sectionNumber(s) (kept the longest body for each).`
    )
  }

  // 7. Cap section count for cost / runtime safety.
  const limitedSlices = dedupedSlices.slice(0, opts.maxSectionsPerDocument)
  if (dedupedSlices.length > opts.maxSectionsPerDocument) {
    warnings.push(
      `Document has ${dedupedSlices.length} unique sections; capped at ${opts.maxSectionsPerDocument} (configurable via maxSectionsPerDocument).`
    )
  }

  // 8. Per-section extraction (deterministic regex-first + LLM call).
  const sections: SpecSectionExtractionResult[] = []
  let totalCostUsd = 0
  let sectionsAttempted = 0
  let sectionsSucceeded = 0

  for (const slice of limitedSlices) {
    sectionsAttempted += 1
    const result = await extractSection(slice, input.llmCaller, opts)
    if (result.modelUsed && !result.validationFailed && result.requirements.length > 0) {
      sectionsSucceeded += 1
    }
    totalCostUsd += result.costUsd
    sections.push(result)
  }

  return {
    projectId: input.projectId,
    documentId: input.documentId,
    documentClassification,
    sections,
    totalSections: rawSections.length,
    sectionsAttempted,
    sectionsSucceeded,
    totalCostUsd: roundCurrency(totalCostUsd),
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Concatenation + section slicing
// ---------------------------------------------------------------------------

interface IndexMapEntry {
  start: number
  end: number
  chunk: SpecChunkInput
}

function concatChunks(sorted: SpecChunkInput[]): {
  fullText: string
  indexMap: IndexMapEntry[]
} {
  // Inserting a uniform separator between chunks keeps section-header regex
  // matches well-anchored even when one chunk ends mid-section. The separator
  // is excluded from each chunk's [start, end) range so chunk attribution
  // remains accurate.
  const SEPARATOR = '\n\n'
  const parts: string[] = []
  const indexMap: IndexMapEntry[] = []
  let cursor = 0
  for (let i = 0; i < sorted.length; i++) {
    const chunk = sorted[i]
    const start = cursor
    parts.push(chunk.content)
    cursor += chunk.content.length
    indexMap.push({ start, end: cursor, chunk })
    if (i < sorted.length - 1) {
      parts.push(SEPARATOR)
      cursor += SEPARATOR.length
    }
  }
  return { fullText: parts.join(''), indexMap }
}

interface SectionSlice {
  sectionNumber: string
  sectionTitle: string
  bodyText: string
  startIndex: number
  endIndex: number
  sourceChunks: SpecChunkInput[]
  sourcePageNumbers: number[]
  charCount: number
}

function sliceSections(
  fullText: string,
  rawSections: ReturnType<typeof extractSpecSections>,
  indexMap: IndexMapEntry[]
): SectionSlice[] {
  const slices: SectionSlice[] = []
  for (let i = 0; i < rawSections.length; i++) {
    const cur = rawSections[i]
    const next = rawSections[i + 1]
    const startIndex = cur.startIndex
    const endIndex = next ? next.startIndex : fullText.length
    const bodyText = fullText.slice(startIndex, endIndex)
    const sourceChunks = chunksOverlapping(indexMap, startIndex, endIndex)
    const sourcePageNumbers = uniqueSortedNumbers(
      sourceChunks
        .map(c => c.page_number ?? null)
        .filter((p): p is number => typeof p === 'number')
    )
    slices.push({
      sectionNumber: cur.sectionNumber,
      sectionTitle: cur.sectionTitle,
      bodyText,
      startIndex,
      endIndex,
      sourceChunks,
      sourcePageNumbers,
      charCount: bodyText.length,
    })
  }
  return slices
}

function chunksOverlapping(
  indexMap: IndexMapEntry[],
  startIndex: number,
  endIndex: number
): SpecChunkInput[] {
  const result: SpecChunkInput[] = []
  for (const entry of indexMap) {
    if (entry.end > startIndex && entry.start < endIndex) {
      result.push(entry.chunk)
    }
  }
  return result
}

/**
 * Dedupe section slices by `sectionNumber`, keeping the slice with the
 * longest `bodyText` for each unique number. Preserves the document order
 * of the surviving slices (sorted by `startIndex`).
 *
 * Why "longest body": when a section number appears multiple times in the
 * document text (TOC, section title page, cross-references), the regex
 * match that anchors at the actual section content always slices the
 * largest body — TOC entries get a sliver, real sections get thousands of
 * characters of PART 1/2/3 content.
 */
function dedupeSlicesBySectionNumber(slices: SectionSlice[]): SectionSlice[] {
  const longestByNumber = new Map<string, SectionSlice>()
  for (const slice of slices) {
    const existing = longestByNumber.get(slice.sectionNumber)
    if (!existing || slice.bodyText.length > existing.bodyText.length) {
      longestByNumber.set(slice.sectionNumber, slice)
    }
  }
  return Array.from(longestByNumber.values()).sort(
    (a, b) => a.startIndex - b.startIndex
  )
}

// ---------------------------------------------------------------------------
// Per-section extraction
// ---------------------------------------------------------------------------

async function extractSection(
  slice: SectionSlice,
  llmCaller: SpecLlmCaller,
  opts: { maxSectionChars: number }
): Promise<SpecSectionExtractionResult> {
  const warnings: string[] = []
  const canonicalName = buildSpecSectionCanonical(slice.sectionNumber)
  const partsText = splitIntoParts(slice.bodyText)
  const partsPresent = {
    general: partsText.general.length > 0,
    products: partsText.products.length > 0,
    execution: partsText.execution.length > 0,
  }
  const sectionCharCount = slice.bodyText.length
  const regexFirstPassByFamily = buildRegexFirstPass(slice.bodyText, partsText)
  const regexFirstPassTotal = Object.values(regexFirstPassByFamily).reduce(
    (acc, arr) => acc + arr.length,
    0
  )

  // Guardrail: oversize sections are not sent to the model. The regex-first-pass
  // is still attached so a fallback path can make sense of the section.
  if (sectionCharCount > opts.maxSectionChars) {
    warnings.push(
      `Section ${slice.sectionNumber} body is ${sectionCharCount} chars (limit ${opts.maxSectionChars}); LLM call skipped.`
    )
    return {
      sectionNumber: slice.sectionNumber,
      sectionTitle: slice.sectionTitle,
      canonicalName,
      divisionNumber: deriveDivision(slice.sectionNumber),
      parts: partsPresent,
      partsText,
      requirements: [],
      referencedStandards: [],
      confidence: 0,
      validationFailed: false,
      warnings,
      sectionCharCount,
      sourceChunkIds: slice.sourceChunks.map(c => c.id),
      sourcePageNumbers: slice.sourcePageNumbers,
      costUsd: 0,
      regexFirstPassByFamily,
      regexFirstPassTotal,
    }
  }

  // Call the injected caller. We never throw on caller errors — they become
  // section warnings + validationFailed=true so a fallback wrapper can route
  // the section to a stronger model.
  let rawText = ''
  let modelUsed: string | undefined
  let costUsd = 0
  let llmError: string | undefined

  try {
    const result = await llmCaller({
      prompt: SPEC_SECTION_EXTRACTION_PROMPT,
      sectionText: slice.bodyText,
      sectionContext: {
        sectionNumber: slice.sectionNumber,
        sectionTitle: slice.sectionTitle,
        sectionCharCount,
      },
    })
    rawText = result.rawText ?? ''
    modelUsed = result.modelUsed
    costUsd = result.costUsd ?? 0
    llmError = result.error
  } catch (err) {
    llmError = err instanceof Error ? err.message : String(err)
  }

  if (llmError) {
    warnings.push(`LLM caller error for section ${slice.sectionNumber}: ${llmError}`)
  }

  let validationFailed = false
  let modelConfidence = 0
  let modelReferencedStandards: string[] = []
  let modelRequirements: SpecRequirementExtraction[] = []

  if (rawText.length === 0 && !llmError) {
    validationFailed = true
    warnings.push(`Section ${slice.sectionNumber}: LLM caller returned empty rawText.`)
  } else if (rawText.length > 0) {
    const parsed = safeParseJson(rawText)
    if (parsed === null) {
      validationFailed = true
      warnings.push(
        `Section ${slice.sectionNumber}: LLM output was not valid JSON (failed to parse).`
      )
    } else {
      const validation = validateSectionJson(parsed)
      if (!validation.ok) {
        validationFailed = true
        warnings.push(
          `Section ${slice.sectionNumber}: schema validation failed — ${validation.error}`
        )
      } else {
        modelConfidence = validation.payload.confidence
        modelReferencedStandards = validation.payload.referencedStandards
        modelRequirements = enrichRequirements(
          validation.payload.requirements,
          slice.sectionNumber
        )
        if (modelRequirements.length === 0) {
          warnings.push(
            `Section ${slice.sectionNumber}: LLM output validated but contained zero requirements.`
          )
        }
      }
    }
  } else if (llmError) {
    // Caller already reported an error; treat as validation failure for
    // fallback-decision purposes.
    validationFailed = true
  }

  return {
    sectionNumber: slice.sectionNumber,
    sectionTitle: slice.sectionTitle,
    canonicalName,
    divisionNumber: deriveDivision(slice.sectionNumber),
    parts: partsPresent,
    partsText,
    requirements: modelRequirements,
    referencedStandards: modelReferencedStandards,
    confidence: modelConfidence,
    validationFailed,
    warnings,
    sectionCharCount,
    sourceChunkIds: slice.sourceChunks.map(c => c.id),
    sourcePageNumbers: slice.sourcePageNumbers,
    modelUsed,
    costUsd: roundCurrency(costUsd),
    regexFirstPassByFamily,
    regexFirstPassTotal,
  }
}

// ---------------------------------------------------------------------------
// Regex first-pass
// ---------------------------------------------------------------------------

function buildRegexFirstPass(
  fullSectionText: string,
  partsText: { general: string; products: string; execution: string }
): Record<string, string[]> {
  // Per the prompt + spec-extractor design, regex first-pass runs against the
  // section body. We dedupe across PART blocks so a statement that appears
  // once is reported once.
  const buckets: Record<string, string[]> = { unclassified: [] }
  for (const family of REGEX_FIRST_PASS_FAMILIES) {
    buckets[family] = []
  }

  const seen = new Set<string>()
  const sources = [partsText.general, partsText.products, partsText.execution, fullSectionText]
  for (const src of sources) {
    if (!src) continue
    const statements = extractRequirementStatements(src, 100)
    for (const statement of statements) {
      const key = statement.toLowerCase().trim()
      if (seen.has(key)) continue
      seen.add(key)
      const family = classifyRequirement(statement)
      const bucket = family ?? 'unclassified'
      buckets[bucket].push(statement)
    }
  }
  return buckets
}

// ---------------------------------------------------------------------------
// JSON parsing + validation + enrichment
// ---------------------------------------------------------------------------

function safeParseJson(text: string): unknown {
  let candidate = text.trim()
  // Strip markdown code fences if the model wrapped the JSON.
  if (candidate.startsWith('```')) {
    candidate = candidate.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
  }
  if (candidate.length === 0) return null
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

interface ValidatedSectionPayload {
  sectionNumber?: string
  sectionTitle?: string
  divisionNumber?: string
  parts: { general: boolean; products: boolean; execution: boolean }
  requirements: Array<{
    requirementType: string
    statement: string
    partReference: string | null
    confidence: number
  }>
  referencedStandards: string[]
  confidence: number
}

function validateSectionJson(value: unknown):
  | { ok: true; payload: ValidatedSectionPayload }
  | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'top-level JSON is not an object' }
  }
  const v = value as Record<string, unknown>

  const requirementsRaw = Array.isArray(v.requirements) ? v.requirements : []
  const requirements: ValidatedSectionPayload['requirements'] = []
  for (const item of requirementsRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const r = item as Record<string, unknown>
    const statement = typeof r.statement === 'string' ? r.statement : null
    if (!statement || statement.length === 0) continue
    const requirementType =
      typeof r.requirementType === 'string' ? r.requirementType : 'execution_requirement'
    const partReference = typeof r.partReference === 'string' ? r.partReference : null
    const confidence = typeof r.confidence === 'number' ? clamp01(r.confidence) : 0.5
    requirements.push({ requirementType, statement, partReference, confidence })
  }

  const referencedStandards = Array.isArray(v.referencedStandards)
    ? v.referencedStandards.filter((x): x is string => typeof x === 'string')
    : []

  const confidence = typeof v.confidence === 'number' ? clamp01(v.confidence) : 0.5

  const partsObj =
    v.parts && typeof v.parts === 'object' && !Array.isArray(v.parts)
      ? (v.parts as Record<string, unknown>)
      : {}
  const parts = {
    general: Boolean(partsObj.general),
    products: Boolean(partsObj.products),
    execution: Boolean(partsObj.execution),
  }

  return {
    ok: true,
    payload: {
      sectionNumber: typeof v.sectionNumber === 'string' ? v.sectionNumber : undefined,
      sectionTitle: typeof v.sectionTitle === 'string' ? v.sectionTitle : undefined,
      divisionNumber: typeof v.divisionNumber === 'string' ? v.divisionNumber : undefined,
      parts,
      requirements,
      referencedStandards,
      confidence,
    },
  }
}

function enrichRequirements(
  rawRequirements: ValidatedSectionPayload['requirements'],
  sectionNumber: string
): SpecRequirementExtraction[] {
  const enriched: SpecRequirementExtraction[] = []
  for (let idx = 0; idx < rawRequirements.length; idx++) {
    const r = rawRequirements[idx]
    const requirementTypeIsKnown = ALLOWED_REQUIREMENT_TYPES.has(r.requirementType as SpecRequirementType)
    const finalType: SpecRequirementType = requirementTypeIsKnown
      ? (r.requirementType as SpecRequirementType)
      : 'execution_requirement'
    const canonicalName = buildSpecRequirementCanonical(sectionNumber, finalType, idx + 1)
    const regexFamilyRaw = classifyRequirement(r.statement)
    const regexFamily = regexFamilyRaw as SpecRequirementType | null
    enriched.push({
      requirementType: finalType,
      statement: r.statement,
      partReference: r.partReference,
      confidence: r.confidence,
      canonicalName,
      regexFamily,
      approvalRequired: detectApprovalRequired(r.statement),
      recordOnly: detectRecordOnly(r.statement),
      requirementTypeRemapped: !requirementTypeIsKnown,
    })
  }
  return enriched
}

// ---------------------------------------------------------------------------
// Phrase detection helpers (exposed for harness / test usage)
// ---------------------------------------------------------------------------

export function detectApprovalRequired(text: string): boolean {
  return APPROVAL_PHRASES.some(p => p.test(text))
}

export function detectRecordOnly(text: string): boolean {
  return RECORD_ONLY_PHRASES.some(p => p.test(text))
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function deriveDivision(sectionNumber: string): string | null {
  const m = sectionNumber.match(/^(\d{2})/)
  return m ? m[1] : null
}

function uniqueSortedNumbers(arr: number[]): number[] {
  return Array.from(new Set(arr)).sort((a, b) => a - b)
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function roundCurrency(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

// ---------------------------------------------------------------------------
// Persistence row builder (pure transform — no I/O)
// ---------------------------------------------------------------------------
//
// `buildSpecPersistenceRows()` converts a `SpecExtractionPipelineResult` into
// row "templates" suitable for direct insertion into `project_entities`,
// `entity_citations`, and `entity_findings`. The I/O wrapper in
// `spec-extraction-persistence.ts` calls this and then performs the actual
// inserts in dependency order.
//
// Why "templates": citations and findings each carry foreign keys
// (`entity_id`, `citation_id`, `finding_id`) that don't exist yet at row-
// build time. The pure builder leaves them out; the I/O wrapper fills them
// in after each insert step, correlating by `canonical_name` (which is
// unique within a project for a given discipline).
//
// `extraction_source` is `'text'` per the spec-extractor design rules.
// `support_level` is `'verified'` because spec text is the definitive
// authority for the requirement — it doesn't get more directly attested.
// `subtype` carries the document classification on section rows and the
// requirement family on requirement rows.

export interface SpecSectionEntityRow {
  project_id: string
  discipline: 'spec'
  entity_type: 'spec_section'
  canonical_name: string
  display_name: string | null
  subtype: string | null
  status: string | null
  confidence: number | null
  extraction_source: 'text'
  source_document_id: string
  source_chunk_id: string | null
  metadata: Record<string, unknown>
}

export interface SpecRequirementEntityRow {
  project_id: string
  discipline: 'spec'
  entity_type: 'spec_requirement'
  canonical_name: string
  display_name: string | null
  subtype: string
  status: string | null
  confidence: number | null
  extraction_source: 'text'
  source_document_id: string
  source_chunk_id: string | null
  metadata: Record<string, unknown>
}

export interface SpecCitationRowTemplate {
  project_id: string
  document_id: string
  chunk_id: string | null
  sheet_number: string
  page_number: number | null
  excerpt: string | null
  context: string | null
  confidence: number | null
  extraction_source: 'text'
}

export interface SpecFindingRowTemplate {
  project_id: string
  finding_type: string
  statement: string
  text_value: string | null
  numeric_value: number | null
  unit: string | null
  support_level: string
  confidence: number | null
  metadata: Record<string, unknown>
}

export interface SpecRequirementBundle {
  requirementEntity: SpecRequirementEntityRow
  citation: SpecCitationRowTemplate
  finding: SpecFindingRowTemplate
}

export interface SpecSectionBundle {
  sectionEntity: SpecSectionEntityRow
  requirements: SpecRequirementBundle[]
}

export interface SpecPersistenceRowSet {
  projectId: string
  documentId: string
  sections: SpecSectionBundle[]
  totalSectionCount: number
  totalRequirementCount: number
  /** Sections that the pure builder skipped (validationFailed + zero requirements). */
  skippedSectionCount: number
}

export interface BuildSpecPersistenceRowsOptions {
  /**
   * `status` value on entity rows. Defaults to `null` — spec entities aren't
   * physical things with a construction status, and the project_entities
   * `status` CHECK only allows construction-domain values
   * (`existing`, `new`, `to_remove`, …). Set to a value from that allow set
   * if downstream filters require non-null status.
   */
  defaultStatus?: string | null
  /**
   * `support_level` for finding rows. Defaults to `'explicit'` — verbatim
   * spec text is, by definition, explicit support for the requirement.
   * The entity_findings `support_level` CHECK allows
   * `explicit | inferred | unknown`.
   */
  defaultSupportLevel?: 'explicit' | 'inferred' | 'unknown'
  /** Maximum length of `display_name` for requirement entities (truncation target). */
  maxRequirementDisplayName?: number
}

export function buildSpecPersistenceRows(
  projectId: string,
  documentId: string,
  result: SpecExtractionPipelineResult,
  options?: BuildSpecPersistenceRowsOptions
): SpecPersistenceRowSet {
  const opts = {
    defaultStatus: options?.defaultStatus === undefined ? null : options.defaultStatus,
    defaultSupportLevel: options?.defaultSupportLevel ?? ('explicit' as const),
    maxRequirementDisplayName: options?.maxRequirementDisplayName ?? 120,
  }

  const sections: SpecSectionBundle[] = []
  let totalRequirementCount = 0
  let skippedSectionCount = 0

  for (const section of result.sections) {
    // Sections with no extracted requirements AND a validation failure are
    // skipped — there's nothing actionable to persist. The fallback path
    // (regex-first-pass) is preserved on the in-memory result so a future
    // wrapper can choose to write those if desired.
    if (section.requirements.length === 0 && section.validationFailed) {
      skippedSectionCount += 1
      continue
    }

    const primaryChunkId = section.sourceChunkIds[0] ?? null
    const primaryPage = section.sourcePageNumbers[0] ?? null

    const sectionEntity: SpecSectionEntityRow = {
      project_id: projectId,
      discipline: 'spec',
      entity_type: 'spec_section',
      canonical_name: section.canonicalName,
      display_name: section.sectionTitle,
      subtype: result.documentClassification ?? 'spec_section',
      status: opts.defaultStatus,
      confidence: section.confidence > 0 ? section.confidence : null,
      extraction_source: 'text',
      source_document_id: documentId,
      source_chunk_id: primaryChunkId,
      metadata: {
        sectionNumber: section.sectionNumber,
        divisionNumber: section.divisionNumber,
        parts: section.parts,
        referencedStandards: section.referencedStandards,
        sectionCharCount: section.sectionCharCount,
        sourceChunkIds: section.sourceChunkIds,
        sourcePageNumbers: section.sourcePageNumbers,
        warnings: section.warnings,
        modelUsed: section.modelUsed ?? null,
        regexFirstPassByFamily: section.regexFirstPassByFamily,
        regexFirstPassTotal: section.regexFirstPassTotal,
      },
    }

    const requirements: SpecRequirementBundle[] = []
    for (const req of section.requirements) {
      const requirementEntity: SpecRequirementEntityRow = {
        project_id: projectId,
        discipline: 'spec',
        entity_type: 'spec_requirement',
        canonical_name: req.canonicalName,
        display_name: truncate(req.statement, opts.maxRequirementDisplayName),
        subtype: req.requirementType,
        status: opts.defaultStatus,
        confidence: req.confidence,
        extraction_source: 'text',
        source_document_id: documentId,
        source_chunk_id: primaryChunkId,
        metadata: {
          parentSectionCanonical: section.canonicalName,
          parentSectionNumber: section.sectionNumber,
          partReference: req.partReference,
          regexFamily: req.regexFamily,
          requirementTypeRemapped: req.requirementTypeRemapped,
          approvalRequired: req.approvalRequired,
          recordOnly: req.recordOnly,
        },
      }

      const citation: SpecCitationRowTemplate = {
        project_id: projectId,
        document_id: documentId,
        chunk_id: primaryChunkId,
        // Spec citations reuse `sheet_number` to carry the CSI section number
        // per the spec-extractor.ts design comment.
        sheet_number: section.sectionNumber,
        page_number: primaryPage,
        excerpt: req.statement,
        context: req.partReference,
        confidence: req.confidence,
        extraction_source: 'text',
      }

      const finding: SpecFindingRowTemplate = {
        project_id: projectId,
        // The entity_findings `finding_type` CHECK only allows the existing
        // generic values (quantity, material, requirement, demo_scope, …).
        // CSI requirement families (submittal_requirement, material_requirement,
        // etc.) are not in that taxonomy. We persist `'requirement'` as the
        // generic finding_type and stash the specific family in metadata so
        // downstream consumers (buildSubmittalRegisterFromSpecs etc.) can
        // filter on `metadata->>'requirementFamily'`.
        finding_type: 'requirement',
        statement: req.statement,
        text_value: null,
        numeric_value: null,
        unit: null,
        support_level: opts.defaultSupportLevel,
        confidence: req.confidence,
        metadata: {
          requirementFamily: req.requirementType,
          partReference: req.partReference,
          regexFamily: req.regexFamily,
          approvalRequired: req.approvalRequired,
          recordOnly: req.recordOnly,
          requirementTypeRemapped: req.requirementTypeRemapped,
        },
      }

      requirements.push({ requirementEntity, citation, finding })
      totalRequirementCount += 1
    }

    sections.push({ sectionEntity, requirements })
  }

  return {
    projectId,
    documentId,
    sections,
    totalSectionCount: sections.length,
    totalRequirementCount,
    skippedSectionCount,
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}
