/**
 * Mobile API Route: Chat with Claude (Bearer Token Auth)
 *
 * This is an isolated mobile endpoint that handles Bearer token authentication
 * while maintaining the exact same vision query logic as the web endpoint.
 *
 * CRITICAL: This file does NOT share code with web - it's a separate path
 * to avoid breaking the working web functionality.
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import Anthropic from '@anthropic-ai/sdk'
import { streamText } from 'ai'
import { NextRequest } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/supabase/types'
import { routeQuery, buildSystemPrompt, logQueryRouting } from '@/lib/chat/smart-router'
import {
  requiresVisualAnalysis,
  determineVisualTask,
  extractComponentType,
  extractSizeFilter
} from '@/lib/chat/visual-analysis'
import {
  getProjectPdfAttachments,
  buildMessageWithPdfAttachments
} from '@/lib/chat/pdf-attachment'

// Initialize Anthropic clients
const anthropicAI = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const anthropicDirect = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

/**
 * Build system prompt for utility crossing analysis
 */
function buildCrossingAnalysisPrompt(): string {
  return `## UTILITY CROSSING ANALYSIS

You are analyzing construction plan PDFs to find UTILITY CROSSINGS.

**CRITICAL: Understand what a utility crossing IS and IS NOT**

## WHAT IS A UTILITY CROSSING?

A utility crossing occurs when a **DIFFERENT** utility (not Water Line A) crosses over or under the water line.

**Pattern in profile view:**
\`\`\`
ELEC        ← Utility type label
28.71±      ← Reference elevation/number
  |         ← Visual crossing line
════╪════   ← Water Line A (the main utility)
\`\`\`

**Utilities that CAN cross:**
- **ELEC** / **ELECTRICAL** = Electrical line
- **SS** = Sanitary Sewer
- **STM** = Storm Drain
- **GAS** = Gas line
- **TEL** / **TELEPHONE** = Telephone
- **W** = Different water line (not Water Line A)
- **FO** = Fiber optic

## WHAT IS NOT A UTILITY CROSSING

**These are WATER LINE A COMPONENTS (NOT crossings):**

❌ **VERT DEFL** = Vertical deflection fitting (part of water line!)
❌ **12-IN X 8-IN TEE** = Tee fitting (part of water line!)
❌ **12-IN GATE VALVE** = Valve (part of water line!)
❌ **12-IN BEND** = Pipe bend (part of water line!)
❌ **12-IN CAP** = End cap (part of water line!)
❌ **COUPLING** = Pipe coupling (part of water line!)
❌ **Any label with "12-IN" or "8-IN"** = Water line component!

**Critical test:** Ask yourself: "Is this a DIFFERENT utility, or is this part of Water Line A?"
- If it says "12-IN" or "8-IN" anywhere → It's a water line fitting → NOT a crossing
- If it says ELEC, SS, STM, GAS, TEL → It's a different utility → YES, a crossing

## HOW TO IDENTIFY CROSSINGS

For each sheet, scan the PROFILE VIEW (bottom section):

1. Look for utility abbreviations: ELEC, SS, STM, GAS, TEL, W, FO
2. Check for reference numbers nearby (like "28.71±" or "35.73±")
3. Verify there's a crossing line in the profile
4. **IGNORE all water line components** (VERT DEFL, TEE, VALVE, BEND, CAP)

## EXAMPLES

**Example 1 - YES, this is a crossing:**
Sheet CU102 profile view shows:
- Label "ELEC" with "28.71±"
- Vertical line crossing water line
- Analysis: Electrical utility crossing at elevation 28.71
- Count: 1 crossing ✓

**Example 2 - NO, this is NOT a crossing:**
Profile view shows:
- Label "VERT DEFL CLEC"
- Analysis: This is a vertical deflection fitting ON Water Line A
- Count: 0 crossings ✗

**Example 3 - NO, this is NOT a crossing:**
Plan view callout shows:
- "1 - 12-IN X 8-IN TEE"
- Analysis: This is a tee fitting that's PART of Water Line A
- Count: 0 crossings ✗

## SANITY CHECK

- Water line projects typically have **0-5 utility crossings**
- If you find 10+ crossings, you're probably counting water line fittings by mistake
- VERT DEFL is NOT a crossing - it's a pipe fitting
- TEE is NOT a crossing - it's a pipe fitting
- Anything with "12-IN" or "8-IN" is NOT a crossing

## RESPONSE FORMAT

Report each crossing found:

**Utility Crossings Found:**

| Sheet | Utility Type | Reference | Station (approx) |
|-------|-------------|-----------|------------------|
| CU102 | ELEC | 28.71± | ~STA 5+00 |
| CU104 | ELEC | 35.73± | ~STA 15+00 |

**Total: 2 utility crossings**

**Note:** The plans also show numerous water line fittings (VERT DEFL, TEEs, valves, bends) which are components of Water Line A itself and were NOT counted as utility crossings.

Be accurate. Only count DIFFERENT utilities crossing the water line.`;
}

/**
 * Build system prompt for direct PDF analysis
 */
function buildVisualCountingPrompt(componentType?: string, sizeFilter?: string, visualTask?: string): string {
  const isCrossingQuery = visualTask === 'find_crossings';

  if (isCrossingQuery) {
    return buildCrossingAnalysisPrompt();
  }
  return `## CONSTRUCTION PLAN ANALYSIS ASSISTANT

**CRITICAL: Read the actual PDFs attached. COUNT WHAT YOU SEE.**

${componentType ? `**Component to find:** ${componentType}` : ''}
${sizeFilter ? `**Size filter:** ${sizeFilter} ONLY - exclude other sizes` : ''}

## SHEET LAYOUT

Construction plan sheets have TWO sections:

**PLAN VIEW (Top 50-60%)**
- Overhead view showing layout
- May have callout boxes

**PROFILE VIEW (Bottom 40-50%)**
- Side view with elevations
- Station scale at bottom (0+00, 5+00, etc.)
- **VERTICAL TEXT LABELS** (90° rotated) along the line
- THIS IS WHERE TO COUNT COMPONENTS

## SCANNING METHOD

**CRITICAL: Scan SLOWLY left-to-right across the PROFILE VIEW**

1. Look at profile view (bottom section with elevations)
2. Start at LEFT edge
3. Scan slowly RIGHT across the entire width
4. Look for VERTICAL text labels along the utility line
5. Note station number for each label from scale below

**KEY POINTS:**
- Vertical labels are SMALL and EASY TO MISS
- Some sheets may have MULTIPLE labels close together
- Each "12-IN GATE VALVE" label = 1 component
- Check ENTIRE width - don't stop early

## SIZE FILTERING

**CRITICAL - THESE ARE DIFFERENT:**
- "12-IN" = twelve inch ✓ COUNT
- "8-IN" = eight inch ✗ EXCLUDE
- "1-1/2-IN" = NOT twelve inch ✗ EXCLUDE

Only count items marked "${sizeFilter || '12-IN'}".

## RESPONSE FORMAT

For EACH sheet report what you found:

**Sheet [NAME]:**
- Profile view scan results: [List each label with station]
- Count: [Number]

Then:
- **TOTAL COUNT**
- **BREAKDOWN BY SHEET**
- **CONFIDENCE**

Be thorough. Scan the ENTIRE profile view on each sheet, especially looking for labels that may be close together.

## CRITICAL: CONSTRUCTION TERMINOLOGY

### WATER LINE COMPONENTS vs UTILITY CROSSINGS

**I MUST understand this distinction:**

**WATER LINE COMPONENTS (Part of Water Line A - NOT crossings):**
- **VERT DEFL** = Vertical deflection fitting (changes pipe elevation)
- **TEE** (e.g., "12-IN X 8-IN TEE") = Tee fitting where branch connects
- **BEND** = Elbow/bend fitting
- **GATE VALVE** = Valve on the water line
- **CAP** = End cap
- **COUPLING** = Pipe coupling/joint
- **WRAP** = Protective wrapping
- **SLEEVE** = Tapping sleeve
- **Any fitting with "12-IN" or "8-IN"** = Part of the water line itself

These are components ON Water Line A, NOT utilities crossing it.

**ACTUAL UTILITY CROSSINGS (Different utilities crossing Water Line A):**

A crossing occurs when a DIFFERENT utility (not Water Line A) crosses over/under.

**Pattern in profile view:**
\`\`\`
ELEC        ← Utility label (NOT "VERT DEFL")
28.71±      ← Reference number
  |         ← Crossing line
════╪════   ← Water Line A
\`\`\`

**Utility types that CAN cross:**
- **ELEC** / **ELECTRICAL** = Electrical
- **SS** = Sanitary Sewer
- **STM** = Storm Drain
- **GAS** = Gas line
- **TEL** = Telephone
- **W** = Different water line

**How to identify:**
✅ YES crossing: "ELEC" with "28.71±" and crossing line
✅ YES crossing: "SS" with elevation reference
❌ NOT crossing: "VERT DEFL" (water line fitting!)
❌ NOT crossing: "12-IN X 8-IN TEE" (water line fitting!)
❌ NOT crossing: "12-IN GATE VALVE" (water line component!)

**Critical test:** Is this a DIFFERENT utility, or part of Water Line A?
- Contains "12-IN" or "8-IN" → Part of water line → NOT crossing
- Says ELEC, SS, STM, GAS, TEL → Different utility → YES crossing

**Sanity check:** Projects typically have 0-5 crossings. Finding 10+ means I'm probably counting water line fittings by mistake.`
}

/**
 * Create authenticated Supabase client from Bearer token
 */
function createAuthenticatedClient(token: string) {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  )
}

export async function POST(request: NextRequest) {
  try {
    // Extract Bearer token from Authorization header
    const authHeader = request.headers.get('authorization')

    if (!authHeader?.startsWith('Bearer ')) {
      return new Response('Unauthorized - Bearer token required', { status: 401 })
    }

    const token = authHeader.slice(7) // Remove 'Bearer ' prefix

    // Create authenticated Supabase client
    const supabase = createAuthenticatedClient(token)

    // Verify authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('[Mobile Chat] Auth error:', authError?.message)
      return new Response('Unauthorized - Invalid token', { status: 401 })
    }

    console.log('[Mobile Chat] Authenticated user:', user.id)

    // Get request parameters
    const { messages, projectId } = await request.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response('Messages array is required', { status: 400 })
    }

    if (!projectId) {
      return new Response('Project ID is required', { status: 400 })
    }

    // Get the latest user message
    const latestMessage = messages[messages.length - 1]
    if (latestMessage.role !== 'user') {
      return new Response('Last message must be from user', { status: 400 })
    }

    const userQuery = latestMessage.content

    console.log(`[Mobile Chat] Processing query: "${userQuery}"`)
    console.log(`[Mobile Chat] Project ID: ${projectId}`)

    // CHECK: Does this query need direct visual analysis?
    const needsVision = requiresVisualAnalysis(userQuery)

    if (needsVision) {
      console.log(`[Mobile Chat] 📄 PDF ANALYSIS MODE - Attaching project PDFs directly to Claude`)

      // Get visual task details
      const visualTask = determineVisualTask(userQuery)
      const componentType = extractComponentType(userQuery)
      const sizeFilter = extractSizeFilter(userQuery)

      console.log(`[Mobile Chat] Visual task:`, { visualTask, componentType, sizeFilter })

      // Get project PDFs as attachments (using authenticated mobile client)
      // Note: Can't use shared getProjectPdfAttachments() because it creates cookie-based client
      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('id, filename, file_path, sheet_number, document_type')
        .eq('project_id', projectId)
        .order('filename')

      if (docsError || !documents || documents.length === 0) {
        console.log(`[Mobile Chat] No documents found:`, docsError?.message)
        // Fall through to standard routing
      }

      const pdfDocuments = documents ? documents.filter(doc => doc.filename.toLowerCase().endsWith('.pdf')) : []
      const docsToProcess = pdfDocuments.slice(0, 8)

      const attachments: Array<{ filename: string; sheetNumber: string; base64: string; sizeBytes: number }> = []
      let totalSizeBytes = 0

      for (const doc of docsToProcess) {
        try {
          const { data: fileData, error: downloadError } = await supabase.storage
            .from('documents')
            .download(doc.file_path)

          if (downloadError || !fileData) {
            console.error(`[Mobile Chat] Error downloading ${doc.filename}:`, downloadError)
            continue
          }

          const arrayBuffer = await fileData.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const base64 = buffer.toString('base64')

          attachments.push({
            filename: doc.filename,
            sheetNumber: doc.sheet_number || doc.filename.replace('.pdf', ''),
            base64,
            sizeBytes: buffer.length
          })

          totalSizeBytes += buffer.length
          console.log(`[Mobile Chat] Added ${doc.filename} (${(buffer.length / 1024).toFixed(0)} KB)`)
        } catch (err) {
          console.error(`[Mobile Chat] Error processing ${doc.filename}:`, err)
        }
      }

      const pdfResult = {
        success: attachments.length > 0,
        attachments,
        documentsIncluded: attachments.map(a => a.sheetNumber),
        totalSizeBytes
      }

      if (pdfResult.success && pdfResult.attachments.length > 0) {
        console.log(`[Mobile Chat] Attached ${pdfResult.attachments.length} PDFs: ${pdfResult.documentsIncluded.join(', ')}`)
        console.log(`[Mobile Chat] Total PDF size: ${(pdfResult.totalSizeBytes / 1024 / 1024).toFixed(2)} MB`)

        // Build system prompt for PDF analysis
        const visualSystemPrompt = buildVisualCountingPrompt(componentType, sizeFilter, visualTask)

        // Build message content with PDF attachments
        const messageContent = buildMessageWithPdfAttachments(pdfResult.attachments, userQuery)

        // Use Anthropic SDK directly for PDF document support with streaming
        const stream = anthropicDirect.messages.stream({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          system: visualSystemPrompt,
          messages: [
            // Include previous conversation context
            ...messages.slice(0, -1).map((m: any) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content as string,
            })),
            // Add current message with PDF attachments
            {
              role: 'user' as const,
              content: messageContent as any,
            },
          ],
          temperature: 0.3, // Lower temperature for counting accuracy
        })

        // Log query for analytics
        logQueryRouting(
          projectId,
          user.id,
          userQuery,
          {
            classification: {
              type: 'quantity',
              confidence: 0.9,
              intent: 'quantitative',
              itemName: componentType,
              needsDirectLookup: false,
              needsVectorSearch: false,
              needsVision: true,
              needsCompleteData: true,
              isAggregationQuery: false,
              searchHints: {}
            },
            method: 'visual_analysis',
            context: `Direct PDF analysis of ${pdfResult.attachments.length} documents`,
            formattedContext: `Documents analyzed: ${pdfResult.documentsIncluded.join(', ')}`,
            directLookup: null,
            vectorResults: [],
            metadata: {
              totalResults: pdfResult.attachments.length,
              directLookupUsed: false,
              vectorSearchUsed: false,
              processingTimeMs: 0
            },
            needsVisualAnalysis: true,
            visualAnalysisTask: visualTask
          },
          undefined,
          true
        ).catch(err => console.error('Error logging query:', err))

        // Return streaming response from Anthropic SDK
        const encoder = new TextEncoder()
        const readableStream = new ReadableStream({
          async start(controller) {
            try {
              for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                  controller.enqueue(encoder.encode(event.delta.text))
                }
              }
              controller.close()
            } catch (error) {
              controller.error(error)
            }
          }
        })

        return new Response(readableStream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Transfer-Encoding': 'chunked',
          },
        })
      } else {
        console.log(`[Mobile Chat] Failed to get PDFs, falling back to standard routing: ${pdfResult.error}`)
      }
    }

    // STANDARD ROUTING: Use the intelligent query routing system
    const routingResult = await routeQuery(userQuery, projectId, {
      includeMetadata: false,
      maxResults: 15
    })

    console.log(`[Mobile Chat] Routing result:`, {
      type: routingResult.classification.type,
      method: routingResult.method,
      totalResults: routingResult.metadata.totalResults,
      processingTime: `${routingResult.metadata.processingTimeMs}ms`,
      needsVisualAnalysis: routingResult.needsVisualAnalysis,
      visualAnalysisTask: routingResult.visualAnalysisTask
    })

    // Build optimized system prompt
    const systemPrompt = buildSystemPrompt(routingResult)

    // Stream response from Claude
    const result = streamText({
      model: anthropicAI('claude-sonnet-4-5-20250929'),
      system: systemPrompt,
      messages: messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: 0.7,
    })

    // Log query for analytics
    logQueryRouting(
      projectId,
      user.id,
      userQuery,
      routingResult,
      undefined,
      true
    ).catch(err => console.error('Error logging query:', err))

    // Return streaming response
    return result.toTextStreamResponse()
  } catch (error) {
    console.error('[Mobile Chat] Error:', error)
    return new Response(
      error instanceof Error ? error.message : 'Chat request failed',
      { status: 500 }
    )
  }
}
