/**
 * Claude Vision API Integration
 *
 * Uses Claude's vision capabilities to analyze construction plan sheets
 * and extract structured information like quantities, station numbers, and spatial relationships.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';

/**
 * Vision task complexity levels for model selection
 */
export type VisionTask = 'classification' | 'extraction' | 'complex_analysis';

/**
 * Configuration for vision analysis
 */
export interface VisionAnalysisOptions {
  /**
   * Type of sheet being analyzed
   */
  sheetType?: 'title' | 'summary' | 'plan' | 'profile' | 'detail' | 'legend' | 'unknown';

  /**
   * Sheet number (e.g., "C-001")
   */
  sheetNumber?: string;

  /**
   * Custom prompt additions
   */
  customPrompt?: string;

  /**
   * Model to use (default: auto-selected based on taskType)
   * Override this if you want to force a specific model
   */
  model?: string;

  /**
   * Task complexity level (determines model selection)
   * - 'classification': Quick sheet type identification (uses Haiku - cheapest)
   * - 'extraction': Extract quantities, stations, labels (uses Haiku - accurate & cheap)
   * - 'complex_analysis': Multi-step reasoning (uses Sonnet - most expensive)
   * Default: 'extraction'
   */
  taskType?: VisionTask;

  /**
   * Max tokens for response (default: 4096)
   */
  maxTokens?: number;

  /**
   * Temperature (default: 0.0 for structured extraction)
   */
  temperature?: number;
}

/**
 * Structured result from vision analysis
 */
export interface VisionAnalysisResult {
  // Raw analysis text
  rawAnalysis: string;

  // Sheet metadata
  sheetMetadata: {
    sheetNumber?: string;
    sheetTitle?: string;
    sheetType?: string;
    discipline?: string;
    revision?: string;
    date?: string;
    isIndexSheet?: boolean; // CRITICAL: Flag if this is an index/TOC sheet
  };

  // Termination points (BEGIN/END labels on drawings)
  terminationPoints: Array<{
    utilityName: string;
    terminationType: 'BEGIN' | 'END' | 'TIE-IN' | 'TERMINUS';
    station: string;
    notes?: string;
    confidence: number; // 0.0 to 1.0
  }>;

  // Extracted quantities (if any)
  quantities: Array<{
    itemName: string;
    itemNumber?: string;
    quantity?: number;
    unit?: string;
    stationFrom?: string;
    stationTo?: string;
    description?: string;
    confidence: number; // 0.0 to 1.0
    sourceContext?: string; // 'index_list' | 'quantity_table' | 'drawing_label'
  }>;

  // Utility crossings (from profile views)
  utilityCrossings: Array<{
    crossingUtility: string; // e.g., "ELEC", "SS", "STM", "GAS", "TEL", "W"
    utilityFullName: string; // e.g., "Electrical", "Sanitary Sewer"
    station?: string; // Station where crossing occurs
    elevation?: number; // Elevation of crossing (e.g., 35.73)
    isExisting: boolean; // Is this an existing utility?
    isProposed: boolean; // Is this a proposed utility?
    size?: string; // e.g., "12-IN"
    notes?: string; // Additional context
    confidence: number; // 0.0 to 1.0
  }>;

  // Station numbers found
  stations: Array<{
    station: string;
    normalizedStation: string; // e.g., "13+68.83" -> "001368.83"
    location: 'top' | 'bottom' | 'left' | 'right' | 'center' | 'unknown';
    context?: string;
  }>;

  // Spatial information
  spatialInfo: {
    hasProfileView: boolean;
    hasPlanView: boolean;
    hasDetailCallouts: boolean;
    alignmentDirection?: string;
    keyFeatures: string[];
  };

  // Cross-references
  crossReferences: Array<{
    type: 'sheet' | 'detail' | 'section' | 'note';
    reference: string;
    description?: string;
  }>;

  // Cost and performance
  tokensUsed: {
    input: number;
    output: number;
  };
  costUsd: number;
  latencyMs: number;
}

/**
 * Initialize Claude client
 */
function getClaudeClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  return new Anthropic({ apiKey });
}

/**
 * Select the optimal Claude model based on task complexity
 *
 * Cost comparison (per 1M tokens):
 * - Haiku 4.5: Input $0.40, Output $2.00 (87% cheaper than Sonnet!)
 * - Sonnet 4.5: Input $3.00, Output $15.00
 *
 * For construction plan extraction, Haiku achieves 90-95% of Sonnet's accuracy
 * at only 13% of the cost, making it ideal for most tasks.
 */
function selectVisionModel(taskType: VisionTask = 'extraction'): string {
  switch (taskType) {
    case 'classification':
      // Quick "what type of sheet is this?" - Haiku is perfect
      return 'claude-haiku-4-5-20251001';

    case 'extraction':
      // Extract quantities, stations, labels - Haiku handles this excellently
      return 'claude-haiku-4-5-20251001';

    case 'complex_analysis':
      // Complex reasoning, multi-step analysis - use Sonnet only if truly needed
      return 'claude-sonnet-4-5-20250929';

    default:
      return 'claude-haiku-4-5-20251001'; // Default to cheapest
  }
}

/**
 * Get pricing for a specific model (per million tokens)
 */
function getModelPricing(model: string): { input: number; output: number } {
  if (model.includes('haiku')) {
    return { input: 0.40, output: 2.00 };
  } else if (model.includes('sonnet')) {
    return { input: 3.00, output: 15.00 };
  } else if (model.includes('opus')) {
    return { input: 15.00, output: 75.00 };
  }
  // Default to Haiku pricing (conservative estimate)
  return { input: 0.40, output: 2.00 };
}

/**
 * Build the vision analysis prompt based on sheet type
 */
function buildVisionPrompt(
  sheetType?: string,
  sheetNumber?: string,
  customPrompt?: string
): string {
  let prompt = `## EXTRACTION PHILOSOPHY - THINK LIKE AN ESTIMATOR

You are analyzing a construction plan sheet. Your goal is to extract useful, accurate information that helps answer questions about material quantities, utility crossings, and termination points.

**Think like an estimator**:
- What information would someone doing a takeoff need?
- Where is that information most reliably shown?
- How can I avoid counting the same thing twice?
- What level of detail is appropriate?

**Adapt to what you see**:
- Every engineer draws plans differently
- Every project has different conventions
- Examine THIS sheet and understand ITS format
- Don't force rigid patterns if they don't fit

**Quality over quantity**:
- Better to extract 5 components with high confidence than 20 components with errors
- Flag uncertainties rather than making assumptions

## CRITICAL: FIRST IDENTIFY SHEET TYPE

Before analyzing content, determine if this is an INDEX or TABLE OF CONTENTS:
- Does it have a table listing multiple sheets with their descriptions?
- Does it say "INDEX", "TABLE OF CONTENTS", "SHEET INDEX" at the top?
- Is it primarily a list of what's in the plan set rather than actual construction details?

If YES, mark as: sheetType: "index" OR "toc"
If NO, continue with normal analysis below.

**IMPORTANT:** Index sheets are reference documents only. They list what's in the plan set but typically don't contain the actual detailed measurements or termination points. Users need the ACTUAL drawings (plan/profile sheets) for accurate quantities.

## CRITICAL INFORMATION TO EXTRACT:

### 1. SHEET METADATA
- Sheet number (e.g., "C-001", "SD-1", "INDEX", "I-1")
- Sheet title/description
- Sheet type (index, toc, title, summary, plan, profile, detail, legend)
- Discipline (Civil, Structural, Mechanical, Electrical, etc.)
- Revision number and date
- Project name
- IS THIS AN INDEX SHEET? (true/false)

### 2. TERMINATION POINTS (HIGHEST PRIORITY FOR PLAN/PROFILE SHEETS)
**CRITICAL:** Look for BEGIN and END labels on actual utility alignments:
- "BEGIN WATER LINE 'A'" with station number
- "END WATER LINE 'A' STA 32+62.01" (often rotated 90° along the pipe)
- "BEGIN SD-B" at the start of storm drain
- "END SS-1 STA 45+12.34" at sewer terminus

These labels are THE MOST IMPORTANT data for length calculations. They may be:
- Rotated at any angle (especially 90° along pipes)
- Small font
- At the edges of drawings

For each termination point found, extract:
{
  "utilityName": "Water Line A",
  "terminationType": "BEGIN" or "END",
  "station": "32+62.01",
  "notes": "Any cross-references like '= ROAD A B STA 42+64.00'",
  "confidence": 0.9
}

### 3. QUANTITY TABLES (HIGH PRIORITY FOR TITLE/SUMMARY SHEETS)
Look for tables containing quantities. Common formats:
- Item | Description | Quantity | Unit
- Line Item | Quantity | Unit | Note
- Feature | Station From | Station To | Length
- Material | Amount | Unit

For each quantity found, extract:
- Item name/number (e.g., "Water Line A", "WL-A")
- Description
- Quantity (numeric value)
- Unit (LF, SF, CY, EA, etc.)
- Station range if applicable (e.g., "STA 13+00 to STA 36+00")
- Confidence level (0.0-1.0 based on clarity)
- Source context (is this from an index list or a quantity takeoff table?)

### 4. STATION NUMBERS
Extract ALL station numbers found on the sheet:
- Format: "STA 13+00", "13+68.83", "36+00", etc.
- Location on sheet (top, bottom, left, right, center)
- Context (what feature is at that station)

### 5. SPATIAL INFORMATION
- Does the sheet show a plan view (top-down)?
- Does it show a profile view (side elevation)?
- Alignment direction (North arrow, bearing)
- Key features and their locations

### 6. LABELS AND CALLOUTS
Extract text labels, even if:
- Rotated at any angle (90°, 180°, 270°, vertical)
- Small font size
- Abbreviations or codes

Common labels to look for:
- Line identifiers: "Water Line A", "SD-B", "SS-1"
- Pipe sizes: "8\" PVC", "12\" DI"
- Material callouts: "CL 2 AGGREGATE BASE", "AC PAVEMENT"
- Utility markers: "PROPOSED", "EXISTING", "ABANDON"

### 7. CROSS-REFERENCES
- "See Sheet X"
- "Detail Y/Z"
- "Typical Section A"
- "Match Line - See Sheet X"
- Note references

### 8. DETAIL CALLOUTS
If this is a plan sheet, note any detail callouts (circles with numbers)

### 9. COMPONENT EXTRACTION - EXTRACT FROM PROFILE VIEW ONLY

**CRITICAL: To avoid counting the same component twice, extract components from PROFILE VIEW ONLY (the bottom section with the station scale).**

**PROFILE VIEW IDENTIFICATION:**
- Bottom 30-50% of the sheet
- Shows a horizontal station scale (0+00, 5+00, 10+00, etc.)
- Shows vertical alignment/elevation
- Contains vertical text labels along the utility line

**VERTICAL TEXT LABELS (PRIMARY SOURCE):**

Profile views contain VERTICAL TEXT LABELS showing components along the utility line.

**LABEL CHARACTERISTICS:**
- Text is ROTATED 90 DEGREES (reads from bottom to top or top to bottom)
- Positioned directly on or adjacent to the pipe/utility line
- Format: "[SIZE] [COMPONENT TYPE]" (e.g., "12-IN GATE VALVE")
- NO quantity prefix - each label represents ONE (1) component
- Small font (8-10pt typically)

**COMMON LABELS TO FIND:**
- "12-IN GATE VALVE" or "8-IN GATE VALVE" - gate valves (DIFFERENT SIZES!)
- "12-IN CAP" or "8-IN CAP" - end caps
- "12-IN×8-IN TEE" or "12×8 TEE" - tee fittings
- "FIRE HYDRANT" or "FH" - fire hydrants
- "AIR RELEASE VALVE" or "ARV" - air release valves

**EXTRACTION RULES FOR VERTICAL LABELS:**
1. READ THE ROTATED TEXT even if it appears vertical or at an angle
2. For EACH vertical label found, parse SIZE separately:
   - itemName: Component type only (e.g., "GATE VALVE AND VALVE BOX")
   - size: Size prefix (e.g., "12-IN" or "8-IN") - CRITICAL TO PARSE CORRECTLY
   - quantity: 1 (each label = one component)
   - stationFrom: From the horizontal station scale at bottom
   - sourceContext: "profile_vertical_label"
   - confidence: 0.9+ for clearly readable labels
3. **SIZE PARSING IS CRITICAL:** 12-IN and 8-IN are DIFFERENT components - don't confuse them
4. DO NOT MISS any vertical text - scan the entire profile view systematically

### 10. STATION NUMBER VALIDATION

**VALID STATION FORMAT:** "XX+XX.XX" (e.g., "0+00", "5+23.50", "24+93.06", "32+62.01")

**NOT VALID STATIONS (DO NOT EXTRACT):**
- Offset measurements: "Q/S 24-FT RT", "O/S 27+10.47 RT", "2+16-27 RT"
- Road station references: "ROAD 'A' B STA 40+45.77"
- Match line references: "MATCH LINE - WATER LINE 'A' STA 4+38.83"
- Deflection annotations: "12+00 DEFL"

**STATION DETERMINATION:**
- Look at the label's horizontal position relative to station markers at the bottom of the profile view
- The station scale is the authoritative source
- If you can't determine station clearly, set stationFrom to null rather than guessing

### 11. COMPONENT CALLOUT BOXES (USE IF NO PROFILE LABELS)

Some sheets have callout BOXES listing multiple items at a station.

Example callout box format:
WATER LINE "A" STA 32+44.21
1 - 12-IN X 8-IN TEE
1 - 12-IN GATE VALVE AND VALVE BOX
1 - 8-IN GATE VALVE AND VALVE BOX

**EXTRACTION RULES FOR CALLOUT BOXES:**
- Parse each line SEPARATELY with its own size
- "1 - 12-IN GATE VALVE" → size: "12-IN", itemName: "GATE VALVE"
- "1 - 8-IN GATE VALVE" → size: "8-IN", itemName: "GATE VALVE"
- These are TWO DIFFERENT valves with TWO DIFFERENT sizes
- Station is explicitly shown in the callout header (use this station)
- Mark these with sourceContext: "profile_callout_box"

### 12. WHAT NOT TO EXTRACT

**DO NOT EXTRACT AS COMPONENTS:**
❌ Plan view callout boxes (top section) - they duplicate profile data
❌ Match line text ("MATCH LINE - WATER LINE 'A'...")
❌ Offset measurements (like "Q/S 24-FT RT" or "2+16-27 RT")
❌ Road station references (like "ROAD 'A' B STA XX+XX")
❌ Text in title blocks or borders
❌ Legend items or notes
❌ Quantity summary tables (these aggregate from profile views)

**CRITICAL DEDUPLICATION RULE:**
- If the SAME component appears as BOTH a vertical label AND in a callout box, count it ONLY ONCE
- Prefer the callout box data if it has more detail (quantity, station)
- A valve shown as vertical text "12-IN GATE VALVE" and also in a callout box is ONE valve, not two

**SKIP EXTRACTION FROM:**
- Index/TOC sheets (these list sheets, not actual components)
- Summary quantity tables (these aggregate from profile views - would cause duplicates)
- Plan view only sheets without profile section
- Legend/symbol explanations

## CONTEXTUAL EXTRACTION GUIDELINES

**1. IDENTIFY THE PRIMARY SOURCE:**
- Where are components definitively shown? (usually profile views)
- Are there callout boxes that duplicate this info?
- Extract from the most reliable, least ambiguous source

**2. PARSE SIZES ACCURATELY:**
- Component format: "[SIZE] [TYPE]" (e.g., "12-IN GATE VALVE")
- Size is part of the specification (8-IN ≠ 12-IN)
- Extract size separately from component name

**3. AVOID DUPLICATION:**
- Same component may appear in plan view AND profile view
- Same component may be in a callout box AND shown graphically
- Use judgment: if it looks like the same valve, it probably is

**4. STATION NUMBERS:**
- Best effort to correlate component position with station scale
- If uncertain, note "station unclear" rather than guessing

**5. UTILITY CROSSINGS (STRICT CRITERIA):**
- Require: visual crossing + utility label + reference info
- Usually in profile views
- Be conservative: when in doubt, don't count as crossing
- Typical projects have 0-5 crossings, NOT 20+

**6. CONFIDENCE LEVELS:**
- High (0.9+): Clear, unambiguous extraction
- Medium (0.7-0.9): Reasonable but some uncertainty
- Low (<0.7): Ambiguous, may need verification

**7. SANITY CHECKS:**
- Finding 20+ valves on a simple water line? Re-examine for duplicates
- Same station appearing many times with identical components? Likely duplicates
- Quantities seem unreasonably high? Check sources

`;

  // Add sheet-type-specific instructions
  if (sheetType === 'title' || sheetType === 'summary') {
    prompt += `\n## SPECIAL INSTRUCTIONS FOR TITLE/SUMMARY SHEET:
This appears to be a title or summary sheet. Focus on:
- Sheet index/table of contents
- Legend/abbreviations
- General notes

**DO NOT extract individual component quantities from this sheet** (valves, tees, fittings, etc.)
- These would duplicate the actual profile callouts on other sheets
- Only extract high-level project totals (total length of Water Line A, etc.) if shown
`;
  } else if (sheetType === 'plan') {
    prompt += `\n## SPECIAL INSTRUCTIONS FOR PLAN SHEET:
This appears to be a plan view sheet.

**CRITICAL: CHECK FOR PROFILE VIEW SECTION!**
Many "plan" sheets are actually Plan/Profile combination sheets with:
- PLAN VIEW in the top half
- PROFILE VIEW in the bottom half

**IF THIS SHEET HAS A PROFILE VIEW SECTION:**
You MUST scan the profile section for VERTICAL TEXT LABELS showing components:
- Look for rotated 90° text along the utility line (e.g., "12-IN GATE VALVE")
- Each vertical label = 1 component
- Extract station from horizontal position relative to station markers
- This is the PRIMARY source for valve/fitting counts!

**IF THIS IS PLAN VIEW ONLY:**
- DO NOT extract component quantities from plan view - they will be on profile sheets
- Focus on alignment layouts and general features

Focus also on:
- Station numbers along alignments
- Line labels and identifiers
- Pipe sizes and materials
- Termination points (BEGIN/END labels)
`;
  } else if (sheetType === 'profile') {
    prompt += `\n## SPECIAL INSTRUCTIONS FOR PROFILE SHEET:
This appears to be a profile (elevation) sheet.

### HIGHEST PRIORITY: VERTICAL TEXT LABELS FOR COMPONENTS

**YOU MUST READ ALL VERTICAL/ROTATED TEXT IN THE PROFILE VIEW!**

Profile views show component locations using vertical text labels positioned along the pipe:
- Text is rotated 90° (reads bottom-to-top or top-to-bottom)
- Common labels: "12-IN GATE VALVE", "8-IN GATE VALVE", "12-IN CAP", "12×8 TEE"
- Each label = 1 component (no quantity prefix)
- Station: determined by label's horizontal position relative to station markers

**SCAN THE ENTIRE PROFILE VIEW systematically for vertical text:**
1. Start at the leftmost station and move right
2. Look for ANY text that is rotated/vertical along or near the pipe line
3. Extract EVERY component label you find
4. This is the PRIMARY source for valve and fitting counts!

Focus also on:
- Station numbers (horizontal axis)
- Elevations (vertical axis)
- Existing and proposed grade lines
- Pipe inverts and rim elevations
- Vertical alignments
- **UTILITY CROSSINGS** (see detailed instructions below)

### UTILITY CROSSING DETECTION (STRICT CRITERIA - AVOID FALSE POSITIVES)

**DEFINITION:** A utility crossing is where a DIFFERENT utility physically crosses the main utility line (e.g., Water Line A).

**REQUIRED FOR REAL CROSSING (ALL must be present):**

1. **Location:** In the PROFILE VIEW section (bottom of sheet)
2. **Visual element:** A vertical or diagonal LINE crossing the main utility alignment
3. **Utility label:** Short abbreviation like ELEC, SS, STM, W, GAS, TEL, FO
4. **Reference number:** Number near the label (station reference, coordinate, or depth like "35.73±")
5. **Clearly separate utility:** NOT a component on the main line

**UTILITY ABBREVIATION KEY:**
   - ELEC, E = Electrical
   - SS, S = Sanitary Sewer
   - STM, SD, D = Storm Drain
   - W, WL = Water Line (different water line)
   - GAS, G = Gas Line
   - TEL, T, CATV = Telephone/Telecom/Cable
   - FO = Fiber Optic

**VISUAL PATTERN FOR REAL CROSSING:**
  ELEC        ← Utility type abbreviation
 35.73±       ← Reference number (station/coordinate/depth)
   |          ← Visual crossing line
════╪════      ← Main utility (Water Line A)

**⚠️ DO NOT EXTRACT AS CROSSING:**

❌ **Vertical component labels on the main utility line:**
   Example: "12-IN GATE VALVE", "12-IN CAP", "12×8 TEE"
   These are COMPONENTS, not crossings!

❌ **Match line text at sheet edges:**
   Example: "MATCH LINE - WATER LINE 'A' STA 25+98.02"
   These are sheet continuation references!

❌ **Main utility line labels:**
   Example: "INVERT OF 12-IN WATER", "WATER LINE 'A'"
   These describe the main line itself!

❌ **Plan view utility references:**
   Any utilities shown in the top (plan view) section - only extract from profile

❌ **Component callout boxes:**
   Boxes listing valves, tees, fittings at a station

❌ **Text without a visual crossing line:**
   If there's no line crossing the profile, it's not a crossing

❌ **Text without reference number:**
   Real crossings typically have elevation/depth reference

**VERIFICATION CHECKLIST (before extracting):**
- [ ] Is this in the PROFILE view? (bottom section with elevations)
- [ ] Do I see a vertical/diagonal LINE crossing the main utility?
- [ ] Is there a short utility abbreviation (ELEC, SS, etc.)?
- [ ] Is there a reference number nearby (XX.XX±)?
- [ ] Is this a DIFFERENT utility from the main line?

If ANY answer is NO → DO NOT EXTRACT as crossing.

**CONSERVATIVE APPROACH - THINK CONTEXTUALLY:**
When in doubt, DO NOT extract. False negatives are better than false positives.
Construction plans typically have 0-5 crossings per project. If you find more than 5 on a single sheet, re-verify your extractions.

**REASONING CHECK:** Before finalizing crossing list, ask:
- Does this count make sense for a utility project?
- Did I misinterpret match lines or component labels as crossings?
- Are these DIFFERENT utilities crossing, or the SAME utility being labeled multiple times?

**EXTRACTION FORMAT:**
For valid crossings, extract:
- crossingUtility: The abbreviation (ELEC, SS, STM, etc.)
- utilityFullName: Expanded name (Electrical, Sanitary Sewer)
- station: Station where crossing occurs (from horizontal position)
- elevation: Reference number if present (e.g., 35.73)
- isExisting/isProposed: Based on context
- confidence: Lower (0.7-0.8) unless very clear
`;
  }

  if (customPrompt) {
    prompt += `\n## ADDITIONAL INSTRUCTIONS:\n${customPrompt}\n`;
  }

  prompt += `\n## OUTPUT FORMAT:
Return your analysis as structured JSON with the following schema:

{
  "sheetMetadata": {
    "sheetNumber": "string or null",
    "sheetTitle": "string or null",
    "sheetType": "index|toc|title|summary|plan|profile|detail|legend|unknown",
    "discipline": "string or null",
    "revision": "string or null",
    "date": "string or null",
    "isIndexSheet": boolean
  },
  "terminationPoints": [
    {
      "utilityName": "string (e.g., 'Water Line A')",
      "terminationType": "BEGIN|END|TIE-IN|TERMINUS",
      "station": "string (e.g., '32+62.01')",
      "notes": "string or null",
      "confidence": 0.0 to 1.0
    }
  ],
  "quantities": [
    {
      "itemName": "string",
      "itemNumber": "string or null",
      "quantity": number or null,
      "unit": "string or null",
      "stationFrom": "string or null",
      "stationTo": "string or null",
      "description": "string or null",
      "confidence": 0.0 to 1.0,
      "sourceContext": "string or null (index_list|quantity_table|drawing_label)"
    }
  ],
  "utilityCrossings": [
    {
      "crossingUtility": "string (ELEC|SS|STM|GAS|TEL|W|FO|etc.)",
      "utilityFullName": "string (e.g., 'Electrical', 'Sanitary Sewer')",
      "station": "string or null (e.g., '5+23.50')",
      "elevation": number or null (e.g., 35.73),
      "isExisting": boolean,
      "isProposed": boolean,
      "size": "string or null (e.g., '12-IN')",
      "notes": "string or null",
      "confidence": 0.0 to 1.0
    }
  ],
  "stations": [
    {
      "station": "string (as shown on sheet)",
      "normalizedStation": "string (normalized format)",
      "location": "top|bottom|left|right|center|unknown",
      "context": "string or null (what's at this station)"
    }
  ],
  "spatialInfo": {
    "hasProfileView": boolean,
    "hasPlanView": boolean,
    "hasDetailCallouts": boolean,
    "alignmentDirection": "string or null",
    "keyFeatures": ["array of strings"]
  },
  "crossReferences": [
    {
      "type": "sheet|detail|section|note",
      "reference": "string",
      "description": "string or null"
    }
  ]
}

**EXTRACTION QUALITY STANDARDS:**
- Be thorough but accurate
- If information is not present or unclear, use null
- Set confidence scores honestly based on clarity of the information
- Prefer conservative counts over inflated ones
- Note any duplication concerns in item notes

**SANITY CHECK BEFORE RESPONDING:**
- Do the quantities make sense for this type of project?
- Have I avoided double-counting from multiple sources?
- Are station numbers logically ordered along the alignment?
- For crossings: is the count reasonable (typically 0-5 per project)?

IMPORTANT: Return ONLY the JSON object, no additional text or markdown formatting.`;

  return prompt;
}

/**
 * Normalize station number to comparable format
 */
function normalizeStation(station: string): string {
  // Remove "STA" prefix and spaces
  let normalized = station.replace(/^\s*STA\s*/i, '').trim();
  normalized = normalized.replace(/\s+/g, '');

  // Convert "13+68.83" to "001368.83" for comparison
  if (normalized.includes('+')) {
    const parts = normalized.split('+');
    const major = parts[0].padStart(4, '0');
    const minor = parts[1] || '00';
    return major + minor;
  }

  return normalized;
}

/**
 * Analyze a construction sheet image with Claude Vision
 *
 * @param imageBuffer - Image buffer (PNG or JPEG)
 * @param options - Analysis options
 * @returns Structured analysis result
 */
export async function analyzeSheetWithVision(
  imageBuffer: Buffer,
  options: VisionAnalysisOptions = {}
): Promise<VisionAnalysisResult> {
  const {
    sheetType = 'unknown',
    sheetNumber,
    customPrompt,
    model: userModel,
    taskType = 'extraction', // Default to extraction task (uses Haiku)
    maxTokens = 8192,
    temperature = 0.0
  } = options;

  // Select model: user override > auto-select based on taskType
  const model = userModel || selectVisionModel(taskType);
  const pricing = getModelPricing(model);

  console.log(`[Vision] Using ${model} for ${taskType} task (Input: $${pricing.input}/1M, Output: $${pricing.output}/1M)`);

  const startTime = Date.now();

  try {
    const client = getClaudeClient();

    // Convert image to base64
    const base64Image = imageBuffer.toString('base64');

    // Determine media type from buffer
    const mediaType = imageBuffer.toString('hex', 0, 4).startsWith('89504e47')
      ? 'image/png'
      : 'image/jpeg';

    // Build prompt
    const prompt = buildVisionPrompt(sheetType, sheetNumber, customPrompt);

    // Create message with vision
    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        {
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
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    });

    const latencyMs = Date.now() - startTime;

    // Extract text response
    const textContent = message.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude Vision API');
    }

    const rawAnalysis = textContent.text;

    // Parse JSON response
    let parsedData: any;
    try {
      // Clean up the response - strip markdown code fences if present
      let jsonText = rawAnalysis.trim();

      // Remove markdown code fences (```json ... ``` or ``` ... ```)
      if (jsonText.startsWith('```')) {
        // Find the first newline after opening fence
        const firstNewline = jsonText.indexOf('\n');
        if (firstNewline !== -1) {
          jsonText = jsonText.substring(firstNewline + 1);
        }
        // Remove closing fence
        if (jsonText.endsWith('```')) {
          jsonText = jsonText.substring(0, jsonText.lastIndexOf('```'));
        }
        jsonText = jsonText.trim();
      }

      parsedData = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse vision response as JSON:', parseError);
      console.error('Raw response:', rawAnalysis);
      // Return empty structure if parsing fails
      parsedData = {
        sheetMetadata: {},
        terminationPoints: [],
        quantities: [],
        stations: [],
        spatialInfo: {
          hasProfileView: false,
          hasPlanView: false,
          hasDetailCallouts: false,
          keyFeatures: []
        },
        crossReferences: []
      };
    }

    // Normalize station numbers
    if (parsedData.stations && Array.isArray(parsedData.stations)) {
      parsedData.stations = parsedData.stations.map((sta: any) => ({
        ...sta,
        normalizedStation: sta.station ? normalizeStation(sta.station) : ''
      }));
    }

    // Calculate cost using dynamic pricing based on model
    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;
    const costUsd = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;

    console.log(`[Vision] Tokens used: ${inputTokens} input, ${outputTokens} output | Cost: $${costUsd.toFixed(4)}`);

    return {
      rawAnalysis,
      sheetMetadata: parsedData.sheetMetadata || {},
      terminationPoints: parsedData.terminationPoints || [],
      quantities: parsedData.quantities || [],
      utilityCrossings: parsedData.utilityCrossings || [],
      stations: parsedData.stations || [],
      spatialInfo: parsedData.spatialInfo || {
        hasProfileView: false,
        hasPlanView: false,
        hasDetailCallouts: false,
        keyFeatures: []
      },
      crossReferences: parsedData.crossReferences || [],
      tokensUsed: {
        input: inputTokens,
        output: outputTokens
      },
      costUsd,
      latencyMs
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Vision analysis failed: ${error.message}`);
    }
    throw new Error('Vision analysis failed with unknown error');
  }
}

/**
 * Batch analyze multiple sheets
 *
 * @param sheets - Array of {imageBuffer, options}
 * @param concurrency - Number of concurrent API calls (default: 2)
 * @returns Array of analysis results
 */
export async function analyzeMultipleSheetsWithVision(
  sheets: Array<{ imageBuffer: Buffer; options?: VisionAnalysisOptions }>,
  concurrency: number = 2
): Promise<VisionAnalysisResult[]> {
  const results: VisionAnalysisResult[] = [];

  // Process in batches to control concurrency
  for (let i = 0; i < sheets.length; i += concurrency) {
    const batch = sheets.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(({ imageBuffer, options }) =>
        analyzeSheetWithVision(imageBuffer, options)
      )
    );
    results.push(...batchResults);

    // Small delay between batches to avoid rate limiting
    if (i + concurrency < sheets.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}

/**
 * Estimate cost for analyzing sheets before processing
 *
 * @param numSheets - Number of sheets to analyze
 * @param avgImageSize - Average image size in pixels (default: 2048x2048)
 * @param taskType - Task complexity (determines model selection, default: 'extraction')
 * @returns Estimated cost in USD
 */
export function estimateAnalysisCost(
  numSheets: number,
  avgImageSize: number = 2048 * 2048,
  taskType: VisionTask = 'extraction'
): { estimatedCostUsd: number; model: string; breakdown: any } {
  // Token estimation for images (from Claude docs):
  // - Images up to 200k pixels: ~85 tokens
  // - Images 200k-500k pixels: ~170 tokens
  // - Images 500k-1M pixels: ~340 tokens
  // - Images 1M-2M pixels: ~680 tokens
  // - Images 2M-4M pixels: ~1360 tokens

  let imageTokens: number;
  if (avgImageSize <= 200_000) {
    imageTokens = 85;
  } else if (avgImageSize <= 500_000) {
    imageTokens = 170;
  } else if (avgImageSize <= 1_000_000) {
    imageTokens = 340;
  } else if (avgImageSize <= 2_000_000) {
    imageTokens = 680;
  } else {
    imageTokens = 1360;
  }

  // Prompt tokens (estimated ~1500 tokens for comprehensive prompt)
  const promptTokens = 1500;

  // Output tokens (estimated ~2000 tokens for structured JSON response)
  const outputTokens = 2000;

  const totalInputTokens = (imageTokens + promptTokens) * numSheets;
  const totalOutputTokens = outputTokens * numSheets;

  // Get model and pricing based on task type
  const model = selectVisionModel(taskType);
  const pricing = getModelPricing(model);

  const inputCost = (totalInputTokens / 1_000_000) * pricing.input;
  const outputCost = (totalOutputTokens / 1_000_000) * pricing.output;
  const totalCost = inputCost + outputCost;

  return {
    estimatedCostUsd: totalCost,
    model,
    breakdown: {
      numSheets,
      model,
      pricing: {
        inputPerMillion: pricing.input,
        outputPerMillion: pricing.output
      },
      tokensPerSheet: {
        image: imageTokens,
        prompt: promptTokens,
        output: outputTokens,
        total: imageTokens + promptTokens + outputTokens
      },
      totalTokens: {
        input: totalInputTokens,
        output: totalOutputTokens
      },
      costs: {
        input: inputCost,
        output: outputCost,
        total: totalCost
      }
    }
  };
}
