/**
 * Construction Project Engineer Agent
 * 
 * This is the main agent that orchestrates all the knowledge, reasoning,
 * and communication capabilities to respond like a top-tier PE.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';

import type {
  ProjectContext,
  ConversationContext,
  UserIntent,
  PEReasoning,
  PEResponse,
  ActionItem,
  CommunicationType,
  CommunicationDraft
} from './types';

import {
  CONTRACT_MINDSET,
  OWNER_COMMUNICATION_STYLE,
  WORK_TYPE_KNOWLEDGE,
  COMMON_SPEC_SECTIONS,
  ROM_UNIT_COSTS,
  RFI_BEST_PRACTICES,
  CHANGE_ORDER_STRATEGY
} from './domainKnowledge';

import {
  recognizeIntent,
  reasonLikePE,
  PE_VOICE,
  getPhaseSpecificGuidance
} from './peReasoning';

// ============================================================================
// AGENT CONFIGURATION
// ============================================================================

export interface PEAgentConfig {
  apiKey: string;
  conversationModel?: string;
  visionModel?: string;
  projectContext?: Partial<ProjectContext>;
  debug?: boolean;
}

// ============================================================================
// THE MASTER SYSTEM PROMPT
// ============================================================================

function buildSystemPrompt(projectContext?: Partial<ProjectContext>): string {
  const contextSection = projectContext ? buildContextSection(projectContext) : '';
  
  return `You are a Senior Project Engineer (PE) with 15+ years of experience in heavy civil construction. You've worked on hundreds of projects ranging from $5M utility installations to $500M highway programs. You've seen it all - the good, the bad, and the ugly - and you've learned from all of it.

## YOUR IDENTITY

You are not an AI assistant helping with construction questions. You ARE a construction professional who happens to be communicating through this interface. You have opinions, you have experience, and you own your advice.

**Your Background:**
- PE licensed in multiple states
- Started as a field engineer, worked your way up
- Experience across municipal, DOT, federal, and private work
- Deep expertise in utilities (water, sewer, storm), earthwork, and roadwork
- You've managed projects from bid through closeout and warranty
- You've testified as an expert witness on construction disputes
- You've trained dozens of young engineers

**Your Personality:**
- Direct but not abrasive
- You respect everyone on the jobsite from laborers to owners
- You document EVERYTHING - you've been burned before
- You're solution-oriented - problems are just puzzles to solve
- You protect your company while maintaining integrity
- You know when to fight and when to fold
- You've made mistakes and learned from them

## HOW YOU THINK

When presented with any construction question or situation, you automatically think through:

1. **What's the REAL question here?** (Users often don't ask what they really need)
2. **What does the contract say?** (Everything flows from the contract)
3. **What are the cost implications?** (Money matters on every decision)
4. **What are the schedule implications?** (Time is money in construction)
5. **What documentation do we need?** (If it isn't documented, it didn't happen)
6. **Who needs to be involved?** (Construction is a team sport)
7. **What's the recommended path forward?** (Always provide actionable guidance)

## HOW YOU COMMUNICATE

**Bottom Line Up Front (BLUF):** Start with the answer, then provide supporting detail.

**Be Specific:** 
- Don't say "check the specs" - say "Section 33 10 00 typically covers this..."
- Don't say "it depends" without explaining WHAT it depends on
- Provide numbers when possible, even rough order of magnitude

**Use Construction Language:**
- Stations, not "distance markers"
- RFIs, PCOs, CCDs - not "change requests"  
- LF, SF, CY, EA - standard units
- "Installed in place" vs "furnished only"
- "Owner" and "Contractor" - not "client" and "company"

**Sound Like a PE:**
${PE_VOICE.commonPhrases.map(p => `- "${p}"`).join('\n')}

**Never Sound Like This:**
${PE_VOICE.thingsToAvoid.map(p => `- "${p}"`).join('\n')}

## YOUR KNOWLEDGE BASE

You have deep familiarity with:

**Standards and Codes:**
- CSI MasterFormat (Divisions 01-48)
- ASTM standards for materials testing
- AASHTO specifications for DOT work
- ACI for concrete
- AWWA for water infrastructure
- Local municipal standard specifications

**Contract Types and Their Implications:**
${Object.entries(CONTRACT_MINDSET).map(([type, mindset]) => 
  `- ${type.toUpperCase()}: ${mindset.primaryFocus}`
).join('\n')}

**Work Type Expertise:**
${Object.entries(WORK_TYPE_KNOWLEDGE).map(([type, knowledge]) =>
  `- ${type.replace('_', ' ').toUpperCase()}: Critical factors include ${knowledge.criticalSuccessFactors.slice(0, 2).join(', ')}`
).join('\n')}

**ROM Unit Costs (verify current market):**
${Object.entries(ROM_UNIT_COSTS).slice(0, 10).map(([item, cost]) =>
  `- ${item.replace(/_/g, ' ')}: $${cost.lowRange}-${cost.highRange}/${cost.unit}`
).join('\n')}

## OWNER COMMUNICATION AWARENESS

You adapt your communication style based on owner type:

${Object.entries(OWNER_COMMUNICATION_STYLE).map(([type, style]) =>
  `**${type.replace(/_/g, ' ').toUpperCase()}:** ${style.tone}`
).join('\n\n')}

${contextSection}

## DOCUMENT ANALYSIS CAPABILITIES

When analyzing construction drawings or documents, you:

1. **Identify the sheet type first** - Title, Index, Plan, Profile, Detail, Legend
2. **Look for termination points** - BEGIN/END labels are critical for lengths
3. **Extract quantities systematically** - Profile views are the source of truth
4. **Note utility crossings** - Mark stations, elevations, utility types
5. **Flag ambiguities** - If something is unclear, note it
6. **Cross-reference** - Connect details to plan sheets to specs

**Critical Extraction Points for Water/Sewer Plans:**
- Station ranges (BEGIN STA XX+XX to END STA XX+XX)
- Pipe sizes and materials
- Valve locations and sizes
- Fitting counts (tees, bends, reducers)
- Manhole locations and depths
- Service connection counts
- Existing utility crossings

## RESPONSE STRUCTURE

For most questions, structure your response as:

1. **Direct Answer** - BLUF, answer the actual question
2. **Key Considerations** - What the user should be thinking about
3. **Recommended Actions** - Specific next steps
4. **Documentation Needed** - What to create/track
5. **Watch Out For** - Risks or gotchas

For technical questions, include:
- Relevant spec section references
- Typical requirements or ranges
- Common issues to avoid
- Quality control points

For cost/pricing questions, include:
- ROM pricing if you have it
- Factors that affect pricing
- What to include/exclude
- Markup considerations

For change order or claims discussions, include:
- Contract basis for the position
- Documentation requirements
- Timeline considerations
- Negotiation strategy

## IMPORTANT REMINDERS

- **You own your advice.** Don't hedge excessively. If you're uncertain, say so specifically, but still provide your best guidance.
- **Context matters.** Always try to understand the full picture before advising.
- **Document everything.** Constantly remind users about documentation.
- **Protect the position.** Think about how decisions affect contractual position.
- **Schedule is king.** Time implications matter on almost every decision.
- **Money talks.** Frame things in terms of cost impact when relevant.
- **Relationships matter.** Technically correct but relationship-destroying advice is bad advice.

You are the PE they call when something goes wrong at 10 PM on a Friday. Act like it.`;
}

function buildContextSection(context: Partial<ProjectContext>): string {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }

  let section = '\n## CURRENT PROJECT CONTEXT\n\n';

  if (context.projectName) {
    section += `**Project:** ${context.projectName}`;
    if (context.projectNumber) section += ` (${context.projectNumber})`;
    section += '\n';
  }

  if (context.location) {
    const loc = context.location;
    section += `**Location:** ${[loc.city, loc.county, loc.state].filter(Boolean).join(', ')}`;
    if (loc.jurisdiction) section += ` | Jurisdiction: ${loc.jurisdiction}`;
    section += '\n';
  }

  if (context.contract) {
    const c = context.contract;
    section += `\n**Contract:**\n`;
    section += `- Type: ${c.type?.toUpperCase()}\n`;
    section += `- Delivery: ${c.deliveryMethod?.replace(/_/g, ' ')}\n`;
    if (c.originalValue) section += `- Original Value: $${c.originalValue.toLocaleString()}\n`;
    if (c.currentValue && c.currentValue !== c.originalValue) {
      section += `- Current Value: $${c.currentValue.toLocaleString()}\n`;
    }
    if (c.percentComplete !== undefined) section += `- Percent Complete: ${c.percentComplete}%\n`;
    if (c.liquidatedDamages) section += `- LDs: $${c.liquidatedDamages.toLocaleString()}/day\n`;
    
    const mindset = CONTRACT_MINDSET[c.type as keyof typeof CONTRACT_MINDSET];
    if (mindset) {
      section += `\n**Contract Mindset:** ${mindset.primaryFocus}\n`;
    }
  }

  if (context.schedule) {
    const s = context.schedule;
    section += `\n**Schedule:**\n`;
    section += `- Phase: ${s.phase?.replace(/_/g, ' ').toUpperCase()}\n`;
    if (s.daysRemaining !== undefined) section += `- Days Remaining: ${s.daysRemaining}\n`;
    if (s.floatRemaining !== undefined) section += `- Float Remaining: ${s.floatRemaining} days\n`;
    if (s.criticalActivities?.length) {
      section += `- Critical Activities: ${s.criticalActivities.join(', ')}\n`;
    }
    
    if (s.phase) {
      const phaseGuidance = getPhaseSpecificGuidance(s.phase);
      section += `\n**Phase Priorities:**\n`;
      phaseGuidance.priorities.slice(0, 3).forEach(p => {
        section += `- ${p}\n`;
      });
    }
  }

  if (context.owner) {
    const o = context.owner;
    section += `\n**Owner:**\n`;
    section += `- Type: ${o.type?.replace(/_/g, ' ').toUpperCase()}\n`;
    if (o.relationshipHealth) section += `- Relationship: ${o.relationshipHealth}\n`;
    if (o.inspectorName) section += `- Inspector: ${o.inspectorName}\n`;
    
    const style = OWNER_COMMUNICATION_STYLE[o.type as keyof typeof OWNER_COMMUNICATION_STYLE];
    if (style) {
      section += `\n**Communication Approach:** ${style.tone}\n`;
    }
  }

  if (context.workTypes?.length) {
    section += `\n**Work Types:** ${context.workTypes.map(w => w.replace(/_/g, ' ')).join(', ')}\n`;
  }

  if (context.documents) {
    const d = context.documents;
    section += `\n**Open Items:**\n`;
    if (d.pendingRFIs) section += `- Pending RFIs: ${d.pendingRFIs}\n`;
    if (d.pendingSubmittals) section += `- Pending Submittals: ${d.pendingSubmittals}\n`;
    if (d.pendingChangeOrders) section += `- Pending COs: ${d.pendingChangeOrders}\n`;
  }

  if (context.activeRisks?.length) {
    section += `\n**Active Risks:**\n`;
    context.activeRisks.slice(0, 5).forEach(risk => {
      section += `- [${risk.likelihood.toUpperCase()}/${risk.impact.toUpperCase()}] ${risk.description}\n`;
    });
  }

  return section;
}

// ============================================================================
// MAIN AGENT CLASS
// ============================================================================

export class ConstructionPEAgent {
  private client: Anthropic;
  private config: PEAgentConfig;
  private conversationHistory: MessageParam[] = [];
  private projectContext: Partial<ProjectContext>;
  private actionItems: ActionItem[] = [];

  constructor(config: PEAgentConfig) {
    this.config = {
      conversationModel: 'claude-sonnet-4-5-20250929',
      visionModel: 'claude-haiku-4-5-20251001',
      debug: false,
      ...config
    };
    
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.projectContext = config.projectContext || {};
    
    if (this.config.debug) {
      console.log('[PE Agent] Initialized with config:', {
        conversationModel: this.config.conversationModel,
        visionModel: this.config.visionModel,
        hasProjectContext: !!config.projectContext
      });
    }
  }

  // ==========================================================================
  // CORE CONVERSATION METHOD
  // ==========================================================================

  async chat(userMessage: string, options?: {
    images?: Array<{ data: string; mediaType: 'image/png' | 'image/jpeg' }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{
    response: string;
    reasoning?: PEReasoning;
    intent?: UserIntent;
    actionItems?: ActionItem[];
    tokensUsed?: { input: number; output: number };
  }> {
    const startTime = Date.now();
    
    // Step 1: Recognize intent
    const intent = recognizeIntent(userMessage, { recentTopics: this.getRecentTopics() });
    
    if (this.config.debug) {
      console.log('[PE Agent] Recognized intent:', intent);
    }

    // Step 2: Generate PE reasoning
    const reasoning = reasonLikePE(intent, this.projectContext, {
      intent,
      relevantContext: this.projectContext,
      documentsInScope: [],
      recentTopics: this.getRecentTopics(),
      actionItems: this.actionItems
    });

    if (this.config.debug) {
      console.log('[PE Agent] Reasoning:', reasoning);
    }

    // Step 3: Build the message content
    const content: Array<any> = [];
    
    if (options?.images) {
      for (const img of options.images) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType,
            data: img.data
          }
        });
      }
    }
    
    const enhancedMessage = this.enhanceMessageWithReasoning(userMessage, intent, reasoning);
    content.push({ type: 'text', text: enhancedMessage });

    // Step 4: Add to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: content.length === 1 ? userMessage : content
    });

    // Step 5: Call Claude
    try {
      const response = await this.client.messages.create({
        model: this.config.conversationModel!,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        system: buildSystemPrompt(this.projectContext),
        messages: this.conversationHistory
      });

      const assistantMessage = response.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      this.conversationHistory.push({
        role: 'assistant',
        content: assistantMessage
      });

      const newActionItems = this.extractActionItems(assistantMessage);
      this.actionItems.push(...newActionItems);

      if (this.config.debug) {
        console.log(`[PE Agent] Response generated in ${Date.now() - startTime}ms`);
        console.log(`[PE Agent] Tokens: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`);
      }

      return {
        response: assistantMessage,
        reasoning,
        intent,
        actionItems: newActionItems.length > 0 ? newActionItems : undefined,
        tokensUsed: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens
        }
      };

    } catch (error) {
      console.error('[PE Agent] Error:', error);
      throw error;
    }
  }

  // ==========================================================================
  // SPECIALIZED METHODS
  // ==========================================================================

  async analyzeDrawing(
    imageBuffer: Buffer,
    options?: {
      sheetType?: 'title' | 'summary' | 'plan' | 'profile' | 'detail' | 'legend' | 'unknown';
      sheetNumber?: string;
      focusAreas?: string[];
      question?: string;
    }
  ): Promise<{
    analysis: string;
    extractedData: any;
    recommendations: string[];
  }> {
    const base64Image = imageBuffer.toString('base64');
    const mediaType = imageBuffer.toString('hex', 0, 4).startsWith('89504e47')
      ? 'image/png'
      : 'image/jpeg';

    let prompt = `Analyze this construction drawing as a senior PE would.`;
    
    if (options?.sheetType) {
      prompt += ` This appears to be a ${options.sheetType} sheet.`;
    }
    if (options?.sheetNumber) {
      prompt += ` Sheet number: ${options.sheetNumber}.`;
    }
    if (options?.focusAreas?.length) {
      prompt += ` Focus particularly on: ${options.focusAreas.join(', ')}.`;
    }
    if (options?.question) {
      prompt += `\n\nSpecific question: ${options.question}`;
    }

    prompt += `\n\nProvide:
1. Sheet identification and purpose
2. Key information extracted (quantities, stations, components)
3. Any issues or concerns you notice
4. Recommendations for the field team`;

    const response = await this.client.messages.create({
      model: this.config.visionModel!,
      max_tokens: 4096,
      temperature: 0.1,
      system: buildSystemPrompt(this.projectContext),
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image
            }
          },
          { type: 'text', text: prompt }
        ]
      }]
    });

    const analysisText = response.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return {
      analysis: analysisText,
      extractedData: {},
      recommendations: this.extractRecommendations(analysisText)
    };
  }

  async draftRFI(params: {
    issue: string;
    drawingRefs?: string[];
    specRefs?: string[];
    location?: string;
    urgency?: 'routine' | 'urgent' | 'critical';
    suggestedResolution?: string;
  }): Promise<CommunicationDraft> {
    const prompt = `Draft an RFI for the following issue:

**Issue:** ${params.issue}

${params.drawingRefs?.length ? `**Drawing References:** ${params.drawingRefs.join(', ')}` : ''}
${params.specRefs?.length ? `**Spec References:** ${params.specRefs.join(', ')}` : ''}
${params.location ? `**Location:** ${params.location}` : ''}
${params.urgency ? `**Urgency:** ${params.urgency.toUpperCase()}` : ''}
${params.suggestedResolution ? `**Contractor's Suggested Resolution:** ${params.suggestedResolution}` : ''}

Draft a professional RFI that:
1. Clearly states the issue/question
2. References specific documents
3. Explains why clarification is needed
4. States the impact if not resolved
5. Requests specific information needed
6. Preserves our contractual position

Format the RFI body only - I'll add the header/footer.`;

    const response = await this.chat(prompt);

    return {
      type: 'rfi',
      subject: `RFI: ${params.issue.slice(0, 50)}...`,
      to: ['Engineer of Record'],
      cc: ['Owner\'s Representative', 'Project File'],
      body: response.response,
      contractReferences: [...(params.specRefs || []), ...(params.drawingRefs || [])],
      urgency: params.urgency || 'routine',
      preservesRights: true
    };
  }

  async draftChangeOrder(params: {
    description: string;
    cause: 'owner_directive' | 'design_change' | 'differing_conditions' | 'spec_conflict' | 'other';
    estimatedCost?: number;
    scheduleImpact?: number;
    laborHours?: number;
    equipmentHours?: number;
    materials?: Array<{ item: string; quantity: number; unit: string; unitCost?: number }>;
  }): Promise<CommunicationDraft> {
    const prompt = `Draft a Potential Change Order (PCO) request:

**Description:** ${params.description}

**Cause:** ${params.cause.replace(/_/g, ' ').toUpperCase()}

${params.estimatedCost ? `**Estimated Cost:** $${params.estimatedCost.toLocaleString()}` : ''}
${params.scheduleImpact ? `**Schedule Impact:** ${params.scheduleImpact} days` : ''}
${params.laborHours ? `**Labor Hours:** ${params.laborHours}` : ''}
${params.equipmentHours ? `**Equipment Hours:** ${params.equipmentHours}` : ''}
${params.materials?.length ? `**Materials:**\n${params.materials.map(m => `- ${m.item}: ${m.quantity} ${m.unit}${m.unitCost ? ` @ $${m.unitCost}` : ''}`).join('\n')}` : ''}

Draft a professional PCO that:
1. Clearly describes the changed work
2. Establishes the contractual basis for the change
3. Details the cost components
4. Documents schedule impact if any
5. Preserves our rights
6. Maintains professional tone

Include what backup documentation should be attached.`;

    const response = await this.chat(prompt);

    return {
      type: 'change_order_request',
      subject: `PCO: ${params.description.slice(0, 50)}...`,
      to: ['Owner\'s Representative'],
      cc: ['Project Manager', 'Project File'],
      body: response.response,
      urgency: 'time_sensitive',
      preservesRights: true
    };
  }

  async estimateCost(params: {
    workDescription: string;
    quantities?: Array<{ item: string; quantity: number; unit: string }>;
    conditions?: string[];
    includeMarkup?: boolean;
  }): Promise<{
    estimate: string;
    breakdown: any;
    assumptions: string[];
    factors: string[];
  }> {
    let prompt = `Provide a ROM cost estimate for:

**Work:** ${params.workDescription}

`;

    if (params.quantities?.length) {
      prompt += `**Quantities:**\n${params.quantities.map(q => `- ${q.item}: ${q.quantity} ${q.unit}`).join('\n')}\n\n`;
    }

    if (params.conditions?.length) {
      prompt += `**Conditions:** ${params.conditions.join(', ')}\n\n`;
    }

    prompt += `Provide:
1. ROM unit costs with ranges
2. Total estimated cost (low/mid/high)
3. Key assumptions
4. Factors that could significantly affect pricing
${params.includeMarkup ? '5. Typical markup structure (OH&P, bonds, insurance)' : ''}

Use your knowledge of current market rates. Flag anything that needs current market verification.`;

    const response = await this.chat(prompt);

    return {
      estimate: response.response,
      breakdown: {},
      assumptions: [],
      factors: []
    };
  }

  async analyzeFieldIssue(params: {
    issue: string;
    location?: string;
    discoveredBy?: string;
    affectedWork?: string[];
    photos?: Array<{ data: string; mediaType: 'image/png' | 'image/jpeg' }>;
  }): Promise<{
    analysis: string;
    immediateActions: string[];
    documentation: string[];
    potentialRecovery: string;
    stakeholders: string[];
  }> {
    let prompt = `Analyze this field issue as a senior PE:

**Issue:** ${params.issue}

${params.location ? `**Location:** ${params.location}` : ''}
${params.discoveredBy ? `**Discovered By:** ${params.discoveredBy}` : ''}
${params.affectedWork?.length ? `**Affected Work:** ${params.affectedWork.join(', ')}` : ''}

Provide:
1. Your assessment of the issue
2. Immediate actions required
3. Documentation needed RIGHT NOW
4. Potential for cost/time recovery
5. Who needs to be notified
6. How to protect our position`;

    const response = await this.chat(prompt, { images: params.photos });

    return {
      analysis: response.response,
      immediateActions: this.extractListItems(response.response, 'immediate'),
      documentation: this.extractListItems(response.response, 'document'),
      potentialRecovery: '',
      stakeholders: []
    };
  }

  // ==========================================================================
  // PROJECT CONTEXT MANAGEMENT
  // ==========================================================================

  updateProjectContext(updates: Partial<ProjectContext>): void {
    this.projectContext = {
      ...this.projectContext,
      ...updates
    };
    
    if (this.config.debug) {
      console.log('[PE Agent] Project context updated:', this.projectContext);
    }
  }

  setProjectContext(context: Partial<ProjectContext>): void {
    this.projectContext = context;
  }

  getProjectContext(): Partial<ProjectContext> {
    return { ...this.projectContext };
  }

  // ==========================================================================
  // CONVERSATION MANAGEMENT
  // ==========================================================================

  clearHistory(): void {
    this.conversationHistory = [];
    this.actionItems = [];
  }

  getHistory(): MessageParam[] {
    return [...this.conversationHistory];
  }

  getActionItems(): ActionItem[] {
    return [...this.actionItems];
  }

  addActionItem(item: Omit<ActionItem, 'id'>): void {
    this.actionItems.push({
      ...item,
      id: `AI-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    });
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  private getRecentTopics(): string[] {
    return this.conversationHistory
      .filter(m => m.role === 'user')
      .slice(-5)
      .map(m => {
        if (typeof m.content === 'string') return m.content.slice(0, 50);
        const textBlock = (m.content as any[]).find(b => b.type === 'text');
        return textBlock?.text?.slice(0, 50) || '';
      });
  }

  private enhanceMessageWithReasoning(
    message: string,
    intent: UserIntent,
    reasoning: PEReasoning
  ): string {
    if (intent.type === 'quantity_takeoff' && (intent as any).purpose) {
      return `${message}\n\n[Context: This is for ${(intent as any).purpose} purposes]`;
    }
    
    if (intent.type === 'change_order') {
      return `${message}\n\n[Context: Consider ${reasoning.contractualBasis.slice(0, 2).join(', ')}]`;
    }
    
    return message;
  }

  private extractActionItems(response: string): ActionItem[] {
    const items: ActionItem[] = [];
    
    const actionPatterns = [
      /(?:need to|should|must|recommend)\s+([^.!?]+)/gi,
      /action(?:\s+item)?:\s*([^.!?\n]+)/gi,
      /next step:\s*([^.!?\n]+)/gi
    ];
    
    for (const pattern of actionPatterns) {
      let match;
      while ((match = pattern.exec(response)) !== null) {
        const description = match[1].trim();
        if (description.length > 10 && description.length < 200) {
          items.push({
            id: `AI-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            description,
            owner: 'TBD',
            priority: 'medium',
            status: 'pending'
          });
        }
      }
    }
    
    return items.slice(0, 5);
  }

  private extractRecommendations(text: string): string[] {
    const recommendations: string[] = [];
    
    const patterns = [
      /recommend(?:ation)?s?:\s*([^.!?]+)/gi,
      /suggest(?:ion)?s?:\s*([^.!?]+)/gi,
      /(?:should|consider)\s+([^.!?]+)/gi
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        recommendations.push(match[1].trim());
      }
    }
    
    return [...new Set(recommendations)].slice(0, 10);
  }

  private extractListItems(text: string, keyword: string): string[] {
    const items: string[] = [];
    const lines = text.split('\n');
    
    let inSection = false;
    for (const line of lines) {
      if (line.toLowerCase().includes(keyword)) {
        inSection = true;
        continue;
      }
      if (inSection && line.match(/^[\s]*[-•*\d.]\s*/)) {
        items.push(line.replace(/^[\s]*[-•*\d.]\s*/, '').trim());
      }
      if (inSection && line.match(/^[A-Z#*]/) && !line.match(/^[\s]*[-•*\d]/)) {
        inSection = false;
      }
    }
    
    return items;
  }
}

// ==========================================================================
// FACTORY FUNCTION
// ==========================================================================

export function createPEAgent(config: PEAgentConfig): ConstructionPEAgent {
  return new ConstructionPEAgent(config);
}

// ==========================================================================
// RE-EXPORTS
// ==========================================================================

export type {
  ProjectContext,
  ConversationContext,
  UserIntent,
  PEReasoning,
  PEResponse,
  ActionItem,
  CommunicationType,
  CommunicationDraft
} from './types';

export {
  CONTRACT_MINDSET,
  OWNER_COMMUNICATION_STYLE,
  WORK_TYPE_KNOWLEDGE,
  COMMON_SPEC_SECTIONS,
  ROM_UNIT_COSTS,
  RFI_BEST_PRACTICES,
  CHANGE_ORDER_STRATEGY
} from './domainKnowledge';

export {
  recognizeIntent,
  reasonLikePE,
  PE_VOICE,
  getPhaseSpecificGuidance
} from './peReasoning';
