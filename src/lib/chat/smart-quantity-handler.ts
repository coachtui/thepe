/**
 * Smart Quantity Handler
 *
 * Prioritizes data sources in the correct order:
 * 1. TERMINATION POINTS from actual drawings (BEGIN/END labels) - HIGHEST PRIORITY
 * 2. Project quantities table (structured data from title/summary sheets)
 * 3. Vector search (fallback)
 *
 * This ensures that actual drawing data always takes precedence over index sheets.
 */

import { createClient } from '@/lib/db/supabase/server';
import {
  calculateLengthFromTerminations,
  getTerminationPointsForUtility,
  formatTerminationSummary
} from '@/lib/vision/termination-extractor';
import {
  getQuantityDirectly,
  type DirectLookupResult
} from './quantity-retrieval';

/**
 * Enhanced quantity result with source priority
 */
export interface SmartQuantityResult {
  success: boolean;
  answer: string;
  source: string;
  confidence: number;
  method: 'termination_points' | 'structured_quantity' | 'not_found';
  priority: 'highest' | 'medium' | 'low';
  details?: {
    beginStation?: string;
    endStation?: string;
    beginSheet?: string;
    endSheet?: string;
    lengthLf?: number;
    terminationPoints?: any[];
  };
  warnings?: string[];
}

/**
 * Get quantity using smart prioritization
 *
 * Priority order:
 * 1. Termination points from actual drawings
 * 2. Structured quantity data from project_quantities table
 * 3. Return not found
 *
 * @param projectId - Project ID
 * @param itemName - Item name to search for
 * @returns Smart quantity result
 */
export async function getQuantitySmart(
  projectId: string,
  itemName: string
): Promise<SmartQuantityResult> {
  const warnings: string[] = [];

  // ============================================================================
  // PRIORITY 1: Check termination points from actual drawings
  // ============================================================================
  console.log('[Smart Quantity] Checking termination points from drawings...');

  try {
    const lengthResult = await calculateLengthFromTerminations(projectId, itemName);

    if (lengthResult) {
      const answer = `${lengthResult.utilityName}: ${lengthResult.lengthLf.toFixed(2)} LF (calculated from actual drawings)`;

      const source = `BEGIN at ${lengthResult.beginStation} (Sheet ${lengthResult.beginSheet}) to END at ${lengthResult.endStation} (Sheet ${lengthResult.endSheet})`;

      return {
        success: true,
        answer,
        source,
        confidence: lengthResult.confidence,
        method: 'termination_points',
        priority: 'highest',
        details: {
          beginStation: lengthResult.beginStation,
          endStation: lengthResult.endStation,
          beginSheet: lengthResult.beginSheet,
          endSheet: lengthResult.endSheet,
          lengthLf: lengthResult.lengthLf
        }
      };
    }

    // Check if we have partial termination data (useful for warnings)
    const terminationPoints = await getTerminationPointsForUtility(projectId, itemName);

    if (terminationPoints.length > 0) {
      const hasBegin = terminationPoints.some((p: any) => p.termination_type === 'BEGIN');
      const hasEnd = terminationPoints.some((p: any) => p.termination_type === 'END');

      if (!hasBegin || !hasEnd) {
        warnings.push(
          `Found partial termination data in drawings (${hasBegin ? 'BEGIN' : 'no BEGIN'}, ${hasEnd ? 'END' : 'no END'}). Full calculation not possible.`
        );
      }
    }
  } catch (error) {
    console.error('[Smart Quantity] Error checking termination points:', error);
    warnings.push('Error checking termination points from drawings');
  }

  // ============================================================================
  // PRIORITY 2: Check structured quantity data (project_quantities table)
  // ============================================================================
  console.log('[Smart Quantity] Checking structured quantity database...');

  try {
    const directResult = await getQuantityDirectly(projectId, itemName);

    if (directResult && directResult.success) {
      // Check if this came from an index sheet (less reliable)
      const sourceSheet = directResult.source?.toLowerCase() || '';
      const isFromIndex = sourceSheet.includes('index') || sourceSheet.includes('toc');

      if (isFromIndex) {
        warnings.push(
          'This quantity appears to come from an index/table of contents. ' +
          'Index sheets may have incomplete data. ' +
          'Consider checking actual plan/profile drawings for termination points.'
        );
      }

      return {
        success: true,
        answer: directResult.answer || '',
        source: directResult.source || 'Project quantity database',
        confidence: directResult.confidence * (isFromIndex ? 0.7 : 1.0), // Reduce confidence for index-sourced data
        method: 'structured_quantity',
        priority: isFromIndex ? 'low' : 'medium',
        warnings: warnings.length > 0 ? warnings : undefined
      };
    }
  } catch (error) {
    console.error('[Smart Quantity] Error checking structured quantities:', error);
    warnings.push('Error checking structured quantity database');
  }

  // ============================================================================
  // PRIORITY 3: Nothing found
  // ============================================================================
  return {
    success: false,
    answer: `No quantity data found for "${itemName}". Check if vision processing has completed on all sheets.`,
    source: 'None',
    confidence: 0,
    method: 'not_found',
    priority: 'low',
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Compare results from multiple sources and provide detailed analysis
 *
 * @param projectId - Project ID
 * @param itemName - Item name
 * @returns Comparison of all available sources
 */
export async function compareQuantitySources(
  projectId: string,
  itemName: string
): Promise<{
  terminationPointsResult: SmartQuantityResult | null;
  structuredQuantityResult: DirectLookupResult | null;
  comparison: string;
  recommendation: string;
}> {
  const smartResult = await getQuantitySmart(projectId, itemName);

  // Also get structured result independently
  let structuredResult: DirectLookupResult | null = null;
  try {
    structuredResult = await getQuantityDirectly(projectId, itemName);
  } catch {
    // Ignore error
  }

  // Build comparison text
  const comparisonLines: string[] = [];

  if (smartResult.method === 'termination_points') {
    comparisonLines.push('**Termination Points (from actual drawings):**');
    comparisonLines.push(`  ${smartResult.answer}`);
    comparisonLines.push(`  Source: ${smartResult.source}`);
    comparisonLines.push(`  Confidence: ${(smartResult.confidence * 100).toFixed(0)}%`);
    comparisonLines.push('');
  }

  if (structuredResult?.success) {
    comparisonLines.push('**Structured Quantity Database:**');
    comparisonLines.push(`  ${structuredResult.answer}`);
    comparisonLines.push(`  Source: ${structuredResult.source}`);
    comparisonLines.push(`  Confidence: ${(structuredResult.confidence * 100).toFixed(0)}%`);
    comparisonLines.push('');
  }

  // Provide recommendation
  let recommendation: string;

  if (smartResult.method === 'termination_points') {
    recommendation =
      '✅ **RECOMMENDED:** Use the termination points result. ' +
      'This data comes from actual BEGIN/END labels on plan/profile drawings and is the most accurate.';
  } else if (smartResult.method === 'structured_quantity') {
    if (smartResult.priority === 'low') {
      recommendation =
        '⚠️ **CAUTION:** This data appears to come from an index sheet. ' +
        'Index sheets often have incomplete information. ' +
        'Recommend processing actual plan/profile drawings with vision to find termination points.';
    } else {
      recommendation =
        '✅ **ACCEPTABLE:** This data comes from structured quantity tables. ' +
        'However, termination points from drawings would be more authoritative if available.';
    }
  } else {
    recommendation =
      '❌ **NO DATA FOUND:** No quantity information available. ' +
      'Ensure vision processing has completed on all sheets, especially plan and profile drawings.';
  }

  return {
    terminationPointsResult: smartResult.method === 'termination_points' ? smartResult : null,
    structuredQuantityResult: structuredResult,
    comparison: comparisonLines.join('\n'),
    recommendation
  };
}

/**
 * Build context string from smart quantity result
 *
 * @param result - Smart quantity result
 * @returns Formatted context string for LLM
 */
export function buildContextFromSmartQuantity(
  result: SmartQuantityResult
): string {
  const lines: string[] = [];

  if (result.success) {
    lines.push('**Quantity Information:**');
    lines.push(result.answer);
    lines.push(`Source: ${result.source}`);
    lines.push(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    lines.push(`Method: ${result.method === 'termination_points' ? 'Calculated from actual drawing termination points (BEGIN/END labels)' : 'From structured quantity database'}`);

    if (result.priority === 'highest') {
      lines.push(
        '\n**Note:** This is the most authoritative data source (from actual drawings).'
      );
    } else if (result.priority === 'low') {
      lines.push(
        '\n**Note:** This data may come from an index sheet and could be incomplete. Use with caution.'
      );
    }

    if (result.warnings && result.warnings.length > 0) {
      lines.push('\n**Warnings:**');
      result.warnings.forEach((warning) => {
        lines.push(`- ${warning}`);
      });
    }

    if (result.details?.terminationPoints && result.details.terminationPoints.length > 0) {
      lines.push('\n**Termination Points Found:**');
      lines.push(formatTerminationSummary(result.details.terminationPoints));
    }
  } else {
    lines.push('**Quantity Information:**');
    lines.push(result.answer);

    if (result.warnings && result.warnings.length > 0) {
      lines.push('\n**Suggestions:**');
      result.warnings.forEach((warning) => {
        lines.push(`- ${warning}`);
      });
    }
  }

  return lines.join('\n');
}

/**
 * Determine if we should use smart quantity handler for this query
 *
 * @param itemName - Item name from query
 * @returns Whether to use smart handler
 */
export function shouldUseSmartQuantityHandler(itemName: string | null | undefined): boolean {
  if (!itemName) {
    return false;
  }

  // Use smart handler for anything that looks like a utility or line item
  const itemLower = itemName.toLowerCase();

  const utilityKeywords = [
    'water',
    'storm',
    'sewer',
    'gas',
    'electric',
    'line',
    'pipe',
    'drain',
    'conduit'
  ];

  return utilityKeywords.some((keyword) => itemLower.includes(keyword));
}
