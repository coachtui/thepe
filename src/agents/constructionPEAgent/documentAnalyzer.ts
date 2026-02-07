/**
 * Construction Document Analyzer
 * 
 * Combines structured data extraction (your existing vision code)
 * with PE-level interpretation and recommendations.
 * 
 * This is what actually reads plans and specs - not just talks about them.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ProjectContext } from './types';
import { 
  CONTRACT_MINDSET, 
  WORK_TYPE_KNOWLEDGE,
  COMMON_SPEC_SECTIONS 
} from './domainKnowledge';

// ============================================================================
// TYPES FOR DOCUMENT ANALYSIS
// ============================================================================

export interface SheetAnalysisResult {
  // Sheet identification
  sheet: {
    number: string | null;
    title: string | null;
    type: 'index' | 'toc' | 'title' | 'summary' | 'plan' | 'profile' | 'plan_profile' | 'detail' | 'legend' | 'cross_section' | 'unknown';
    discipline: 'civil' | 'structural' | 'mechanical' | 'electrical' | 'landscape' | 'unknown';
    revision: string | null;
    date: string | null;
  };

  // Alignment/utility information
  alignment: {
    name: string | null;           // e.g., "Water Line A", "Road B"
    type: 'water' | 'sewer' | 'storm' | 'gas' | 'electric' | 'road' | 'other' | null;
    beginStation: string | null;   // e.g., "0+00"
    endStation: string | null;     // e.g., "24+93.06"
    totalLength: number | null;    // Calculated LF
    material: string | null;       // e.g., "12-IN DI CL 52"
    size: string | null;           // e.g., "12-IN"
  };

  // Extracted components (valves, fittings, structures)
  components: ExtractedComponent[];

  // Utility crossings found
  crossings: UtilityCrossing[];

  // Station markers found
  stations: StationMarker[];

  // Quantities summary
  quantities: QuantitySummary[];

  // Cross-references to other sheets
  references: SheetReference[];

  // PE interpretation
  peAnalysis: {
    summary: string;
    concerns: string[];
    missingInfo: string[];
    fieldVerification: string[];
    estimatingNotes: string[];
  };

  // Extraction metadata
  meta: {
    model: string;
    tokensUsed: { input: number; output: number };
    costUsd: number;
    confidence: 'high' | 'medium' | 'low';
    extractionNotes: string[];
  };
}

export interface ExtractedComponent {
  name: string;              // e.g., "GATE VALVE AND VALVE BOX"
  size: string | null;       // e.g., "12-IN"
  quantity: number;
  station: string | null;    // e.g., "5+23.50"
  offset: string | null;     // e.g., "15 FT LT"
  notes: string | null;
  source: 'profile_label' | 'callout_box' | 'plan_view' | 'quantity_table' | 'legend';
  confidence: number;        // 0.0 to 1.0
}

export interface UtilityCrossing {
  utilityType: string;       // e.g., "ELEC", "SS", "GAS"
  utilityName: string;       // e.g., "Electrical", "Sanitary Sewer"
  station: string | null;
  elevation: number | null;
  depth: number | null;
  isExisting: boolean;
  isProposed: boolean;
  size: string | null;
  owner: string | null;      // e.g., "Hawaiian Electric"
  notes: string | null;
  confidence: number;
}

export interface StationMarker {
  station: string;           // As shown: "15+00"
  normalized: number;        // As number: 1500.00
  feature: string | null;    // What's at this station
  elevation: number | null;  // If shown
}

export interface QuantitySummary {
  item: string;
  description: string | null;
  quantity: number | null;
  unit: string;
  stationRange: string | null;  // e.g., "STA 0+00 to 24+93"
  unitCost: number | null;      // If we can estimate
  extendedCost: number | null;
  notes: string | null;
}

export interface SheetReference {
  type: 'match_line' | 'detail' | 'section' | 'see_sheet' | 'spec';
  reference: string;         // e.g., "C-006", "Detail A/C-010", "Section 33 10 00"
  description: string | null;
  station: string | null;    // Where the reference applies
}

// ============================================================================
// EXTRACTION PROMPTS - THE REAL MAGIC
// ============================================================================

/**
 * Build extraction prompt based on detected sheet type
 */
function buildExtractionPrompt(
  sheetType: string,
  projectContext?: Partial<ProjectContext>
): string {
  
  const basePrompt = `You are a senior construction estimator and project engineer analyzing a construction drawing. Your job is to extract ACCURATE, VERIFIABLE data that can be used for:
- Quantity takeoffs and bidding
- Progress payment tracking
- Change order documentation
- Field verification

## CRITICAL RULES

1. **ACCURACY OVER COMPLETENESS** - Only extract what you can clearly read. If uncertain, mark confidence as low or skip.

2. **NO HALLUCINATION** - If you can't see it clearly, don't make it up. An estimator will use this data for pricing.

3. **SOURCE TRACKING** - Always note WHERE you found each piece of data (profile view, callout box, table, etc.)

4. **DEDUPLICATION** - The same component often appears in multiple places. Count it ONCE from the most reliable source.

5. **STATION VALIDATION** - Stations follow the format XX+XX.XX. Reject anything that doesn't match (offsets, road references, match lines).

## STEP 1: IDENTIFY THE SHEET

First, determine:
- Sheet number (usually in title block, bottom right)
- Sheet title
- Sheet type (see categories below)
- Discipline (Civil, Structural, etc.)
- Revision and date

**Sheet Type Categories:**
- INDEX/TOC: Lists other sheets, no construction details
- TITLE: Project info, location map, general notes
- SUMMARY: Quantity tables, bid item summaries
- PLAN: Top-down view of alignment/layout
- PROFILE: Side elevation view with station scale
- PLAN_PROFILE: Both views on same sheet (common for utilities)
- DETAIL: Enlarged views of specific elements
- CROSS_SECTION: Typical sections through alignment
- LEGEND: Symbol definitions

## STEP 2: IDENTIFY THE ALIGNMENT

For utility/road sheets, identify:
- Alignment name (e.g., "WATER LINE 'A'", "ROAD B")
- Type (water, sewer, storm, road, etc.)
- Begin station (look for "BEGIN [NAME]" label)
- End station (look for "END [NAME]" label)
- Pipe/road material and size
- Calculate total length from stations

## STEP 3: EXTRACT COMPONENTS

**For PROFILE or PLAN_PROFILE sheets, extract from PROFILE VIEW ONLY:**

The profile view is typically the bottom 30-50% of the sheet showing:
- Horizontal station scale (0+00, 5+00, 10+00...)
- Vertical elevation scale
- The utility/road alignment as a line

**Look for VERTICAL TEXT LABELS along the alignment:**
- Text rotated 90° (reads bottom-to-top or top-to-bottom)
- Format: "[SIZE] [COMPONENT]" (e.g., "12-IN GATE VALVE")
- Each label = 1 component (no quantity prefix)
- Station = horizontal position on the scale

**Common components to find:**
- Gate valves (note sizes separately: 12-IN vs 8-IN are different!)
- Tees and crosses (note size combinations: 12×8 TEE)
- Bends/elbows (note degree: 45° BEND, 90° BEND)
- Reducers (note sizes: 12×8 REDUCER)
- Caps and plugs
- Fire hydrant assemblies
- Air release valves / blow-offs
- Manholes (with depth)
- Cleanouts
- Service connections

**CALLOUT BOXES** (rectangles with component lists):
\`\`\`
WATER LINE "A" STA 15+23.50
1 - 12-IN × 8-IN TEE
1 - 12-IN GATE VALVE AND VALVE BOX
1 - 8-IN GATE VALVE AND VALVE BOX
\`\`\`
- Station is in the header
- Each line is one component with explicit quantity
- Parse sizes carefully

## STEP 4: IDENTIFY UTILITY CROSSINGS

**Crossings are where OTHER utilities cross the main alignment.**

**REQUIRED for a valid crossing (ALL must be present):**
1. In PROFILE VIEW (not plan view)
2. Visual line crossing the alignment
3. Utility abbreviation (ELEC, SS, STM, GAS, TEL, W, FO)
4. Reference number (elevation, depth, or station)

**Utility abbreviations:**
- ELEC, E = Electrical
- SS, S = Sanitary Sewer  
- STM, SD, D = Storm Drain
- W, WL = Water (different line)
- GAS, G = Gas
- TEL, T, CATV = Telecom
- FO = Fiber Optic

**NOT crossings (DO NOT EXTRACT):**
- Vertical component labels (valves, fittings on main line)
- Match line text
- Main alignment labels
- Plan view utility references
- Text without crossing line

## STEP 5: NOTE STATION MARKERS

Extract all stations shown with:
- Station value (as shown)
- What feature is at that station (if any)
- Elevation (if shown)

## STEP 6: CROSS-REFERENCES

Note any references to:
- Other sheets ("SEE SHEET C-006", "MATCH LINE")
- Details ("DETAIL A/C-010")
- Specifications ("PER SECTION 33 10 00")

## STEP 7: PE ANALYSIS

After extraction, provide your professional assessment:

1. **Summary**: One paragraph describing what this sheet shows

2. **Concerns**: Any issues you notice:
   - Conflicts between plan and profile
   - Unusual details
   - Missing information
   - Constructability concerns

3. **Missing Information**: What would you need to complete a takeoff?
   - Missing termination points
   - Unclear pipe materials
   - Missing valve sizes
   - Undefined details

4. **Field Verification**: What should be checked in the field?
   - Existing utility locations
   - Depth conflicts
   - Access concerns

5. **Estimating Notes**: Tips for pricing this work
   - Unusual conditions
   - Long-lead items
   - Potential extras
`;

  // Add sheet-type specific instructions
  let typeSpecific = '';
  
  if (sheetType === 'profile' || sheetType === 'plan_profile') {
    typeSpecific = `
## PROFILE-SPECIFIC EXTRACTION

**MANDATORY: Scan the entire profile view systematically from left to right.**

1. Start at the leftmost station
2. Move right along the alignment
3. Read EVERY piece of vertical/rotated text
4. For each component found:
   - Parse the size (12-IN, 8-IN, etc.) - THIS IS CRITICAL
   - Parse the component type
   - Determine station from horizontal position
   - Set confidence based on readability

**Size parsing examples:**
- "12-IN GATE VALVE" → size: "12-IN", name: "GATE VALVE"
- "8-IN GATE VALVE" → size: "8-IN", name: "GATE VALVE"  
- "12×8 TEE" or "12-IN×8-IN TEE" → size: "12×8", name: "TEE"

**These are DIFFERENT components - do not combine:**
- 12-IN GATE VALVE ≠ 8-IN GATE VALVE
- 12×8 TEE ≠ 12×6 TEE
`;
  } else if (sheetType === 'summary' || sheetType === 'title') {
    typeSpecific = `
## SUMMARY/TITLE SHEET EXTRACTION

**Focus on quantity tables and bid item summaries.**

Look for tables with columns like:
- Item | Description | Quantity | Unit
- Bid Item | Quantity | Unit | Unit Price | Extended

Extract each line item with:
- Item number/name
- Description
- Quantity (numeric value)
- Unit (LF, SF, CY, EA, LS, etc.)

**DO NOT extract individual components** (valves, fittings) from summary sheets - these aggregate data from profile sheets and would cause double-counting.

**DO extract:**
- Total pipe lengths by type/size
- Total structure counts
- Lump sum items
- Allowance items
`;
  }

  const outputFormat = `
## OUTPUT FORMAT

Return a JSON object with this exact structure:

\`\`\`json
{
  "sheet": {
    "number": "C-005" | null,
    "title": "WATER LINE 'A' PLAN & PROFILE STA 0+00 TO STA 12+50" | null,
    "type": "plan_profile",
    "discipline": "civil",
    "revision": "2" | null,
    "date": "2024-01-15" | null
  },
  "alignment": {
    "name": "WATER LINE 'A'" | null,
    "type": "water",
    "beginStation": "0+00" | null,
    "endStation": "24+93.06" | null,
    "totalLength": 2493.06 | null,
    "material": "DUCTILE IRON CL 52" | null,
    "size": "12-IN" | null
  },
  "components": [
    {
      "name": "GATE VALVE AND VALVE BOX",
      "size": "12-IN",
      "quantity": 1,
      "station": "5+23.50",
      "offset": null,
      "notes": null,
      "source": "profile_label",
      "confidence": 0.95
    }
  ],
  "crossings": [
    {
      "utilityType": "ELEC",
      "utilityName": "Electrical",
      "station": "8+45",
      "elevation": 35.73,
      "depth": null,
      "isExisting": true,
      "isProposed": false,
      "size": null,
      "owner": null,
      "notes": "Overhead crossing",
      "confidence": 0.85
    }
  ],
  "stations": [
    {
      "station": "0+00",
      "normalized": 0,
      "feature": "BEGIN WATER LINE 'A'",
      "elevation": 42.5
    }
  ],
  "quantities": [
    {
      "item": "12-IN DI WATER MAIN",
      "description": "Ductile iron water main, Class 52",
      "quantity": 2493,
      "unit": "LF",
      "stationRange": "STA 0+00 TO 24+93.06",
      "unitCost": null,
      "extendedCost": null,
      "notes": null
    }
  ],
  "references": [
    {
      "type": "match_line",
      "reference": "C-006",
      "description": "MATCH LINE - WATER LINE 'A' STA 12+50",
      "station": "12+50"
    }
  ],
  "peAnalysis": {
    "summary": "Sheet C-005 shows the first 1,250 LF of Water Line 'A', a 12-inch ductile iron main. The profile indicates relatively flat terrain with one electrical crossing.",
    "concerns": [
      "Profile shows only 4.5' cover at STA 3+00 - verify minimum cover requirement",
      "Electrical crossing at STA 8+45 shows overhead but plans should verify clearance"
    ],
    "missingInfo": [
      "Thrust restraint details not shown - see details sheet",
      "Service connection locations not indicated on this sheet"
    ],
    "fieldVerification": [
      "Pothole existing electrical at STA 8+45 before excavation",
      "Verify cover depth at low point STA 3+00"
    ],
    "estimatingNotes": [
      "Standard depth section - no unusual excavation expected",
      "Count fittings from profile: 2x 12-IN GV, 1x 12×8 TEE, 1x FH assembly"
    ]
  },
  "meta": {
    "confidence": "high",
    "extractionNotes": [
      "All vertical labels clearly readable",
      "Station scale consistent at 1\"=20'"
    ]
  }
}
\`\`\`

**IMPORTANT:** Return ONLY the JSON object. No markdown formatting, no additional text.
`;

  return basePrompt + typeSpecific + outputFormat;
}

/**
 * Build spec analysis prompt
 */
function buildSpecAnalysisPrompt(specSection?: string): string {
  return `You are a senior construction project engineer analyzing a specification section. Extract the key requirements that affect:
- Material procurement and submittals
- Installation methods and QC
- Testing and acceptance criteria
- Measurement and payment

${specSection ? `This appears to be Section ${specSection}.` : ''}

## EXTRACT:

1. **Scope**: What work is covered
2. **Materials**: Required materials with standards (ASTM, AWWA, etc.)
3. **Submittals**: What must be submitted for approval
4. **Installation Requirements**: Key installation criteria
5. **Testing**: Required tests and acceptance criteria
6. **Measurement**: How quantities are measured
7. **Payment**: What's included in the bid item
8. **Special Requirements**: Unusual or project-specific items

## PE NOTES:

After extraction, provide:
- Common issues with this spec section
- Items that typically cause disputes
- What to clarify via RFI before bidding
- Long-lead procurement items

Return as structured JSON.`;
}

// ============================================================================
// MAIN DOCUMENT ANALYZER CLASS  
// ============================================================================

export class ConstructionDocumentAnalyzer {
  private client: Anthropic;
  private projectContext?: Partial<ProjectContext>;
  private debug: boolean;

  constructor(config: {
    apiKey: string;
    projectContext?: Partial<ProjectContext>;
    debug?: boolean;
  }) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.projectContext = config.projectContext;
    this.debug = config.debug || false;
  }

  /**
   * Analyze a construction plan sheet
   */
  async analyzeSheet(
    imageBuffer: Buffer,
    options?: {
      sheetType?: SheetAnalysisResult['sheet']['type'];
      sheetNumber?: string;
      focusAreas?: string[];
    }
  ): Promise<SheetAnalysisResult> {
    const startTime = Date.now();
    
    // Convert image
    const base64Image = imageBuffer.toString('base64');
    const mediaType = this.detectMediaType(imageBuffer);

    // First pass: Quick classification if sheet type unknown
    let sheetType = options?.sheetType || 'unknown';
    if (sheetType === 'unknown') {
      sheetType = await this.classifySheet(base64Image, mediaType);
    }

    if (this.debug) {
      console.log(`[DocAnalyzer] Analyzing ${sheetType} sheet`);
    }

    // Build extraction prompt
    const prompt = buildExtractionPrompt(sheetType, this.projectContext);

    // Add focus areas if specified
    let fullPrompt = prompt;
    if (options?.focusAreas?.length) {
      fullPrompt += `\n\n## FOCUS AREAS\nPay particular attention to: ${options.focusAreas.join(', ')}`;
    }

    // Call Claude
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-5-20250929', // Use Sonnet for accuracy on extraction
      max_tokens: 8192,
      temperature: 0.1, // Low temperature for factual extraction
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
          { type: 'text', text: fullPrompt }
        ]
      }]
    });

    // Parse response
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const rawResponse = textContent.text;
    let parsed: any;

    try {
      // Clean up response
      let jsonText = rawResponse.trim();
      if (jsonText.startsWith('```')) {
        const firstNewline = jsonText.indexOf('\n');
        jsonText = jsonText.substring(firstNewline + 1);
        if (jsonText.endsWith('```')) {
          jsonText = jsonText.substring(0, jsonText.lastIndexOf('```'));
        }
        jsonText = jsonText.trim();
      }
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.error('[DocAnalyzer] Failed to parse response:', rawResponse);
      throw new Error('Failed to parse extraction response as JSON');
    }

    // Calculate cost
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd = (inputTokens / 1_000_000) * 3.00 + (outputTokens / 1_000_000) * 15.00;

    if (this.debug) {
      console.log(`[DocAnalyzer] Completed in ${Date.now() - startTime}ms`);
      console.log(`[DocAnalyzer] Tokens: ${inputTokens} in, ${outputTokens} out`);
      console.log(`[DocAnalyzer] Cost: $${costUsd.toFixed(4)}`);
      console.log(`[DocAnalyzer] Found ${parsed.components?.length || 0} components, ${parsed.crossings?.length || 0} crossings`);
    }

    // Build result
    const result: SheetAnalysisResult = {
      sheet: parsed.sheet || {
        number: options?.sheetNumber || null,
        title: null,
        type: sheetType,
        discipline: 'unknown',
        revision: null,
        date: null
      },
      alignment: parsed.alignment || {
        name: null,
        type: null,
        beginStation: null,
        endStation: null,
        totalLength: null,
        material: null,
        size: null
      },
      components: this.normalizeComponents(parsed.components || []),
      crossings: parsed.crossings || [],
      stations: this.normalizeStations(parsed.stations || []),
      quantities: this.buildQuantitySummary(parsed),
      references: parsed.references || [],
      peAnalysis: parsed.peAnalysis || {
        summary: '',
        concerns: [],
        missingInfo: [],
        fieldVerification: [],
        estimatingNotes: []
      },
      meta: {
        model: 'claude-sonnet-4-5-20250929',
        tokensUsed: { input: inputTokens, output: outputTokens },
        costUsd,
        confidence: this.assessConfidence(parsed),
        extractionNotes: parsed.meta?.extractionNotes || []
      }
    };

    return result;
  }

  /**
   * Analyze multiple sheets and combine results
   */
  async analyzeSheetSet(
    sheets: Array<{ buffer: Buffer; sheetNumber?: string }>,
    options?: {
      concurrency?: number;
      combineResults?: boolean;
    }
  ): Promise<{
    sheets: SheetAnalysisResult[];
    combined?: {
      totalComponents: ExtractedComponent[];
      totalCrossings: UtilityCrossing[];
      quantitySummary: QuantitySummary[];
      allConcerns: string[];
    };
  }> {
    const concurrency = options?.concurrency || 2;
    const results: SheetAnalysisResult[] = [];

    // Process in batches
    for (let i = 0; i < sheets.length; i += concurrency) {
      const batch = sheets.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(s => this.analyzeSheet(s.buffer, { sheetNumber: s.sheetNumber }))
      );
      results.push(...batchResults);

      // Rate limiting delay
      if (i + concurrency < sheets.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Combine if requested
    let combined;
    if (options?.combineResults) {
      combined = this.combineSheetResults(results);
    }

    return { sheets: results, combined };
  }

  /**
   * Analyze a specification section
   */
  async analyzeSpec(
    specText: string,
    options?: {
      sectionNumber?: string;
      focusAreas?: string[];
    }
  ): Promise<{
    section: string;
    scope: string;
    materials: Array<{ item: string; standard: string; notes?: string }>;
    submittals: string[];
    installation: string[];
    testing: Array<{ test: string; criteria: string; frequency?: string }>;
    measurement: string;
    payment: string;
    peNotes: {
      commonIssues: string[];
      disputeRisks: string[];
      rfiCandidates: string[];
      longLeadItems: string[];
    };
  }> {
    const prompt = buildSpecAnalysisPrompt(options?.sectionNumber);

    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001', // Haiku is fine for text analysis
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: `${prompt}\n\n---\n\nSPECIFICATION TEXT:\n\n${specText}`
      }]
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No response from spec analysis');
    }

    // Parse and return
    try {
      let jsonText = textContent.text.trim();
      if (jsonText.startsWith('```')) {
        const firstNewline = jsonText.indexOf('\n');
        jsonText = jsonText.substring(firstNewline + 1);
        if (jsonText.endsWith('```')) {
          jsonText = jsonText.substring(0, jsonText.lastIndexOf('```'));
        }
      }
      return JSON.parse(jsonText);
    } catch {
      // Return structured response even if parsing fails
      return {
        section: options?.sectionNumber || 'Unknown',
        scope: textContent.text,
        materials: [],
        submittals: [],
        installation: [],
        testing: [],
        measurement: '',
        payment: '',
        peNotes: {
          commonIssues: [],
          disputeRisks: [],
          rfiCandidates: [],
          longLeadItems: []
        }
      };
    }
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  private detectMediaType(buffer: Buffer): 'image/png' | 'image/jpeg' {
    return buffer.toString('hex', 0, 4).startsWith('89504e47') 
      ? 'image/png' 
      : 'image/jpeg';
  }

  private async classifySheet(
    base64Image: string, 
    mediaType: string
  ): Promise<SheetAnalysisResult['sheet']['type']> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001', // Quick classification
      max_tokens: 100,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Image }
          },
          {
            type: 'text',
            text: `Classify this construction drawing. Reply with ONLY one word from: index, toc, title, summary, plan, profile, plan_profile, detail, cross_section, legend, unknown`
          }
        ]
      }]
    });

    const text = response.content.find(c => c.type === 'text');
    if (text && text.type === 'text') {
      const type = text.text.trim().toLowerCase();
      if (['index', 'toc', 'title', 'summary', 'plan', 'profile', 'plan_profile', 'detail', 'cross_section', 'legend'].includes(type)) {
        return type as SheetAnalysisResult['sheet']['type'];
      }
    }
    return 'unknown';
  }

  private normalizeComponents(components: any[]): ExtractedComponent[] {
    const seen = new Map<string, ExtractedComponent>();

    for (const c of components) {
      // Create unique key for deduplication
      const key = `${c.name}-${c.size}-${c.station}`;
      
      if (!seen.has(key)) {
        seen.set(key, {
          name: c.name || 'UNKNOWN',
          size: c.size || null,
          quantity: c.quantity || 1,
          station: c.station || null,
          offset: c.offset || null,
          notes: c.notes || null,
          source: c.source || 'profile_label',
          confidence: c.confidence || 0.8
        });
      } else {
        // If duplicate, keep higher confidence version
        const existing = seen.get(key)!;
        if ((c.confidence || 0) > existing.confidence) {
          seen.set(key, { ...existing, ...c });
        }
      }
    }

    return Array.from(seen.values());
  }

  private normalizeStations(stations: any[]): StationMarker[] {
    return stations.map(s => ({
      station: s.station,
      normalized: this.stationToNumber(s.station),
      feature: s.feature || null,
      elevation: s.elevation || null
    })).sort((a, b) => a.normalized - b.normalized);
  }

  private stationToNumber(station: string): number {
    // Convert "15+23.50" to 1523.50
    const match = station.match(/(\d+)\+(\d+\.?\d*)/);
    if (match) {
      return parseInt(match[1]) * 100 + parseFloat(match[2]);
    }
    return 0;
  }

  private buildQuantitySummary(parsed: any): QuantitySummary[] {
    const quantities: QuantitySummary[] = [];

    // Add alignment length if available
    if (parsed.alignment?.totalLength && parsed.alignment?.size) {
      quantities.push({
        item: `${parsed.alignment.size} ${parsed.alignment.type?.toUpperCase() || ''} MAIN`.trim(),
        description: parsed.alignment.material,
        quantity: parsed.alignment.totalLength,
        unit: 'LF',
        stationRange: parsed.alignment.beginStation && parsed.alignment.endStation
          ? `STA ${parsed.alignment.beginStation} TO ${parsed.alignment.endStation}`
          : null,
        unitCost: null,
        extendedCost: null,
        notes: null
      });
    }

    // Aggregate components by type and size
    const componentCounts = new Map<string, { count: number; size: string | null }>();
    for (const c of (parsed.components || [])) {
      const key = `${c.size || ''} ${c.name}`.trim();
      const existing = componentCounts.get(key) || { count: 0, size: c.size };
      existing.count += c.quantity || 1;
      componentCounts.set(key, existing);
    }

    for (const [item, data] of componentCounts) {
      quantities.push({
        item,
        description: null,
        quantity: data.count,
        unit: 'EA',
        stationRange: null,
        unitCost: null,
        extendedCost: null,
        notes: null
      });
    }

    return quantities;
  }

  private assessConfidence(parsed: any): 'high' | 'medium' | 'low' {
    // Assess based on extraction completeness
    let score = 0;

    if (parsed.sheet?.number) score += 2;
    if (parsed.sheet?.type && parsed.sheet.type !== 'unknown') score += 2;
    if (parsed.alignment?.name) score += 2;
    if (parsed.alignment?.beginStation && parsed.alignment?.endStation) score += 3;
    if ((parsed.components?.length || 0) > 0) score += 2;
    
    // Check average component confidence
    const avgConfidence = parsed.components?.length 
      ? parsed.components.reduce((sum: number, c: any) => sum + (c.confidence || 0), 0) / parsed.components.length
      : 0;
    if (avgConfidence > 0.8) score += 2;
    else if (avgConfidence > 0.6) score += 1;

    if (score >= 10) return 'high';
    if (score >= 6) return 'medium';
    return 'low';
  }

  private combineSheetResults(sheets: SheetAnalysisResult[]): {
    totalComponents: ExtractedComponent[];
    totalCrossings: UtilityCrossing[];
    quantitySummary: QuantitySummary[];
    allConcerns: string[];
  } {
    const allComponents: ExtractedComponent[] = [];
    const allCrossings: UtilityCrossing[] = [];
    const allConcerns: string[] = [];
    const quantityMap = new Map<string, QuantitySummary>();

    for (const sheet of sheets) {
      // Collect components (will need deduplication across sheets)
      allComponents.push(...sheet.components);
      allCrossings.push(...sheet.crossings);
      allConcerns.push(...sheet.peAnalysis.concerns);

      // Aggregate quantities
      for (const q of sheet.quantities) {
        const existing = quantityMap.get(q.item);
        if (existing) {
          existing.quantity = (existing.quantity || 0) + (q.quantity || 0);
        } else {
          quantityMap.set(q.item, { ...q });
        }
      }
    }

    return {
      totalComponents: this.deduplicateComponentsAcrossSheets(allComponents),
      totalCrossings: allCrossings,
      quantitySummary: Array.from(quantityMap.values()),
      allConcerns: [...new Set(allConcerns)]
    };
  }

  private deduplicateComponentsAcrossSheets(components: ExtractedComponent[]): ExtractedComponent[] {
    // Deduplicate based on station (match line components appear on adjacent sheets)
    const seen = new Map<string, ExtractedComponent>();

    for (const c of components) {
      const key = `${c.name}-${c.size}-${c.station}`;
      if (!seen.has(key) || (c.confidence > (seen.get(key)?.confidence || 0))) {
        seen.set(key, c);
      }
    }

    return Array.from(seen.values());
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createDocumentAnalyzer(config: {
  apiKey: string;
  projectContext?: Partial<ProjectContext>;
  debug?: boolean;
}): ConstructionDocumentAnalyzer {
  return new ConstructionDocumentAnalyzer(config);
}
