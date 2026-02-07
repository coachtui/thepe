/**
 * Construction PE Reasoning Engine
 * 
 * This module captures HOW a senior PE thinks through problems.
 * It's not just about what they know, but how they approach issues.
 */

import type {
  ProjectContext,
  ConversationContext,
  UserIntent,
  PEReasoning,
  PEResponse,
  DocumentReference,
  ContractType,
  ProjectPhase
} from './types';

import {
  CONTRACT_MINDSET,
  OWNER_COMMUNICATION_STYLE,
  WORK_TYPE_KNOWLEDGE,
  RFI_BEST_PRACTICES,
  CHANGE_ORDER_STRATEGY
} from './domainKnowledge';

// ============================================================================
// INTENT RECOGNITION
// ============================================================================

/**
 * Patterns a PE recognizes that signal specific intents
 */
const INTENT_PATTERNS: Array<{
  patterns: RegExp[];
  intent: UserIntent['type'];
  extractors?: (text: string) => Partial<UserIntent>;
}> = [
  {
    patterns: [
      /how much|how many|quantity|quantities|takeoff|take-off|count|total/i,
      /linear feet|LF|square feet|SF|cubic yards?|CY|tons?|gallons?|EA|each/i
    ],
    intent: 'quantity_takeoff'
  },
  {
    patterns: [
      /RFI|request for information|clarification|conflict|discrepancy|ambiguous/i,
      /drawing shows|spec says|but the|doesn't match|unclear|which one/i
    ],
    intent: 'rfi_drafting'
  },
  {
    patterns: [
      /change order|CO|PCO|CCD|extra work|additional work|added scope/i,
      /not in (the )?contract|not in (the )?bid|out of scope|owner (requested|directed)/i
    ],
    intent: 'change_order'
  },
  {
    patterns: [
      /schedule|delay|behind|critical path|float|duration|milestone/i,
      /when (will|can)|how long|time (to|for)|extension/i
    ],
    intent: 'schedule_analysis'
  },
  {
    patterns: [
      /cost|budget|expense|price|estimate|ROM|ballpark|how much will/i,
      /over budget|under budget|burn rate|forecast/i
    ],
    intent: 'cost_analysis'
  },
  {
    patterns: [
      /review|check|look at|analyze|what does.*say|spec section|drawing/i
    ],
    intent: 'document_review'
  },
  {
    patterns: [
      /field|site|crew|foreman|inspector|issue|problem|found|discovered/i,
      /won't work|doesn't fit|can't install|damaged|defective/i
    ],
    intent: 'field_issue'
  },
  {
    patterns: [
      /meeting|OAC|progress meeting|pre-con|kickoff|agenda|minutes/i
    ],
    intent: 'meeting_prep'
  },
  {
    patterns: [
      /letter|email|correspondence|write to|respond to|draft|send/i,
      /notice|claim|protest/i
    ],
    intent: 'correspondence'
  }
];

/**
 * Determine what the user is actually trying to accomplish
 */
export function recognizeIntent(userMessage: string, context?: Partial<ConversationContext>): UserIntent {
  const lowerMessage = userMessage.toLowerCase();
  
  for (const { patterns, intent } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(userMessage)) {
        // Found a match - extract additional details based on intent type
        return buildIntent(intent, userMessage, context);
      }
    }
  }
  
  // Default to general question
  return { type: 'general_question', topic: extractMainTopic(userMessage) };
}

function buildIntent(
  type: UserIntent['type'], 
  message: string, 
  context?: Partial<ConversationContext>
): UserIntent {
  switch (type) {
    case 'quantity_takeoff':
      return {
        type: 'quantity_takeoff',
        items: extractItemsToQuantify(message),
        purpose: detectQuantityPurpose(message)
      };
    
    case 'rfi_drafting':
      return {
        type: 'rfi_drafting',
        issue: message,
        urgency: detectUrgency(message)
      };
    
    case 'change_order':
      return {
        type: 'change_order',
        description: message,
        direction: detectChangeDirection(message)
      };
    
    case 'schedule_analysis':
      return {
        type: 'schedule_analysis',
        concern: message
      };
    
    case 'cost_analysis':
      return {
        type: 'cost_analysis',
        scope: message
      };
    
    case 'document_review':
      return {
        type: 'document_review',
        docType: detectDocumentType(message),
        purpose: extractMainTopic(message)
      };
    
    case 'field_issue':
      return {
        type: 'field_issue',
        problem: message
      };
    
    case 'meeting_prep':
      return {
        type: 'meeting_prep',
        meetingType: detectMeetingType(message)
      };
    
    case 'correspondence':
      return {
        type: 'correspondence',
        recipient: detectRecipient(message),
        topic: extractMainTopic(message)
      };
    
    default:
      return { type: 'general_question', topic: message };
  }
}

// Helper extraction functions
function extractItemsToQuantify(message: string): string[] {
  const items: string[] = [];
  const patterns = [
    /(?:water|sewer|storm|drain|gas|electric)\s*(?:line|main|pipe)/gi,
    /(?:gate|butterfly|check|air\s*release)\s*valve/gi,
    /(?:fire\s*)?hydrant/gi,
    /manhole|MH/gi,
    /(?:curb|gutter|sidewalk|pavement|asphalt|concrete)/gi,
    /fitting|tee|bend|cap|coupling|reducer/gi
  ];
  
  for (const pattern of patterns) {
    const matches = message.match(pattern);
    if (matches) {
      items.push(...matches);
    }
  }
  
  return [...new Set(items)]; // Deduplicate
}

function detectQuantityPurpose(message: string): 'bid' | 'change_order' | 'progress' | undefined {
  if (/bid|estimate|proposal/i.test(message)) return 'bid';
  if (/change|extra|additional|PCO|CO/i.test(message)) return 'change_order';
  if (/progress|pay|invoice|application/i.test(message)) return 'progress';
  return undefined;
}

function detectUrgency(message: string): 'routine' | 'urgent' | 'critical' {
  if (/critical|emergency|stop work|immediate|asap|today/i.test(message)) return 'critical';
  if (/urgent|soon|need.*quickly|time.sensitive/i.test(message)) return 'urgent';
  return 'routine';
}

function detectChangeDirection(message: string): 'ccd' | 'pco' | 'co' {
  if (/CCD|construction change directive|directed/i.test(message)) return 'ccd';
  if (/PCO|potential|proposed|requesting/i.test(message)) return 'pco';
  return 'co';
}

function detectDocumentType(message: string): string {
  if (/spec|specification/i.test(message)) return 'specification';
  if (/drawing|plan|sheet|detail/i.test(message)) return 'drawing';
  if (/schedule/i.test(message)) return 'schedule';
  if (/contract/i.test(message)) return 'contract';
  if (/submittal/i.test(message)) return 'submittal';
  return 'document';
}

function detectMeetingType(message: string): string {
  if (/OAC|owner.*architect|progress/i.test(message)) return 'OAC progress';
  if (/pre-?con|preconstruction/i.test(message)) return 'preconstruction';
  if (/kickoff|kick-off/i.test(message)) return 'kickoff';
  if (/safety/i.test(message)) return 'safety';
  if (/schedule/i.test(message)) return 'schedule';
  return 'general';
}

function detectRecipient(message: string): string {
  if (/owner|client/i.test(message)) return 'owner';
  if (/engineer|EOR|designer/i.test(message)) return 'engineer';
  if (/architect/i.test(message)) return 'architect';
  if (/inspector/i.test(message)) return 'inspector';
  if (/sub|subcontractor/i.test(message)) return 'subcontractor';
  return 'unknown';
}

function extractMainTopic(message: string): string {
  // Simple extraction - in practice would be more sophisticated
  return message.slice(0, 100);
}

// ============================================================================
// PE REASONING FRAMEWORK
// ============================================================================

/**
 * Core reasoning process - how a PE thinks through any issue
 */
export function reasonLikePE(
  intent: UserIntent,
  projectContext: Partial<ProjectContext>,
  conversationContext: Partial<ConversationContext>
): PEReasoning {
  
  // Step 1: What's the REAL question here?
  const underlyingConcern = identifyUnderlyingConcern(intent, projectContext);
  
  // Step 2: What does the contract say?
  const contractualBasis = identifyContractualBasis(intent, projectContext);
  
  // Step 3: What are the cost implications?
  const costConsiderations = analyzeCostImplications(intent, projectContext);
  
  // Step 4: What are the schedule implications?
  const scheduleConsiderations = analyzeScheduleImplications(intent, projectContext);
  
  // Step 5: What documentation do we need?
  const documentationRequired = identifyRequiredDocumentation(intent, projectContext);
  
  // Step 6: Who needs to be involved?
  const stakeholders = identifyStakeholders(intent, projectContext);
  
  // Step 7: What's the recommended approach?
  const recommendation = formulateRecommendation(
    intent,
    projectContext,
    underlyingConcern,
    contractualBasis,
    costConsiderations,
    scheduleConsiderations
  );
  
  return {
    underlyingConcern,
    contractualBasis,
    costConsiderations,
    scheduleConsiderations,
    documentationRequired,
    stakeholders,
    recommendation
  };
}

function identifyUnderlyingConcern(
  intent: UserIntent,
  context: Partial<ProjectContext>
): string {
  // A PE always asks "what's the REAL question here?"
  
  switch (intent.type) {
    case 'quantity_takeoff':
      if (intent.purpose === 'change_order') {
        return "Establishing accurate quantities to support change order pricing and prevent disputes";
      }
      if (intent.purpose === 'progress') {
        return "Documenting completed work to support progress payment application";
      }
      return "Understanding scope and quantities for planning, pricing, or tracking purposes";
    
    case 'rfi_drafting':
      return "Getting a written, binding interpretation from the engineer to eliminate ambiguity and protect our position";
    
    case 'change_order':
      return "Recovering costs for work outside the original contract scope while maintaining owner relationship";
    
    case 'schedule_analysis':
      return "Understanding schedule position, identifying risks, and developing recovery or claim positions";
    
    case 'field_issue':
      return "Resolving the immediate problem while protecting schedule and documenting for potential recovery";
    
    default:
      return "Understanding the issue to make informed decisions";
  }
}

function identifyContractualBasis(
  intent: UserIntent,
  context: Partial<ProjectContext>
): string[] {
  const references: string[] = [];
  
  // Always consider the general conditions
  references.push("General Conditions - Changes clause");
  references.push("General Conditions - Notice requirements");
  
  switch (intent.type) {
    case 'change_order':
      references.push("Contract Changes clause");
      references.push("Unit price schedule (if applicable)");
      references.push("Force account provisions");
      references.push("Time extension provisions");
      break;
    
    case 'rfi_drafting':
      references.push("RFI procedures in Division 01");
      references.push("Relevant technical specification section");
      references.push("Referenced drawing sheets");
      break;
    
    case 'schedule_analysis':
      references.push("Contract time provisions");
      references.push("Liquidated damages clause");
      references.push("Time extension procedures");
      references.push("Delay notification requirements");
      break;
    
    case 'field_issue':
      references.push("Differing site conditions clause");
      references.push("Relevant technical specification");
      references.push("Notice of changed conditions requirements");
      break;
  }
  
  return references;
}

function analyzeCostImplications(
  intent: UserIntent,
  context: Partial<ProjectContext>
): PEReasoning['costConsiderations'] {
  const contractType = context.contract?.type;
  const mindset = contractType ? CONTRACT_MINDSET[contractType] : undefined;
  
  switch (intent.type) {
    case 'change_order':
      return {
        directCosts: "Labor, materials, equipment, subcontractor costs with proper markup",
        indirectCosts: "Extended general conditions if schedule impact, additional supervision",
        riskExposure: mindset?.riskMindset || "Varies by contract type",
        recoveryPotential: "Document thoroughly - contemporaneous records are essential"
      };
    
    case 'field_issue':
      return {
        directCosts: "Immediate costs to address the issue",
        indirectCosts: "Potential schedule delay costs, productivity impacts",
        riskExposure: "Undocumented field decisions can waive change order rights",
        recoveryPotential: "Photo document, get direction in writing, track all costs"
      };
    
    case 'schedule_analysis':
      return {
        directCosts: "Acceleration costs if required",
        indirectCosts: "Extended general conditions, liquidated damages exposure",
        riskExposure: "Schedule delays compound - early intervention is cheaper",
        recoveryPotential: "Time extension requests, delay claims if owner-caused"
      };
    
    default:
      return {};
  }
}

function analyzeScheduleImplications(
  intent: UserIntent,
  context: Partial<ProjectContext>
): PEReasoning['scheduleConsiderations'] {
  const schedule = context.schedule;
  
  switch (intent.type) {
    case 'rfi_drafting':
      return {
        criticalPath: undefined, // Need to evaluate based on work
        floatImpact: "RFI response time may consume float",
        accelerationNeeded: false
      };
    
    case 'field_issue':
      return {
        criticalPath: true, // Assume critical until proven otherwise
        floatImpact: "Field issues often on critical path",
        accelerationNeeded: schedule && schedule.floatRemaining <= 0
      };
    
    case 'change_order':
      return {
        criticalPath: undefined,
        floatImpact: "Added scope may require time extension",
        accelerationNeeded: false
      };
    
    default:
      return {};
  }
}

function identifyRequiredDocumentation(
  intent: UserIntent,
  context: Partial<ProjectContext>
): string[] {
  const docs: string[] = [];
  
  // Always document
  docs.push("Date and time stamp on all communications");
  
  switch (intent.type) {
    case 'rfi_drafting':
      docs.push("RFI form per contract requirements");
      docs.push("Referenced drawings/specs attached");
      docs.push("Photos if applicable");
      docs.push("RFI log entry");
      break;
    
    case 'change_order':
      docs.push(...CHANGE_ORDER_STRATEGY.documentation_requirements);
      break;
    
    case 'field_issue':
      docs.push("Photos (before, during, after)");
      docs.push("Daily report entry");
      docs.push("Written notice to owner/engineer");
      docs.push("Labor and equipment records");
      docs.push("Inspector notification");
      break;
    
    case 'schedule_analysis':
      docs.push("Schedule update/analysis");
      docs.push("Delay notification letter if required");
      docs.push("Recovery schedule if requested");
      break;
  }
  
  return docs;
}

function identifyStakeholders(
  intent: UserIntent,
  context: Partial<ProjectContext>
): string[] {
  const stakeholders: string[] = [];
  
  // Internal stakeholders
  stakeholders.push("Project Manager");
  stakeholders.push("Superintendent");
  
  switch (intent.type) {
    case 'rfi_drafting':
      stakeholders.push("Engineer of Record");
      if (context.owner?.inspectorName) {
        stakeholders.push(`Inspector (${context.owner.inspectorName})`);
      }
      break;
    
    case 'change_order':
      stakeholders.push("Owner's Representative");
      stakeholders.push("Engineer (if design change)");
      stakeholders.push("Affected subcontractors");
      stakeholders.push("Project Accountant");
      break;
    
    case 'field_issue':
      stakeholders.push("Inspector");
      stakeholders.push("Affected subcontractors");
      stakeholders.push("Safety Manager (if safety-related)");
      break;
  }
  
  return stakeholders;
}

function formulateRecommendation(
  intent: UserIntent,
  context: Partial<ProjectContext>,
  underlyingConcern: string,
  contractualBasis: string[],
  costConsiderations: PEReasoning['costConsiderations'],
  scheduleConsiderations: PEReasoning['scheduleConsiderations']
): PEReasoning['recommendation'] {
  
  switch (intent.type) {
    case 'rfi_drafting':
      return {
        action: "Draft focused RFI with clear question and supporting documentation",
        rationale: "Written interpretation from engineer protects our position and creates record",
        alternatives: [
          "Informal clarification (faster but no paper trail)",
          "Proceed with contractor interpretation (risky)"
        ],
        risks: [
          "Engineer may issue response that increases our scope",
          "RFI response time may impact schedule"
        ]
      };
    
    case 'change_order':
      return {
        action: "Document the change, notify owner, track costs, submit PCO",
        rationale: "Protect change order rights through proper notice and documentation",
        alternatives: [
          "Negotiate price before work starts (preferred if time allows)",
          "Proceed on T&M basis with signed tickets"
        ],
        risks: [
          "Undocumented work may not be recoverable",
          "Delayed notice may waive rights per contract"
        ]
      };
    
    case 'field_issue':
      return {
        action: "Document immediately, notify owner/engineer in writing, track costs, resolve safely",
        rationale: "Immediate documentation preserves rights; safety cannot be compromised",
        alternatives: [
          "Stop work until direction received",
          "Proceed with contractor solution and document"
        ],
        risks: [
          "Proceeding without notice may waive change order rights",
          "Stopping work has schedule implications"
        ]
      };
    
    default:
      return {
        action: "Gather information and analyze",
        rationale: "Need more information to provide specific guidance"
      };
  }
}

// ============================================================================
// RESPONSE GENERATION
// ============================================================================

/**
 * Generate a response that sounds like a senior PE
 */
export function generatePEResponse(
  reasoning: PEReasoning,
  intent: UserIntent,
  context: Partial<ProjectContext>
): PEResponse {
  
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const nextSteps: string[] = [];
  
  // Build assumptions based on what we don't know
  if (!context.contract?.type) {
    assumptions.push("Contract type not specified - approach may vary");
  }
  if (!context.owner?.type) {
    assumptions.push("Owner type not specified - communication style may need adjustment");
  }
  
  // Add warnings based on reasoning
  if (reasoning.scheduleConsiderations?.criticalPath) {
    warnings.push("This may be on critical path - act quickly");
  }
  if (intent.type === 'change_order' && !context.contract) {
    warnings.push("Review contract notice requirements before proceeding");
  }
  
  // Build next steps
  nextSteps.push(...reasoning.documentationRequired.slice(0, 3));
  if (reasoning.stakeholders.length > 2) {
    nextSteps.push(`Coordinate with: ${reasoning.stakeholders.slice(0, 3).join(', ')}`);
  }
  
  return {
    content: "", // Will be filled by the main agent
    confidence: calculateConfidence(context, intent),
    assumptions,
    warnings: warnings.length > 0 ? warnings : undefined,
    nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
    relatedConsiderations: buildRelatedConsiderations(intent, context)
  };
}

function calculateConfidence(
  context: Partial<ProjectContext>,
  intent: UserIntent
): 'high' | 'medium' | 'low' {
  let score = 0;
  
  // More context = higher confidence
  if (context.contract?.type) score += 2;
  if (context.owner?.type) score += 1;
  if (context.schedule?.phase) score += 1;
  if (context.workTypes && context.workTypes.length > 0) score += 1;
  
  // Some intents are inherently clearer
  if (intent.type === 'quantity_takeoff') score += 1;
  if (intent.type === 'rfi_drafting') score += 1;
  
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function buildRelatedConsiderations(
  intent: UserIntent,
  context: Partial<ProjectContext>
): string[] | undefined {
  const considerations: string[] = [];
  
  switch (intent.type) {
    case 'change_order':
      considerations.push("Has this been through the RFI process if it's a design issue?");
      considerations.push("Are there similar conditions elsewhere on the project?");
      considerations.push("Is there a time extension component?");
      break;
    
    case 'field_issue':
      considerations.push("Is this a recurring issue that indicates a systemic problem?");
      considerations.push("Could this affect other work areas?");
      considerations.push("Are there safety implications?");
      break;
    
    case 'rfi_drafting':
      considerations.push("Have similar questions been asked on this project?");
      considerations.push("Is this a design-build interface issue?");
      considerations.push("Does this affect multiple trades?");
      break;
  }
  
  return considerations.length > 0 ? considerations : undefined;
}

// ============================================================================
// PE PERSONALITY AND VOICE
// ============================================================================

/**
 * Characteristics that define how a top PE communicates
 */
export const PE_VOICE = {
  // How they talk
  communicationStyle: {
    directButRespectful: "States conclusions clearly but maintains professional relationships",
    dataFirst: "Leads with facts and numbers, not opinions",
    solutionOriented: "Always offers a path forward, not just problems",
    contractAware: "Frames everything in terms of contract rights and obligations",
    documentationMinded: "Constantly thinks about creating a paper trail"
  },
  
  // Phrases a PE would use
  commonPhrases: [
    "Let's look at what the contract says...",
    "From a schedule standpoint...",
    "The risk here is...",
    "To protect our position, we should...",
    "I'd want to see that in writing.",
    "Before we proceed, we need to document...",
    "The key question is...",
    "Here's what concerns me about this...",
    "Based on similar situations I've seen...",
    "The inspector is going to ask about...",
    "If this goes to a dispute, we'll need...",
    "Let's think through the sequence here...",
    "What's our exposure if...",
    "The spec requires..., but the drawings show...",
    "That's going to be a change order.",
    "We need to get ahead of this."
  ],
  
  // Things a PE would NEVER say
  thingsToAvoid: [
    "I'm just an AI...",
    "I think maybe possibly...",
    "You should ask a professional...", // They ARE the professional
    "I'm not sure if this is relevant but...",
    "This might be a dumb question...",
    "I could be wrong but...",
    "I don't want to give you bad advice..." // PEs own their advice
  ],
  
  // How they structure information
  informationHierarchy: [
    "1. Bottom line up front (BLUF) - what's the answer?",
    "2. Key risks or concerns",
    "3. Supporting rationale",
    "4. Recommended next steps",
    "5. Documentation needed",
    "6. People to involve"
  ]
};

/**
 * Contextual responses based on project phase
 */
export function getPhaseSpecificGuidance(phase: ProjectPhase): {
  priorities: string[];
  watchItems: string[];
  keyDocuments: string[];
} {
  switch (phase) {
    case 'preconstruction':
      return {
        priorities: [
          "Validate bid assumptions against contract documents",
          "Identify specification conflicts and ambiguities",
          "Develop RFI list for preconstruction meeting",
          "Review subcontractor scopes for gaps",
          "Establish baseline schedule with key milestones"
        ],
        watchItems: [
          "Unfunded scope gaps",
          "Unrealistic schedule commitments",
          "Missing submittals on long-lead items",
          "Permit status and conditions",
          "Utility relocation schedule"
        ],
        keyDocuments: [
          "Contract with all exhibits",
          "Conformed set of drawings and specs",
          "Bid documents and estimate",
          "Schedule baseline",
          "Submittal log"
        ]
      };
    
    case 'mobilization':
      return {
        priorities: [
          "Complete submittals for long-lead items",
          "Establish site access and laydown areas",
          "Coordinate utility locates",
          "Execute subcontracts",
          "Set up project controls systems"
        ],
        watchItems: [
          "Submittal review times exceeding schedule allowance",
          "Permit conditions affecting start",
          "Subcontractor bond and insurance status",
          "Material lead times",
          "Site access restrictions"
        ],
        keyDocuments: [
          "Submittals and shop drawings",
          "Subcontracts",
          "Site logistics plan",
          "Safety plan",
          "Quality control plan"
        ]
      };
    
    case 'active_construction':
      return {
        priorities: [
          "Maintain schedule - protect critical path",
          "Process RFIs promptly",
          "Track and submit change orders timely",
          "Coordinate inspections",
          "Manage subcontractor performance"
        ],
        watchItems: [
          "RFI response delays",
          "Pending change orders",
          "Schedule slippage",
          "Quality issues requiring rework",
          "Subcontractor issues",
          "Payment application timing"
        ],
        keyDocuments: [
          "Daily reports",
          "RFI log",
          "Change order log",
          "Schedule updates",
          "Pay applications with backup"
        ]
      };
    
    case 'closeout':
      return {
        priorities: [
          "Complete punch list efficiently",
          "Compile as-built documentation",
          "Process final change orders",
          "Finalize subcontractor closeout",
          "Prepare for final inspection"
        ],
        watchItems: [
          "Incomplete documentation blocking release",
          "Outstanding change orders",
          "Retainage release requirements",
          "Warranty start dates",
          "Training and O&M requirements"
        ],
        keyDocuments: [
          "Punch list",
          "As-builts",
          "O&M manuals",
          "Warranties",
          "Final lien waivers"
        ]
      };
    
    case 'warranty':
      return {
        priorities: [
          "Respond to warranty calls promptly",
          "Document warranty work",
          "Pursue manufacturer warranties where applicable",
          "Track warranty expiration dates"
        ],
        watchItems: [
          "Legitimate warranty items vs. owner damage",
          "Warranty term expirations",
          "Recurring issues indicating defects"
        ],
        keyDocuments: [
          "Warranty terms",
          "Original construction records",
          "Maintenance records from owner"
        ]
      };
  }
}
