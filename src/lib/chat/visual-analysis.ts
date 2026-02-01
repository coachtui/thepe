/**
 * Visual Analysis Module for Chat Integration
 *
 * Enables the AI to analyze construction plan sheets visually in real-time
 * during chat conversations. This provides more accurate answers than
 * pre-extracted database data by letting the AI "see" the actual plans.
 *
 * Architecture:
 * 1. User asks question
 * 2. System detects visual analysis is needed
 * 3. Relevant sheets are converted to images
 * 4. Images are provided to Claude in the conversation
 * 5. Claude analyzes visually and responds with accurate data
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/db/supabase/server';
import {
  convertPdfPageToImage,
  type PdfPageImage,
} from '@/lib/vision/pdf-to-image';
import { VISION_MODELS, CONFIDENCE_THRESHOLDS } from '@/lib/vision/constants';

/**
 * Types of visual analysis tasks
 */
export type VisualAnalysisTask =
  | 'count_components'    // Count specific components (valves, fittings, etc.)
  | 'find_crossings'      // Find utility crossings
  | 'verify_length'       // Verify utility length from termination points
  | 'locate_feature'      // Find specific feature location
  | 'general_inspection'; // General visual inspection

/**
 * Visual analysis request
 */
export interface VisualAnalysisRequest {
  projectId: string;
  task: VisualAnalysisTask;
  query: string;
  componentType?: string;   // e.g., "gate valve", "tee", "fire hydrant"
  sizeFilter?: string;      // e.g., "12-IN", "8-IN"
  utilityName?: string;     // e.g., "Water Line A"
  sheetNumbers?: string[];  // Specific sheets to analyze (optional)
}

/**
 * Visual analysis result
 */
export interface VisualAnalysisResult {
  success: boolean;
  sheetsAnalyzed: string[];
  findings: VisualFinding[];
  summary: string;
  totalCount?: number;
  confidence: number;
  reasoning: string;
  costUsd: number;
}

/**
 * Individual finding from visual analysis
 */
export interface VisualFinding {
  sheetNumber: string;
  pageNumber: number;
  description: string;
  count?: number;
  station?: string;
  size?: string;
  confidence: number;
}

/**
 * Sheet info from database
 */
interface SheetInfo {
  id: string;
  filename: string;
  file_path: string;
  page_number?: number;
  sheet_number?: string;
  sheet_type?: string;
}

/**
 * Component keywords for visual analysis triggers
 * Includes: valves, tees, fittings, hydrants, manholes, catch basins, ARVs, deflection couplings, bends
 */
const COMPONENT_KEYWORDS = [
  'valve',
  'tee',
  'fitting',
  'hydrant',
  'cap',
  'plug',
  'bend',
  'elbow',
  'manhole',
  'mh',
  'catch\\s*basin',
  'cb',
  'arv',
  'air\\s*release',
  'defl(ection)?',
  'vert\\s*defl',
  'coupling',
  'reducer',
  'tapping\\s*sleeve',
  'tap\\s*sleeve',
  't\\.?s\\.?',
  'hot\\s*tap',
].join('|');

/**
 * Check if a query requires visual analysis
 */
export function requiresVisualAnalysis(query: string): boolean {
  // Build regex pattern with component keywords
  const componentPattern = new RegExp(`(${COMPONENT_KEYWORDS})`, 'i');

  const visualTriggers = [
    // Component counting with all supported types
    new RegExp(`how many.*(${COMPONENT_KEYWORDS})`, 'i'),
    new RegExp(`count.*(${COMPONENT_KEYWORDS})`, 'i'),
    new RegExp(`number of.*(${COMPONENT_KEYWORDS})`, 'i'),
    new RegExp(`total.*(${COMPONENT_KEYWORDS})`, 'i'),
    new RegExp(`list.*(${COMPONENT_KEYWORDS})`, 'i'),
    new RegExp(`\\d+.?in(ch)?.*(${COMPONENT_KEYWORDS})`, 'i'),

    // Bend angle queries (90º, 45º, 22.5º, 11.25º, ¼, ⅛, etc.)
    /\d+(\.\d+)?\s*[°º]?\s*bend/i,
    /quarter\s*bend|eighth\s*bend/i,
    /[¼⅛]\s*bend/i,
    /1\/16\s*bend|1\/32\s*bend/i,

    // Utility crossings
    /what.*(cross|crossing)/i,
    /utilit(y|ies).*(cross|crossing)/i,
    /find.*crossing/i,
    /list.*crossing/i,

    // Verification requests
    /verify|confirm|check|double.?check/i,
    /actually.*how many/i,
    /correct.*count/i,
    /re.?examine|re.?analyze|look.*again/i,

    // Visual inspection requests
    /can you see/i,
    /look at.*sheet/i,
    /examine.*sheet/i,
    /what.*show/i,
  ];

  return visualTriggers.some((pattern) => pattern.test(query));
}

/**
 * Determine visual analysis task from query
 */
export function determineVisualTask(query: string): VisualAnalysisTask {
  const lowerQuery = query.toLowerCase();

  // Component counting - expanded list including new types
  const componentKeywords = [
    'valve', 'tee', 'fitting', 'hydrant', 'cap', 'plug', 'bend', 'elbow',
    'manhole', 'mh', 'catch basin', 'cb', 'arv', 'air release',
    'deflection', 'defl', 'vert defl', 'coupling', 'reducer', 'component',
    'tapping sleeve', 'tap sleeve', 't.s.', 'hot tap'
  ];

  if (componentKeywords.some(kw => lowerQuery.includes(kw))) {
    return 'count_components';
  }

  // Also check for bend angle patterns
  if (/\d+(\.\d+)?\s*[°º]?\s*bend|quarter\s*bend|eighth\s*bend|[¼⅛]\s*bend|1\/16\s*bend|1\/32\s*bend/i.test(lowerQuery)) {
    return 'count_components';
  }

  if (/cross|crossing|conflict/i.test(lowerQuery)) {
    return 'find_crossings';
  }

  if (/length|termination|begin|end|total.*feet|lf\b/i.test(lowerQuery)) {
    return 'verify_length';
  }

  if (/where|location|find|locate/i.test(lowerQuery)) {
    return 'locate_feature';
  }

  return 'general_inspection';
}

/**
 * Extract component type from query
 */
export function extractComponentType(query: string): string | undefined {
  const patterns = [
    // Specific valve types (check before generic "valve")
    { pattern: /gate\s*valve/i, type: 'gate valve' },
    { pattern: /butterfly\s*valve/i, type: 'butterfly valve' },
    { pattern: /check\s*valve/i, type: 'check valve' },
    { pattern: /air\s*release\s*valve|arv\b/i, type: 'air release valve' },
    { pattern: /blow.?off/i, type: 'blow-off' },

    // Fire hydrant
    { pattern: /fire\s*hydrant|fh\b/i, type: 'fire hydrant' },

    // Manholes
    { pattern: /manhole|\bmh\b|m\.h\./i, type: 'manhole' },

    // Catch basins
    { pattern: /catch\s*basin|\bcb\b|c\.b\.|storm\s*inlet|drain\s*inlet/i, type: 'catch basin' },

    // ARV Tees (specific tee type - check before generic tee)
    { pattern: /arv\s*tee|air\s*release\s*(valve\s*)?tee/i, type: 'arv tee' },

    // Generic tee
    { pattern: /\btee\b/i, type: 'tee' },

    // Deflection couplings
    { pattern: /defl(ection)?\s*coupling|vert(ical)?\s*defl|horiz(ontal)?\s*defl|\bvert\s*defl\b/i, type: 'deflection' },

    // Bends with angle support (90º, 45º, 22.5º, 11.25º, ¼, ⅛, 1/16, 1/32)
    { pattern: /90\s*[°º]?\s*bend|quarter\s*bend|[¼]\s*bend/i, type: '90° bend' },
    { pattern: /45\s*[°º]?\s*bend|eighth\s*bend|[⅛]\s*bend/i, type: '45° bend' },
    { pattern: /22\.?5\s*[°º]?\s*bend|1\/16\s*bend/i, type: '22.5° bend' },
    { pattern: /11\.?25\s*[°º]?\s*bend|1\/32\s*bend/i, type: '11.25° bend' },
    { pattern: /bend|elbow/i, type: 'bend' },

    // Tapping sleeves
    { pattern: /tapping\s*sleeve|tap\s*sleeve|t\.?s\.?\b|hot\s*tap|tapping\s*saddle/i, type: 'tapping sleeve' },

    // Couplings
    { pattern: /coupling|flex\s*coupling/i, type: 'coupling' },

    // Cap and plug
    { pattern: /\bcap\b/i, type: 'cap' },
    { pattern: /\bplug\b/i, type: 'plug' },

    // Generic valve (last - catch-all)
    { pattern: /valve/i, type: 'valve' },
  ];

  for (const { pattern, type } of patterns) {
    if (pattern.test(query)) {
      return type;
    }
  }

  return undefined;
}

/**
 * Extract size filter from query
 */
export function extractSizeFilter(query: string): string | undefined {
  // Match patterns like "12 inch", "12-in", "12-IN", "8 in"
  const sizeMatch = query.match(/(\d+)\s*[-]?\s*in(ch)?/i);
  if (sizeMatch) {
    return `${sizeMatch[1]}-IN`;
  }
  return undefined;
}

/**
 * Extract utility name from query
 */
export function extractUtilityName(query: string): string | undefined {
  const patterns = [
    /water\s*line\s*['"]?([a-z])/i,
    /wl\s*['"]?([a-z])/i,
    /storm\s*drain\s*['"]?([a-z])/i,
    /sd\s*['"]?([a-z])/i,
    /sewer\s*['"]?([a-z])/i,
    /ss\s*['"]?([a-z])/i,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      if (/water|wl/i.test(query)) {
        return `Water Line ${match[1].toUpperCase()}`;
      }
      if (/storm|sd/i.test(query)) {
        return `Storm Drain ${match[1].toUpperCase()}`;
      }
      if (/sewer|ss/i.test(query)) {
        return `Sewer ${match[1].toUpperCase()}`;
      }
    }
  }

  // Generic patterns
  if (/water\s*line/i.test(query)) return 'Water Line';
  if (/storm\s*drain/i.test(query)) return 'Storm Drain';
  if (/sewer/i.test(query)) return 'Sewer';

  return undefined;
}

/**
 * Get relevant sheets for analysis
 */
async function getRelevantSheets(
  projectId: string,
  utilityName?: string
): Promise<SheetInfo[]> {
  const supabase = await createClient();

  // Get all documents for the project
  const { data: documents, error } = await supabase
    .from('documents')
    .select('id, filename, file_path')
    .eq('project_id', projectId)
    .order('filename');

  if (error || !documents) {
    console.error('[Visual Analysis] Error fetching documents:', error);
    return [];
  }

  // For now, return all PDF documents
  // In future, could filter by utility name using document metadata
  const pdfDocuments = documents.filter(
    (doc) => doc.filename.toLowerCase().endsWith('.pdf')
  );

  return pdfDocuments.map((doc, index) => ({
    id: doc.id,
    filename: doc.filename,
    file_path: doc.file_path,
    page_number: index + 1,
    sheet_number: doc.filename.replace('.pdf', ''),
    sheet_type: 'unknown',
  }));
}

/**
 * Convert document pages to images for vision analysis
 */
async function convertSheetsToImages(
  documents: SheetInfo[],
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ sheetNumber: string; image: PdfPageImage; base64: string }[]> {
  const results: { sheetNumber: string; image: PdfPageImage; base64: string }[] = [];

  for (const doc of documents) {
    try {
      // Download PDF from storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('documents')
        .download(doc.file_path);

      if (downloadError || !fileData) {
        console.error(
          `[Visual Analysis] Error downloading ${doc.filename}:`,
          downloadError
        );
        continue;
      }

      // Convert to buffer
      const arrayBuffer = await fileData.arrayBuffer();
      const pdfBuffer = Buffer.from(arrayBuffer);

      // Convert first page to image (most construction sheets are single-page)
      const pageImage = await convertPdfPageToImage(pdfBuffer, 1, {
        scale: 2.0,
        maxWidth: 2048,
        maxHeight: 2048,
        format: 'png',
      });

      results.push({
        sheetNumber: doc.sheet_number || doc.filename,
        image: pageImage,
        base64: pageImage.buffer.toString('base64'),
      });
    } catch (err) {
      console.error(`[Visual Analysis] Error converting ${doc.filename}:`, err);
    }
  }

  return results;
}

/**
 * Build visual analysis prompt based on task
 */
function buildVisualAnalysisPrompt(request: VisualAnalysisRequest): string {
  let prompt = `## VISUAL ANALYSIS TASK

You are analyzing construction plan sheet images. Your goal is to provide accurate, visually-verified information.

**User Question:** ${request.query}

`;

  switch (request.task) {
    case 'count_components':
      prompt += `## COMPONENT COUNTING TASK

**What to count:** ${request.componentType || 'components'}
${request.sizeFilter ? `**Size filter:** ${request.sizeFilter} ONLY (exclude other sizes)` : ''}
${request.utilityName ? `**Utility system:** ${request.utilityName}` : ''}

**COUNTING METHODOLOGY:**

1. **Scan profile views** - Look for vertical text labels along the utility line
   - Labels are often rotated 90 degrees
   - Each label = 1 component (unless quantity prefix like "2 -")

2. **Check callout boxes** - Boxes listing components at specific stations
   - Format: "1 - 12-IN GATE VALVE" (quantity prefix)
   - Parse the quantity number

3. **Avoid double-counting**
   - Same component in profile AND callout = still ONE component
   - Same station with same component = ONE component

4. **Record for each finding:**
   - Sheet number
   - Station (approximate from position)
   - Size (e.g., 12-IN, 8-IN)
   - Component type
   - Quantity

5. **Size filtering is CRITICAL**
${request.sizeFilter ? `   - ONLY count ${request.sizeFilter} components\n   - 8-IN valve is NOT a 12-IN valve - exclude it` : '   - Count all sizes but report breakdown'}

**RESPONSE FORMAT:**

Provide a structured analysis:
- List each sheet examined
- For each sheet, list findings with station/location
- Provide reasoning for count
- Sum total across all sheets
- State confidence level
`;
      break;

    case 'find_crossings':
      prompt += `## UTILITY CROSSING DETECTION TASK

**WHAT DEFINES A CROSSING:**
- A DIFFERENT utility crossing the main line
- Appears in PROFILE VIEW (bottom section with elevations)
- Has utility abbreviation: ELEC, SS, STM, GAS, TEL, W, FO
- Has reference number (elevation, station, or depth)
- Has visual crossing line

**NOT CROSSINGS:**
- Components on the main line (valves, tees, fittings)
- Match line references ("MATCH LINE - WATER LINE A...")
- Main utility's own labels

**DETECTION PROCESS:**
1. Look in profile view section
2. Find utility abbreviation labels
3. Confirm visual crossing element
4. Note station and elevation if shown

**Typical count:** 0-5 crossings per project. If finding more, re-verify.

**RESPONSE FORMAT:**
For each crossing found:
- Sheet number
- Station (from horizontal position)
- Utility type (abbreviation and full name)
- Elevation/depth if shown
- Existing or proposed
`;
      break;

    case 'verify_length':
      prompt += `## LENGTH VERIFICATION TASK

**FINDING TERMINATION POINTS:**
1. Look for "BEGIN [UTILITY NAME]" labels - often at sheet edges
2. Look for "END [UTILITY NAME] STA ###+##.##" labels
3. Labels may be rotated (vertical text along pipe)
4. May be small font at drawing edges

**CALCULATION:**
Length = END station - BEGIN station

Example:
- BEGIN STA 0+00
- END STA 32+62.01
- Length = 3,262.01 LF

**Report:**
- BEGIN station found on which sheet
- END station found on which sheet
- Calculated length
- Confidence level
`;
      break;

    default:
      prompt += `## GENERAL INSPECTION TASK

Examine the provided sheets and answer the user's question accurately.
Describe what you see and provide specific details with sheet references.
`;
  }

  prompt += `

## CRITICAL INSTRUCTIONS

1. **Actually look at the images** - Don't guess or use assumptions
2. **Be accurate** - Only report what you can clearly see
3. **Show your work** - Explain what you found on each sheet
4. **Use confidence levels:**
   - High (0.9+): Clearly visible and unambiguous
   - Medium (0.7-0.9): Visible but some uncertainty
   - Low (<0.7): Partially visible or ambiguous

5. **Sanity check your results**
   - Do quantities seem reasonable?
   - Are stations in logical order?
   - Does the count make sense for this project size?

6. **Report format:** Provide a JSON object with:
{
  "sheetsAnalyzed": ["sheet1", "sheet2", ...],
  "findings": [
    {
      "sheetNumber": "CU102",
      "description": "Found 12-IN GATE VALVE",
      "count": 1,
      "station": "0+00",
      "size": "12-IN",
      "confidence": 0.95
    }
  ],
  "summary": "Brief summary of findings",
  "totalCount": number (if counting task),
  "confidence": overall confidence (0.0-1.0),
  "reasoning": "Explanation of analysis process and any uncertainties"
}
`;

  return prompt;
}

/**
 * Perform visual analysis on construction plan sheets
 */
export async function performVisualAnalysis(
  request: VisualAnalysisRequest
): Promise<VisualAnalysisResult> {
  const startTime = Date.now();
  const supabase = await createClient();

  try {
    // Get relevant sheets
    const sheets = await getRelevantSheets(
      request.projectId,
      request.utilityName
    );

    if (sheets.length === 0) {
      return {
        success: false,
        sheetsAnalyzed: [],
        findings: [],
        summary: 'No sheets found for analysis',
        confidence: 0,
        reasoning: 'No documents available in project',
        costUsd: 0,
      };
    }

    // Limit to first 8 sheets for cost control (can be adjusted)
    const sheetsToAnalyze = sheets.slice(0, 8);

    console.log(
      `[Visual Analysis] Converting ${sheetsToAnalyze.length} sheets to images...`
    );

    // Convert sheets to images
    const sheetImages = await convertSheetsToImages(sheetsToAnalyze, supabase);

    if (sheetImages.length === 0) {
      return {
        success: false,
        sheetsAnalyzed: [],
        findings: [],
        summary: 'Failed to convert sheets to images',
        confidence: 0,
        reasoning: 'Image conversion failed for all sheets',
        costUsd: 0,
      };
    }

    console.log(
      `[Visual Analysis] Analyzing ${sheetImages.length} sheets with Claude Vision...`
    );

    // Build the prompt
    const analysisPrompt = buildVisualAnalysisPrompt(request);

    // Create Claude client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Build message with images
    const imageContent = sheetImages.map((sheet, index) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: sheet.base64,
      },
    }));

    // Add sheet labels
    const sheetLabels = sheetImages
      .map((sheet, index) => `Image ${index + 1}: ${sheet.sheetNumber}`)
      .join('\n');

    // Send to Claude Vision
    const response = await anthropic.messages.create({
      model: VISION_MODELS.SONNET_4_5, // Use Sonnet for complex visual reasoning
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            {
              type: 'text',
              text: `**Sheet Images Provided:**\n${sheetLabels}\n\n${analysisPrompt}`,
            },
          ],
        },
      ],
    });

    // Extract response text
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON response
    let parsedResult: any;
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      let jsonText = textContent.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      parsedResult = JSON.parse(jsonText);
    } catch {
      // If JSON parsing fails, create result from text
      parsedResult = {
        sheetsAnalyzed: sheetImages.map((s) => s.sheetNumber),
        findings: [],
        summary: textContent.text,
        confidence: 0.7,
        reasoning: 'Response was not structured JSON - raw analysis provided',
      };
    }

    // Calculate cost
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd =
      (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0;

    const analysisTimeMs = Date.now() - startTime;
    console.log(
      `[Visual Analysis] Complete in ${analysisTimeMs}ms | Cost: $${costUsd.toFixed(4)}`
    );

    return {
      success: true,
      sheetsAnalyzed: parsedResult.sheetsAnalyzed || sheetImages.map((s) => s.sheetNumber),
      findings: parsedResult.findings || [],
      summary: parsedResult.summary || 'Analysis complete',
      totalCount: parsedResult.totalCount,
      confidence: parsedResult.confidence || 0.8,
      reasoning: parsedResult.reasoning || 'Visual analysis completed',
      costUsd,
    };
  } catch (error) {
    console.error('[Visual Analysis] Error:', error);
    return {
      success: false,
      sheetsAnalyzed: [],
      findings: [],
      summary: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      confidence: 0,
      reasoning: 'An error occurred during visual analysis',
      costUsd: 0,
    };
  }
}

/**
 * Format visual analysis result for chat context
 */
export function formatVisualAnalysisForChat(
  result: VisualAnalysisResult
): string {
  if (!result.success) {
    return `**Visual Analysis Failed**\n${result.summary}`;
  }

  let output = `**VISUAL ANALYSIS RESULTS**\n\n`;
  output += `Sheets Analyzed: ${result.sheetsAnalyzed.join(', ')}\n\n`;

  if (result.findings.length > 0) {
    output += `**Findings:**\n`;
    output += `| Sheet | Station | Size | Description | Count | Confidence |\n`;
    output += `|-------|---------|------|-------------|-------|------------|\n`;

    for (const finding of result.findings) {
      output += `| ${finding.sheetNumber} | ${finding.station || 'N/A'} | ${finding.size || 'N/A'} | ${finding.description} | ${finding.count || 1} | ${(finding.confidence * 100).toFixed(0)}% |\n`;
    }
    output += '\n';
  }

  if (result.totalCount !== undefined) {
    output += `**Total Count:** ${result.totalCount}\n\n`;
  }

  output += `**Summary:** ${result.summary}\n\n`;
  output += `**Reasoning:** ${result.reasoning}\n\n`;
  output += `**Overall Confidence:** ${(result.confidence * 100).toFixed(0)}%\n`;

  return output;
}

/**
 * Build messages with sheet images for Claude conversation
 * This is used when we want to include images directly in the chat flow
 */
export async function buildMessagesWithSheetImages(
  projectId: string,
  userQuery: string,
  maxSheets: number = 5
): Promise<{
  success: boolean;
  messages: Array<{
    role: 'user';
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >;
  }>;
  sheetsIncluded: string[];
  error?: string;
}> {
  const supabase = await createClient();

  try {
    // Get relevant sheets
    const sheets = await getRelevantSheets(projectId);
    const sheetsToInclude = sheets.slice(0, maxSheets);

    if (sheetsToInclude.length === 0) {
      return {
        success: false,
        messages: [],
        sheetsIncluded: [],
        error: 'No sheets found in project',
      };
    }

    // Convert sheets to images
    const sheetImages = await convertSheetsToImages(sheetsToInclude, supabase);

    if (sheetImages.length === 0) {
      return {
        success: false,
        messages: [],
        sheetsIncluded: [],
        error: 'Failed to convert sheets to images',
      };
    }

    // Build message content with images
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }
    > = [];

    // Add sheet label text
    const sheetLabels = sheetImages
      .map((sheet, index) => `Sheet ${index + 1}: ${sheet.sheetNumber}`)
      .join('\n');

    content.push({
      type: 'text',
      text: `**Construction Plan Sheets Provided for Visual Analysis:**\n${sheetLabels}\n\n**Your Question:** ${userQuery}`,
    });

    // Add images
    for (const sheet of sheetImages) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: sheet.base64,
        },
      });
    }

    return {
      success: true,
      messages: [{ role: 'user', content }],
      sheetsIncluded: sheetImages.map((s) => s.sheetNumber),
    };
  } catch (error) {
    return {
      success: false,
      messages: [],
      sheetsIncluded: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
