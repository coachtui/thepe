/**
 * Task Router scaffold.
 *
 * This is intentionally lightweight: it classifies the user's latest request
 * into a construction workflow bucket, but does not change retrieval yet.
 * Existing chat behavior remains the fallback.
 */

export type TaskRoute =
  | 'ask_project'
  | 'spec_lookup'
  | 'plan_lookup'
  | 'rfi_draft'
  | 'submittal_review'
  | 'submittal_register'
  | 'qc_plan'
  | 'schedule_question'
  | 'field_question'
  | 'equipment_question'
  | 'general'

export interface TaskRouteResult {
  route: TaskRoute
  confidence: number
  matchedSignals: string[]
  fallbackRoute: 'general'
}

export type RetrievalMode =
  | 'generic'
  | 'project_overview'
  | 'spec_first'
  | 'plan_first'
  | 'multi_source'
  | 'structured_register'
  | 'history_aware'

export interface RetrievalStrategy {
  taskType: TaskRoute
  retrievalMode: RetrievalMode
  preferredDocumentTypes: string[]
  preferredMetadataFields: string[]
  defaultTopK: number
  citationRequired: boolean
  includeProjectHistory: boolean
  structuredOutputRequired: boolean
  promptTemplateName: string
  notes: string
}

interface RouteRule {
  route: TaskRoute
  confidence: number
  signals: Array<{
    label: string
    pattern: RegExp
  }>
}

const ROUTE_RULES: RouteRule[] = [
  {
    route: 'rfi_draft',
    confidence: 0.9,
    signals: [
      { label: 'rfi_draft', pattern: /\b(?:draft|write|create|generate|compose)\b.*\bRFI\b/i },
      { label: 'request_for_information', pattern: /\brequest\s+for\s+information\b/i },
    ],
  },
  {
    route: 'submittal_register',
    confidence: 0.88,
    signals: [
      { label: 'submittal_register', pattern: /\bsubmittal\s+(?:register|log|list|schedule|matrix)\b/i },
      { label: 'submittals_required', pattern: /\bwhat\s+submittals?\s+(?:are\s+)?required\b/i },
      { label: 'submittal_tracking', pattern: /\b(?:track|status|open|overdue)\b.*\bsubmittals?\b/i },
    ],
  },
  {
    route: 'submittal_review',
    confidence: 0.86,
    signals: [
      { label: 'submittal_review', pattern: /\b(?:review|check|compare|verify)\b.*\bsubmittals?\b/i },
      { label: 'shop_drawings', pattern: /\b(?:shop\s+drawing|product\s+data|sample)\b/i },
    ],
  },
  {
    route: 'spec_lookup',
    confidence: 0.84,
    signals: [
      { label: 'spec_section', pattern: /\b(?:spec|specification|section)\s*\d{2}(?:\s*\d{2}){0,2}\b/i },
      { label: 'requirements', pattern: /\b(?:spec|specification|requirements?|shall|required|ASTM|AWWA|ACI|CSI)\b/i },
    ],
  },
  {
    route: 'plan_lookup',
    confidence: 0.84,
    signals: [
      { label: 'sheet_number', pattern: /\b(?:sheet|drawing|plan)\s+[A-Z]{1,3}[- ]?\d{1,4}[A-Z]?\b/i },
      { label: 'drawing_lookup', pattern: /\b(?:where|which\s+sheet|show(?:s)?|detail|callout|station|STA|plan\s+view|profile)\b/i },
    ],
  },
  {
    route: 'qc_plan',
    confidence: 0.82,
    signals: [
      { label: 'qc_plan', pattern: /\b(?:QC|quality\s+control|inspection|ITP|test\s+plan|hold\s+point)\b/i },
      { label: 'testing', pattern: /\b(?:testing|commissioning|mockup|deficiency|punch)\b/i },
    ],
  },
  {
    route: 'equipment_question',
    confidence: 0.78,
    signals: [
      { label: 'equipment', pattern: /\b(?:equipment|crane|pump|excavator|loader|dozer|generator|lift|telehandler)\b/i },
      { label: 'equipment_planning', pattern: /\b(?:mobilize|rental|capacity|reach|pick|hoist)\b/i },
    ],
  },
  {
    route: 'schedule_question',
    confidence: 0.8,
    signals: [
      { label: 'schedule', pattern: /\b(?:schedule|CPM|critical\s+path|lookahead|delay|float|predecessor|successor)\b/i },
      { label: 'sequence', pattern: /\b(?:sequence|phasing|milestone|duration|start|finish)\b/i },
      { label: 'work_date', pattern: /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i },
    ],
  },
  {
    route: 'field_question',
    confidence: 0.78,
    signals: [
      { label: 'field_condition', pattern: /\b(?:field|site|install|installation|construct|means\s+and\s+methods|crew|foreman)\b/i },
      { label: 'field_issue', pattern: /\b(?:what\s+do\s+we\s+do|can\s+we|how\s+should\s+we|workaround)\b/i },
    ],
  },
  {
    route: 'ask_project',
    confidence: 0.76,
    signals: [
      { label: 'project_summary', pattern: /\b(?:project|job|contract|scope|overview|summary|documents?|plans?|drawings?)\b/i },
      { label: 'project_question', pattern: /\b(?:what'?s\s+in|tell\s+me\s+about|summarize|analyze)\b/i },
    ],
  },
]

const RETRIEVAL_STRATEGIES: Record<TaskRoute, RetrievalStrategy> = {
  ask_project: {
    taskType: 'ask_project',
    retrievalMode: 'project_overview',
    preferredDocumentTypes: ['drawings', 'specifications', 'contract_documents', 'rfis', 'submittals'],
    preferredMetadataFields: ['document_type', 'discipline', 'sheet_number', 'spec_section', 'page_number'],
    defaultTopK: 12,
    citationRequired: false,
    includeProjectHistory: true,
    structuredOutputRequired: false,
    promptTemplateName: 'project_overview',
    notes: 'Use broad project context. TODO: current retrieval does not consistently filter by all document_type values; preserve generic fallback.',
  },
  spec_lookup: {
    taskType: 'spec_lookup',
    retrievalMode: 'spec_first',
    preferredDocumentTypes: ['specifications', 'contract_documents'],
    preferredMetadataFields: ['spec_section', 'page_number', 'document_id', 'filename'],
    defaultTopK: 8,
    citationRequired: true,
    includeProjectHistory: false,
    structuredOutputRequired: false,
    promptTemplateName: 'spec_lookup',
    notes: 'Search specifications first and cite section/page. TODO: current retrieval may not enforce spec_section filters everywhere; preserve fallback.',
  },
  plan_lookup: {
    taskType: 'plan_lookup',
    retrievalMode: 'plan_first',
    preferredDocumentTypes: ['drawings', 'plans', 'sheets'],
    preferredMetadataFields: ['sheet_number', 'page_number', 'location', 'station', 'detail_ref', 'document_id'],
    defaultTopK: 10,
    citationRequired: true,
    includeProjectHistory: false,
    structuredOutputRequired: false,
    promptTemplateName: 'plan_lookup',
    notes: 'Search drawings/plans first and cite sheet/page/location. TODO: location/detail filters depend on indexed sheet metadata availability.',
  },
  rfi_draft: {
    taskType: 'rfi_draft',
    retrievalMode: 'multi_source',
    preferredDocumentTypes: ['specifications', 'drawings', 'plans', 'rfis'],
    preferredMetadataFields: ['spec_section', 'sheet_number', 'page_number', 'rfi_number', 'document_id'],
    defaultTopK: 12,
    citationRequired: true,
    includeProjectHistory: true,
    structuredOutputRequired: true,
    promptTemplateName: 'rfi_draft',
    notes: 'Gather governing spec/plan evidence plus prior RFIs before drafting. TODO: prior-RFI filtering is not universally wired into current retrieval.',
  },
  submittal_review: {
    taskType: 'submittal_review',
    retrievalMode: 'multi_source',
    preferredDocumentTypes: ['specifications', 'submittals', 'prior_approvals', 'drawings'],
    preferredMetadataFields: ['spec_section', 'submittal_id', 'approval_status', 'page_number', 'document_id'],
    defaultTopK: 12,
    citationRequired: true,
    includeProjectHistory: true,
    structuredOutputRequired: true,
    promptTemplateName: 'submittal_review',
    notes: 'Search specs, submitted material, and prior approvals when present. TODO: approval_status and prior_approvals are strategy hints only for now.',
  },
  submittal_register: {
    taskType: 'submittal_register',
    retrievalMode: 'structured_register',
    preferredDocumentTypes: ['specifications', 'contract_documents'],
    preferredMetadataFields: ['spec_section', 'submittal_requirement', 'page_number', 'discipline', 'document_id'],
    defaultTopK: 20,
    citationRequired: true,
    includeProjectHistory: false,
    structuredOutputRequired: true,
    promptTemplateName: 'submittal_register',
    notes: 'Search specs first and produce a structured register. TODO: submittal_requirement extraction is not a guaranteed current retrieval filter.',
  },
  qc_plan: {
    taskType: 'qc_plan',
    retrievalMode: 'multi_source',
    preferredDocumentTypes: ['specifications', 'contract_documents', 'schedule', 'qc_templates'],
    preferredMetadataFields: ['spec_section', 'inspection_type', 'test_requirement', 'activity_id', 'page_number'],
    defaultTopK: 14,
    citationRequired: true,
    includeProjectHistory: true,
    structuredOutputRequired: true,
    promptTemplateName: 'qc_plan',
    notes: 'Use specs, contract requirements, schedule, and QC templates if available. TODO: qc_templates are not currently a first-class source.',
  },
  schedule_question: {
    taskType: 'schedule_question',
    retrievalMode: 'history_aware',
    preferredDocumentTypes: ['schedule', 'lookahead', 'daily_reports', 'project_history'],
    preferredMetadataFields: ['activity_id', 'activity_name', 'start_date', 'finish_date', 'report_date', 'crew'],
    defaultTopK: 10,
    citationRequired: false,
    includeProjectHistory: true,
    structuredOutputRequired: false,
    promptTemplateName: 'schedule_question',
    notes: 'Search schedules, lookahead data, daily reports, and project history if present. TODO: current generic retrieval may not index all live schedule/history sources.',
  },
  field_question: {
    taskType: 'field_question',
    retrievalMode: 'history_aware',
    preferredDocumentTypes: ['drawings', 'plans', 'specifications', 'rfis', 'submittals', 'project_history'],
    preferredMetadataFields: ['sheet_number', 'spec_section', 'rfi_number', 'submittal_id', 'page_number', 'report_date'],
    defaultTopK: 12,
    citationRequired: true,
    includeProjectHistory: true,
    structuredOutputRequired: false,
    promptTemplateName: 'field_question',
    notes: 'Field answers should pull plans, specs, RFIs, submittals, and recent history. TODO: recent-history ranking is not yet enforced.',
  },
  equipment_question: {
    taskType: 'equipment_question',
    retrievalMode: 'history_aware',
    preferredDocumentTypes: ['equipment_records', 'work_orders', 'inspections', 'project_history'],
    preferredMetadataFields: ['equipment_id', 'asset_tag', 'work_order_id', 'inspection_date', 'status', 'report_date'],
    defaultTopK: 10,
    citationRequired: false,
    includeProjectHistory: true,
    structuredOutputRequired: false,
    promptTemplateName: 'equipment_question',
    notes: 'Search equipment records, work orders, inspections, and project history. TODO: these sources are strategy hints until indexed retrieval supports them.',
  },
  general: {
    taskType: 'general',
    retrievalMode: 'generic',
    preferredDocumentTypes: [],
    preferredMetadataFields: [],
    defaultTopK: 10,
    citationRequired: false,
    includeProjectHistory: false,
    structuredOutputRequired: false,
    promptTemplateName: 'general',
    notes: 'Preserve existing generic chat/retrieval behavior.',
  },
}

/**
 * Classify a user request into the first matching task route.
 *
 * Rule order is part of the scaffold: specific document-production tasks
 * intentionally run before broad project/plan/spec buckets.
 */
export function classifyTaskRoute(input: string): TaskRouteResult {
  const query = input.trim()

  if (!query) {
    return {
      route: 'general',
      confidence: 0.5,
      matchedSignals: [],
      fallbackRoute: 'general',
    }
  }

  for (const rule of ROUTE_RULES) {
    const matchedSignals = rule.signals
      .filter(signal => signal.pattern.test(query))
      .map(signal => signal.label)

    if (matchedSignals.length > 0) {
      return {
        route: rule.route,
        confidence: Math.min(0.95, rule.confidence + (matchedSignals.length - 1) * 0.03),
        matchedSignals,
        fallbackRoute: 'general',
      }
    }
  }

  return {
    route: 'general',
    confidence: 0.55,
    matchedSignals: [],
    fallbackRoute: 'general',
  }
}

export function classifyConstructionTask(input: string): TaskRouteResult {
  return classifyTaskRoute(input)
}

export function getRetrievalStrategyForTask(taskType: TaskRoute): RetrievalStrategy {
  return RETRIEVAL_STRATEGIES[taskType] ?? RETRIEVAL_STRATEGIES.general
}
