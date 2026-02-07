/**
 * Smart Query Routing System
 *
 * Orchestrates the entire query processing pipeline:
 * 1. Classify query intent
 * 2. Route to appropriate data sources (direct lookup, vector search, vision)
 * 3. Combine results intelligently
 * 4. Format context for Claude
 */

import { classifyQuery, type QueryClassification } from './query-classifier';
import {
  getQuantityDirectly,
  getAggregatedQuantity,
  shouldAttemptDirectLookup,
  buildContextFromDirectLookup,
  type DirectLookupResult
} from './quantity-retrieval';
import {
  getQuantitySmart,
  shouldUseSmartQuantityHandler,
  buildContextFromSmartQuantity,
  type SmartQuantityResult
} from './smart-quantity-handler';
import {
  performHybridSearch,
  buildContextFromHybridSearch,
  getCompleteSystemData,
  buildContextFromCompleteData,
  type EnhancedSearchResult
} from '@/lib/embeddings/station-aware-search';
import { generateEmbedding } from '@/lib/embeddings/openai';
import {
  queryComponentCount,
  queryCrossings,
  queryUtilityLength,
  detectComponentType,
  determineVisionQueryType,
  extractSizeFromQuery,
  getVisionDataSummary,
  type ComponentQueryResult,
  type CrossingQueryResult,
  type LengthQueryResult
} from './vision-queries';
import {
  requiresVisualAnalysis,
  determineVisualTask,
  extractComponentType as extractVisualComponentType,
  extractSizeFilter,
  extractUtilityName,
  type VisualAnalysisTask
} from './visual-analysis';

/**
 * Query routing result containing all context and metadata
 */
export interface QueryRoutingResult {
  // Classification
  classification: QueryClassification;

  // Context for LLM
  context: string;
  formattedContext: string; // Formatted for display

  // Method used
  method: 'direct_only' | 'vector_only' | 'hybrid' | 'complete_data' | 'visual_analysis';

  // Visual analysis flags
  needsVisualAnalysis?: boolean;
  visualAnalysisTask?: VisualAnalysisTask;
  visualAnalysisParams?: {
    componentType?: string;
    sizeFilter?: string;
    utilityName?: string;
  };

  // Results
  directLookup: DirectLookupResult | null;
  vectorResults: EnhancedSearchResult[];

  // Metadata
  metadata: {
    totalResults: number;
    directLookupUsed: boolean;
    vectorSearchUsed: boolean;
    avgBoostScore?: number;
    processingTimeMs: number;
  };

  // System prompt suggestions
  systemPromptAddition?: string;
}

/**
 * Auto-detect system name from project data
 *
 * Strategies:
 * 1. If project has only one major system, return it
 * 2. If item name hints at a specific system, return that
 * 3. Otherwise return undefined (will search all systems)
 */
async function autoDetectSystem(
  projectId: string,
  itemName?: string
): Promise<string | undefined> {
  const { createClient } = await import('@/lib/db/supabase/server');
  const supabase = await createClient();

  try {
    // Strategy 1: Check if project has predominantly one system
    const { data: systems } = await supabase
      .from('document_chunks')
      .select('content')
      .eq('project_id', projectId)
      .or('content.ilike.%WATER LINE%,content.ilike.%STORM DRAIN%,content.ilike.%SEWER%,content.ilike.%FIRE LINE%')
      .limit(100);

    if (!systems || systems.length === 0) {
      return undefined;
    }

    // Count system mentions
    const systemCounts = {
      waterLine: 0,
      stormDrain: 0,
      sewer: 0,
      fireLine: 0
    };

    systems.forEach(s => {
      const content = s.content.toLowerCase();
      if (content.includes('water line')) systemCounts.waterLine++;
      if (content.includes('storm drain')) systemCounts.stormDrain++;
      if (content.includes('sewer')) systemCounts.sewer++;
      if (content.includes('fire line')) systemCounts.fireLine++;
    });

    // Find dominant system
    const maxCount = Math.max(...Object.values(systemCounts));
    const totalCount = Object.values(systemCounts).reduce((a, b) => a + b, 0);

    // If one system is >80% of mentions, use it
    if (maxCount > totalCount * 0.8) {
      if (systemCounts.waterLine === maxCount) return 'WATER LINE';
      if (systemCounts.stormDrain === maxCount) return 'STORM DRAIN';
      if (systemCounts.sewer === maxCount) return 'SEWER';
      if (systemCounts.fireLine === maxCount) return 'FIRE LINE';
    }

    // Strategy 2: Check item name for hints
    if (itemName) {
      const itemLower = itemName.toLowerCase();
      if (itemLower.includes('water')) return 'WATER LINE';
      if (itemLower.includes('storm')) return 'STORM DRAIN';
      if (itemLower.includes('sewer')) return 'SEWER';
      if (itemLower.includes('fire')) return 'FIRE LINE';
    }

    return undefined; // Multiple systems, search all
  } catch (error) {
    console.error('[Smart Router] Error auto-detecting system:', error);
    return undefined;
  }
}

/**
 * Main routing function - handles query classification and retrieval
 *
 * @param query - User's query text
 * @param projectId - Project ID
 * @param options - Optional configuration
 * @returns Complete routing result
 */
export async function routeQuery(
  query: string,
  projectId: string,
  options: {
    includeMetadata?: boolean;
    maxResults?: number;
    minConfidence?: number;
  } = {}
): Promise<QueryRoutingResult> {
  const startTime = Date.now();

  const {
    includeMetadata = false,
    maxResults = 15,
    minConfidence = 0.7
  } = options;

  try {
    // STEP 1: Classify the query
    const classification = classifyQuery(query);

    console.log('[Smart Router] Query classification:', {
      type: classification.type,
      confidence: classification.confidence,
      itemName: classification.itemName,
      needsDirectLookup: classification.needsDirectLookup
    });

    // STEP 1.1: CHECK FOR PROJECT SUMMARY QUERY (highest priority)
    if (classification.type === 'project_summary') {
      console.log('[Smart Router] Project summary query detected - querying aggregated data...');

      const { createClient } = await import('@/lib/db/supabase/server');
      const supabase = await createClient();

      // Query the project_quantity_summary view (pre-aggregated data)
      const { data: summary, error } = await supabase
        .from('project_quantity_summary')
        .select('*')
        .eq('project_id', projectId);

      if (!error && summary && summary.length > 0) {
        console.log(`[Smart Router] Found ${summary.length} item types in project summary`);

        // Build context from summary
        const context = buildProjectSummaryContext(summary, projectId);
        const processingTimeMs = Date.now() - startTime;

        return {
          classification,
          context,
          formattedContext: context,
          method: 'direct_only',
          directLookup: {
            success: true,
            answer: context,
            source: 'project_quantity_summary view (aggregated from vision-extracted data)',
            confidence: 0.95,
            method: 'direct_lookup',
            data: summary
          },
          vectorResults: [],
          metadata: {
            totalResults: summary.length,
            directLookupUsed: true,
            vectorSearchUsed: false,
            processingTimeMs
          }
        };
      } else {
        console.log('[Smart Router] No project summary data found - project may not be vision-processed yet');
        // Fall through to standard routing
      }
    }

    // STEP 1.25: CHECK IF VISUAL ANALYSIS IS NEEDED
    // This detects if the user wants real-time visual inspection of plans
    const needsVisual = requiresVisualAnalysis(query);
    const visualTask = needsVisual ? determineVisualTask(query) : undefined;
    const visualParams = needsVisual ? {
      componentType: extractVisualComponentType(query),
      sizeFilter: extractSizeFilter(query),
      utilityName: extractUtilityName(query)
    } : undefined;

    if (needsVisual) {
      console.log('[Smart Router] Visual analysis recommended:', {
        task: visualTask,
        params: visualParams
      });
    }

    // STEP 1.5: CHECK FOR VISION DATA QUERIES (HIGHEST PRIORITY)
    // Vision-extracted data is the most authoritative source for:
    // - Component counts (valves, fittings, hydrants, etc.)
    // - Utility crossings (ELEC, SS, STM, etc.)
    // - Utility lengths (BEGIN/END termination points)
    const visionQueryType = determineVisionQueryType(query);
    console.log('[Smart Router] Vision query type:', visionQueryType);

    if (visionQueryType !== 'none') {
      let visionResult: ComponentQueryResult | CrossingQueryResult | LengthQueryResult | null = null;

      if (visionQueryType === 'component') {
        const componentType = detectComponentType(query);
        const sizeFilter = extractSizeFromQuery(query);
        if (componentType) {
          console.log(`[Smart Router] Querying vision data for ${componentType} count${sizeFilter ? ` (size: ${sizeFilter})` : ''}...`);
          visionResult = await queryComponentCount(
            projectId,
            componentType,
            classification.searchHints.systemName,
            sizeFilter || undefined
          );
        }
      } else if (visionQueryType === 'crossing') {
        console.log('[Smart Router] Querying vision data for utility crossings...');
        visionResult = await queryCrossings(
          projectId,
          classification.searchHints.systemName
        );
      } else if (visionQueryType === 'length' && classification.itemName) {
        console.log(`[Smart Router] Querying vision data for ${classification.itemName} length...`);
        visionResult = await queryUtilityLength(projectId, classification.itemName);
      }

      // If vision query was successful, return early with formatted result
      if (visionResult && visionResult.success) {
        console.log('[Smart Router] Vision query successful! Using vision data directly.');

        const processingTimeMs = Date.now() - startTime;

        // Get confidence - handle different result types
        const confidence = 'confidence' in visionResult ? visionResult.confidence : 0.9;

        return {
          classification,
          context: visionResult.formattedAnswer,
          formattedContext: visionResult.formattedAnswer,
          method: 'direct_only',
          directLookup: {
            success: true,
            answer: visionResult.formattedAnswer,
            source: visionResult.source,
            confidence,
            method: 'direct_lookup',
            data: visionResult
          },
          vectorResults: [],
          metadata: {
            totalResults: 1,
            directLookupUsed: true,
            vectorSearchUsed: false,
            processingTimeMs
          },
          systemPromptAddition: buildVisionQuerySystemPromptAddition(visionQueryType, visionResult)
        };
      } else if (visionResult) {
        // Vision query attempted but no data found - log and continue with fallback
        console.log('[Smart Router] Vision query found no data, falling back to standard retrieval');
      }
    }

    // STEP 2: Generate embedding for vector search
    const embeddingResult = await generateEmbedding(query);
    const embedding = embeddingResult.embedding;

    // STEP 3: Attempt smart quantity lookup (prioritizes termination points)
    let directLookup: DirectLookupResult | null = null;
    let smartQuantityResult: SmartQuantityResult | null = null;

    if (shouldAttemptDirectLookup(classification)) {
      // Check if this is an aggregation query (sum/total)
      if (classification.isAggregationQuery && classification.itemName) {
        console.log('[Smart Router] Aggregation query detected - calculating sum/total...');
        directLookup = await getAggregatedQuantity(
          projectId,
          classification.itemName,
          'sum'
        );

        if (directLookup && directLookup.success) {
          console.log('[Smart Router] Aggregation successful:', directLookup.answer);
        } else {
          console.log('[Smart Router] Aggregation found no results');
        }
      }
      // Use smart handler if it looks like a utility/line item query
      else if (shouldUseSmartQuantityHandler(classification.itemName)) {
        console.log('[Smart Router] Attempting SMART quantity lookup (prioritizes termination points)...');
        smartQuantityResult = await getQuantitySmart(
          projectId,
          classification.itemName!
        );

        if (smartQuantityResult.success) {
          console.log(
            `[Smart Router] Smart lookup successful via ${smartQuantityResult.method}:`,
            smartQuantityResult.answer
          );

          // Convert to DirectLookupResult format for compatibility
          directLookup = {
            success: true,
            answer: smartQuantityResult.answer,
            source: smartQuantityResult.source,
            confidence: smartQuantityResult.confidence,
            method: 'direct_lookup',
            data: smartQuantityResult
          };
        } else {
          console.log('[Smart Router] Smart lookup found no results');
        }
      } else {
        // Fallback to traditional direct lookup for non-utility queries
        console.log('[Smart Router] Attempting direct quantity lookup...');
        directLookup = await getQuantityDirectly(
          projectId,
          classification.itemName!,
          classification
        );

        if (directLookup && directLookup.success) {
          console.log('[Smart Router] Direct lookup successful:', directLookup.answer);
        } else {
          console.log('[Smart Router] Direct lookup found no results');
        }
      }
    }

    // STEP 4: Perform retrieval based on query intent
    let hybridSearchResult: any;
    let context: string;
    let method: 'direct_only' | 'vector_only' | 'hybrid' | 'complete_data';

    // Check if this is a QUANTITATIVE query requiring complete data
    if (classification.needsCompleteData) {
      console.log('[Smart Router] Quantitative query detected - attempting complete data retrieval...');

      // Determine system name (either from query or auto-detect)
      let systemName = classification.searchHints.systemName;

      if (!systemName) {
        console.log('[Smart Router] No system name in query - attempting auto-detection...');
        // Try to auto-detect system from project
        systemName = await autoDetectSystem(projectId, classification.itemName);

        if (systemName) {
          console.log('[Smart Router] Auto-detected system:', systemName);
        } else {
          console.log('[Smart Router] Could not auto-detect system - will search all systems');
        }
      } else {
        console.log('[Smart Router] System name from query:', systemName);
      }

      try {
        // Determine chunk types based on query type
        let chunkOptions;
        if (classification.type === 'utility_crossing') {
          // For crossing queries, get profile view chunks (all chunks, not just callouts)
          chunkOptions = {
            includeNonCallouts: true, // Need all profile text for crossing labels
            chunkTypes: [] // Get all chunk types from profile sheets
          };
        } else {
          // For quantity queries, only callout boxes
          chunkOptions = {
            includeNonCallouts: false, // Only callout boxes for counting
            chunkTypes: ['callout_box']
          };
        }

        // Get complete dataset for the system (or all systems if no specific one)
        const completeData = await getCompleteSystemData(
          projectId,
          systemName || '', // Empty string will search across all systems
          chunkOptions
        );

        // Build context from complete data
        if (completeData.totalChunks > 0) {
          context = buildContextFromCompleteData(
            completeData,
            systemName || 'all systems'
          );

          // Add direct lookup if available
          if (directLookup?.success) {
            context = `**Direct Quantity Lookup:**\n${directLookup.answer}\nSource: ${directLookup.source}\n\n${context}`;
          }

          method = 'complete_data';

          // Convert to hybrid format for compatibility
          hybridSearchResult = {
            results: completeData.chunks.map((chunk, index) => ({
              chunk_id: chunk.id,
              document_id: chunk.document_id,
              chunk_index: chunk.chunk_index,
              content: chunk.content,
              page_number: chunk.page_number,
              similarity: 1.0, // Not from vector search
              boosted_score: 1.0,
              document_filename: chunk.document_filename,
              sheet_number: chunk.sheet_number,
              project_id: projectId
            })),
            directLookup: directLookup,
            stats: {
              directLookupUsed: !!directLookup?.success,
              vectorResults: completeData.totalChunks,
              totalBoost: 0,
              avgBoost: 0
            }
          };

          console.log(`[Smart Router] Complete data retrieval: ${completeData.totalChunks} chunks from ${completeData.sheets.length} sheets`);
        } else {
          // No complete data found, fallback to vector search
          console.log('[Smart Router] No complete data found, falling back to vector search');
          console.log('[Smart Router] Performing station-aware vector search...');
          hybridSearchResult = await performHybridSearch(
            query,
            projectId,
            classification,
            embedding,
            directLookup,
            maxResults
          );

          context = buildContextFromHybridSearch(
            {
              results: hybridSearchResult.results,
              directLookup: directLookup?.success ? directLookup : null
            },
            includeMetadata
          );

          method = hybridSearchResult.results.length > 0 ? 'hybrid' : 'vector_only';
        }
      } catch (error) {
        console.error('[Smart Router] Error in complete data retrieval, falling back to vector search:', error);
        // Fallback to vector search
        hybridSearchResult = await performHybridSearch(
          query,
          projectId,
          classification,
          embedding,
          directLookup,
          maxResults
        );

        context = buildContextFromHybridSearch(
          {
            results: hybridSearchResult.results,
            directLookup: directLookup?.success ? directLookup : null
          },
          includeMetadata
        );

        method = hybridSearchResult.results.length > 0 ? 'hybrid' : 'vector_only';
      }
    } else {
      // Standard vector search for non-quantitative queries
      console.log('[Smart Router] Performing station-aware vector search...');
      hybridSearchResult = await performHybridSearch(
        query,
        projectId,
        classification,
        embedding,
        directLookup,
        maxResults
      );

      // STEP 5: Determine method used
      if (directLookup?.success && hybridSearchResult.results.length === 0) {
        method = 'direct_only';
      } else if (!directLookup?.success && hybridSearchResult.results.length > 0) {
        method = 'vector_only';
      } else {
        method = 'hybrid';
      }

      // STEP 6: Build context string
      context = buildContextFromHybridSearch(
        {
          results: hybridSearchResult.results,
          directLookup: directLookup?.success ? directLookup : null
        },
        includeMetadata
      );
    }

    // STEP 7: Build system prompt addition based on query type
    const systemPromptAddition = buildSystemPromptAddition(
      classification,
      directLookup,
      hybridSearchResult.results.length
    );

    // STEP 8: Calculate metadata
    const processingTimeMs = Date.now() - startTime;

    const result: QueryRoutingResult = {
      classification,
      context,
      formattedContext: context, // Same for now, could be enhanced
      method,
      directLookup: directLookup?.success ? directLookup : null,
      vectorResults: hybridSearchResult.results,
      metadata: {
        totalResults: hybridSearchResult.results.length + (directLookup?.success ? 1 : 0),
        directLookupUsed: !!directLookup?.success,
        vectorSearchUsed: hybridSearchResult.results.length > 0,
        avgBoostScore: hybridSearchResult.stats.avgBoost,
        processingTimeMs
      },
      systemPromptAddition,
      // Visual analysis flags for chat API to use
      needsVisualAnalysis: needsVisual,
      visualAnalysisTask: visualTask,
      visualAnalysisParams: visualParams
    };

    console.log('[Smart Router] Routing complete:', {
      method: result.method,
      totalResults: result.metadata.totalResults,
      processingTime: `${processingTimeMs}ms`
    });

    return result;
  } catch (error) {
    console.error('[Smart Router] Error routing query:', error);

    // Return fallback result
    const processingTimeMs = Date.now() - startTime;

    return {
      classification: {
        type: 'general',
        confidence: 0.5,
        intent: 'informational',
        itemName: undefined,
        needsDirectLookup: false,
        needsVectorSearch: true,
        needsVision: false,
        needsCompleteData: false,
        isAggregationQuery: false,
        searchHints: {}
      },
      context: 'Error retrieving context. Please try rephrasing your question.',
      formattedContext: 'Error retrieving context. Please try rephrasing your question.',
      method: 'vector_only',
      directLookup: null,
      vectorResults: [],
      metadata: {
        totalResults: 0,
        directLookupUsed: false,
        vectorSearchUsed: false,
        processingTimeMs
      }
    };
  }
}

/**
 * Build system prompt addition for vision query results
 */
function buildVisionQuerySystemPromptAddition(
  visionQueryType: 'component' | 'crossing' | 'length' | 'none',
  visionResult: ComponentQueryResult | CrossingQueryResult | LengthQueryResult
): string {
  const parts: string[] = [];

  parts.push('**VISION-EXTRACTED DATA PROVIDED**\n\n');
  parts.push('The data below was extracted by Claude Vision API from the construction plan PDFs. ');
  parts.push('This is AUTHORITATIVE data directly from the drawings.\n\n');

  switch (visionQueryType) {
    case 'component':
      parts.push('**COMPONENT COUNT QUERY:**\n');
      parts.push('- The component count data below was extracted from callout boxes on plan sheets\n');
      parts.push('- Each component was identified with its size, station, and sheet number\n');
      parts.push('- Present this data directly to the user - DO NOT claim you cannot find it\n');
      parts.push('- Format the response using the tables provided\n\n');
      break;

    case 'crossing':
      parts.push('**UTILITY CROSSING QUERY:**\n');
      parts.push('- The crossing data below was extracted from profile views on the drawings\n');
      parts.push('- Each crossing shows the utility type, station, elevation, and existing/proposed status\n');
      parts.push('- Utility abbreviations: ELEC=Electrical, SS=Sanitary Sewer, STM=Storm Drain, GAS=Gas, TEL=Telecom, W=Water, FO=Fiber Optic\n');
      parts.push('- Present this data directly to the user in table format\n\n');
      break;

    case 'length':
      parts.push('**UTILITY LENGTH QUERY:**\n');
      parts.push('- The length was calculated from BEGIN and END termination point labels found on actual plan/profile drawings\n');
      parts.push('- This is the MOST ACCURATE length calculation method (not from index sheets)\n');
      parts.push('- Formula: END station - BEGIN station = Total Length in Linear Feet (LF)\n');
      parts.push('- Present this data directly with the calculation shown\n\n');
      break;
  }

  parts.push('**CRITICAL INSTRUCTION:** The vision extraction has ALREADY done the work of reading the drawings. ');
  parts.push('Use the provided data directly in your response. DO NOT say "I cannot find" or "I need to review" - the data is right here.\n\n');

  parts.push('**VISION DATA:**\n');
  parts.push(visionResult.formattedAnswer);

  return parts.join('');
}

/**
 * Build system prompt addition based on query type and results
 */
function buildSystemPromptAddition(
  classification: QueryClassification,
  directLookup: DirectLookupResult | null,
  vectorResultCount: number
): string {
  const parts: string[] = [];

  // Add query type context
  switch (classification.type) {
    case 'quantity':
      if (classification.needsCompleteData && classification.searchHints.systemName) {
        // QUANTITATIVE query with complete dataset
        parts.push(
          '**QUANTITATIVE QUERY - COMPLETE DATASET PROVIDED**\n\n' +
          'You have been provided with the COMPLETE dataset for this system, including ALL callout boxes ' +
          'from all relevant sheets. This is NOT a sampled dataset.\n\n' +
          '**CRITICAL INSTRUCTIONS FOR MATERIAL TAKEOFFS:**\n\n' +
          '1. **DATA COMPLETENESS**: You have ALL component data for the system. Count every instance.\n\n' +
          '2. **CALLOUT BOX READING**: Each callout box lists components at a specific station. ' +
          'Read EVERY line in EVERY callout box provided.\n\n' +
          '3. **COUNTING METHODOLOGY**:\n' +
          '   - Read each callout box header to identify station\n' +
          '   - Parse each bulleted component line (format: "1 - 12-IN GATE VALVE")\n' +
          '   - Extract: quantity, size, component name\n' +
          '   - Sum quantities across all sheets\n\n' +
          '4. **REQUIRED RESPONSE FORMAT**:\n' +
          '   ```\n' +
          '   [Component] Takeoff for [System Name]\n' +
          '   Reviewed sheets: [list]\n\n' +
          '   | Sheet | Station | Size | Component | Qty |\n' +
          '   |-------|---------|------|-----------|-----|\n' +
          '   [detailed rows with sheet/station references]\n\n' +
          '   TOTAL: [X] × [size], [Y] × [size] = [total] [component type]\n' +
          '   ```\n\n' +
          '5. **ACCURACY REQUIREMENTS**:\n' +
          '   - Provide exact counts, not estimates\n' +
          '   - Include sheet number and station for EVERY component\n' +
          '   - Break down totals by size if multiple sizes exist\n' +
          '   - Show your work with complete references\n\n' +
          '6. **VERIFICATION**: Before answering, verify you have reviewed ALL sheets listed in the dataset header.\n'
        );

        if (directLookup?.success) {
          parts.push(
            '\n**DIRECT DATABASE LOOKUP ALSO PROVIDED**: A calculated value from the database ' +
            'is included for reference. Verify this matches your manual count from the callout boxes.'
          );
        }
      } else if (directLookup?.success) {
        parts.push(
          '**DIRECT QUANTITY LOOKUP PROVIDED (Vision-Extracted Data):**\n\n' +
          'A direct quantity lookup from the project database has been provided. ' +
          'This data was extracted using Claude Vision API from the construction plan PDFs.\n\n' +
          '**SANITY CHECK THE RESULTS:**\n' +
          '- Does the count seem reasonable? (5-10 valves on a water line is typical, 50 is suspicious)\n' +
          '- Are station numbers in valid format? (e.g., "24+93.06" is valid, "2+16-27 RT" is not)\n' +
          '- Were sizes filtered correctly? (12-IN ≠ 8-IN - they are DIFFERENT components)\n\n' +
          '**SIZE FILTERING IS CRITICAL:**\n' +
          '- If user asked for "12 inch valves", only show items where size = "12-IN"\n' +
          '- If the data shows 8-IN valves mixed in, note that these were excluded from the count\n' +
          '- Always clarify which sizes are included in your answer\n\n' +
          'Use the provided data in your answer and cite the source.'
        );
      } else {
        parts.push(
          'This is a quantity query. Look for tables, quantity summaries, or ' +
          'specific mentions of lengths, amounts, or totals in the provided context. ' +
          'If you find conflicting information, prefer data from actual drawings over index sheets.'
        );
      }
      break;

    case 'location':
      parts.push(
        'This is a location query. Focus on station numbers, plan views, and ' +
        'spatial descriptions in the provided context. If available, reference ' +
        'specific stations and sheet numbers in your answer.'
      );
      break;

    case 'specification':
      parts.push(
        'This is a specification query. Look for material specifications, ' +
        'requirements, standards, and technical details in the provided context. ' +
        'Include specific section references if available.'
      );
      break;

    case 'detail':
      parts.push(
        'This is a detail query. Look for construction details, installation ' +
        'procedures, and typical sections in the provided context. Reference ' +
        'specific detail numbers and sheets if available.'
      );
      break;

    case 'reference':
      parts.push(
        'This is a reference query. Help the user find the relevant sheet numbers, ' +
        'drawings, or document sections based on the provided context.'
      );
      break;

    case 'utility_crossing':
      parts.push(
        '**UTILITY CROSSING DETECTION QUERY - VISION ANALYSIS**\n\n' +
        'The profile view sheets have been analyzed using Claude Vision API (same technology used ' +
        'for valve/fitting detection). Vision has extracted utility crossing information.\n\n' +
        '**WHAT VISION DETECTED**:\n' +
        'Vision analyzed the profile views and looked for:\n' +
        '1. **Utility abbreviation labels**: ELEC, SS, STM, GAS, TEL, W, FO\n' +
        '2. **Elevation callouts**: Numbers like "35.73±" or "INV ELEV = 28.50"\n' +
        '3. **Context indicators**: "EXIST", "EXISTING", "PROP", "PROPOSED"\n' +
        '4. **Visual crossings**: Lines/symbols showing utilities crossing the main line\n\n' +
        '**YOUR TASK**:\n' +
        'Review the vision-extracted crossing data provided in the context below. Format it as:\n\n' +
        '   Utility Crossings - [System Name]\n' +
        '   Analyzed: [sheets]\n\n' +
        '   | Station | Crossing Utility | Elevation/Depth | Type | Notes |\n' +
        '   |---------|------------------|-----------------|------|-------|\n' +
        '   | XX+XX.XX | Electrical (ELEC) | 35.73± ft | Existing | [info] |\n\n' +
        '   Total: X utility crossings identified\n' +
        '   Source: Vision analysis of profile views on sheets [list]\n\n' +
        '**IF NO CROSSINGS DETECTED**:\n' +
        'If vision found no crossing data, state:\n' +
        '"Vision analysis of the profile views did not detect utility crossing labels. This means:\n' +
        '- No utilities cross this line at labeled locations\n' +
        '- Or crossings exist but are not labeled with text callouts\n\n' +
        'Sheets analyzed: [list]"\n\n' +
        '**NOTE**: Vision analysis is just as accurate at reading crossing labels as it is at ' +
        'reading valve callouts - they\'re the same size and format!'
      );
      break;

    default:
      parts.push(
        'Analyze the provided context from the construction documents to answer ' +
        'the user\'s question. Be specific and cite your sources.'
      );
  }

  // Add result count context
  if (vectorResultCount === 0 && !directLookup?.success) {
    parts.push(
      '\n\nNote: No relevant context was found in the documents. ' +
      'Inform the user that you couldn\'t find information about this in the project documents.'
    );
  } else if (vectorResultCount > 10) {
    parts.push(
      '\n\nNote: Multiple relevant sections were found. Synthesize the information ' +
      'and highlight the most relevant details.'
    );
  }

  return parts.join(' ');
}

/**
 * Build the complete system prompt for Claude
 */
export function buildSystemPrompt(routingResult: QueryRoutingResult): string {
  const basePrompt = `You are a construction project assistant helping users find information from construction plans and documents.

**Your Task:**
Answer the user's question based ONLY on the provided context from the project documents.

**═══════════════════════════════════════════════════════════════════**
**CONTEXTUAL REASONING - THINK LIKE AN EXPERIENCED ESTIMATOR**
**═══════════════════════════════════════════════════════════════════**

I reason about construction documents like an experienced estimator would - using context, common sense, and domain knowledge. I adapt to different plan formats and engineering conventions rather than applying rigid rules.

**CORE REASONING PRINCIPLES:**

**1. UNDERSTAND WHAT THE USER IS ASKING FOR**

When user asks "how many 12 inch valves are there":
- They want valves that are 12 inches in diameter
- NOT 8-inch valves, NOT 6-inch valves
- Only count components that explicitly state "12-IN" in their description
- If I see "8-IN GATE VALVE", that's NOT a 12-inch valve

**2. DISTINGUISH BETWEEN SOURCES OF INFORMATION**

Construction plans have multiple information sources:
- **Profile views**: Show components at specific stations (PRIMARY for takeoffs)
- **Plan views**: Show spatial layout (may duplicate profile data)
- **Callout boxes**: Detail listings (may duplicate what's shown graphically)
- **Schedules/tables**: Summary information (may aggregate from other sheets)
- **Match lines**: Sheet navigation (NOT actual components)

**Golden Rule**: If the same component appears in multiple places on a sheet (profile + plan + callout), it's STILL ONE COMPONENT. Don't count it multiple times.

**3. USE COMMON SENSE ABOUT QUANTITIES**

Red flags that indicate I'm over-counting:
- Finding 20+ valves on a simple water line
- Same station number appearing 6 times with identical components
- Quantities that seem unreasonably high

When I notice these patterns, I should re-examine my extraction and check for duplication.

**4. PARSE SIZES CAREFULLY**

Construction components are specified as: "[SIZE] [COMPONENT TYPE]"
- "12-IN GATE VALVE" = 12-inch gate valve
- "8-IN GATE VALVE" = 8-inch gate valve (different size!)
- "12-IN X 8-IN TEE" = tee with two different pipe sizes

**Critical distinction**: Size is part of the specification. An 8-inch valve is NOT a 12-inch valve, even if they're both gate valves on the same line.

**5. UNDERSTAND UTILITY SYSTEMS**

Main lines vs. laterals:
- **Main line**: The primary utility (e.g., "Water Line A" = 12-inch main)
- **Laterals**: Branches off the main (may be smaller diameter)
- **Services**: Connections to buildings (usually smaller)

When user asks about "Water Line A", they typically mean the main line, not every branch and lateral.

**6. UTILITY CROSSINGS REQUIRE VISUAL CONFIRMATION**

A real utility crossing has:
- ✓ Visual element (line crossing another line in profile view)
- ✓ Label (ELEC, SS, STM, etc.)
- ✓ Reference info (station, elevation, or coordinate)
- ✓ Located in profile view (shows vertical relationships)

NOT crossings:
- ❌ Text mentioning another utility in plan view
- ❌ Match line references ("MATCH LINE - WATER LINE A...")
- ❌ Main utility's own labels ("INVERT OF 12-IN WATER")
- ❌ Components on the main line (valves, tees, caps)

Common sense: A water line project typically has 0-5 utility crossings, not 20.

**7. STATION NUMBERS CORRELATE TO POSITION**

In profile views:
- Horizontal axis = stations (0+00, 5+00, 10+00, etc.)
- Components appear along the alignment
- To find a component's station: look directly down to the station scale

If I'm extracting station numbers that don't make sense (e.g., all valves at the same station, or stations jumping randomly), I'm reading the wrong text.

**8. ADAPT TO DOCUMENT VARIATIONS**

Different plans show information differently:
- Some have vertical labels in profile
- Some have only callout boxes
- Some have both
- Some use different labeling conventions

I should examine what's actually on these specific sheets and understand the layout and conventions used.

**9. WHEN IN DOUBT, BE CONSERVATIVE**

Better to undercount than overcount:
- If I'm not sure if something is a crossing, don't count it
- If I can't tell if two entries are the same component, assume they are (don't duplicate)
- If a size is ambiguous, don't guess

I can always tell the user "I found X components with high confidence, there may be Y additional components that need verification."

**10. EXPLAIN MY REASONING AND EXPRESS APPROPRIATE CONFIDENCE**

When I provide counts, I should:
- ✓ Show what I found (table with locations)
- ✓ State my source (profile views, callout boxes, etc.)
- ✓ Note any assumptions ("assuming main line only, not laterals")
- ✓ Flag uncertainties ("3 additional valves with unclear sizing")

Confidence levels:
- **High confidence**: "7 twelve-inch gate valves found" (clear extraction, verified count)
- **Medium confidence**: "Approximately 5-7 valves identified" (some ambiguity)
- **Low confidence**: "I found 3 valves with high certainty, plus 4 possible additional valves that need verification"

I should NEVER make up data that's not in the plans, claim certainty when I'm uncertain, or hide limitations.

**═══════════════════════════════════════════════════════════════════**
**CRITICAL: PDF TEXT EXTRACTION - MANDATORY BEHAVIOR**
**═══════════════════════════════════════════════════════════════════**

When I receive construction plan PDFs, I MUST attempt text extraction before claiming I cannot read them.

**NEVER say "I cannot read the small text" or "I need higher resolution" WITHOUT FIRST:**
1. Actually attempting to extract text from the PDF
2. Showing the user a sample of what I extracted
3. Proving that extraction genuinely failed

**EXTRACTION PROCESS:**
- **Step 1:** Extract text from the PDF using available tools
- **Step 2:** Search extracted text for patterns like "WATER LINE" and "STA" and component lists
- **Step 3:** If text extraction succeeds, parse the data
- **Step 4:** ONLY if extraction completely fails (returns empty/gibberish), then request alternative format

**IMPORTANT:** Construction plan PDFs often contain selectable text even if it appears small. I should:
✓ Try text extraction first (not OCR)
✓ Search for keywords in the extracted text
✓ Parse the text content I find
✓ Provide results based on actual extracted data

**I should NOT:**
✗ Assume text is unreadable based on visual appearance
✗ Request higher resolution without attempting extraction
✗ Claim I cannot read text when I have not tried to extract it
✗ Give up on the first attempt

**Example CORRECT behavior:**
User: "How many gate valves on Water Line A?"
Me: [Extracts text from sheets CU102-CU109]
    [Searches for "GATE VALVE" in extracted text]
    [Finds multiple instances with quantities]
    [Provides specific count with locations]

**Example WRONG behavior:**
User: "How many gate valves on Water Line A?"
Me: "I cannot read the small callout text" [WITHOUT ACTUALLY TRYING TO EXTRACT IT]

**If the PDF is uploaded to this conversation, the text is almost certainly extractable. I must try before claiming failure.**

**═══════════════════════════════════════════════════════════════════**
**CRITICAL: CONSTRUCTION PLAN READING BEHAVIOR**
**═══════════════════════════════════════════════════════════════════**

When analyzing construction plans (especially utilities, water, sewer, fire protection):

**CALLOUT BOXES ARE THE PRIMARY DATA SOURCE:**
Plans contain small text CALLOUT BOXES with component lists. These boxes typically:
- Start with a header like "WATER LINE 'A' STA ##+#+##.##"
- Contain bulleted lists: "1 - 12-IN GATE VALVE AND VALVE BOX"
- Are the PRIMARY source for material quantities
- Are often 8-10pt font and EASY TO MISS

**I MUST:**
✓ Read ALL callout boxes completely, not just plan graphics
✓ Parse every bullet point in every callout
✓ Extract: quantity, size, component type, station location
✓ Count components across all relevant sheets
✓ Never estimate - only report what I can read in the callouts

**I MUST NOT:**
✗ Provide generic summaries without reading actual callout text
✗ Say "I can see the sheets but need to review" without actually reading them
✗ Give incomplete data if I haven't read all relevant sheets
✗ Guess at quantities based on plan graphics alone

**SMALL TEXT EMPHASIS:**
The most important information on construction plans is often in the SMALLEST text (callout boxes, notes, dimensions). I must read ALL text carefully, regardless of size. Large graphics and titles are helpful for navigation but callouts contain the actual data needed for takeoffs.

**═══════════════════════════════════════════════════════════════════**
**UTILITY CROSSING DETECTION**
**═══════════════════════════════════════════════════════════════════**

When users ask about utility crossings, conflicts, or what utilities cross a line:

**UNDERSTANDING CROSSING INDICATORS:**

Utility crossings are NOT labeled with words like "crossing" or "conflict".
Instead, they appear in PROFILE VIEWS as:

1. **Utility abbreviation labels:**
   - ELEC or E = Electrical
   - SS or S = Sanitary Sewer
   - STM, SD, or D = Storm Drain
   - W or WL = Water Line
   - GAS or G = Gas
   - TEL, T, or TEL/CATV = Telephone/Telecom/Cable
   - FO = Fiber Optic
   - EXIST or EX = Existing utility
   - PROP or NEW = Proposed/new utility

2. **Elevation callouts:**
   - Numbers like "35.73±" or "INV ELEV = 28.50"
   - Located near the utility label
   - Indicates depth/elevation of crossing

3. **Profile view context:**
   - Text appears in lower portion of sheet (profile section)
   - Associated with station numbers
   - May show pavement surface reference (AC PAVEMENT, CONC, etc.)

**DETECTION PROCESS:**

When asked about crossings, I will:

**Step 1:** Search extracted text for utility abbreviations (ELEC, SS, STM, GAS, TEL, W, FO)

**Step 2:** Look for these patterns:
- Utility code + elevation number nearby
- Utility code + "EXIST" or "EXISTING"
- Utility code in profile view region
- Station numbers associated with utility labels

**Step 3:** Identify the crossing location:
- Find station number near the utility label
- Extract elevation if shown
- Note if existing or proposed

**Step 4:** Compile crossing inventory

**RESPONSE FORMAT:**

For utility crossing questions, I provide:

   Utility Crossings - [System Name]
   Reviewed: [sheets/stations]

   | Station | Crossing Utility | Elevation/Depth | Type | Notes |
   |---------|------------------|-----------------|------|-------|
   | XX+XX.XX | Electrical (ELEC) | 35.73± ft | Existing | [additional info] |
   | XX+XX.XX | Sanitary Sewer (SS) | INV 28.50 ft | Existing | [additional info] |

   Total: X utility crossings identified

   Source: Profile views on sheets [list]

**COMMON TEXT PATTERNS:**

Examples of what I look for in extracted text:

✓ "ELEC 35.73±" → Electrical crossing at elevation 35.73
✓ "EXIST SS INV ELEV = 28.50" → Existing sanitary sewer at invert elevation 28.50
✓ "STM" near "STA 15+20" → Storm drain crossing at station 15+20
✓ "EXISTING WATER LINE" → Water line crossing
✓ "12-IN W" or "8-IN SS" → Sized utility crossing

**WHEN CROSSINGS AREN'T FOUND:**

If I don't find utility crossing indicators, I will state:

"I don't see utility crossing labels (ELEC, SS, STM, etc.) in the extracted profile view text. This could mean:
- No utilities cross this line
- Crossings are shown graphically but not labeled with text
- Text extraction missed small profile annotations

Please check the profile views visually on sheets [list], or let me know if you see specific crossings I should look for."

**CRITICAL UNDERSTANDING:**

- Crossings are in PROFILE views, not plan views
- Labels are often small (6-10pt font) and easy to miss in extraction
- Elevation numbers confirm a crossing
- "EXIST" or "EXISTING" indicates it's not part of new construction
- Multiple utilities can cross at the same or different stations

**TRAINING EXAMPLES:**

**Example 1:**
User: "What utilities cross Water Line A?"
Text extracted includes: "ELEC 35.73± ... STA 15+20"
AI Response:

   Utility Crossings - Water Line A

   | Station | Crossing Utility | Elevation | Type |
   |---------|------------------|-----------|------|
   | 15+20 | Electrical (ELEC) | 35.73± ft | Existing |

   Total: 1 utility crossing
   Source: Profile view sheet CU105

**Example 2:**
User: "List all crossing utilities with stations"
Text includes: "EXIST SS INV 28.50 STA 8+45", "ELEC 35.73 STA 15+20", "STM STA 22+30"
AI Response:

   Utility Crossings Found:

   | Station | Utility | Elevation/Depth | Type |
   |---------|---------|-----------------|------|
   | 8+45 | Sanitary Sewer (SS) | INV 28.50 ft | Existing |
   | 15+20 | Electrical (ELEC) | 35.73 ft | Existing |
   | 22+30 | Storm Drain (STM) | Not specified | Unknown |

   Total: 3 utility crossings

**Example 3:**
User: "Any conflicts with existing utilities?"
Text includes: "EXISTING WATER LINE STA 10+00"
AI Response:
   Existing Utility Crossing:
   - Station 10+00: Existing Water Line
   Check for depth/clearance requirements with existing water line at this location.

**═══════════════════════════════════════════════════════════════════**
**EXTRACTION WORKFLOW FOR MATERIAL QUANTITIES**
**═══════════════════════════════════════════════════════════════════**

When asked about material quantities or components, follow this workflow:

**STEP 1:** Identify relevant sheets from index (e.g., "Water Line A" → sheets CU102-CU109)

**STEP 2:** For EACH sheet, locate and read ALL callout boxes containing component lists

**STEP 3:** Parse each callout:
   - Station number
   - Each bulleted component
   - Quantity and size

**STEP 4:** Aggregate data across all sheets

**STEP 5:** Present results in table format with sheet/station references

**STEP 6:** Provide summary totals by component type

If I cannot read callout text, I will state this explicitly and request higher resolution or different format.

**═══════════════════════════════════════════════════════════════════**
**RESPONSE QUALITY STANDARDS**
**═══════════════════════════════════════════════════════════════════**

For construction takeoff questions, I will ALWAYS:

✓ Show actual extracted data, not summaries
✓ Include sheet numbers and stations for every component
✓ Provide totals broken down by size/type
✓ Use table format for clarity
✓ State how many sheets I reviewed

**Example GOOD response:**
"Gate Valve Count for Water Line A (reviewed sheets CU102-CU109):

| Sheet | Station | Size | Qty |
|-------|---------|------|-----|
| CU102 | 0+00    | 12-IN| 1   |
| CU109 | 30+11.78| 12-IN| 1   |
| CU109 | 32+44.21| 12-IN| 1   |
| CU109 | 32+44.21| 8-IN | 1   |

TOTAL: 3x 12-IN, 1x 8-IN = 4 gate valves total"

**Example BAD response:**
"Based on the plans, there are multiple gate valves shown on Water Line A across several sheets."

**═══════════════════════════════════════════════════════════════════**
**VISUAL ANALYSIS OF CONSTRUCTION PLANS**
**═══════════════════════════════════════════════════════════════════**

When construction plan images are provided OR when I need to verify information visually:

**MY VISUAL ANALYSIS PROCESS:**

**Step 1: Orient myself**
- What type of sheet is this? (plan, profile, detail, legend)
- What system/utility is shown? (water, sewer, electrical, etc.)
- What are the key sections? (plan view top, profile view bottom)

**Step 2: Identify information locations**
- Where are components shown? (vertical labels in profile, callout boxes, etc.)
- Where are station numbers? (bottom of profile, typically)
- Where are crossings shown? (profile view with crossing lines)

**Step 3: Systematic extraction**
- Scan through the relevant section methodically
- Read each label/callout carefully
- Note exact text (size, component type)
- Track location (sheet, approximate station)

**Step 4: Avoid common mistakes**
- Don't count the same component twice (check if shown in multiple views)
- Distinguish sizes carefully (8-IN ≠ 12-IN)
- Don't confuse match lines with actual components
- Don't assume - read what's actually written

**Step 5: Aggregate and verify**
- Combine findings across multiple sheets
- Sanity check totals
- Flag any uncertainties

**EXAMPLE: COUNTING VALVES VISUALLY**

Sheet CU102 profile view:
- I see a vertical text label reading "12-IN GATE VALVE"
- Located near station marker 0+00
- Count: 1 twelve-inch valve on this sheet

Sheet CU107 profile view:
- I see two vertical labels reading "12-IN GATE VALVE"
- Located at different stations
- Count: 2 twelve-inch valves on this sheet

Sheet CU109 profile view:
- I see vertical labels: "12-IN GATE VALVE" (twice) and "8-IN GATE VALVE" (three times)
- User asked for 12-inch only
- Count: 2 twelve-inch valves (I'm excluding the 8-inch valves)

Total: 1 + 2 + 2 = 5 twelve-inch gate valves

**EXPLAINING MY VISUAL ANALYSIS:**

When I analyze plans visually, I explain what I see:

"I examined the profile views on sheets CU102 through CU109. In profile views, valves are shown as vertical text labels along the utility line. I found:
- Sheet CU102: 1 label reading '12-IN GATE VALVE'
- Sheets CU103-CU106: No 12-inch gate valve labels
- Sheet CU107: 2 labels reading '12-IN GATE VALVE'
- Sheet CU108: No 12-inch gate valve labels
- Sheet CU109: 2 labels reading '12-IN GATE VALVE' (also saw 3 labels for '8-IN GATE VALVE' which I excluded)

Total: 5 twelve-inch gate valves"

This transparency helps users trust my analysis, verify my reasoning, and catch errors.

**VISUAL VERIFICATION MODE:**

When the user questions my count or asks me to re-examine:
1. I acknowledge the concern
2. I re-analyze the specific sheets carefully
3. I show my step-by-step findings
4. If I find errors in my previous count, I correct them
5. I explain what I may have missed or miscounted

**TRUST HIERARCHY:**
1. My own visual analysis of provided images (highest confidence)
2. User corrections/feedback
3. Pre-extracted database data (use with caution, may have errors)

**═══════════════════════════════════════════════════════════════════**
**CRITICAL RULES FOR QUANTITY/LENGTH QUESTIONS**
**═══════════════════════════════════════════════════════════════════**

1. **INDEX vs ACTUAL DRAWINGS:**
   - If you see data from an "INDEX" or "TABLE OF CONTENTS" sheet, treat it as REFERENCE ONLY
   - Index sheets list what's IN the plan set but may have incomplete or summary data
   - ALWAYS prioritize information from actual PROFILE, PLAN, or DETAIL sheets over index sheets
   - Look for "BEGIN" and "END" labels/termination points on the actual drawings

2. **For length/quantity calculations:**
   - Search for BEGIN and END termination points on profile/plan drawings first
   - Calculate: END station - BEGIN station = total length
   - Cite the specific sheet numbers where BEGIN and END appear
   - DO NOT use station ranges from index sheets unless no other data is available
   - If index data conflicts with drawing data, TRUST THE DRAWINGS

3. **Example of correct prioritization:**
   - Index says: "WATER LINE 'A' - STA 0+00 TO STA 4+38.83" (one segment listed)
   - Drawing shows: "END WATER LINE 'A' STA 32+62.01" (actual endpoint on drawing)
   - CORRECT answer: 32+62.01 - 0+00 = 3,262.01 LF (from drawings)
   - WRONG answer: 4+38.83 - 0+00 = 438.83 LF (from index)

**General Rules:**
1. Always cite your sources (sheet numbers, document names)
2. If information is not in the provided context, clearly state you don't have that information
3. Include relevant station numbers or locations when available
4. Be concise but complete in your answers
5. If you see conflicting information between index and drawings, prefer the drawings and explain the discrepancy

**Context Classification:**
Query Type: ${routingResult.classification.type}
Confidence: ${(routingResult.classification.confidence * 100).toFixed(0)}%
Method Used: ${routingResult.method}

${routingResult.systemPromptAddition || ''}

**Provided Context:**
${routingResult.context}

---

Now answer the user's question based on the above context, remembering to prioritize actual drawings over index sheets.`;

  return basePrompt;
}

/**
 * Quick check if quantity data exists for a project
 * (useful for UI hints/suggestions)
 */
export async function checkProjectCapabilities(projectId: string): Promise<{
  hasQuantities: boolean;
  hasVisionData: boolean;
  hasStationData: boolean;
}> {
  const { createClient } = await import('@/lib/db/supabase/server');
  const supabase = await createClient();

  try {
    // Check quantities
    const { count: quantityCount } = await supabase
      .from('project_quantities')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);

    // Check vision data
    const { count: visionCount } = await supabase
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .not('vision_data', 'is', null);

    // Check station data
    const { count: stationCount } = await supabase
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .not('stations', 'is', null);

    return {
      hasQuantities: (quantityCount || 0) > 0,
      hasVisionData: (visionCount || 0) > 0,
      hasStationData: (stationCount || 0) > 0
    };
  } catch (error) {
    console.error('Error checking project capabilities:', error);
    return {
      hasQuantities: false,
      hasVisionData: false,
      hasStationData: false
    };
  }
}

/**
 * Get query routing statistics for analytics
 */
export interface QueryRoutingStats {
  totalQueries: number;
  byType: Record<string, number>;
  byMethod: Record<string, number>;
  avgProcessingTime: number;
  successRate: number;
}

/**
 * Log query routing for analytics (call from chat API)
 */
/**
 * Build context from project summary view
 */
function buildProjectSummaryContext(
  summary: any[],
  projectId: string
): string {
  const parts: string[] = [];

  parts.push('**COMPLETE PROJECT SUMMARY**\n');
  parts.push('This data was aggregated from vision-extracted quantities across all processed sheets.\n\n');

  if (summary.length === 0) {
    return 'No project summary data available. The project may not have been vision-processed yet.';
  }

  // Group by item type
  const byType = new Map<string, any[]>();
  summary.forEach(item => {
    const type = item.item_type || 'Other';
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)!.push(item);
  });

  // Build organized summary by type
  parts.push('| Item Type | Count | Documents | Avg Confidence |\n');
  parts.push('|-----------|-------|-----------|----------------|\n');

  for (const [type, items] of byType.entries()) {
    const totalCount = items.reduce((sum, item) => sum + (item.item_count || 0), 0);
    const docCount = items[0]?.document_count || 0;
    const avgConf = items[0]?.avg_confidence || 0;

    parts.push(`| ${type} | ${totalCount} | ${docCount} | ${(avgConf * 100).toFixed(0)}% |\n`);
  }

  parts.push('\n**Note:** This is aggregated data from vision processing. ');
  parts.push('For detailed sheet-by-sheet breakdowns, ask specific questions like ');
  parts.push('"Waterline takeoff" or "Electrical takeoff for Building A".\n');

  return parts.join('');
}

/**
 * Log query routing for analytics (call from chat API)
 */
export async function logQueryRouting(
  projectId: string,
  userId: string,
  query: string,
  routingResult: QueryRoutingResult,
  responseText?: string,
  success: boolean = true
): Promise<void> {
  const { createClient } = await import('@/lib/db/supabase/server');
  const supabase = await createClient();

  try {
    await supabase.from('query_analytics').insert({
      project_id: projectId,
      user_id: userId,
      query_text: query,
      query_type: routingResult.classification.type,
      query_classification: routingResult.classification as any,
      response_text: responseText,
      response_method: routingResult.method,
      sources: {
        directLookup: routingResult.directLookup,
        vectorResultCount: routingResult.vectorResults.length
      } as any,
      success,
      latency_ms: routingResult.metadata.processingTimeMs,
      vector_search_results: routingResult.vectorResults.length,
      direct_lookup_results: routingResult.directLookup ? 1 : 0,
      metadata: {
        classification: routingResult.classification,
        avgBoostScore: routingResult.metadata.avgBoostScore
      } as any
    } as any);
  } catch (error) {
    console.error('Error logging query routing:', error);
    // Don't throw - logging failures shouldn't break the query flow
  }
}
