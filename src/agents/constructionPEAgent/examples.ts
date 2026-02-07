/**
 * Integration Example: Complete Construction Copilot
 * 
 * This shows how to wire up:
 * 1. Document Analyzer (reads plans and specs)
 * 2. PE Agent (interprets and advises)
 * 3. Your existing app
 */

import { 
  createPEAgent, 
  createDocumentAnalyzer,
  ConstructionPEAgent,
  ConstructionDocumentAnalyzer,
  ProjectContext,
  SheetAnalysisResult
} from './index';

// ============================================================================
// EXAMPLE 1: Basic Setup
// ============================================================================

async function basicExample() {
  const apiKey = process.env.ANTHROPIC_API_KEY!;

  // Create both components
  const docAnalyzer = createDocumentAnalyzer({ apiKey, debug: true });
  const peAgent = createPEAgent({ apiKey, debug: true });

  // Analyze a plan sheet
  const fs = await import('fs');
  const planImage = fs.readFileSync('./plans/C-005.png');
  
  const extraction = await docAnalyzer.analyzeSheet(planImage, {
    sheetType: 'plan_profile',
    sheetNumber: 'C-005'
  });

  console.log('=== EXTRACTION RESULTS ===');
  console.log('Sheet:', extraction.sheet);
  console.log('Alignment:', extraction.alignment);
  console.log('Components found:', extraction.components.length);
  console.log('Crossings found:', extraction.crossings.length);
  console.log('PE Concerns:', extraction.peAnalysis.concerns);

  // Now ask the PE agent to interpret
  const interpretation = await peAgent.chat(`
    I just extracted data from sheet ${extraction.sheet.number}:
    
    Alignment: ${extraction.alignment.name} (${extraction.alignment.size} ${extraction.alignment.material})
    Length: ${extraction.alignment.totalLength} LF (${extraction.alignment.beginStation} to ${extraction.alignment.endStation})
    
    Components found:
    ${extraction.components.map(c => `- ${c.quantity}x ${c.size} ${c.name} @ STA ${c.station}`).join('\n')}
    
    Utility crossings:
    ${extraction.crossings.map(c => `- ${c.utilityName} @ STA ${c.station}`).join('\n')}
    
    The extraction noted these concerns:
    ${extraction.peAnalysis.concerns.join('\n')}
    
    Questions:
    1. Does the component count seem reasonable for this length of main?
    2. What should I verify before trusting this extraction?
    3. What's likely missing that I should look for on other sheets?
  `);

  console.log('\n=== PE INTERPRETATION ===');
  console.log(interpretation.response);
}

// ============================================================================
// EXAMPLE 2: Full Project Setup with Context
// ============================================================================

class ConstructionCopilot {
  private docAnalyzer: ConstructionDocumentAnalyzer;
  private peAgent: ConstructionPEAgent;
  private projectContext: Partial<ProjectContext>;
  private analyzedSheets: Map<string, SheetAnalysisResult> = new Map();

  constructor(apiKey: string, projectContext: Partial<ProjectContext>) {
    this.projectContext = projectContext;
    
    this.docAnalyzer = createDocumentAnalyzer({
      apiKey,
      projectContext,
      debug: process.env.NODE_ENV === 'development'
    });

    this.peAgent = createPEAgent({
      apiKey,
      projectContext,
      debug: process.env.NODE_ENV === 'development'
    });
  }

  /**
   * Analyze a single plan sheet
   */
  async analyzeSheet(imageBuffer: Buffer, sheetNumber?: string): Promise<SheetAnalysisResult> {
    const result = await this.docAnalyzer.analyzeSheet(imageBuffer, { sheetNumber });
    
    // Cache the result
    if (result.sheet.number) {
      this.analyzedSheets.set(result.sheet.number, result);
    }

    return result;
  }

  /**
   * Analyze all sheets in a plan set
   */
  async analyzeFullPlanSet(
    sheets: Array<{ buffer: Buffer; sheetNumber?: string }>
  ): Promise<{
    sheets: SheetAnalysisResult[];
    summary: {
      totalPipeLength: number;
      componentCounts: Record<string, number>;
      crossingCount: number;
      concerns: string[];
    };
  }> {
    const { sheets: results, combined } = await this.docAnalyzer.analyzeSheetSet(sheets, {
      concurrency: 2,
      combineResults: true
    });

    // Cache all results
    for (const result of results) {
      if (result.sheet.number) {
        this.analyzedSheets.set(result.sheet.number, result);
      }
    }

    // Build summary
    const componentCounts: Record<string, number> = {};
    for (const c of combined?.totalComponents || []) {
      const key = `${c.size} ${c.name}`.trim();
      componentCounts[key] = (componentCounts[key] || 0) + c.quantity;
    }

    const totalPipeLength = results.reduce(
      (sum, r) => sum + (r.alignment.totalLength || 0), 
      0
    );

    return {
      sheets: results,
      summary: {
        totalPipeLength,
        componentCounts,
        crossingCount: combined?.totalCrossings.length || 0,
        concerns: combined?.allConcerns || []
      }
    };
  }

  /**
   * Ask a question about the project
   */
  async ask(question: string, options?: {
    includeSheetContext?: boolean;
    images?: Buffer[];
  }): Promise<string> {
    let contextualQuestion = question;

    // Add analyzed sheet context if requested
    if (options?.includeSheetContext && this.analyzedSheets.size > 0) {
      const sheetSummary = Array.from(this.analyzedSheets.values())
        .map(s => `- ${s.sheet.number}: ${s.alignment.name || 'N/A'}, ${s.components.length} components`)
        .join('\n');
      
      contextualQuestion = `
[Context: I have analyzed ${this.analyzedSheets.size} sheets:
${sheetSummary}]

${question}`;
    }

    // Convert images if provided
    const imageData = options?.images?.map(buf => ({
      data: buf.toString('base64'),
      mediaType: 'image/png' as const
    }));

    const response = await this.peAgent.chat(contextualQuestion, { images: imageData });
    return response.response;
  }

  /**
   * Generate a quantity takeoff from analyzed sheets
   */
  async generateTakeoff(): Promise<{
    items: Array<{
      item: string;
      quantity: number;
      unit: string;
      source: string[];
    }>;
    notes: string[];
  }> {
    if (this.analyzedSheets.size === 0) {
      throw new Error('No sheets have been analyzed yet');
    }

    const items: Array<{
      item: string;
      quantity: number;
      unit: string;
      source: string[];
    }> = [];

    // Aggregate from all sheets
    const itemMap = new Map<string, { quantity: number; sources: Set<string> }>();

    for (const [sheetNum, sheet] of this.analyzedSheets) {
      // Add pipe length
      if (sheet.alignment.totalLength && sheet.alignment.size) {
        const pipeKey = `${sheet.alignment.size} ${sheet.alignment.type?.toUpperCase() || ''} PIPE`.trim();
        const existing = itemMap.get(pipeKey) || { quantity: 0, sources: new Set() };
        existing.quantity += sheet.alignment.totalLength;
        existing.sources.add(sheetNum);
        itemMap.set(pipeKey, existing);
      }

      // Add components
      for (const comp of sheet.components) {
        const compKey = `${comp.size} ${comp.name}`.trim();
        const existing = itemMap.get(compKey) || { quantity: 0, sources: new Set() };
        existing.quantity += comp.quantity;
        existing.sources.add(sheetNum);
        itemMap.set(compKey, existing);
      }
    }

    for (const [item, data] of itemMap) {
      items.push({
        item,
        quantity: data.quantity,
        unit: item.includes('PIPE') ? 'LF' : 'EA',
        source: Array.from(data.sources)
      });
    }

    // Get PE notes on the takeoff
    const takeoffText = items
      .map(i => `${i.item}: ${i.quantity} ${i.unit}`)
      .join('\n');

    const peReview = await this.peAgent.chat(`
      Review this quantity takeoff extracted from ${this.analyzedSheets.size} sheets:
      
      ${takeoffText}
      
      What might be missing? What should I double-check?
    `);

    return {
      items,
      notes: [peReview.response]
    };
  }

  /**
   * Draft an RFI based on sheet analysis
   */
  async draftRFI(params: {
    issue: string;
    relatedSheets?: string[];
  }): Promise<string> {
    // Gather context from related sheets
    let sheetContext = '';
    if (params.relatedSheets) {
      for (const sheetNum of params.relatedSheets) {
        const sheet = this.analyzedSheets.get(sheetNum);
        if (sheet) {
          sheetContext += `\n${sheetNum}: ${sheet.sheet.title || 'Unknown'}\n`;
          sheetContext += `  Alignment: ${sheet.alignment.name}\n`;
          sheetContext += `  Concerns noted: ${sheet.peAnalysis.concerns.join('; ')}\n`;
        }
      }
    }

    const rfi = await this.peAgent.draftRFI({
      issue: params.issue + (sheetContext ? `\n\nRelated sheet analysis:${sheetContext}` : ''),
      drawingRefs: params.relatedSheets
    });

    return rfi.body;
  }

  /**
   * Get analyzed sheet data
   */
  getAnalyzedSheet(sheetNumber: string): SheetAnalysisResult | undefined {
    return this.analyzedSheets.get(sheetNumber);
  }

  /**
   * Clear cached analysis
   */
  clearAnalysis(): void {
    this.analyzedSheets.clear();
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.peAgent.clearHistory();
  }
}

// ============================================================================
// EXAMPLE 3: Express API Routes
// ============================================================================

/*
import express from 'express';
import multer from 'multer';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Store copilot instances per session
const sessions = new Map<string, ConstructionCopilot>();

function getCopilot(sessionId: string, projectContext?: Partial<ProjectContext>): ConstructionCopilot {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new ConstructionCopilot(
      process.env.ANTHROPIC_API_KEY!,
      projectContext || {}
    ));
  }
  return sessions.get(sessionId)!;
}

// Analyze a sheet
router.post('/analyze-sheet', upload.single('sheet'), async (req, res) => {
  try {
    const { sessionId, sheetNumber, projectContext } = req.body;
    const copilot = getCopilot(sessionId, projectContext ? JSON.parse(projectContext) : undefined);
    
    const result = await copilot.analyzeSheet(req.file!.buffer, sheetNumber);
    
    res.json({
      success: true,
      result: {
        sheet: result.sheet,
        alignment: result.alignment,
        componentCount: result.components.length,
        crossingCount: result.crossings.length,
        quantities: result.quantities,
        concerns: result.peAnalysis.concerns,
        confidence: result.meta.confidence
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Ask a question
router.post('/ask', async (req, res) => {
  try {
    const { sessionId, question, includeSheetContext } = req.body;
    const copilot = getCopilot(sessionId);
    
    const response = await copilot.ask(question, { includeSheetContext });
    
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Generate takeoff
router.post('/takeoff', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const copilot = getCopilot(sessionId);
    
    const takeoff = await copilot.generateTakeoff();
    
    res.json({ success: true, takeoff });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
*/

// ============================================================================
// EXAMPLE 4: React Native Hook
// ============================================================================

/*
import { useState, useCallback, useRef } from 'react';

interface UseConstructionCopilotOptions {
  apiKey: string;
  projectContext?: Partial<ProjectContext>;
}

export function useConstructionCopilot({ apiKey, projectContext }: UseConstructionCopilotOptions) {
  const copilotRef = useRef<ConstructionCopilot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [analyzedSheets, setAnalyzedSheets] = useState<string[]>([]);

  const getCopilot = useCallback(() => {
    if (!copilotRef.current) {
      copilotRef.current = new ConstructionCopilot(apiKey, projectContext || {});
    }
    return copilotRef.current;
  }, [apiKey, projectContext]);

  const analyzeSheet = useCallback(async (imageBase64: string, sheetNumber?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const buffer = Buffer.from(imageBase64, 'base64');
      const result = await getCopilot().analyzeSheet(buffer, sheetNumber);
      
      if (result.sheet.number) {
        setAnalyzedSheets(prev => [...new Set([...prev, result.sheet.number!])]);
      }
      
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [getCopilot]);

  const ask = useCallback(async (question: string, options?: { includeSheetContext?: boolean }) => {
    setIsLoading(true);
    setError(null);
    try {
      return await getCopilot().ask(question, options);
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [getCopilot]);

  const generateTakeoff = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      return await getCopilot().generateTakeoff();
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [getCopilot]);

  return {
    analyzeSheet,
    ask,
    generateTakeoff,
    isLoading,
    error,
    analyzedSheets,
    clearHistory: () => getCopilot().clearHistory(),
    clearAnalysis: () => {
      getCopilot().clearAnalysis();
      setAnalyzedSheets([]);
    }
  };
}
*/

// ============================================================================
// RUN BASIC EXAMPLE
// ============================================================================

// Uncomment to run:
// basicExample().catch(console.error);

export { ConstructionCopilot };
