/**
 * API Route: Chat with Claude
 * Phase 3: AI Chat Assistant with Smart RAG
 *
 * This endpoint uses intelligent query routing to:
 * 1. Classify query intent
 * 2. Route to best data source (direct lookup, vector search, or hybrid)
 * 3. Combine results with boosting and re-ranking
 * 4. Stream response from Claude with optimized context
 *
 * QUANTITATIVE QUERIES: Attaches project PDFs directly to Claude for
 * accurate visual analysis - no database extraction needed.
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import Anthropic from '@anthropic-ai/sdk'
import { streamText } from 'ai'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/db/supabase/server'
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
// Vercel AI SDK client for standard streaming
const anthropicAI = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Direct Anthropic SDK for PDF document attachments
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
 * This prompt instructs Claude to analyze the attached PDF documents
 */
function buildVisualCountingPrompt(componentType?: string, sizeFilter?: string, visualTask?: string): string {
  // Add specific instructions for crossing queries
  const isCrossingQuery = visualTask === 'find_crossings';

  if (isCrossingQuery) {
    return buildCrossingAnalysisPrompt();
  }
  return `## CONSTRUCTION PLAN ANALYSIS ASSISTANT

You are analyzing construction plan PDF documents. Your task is to examine the attached PDFs and extract accurate information.

**CRITICAL: Read the actual PDFs attached to this message. Don't guess. COUNT WHAT YOU ACTUALLY SEE.**

${componentType ? `**Component to find:** ${componentType}` : ''}
${sizeFilter ? `**Size filter:** ${sizeFilter} ONLY - exclude other sizes` : ''}

## SHEET LAYOUT - UNDERSTAND THIS FIRST

Most construction plan sheets have TWO MAIN SECTIONS:

**PLAN VIEW (Top 50-60% of sheet)**
- Aerial/overhead view showing horizontal layout
- May have callout boxes pointing to components
- Shows spatial arrangement

**PROFILE VIEW (Bottom 40-50% of sheet)**
- Side view showing vertical alignment
- HAS A STATION SCALE AT THE BOTTOM (0+00, 5+00, 10+00, etc.)
- Contains **VERTICAL TEXT LABELS** rotated 90° along the utility line
- THIS IS THE PRIMARY SOURCE FOR COMPONENT COUNTS

## CRITICAL SCANNING METHOD - YOU MUST DO THIS

**STEP 1: SCAN THE PROFILE VIEW FIRST (Bottom section)**

Profile views contain **VERTICAL TEXT LABELS** that are easy to miss:
- Text is ROTATED 90 DEGREES (reads bottom-to-top or top-to-bottom)
- Labels are positioned directly on or next to the utility line
- Format: "12-IN GATE VALVE" (written vertically)
- These labels are SMALL - scan carefully left to right
- Each vertical label = 1 component

**SCANNING TECHNIQUE:**
1. Look at the PROFILE VIEW (bottom section with elevations)
2. Start at the LEFT side, scan slowly to the RIGHT
3. Look for ANY vertical text along the utility line
4. Note EVERY "12-IN GATE VALVE" (or whatever component) you see
5. Record the approximate station from the scale below

**STEP 2: CHECK PLAN VIEW CALLOUT BOXES (Top section)**

After scanning profile, check for callout boxes in plan view:
- Rectangular boxes with arrows pointing to the line
- Format: "1 - 12-IN GATE VALVE AND VALVE BOX"
- These may duplicate what's in profile view

**STEP 3: CROSS-REFERENCE TO AVOID DUPLICATES**

- Same station in profile AND callout box = same valve (count ONCE)
- Different stations = different valves (count each)
- When in doubt, use station numbers to determine if it's a duplicate

## SIZE FILTERING IS CRITICAL

**READ CAREFULLY - THESE ARE DIFFERENT:**
- "12-IN" = twelve inch (12 inches) ✓ COUNT THIS
- "8-IN" = eight inch (NOT twelve inch!) ✗ EXCLUDE
- "1-1/2-IN" = one and a half inch (looks like "12" but is NOT!) ✗ EXCLUDE

If user asks for "12 inch valves", ONLY count items explicitly marked "12-IN".

## WHAT YOU SHOULD FIND (EXPECTED RESULTS)

For a typical water line project:
- CU102: Check profile view - there should be a valve at the START of the line (STA 0+00)
- CU103-CU106: Usually no valves on intermediate sheets (just pipe)
- CU107: Often has valves at intermediate stations - CHECK FOR MULTIPLE LABELS
- CU108: Usually no valves (intermediate sheet)
- CU109: End of line valves - often has BOTH 12-IN and 8-IN valves

**DOUBLE-CHECK EACH SHEET:**
After scanning each sheet, ask yourself:
- "Did I scan the entire profile view from left to right?"
- "Did I look carefully for small vertical labels?"
- "Could I have missed any labels near the edges or at specific stations?"

## RESPONSE FORMAT

For each sheet, report EVERYTHING you found:

**Sheet [NAME]:**
- Profile view: [List each vertical label you found with station]
- Plan view callouts: [List any callout boxes]
- Count for this sheet: [Number of target components]

Then provide:
- **TOTAL COUNT** across all sheets
- **BREAKDOWN BY SHEET** (so user can verify)
- **CONFIDENCE LEVEL**
- **NOTES** about anything uncertain

## EXAMPLE THOROUGH RESPONSE

"I carefully scanned each attached PDF, focusing on the profile view vertical labels.

**Sheet CU102:**
- Profile view scan (left to right): Found vertical label "12-IN GATE VALVE" near STA 0+00
- Plan view: Corresponding callout box at same location (same valve, not duplicate)
- **Count: 1 twelve-inch gate valve**

**Sheets CU103-CU106:**
- Scanned profile views on each - no gate valve labels found
- These sheets show continuous pipe without valve fittings
- **Count: 0 twelve-inch gate valves**

**Sheet CU107:**
- Profile view scan: Found "12-IN GATE VALVE" at approximately STA 24+93
- Continued scanning: Found ANOTHER "12-IN GATE VALVE" at approximately STA 25+98
- **Count: 2 twelve-inch gate valves**

**Sheet CU108:**
- Scanned profile view - no valve labels
- **Count: 0 twelve-inch gate valves**

**Sheet CU109:**
- Profile view scan: Found "12-IN GATE VALVE" at two locations
- Also found "8-IN GATE VALVE" labels (excluded per size filter)
- **Count: 2 twelve-inch gate valves** (plus 3 eight-inch excluded)

**═══════════════════════════════════════**
**TOTAL: 5 twelve-inch gate valves**
- CU102: 1
- CU107: 2
- CU109: 2
**═══════════════════════════════════════**

**Confidence: High** - I scanned each profile view carefully and all labels were readable.
**Note:** CU109 also contains 8-inch valves which were excluded from this count per the size filter."

Be thorough. Scan carefully. Report everything you find.

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


export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Get request parameters
    const { messages, projectId } = await request.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response('Messages array is required', { status: 400 })
    }

    if (!projectId) {
      return new Response('Project ID is required', { status: 400 })
    }

    // Get the latest user message for RAG search
    const latestMessage = messages[messages.length - 1]
    if (latestMessage.role !== 'user') {
      return new Response('Last message must be from user', { status: 400 })
    }

    const userQuery = latestMessage.content

    console.log(`[Chat API] Processing query: "${userQuery}"`)
    console.log(`[Chat API] Project ID: ${projectId}`)

    // CHECK: Does this query need direct visual analysis?
    const needsVision = requiresVisualAnalysis(userQuery)

    if (needsVision) {
      console.log(`[Chat API] 📄 PDF ANALYSIS MODE - Attaching project PDFs directly to Claude`)

      // Get visual task details
      const visualTask = determineVisualTask(userQuery)
      const componentType = extractComponentType(userQuery)
      const sizeFilter = extractSizeFilter(userQuery)

      console.log(`[Chat API] Visual task:`, { visualTask, componentType, sizeFilter })

      // Get project PDFs as attachments
      const pdfResult = await getProjectPdfAttachments(projectId, 8)

      if (pdfResult.success && pdfResult.attachments.length > 0) {
        console.log(`[Chat API] Attached ${pdfResult.attachments.length} PDFs: ${pdfResult.documentsIncluded.join(', ')}`)
        console.log(`[Chat API] Total PDF size: ${(pdfResult.totalSizeBytes / 1024 / 1024).toFixed(2)} MB`)

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
        console.log(`[Chat API] Failed to get PDFs, falling back to standard routing: ${pdfResult.error}`)
      }
    }

    // STANDARD ROUTING: Use the intelligent query routing system
    const routingResult = await routeQuery(userQuery, projectId, {
      includeMetadata: false, // Don't include boost scores in context for cleaner output
      maxResults: 15
    })

    console.log(`[Chat API] Routing result:`, {
      type: routingResult.classification.type,
      method: routingResult.method,
      totalResults: routingResult.metadata.totalResults,
      processingTime: `${routingResult.metadata.processingTimeMs}ms`,
      needsVisualAnalysis: routingResult.needsVisualAnalysis,
      visualAnalysisTask: routingResult.visualAnalysisTask
    })

    // Log visual analysis recommendation if applicable
    if (routingResult.needsVisualAnalysis) {
      console.log(`[Chat API] Visual analysis recommended:`, {
        task: routingResult.visualAnalysisTask,
        params: routingResult.visualAnalysisParams
      })
    }

    // Build optimized system prompt based on query type and results
    const systemPrompt = buildSystemPrompt(routingResult)

    // Stream response from Claude with full conversation history
    const result = streamText({
      model: anthropicAI('claude-sonnet-4-5-20250929'),
      system: systemPrompt,
      messages: messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: 0.7,
    })

    // Log query for analytics (async, don't await)
    logQueryRouting(
      projectId,
      user.id,
      userQuery,
      routingResult,
      undefined, // Response text will be added later if needed
      true
    ).catch(err => console.error('Error logging query:', err))

    // Return streaming response
    return result.toTextStreamResponse()
  } catch (error) {
    console.error('[Chat API] Error:', error)
    return new Response(
      error instanceof Error ? error.message : 'Chat request failed',
      { status: 500 }
    )
  }
}
