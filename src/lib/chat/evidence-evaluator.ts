/**
 * Evidence Evaluator — scores the sufficiency of retrieved evidence.
 *
 * Called between retrieval-orchestrator and response-writer.
 * The sufficiency score controls how the response-writer constrains the model:
 *
 *   sufficient   → answer directly from evidence
 *   partial      → answer with explicit caveats and source limits
 *   insufficient → return insufficient_evidence mode with what was searched
 *
 * This is the gating layer that prevents the model from generating confident
 * answers from weak or absent evidence.
 */

import type {
  EvidencePacket,
  EvidenceItem,
  QueryAnalysis,
  SufficiencyResult,
  SufficiencyLevel,
  LiveAnalysisMeta,
} from './types'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function evaluateSufficiency(
  packet: EvidencePacket,
  analysis: QueryAnalysis
): SufficiencyResult {
  // ── Hard verification gate ───────────────────────────────────────────────
  // If sheet verification ran (Type B/C/D query) and returned coverageStatus
  // 'insufficient', the answer MUST be gated regardless of what other
  // retrieval sources found.  This is code-level enforcement — not prompt-based.
  if (
    packet.verificationMeta?.wasVerified &&
    packet.verificationMeta.coverageStatus === 'insufficient'
  ) {
    const meta = packet.verificationMeta
    const missingEvidence = meta.missingEvidence.length > 0 ? meta.missingEvidence : meta.evidenceGaps
    const candidateCount = meta.candidateSheets.length

    const gaps = missingEvidence.length > 0
      ? missingEvidence
      : ['No confirmed findings in structured tables for this query.']

    if (candidateCount > 0) {
      gaps.unshift(
        `${candidateCount} candidate sheet(s) identified in the project, but none produced confirmed findings for this query.`
      )
    }

    return {
      level: 'insufficient',
      score: 0,
      reasons: [
        `Type ${meta.questionType} verification ran but found no confirmed evidence`,
        `Coverage status: INSUFFICIENT (0 findings from ${candidateCount} candidate sheets)`,
      ],
      gaps,
      isUnsupportedDomain: false,
    }
  }

  // General chat: always sufficient — no project data required.
  // (The response-writer still injects any available evidence as context.)
  if (analysis.answerMode === 'general_chat') {
    return {
      level: 'sufficient',
      score: 1.0,
      reasons: ['General knowledge query — no project evidence required'],
      gaps: [],
      isUnsupportedDomain: false,
    }
  }

  // Sequence inference: use PE expertise when the query is purely procedural,
  // but downgrade to 'partial' if the query names a specific system and no
  // structured evidence was retrieved — the crew needs project-specific context.
  if (analysis.answerMode === 'sequence_inference') {
    const hasProjectContext = packet.items.length > 0
    const mentionsSpecificSystem = analysis.requestedSystems.length > 0 || !!analysis.entities.itemName
    if (mentionsSpecificSystem && !hasProjectContext) {
      return {
        level: 'partial',
        score: 0.3,
        reasons: [
          'Sequence inference for a named system — PE expertise provides the framework but project-specific conditions are needed',
          'No structured project evidence was retrieved for the referenced system',
        ],
        gaps: [
          `No indexed data found for "${analysis.entities.itemName ?? analysis.requestedSystems[0] ?? 'referenced system'}"`,
          'Construction sequence may depend on project-specific constraints not available from general knowledge',
        ],
        isUnsupportedDomain: false,
      }
    }
    return {
      level: 'sufficient',
      score: hasProjectContext ? 0.8 : 0.6,
      reasons: [
        hasProjectContext
          ? 'Sequence inference with project context — PE expertise + project data'
          : 'Procedural sequence query — PE expertise is primary source',
      ],
      gaps: [],
      isUnsupportedDomain: false,
    }
  }

  // Unsupported domains fail immediately — no pipeline exists.
  if (analysis.supportLevelExpected === 'unsupported') {
    return {
      level: 'insufficient',
      score: 0,
      reasons: ['No supporting pipeline exists for this query type (specification/requirement)'],
      gaps: [
        'Specification ingestion has not been implemented.',
        'Answers about material requirements, installation standards, or spec sections cannot be sourced from plans alone.',
        'Upload spec documents and run spec ingestion to enable this query type.',
      ],
      isUnsupportedDomain: true,
    }
  }

  // No evidence at all.
  if (packet.items.length === 0) {
    return noEvidence(analysis)
  }

  const reasons: string[] = []
  const gaps: string[] = []
  let score = 0

  // ------------------------------------------------------------------
  // Score each evidence factor
  // ------------------------------------------------------------------

  // Factor 1: Presence of high-quality structured sources
  const structuredItems = packet.items.filter(
    i => i.source === 'vision_db' || i.source === 'direct_lookup' || i.source === 'project_summary'
  )
  if (structuredItems.length > 0) {
    score += 0.4
    reasons.push(`${structuredItems.length} structured data item(s) from vision DB or direct lookup`)
  }

  // Factor 2: Vector/chunk search results (informational value)
  const vectorItems = packet.items.filter(
    i => i.source === 'vector_search' || i.source === 'complete_data'
  )
  if (vectorItems.length > 0) {
    score += Math.min(0.3, vectorItems.length * 0.05)
    reasons.push(`${vectorItems.length} document chunk(s) from vector search`)
  }

  // Factor 3: Live PDF analysis (valuable but may be incomplete)
  const liveItems = packet.items.filter(i => i.source === 'live_pdf_analysis')
  if (liveItems.length > 0) {
    const baseLivScore = 0.3
    score += baseLivScore
    reasons.push('Live PDF analysis was performed')
  }

  // Factor 4: Downgrade if live analysis was capped or had skips
  if (packet.liveAnalysisMeta) {
    const meta = packet.liveAnalysisMeta
    if (meta.wasCapped) {
      score = Math.max(0, score - 0.15)
      gaps.push(`Analysis was capped at ${meta.capLimit} sheets. More sheets may exist.`)
      reasons.push(`⚠️ Sheet cap: ${meta.sheetsAnalyzed}/${meta.sheetsAttempted} sheets analyzed`)
    }
    if (meta.sheetsSkipped > 0) {
      score = Math.max(0, score - 0.1 * Math.min(meta.sheetsSkipped, 3))
      gaps.push(`${meta.sheetsSkipped} sheet(s) were skipped (size or download errors)`)
      meta.skipReasons.forEach(r => gaps.push(`  - ${r}`))
    }
    if (meta.sheetsAnalyzed === 0) {
      return noEvidence(analysis)
    }
  }

  // Factor 5: Average confidence of items
  const avgConfidence = averageConfidence(packet.items)
  if (avgConfidence >= 0.8) {
    score += 0.15
  } else if (avgConfidence < 0.5) {
    score = Math.max(0, score - 0.15)
    gaps.push('Evidence confidence is low — results may be incomplete or ambiguous')
  }

  // Factor 6: Query-mode-specific checks
  const modeChecks = checkModeSpecificRequirements(packet, analysis)
  score = Math.max(0, Math.min(1.0, score + modeChecks.adjustment))
  reasons.push(...modeChecks.reasons)
  gaps.push(...modeChecks.gaps)

  // ------------------------------------------------------------------
  // Convert score to level
  // ------------------------------------------------------------------
  const level = scoreToLevel(score, analysis.answerMode)

  return {
    level,
    score: Math.round(score * 100) / 100,
    reasons,
    gaps,
    isUnsupportedDomain: false,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function noEvidence(analysis: QueryAnalysis): SufficiencyResult {
  const gaps: string[] = []

  switch (analysis.answerMode) {
    case 'quantity_lookup':
      gaps.push('No quantity data found in the database.')
      gaps.push('Use the Analyze button to run vision processing on the project PDFs.')
      break
    case 'crossing_lookup':
      gaps.push('No utility crossing data found in the database.')
      gaps.push('Vision processing must be run on profile view sheets to extract crossing data.')
      break
    case 'project_summary':
      gaps.push('No aggregated project data found.')
      gaps.push('Run vision processing on all project sheets to generate a project summary.')
      break
    default:
      gaps.push('No relevant project documents were found for this query.')
  }

  return {
    level: 'insufficient',
    score: 0,
    reasons: ['No evidence items were retrieved from any source'],
    gaps,
    isUnsupportedDomain: false,
  }
}

function checkModeSpecificRequirements(
  packet: EvidencePacket,
  analysis: QueryAnalysis
): { adjustment: number; reasons: string[]; gaps: string[] } {
  const reasons: string[] = []
  const gaps: string[] = []
  let adjustment = 0

  switch (analysis.answerMode) {
    case 'quantity_lookup': {
      const hasStructured = packet.items.some(
        i => i.source === 'vision_db' || i.source === 'direct_lookup'
      )
      const hasVectorEvidence = packet.items.some(
        i => i.source === 'vector_search' || i.source === 'complete_data'
      )
      if (hasStructured) {
        adjustment += 0.1
        reasons.push('Quantity sourced from structured vision data — high reliability')
      } else if (!hasVectorEvidence) {
        // Penalize only when there is truly no supporting evidence of any kind.
        adjustment -= 0.1
        gaps.push('Quantity answers are most accurate when sourced from vision-extracted DB data.')
      } else {
        // Vector-only: neutral — can reach partial with multiple high-confidence chunks,
        // but never sufficient. Still flag the gap.
        gaps.push('Quantity answers are most accurate when sourced from vision-extracted DB data.')
      }
      break
    }

    case 'crossing_lookup': {
      // Mirror quantity_lookup: give a positive bonus for structured data so that
      // two vision_db crossing records clear the 0.65 sufficient threshold.
      const hasCrossingData = packet.items.some(i => i.source === 'vision_db')
      if (hasCrossingData) {
        adjustment += 0.1
        reasons.push('Crossing data sourced from structured vision records — high reliability')
      } else {
        adjustment -= 0.1
        gaps.push('Crossing queries are most reliable when sourced from vision-extracted crossing records.')
      }
      break
    }

    case 'sheet_lookup': {
      // Reward items that carry explicit sheet or document citations.
      // Concentrated same-sheet hits are far more reliable than raw item count.
      const citedItems = packet.items.filter(
        i => i.citation?.sheetNumber || i.citation?.documentId
      )
      if (citedItems.length > 0) {
        adjustment += Math.min(0.2, citedItems.length * 0.1)
        reasons.push(`${citedItems.length} item(s) with explicit sheet citation`)
      }
      break
    }

    case 'requirement_lookup': {
      // Spec queries — this should have been caught by unsupported domain check,
      // but guard here anyway.
      adjustment -= 0.5
      gaps.push('Spec/requirement answers require specification document ingestion.')
      break
    }

    case 'general_chat': {
      // General chat doesn't require specific sources.
      adjustment += 0.1
      reasons.push('General chat query — answer from available context')
      break
    }
  }

  return { adjustment, reasons, gaps }
}

function scoreToLevel(score: number, answerMode: string): SufficiencyLevel {
  // High-precision factual queries — quantities, crossings, element lookups,
  // schedule queries, spec lookups. All require structured evidence to reach
  // 'sufficient'. Vector-search alone cannot clear the bar.
  const isPrecise = [
    'quantity_lookup',
    'crossing_lookup',
    'arch_element_lookup',
    'arch_schedule_query',
    'struct_element_lookup',
    'mep_element_lookup',
    'spec_section_lookup',
    'spec_requirement_lookup',
    'rfi_lookup',
    'submittal_lookup',
  ].includes(answerMode)

  if (isPrecise) {
    if (score >= 0.65) return 'sufficient'
    if (score >= 0.35) return 'partial'
    return 'insufficient'
  }

  // All other modes with project-evidence requirement.
  // Raised from 0.40 → 0.50: embeddings alone can reach ~0.35 (0.3 vector + 0.05 confidence).
  // A field answer backed only by embeddings is not sufficient — it needs at
  // least some structured data (0.4 structured) or live analysis to reach 0.50.
  if (score >= 0.50) return 'sufficient'
  if (score >= 0.25) return 'partial'
  return 'insufficient'
}

function averageConfidence(items: EvidenceItem[]): number {
  if (items.length === 0) return 0
  return items.reduce((sum, i) => sum + i.confidence, 0) / items.length
}
