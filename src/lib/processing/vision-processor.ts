/**
 * Vision-Enhanced Document Processing
 *
 * Processes critical sheets with Claude Vision to extract structured quantities
 * and metadata. This runs after the standard LlamaParse processing.
 */

import { createClient } from '@/lib/db/supabase/server';
import { getDocumentSignedUrl } from '@/lib/db/queries/documents';
import {
  convertPdfPageToImage,
  identifyCriticalSheets,
  getPdfMetadata,
  estimateVisionCost,
  detectSheetType
} from '@/lib/vision/pdf-to-image';
import {
  analyzeSheetWithVision,
  type VisionAnalysisResult
} from '@/lib/vision/claude-vision';
import {
  processVisionForQuantities,
  storeQuantitiesInDatabase,
  updateChunkWithVisionData
} from '@/lib/metadata/quantity-extractor';
import {
  storeTerminationPoints
} from '@/lib/vision/termination-extractor';
import {
  storeUtilityCrossings
} from '@/lib/vision/crossing-extractor';
import { debug, logProduction } from '@/lib/utils/debug';

/**
 * Options for vision processing
 */
export interface VisionProcessingOptions {
  /**
   * Maximum number of sheets to process with vision (cost control)
   * Default: 5
   */
  maxSheets?: number;

  /**
   * Whether to process all sheets or just critical ones
   * Default: false (critical only)
   */
  processAllSheets?: boolean;

  /**
   * Image scale for rendering (1.0-3.0)
   * Higher = better quality but larger files
   * Default: 2.0
   */
  imageScale?: number;

  /**
   * Whether to store vision data in chunks
   * Default: true
   */
  storeVisionData?: boolean;

  /**
   * Whether to extract and store quantities
   * Default: true
   */
  extractQuantities?: boolean;
}

/**
 * Result of vision processing
 */
export interface VisionProcessingResult {
  success: boolean;
  sheetsProcessed: number;
  quantitiesExtracted: number;
  totalCost: number;
  processingTimeMs: number;
  errors: string[];
}

/**
 * Process a document with vision analysis for critical sheets
 *
 * @param documentId - Document ID
 * @param projectId - Project ID
 * @param options - Processing options
 * @returns Processing result
 */
export async function processDocumentWithVision(
  documentId: string,
  projectId: string,
  options: VisionProcessingOptions = {}
): Promise<VisionProcessingResult> {
  const {
    maxSheets = 200, // Process up to 200 critical sheets for complete project coverage
    processAllSheets = false,
    imageScale = 2.0,
    storeVisionData = true,
    extractQuantities = true
  } = options;

  const startTime = Date.now();
  const errors: string[] = [];
  let sheetsProcessed = 0;
  let quantitiesExtracted = 0;
  let totalCost = 0;

  const supabase = await createClient();

  try {
    // Step 1: Get document from database
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error('Document not found');
    }

    // Step 2: Get signed URL and download PDF
    const signedUrl = await getDocumentSignedUrl(supabase, document.file_path);

    debug.vision(`Downloading document ${documentId}...`);
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error('Failed to download document');
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());

    // Step 3: Get PDF metadata
    debug.vision(`Getting PDF metadata...`);
    const metadata = await getPdfMetadata(pdfBuffer);
    debug.vision(`PDF has ${metadata.numPages} pages`);

    // Step 4: Identify critical sheets
    let pagesToProcess: number[];

    if (processAllSheets) {
      pagesToProcess = Array.from({ length: Math.min(metadata.numPages, maxSheets) }, (_, i) => i + 1);
    } else {
      debug.vision(`Identifying critical sheets...`);
      pagesToProcess = await identifyCriticalSheets(pdfBuffer, undefined, maxSheets);
    }

    debug.vision(`Will process ${pagesToProcess.length} sheets:`, pagesToProcess);

    // Step 5: Estimate cost
    const costEstimate = estimateVisionCost(
      pagesToProcess.map(() => ({
        pageNumber: 0,
        buffer: Buffer.from([]),
        width: 2048,
        height: 2048,
        format: 'png',
        sizeBytes: 0
      }))
    );

    logProduction.cost('Vision Processing', costEstimate, {
      documentId,
      sheetsToProcess: pagesToProcess.length
    });

    // Step 6: Process each critical sheet
    for (const pageNumber of pagesToProcess) {
      try {
        debug.vision(`Processing page ${pageNumber}...`);

        // Convert page to image
        const image = await convertPdfPageToImage(pdfBuffer, pageNumber, {
          scale: imageScale,
          maxWidth: 2048,
          maxHeight: 2048,
          format: 'png'
        });

        debug.vision(`Image size: ${image.width}x${image.height}, ${(image.sizeBytes / 1024).toFixed(0)}KB`);

        // Detect sheet type based on page content (intelligent detection)
        debug.vision(`Detecting sheet type for page ${pageNumber}...`);
        const sheetType = await detectSheetType(pdfBuffer, pageNumber);
        debug.vision(`Detected sheet type: ${sheetType}`);

        // Analyze with Claude Vision
        debug.vision(`Analyzing page ${pageNumber} with Claude Vision...`);
        const visionResult = await analyzeSheetWithVision(image.buffer, {
          sheetType: sheetType as any,
          sheetNumber: document.sheet_number || undefined
        });

        logProduction.cost(`Vision Analysis Page ${pageNumber}`, visionResult.costUsd, {
          quantities: visionResult.quantities.length,
          terminationPoints: visionResult.terminationPoints?.length || 0,
          utilityCrossings: visionResult.utilityCrossings?.length || 0
        });
        debug.vision(`Found ${visionResult.quantities.length} quantities`);
        debug.vision(`Found ${visionResult.terminationPoints?.length || 0} termination points`);
        debug.vision(`Found ${visionResult.utilityCrossings?.length || 0} utility crossings`);

        // VALIDATION: Check for suspicious station numbers in quantities
        const validStationPattern = /^\d{1,3}\+\d{2}(\.\d{1,2})?$/;
        const suspiciousStations = visionResult.quantities.filter(q => {
          const station = q.stationFrom;
          if (!station) return false;
          // Invalid patterns: offset measurements, road references, etc.
          if (/RT$|LT$|Q\/S|O\/S|DEFL|-\d+-|ROAD|MATCH/i.test(station)) return true;
          return !validStationPattern.test(station);
        });

        if (suspiciousStations.length > 0) {
          logProduction.warn('Vision Processor',
            `⚠️ SUSPICIOUS STATIONS: ${suspiciousStations.length} items with potentially invalid station numbers on page ${pageNumber}`, {
            documentId,
            pageNumber,
            suspiciousItems: suspiciousStations.map(q => ({
              item: q.itemName,
              station: q.stationFrom,
              issue: 'Invalid station format'
            }))
          });
        }

        // VALIDATION: Check for reasonable quantity counts
        if (visionResult.quantities.length > 20) {
          logProduction.warn('Vision Processor',
            `⚠️ HIGH QUANTITY COUNT: Found ${visionResult.quantities.length} quantities on page ${pageNumber} - possibly over-extracting`, {
            documentId,
            pageNumber
          });
        }

        // VALIDATION: Log quantities by size for debugging
        const sizeBreakdown: Record<string, number> = {};
        for (const q of visionResult.quantities) {
          const sizeMatch = (q.itemName || '').match(/(\d+)\s*[-]?\s*IN/i);
          const size = sizeMatch ? `${sizeMatch[1]}-IN` : 'Unknown';
          sizeBreakdown[size] = (sizeBreakdown[size] || 0) + (q.quantity || 1);
        }
        if (Object.keys(sizeBreakdown).length > 0) {
          debug.vision(`  Size breakdown: ${JSON.stringify(sizeBreakdown)}`);
        }

        // Validation logging for crossings (catch over-detection)
        const crossingCount = visionResult.utilityCrossings?.length || 0;
        if (crossingCount > 5) {
          logProduction.warn('Vision Processor',
            `⚠️ HIGH CROSSING COUNT: Found ${crossingCount} crossings on page ${pageNumber} - likely over-detecting`, {
            documentId,
            pageNumber,
            crossings: visionResult.utilityCrossings?.map(c => ({
              utility: c.crossingUtility,
              station: c.station,
              elevation: c.elevation
            }))
          });
        }

        // Log individual crossings for verification
        if (crossingCount > 0) {
          visionResult.utilityCrossings?.forEach((crossing, idx) => {
            const hasElevation = crossing.elevation !== null && crossing.elevation !== undefined;
            if (!hasElevation) {
              debug.vision(`  ⚠️ Crossing ${idx + 1}: ${crossing.crossingUtility} at STA ${crossing.station || 'unknown'} - NO ELEVATION (questionable)`);
            } else {
              debug.vision(`  ✓ Crossing ${idx + 1}: ${crossing.crossingUtility} at STA ${crossing.station || 'unknown'}, ref ${crossing.elevation}`);
            }
          });
        }

        totalCost += visionResult.costUsd;
        sheetsProcessed++;

        // Find the chunk(s) for this page (needed for both quantities and termination points)
        const { data: chunks } = await supabase
          .from('document_chunks')
          .select('id')
          .eq('document_id', documentId)
          .eq('page_number', pageNumber)
          .limit(1);

        const chunkId = chunks && chunks.length > 0 ? chunks[0].id : null;

        // Step 7a: Extract and store termination points (HIGHEST PRIORITY)
        if (visionResult.terminationPoints && visionResult.terminationPoints.length > 0) {
          const terminationCount = await storeTerminationPoints(
            projectId,
            documentId,
            chunkId,
            document.sheet_number || `Page ${pageNumber}`,
            visionResult
          );
          debug.vision(`Stored ${terminationCount} termination points from page ${pageNumber}`);
        }

        // Step 7b: Extract and store utility crossings
        if (visionResult.utilityCrossings && visionResult.utilityCrossings.length > 0) {
          const crossingCount = await storeUtilityCrossings(
            projectId,
            documentId,
            chunkId,
            document.sheet_number || `Page ${pageNumber}`,
            visionResult
          );
          debug.vision(`Stored ${crossingCount} utility crossings from page ${pageNumber}`);
        }

        // Step 7c: Extract and store quantities
        if (extractQuantities && visionResult.quantities.length > 0) {
          const quantities = processVisionForQuantities(
            visionResult,
            document.sheet_number || undefined
          );

          const storedCount = await storeQuantitiesInDatabase(
            projectId,
            documentId,
            chunkId,
            quantities
          );

          quantitiesExtracted += storedCount;
          debug.vision(`Stored ${storedCount} quantities`);
        }

        // Step 8: Update chunk with vision data
        if (storeVisionData) {
          const { data: chunks } = await supabase
            .from('document_chunks')
            .select('id')
            .eq('document_id', documentId)
            .eq('page_number', pageNumber);

          if (chunks && chunks.length > 0) {
            for (const chunk of chunks) {
              await updateChunkWithVisionData(
                chunk.id,
                visionResult,
                sheetType,
                true // Mark as critical sheet
              );
            }
          }
        }

        // Small delay between API calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (pageError) {
        const errorMsg = `Error processing page ${pageNumber}: ${pageError instanceof Error ? pageError.message : 'Unknown error'}`;
        logProduction.error('Vision Processor', errorMsg);
        errors.push(errorMsg);
      }
    }

    const processingTimeMs = Date.now() - startTime;

    logProduction.info('Vision Processing Complete',
      `Processed ${sheetsProcessed} sheets, extracted ${quantitiesExtracted} quantities`, {
        totalCost: `$${totalCost.toFixed(4)}`,
        processingTimeSeconds: `${(processingTimeMs / 1000).toFixed(1)}s`,
        documentId
      });

    return {
      success: true,
      sheetsProcessed,
      quantitiesExtracted,
      totalCost,
      processingTimeMs,
      errors
    };

  } catch (error) {
    const errorMsg = `Vision processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    logProduction.error('Vision Processor', error, { documentId, projectId });
    errors.push(errorMsg);

    return {
      success: false,
      sheetsProcessed,
      quantitiesExtracted,
      totalCost,
      processingTimeMs: Date.now() - startTime,
      errors
    };
  }
}

/**
 * Process a single sheet with vision
 * (useful for re-processing specific sheets)
 *
 * @param documentId - Document ID
 * @param projectId - Project ID
 * @param pageNumber - Page number to process
 * @param sheetType - Type of sheet
 * @returns Vision analysis result
 */
export async function processSingleSheetWithVision(
  documentId: string,
  projectId: string,
  pageNumber: number,
  sheetType?: string
): Promise<VisionAnalysisResult> {
  const supabase = await createClient();

  // Get document
  const { data: document, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (docError || !document) {
    throw new Error('Document not found');
  }

  // Download PDF
  const signedUrl = await getDocumentSignedUrl(supabase, document.file_path);
  const response = await fetch(signedUrl);
  const pdfBuffer = Buffer.from(await response.arrayBuffer());

  // Convert to image
  const image = await convertPdfPageToImage(pdfBuffer, pageNumber, {
    scale: 2.0,
    maxWidth: 2048,
    maxHeight: 2048
  });

  // Analyze with vision
  const visionResult = await analyzeSheetWithVision(image.buffer, {
    sheetType: sheetType as any,
    sheetNumber: document.sheet_number ?? undefined
  });

  // Store results
  const quantities = processVisionForQuantities(visionResult, document.sheet_number ?? undefined);

  const { data: chunks } = await supabase
    .from('document_chunks')
    .select('id')
    .eq('document_id', documentId)
    .eq('page_number', pageNumber);

  if (chunks && chunks.length > 0) {
    const chunkId = chunks[0].id;

    await storeQuantitiesInDatabase(projectId, documentId, chunkId, quantities);
    await updateChunkWithVisionData(chunkId, visionResult, sheetType, true);
  }

  return visionResult;
}

/**
 * Check if vision processing is available
 * (requires Anthropic API key)
 */
export function isVisionProcessingAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Get vision processing status for a document
 */
export async function getVisionProcessingStatus(
  documentId: string
): Promise<{
  processed: boolean;
  sheetsWithVision: number;
  quantitiesExtracted: number;
}> {
  const supabase = await createClient();

  // Check chunks with vision data
  const { count: visionCount } = await supabase
    .from('document_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId)
    .not('vision_data', 'is', null);

  // Check quantities extracted
  const { count: quantityCount } = await supabase
    .from('project_quantities')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId);

  return {
    processed: (visionCount || 0) > 0,
    sheetsWithVision: visionCount || 0,
    quantitiesExtracted: quantityCount || 0
  };
}
