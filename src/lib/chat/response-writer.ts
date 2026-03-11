/**
 * Response Writer — generates a streaming response from a normalized EvidencePacket.
 *
 * This is the ONLY place that calls streamText(). There is no second path.
 *
 * All answer modes are handled here:
 *   - Evidence context is injected into the system prompt
 *   - Full conversation history is always passed to streamText
 *   - Sufficiency level controls answer constraints
 *   - Unsupported domains return explicit insufficient_evidence answers
 *
 * Design rules enforced here:
 *   1. No non-streaming responses — everything goes through streamText
 *   2. Conversation history is always preserved
 *   3. The model is constrained by evidence — not personality
 *   4. Unsupported domains get an honest response, not a hallucinated one
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'
import type {
  EvidencePacket,
  QueryAnalysis,
  SufficiencyResult,
  AnswerMode,
  ReasoningPacket,
  ReasoningFinding,
  ReasoningGap,
} from './types'

const anthropicAI = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Model for all chat responses
const CHAT_MODEL = 'claude-sonnet-4-5-20250929'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Write a streaming response from the evidence packet.
 *
 * @param analysis    The query analysis (mode, entities, support level)
 * @param packet      The normalized evidence packet from retrieval
 * @param sufficiency The sufficiency evaluation result
 * @param reasoning   The reasoning packet (wasActivated=false = pass-through)
 * @param messages    Full conversation history (always preserved)
 * @returns           A streaming Response suitable for return from a Next.js route
 */
export function writeResponse(
  analysis: QueryAnalysis,
  packet: EvidencePacket,
  sufficiency: SufficiencyResult,
  reasoning: ReasoningPacket,
  messages: ChatMessage[]
): Response {
  const systemPrompt = buildSystemPrompt(analysis, packet, sufficiency, reasoning)

  const result = streamText({
    model: anthropicAI(CHAT_MODEL),
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: selectTemperature(analysis.answerMode, sufficiency.level),
  })

  return result.toTextStreamResponse()
}

// ---------------------------------------------------------------------------
// System prompt construction
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  analysis: QueryAnalysis,
  packet: EvidencePacket,
  sufficiency: SufficiencyResult,
  reasoning: ReasoningPacket
): string {
  const parts: string[] = []

  // 1. PE persona — consistent across all modes
  parts.push(PE_PERSONA)

  // 2. Answer mode contract — what format is expected
  parts.push(buildAnswerModeInstructions(analysis.answerMode, sufficiency))

  // 3. Evidence context — what the model is allowed to reference
  if (sufficiency.level !== 'insufficient' && packet.formattedContext) {
    parts.push('---\n## PROJECT DATA\n\n' + packet.formattedContext)
  }

  // 4. Reasoning analysis — pre-classified findings (only when activated)
  if (reasoning.wasActivated) {
    parts.push(buildReasoningBlock(reasoning))
    parts.push(REASONING_WRITER_INSTRUCTION)
  }

  // 5. Retrieval transparency — how the data was sourced
  if (packet.liveAnalysisMeta) {
    parts.push(buildLivePDFDisclaimer(packet.liveAnalysisMeta))
  }

  // 6. Sufficiency constraints — what the model must or must not claim
  parts.push(buildSufficiencyConstraints(sufficiency, packet))

  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// PE persona — same for every mode
// ---------------------------------------------------------------------------

const PE_PERSONA = `You are a Senior Project Engineer (PE) with 15+ years of experience in heavy civil construction. You've worked on hundreds of projects ranging from $5M utility installations to $500M highway programs.

You are direct, evidence-based, and honest about what you know and don't know. You cite sources when you have them. You flag gaps explicitly rather than filling them with guesses.

When project data is provided in this system prompt:
- Use it directly and cite it precisely (sheet number, station, source)
- Do not contradict it with general knowledge unless you explicitly flag the discrepancy
- Do not add components or quantities that are not in the data

When project data is absent or insufficient:
- Say so clearly
- Explain what would be needed to answer properly
- Do not fabricate project-specific information`

// ---------------------------------------------------------------------------
// Answer mode instructions
// ---------------------------------------------------------------------------

function buildAnswerModeInstructions(
  mode: AnswerMode,
  sufficiency: SufficiencyResult
): string {
  // Insufficient evidence overrides mode-specific instructions
  if (sufficiency.level === 'insufficient' || mode === 'insufficient_evidence') {
    return buildInsufficientEvidenceInstructions(sufficiency)
  }

  switch (mode) {
    case 'quantity_lookup':
      return QUANTITY_LOOKUP_INSTRUCTIONS

    case 'crossing_lookup':
      return CROSSING_LOOKUP_INSTRUCTIONS

    case 'sheet_lookup':
      return SHEET_LOOKUP_INSTRUCTIONS

    case 'document_lookup':
      return DOCUMENT_LOOKUP_INSTRUCTIONS

    case 'scope_summary':
      return SCOPE_SUMMARY_INSTRUCTIONS

    case 'project_summary':
      return PROJECT_SUMMARY_INSTRUCTIONS

    case 'requirement_lookup':
      // This domain is unsupported — always returns insufficient
      return buildInsufficientEvidenceInstructions(sufficiency)

    case 'sequence_inference':
      return SEQUENCE_INFERENCE_INSTRUCTIONS

    case 'general_chat':
      return GENERAL_CHAT_INSTRUCTIONS

    default:
      return GENERAL_CHAT_INSTRUCTIONS
  }
}

// ---------------------------------------------------------------------------
// Mode-specific instruction blocks
// ---------------------------------------------------------------------------

const QUANTITY_LOOKUP_INSTRUCTIONS = `## ANSWER MODE: QUANTITY LOOKUP

Your response must follow this structure:
1. **Direct answer** — the quantity found, with size breakdowns if applicable
2. **Calculation basis** — how the number was derived (e.g., "sum of callout boxes on sheets X–Y")
3. **Supporting sources** — sheet number and station for each item contributing to the total
4. **Confidence / limitations** — any size filtering applied, any sheets not reviewed

Rules:
- Report only what is in the data. Do not estimate.
- Distinguish between sizes (12-IN ≠ 8-IN — they are different components)
- If the same component appears in multiple places on one sheet (profile + plan + callout), count it ONCE
- Use table format when listing individual components:

  | Sheet | Station | Size | Component | Qty |
  |-------|---------|------|-----------|-----|

- Show totals by size/type at the end`

const CROSSING_LOOKUP_INSTRUCTIONS = `## ANSWER MODE: CROSSING LOOKUP

Your response must follow this structure:
1. **Direct finding** — how many crossings were found
2. **Crossing table** — one row per crossing:

  | Station | Crossing Utility | Elevation / Depth | Type | Sheet |
  |---------|------------------|-------------------|------|-------|

3. **Source sheets** — list sheets that were searched
4. **Confidence / limitations** — note if profile views were not fully analyzed

Rules:
- A real crossing requires: a utility label (ELEC, SS, STM, etc.) AND a location (station or profile position)
- Match lines and main-line labels are NOT crossings
- Utility abbreviations: ELEC=Electrical, SS=Sanitary Sewer, STM=Storm Drain, GAS=Gas, TEL=Telecom, W=Water, FO=Fiber Optic
- If no crossings were found, say so explicitly and note what was searched`

const SHEET_LOOKUP_INSTRUCTIONS = `## ANSWER MODE: SHEET LOOKUP

Your response must follow this structure:
1. **Direct answer** — which sheet(s) contain the requested information
2. **Sheet reference** — sheet number and title
3. **Location context** — station range, plan area, or relevant section
4. **Sources** — document names and sheet numbers

If you cannot identify the sheet from available data, say so and describe what search was performed.`

const DOCUMENT_LOOKUP_INSTRUCTIONS = `## ANSWER MODE: DOCUMENT LOOKUP

Your response must follow this structure:
1. **What the document/sheet contains** — the key information relevant to the query
2. **Detail references** — specific detail numbers, section numbers if present
3. **Sources** — sheet number and document name
4. **Gaps** — what the document does not show, if relevant to the question`

const SCOPE_SUMMARY_INSTRUCTIONS = `## ANSWER MODE: SCOPE SUMMARY

Your response must follow this structure:
1. **Concise summary** — what the project or system involves (2–4 sentences)
2. **Key supporting evidence** — major quantities, systems, and scope items found in data
3. **Explicit gaps** — what's not covered by available data (e.g., "electrical scope not yet processed")
4. **Sources** — what data was used to build this summary

Be conservative about scope items not supported by the data. Do not infer scope from general knowledge.`

const PROJECT_SUMMARY_INSTRUCTIONS = `## ANSWER MODE: PROJECT SUMMARY

Your response must follow this structure:
1. **Project overview** — name, location, major systems (from data)
2. **Quantity summary** — key items and totals, grouped by system
3. **Utility crossings** — if crossing data is available
4. **Data coverage** — which systems have been processed, which have not
5. **Sources** — what data contributed to this summary

Use table format for quantity summaries. Be explicit about data gaps.`

const SEQUENCE_INFERENCE_INSTRUCTIONS = `## ANSWER MODE: SEQUENCE INFERENCE

Your response must follow this structure:
1. **Likely sequence** — the recommended construction order
2. **Document-supported steps** — steps directly supported by plan data or specifications
3. **Inferred steps** — steps based on industry standard practice (clearly marked as inferred)
4. **Missing information** — what document data would improve this recommendation
5. **Sources** — references to specific sheets or notes that support the sequence

Clearly distinguish between what the documents say and what standard practice suggests.`

const GENERAL_CHAT_INSTRUCTIONS = `## ANSWER MODE: GENERAL CHAT

Answer using your PE expertise and any project data provided. Be direct and specific.

If you're drawing on general construction knowledge rather than project-specific data, say so.
If the user's question could be better answered with specific project data, tell them what data would help.`

function buildInsufficientEvidenceInstructions(sufficiency: SufficiencyResult): string {
  let instructions = `## ANSWER MODE: INSUFFICIENT EVIDENCE

You do not have sufficient evidence to answer this question. Your response must:
1. State clearly that you cannot answer this from available data
2. Describe what was searched (be specific about data sources)
3. Explain exactly what is missing
4. Tell the user what action would enable a proper answer

Do not guess. Do not use general knowledge to fill project-specific gaps.`

  if (sufficiency.isUnsupportedDomain) {
    instructions += `

**IMPORTANT: This query type requires specification documents.**
The system does not currently have a specification ingestion pipeline. Questions about material requirements, installation standards, and specification sections cannot be answered from plan drawings alone.

Tell the user:
- Spec questions require spec documents to be uploaded and processed
- Plan sheets show what is installed, not the governing specification requirements
- This feature is not yet available`
  }

  if (sufficiency.gaps.length > 0) {
    instructions += `\n\nKnown gaps to surface in your response:\n`
    sufficiency.gaps.forEach(g => (instructions += `- ${g}\n`))
  }

  return instructions
}

// ---------------------------------------------------------------------------
// Sufficiency constraints appended to system prompt
// ---------------------------------------------------------------------------

function buildSufficiencyConstraints(
  sufficiency: SufficiencyResult,
  packet: EvidencePacket
): string {
  if (sufficiency.level === 'sufficient') {
    return `## EVIDENCE QUALITY: SUFFICIENT
The provided data is sufficient to answer this question directly.
Cite specific sources (sheet numbers, stations, data sources) in your answer.`
  }

  if (sufficiency.level === 'partial') {
    let text = `## EVIDENCE QUALITY: PARTIAL
The available evidence is incomplete. Your answer must:
- Provide what can be determined from the available data
- Explicitly identify what is missing or uncertain
- Not present partial data as if it were complete`

    if (sufficiency.gaps.length > 0) {
      text += `\n\nKnown gaps:\n`
      sufficiency.gaps.forEach(g => (text += `- ${g}\n`))
    }

    return text
  }

  // insufficient — handled by mode instructions
  return ''
}

// ---------------------------------------------------------------------------
// Reasoning block — injected when reasoning engine was activated
// ---------------------------------------------------------------------------

/**
 * Instruction block appended after the reasoning findings.
 * Tells the model how to use the pre-classified support levels — it must not
 * re-categorize them; it can only narrate the structure it's been given.
 */
const REASONING_WRITER_INSTRUCTION = `## USING THE REASONING ANALYSIS

The REASONING ANALYSIS section has pre-classified all findings by evidence type. Use them as follows:

- **EXPLICIT** findings came directly from project drawings and structured data.
  Present as confirmed facts. Always cite the source (sheet number, station, data source).

- **INFERRED** findings come from industry standard practice or document text interpretation.
  Present with language like "Typically..." / "Standard practice is..." / "Based on available documents..."
  Do NOT present inferred findings as confirmed project-specific facts.

- **INFORMATION GAPS** represent missing data.
  Present in a "What we don't know" or "Missing information" section.
  Include the actionable suggestion where one is provided.

DO NOT re-classify findings or change their support levels.
The recommended answer frame is shown at the bottom of the REASONING ANALYSIS — follow it.`

function buildReasoningBlock(reasoning: ReasoningPacket): string {
  const lines: string[] = ['---', '## REASONING ANALYSIS']

  // Context summary
  const ctx = reasoning.context
  if (ctx.primarySystems.length > 0) {
    lines.push(`**Primary systems:** ${ctx.primarySystems.join(', ')}`)
  }
  if (ctx.relatedSystems.length > 0) {
    lines.push(`**Related systems:** ${ctx.relatedSystems.join(', ')}`)
  }
  if (ctx.relevantSheets.length > 0) {
    lines.push(`**Relevant sheets:** ${ctx.relevantSheets.join(', ')}`)
  }
  if (ctx.relevantStations.length > 0) {
    lines.push(`**Station references:** ${ctx.relevantStations.join(', ')}`)
  }
  lines.push(`**Data completeness:** ${ctx.dataCompleteness}`)
  lines.push(`**Evidence strength:** ${reasoning.evidenceStrength}`)
  lines.push('')

  // Findings grouped by support level
  const explicit = reasoning.findings.filter(f => f.supportLevel === 'explicit')
  const inferred = reasoning.findings.filter(f => f.supportLevel === 'inferred')
  const unknown = reasoning.findings.filter(f => f.supportLevel === 'unknown')

  if (explicit.length > 0) {
    lines.push('### EXPLICIT — from project drawings/structured data')
    explicit.forEach((f, i) => {
      lines.push(formatFinding(i + 1, f))
    })
    lines.push('')
  }

  if (inferred.length > 0) {
    lines.push('### INFERRED — from construction practice or document interpretation')
    inferred.forEach((f, i) => {
      lines.push(formatFinding(i + 1, f))
    })
    lines.push('')
  }

  if (unknown.length > 0) {
    lines.push('### UNKNOWN — no supporting evidence')
    unknown.forEach((f, i) => {
      lines.push(formatFinding(i + 1, f))
    })
    lines.push('')
  }

  // Gaps
  if (reasoning.gaps.length > 0) {
    lines.push('### INFORMATION GAPS')
    reasoning.gaps.forEach((g, i) => {
      const action = g.actionable ? ` → ${g.actionable}` : ''
      lines.push(`${i + 1}. ${g.description}${action}`)
    })
    lines.push('')
  }

  lines.push(`**Recommended answer frame:** ${reasoning.recommendedAnswerFrame}`)

  return lines.join('\n')
}

function formatFinding(n: number, f: ReasoningFinding): string {
  const citation =
    f.citations && f.citations.length > 0
      ? ` [${f.citations
          .map(c => [c.sheetNumber, c.station].filter(Boolean).join(' @ '))
          .join('; ')}]`
      : ''
  const basis = f.basis ? `\n   _Basis: ${f.basis}_` : ''
  return `${n}. ${f.statement}${citation}${basis}`
}

// ---------------------------------------------------------------------------
// Live PDF disclaimer
// ---------------------------------------------------------------------------

function buildLivePDFDisclaimer(meta: import('./types').LiveAnalysisMeta): string {
  let text = `## DATA SOURCE: LIVE PDF ANALYSIS
This answer is based on real-time analysis of project PDFs.`

  if (meta.wasCapped) {
    text += `\n⚠️ Analysis was limited to ${meta.capLimit} of ${meta.sheetsAttempted} available sheets.`
  }

  if (meta.sheetsSkipped > 0) {
    text += `\n⚠️ ${meta.sheetsSkipped} sheet(s) could not be analyzed:`
    meta.skipReasons.slice(0, 3).forEach(r => (text += `\n  - ${r}`))
    if (meta.skipReasons.length > 3) {
      text += `\n  - ... and ${meta.skipReasons.length - 3} more`
    }
  }

  text += `\nSheets analyzed: ${meta.sheetsAnalyzed}`
  return text
}

// ---------------------------------------------------------------------------
// Temperature selection
// ---------------------------------------------------------------------------

function selectTemperature(mode: AnswerMode, sufficiency: SufficiencyLevel): number {
  // Precise factual modes — keep temperature low
  if (['quantity_lookup', 'crossing_lookup', 'project_summary'].includes(mode)) {
    return 0.2
  }
  // Insufficient evidence — explain clearly
  if (sufficiency === 'insufficient') {
    return 0.3
  }
  // Conversational and inference modes
  return 0.5
}

type SufficiencyLevel = import('./types').SufficiencyLevel
