/**
 * Plan Reader — inspects actual rendered sheet images to answer questions.
 *
 * The existing pipeline verifies against structured tables and indexed entities,
 * but some facts only exist on the physical sheet image: pipe sizes tucked in
 * callouts, station endpoints rotated along an alignment, dimensions in leaders,
 * profile labels, match-line references, and hand-placed notes.
 *
 * This stage runs AFTER sheet verification and BEFORE evidence evaluation for
 * all Type B/C/D queries.  It:
 *   1. Identifies which document_pages records correspond to the candidate sheets
 *   2. Downloads only those PDF pages (not the whole file)
 *   3. Prompts a multimodal model with the exact question
 *   4. Follows match-line / continuation references across sheets
 *   5. Returns structured findings that take precedence over all other sources
 *
 * Priority order after this stage:
 *   inspected page findings  >  structured table evidence  >  indexed metadata
 *
 * Cost model:
 *   Each page inspection calls claude-haiku-4-5 (targeted question = accurate at low cost).
 *   Hard caps: MAX_PAGES_PER_RUN = 8, MAX_MATCHLINE_HOPS = 2.
 */

import Anthropic from '@anthropic-ai/sdk'
import { convertPdfPageToImage } from '@/lib/vision/pdf-to-image'
import { narrowCandidateSheets } from './sheet-narrower'
import { formatCalloutPatternsForPrompt } from './project-memory'
import type { MemoryItem } from './project-memory'
import type { QueryAnalysis } from './types'
import type { SheetVerificationResult } from './sheet-verifier'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PAGES_PER_RUN = 8
const MAX_MATCHLINE_HOPS = 2
const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024  // 15 MB
const PLAN_READER_MODEL = 'claude-haiku-4-5-20251001'
const PLAN_READER_MAX_TOKENS = 1024

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single confirmed finding from direct sheet inspection. */
export interface PlanReaderFinding {
  /** Sheet number where this was found */
  sheet: string
  /** Sheet title from the drawing title block */
  sheetTitle: string
  /** The finding as it relates to the question */
  finding: string
  /** Exact text/values/labels visible on the sheet */
  relevantVisibleEvidence: string
  /** 0–1 confidence from the model */
  confidence: number
  /**
   * True when this page alone fully answers the question.
   * False when the answer spans multiple sheets (linear systems, etc.).
   */
  isComplete: boolean
  /** Any "SEE SHEET X" / "CONTINUED ON SHEET X" references found on this page */
  matchLinesFound: string[]
}

/** Record of a page that was retrieved and passed to the model. */
export interface InspectedPage {
  sheetNumber: string
  sheetTitle: string
  documentId: string
  pageNumber: number
}

/**
 * Full result from a plan-reader run.
 * Attached to the EvidencePacket as planReaderMeta.
 */
export interface PlanReaderResult {
  /** False when the plan reader could not run (no indexed pages, download failure, etc.) */
  wasRun: boolean
  /** Human-readable reason when wasRun = false */
  skipReason?: string
  /** Pages that were fetched and passed to the model */
  pagesInspected: InspectedPage[]
  /** Confirmed findings from direct inspection */
  findings: PlanReaderFinding[]
  /** Sheet numbers that were added by following match-line references */
  matchLinesFollowed: string[]
  /**
   * Aggregate coverage:
   *   complete     — at least one page returned isComplete=true
   *   partial      — findings exist but no page returned isComplete=true
   *   insufficient — no findings (pages inspected but nothing relevant found)
   */
  coverageAssessment: 'complete' | 'partial' | 'insufficient'
  /** Formatted context block for the system prompt (priority-1 evidence) */
  formattedContext: string
  /** Approximate cost of all Anthropic calls in this run */
  totalCostUsd: number
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Row from document_pages for a given sheet number. */
interface DocumentPageRow {
  id: string
  document_id: string
  page_number: number
  sheet_number: string | null
  sheet_title: string | null
  has_plan_view: boolean | null
  has_profile_view: boolean | null
}

/** Raw JSON output from the per-page inspection model call. */
interface PageInspectionJson {
  canAnswer: boolean
  findingStatement: string
  relevantVisibleEvidence: string
  confidence: number
  isComplete: boolean
  matchLineReferences: string[]
  missingInformation: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the Plan Reader for a Type B/C/D query.
 *
 * Candidate sheets come from the verification result.  When candidateSheets
 * is empty (verification found nothing in structured tables) we attempt to
 * derive sheets from the query's entity name / utility designation.
 */
export async function runPlanReader(
  analysis: QueryAnalysis,
  verification: SheetVerificationResult,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  calloutPatterns?: MemoryItem[]
): Promise<PlanReaderResult> {
  // Only run for Type B/C/D
  if (verification.verificationClass === 'skip') {
    return notRun('Type A query — plan reader not needed')
  }

  const question = analysis.rawQuery

  // ── Use the sheet narrower to select the most relevant pages ─────────────
  // The narrower runs multiple ranked signals (entity, station, utility, title,
  // discipline, sheet-type) and returns the top N candidates with reasons.
  const narrowing = await narrowCandidateSheets(analysis, projectId, supabase, {
    maxCandidates: MAX_PAGES_PER_RUN,
  })

  console.log('[PlanReader] Narrower:', {
    candidates: narrowing.candidates.length,
    coverage: narrowing.coverageConfidence,
    questionClass: narrowing.questionClass,
    expansionRecommended: narrowing.isExpansionRecommended,
    totalSheets: narrowing.totalSheetsInProject,
  })

  if (narrowing.candidates.length === 0) {
    // Fallback: try the old approach using verification candidate sheets
    const fallbackSheets = [
      ...new Set([...verification.candidateSheets, ...verification.sheetsInspected]),
    ].slice(0, MAX_PAGES_PER_RUN)

    if (fallbackSheets.length === 0) {
      return notRun(
        narrowing.expansionReason ??
        'No candidate sheets found by narrowing engine. Phase 2 indexing may not have run.'
      )
    }

    // Map fallback sheet numbers to document_pages rows
    const fallbackRows = await findPageRows(fallbackSheets, projectId, supabase)
    if (fallbackRows.length === 0) {
      return notRun('No indexed pages found for the candidate sheets')
    }

    // Build a synthetic narrowing result from the fallback rows
    const syntheticCandidates = fallbackRows.map((row, i) => ({
      documentId: row.document_id,
      pageNumber: row.page_number,
      sheetNumber: row.sheet_number ?? `p${row.page_number}`,
      sheetTitle: row.sheet_title ?? '',
      score: 50,
      rank: i + 1,
      reasons: [{ signal: 'entity_match' as const, description: 'Fallback from verification candidate sheets', confidence: 0.7 }],
      signalTypes: ['entity_match' as const],
      isExpansionCandidate: false,
    }))

    return runPlanReaderWithCandidates(syntheticCandidates, question, projectId, supabase, calloutPatterns)
  }

  return runPlanReaderWithCandidates(narrowing.candidates, question, projectId, supabase, calloutPatterns)
}

/**
 * Internal: run the image inspection phase given a pre-selected candidate list.
 * Extracted so both the narrower path and the fallback path share the same logic.
 */
async function runPlanReaderWithCandidates(
  candidates: Array<{
    documentId: string
    pageNumber: number
    sheetNumber: string
    sheetTitle: string
    score: number
    rank: number
    reasons: import('./sheet-narrower').ExpansionReason[]
    signalTypes: import('./sheet-narrower').SignalType[]
    isExpansionCandidate: boolean
  }>,
  question: string,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  calloutPatterns?: MemoryItem[]
): Promise<PlanReaderResult> {
  if (candidates.length === 0) {
    return notRun('No candidates provided to plan reader inspection phase')
  }

  // Group by document_id to download each PDF only once
  const byDocument = new Map<string, typeof candidates>()
  for (const c of candidates) {
    if (!byDocument.has(c.documentId)) byDocument.set(c.documentId, [])
    byDocument.get(c.documentId)!.push(c)
  }

  const inspectedPages: InspectedPage[] = []
  const allFindings: PlanReaderFinding[] = []
  const pendingMatchLines: string[] = []
  const followedMatchLines: string[] = []
  let totalCost = 0

  // Cache of pdfBuffer per document_id (avoid re-downloading)
  const pdfCache = new Map<string, Buffer>()

  // ── First pass: inspect the primary candidate pages ──────────────────────
  for (const [documentId, pages] of byDocument) {
    const pdfBuffer = await downloadPdf(documentId, supabase)
    if (!pdfBuffer) {
      console.warn('[PlanReader] Could not download PDF for document:', documentId)
      continue
    }
    pdfCache.set(documentId, pdfBuffer)

    for (const candidate of pages) {
      if (inspectedPages.length >= MAX_PAGES_PER_RUN) break

      const imageBuffer = await renderPage(pdfBuffer, candidate.pageNumber)
      if (!imageBuffer) continue

      const sheetNumber = candidate.sheetNumber
      const sheetTitle = candidate.sheetTitle

      const result = await inspectPageForQuestion(imageBuffer, question, sheetNumber, sheetTitle, calloutPatterns)
      totalCost += result.costUsd

      inspectedPages.push({
        sheetNumber,
        sheetTitle,
        documentId,
        pageNumber: candidate.pageNumber,
      })

      if (result.json) {
        if (result.json.canAnswer && result.json.findingStatement) {
          allFindings.push({
            sheet: sheetNumber,
            sheetTitle,
            finding: result.json.findingStatement,
            relevantVisibleEvidence: result.json.relevantVisibleEvidence,
            confidence: result.json.confidence,
            isComplete: result.json.isComplete,
            matchLinesFound: result.json.matchLineReferences ?? [],
          })
        }

        // Collect any match-line references for follow-up
        for (const ref of result.json.matchLineReferences ?? []) {
          const normalized = normalizeSheetRef(ref)
          const alreadyQueued = inspectedPages.some(p => p.sheetNumber === normalized)
          if (
            normalized &&
            !alreadyQueued &&
            !pendingMatchLines.includes(normalized)
          ) {
            pendingMatchLines.push(normalized)
          }
        }
      }
    }
  }

  // ── Match-line follow-up (max MAX_MATCHLINE_HOPS rounds) ─────────────────
  let hopsRemaining = MAX_MATCHLINE_HOPS
  while (pendingMatchLines.length > 0 && hopsRemaining > 0 && inspectedPages.length < MAX_PAGES_PER_RUN) {
    hopsRemaining--
    const sheetRef = pendingMatchLines.shift()!
    followedMatchLines.push(sheetRef)

    const followRows = await findPageRows([sheetRef], projectId, supabase)
    if (followRows.length === 0) continue

    for (const row of followRows) {
      if (inspectedPages.length >= MAX_PAGES_PER_RUN) break

      const documentId = row.document_id
      let pdfBuffer = pdfCache.get(documentId)
      if (!pdfBuffer) {
        pdfBuffer = await downloadPdf(documentId, supabase) ?? undefined
        if (!pdfBuffer) continue
        pdfCache.set(documentId, pdfBuffer)
      }

      const imageBuffer = await renderPage(pdfBuffer, row.page_number)
      if (!imageBuffer) continue

      const sheetNumber = row.sheet_number ?? `p${row.page_number}`
      const sheetTitle = row.sheet_title ?? ''

      const result = await inspectPageForQuestion(imageBuffer, question, sheetNumber, sheetTitle, calloutPatterns)
      totalCost += result.costUsd

      inspectedPages.push({ sheetNumber, sheetTitle, documentId, pageNumber: row.page_number })

      if (result.json?.canAnswer && result.json.findingStatement) {
        allFindings.push({
          sheet: sheetNumber,
          sheetTitle,
          finding: result.json.findingStatement,
          relevantVisibleEvidence: result.json.relevantVisibleEvidence,
          confidence: result.json.confidence,
          isComplete: result.json.isComplete,
          matchLinesFound: result.json.matchLineReferences ?? [],
        })
      }
    }
  }

  // ── Assemble result ───────────────────────────────────────────────────────
  const coverageAssessment = computeCoverageAssessment(allFindings)
  const formattedContext = formatPlanReaderContext(question, inspectedPages, allFindings, followedMatchLines)

  console.log('[PlanReader] Done:', {
    pagesInspected: inspectedPages.length,
    findings: allFindings.length,
    matchLinesFollowed: followedMatchLines.length,
    coverage: coverageAssessment,
    costUsd: totalCost.toFixed(4),
  })

  return {
    wasRun: true,
    pagesInspected: inspectedPages,
    findings: allFindings,
    matchLinesFollowed: followedMatchLines,
    coverageAssessment,
    formattedContext,
    totalCostUsd: totalCost,
  }
}

/**
 * Convert plan reader findings into EvidenceItems for merging into the packet.
 * These are sourced as 'vision_db' and given high confidence since they are
 * direct visual observations from the actual sheets.
 */
export function planReaderToEvidenceItems(
  result: PlanReaderResult
): import('./types').EvidenceItem[] {
  if (!result.wasRun || result.findings.length === 0) return []

  return result.findings.map(f => ({
    source: 'vision_db' as const,
    content: `[Plan Reader — Sheet ${f.sheet}] ${f.finding}`,
    citation: { sheetNumber: f.sheet },
    confidence: f.confidence,
    rawData: {
      type: 'plan_reader_inspection',
      sheetTitle: f.sheetTitle,
      relevantVisibleEvidence: f.relevantVisibleEvidence,
      isComplete: f.isComplete,
    },
  }))
}

// ---------------------------------------------------------------------------
// Page inspection — the core multimodal call
// ---------------------------------------------------------------------------

interface InspectionCallResult {
  json: PageInspectionJson | null
  rawText: string
  costUsd: number
}

async function inspectPageForQuestion(
  imageBuffer: Buffer,
  question: string,
  sheetNumber: string,
  sheetTitle: string,
  calloutPatterns?: MemoryItem[]
): Promise<InspectionCallResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = buildInspectionPrompt(question, sheetNumber, sheetTitle, calloutPatterns)
  const base64Image = imageBuffer.toString('base64')

  try {
    const response = await client.messages.create({
      model: PLAN_READER_MODEL,
      max_tokens: PLAN_READER_MAX_TOKENS,
      temperature: 0.0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    })

    const rawText = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const costUsd = estimateCost(response.usage.input_tokens, response.usage.output_tokens)
    const json = parseInspectionJson(rawText)

    return { json, rawText, costUsd }
  } catch (err) {
    console.error('[PlanReader] inspectPageForQuestion error:', err)
    return { json: null, rawText: '', costUsd: 0 }
  }
}

// ---------------------------------------------------------------------------
// Inspection prompt
// ---------------------------------------------------------------------------

function buildInspectionPrompt(
  question: string,
  sheetNumber: string,
  sheetTitle: string,
  calloutPatterns?: MemoryItem[]
): string {
  const calloutBlock = calloutPatterns && calloutPatterns.length > 0
    ? formatCalloutPatternsForPrompt(calloutPatterns)
    : null

  return `You are inspecting a construction drawing to answer a specific question.

QUESTION: "${question}"

SHEET: ${sheetNumber}${sheetTitle ? ` — ${sheetTitle}` : ''}${calloutBlock ? `\n\n${calloutBlock}` : ''}

Instructions:
1. Read ALL visible text, labels, callouts, dimension strings, table entries, and notes
2. Specifically look for information that answers the question above
3. Report EXACT text and values visible on the sheet — do not interpolate or guess
4. Look carefully for:
   - Pipe sizes, dimensions, material callouts
   - Station labels (e.g. "STA 13+47.20", "BEGIN WL-B", "END WL-B")
   - Quantity tables and their values
   - Schedule data (door, window, pipe, equipment schedules)
   - Horizontal and profile view labels
   - Detail callouts and reference numbers
5. Note any continuation references:
   - "MATCH LINE" or "MATCH LINE SEE SHEET X"
   - "CONTINUED ON SHEET X"
   - "SEE SHEET X FOR CONTINUATION"
   - "THIS SHEET ENDS STA X+XX"
6. For linear systems (waterlines, sewers, etc.): note the beginning and ending station range visible on this sheet
7. Be honest — if the answer is not visible on this sheet, say so clearly

Respond with valid JSON only (no markdown, no surrounding text):
{
  "canAnswer": true or false,
  "findingStatement": "Precise statement of what was found related to the question. Empty string if canAnswer=false.",
  "relevantVisibleEvidence": "Exact text, labels, values, and callouts visible on the sheet that relate to the question",
  "confidence": 0.0 to 1.0,
  "isComplete": true or false (true only if this sheet alone fully answers the question),
  "matchLineReferences": ["SHEET X", "SHEET Y"],
  "missingInformation": "What aspect of the question is not answered by this sheet"
}`
}

// ---------------------------------------------------------------------------
// JSON parsing (robust — handles trailing text from model)
// ---------------------------------------------------------------------------

function parseInspectionJson(rawText: string): PageInspectionJson | null {
  // Strip markdown code fences if present
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  // Find the first { and the last } to isolate the JSON object
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1) return null

  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1))
    return {
      canAnswer: Boolean(parsed.canAnswer),
      findingStatement: String(parsed.findingStatement ?? ''),
      relevantVisibleEvidence: String(parsed.relevantVisibleEvidence ?? ''),
      confidence: Number(parsed.confidence ?? 0),
      isComplete: Boolean(parsed.isComplete),
      matchLineReferences: Array.isArray(parsed.matchLineReferences)
        ? parsed.matchLineReferences.map(String)
        : [],
      missingInformation: String(parsed.missingInformation ?? ''),
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Page retrieval helpers
// ---------------------------------------------------------------------------

/**
 * Query document_pages for all rows matching the given sheet numbers.
 * Prefer rows with both plan and profile views.
 */
async function findPageRows(
  sheetNumbers: string[],
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<DocumentPageRow[]> {
  if (sheetNumbers.length === 0) return []

  try {
    // Find documents belonging to this project first
    const { data: docs, error: dErr } = await supabase
      .from('documents')
      .select('id')
      .eq('project_id', projectId)

    if (dErr || !docs || docs.length === 0) return []
    const docIds = docs.map((d: { id: string }) => d.id)

    // Find pages by sheet number within those documents
    const normalizedSheets = sheetNumbers.map(s => s.trim().toUpperCase())

    const { data, error } = await supabase
      .from('document_pages')
      .select('id, document_id, page_number, sheet_number, sheet_title, has_plan_view, has_profile_view')
      .in('document_id', docIds)
      .in('sheet_number', normalizedSheets)
      .order('page_number', { ascending: true })

    if (error) {
      console.warn('[PlanReader] findPageRows error:', error.message)
      return []
    }

    // Deduplicate: one row per sheet number, preferring plan+profile
    const best = new Map<string, DocumentPageRow>()
    for (const row of (data ?? []) as DocumentPageRow[]) {
      const key = (row.sheet_number ?? '').toUpperCase()
      const existing = best.get(key)
      if (!existing) {
        best.set(key, row)
      } else {
        // Prefer the row that has both views
        const newScore = (row.has_plan_view ? 1 : 0) + (row.has_profile_view ? 1 : 0)
        const existScore = (existing.has_plan_view ? 1 : 0) + (existing.has_profile_view ? 1 : 0)
        if (newScore > existScore) best.set(key, row)
      }
    }

    return [...best.values()]
  } catch (err) {
    console.error('[PlanReader] findPageRows exception:', err)
    return []
  }
}

// deriveSheetsFromQuery removed — replaced by narrowCandidateSheets()

/**
 * Download a PDF from Supabase Storage given a document_id.
 * Returns null on failure (caller skips this document).
 */
async function downloadPdf(
  documentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<Buffer | null> {
  try {
    const { data: doc, error: dErr } = await supabase
      .from('documents')
      .select('file_path')
      .eq('id', documentId)
      .single()

    if (dErr || !doc?.file_path) return null

    // Get a signed URL (60-second expiry is enough for one download)
    const { data: signedData, error: sErr } = await supabase.storage
      .from('documents')
      .createSignedUrl(doc.file_path, 60)

    if (sErr || !signedData?.signedUrl) return null

    const response = await fetch(signedData.signedUrl)
    if (!response.ok) return null

    // Enforce size limit
    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_PDF_SIZE_BYTES) {
      console.warn(`[PlanReader] PDF too large (${contentLength} bytes), skipping document ${documentId}`)
      return null
    }

    return Buffer.from(await response.arrayBuffer())
  } catch (err) {
    console.error('[PlanReader] downloadPdf error:', err)
    return null
  }
}

/**
 * Convert a single PDF page to a PNG image buffer.
 * Returns null on failure.
 */
async function renderPage(pdfBuffer: Buffer, pageNumber: number): Promise<Buffer | null> {
  try {
    const image = await convertPdfPageToImage(pdfBuffer, pageNumber, {
      scale: 2.0,
      maxWidth: 2048,
      maxHeight: 2048,
      format: 'png',
    })
    return image.buffer
  } catch (err) {
    console.error(`[PlanReader] renderPage error (page ${pageNumber}):`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Coverage assessment
// ---------------------------------------------------------------------------

function computeCoverageAssessment(
  findings: PlanReaderFinding[]
): PlanReaderResult['coverageAssessment'] {
  if (findings.length === 0) return 'insufficient'
  if (findings.some(f => f.isComplete)) return 'complete'
  return 'partial'
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatPlanReaderContext(
  question: string,
  pagesInspected: InspectedPage[],
  findings: PlanReaderFinding[],
  matchLinesFollowed: string[]
): string {
  const lines: string[] = [
    '## DIRECT PLAN INSPECTION',
    '',
    `Question asked of the drawings: "${question}"`,
    `Sheets physically inspected: ${pagesInspected.map(p => p.sheetNumber).join(', ') || 'none'}`,
  ]

  if (matchLinesFollowed.length > 0) {
    lines.push(`Match-line continuations followed: ${matchLinesFollowed.join(', ')}`)
  }

  lines.push('')

  if (findings.length === 0) {
    lines.push('**No relevant information was visible on the inspected sheets.**')
    lines.push('The answer to this question could not be confirmed by direct plan inspection.')
    return lines.join('\n')
  }

  lines.push('**Confirmed from direct inspection:**')
  lines.push('')

  for (const f of findings) {
    const completeness = f.isComplete ? '(complete answer)' : '(partial — continued on other sheets)'
    lines.push(`### Sheet ${f.sheet}${f.sheetTitle ? ` — ${f.sheetTitle}` : ''}`)
    lines.push(`**Finding:** ${f.finding} ${completeness}`)
    lines.push(`**Visible evidence:** ${f.relevantVisibleEvidence}`)
    lines.push(`**Confidence:** ${Math.round(f.confidence * 100)}%`)
    if (f.matchLinesFound.length > 0) {
      lines.push(`**Continues on:** ${f.matchLinesFound.join(', ')}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push(
    '**CRITICAL:** The findings above come from direct visual inspection of the actual plan sheets. ' +
    'They represent ground truth. Use them as the primary source for your answer. ' +
    'Cite the sheet number for every fact.'
  )

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Normalize a match-line reference string like "SEE SHEET CU110" → "CU110".
 * Returns null if the reference can't be parsed.
 */
function normalizeSheetRef(raw: string): string | null {
  // Strip common prefixes: "SEE SHEET X", "CONTINUED ON X", "MATCH LINE SHEET X"
  const cleaned = raw
    .replace(/^(see\s+sheet|continued\s+on(\s+sheet)?|match\s+line(\s+see\s+sheet)?)\s*/i, '')
    .trim()
    .toUpperCase()

  if (!cleaned || cleaned.length > 20) return null
  return cleaned
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  // Haiku 4.5 pricing: $0.40/$2.00 per 1M tokens
  return (inputTokens * 0.40 + outputTokens * 2.00) / 1_000_000
}

function notRun(reason: string): PlanReaderResult {
  return {
    wasRun: false,
    skipReason: reason,
    pagesInspected: [],
    findings: [],
    matchLinesFollowed: [],
    coverageAssessment: 'insufficient',
    formattedContext: '',
    totalCostUsd: 0,
  }
}
