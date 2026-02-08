/**
 * Vision AI Constants
 *
 * SOURCE OF TRUTH: docs/plans/VISION-AI.md
 *
 * ⚠️ DO NOT MODIFY THESE VALUES WITHOUT UPDATING VISION-AI.md FIRST
 *
 * These constants are extracted from the Vision AI reference documentation
 * to ensure consistency across the codebase. Any changes must be reflected
 * in both this file AND the documentation.
 */

// =============================================================================
// MODEL SELECTION (Reference: VISION-AI.md - Model Selection Strategy)
// =============================================================================

/**
 * Anthropic model IDs for Vision API
 * DEFAULT: Always use Haiku 4.5 unless explicitly overridden
 */
export const VISION_MODELS = {
  /**
   * Claude Haiku 4.5 - DEFAULT MODEL
   * Cost: $0.40/$2.00 per 1M tokens (input/output)
   * Use for: 100% of standard extraction tasks
   */
  HAIKU_4_5: 'claude-haiku-4-5-20251001',

  /**
   * Claude Sonnet 4.5 - USE SPARINGLY
   * Cost: $3.00/$15.00 per 1M tokens (input/output)
   * Use for: Complex multi-step reasoning ONLY
   * ⚠️ 87% more expensive than Haiku
   */
  SONNET_4_5: 'claude-sonnet-4-5-20250929',

  /**
   * Claude Opus 4.5 - NEVER USE
   * Cost: $15.00/$75.00 per 1M tokens (input/output)
   * ❌ Too expensive for production use
   */
  OPUS_4_5: 'claude-opus-4-5-20251101'
} as const;

/**
 * Default model for all vision tasks
 * Reference: VISION-AI.md - "ALWAYS use Haiku 4.5 for standard extraction"
 */
export const DEFAULT_VISION_MODEL = VISION_MODELS.HAIKU_4_5;

/**
 * Model pricing (USD per 1M tokens)
 * Reference: VISION-AI.md - Model Comparison table
 */
export const MODEL_PRICING = {
  [VISION_MODELS.HAIKU_4_5]: {
    input: 0.40,
    output: 2.00,
    name: 'Haiku 4.5'
  },
  [VISION_MODELS.SONNET_4_5]: {
    input: 3.00,
    output: 15.00,
    name: 'Sonnet 4.5'
  },
  [VISION_MODELS.OPUS_4_5]: {
    input: 15.00,
    output: 75.00,
    name: 'Opus 4.5'
  }
} as const;

/**
 * Claude models with pricing for cost estimation
 * Reference: VISION-AI.md - Model Comparison table
 */
export const CLAUDE_MODELS = {
  haiku: {
    name: 'Haiku 4.5',
    inputCostPer1M: 0.40,
    outputCostPer1M: 2.00,
    id: VISION_MODELS.HAIKU_4_5
  },
  sonnet: {
    name: 'Sonnet 4.5',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
    id: VISION_MODELS.SONNET_4_5
  },
  opus: {
    name: 'Opus 4.5',
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
    id: VISION_MODELS.OPUS_4_5
  }
} as const;

/**
 * Task types for cost estimation
 */
export const TASK_TYPES = {
  extraction: 'extraction'
} as const;

// =============================================================================
// CONFIDENCE THRESHOLDS (Reference: VISION-AI.md - Confidence Guidelines)
// =============================================================================

/**
 * Confidence score thresholds for data quality
 * Reference: VISION-AI.md - Quality Assurance section
 */
export const CONFIDENCE_THRESHOLDS = {
  /** 95-100%: Excellent - Use directly */
  EXCELLENT: 0.95,

  /** 85-94%: Good - Use with confidence */
  GOOD: 0.85,

  /** 70-84%: Fair - Flag for review */
  FAIR: 0.70,

  /** 50-69%: Poor - Manual verification needed */
  POOR: 0.50,

  /** <50%: Very Poor - Do not use */
  MINIMUM_ACCEPTABLE: 0.50
} as const;

/**
 * Priority levels for data sources
 * Reference: VISION-AI.md - Priority-Based Resolution
 */
export const DATA_SOURCE_PRIORITY = {
  /** Termination points from actual drawings - 95% confidence */
  TERMINATION_POINTS: {
    priority: 1,
    name: 'highest',
    confidence: 0.95,
    description: 'BEGIN/END labels from actual drawings'
  },

  /** Structured quantities from tables - 85% confidence */
  STRUCTURED_QUANTITY: {
    priority: 2,
    name: 'medium',
    confidence: 0.85,
    description: 'Quantity tables from title/summary sheets'
  },

  /** Index sheet data - 70% confidence (reduced, flagged) */
  INDEX_SHEET: {
    priority: 3,
    name: 'low',
    confidence: 0.70,
    description: 'Index/TOC sheets (often incomplete)'
  },

  /** Vector search fallback - Variable confidence */
  VECTOR_SEARCH: {
    priority: 4,
    name: 'fallback',
    confidence: 0.60,
    description: 'RAG vector search (depends on chunk relevance)'
  }
} as const;

// =============================================================================
// IMAGE PROCESSING (Reference: VISION-AI.md - Data Structures)
// =============================================================================

/**
 * Image conversion settings
 * Reference: VISION-AI.md - convertPdfPageToImage()
 */
export const IMAGE_SETTINGS = {
  /** Maximum dimension (width or height) in pixels */
  MAX_DIMENSION: 2048,

  /** Default scale factor for PDF rendering (1.0-3.0) */
  DEFAULT_SCALE: 2.0,

  /** Recommended scale for cost optimization */
  RECOMMENDED_SCALE: 2.0,

  /** Minimum scale (lower quality but cheaper) */
  MIN_SCALE: 1.0,

  /** Maximum scale (higher quality but more expensive) */
  MAX_SCALE: 3.0,

  /** Default format */
  FORMAT: 'png' as const
} as const;

// =============================================================================
// SHEET CLASSIFICATION (Reference: VISION-AI.md - Prompt Engineering)
// =============================================================================

/**
 * Sheet type classifications
 * Reference: VISION-AI.md - Sheet Analysis Prompt
 */
export const SHEET_TYPES = {
  TITLE: 'title',
  SUMMARY: 'summary',
  PLAN: 'plan',
  PROFILE: 'profile',
  DETAIL: 'detail',
  LEGEND: 'legend',
  INDEX: 'index',
  UNKNOWN: 'unknown'
} as const;

/**
 * Critical sheet patterns for priority processing
 * Reference: VISION-AI.md - Critical Sheet Identification
 */
export const CRITICAL_SHEET_PATTERNS = {
  title: /title|cover|index/i,
  summary: /summary|quantities|general.*notes/i,
  legend: /legend|symbols|abbreviations/i,
  index: /index|toc|table.*contents|drawing.*list/i,
  plan: /plan|layout/i,
  profile: /profile|elevation/i
} as const;

/**
 * Index sheet indicators (less reliable data)
 * Reference: VISION-AI.md - Index Sheet Detection
 */
export const INDEX_SHEET_INDICATORS = [
  'table of contents',
  'index of drawings',
  'sheet index',
  'drawing list',
  'quantity summary'
] as const;

// =============================================================================
// TERMINATION TYPES (Reference: VISION-AI.md - Termination Points)
// =============================================================================

/**
 * Valid termination point types
 * Reference: VISION-AI.md - utility_termination_points schema
 */
export const TERMINATION_TYPES = {
  BEGIN: 'BEGIN',
  END: 'END',
  TIE_IN: 'TIE-IN',
  TERMINUS: 'TERMINUS'
} as const;

/**
 * Utility type classifications
 * Reference: VISION-AI.md - inferUtilityType()
 */
export const UTILITY_TYPES = {
  WATER: 'water',
  STORM: 'storm',
  SEWER: 'sewer',
  GAS: 'gas',
  ELECTRIC: 'electric',
  TELECOM: 'telecom'
} as const;

// =============================================================================
// COST TARGETS (Reference: VISION-AI.md - Cost Management)
// =============================================================================

/**
 * Cost targets per document size
 * Reference: VISION-AI.md - Cost Targets table
 */
export const COST_TARGETS = {
  SMALL: {
    maxSheets: 10,
    targetCostUsd: 0.20,
    description: 'Small documents (1-10 sheets)'
  },
  MEDIUM: {
    maxSheets: 50,
    targetCostUsd: 1.00,
    description: 'Medium documents (11-50 sheets)'
  },
  LARGE: {
    maxSheets: 100,
    targetCostUsd: 2.00,
    description: 'Large documents (51-100 sheets)'
  },
  VERY_LARGE: {
    maxSheets: Infinity,
    targetCostUsd: 3.00,
    description: 'Very large documents (100+ sheets)'
  }
} as const;

/**
 * Typical cost per sheet with Haiku 4.5
 * Reference: VISION-AI.md - "~$0.015/sheet"
 */
export const TYPICAL_COST_PER_SHEET = 0.015;

// =============================================================================
// SOURCE CONTEXT (Reference: VISION-AI.md - Quantity Extraction)
// =============================================================================

/**
 * Source context types for quantity data
 * Reference: VISION-AI.md - sourceContext field
 */
export const SOURCE_CONTEXT = {
  /** From index/TOC sheet listing (least reliable) */
  INDEX_LIST: 'index_list',

  /** From quantity table on title/summary sheet (reliable) */
  QUANTITY_TABLE: 'quantity_table',

  /** From callout box or label on actual drawing (most reliable) */
  DRAWING_LABEL: 'drawing_label'
} as const;

// =============================================================================
// VALIDATION MESSAGES (Reference: VISION-AI.md - Best Practices)
// =============================================================================

/**
 * Standard warning messages
 * Reference: VISION-AI.md - Smart Priority Resolution
 */
export const WARNING_MESSAGES = {
  LOW_CONFIDENCE: (confidence: number) =>
    `Low confidence extraction (${(confidence * 100).toFixed(0)}%). Manual verification recommended.`,

  INDEX_SHEET_WARNING:
    'This quantity appears to come from an index/table of contents. ' +
    'Index sheets may have incomplete data. ' +
    'Consider checking actual plan/profile drawings for termination points.',

  PARTIAL_TERMINATION: (hasBegin: boolean, hasEnd: boolean) =>
    `Found partial termination data in drawings (${hasBegin ? 'BEGIN' : 'no BEGIN'}, ` +
    `${hasEnd ? 'END' : 'no END'}). Full calculation not possible.`,

  BUDGET_EXCEEDED: (cost: number, target: number) =>
    `Cost $${cost.toFixed(2)} exceeds target $${target.toFixed(2)}. ` +
    `Review sheet selection or reduce scale factor.`,

  NO_TERMINATION_POINTS:
    'No termination points found. Ensure vision processing has completed on plan/profile drawings.'
} as const;

// =============================================================================
// TYPE GUARDS & VALIDATORS
// =============================================================================

/**
 * Validate confidence score is within acceptable range
 */
export function isAcceptableConfidence(confidence: number): boolean {
  return confidence >= CONFIDENCE_THRESHOLDS.MINIMUM_ACCEPTABLE;
}

/**
 * Get confidence level name from score
 */
export function getConfidenceLevel(confidence: number): string {
  if (confidence >= CONFIDENCE_THRESHOLDS.EXCELLENT) return 'Excellent';
  if (confidence >= CONFIDENCE_THRESHOLDS.GOOD) return 'Good';
  if (confidence >= CONFIDENCE_THRESHOLDS.FAIR) return 'Fair';
  if (confidence >= CONFIDENCE_THRESHOLDS.POOR) return 'Poor';
  return 'Very Poor';
}

/**
 * Check if model is approved for production use
 */
export function isApprovedModel(model: string): boolean {
  return model === VISION_MODELS.HAIKU_4_5 || model === VISION_MODELS.SONNET_4_5;
}

/**
 * Validate model selection with warnings
 */
export function validateModelSelection(model: string, taskType: string): {
  approved: boolean;
  warning?: string;
} {
  if (model === VISION_MODELS.OPUS_4_5) {
    return {
      approved: false,
      warning: '❌ NEVER use Opus - too expensive for production ($15/$75 per 1M tokens)'
    };
  }

  if (model === VISION_MODELS.SONNET_4_5) {
    return {
      approved: true,
      warning: '⚠️ Using Sonnet (87% more expensive than Haiku). Justify usage in logs.'
    };
  }

  return { approved: true };
}

/**
 * Get cost target for document size
 */
export function getCostTarget(sheetCount: number): number {
  if (sheetCount <= COST_TARGETS.SMALL.maxSheets) return COST_TARGETS.SMALL.targetCostUsd;
  if (sheetCount <= COST_TARGETS.MEDIUM.maxSheets) return COST_TARGETS.MEDIUM.targetCostUsd;
  if (sheetCount <= COST_TARGETS.LARGE.maxSheets) return COST_TARGETS.LARGE.targetCostUsd;
  return COST_TARGETS.VERY_LARGE.targetCostUsd;
}

// =============================================================================
// EXPORTS
// =============================================================================

export type SheetType = typeof SHEET_TYPES[keyof typeof SHEET_TYPES];
export type TerminationType = typeof TERMINATION_TYPES[keyof typeof TERMINATION_TYPES];
export type UtilityType = typeof UTILITY_TYPES[keyof typeof UTILITY_TYPES];
export type SourceContext = typeof SOURCE_CONTEXT[keyof typeof SOURCE_CONTEXT];
export type VisionModel = typeof VISION_MODELS[keyof typeof VISION_MODELS];
