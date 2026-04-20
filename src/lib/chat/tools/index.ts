/**
 * Agentic Tools Layer — Task 1
 *
 * Exports a `buildTools()` factory that returns 6 Claude-callable tools
 * compatible with Vercel AI SDK's `streamText({ tools })`.
 *
 * Each tool wraps an existing retrieval function. No query logic lives here.
 *
 * AI SDK v6 note: tools use `inputSchema: zodSchema(z.object(...))`, not `parameters`.
 */

import { tool, zodSchema } from 'ai'
import { z } from 'zod'

import { routeQuery } from '../smart-router'
import { querySpecSection, querySpecRequirements } from '../spec-queries'
import { queryRFIByNumber, queryRFIsByEntity } from '../rfi-queries'
import { runPlanReader } from '../plan-reader'
import { verifyBeforeAnswering } from '../sheet-verifier'
import { queryComponentCount, queryAllComponentsByUtility } from '../vision-queries'
import type { ProjectMemoryContext } from '../project-memory'
import type { QueryAnalysis } from '../types'
import type { SheetVerificationResult } from '../sheet-verifier'

// Re-export for consumers
export type { ProjectMemoryContext }

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the 6 agentic tools for a single request context.
 *
 * @param projectId  - Active project ID
 * @param supabase   - Supabase client (passed through to query functions)
 * @param memoryCtx  - Pre-loaded project memory (aliases, patterns, hints)
 */
export function buildTools(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  memoryCtx: ProjectMemoryContext
) {
  // ── Tool 1: searchEntities ────────────────────────────────────────────────
  const searchEntities = tool({
    description:
      'Search project documents for construction entities by keyword. Returns components, materials, dimensions, locations, and extracted drawing/spec data. Use for open-ended questions about what exists in the project.',
    inputSchema: zodSchema(
      z.object({
        query: z.string().describe('The search query or keyword to look up'),
        system: z
          .string()
          .optional()
          .describe(
            'Optional utility system name to scope the search (e.g. "WATER LINE A"). Appended to query text to scope results — may not reliably filter to a specific system.'
          ),
      })
    ),
    execute: async ({ query, system }: { query: string; system?: string }): Promise<string> => {
      try {
        const result = await routeQuery(
          system ? `${query} ${system}` : query,
          projectId,
          { skipVisionDBLookup: false }
        )

        const warnings = result.routingWarnings ?? []
        const multiLineWarning = warnings.find(w => w.includes('multiple_named_water_lines_detected'))

        if (multiLineWarning && !system) {
          const baseResponse = result.formattedContext
            ? `Results searched across all systems:\n\n${result.formattedContext}`
            : 'No results found.'
          return `SYSTEM NOTE: This project has multiple named water lines. You must ask the user to specify which water line they mean (e.g., "Water Line A" or "Water Line B") before giving a count or quantity answer. Do not aggregate across lines without asking.\n\n${baseResponse}`
        }

        return result.formattedContext || 'No results found for that search.'
      } catch (err) {
        return `searchEntities error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })

  // ── Tool 2: getSpecSection ────────────────────────────────────────────────
  const getSpecSection = tool({
    description:
      'Look up a construction specification section or requirement. Use when the question involves material standards, installation requirements, testing procedures, or referenced standards (AWWA, ASTM, etc.).',
    inputSchema: zodSchema(
      z.object({
        sectionNumber: z
          .string()
          .optional()
          .describe('CSI section number, e.g. "03 30 00" or "03300"'),
        keyword: z
          .string()
          .optional()
          .describe(
            'Keyword or requirement type when section number is unknown, e.g. "concrete testing" or "material_requirement"'
          ),
      })
    ),
    execute: async ({
      sectionNumber,
      keyword,
    }: {
      sectionNumber?: string
      keyword?: string
    }): Promise<string> => {
      try {
        if (!sectionNumber && !keyword) {
          return 'Please provide either a sectionNumber or a keyword to search for spec sections.'
        }

        if (sectionNumber) {
          const result = await querySpecSection(supabase, projectId, sectionNumber)
          return result.formattedAnswer || 'No spec section found for that number.'
        }

        const result = await querySpecRequirements(supabase, projectId, null, keyword ?? null)
        return result.formattedAnswer || 'No spec requirements found for that keyword.'
      } catch (err) {
        return `getSpecSection error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })

  // ── Tool 3: searchRFIs ────────────────────────────────────────────────────
  const searchRFIs = tool({
    description:
      'Search RFIs (Requests for Information) and change documents. Use when looking for issued clarifications, substitutions, or design changes.',
    inputSchema: zodSchema(
      z.object({
        rfiNumber: z
          .string()
          .optional()
          .describe('RFI/ASI/Addendum identifier, e.g. "RFI-023", "ASI-002", "Addendum 1"'),
        keyword: z
          .string()
          .optional()
          .describe(
            'Entity tag or keyword when RFI number is unknown, e.g. "F-1" or "footing"'
          ),
      })
    ),
    execute: async ({
      rfiNumber,
      keyword,
    }: {
      rfiNumber?: string
      keyword?: string
    }): Promise<string> => {
      try {
        if (!rfiNumber && !keyword) {
          return 'Please provide either an rfiNumber or a keyword to search RFIs.'
        }

        if (rfiNumber) {
          const result = await queryRFIByNumber(supabase, projectId, rfiNumber)
          return result.formattedAnswer || 'No RFI found for that identifier.'
        }

        const result = await queryRFIsByEntity(supabase, projectId, keyword ?? '')
        return result.formattedAnswer || 'No RFIs found for that keyword.'
      } catch (err) {
        return `searchRFIs error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })

  // ── Tool 4: readDrawingPage ───────────────────────────────────────────────
  const readDrawingPage = tool({
    description:
      'Read a specific drawing sheet using vision analysis to find exact dimensions, notes, or details. More expensive than search tools — use when you need to verify specific details from the actual drawing image.',
    inputSchema: zodSchema(
      z.object({
        sheetNumber: z.string().describe('Drawing sheet number, e.g. "C-001", "S-201"'),
        focus: z
          .string()
          .describe('What to look for on this sheet, e.g. "pipe size at station 15+00"'),
      })
    ),
    execute: async ({
      sheetNumber,
      focus,
    }: {
      sheetNumber: string
      focus: string
    }): Promise<string> => {
      try {
        // Construct a minimal QueryAnalysis — plan reader only needs rawQuery
        const analysis: QueryAnalysis = {
          rawQuery: focus,
          answerMode: 'document_lookup',
          entities: { sheetNumber },
          requestedSystems: [],
          retrievalHints: {
            preferredSources: ['live_pdf_analysis'],
            keywords: [sheetNumber, focus],
            needsCompleteDataset: false,
            isAggregation: false,
            needsVisionDBLookup: false,
          },
          inferenceAllowed: false,
          needsConversationContext: false,
          supportLevelExpected: 'supported',
        }

        // Construct a minimal SheetVerificationResult that directs the plan reader
        // to the requested sheet without hard-gating.
        const verification: SheetVerificationResult = {
          verificationClass: 'measurement', // non-skip so plan reader will run
          questionType: 'C',
          wasVerified: false,
          verifiedFindings: [],
          sheetsInspected: [],
          candidateSheets: [sheetNumber],
          coverageStatus: 'insufficient',
          confirmedContext: '',
          evidenceGaps: [],
          missingEvidence: [],
        }

        const result = await runPlanReader(
          analysis,
          verification,
          projectId,
          supabase,
          memoryCtx.calloutPatterns
        )

        if (!result.wasRun) {
          return `Plan reader did not run: ${result.skipReason ?? 'unknown reason'}`
        }

        return result.formattedContext || 'Plan reader ran but found no relevant content.'
      } catch (err) {
        return `readDrawingPage error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })

  // ── Tool 5: checkSheetCoverage ────────────────────────────────────────────
  const checkSheetCoverage = tool({
    description:
      'Check which drawing sheets exist for a given topic or system. Returns available sheet numbers. Use to discover what sheets are available before reading them.',
    inputSchema: zodSchema(
      z.object({
        topic: z
          .string()
          .describe(
            'Topic, system name, or keyword to check coverage for, e.g. "WATER LINE A", "structural footings"'
          ),
      })
    ),
    execute: async ({ topic }: { topic: string }): Promise<string> => {
      try {
        const analysis: QueryAnalysis = {
          rawQuery: `Which sheets cover ${topic}?`,
          answerMode: 'sheet_lookup',
          entities: {},
          requestedSystems: [topic],
          retrievalHints: {
            preferredSources: ['vector_search'],
            keywords: [topic],
            needsCompleteDataset: false,
            isAggregation: false,
            needsVisionDBLookup: false,
          },
          inferenceAllowed: true,
          needsConversationContext: false,
          supportLevelExpected: 'partial',
        }

        // Call verifyBeforeAnswering — informational only, never block
        const result = await verifyBeforeAnswering(analysis, projectId, supabase)

        const sheets =
          result.candidateSheets.length > 0
            ? result.candidateSheets
            : result.sheetsInspected

        if (sheets.length === 0) {
          return `No indexed sheets found for topic: "${topic}". The project may not have been fully processed yet.`
        }

        const lines: string[] = [
          `Sheet coverage for "${topic}":`,
          `Available sheets: ${sheets.join(', ')}`,
        ]

        if (result.verifiedFindings.length > 0) {
          const shown = result.verifiedFindings.slice(0, 5)
          const truncated = result.verifiedFindings.length > 5 ? ` (showing 5 of ${result.verifiedFindings.length})` : ''
          lines.push(`\nVerified findings${truncated}:`)
          shown.forEach(f => {
            lines.push(`  - [${f.sheetNumber}] ${f.statement}`)
          })
        }

        if (result.evidenceGaps.length > 0) {
          lines.push(`\nGaps: ${result.evidenceGaps.join('; ')}`)
        }

        return lines.join('\n')
      } catch (err) {
        // Informational tool — never block; error is non-fatal
        return `checkSheetCoverage error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })

  // ── Tool 6: searchComponents ──────────────────────────────────────────────
  const searchComponents = tool({
    description:
      'Query component counts, schedules, and utility takeoffs from structured drawing data. Use for quantity questions: how many valves, total pipe length, fitting schedule, etc.',
    inputSchema: zodSchema(
      z.object({
        componentType: z
          .string()
          .optional()
          .describe(
            'Component type to count, e.g. "valve", "hydrant", "tee", "bend", "manhole"'
          ),
        utilitySystem: z
          .string()
          .optional()
          .describe('Utility system to filter by, e.g. "WATER LINE A", "STORM DRAIN B"'),
        sizeFilter: z
          .string()
          .optional()
          .describe('Size filter, e.g. "12-IN", "8-IN"'),
      })
    ),
    execute: async ({
      componentType,
      utilitySystem,
      sizeFilter,
    }: {
      componentType?: string
      utilitySystem?: string
      sizeFilter?: string
    }): Promise<string> => {
      try {
        if (componentType) {
          const result = await queryComponentCount(
            projectId,
            componentType,
            utilitySystem,
            sizeFilter
          )
          return result.formattedAnswer || 'No components found matching those criteria.'
        }

        if (utilitySystem) {
          const result = await queryAllComponentsByUtility(projectId, utilitySystem)
          return result.formattedAnswer || `No components found for utility system: ${utilitySystem}`
        }

        return 'Please provide either a componentType or utilitySystem to search for components.'
      } catch (err) {
        return `searchComponents error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })

  return {
    searchEntities,
    getSpecSection,
    searchRFIs,
    readDrawingPage,
    checkSheetCoverage,
    searchComponents,
  }
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** The return type of buildTools — use as the `tools` parameter in streamText. */
export type ProjectTools = ReturnType<typeof buildTools>
