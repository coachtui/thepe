/**
 * Construction PE Agent
 * 
 * A domain-expert AI agent that thinks, acts, and responds like
 * a senior Project Engineer with 15+ years of heavy civil experience.
 * 
 * @example
 * ```typescript
 * import { createPEAgent } from './constructionPEAgent';
 * 
 * const agent = createPEAgent({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   projectContext: {
 *     projectName: "Highway 101 Widening",
 *     contract: { type: 'unit_price', ... },
 *     owner: { type: 'public_state', ... }
 *   }
 * });
 * 
 * const response = await agent.chat("We found differing site conditions at STA 125+00");
 * ```
 */

// Main agent
export {
  ConstructionPEAgent,
  createPEAgent,
  PEAgentConfig
} from '.';

// Types
export type {
  ProjectContext,
  ConversationContext,
  UserIntent,
  PEReasoning,
  PEResponse,
  ProjectPhase,
  ContractType,
  DeliveryMethod,
  WorkType,
  OwnerType,
  ProjectRisk,
  DocumentReference,
  ActionItem,
  CommunicationType,
  CommunicationDraft,
  VisionTask,
  SpecSection,
  StandardReference
} from './types';

// Domain knowledge
export {
  CONTRACT_MINDSET,
  OWNER_COMMUNICATION_STYLE,
  WORK_TYPE_KNOWLEDGE,
  COMMON_SPEC_SECTIONS,
  ROM_UNIT_COSTS,
  RFI_BEST_PRACTICES,
  CHANGE_ORDER_STRATEGY
} from './domainKnowledge';

// Reasoning utilities
export {
  recognizeIntent,
  reasonLikePE,
  generatePEResponse,
  PE_VOICE,
  getPhaseSpecificGuidance
} from './peReasoning';

// Document analysis (plans and specs)
export {
  ConstructionDocumentAnalyzer,
  createDocumentAnalyzer,
  SheetAnalysisResult,
  ExtractedComponent,
  UtilityCrossing,
  StationMarker,
  QuantitySummary,
  SheetReference
} from './documentAnalyzer';
