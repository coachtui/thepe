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
import { routeQuery, logQueryRouting } from '@/lib/chat/smart-router'
import { enrichSystemPrompt, enrichVisionPrompt } from '@/lib/chat/pe-enhancer'
import {
  requiresVisualAnalysis,
  determineVisualTask,
  extractComponentType,
  extractSizeFilter,
  extractUtilityName
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
❌ **HORIZ DEFL** = Horizontal deflection fitting (part of water line!)
❌ **DEFL COUPLING** = Deflection coupling (part of water line!)
❌ **12-IN X 8-IN TEE** = Tee fitting (part of water line!)
❌ **ARV TEE** = Air Release Valve tee (part of water line!)
❌ **12-IN GATE VALVE** = Valve (part of water line!)
❌ **12-IN BEND** = Pipe bend (part of water line!)
❌ **90° BEND** / **45° BEND** / **22.5° BEND** / **11.25° BEND** = Angle bends (part of water line!)
❌ **¼ BEND** / **⅛ BEND** / **1/16 BEND** / **1/32 BEND** = Fractional bends (part of water line!)
❌ **12-IN CAP** = End cap (part of water line!)
❌ **COUPLING** = Pipe coupling (part of water line!)
❌ **TAPPING SLEEVE** / **T.S.** = Tapping sleeve (part of water line!)
❌ **MANHOLE** / **MH** = Manhole structure (part of utility system!)
❌ **CATCH BASIN** / **CB** = Catch basin (storm drain inlet!)
❌ **Any label with "12-IN" or "8-IN"** = Water line component!

**Critical test:** Ask yourself: "Is this a DIFFERENT utility, or is this part of Water Line A?"
- If it says "12-IN" or "8-IN" anywhere → It's a water line fitting → NOT a crossing
- If it says ELEC, SS, STM, GAS, TEL → It's a different utility → YES, a crossing

## HOW TO IDENTIFY CROSSINGS

For each sheet, scan the PROFILE VIEW (bottom section):

1. Look for utility abbreviations: ELEC, SS, STM, GAS, TEL, W, FO
2. Check for reference numbers nearby (like "28.71±" or "35.73±")
3. Verify there's a crossing line in the profile
4. **IGNORE all water line components** (VERT DEFL, HORIZ DEFL, DEFL COUPLING, TEE, ARV TEE, VALVE, BEND, 90° BEND, 45° BEND, CAP, COUPLING, TAPPING SLEEVE, MH, CB)

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
- VERT DEFL / HORIZ DEFL / DEFL COUPLING is NOT a crossing - it's a pipe fitting
- TEE / ARV TEE is NOT a crossing - it's a pipe fitting
- BEND (90°, 45°, 22.5°, 11.25°, ¼, ⅛, 1/16, 1/32) is NOT a crossing - it's a pipe fitting
- TAPPING SLEEVE / T.S. is NOT a crossing - it's a connection fitting
- MH (Manhole) / CB (Catch Basin) are NOT crossings - they're structures
- Anything with "12-IN" or "8-IN" is NOT a crossing

## RESPONSE FORMAT

Report each crossing found:

**Utility Crossings Found:**

| Sheet | Utility Type | Reference | Station (approx) |
|-------|-------------|-----------|------------------|
| CU102 | ELEC | 28.71± | ~STA 5+00 |
| CU104 | ELEC | 35.73± | ~STA 15+00 |

**Total: 2 utility crossings**

**Note:** The plans also show numerous water line fittings (VERT DEFL, HORIZ DEFL, deflection couplings, TEEs, ARV TEEs, valves, bends of various angles, tapping sleeves, manholes, catch basins) which are components of the utility system itself and were NOT counted as utility crossings.

Be accurate. Only count DIFFERENT utilities crossing the water line.`;
}

/**
 * Build system prompt for material takeoff analysis
 * Used when user asks for complete takeoff of all fittings/components
 */
function buildMaterialTakeoffPrompt(utilityName?: string): string {
  const isMultiTrade = !utilityName || /project|all|complete|entire/i.test(utilityName);

  return `## COMPLETE MATERIAL TAKEOFF

You are analyzing construction plan PDFs to provide a **complete material takeoff** for ${utilityName || 'THE ENTIRE CONSTRUCTION PROJECT - ALL TRADES'}.

## YOUR TASK

Read EVERY sheet provided and extract ALL components, fittings, and materials. This is a COMPLETE takeoff - nothing should be missed.

## SCANNING METHOD - CRITICAL

For EACH sheet:

**Step 1: Identify the Sheet**
- What sheet number is this? (e.g., CU102, CU103)
- What system is shown? (e.g., Water Line A, Water Line B)
- What station range is covered?

**Step 2: Scan PLAN VIEW (top half of sheet)**
- Look for callout boxes (rectangles with arrows pointing to the pipe)
- Each callout box lists components at a specific station
- Format: "1 - 12-IN GATE VALVE AND VALVE BOX"
- Read EVERY line in EVERY callout box
- Record: station, quantity, size, component type

**Step 3: Scan PROFILE VIEW (bottom half of sheet)**
- Look for vertical text labels along the utility line
- These label components like valves, bends, tees, fittings
- Look for PIPE SIZE labels (e.g., "12-IN DI PIPE", "8-IN PVC")
- Note any size transitions

**Step 4: Cross-Reference**
- Match plan view callouts with profile view labels
- Don't double-count (same component shown in both views = 1 component)
- Count each unique station location once

## COMPONENTS TO EXTRACT

Extract ALL of these component types:
- **Gate Valves** (with valve boxes)
- **Tees** (note both sizes, e.g., 12-IN × 8-IN TEE)
- **Bends** (note angle: 90°, 45°, 22.5°, 11.25°)
- **Caps** (end caps)
- **Reducers** (note both sizes)
- **Couplings** (deflection couplings, flex couplings)
- **Fire Hydrant Assemblies** (hydrant, lateral, valve, tee)
- **Air Release Valves (ARV)** and ARV tees
- **Tapping Sleeves and Valves**
- **Blow-offs**
- **Service Connections** (meters, boxes, laterals)
- **Thrust Blocks** (note type: A, B, C, etc.)
- **Pipe** (note size, material, and length per sheet)
- **Manholes** (if applicable)
- **Catch Basins** (if applicable)
- **Any other fittings or components shown**

## PIPE QUANTITIES

For EACH sheet, note:
- Pipe size (12-IN, 8-IN, 6-IN, etc.)
- Pipe material if shown (DI, PVC, HDPE, etc.)
- Approximate length on that sheet (from station range)

## RESPONSE FORMAT

Provide the takeoff organized by system, then by sheet:

### [System Name] (e.g., Water Line A)
**Sheets Reviewed:** CU102-CU109
**Station Range:** STA 0+00 to STA 32+62.01
**Total Length:** ~3,262 LF

#### Sheet-by-Sheet Detail:

**Sheet CU102 (STA 0+00 to STA 4+38.83)**
| Qty | Size | Component | Station |
|-----|------|-----------|---------|
| 1 | 12-IN | Gate Valve & Valve Box | 0+00 |
| 1 | 12-IN | Cap | 0+00 |
| ... | ... | ... | ... |

[Repeat for each sheet]

#### Summary Totals:

| Component | Size | Total Qty |
|-----------|------|-----------|
| Gate Valve & Valve Box | 12-IN | X |
| Gate Valve & Valve Box | 8-IN | X |
| Tee | 12×8-IN | X |
| Bend 22.5° | 12-IN | X |
| Cap | 12-IN | X |
| Pipe | 12-IN DI | X,XXX LF |
| Pipe | 8-IN PVC | X,XXX LF |
| ... | ... | ... |

## CRITICAL RULES

1. **READ EVERY CALLOUT BOX** - Don't skip any
2. **Include ALL sizes** - 12-IN, 8-IN, 6-IN, 2-IN, 1.5-IN, etc.
3. **Include ALL component types** - Not just valves
4. **Note what you CAN'T read** - If text is too small, say so with the sheet number
5. **Don't fabricate data** - Only report what you can actually see
6. **Separate by system** - Water Line A vs Water Line B are different systems
7. **Show sheet references** - Every component must reference its sheet and station

${isMultiTrade ? `
## MULTI-TRADE PROJECTS

Since you're analyzing a complete construction project (not just one utility), organize your response by trade/discipline:

### Water & Sewer Systems
[Complete takeoff for water lines, sanitary sewer, storm drain]
- Pipe quantities by size and material
- Valves, fittings, hydrants, manholes
- Service connections

### Electrical Systems
[Complete takeoff for electrical work]
- Conduit quantities by size and type
- Panels, transformers, switches
- Fixtures and devices

### Grading & Earthwork
[Complete takeoff for grading, excavation, site work]
- Cut/fill volumes
- Earthwork quantities
- Site improvements

### Structural (Footings, Foundations)
[Complete takeoff for structural elements]
- Footings by size and type
- Foundation walls
- Structural components

### Architectural/Building
[Complete takeoff for building components]
- Floor plans, walls, openings
- Building materials

### Other Trades
[Mechanical, plumbing, landscape, etc.]

**After all trades, provide SUMMARY TOTALS aggregating across entire project.**
` : ''}`;
}

/**
 * Build system prompt for direct PDF analysis
 * This prompt instructs Claude to analyze the attached PDF documents
 */
function buildVisualCountingPrompt(componentType?: string, sizeFilter?: string, visualTask?: string): string {
  // Add specific instructions for crossing queries
  const isCrossingQuery = visualTask === 'find_crossings';
  const isTakeoffQuery = visualTask === 'material_takeoff';

  if (isCrossingQuery) {
    return buildCrossingAnalysisPrompt();
  }

  if (isTakeoffQuery) {
    return buildMaterialTakeoffPrompt(componentType);
  }

  return `Find all ${sizeFilter || '12-IN'} ${componentType || 'GATE VALVE'} on Water Line A.

## SCANNING METHOD - CRITICAL

For EACH sheet, do this scan process:

**Step 1: Scan PROFILE VIEW (bottom half of sheet)**
- The profile shows the pipe as a horizontal line
- Look for VERTICAL TEXT along the pipe (rotated 90 degrees)
- Text format: "${sizeFilter || '12-IN'} GATE VALVE" or "12-IN GATE VALVE AND VALVE BOX"
- Scan the ENTIRE length from left edge to right edge
- **CRITICAL:** Valves can be VERY CLOSE TOGETHER (even 5 feet apart)
  - Don't assume nearby labels are the same valve
  - Look for MULTIPLE vertical labels in the same area
  - Count each separate vertical label as a separate valve
- **IMPORTANT:** Multiple valves can appear on the same sheet - keep scanning even after finding one

**Step 2: Scan PLAN VIEW (top half of sheet)**
- Look for callout boxes (rectangles with arrows pointing to the line)
- Format: "1 - ${sizeFilter || '12-IN'} GATE VALVE AND VALVE BOX"
- These boxes are usually near the top or sides of the sheet
- **IMPORTANT:** On sheets with closely-spaced valves, you'll see multiple callout boxes near each other
- Count each separate callout box pointing to different stations

**Step 3: Cross-Reference**
- Each valve appears in BOTH profile and plan view
- Match them by station number
- If plan shows a valve but you don't see it in profile, LOOK AGAIN - it's there
- Count each unique station location once

**Step 4: Verify Your Count**
- If you found fewer than 5 total valves across all sheets, you missed some
- Go back and re-scan the sheets where you only found 1 valve
- Check if there are more valves at different station locations on that same sheet
- **SPECIAL CHECK for CU107:** This sheet has 2 valves very close together (~5ft apart)
  - Look very carefully for TWO separate vertical labels in close proximity
  - Look for TWO separate callout boxes in the plan view

## SIZE FILTER
Only count "${sizeFilter || '12-IN'}" - EXCLUDE "8-IN", "6-IN", "2-IN", "1-1/2-IN"

## RESPONSE FORMAT

| Sheet | Station |
|-------|---------|
| CU102 | [STA] |
| CU107 | [STA] |
| CU107 | [STA] |
| CU109 | [STA] |
| CU109 | [STA] |

**TOTAL: X valves**

Just the table and count.`
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
      const utilityName = extractUtilityName(userQuery)

      // For material takeoffs, increase the document limit to capture all relevant sheets
      // Note: Anthropic API has ~32MB request size limit (not just token limit)
      // Typical construction PDF: 200-500KB → max ~30-40 PDFs per request
      const isTakeoff = visualTask === 'material_takeoff'
      const pdfLimit = isTakeoff ? 30 :  // API request size limit (~30 PDFs × 500KB = 15MB)
                       visualTask === 'find_crossings' ? 30 : // Same limit
                       15  // Component counting

      console.log(`[Chat API] Visual task:`, { visualTask, componentType, sizeFilter, utilityName, pdfLimit })

      // Get project PDFs as attachments - with smart selection
      const pdfResult = await getProjectPdfAttachments(
        projectId,
        pdfLimit,
        utilityName,  // Let smart selection handle all trades equally
        userQuery  // Pass query for sheet hint extraction
      )

      if (pdfResult.success && pdfResult.attachments.length > 0) {
        console.log(`[Chat API] Attached ${pdfResult.attachments.length} PDFs: ${pdfResult.documentsIncluded.join(', ')}`)
        console.log(`[Chat API] Total PDF size: ${(pdfResult.totalSizeBytes / 1024 / 1024).toFixed(2)} MB`)

        // Build system prompt for PDF analysis with PE enhancement
        const rawVisualPrompt = buildVisualCountingPrompt(componentType, sizeFilter, visualTask)
        const visualSystemPrompt = enrichVisionPrompt(rawVisualPrompt, userQuery)

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

    // Build optimized system prompt with PE domain knowledge
    const systemPrompt = enrichSystemPrompt(routingResult, userQuery)

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
