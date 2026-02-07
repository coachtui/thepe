/**
 * PE Enhancer - Bridges PE Agent domain knowledge into the chat pipeline
 *
 * Enriches the existing system prompts with PE reasoning, domain knowledge,
 * and professional voice WITHOUT adding extra API calls or modifying
 * the existing RAG pipeline.
 *
 * Imports pure functions and data from src/agents/constructionPEAgent/
 * and injects token-efficient slices based on query intent.
 */

import { recognizeIntent, PE_VOICE } from '@/agents/constructionPEAgent/peReasoning'
import {
  CONTRACT_MINDSET,
  ROM_UNIT_COSTS,
  RFI_BEST_PRACTICES,
  CHANGE_ORDER_STRATEGY,
  WORK_TYPE_KNOWLEDGE,
  COMMON_SPEC_SECTIONS
} from '@/agents/constructionPEAgent/domainKnowledge'
import type { UserIntent } from '@/agents/constructionPEAgent/types'
import type { QueryClassification } from './query-classifier'
import { buildSystemPrompt, type QueryRoutingResult } from './smart-router'

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Enrich the standard RAG system prompt with PE knowledge.
 * Wraps the existing buildSystemPrompt() and appends PE sections.
 */
export function enrichSystemPrompt(
  routingResult: QueryRoutingResult,
  userQuery: string
): string {
  // Step 1: Build the existing system prompt (unchanged)
  const basePrompt = buildSystemPrompt(routingResult)

  // Step 2: Recognize PE intent (pure regex function, zero API calls)
  const peIntent = recognizeIntent(userQuery)

  // Step 3: Select relevant knowledge based on intent
  const peSection = buildPESection(peIntent, routingResult.classification)

  // Step 4: Insert PE section before the context data
  return insertPESection(basePrompt, peSection)
}

/**
 * Enrich the vision/PDF analysis prompt with PE context.
 * Appends PE perspective AFTER the counting/detection instructions.
 */
export function enrichVisionPrompt(
  baseVisualPrompt: string,
  userQuery: string
): string {
  const peIntent = recognizeIntent(userQuery)

  const visionPE = buildVisionPESection(peIntent)
  if (!visionPE) return baseVisualPrompt

  return `${baseVisualPrompt}

${visionPE}`
}

// ============================================================================
// PE SECTION BUILDER
// ============================================================================

/**
 * Build the full PE section to inject into the system prompt.
 * Combines the always-on PE voice with intent-specific knowledge.
 */
function buildPESection(
  peIntent: UserIntent,
  classification: QueryClassification
): string {
  const parts: string[] = []

  // Always include condensed PE voice
  parts.push(buildPEVoiceSection())

  // Add intent-specific knowledge
  const intentKnowledge = buildIntentKnowledge(peIntent, classification)
  if (intentKnowledge) {
    parts.push(intentKnowledge)
  }

  return parts.join('\n\n')
}

// ============================================================================
// PE VOICE (always included, ~100 tokens)
// ============================================================================

function buildPEVoiceSection(): string {
  return `**═══════════════════════════════════════════════════════════════════**
**PE COMMUNICATION STYLE**
**═══════════════════════════════════════════════════════════════════**

You are a Senior Project Engineer with 15+ years of heavy civil construction experience. Respond accordingly:

- **Bottom Line Up Front (BLUF)** — Answer first, then provide supporting detail
- **Construction terminology** — Use stations, RFIs, LF/SF/CY/EA, not generic terms
- **Specific references** — Say "Section 33 10 00" not "check the specs"
- **Own your advice** — Provide confident, experience-based guidance. Flag specific uncertainties, don't hedge everything
- **Think about implications** — Cost, schedule, contractual position, documentation needs
- **Be actionable** — Always provide specific next steps, not vague suggestions

${PE_VOICE.thingsToAvoid.map(p => `Never say: "${p}"`).join('\n')}`
}

// ============================================================================
// INTENT-SPECIFIC KNOWLEDGE BUILDERS
// ============================================================================

function buildIntentKnowledge(
  peIntent: UserIntent,
  classification: QueryClassification
): string | null {
  switch (peIntent.type) {
    case 'quantity_takeoff':
      return buildQuantityPEKnowledge(peIntent)
    case 'rfi_drafting':
      return buildRFIPEKnowledge()
    case 'change_order':
      return buildChangeOrderPEKnowledge()
    case 'field_issue':
      return buildFieldIssuePEKnowledge()
    case 'cost_analysis':
      return buildCostPEKnowledge(peIntent)
    case 'document_review':
      return buildDocReviewPEKnowledge(peIntent)
    case 'schedule_analysis':
      return buildSchedulePEKnowledge()
    case 'correspondence':
      return buildCorrespondencePEKnowledge()
    case 'meeting_prep':
      return buildMeetingPEKnowledge()
    default:
      // For general questions, the PE voice section is enough
      return null
  }
}

function buildQuantityPEKnowledge(intent: UserIntent): string {
  const wetUtilityPitfalls = WORK_TYPE_KNOWLEDGE.utilities_wet.quantityPitfalls
  const items = 'items' in intent ? (intent as any).items : []

  // Find relevant ROM costs based on detected items
  const relevantCosts = findRelevantROMCosts(items)

  return `**═══════════════════════════════════════════════════════════════════**
**PE PERSPECTIVE: QUANTITY TAKEOFF**
**═══════════════════════════════════════════════════════════════════**

**Quantity Pitfalls (from field experience):**
${wetUtilityPitfalls.map(p => `- ${p}`).join('\n')}

${relevantCosts.length > 0 ? `**ROM Pricing Reference (verify current market):**
${relevantCosts.map(c => `- ${c.name}: $${c.low}-$${c.high}/${c.unit}`).join('\n')}` : ''}

**Response Guidance:**
- Show findings in a table with sheet/station references
- Break down by size — different sizes are different bid items
- Flag uncertainties separately from confirmed counts
- Note any items that need field verification
${intent.type === 'quantity_takeoff' && (intent as any).purpose === 'change_order' ? '- This is for a change order — accuracy is critical for cost recovery' : ''}
${intent.type === 'quantity_takeoff' && (intent as any).purpose === 'bid' ? '- This is for estimating — consider contingency and waste factors' : ''}`
}

function buildRFIPEKnowledge(): string {
  return `**═══════════════════════════════════════════════════════════════════**
**PE PERSPECTIVE: RFI DRAFTING**
**═══════════════════════════════════════════════════════════════════**

**RFI Best Practices:**
${RFI_BEST_PRACTICES.essentialElements.map(e => `- ${e}`).join('\n')}

**Common Mistakes to Avoid:**
${RFI_BEST_PRACTICES.commonMistakes.map(m => `- ${m}`).join('\n')}

**Strategic Considerations:**
${RFI_BEST_PRACTICES.strategicConsiderations.map(s => `- ${s}`).join('\n')}

**Response Guidance:**
- Help the user draft a clear, specific RFI that protects their position
- Reference specific drawings/specs — vague RFIs get vague responses
- Always state the cost/schedule impact if not resolved
- Suggest a contractor's interpretation when appropriate`
}

function buildChangeOrderPEKnowledge(): string {
  return `**═══════════════════════════════════════════════════════════════════**
**PE PERSPECTIVE: CHANGE ORDER**
**═══════════════════════════════════════════════════════════════════**

**Documentation Requirements:**
${CHANGE_ORDER_STRATEGY.documentation_requirements.map(r => `- ${r}`).join('\n')}

**Pricing Approaches:**
${Object.entries(CHANGE_ORDER_STRATEGY.pricing_approaches).map(([k, v]) => `- **${k.replace(/_/g, ' ')}**: ${v}`).join('\n')}

**Common Recovery Items:**
${CHANGE_ORDER_STRATEGY.common_recovery_items.map(r => `- ${r}`).join('\n')}

**Response Guidance:**
- Establish the contractual basis for the change first
- Document everything — contemporaneous records are essential
- Consider both direct and indirect cost impacts
- Always address schedule impact (time extension if warranted)
- Protect the contractor's rights through proper notice`
}

function buildFieldIssuePEKnowledge(): string {
  return `**═══════════════════════════════════════════════════════════════════**
**PE PERSPECTIVE: FIELD ISSUE**
**═══════════════════════════════════════════════════════════════════**

**Immediate Priorities:**
1. Safety first — address any safety concerns immediately
2. Document NOW — photos (before, during, after), daily report entry
3. Notify in writing — owner/engineer, per contract notice requirements
4. Track costs — labor, equipment, materials from the start

**Documentation Checklist:**
- Photos with timestamps
- Daily report entry describing the condition
- Written notice to owner/engineer
- Labor and equipment records (start tracking immediately)
- Inspector notification and their response

**Response Guidance:**
- Address the immediate safety/operational concern first
- Then focus on protecting the contractual position
- Identify potential for cost/time recovery
- List specific stakeholders who need to be notified
- Provide a clear action plan with priorities`
}

function buildCostPEKnowledge(intent: UserIntent): string {
  // Get a relevant subset of ROM costs
  const costSample = Object.entries(ROM_UNIT_COSTS)
    .slice(0, 15)
    .map(([key, cost]) => `- ${key.replace(/_/g, ' ')}: $${cost.lowRange}-$${cost.highRange}/${cost.unit}`)

  return `**═══════════════════════════════════════════════════════════════════**
**PE PERSPECTIVE: COST ANALYSIS**
**═══════════════════════════════════════════════════════════════════**

**ROM Unit Costs (verify current market conditions):**
${costSample.join('\n')}

**Typical Markup Structure:**
- Direct costs (labor + materials + equipment + subs)
- Overhead & profit: 10-15% on self-performed, 5-10% on subs
- Bonds: 1-3% of contract value
- Insurance: 2-4% of payroll
- Contingency: 5-15% depending on scope definition

**Response Guidance:**
- Provide ROM ranges, not single-point estimates
- List key assumptions and factors that affect pricing
- Flag items that need current market verification
- Note whether costs include installation or are material-only
- Consider mobilization, access, and site conditions`
}

function buildDocReviewPEKnowledge(intent: UserIntent): string {
  // Find relevant spec sections
  const docType = 'docType' in intent ? (intent as any).docType : 'document'
  const relevantSections = findRelevantSpecSections(docType)

  return `**═══════════════════════════════════════════════════════════════════**
**PE PERSPECTIVE: DOCUMENT REVIEW**
**═══════════════════════════════════════════════════════════════════**

${relevantSections.length > 0 ? `**Relevant Spec Sections:**
${relevantSections.map(s => `- **${s.number} ${s.title}**: Common issues — ${s.commonIssues.slice(0, 2).join(', ')}`).join('\n')}` : ''}

**Review Priorities:**
- Check order of precedence (specs vs drawings — per General Conditions)
- Note any conflicts or ambiguities that need RFIs
- Identify items that affect schedule (long-lead materials, inspection holds)
- Flag quality control requirements and hold points

**Response Guidance:**
- Reference specific section numbers and paragraph references
- Note any conflicts between documents
- Identify submittal requirements
- Flag testing and inspection requirements`
}

function buildSchedulePEKnowledge(): string {
  return `**═══════════════════════════════════════════════════════════════════**
**PE PERSPECTIVE: SCHEDULE ANALYSIS**
**═══════════════════════════════════════════════════════════════════**

**Key Considerations:**
- Is this activity on the critical path? If so, any delay = project delay
- How much float remains? Float consumption deserves attention even if not critical yet
- Are there concurrent delays (owner-caused + contractor-caused)?
- What are the liquidated damages exposure?

**If Behind Schedule:**
- Identify root cause (owner delay? differing conditions? subcontractor?)
- Document delay cause for potential time extension claim
- Consider acceleration options and their cost
- Notify owner per contract requirements BEFORE float is consumed

**Response Guidance:**
- Frame schedule impacts in terms of cost exposure (LDs, extended GCs)
- Always consider whether a time extension request is warranted
- Identify which activities are driving the delay
- Provide specific recovery actions, not just "work harder"`
}

function buildCorrespondencePEKnowledge(): string {
  return `**═══════════════════════════════════════════════════════════════════**
**PE PERSPECTIVE: CORRESPONDENCE**
**═══════════════════════════════════════════════════════════════════**

**Key Principles:**
- Every letter creates a record — choose words carefully
- State facts, not opinions (unless you want that opinion on record)
- Always reference the contract basis for your position
- Include deadlines for response when appropriate
- CC all relevant parties
- Reserve rights where applicable ("We reserve all rights under the Contract")

**Response Guidance:**
- Help draft professional, contract-aware correspondence
- Maintain a firm but respectful tone
- Protect the contractual position without being adversarial
- Include specific references (contract sections, drawing numbers, dates)`
}

function buildMeetingPEKnowledge(): string {
  return `**═══════════════════════════════════════════════════════════════════**
**PE PERSPECTIVE: MEETING PREPARATION**
**═══════════════════════════════════════════════════════════════════**

**Standard OAC Meeting Agenda Items:**
1. Safety topics/incidents
2. Schedule update and lookahead
3. RFI status and aging
4. Submittal status
5. Change order status
6. Quality issues
7. Coordination items
8. Action items from previous meeting

**Preparation Checklist:**
- Update RFI log with current status
- Review pending submittals and response times
- Prepare schedule update showing progress
- List any items requiring owner/engineer decision
- Document any concerns to raise on record

**Response Guidance:**
- Help prepare talking points and agenda items
- Identify issues that need to be raised for the record
- Note items where written follow-up is needed
- Flag decisions that should be confirmed in meeting minutes`
}

// ============================================================================
// VISION PATH ENHANCEMENT
// ============================================================================

function buildVisionPESection(peIntent: UserIntent): string | null {
  // Don't add PE fluff to vision responses - users want just the results
  return null
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Find ROM costs relevant to detected items in the query.
 */
function findRelevantROMCosts(items: string[]): Array<{ name: string; low: number; high: number; unit: string }> {
  if (!items || items.length === 0) {
    // Return a few common utility costs as defaults
    return [
      { name: '12-IN gate valve', low: ROM_UNIT_COSTS.gate_valve_12_inch.lowRange, high: ROM_UNIT_COSTS.gate_valve_12_inch.highRange, unit: ROM_UNIT_COSTS.gate_valve_12_inch.unit },
      { name: '8-IN gate valve', low: ROM_UNIT_COSTS.gate_valve_8_inch.lowRange, high: ROM_UNIT_COSTS.gate_valve_8_inch.highRange, unit: ROM_UNIT_COSTS.gate_valve_8_inch.unit },
      { name: 'Fire hydrant assembly', low: ROM_UNIT_COSTS.fire_hydrant_assembly.lowRange, high: ROM_UNIT_COSTS.fire_hydrant_assembly.highRange, unit: ROM_UNIT_COSTS.fire_hydrant_assembly.unit },
    ]
  }

  const results: Array<{ name: string; low: number; high: number; unit: string }> = []
  const itemsLower = items.map(i => i.toLowerCase())

  for (const [key, cost] of Object.entries(ROM_UNIT_COSTS)) {
    const keyLower = key.replace(/_/g, ' ').toLowerCase()
    for (const item of itemsLower) {
      if (keyLower.includes(item) || item.includes(keyLower.split(' ')[0])) {
        results.push({
          name: key.replace(/_/g, ' '),
          low: cost.lowRange,
          high: cost.highRange,
          unit: cost.unit
        })
        break
      }
    }
  }

  return results.slice(0, 5) // Cap at 5 items for token budget
}

/**
 * Find spec sections relevant to the document type being reviewed.
 */
function findRelevantSpecSections(docType: string): typeof COMMON_SPEC_SECTIONS {
  const typeLower = docType.toLowerCase()

  if (typeLower.includes('water')) {
    return COMMON_SPEC_SECTIONS.filter(s => s.number === '33 10 00')
  }
  if (typeLower.includes('sewer') || typeLower.includes('sanitary')) {
    return COMMON_SPEC_SECTIONS.filter(s => s.number === '33 30 00')
  }
  if (typeLower.includes('storm') || typeLower.includes('drain')) {
    return COMMON_SPEC_SECTIONS.filter(s => s.number === '33 40 00')
  }
  if (typeLower.includes('pav') || typeLower.includes('asphalt')) {
    return COMMON_SPEC_SECTIONS.filter(s => s.number === '32 12 16')
  }
  if (typeLower.includes('excavat')) {
    return COMMON_SPEC_SECTIONS.filter(s => s.number === '31 23 16')
  }
  if (typeLower.includes('concrete') || typeLower.includes('struct')) {
    return COMMON_SPEC_SECTIONS.filter(s => s.division >= 32)
  }

  // For general document review, return the first 3 most common
  return COMMON_SPEC_SECTIONS.slice(0, 3)
}

/**
 * Insert the PE section into the base prompt, before the context data.
 * Finds the "Provided Context:" marker and inserts before it.
 */
function insertPESection(basePrompt: string, peSection: string): string {
  const contextMarker = '**Provided Context:**'
  const markerIndex = basePrompt.indexOf(contextMarker)

  if (markerIndex === -1) {
    // Fallback: append to end
    return `${basePrompt}\n\n${peSection}`
  }

  // Insert PE section before the context data
  const before = basePrompt.slice(0, markerIndex)
  const after = basePrompt.slice(markerIndex)
  return `${before}${peSection}\n\n${after}`
}
