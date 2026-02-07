/**
 * Construction Project Engineer Agent - Type Definitions
 * 
 * These types capture the mental models and data structures
 * that a senior PE uses to think about projects.
 */

// ============================================================================
// CORE DOMAIN TYPES
// ============================================================================

/**
 * Project phase - determines what questions matter most
 */
export type ProjectPhase = 
  | 'preconstruction'      // Bidding, estimating, value engineering
  | 'mobilization'         // Site setup, submittals, procurement
  | 'active_construction'  // Daily ops, RFIs, change orders
  | 'closeout'             // Punch list, as-builts, final documentation
  | 'warranty';            // Post-construction issues

/**
 * Contract type affects EVERYTHING about how a PE thinks
 */
export type ContractType = 
  | 'lump_sum'            // Fixed price - every penny matters
  | 'unit_price'          // Quantities drive payment
  | 'time_and_materials'  // Track everything
  | 'cost_plus'           // Fee on top of costs
  | 'design_build'        // We own the design risk
  | 'gmp';                // Guaranteed max with savings share

/**
 * Delivery method changes communication and risk allocation
 */
export type DeliveryMethod = 
  | 'design_bid_build'    // Traditional - adversarial by nature
  | 'design_build'        // Collaborative - we own problems
  | 'cmar'                // CM at Risk - early involvement
  | 'progressive_db'      // Phased design-build
  | 'ipd';                // Integrated - all in together

/**
 * Work type - each has unique considerations
 */
export type WorkType = 
  | 'sitework'
  | 'utilities_wet'       // Water, sewer, storm
  | 'utilities_dry'       // Electric, gas, telecom
  | 'roadwork'
  | 'structures'          // Bridges, retaining walls
  | 'demolition'
  | 'environmental'       // Remediation, erosion control
  | 'concrete'
  | 'earthwork';

/**
 * Owner type - affects communication style and priorities
 */
export type OwnerType = 
  | 'public_municipal'    // City/county - political, budget cycles
  | 'public_state'        // DOT, state agencies - bureaucratic
  | 'public_federal'      // Feds - Davis-Bacon, DBE requirements
  | 'private_developer'   // Speed and cost focused
  | 'private_industrial'  // Plant work - safety paramount
  | 'utility_company';    // Regulated, franchise requirements

// ============================================================================
// PROJECT CONTEXT - The PE's Mental Model
// ============================================================================

export interface ProjectContext {
  // Basic identification
  projectName: string;
  projectNumber?: string;
  location: {
    city?: string;
    county?: string;
    state: string;
    jurisdiction?: string;  // Who has authority
  };
  
  // Contract structure (CRITICAL for decision-making)
  contract: {
    type: ContractType;
    deliveryMethod: DeliveryMethod;
    originalValue: number;
    currentValue: number;      // With approved changes
    percentComplete: number;
    liquidatedDamages?: number; // Per day
    retainage: number;         // Percentage held
    bonded: boolean;
  };
  
  // Schedule context
  schedule: {
    originalDuration: number;  // Calendar days
    currentDuration: number;
    daysRemaining: number;
    floatRemaining: number;    // Critical path float
    phase: ProjectPhase;
    criticalActivities: string[];
  };
  
  // Owner dynamics
  owner: {
    type: OwnerType;
    inspectorName?: string;
    engineerOfRecord?: string;
    residentEngineer?: string;
    relationshipHealth: 'excellent' | 'good' | 'strained' | 'adversarial';
    paymentHistory: 'prompt' | 'slow' | 'problematic';
  };
  
  // Work characteristics
  workTypes: WorkType[];
  
  // Risk factors the PE is tracking
  activeRisks: ProjectRisk[];
  
  // Document state
  documents: {
    specsVersion?: string;
    drawingsVersion?: string;
    lastAddendum?: string;
    pendingRFIs: number;
    pendingSubmittals: number;
    pendingChangeOrders: number;
  };
}

export interface ProjectRisk {
  id: string;
  category: 'schedule' | 'cost' | 'quality' | 'safety' | 'regulatory' | 'relationship';
  description: string;
  likelihood: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high' | 'critical';
  mitigation?: string;
  owner: 'contractor' | 'owner' | 'shared' | 'sub';
}

// ============================================================================
// CONVERSATION AND REASONING
// ============================================================================

export interface ConversationContext {
  // What is the user trying to accomplish?
  intent: UserIntent;
  
  // What project context is relevant?
  relevantContext: Partial<ProjectContext>;
  
  // What documents/drawings are in scope?
  documentsInScope: DocumentReference[];
  
  // Conversation history for continuity
  recentTopics: string[];
  
  // Pending items we're tracking
  actionItems: ActionItem[];
}

export type UserIntent = 
  | { type: 'quantity_takeoff'; items: string[]; purpose?: 'bid' | 'change_order' | 'progress' }
  | { type: 'rfi_drafting'; issue: string; urgency: 'routine' | 'urgent' | 'critical' }
  | { type: 'change_order'; description: string; direction: 'ccd' | 'pco' | 'co' }
  | { type: 'schedule_analysis'; concern: string }
  | { type: 'cost_analysis'; scope: string }
  | { type: 'document_review'; docType: string; purpose: string }
  | { type: 'field_issue'; problem: string }
  | { type: 'meeting_prep'; meetingType: string }
  | { type: 'correspondence'; recipient: string; topic: string }
  | { type: 'general_question'; topic: string }
  | { type: 'unknown' };

export interface DocumentReference {
  type: 'spec_section' | 'drawing' | 'rfi' | 'submittal' | 'change_order' | 'daily_report' | 'schedule' | 'other';
  identifier: string;  // e.g., "Section 33 10 00", "C-005", "RFI-042"
  title?: string;
  relevance: string;   // Why this document matters to current discussion
}

export interface ActionItem {
  id: string;
  description: string;
  owner: string;
  dueDate?: Date;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'in_progress' | 'blocked' | 'complete';
  linkedTo?: string;  // RFI, CO, submittal number
}

// ============================================================================
// PE REASONING FRAMEWORK
// ============================================================================

/**
 * How a PE thinks through problems
 */
export interface PEReasoning {
  // What's the actual question behind the question?
  underlyingConcern: string;
  
  // What contract/spec sections are relevant?
  contractualBasis: string[];
  
  // What are the cost implications?
  costConsiderations: {
    directCosts?: string;
    indirectCosts?: string;
    riskExposure?: string;
    recoveryPotential?: string;
  };
  
  // What are the schedule implications?
  scheduleConsiderations: {
    criticalPath?: boolean;
    floatImpact?: string;
    accelerationNeeded?: boolean;
  };
  
  // What documentation is needed?
  documentationRequired: string[];
  
  // Who needs to be involved?
  stakeholders: string[];
  
  // What's the recommended approach?
  recommendation: {
    action: string;
    rationale: string;
    alternatives?: string[];
    risks?: string[];
  };
}

// ============================================================================
// RESPONSE FORMATTING
// ============================================================================

export interface PEResponse {
  // Main response content
  content: string;
  
  // Confidence level
  confidence: 'high' | 'medium' | 'low';
  
  // What assumptions were made?
  assumptions: string[];
  
  // What additional info would help?
  clarifyingQuestions?: string[];
  
  // Recommended next steps
  nextSteps?: string[];
  
  // Related items to consider
  relatedConsiderations?: string[];
  
  // Warnings or cautions
  warnings?: string[];
  
  // References used
  references?: DocumentReference[];
}

// ============================================================================
// INDUSTRY STANDARDS AND CODES
// ============================================================================

export interface StandardReference {
  code: string;           // e.g., "ASTM D1557", "AASHTO M 145"
  title: string;
  relevance: string;
  currentVersion?: string;
}

export interface SpecSection {
  number: string;         // CSI format: "33 10 00"
  title: string;
  division: number;
  commonIssues: string[];
  keyRequirements: string[];
  typicalSubmittals: string[];
}

// ============================================================================
// COMMUNICATION TEMPLATES
// ============================================================================

export type CommunicationType = 
  | 'rfi'
  | 'submittal_transmittal'
  | 'change_order_request'
  | 'notice_of_delay'
  | 'time_extension_request'
  | 'differing_site_conditions'
  | 'constructive_change_notice'
  | 'meeting_minutes'
  | 'daily_report'
  | 'progress_report'
  | 'claim_notice';

export interface CommunicationDraft {
  type: CommunicationType;
  subject: string;
  to: string[];
  cc?: string[];
  body: string;
  attachments?: string[];
  contractReferences?: string[];
  urgency: 'routine' | 'time_sensitive' | 'urgent' | 'critical';
  preservesRights: boolean;  // Does this protect our contractual position?
}
