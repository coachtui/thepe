# Vision Query Standard

This document defines the **standard approach** for all visual analysis queries in the construction plan AI assistant. This pattern has been tested and works accurately for counting components, finding crossings, determining lengths, and answering complex construction plan questions.

**This is the canonical reference. All future query features MUST follow this pattern.**

---

## Architecture Overview

```
User Query
    │
    ▼
┌─────────────────────────────────────┐
│  Query Classification (smart-router) │
│  - Detects if vision is needed       │
│  - Extracts component type, size     │
│  - Identifies visual task type       │
└─────────────────────────────────────┘
    │
    ▼ (if needsVision = true)
┌─────────────────────────────────────┐
│  PDF Attachment (pdf-attachment.ts)  │
│  - Fetches PDFs from Supabase        │
│  - Converts to base64                │
│  - Attaches directly to Claude       │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Visual Analysis Prompt              │
│  - Task-specific system prompt       │
│  - Construction terminology          │
│  - Scanning methodology              │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Claude Sonnet 4.5 with PDFs         │
│  - Reads actual PDF documents        │
│  - Follows scanning instructions     │
│  - Returns structured answer         │
└─────────────────────────────────────┘
    │
    ▼
Streaming Response to User
```

---

## Core Principle: PDF Attachment, Not Image Conversion

**DO:** Attach PDFs directly using Claude's document support
```typescript
const messageContent = [
  {
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: pdfBase64
    }
  },
  {
    type: 'text',
    text: userQuery
  }
];
```

**DON'T:** Convert PDFs to images first (unreliable, lossy)

---

## Step 1: Query Classification

Location: `src/lib/chat/smart-router.ts`

The router must detect:
1. **needsVision**: Does this query require looking at the actual plans?
2. **componentType**: What component is being asked about? (e.g., "gate valve")
3. **sizeFilter**: What size? (e.g., "12-IN" vs "8-IN")
4. **visualTask**: What type of visual analysis? (e.g., "count_components", "find_crossings")

### Visual Task Types

```typescript
type VisualTask =
  | 'count_components'    // "How many valves?"
  | 'find_crossings'      // "What utilities cross the water line?"
  | 'find_terminations'   // "Where does the line start/end?"
  | 'measure_length'      // "How long is the water line?"
  | 'locate_component'    // "Where is the fire hydrant?"
  | 'general_analysis';   // Open-ended visual questions
```

### Detection Patterns

```typescript
// Counting queries
/how\s+many|count|total|number\s+of|quantity/i

// Crossing queries
/cross(ing|es)?|utility.*cross|what.*cross/i

// Length queries
/how\s+long|length|footage|linear\s+feet/i

// Location queries
/where\s+is|locate|find|show\s+me/i
```

---

## Step 2: PDF Attachment

Location: `src/lib/chat/pdf-attachment.ts`

### Key Functions

```typescript
// Get PDFs for a project
const pdfResult = await getProjectPdfAttachments(
  projectId,
  maxDocuments,  // Default: 8
  systemFilter   // Optional: "Water Line A"
);

// Build message with attachments
const messageContent = buildMessageWithPdfAttachments(
  pdfResult.attachments,
  userQuery
);
```

### Size Limits
- Max 8 documents per request (Claude limit consideration)
- Total size logged for monitoring
- PDFs fetched from Supabase storage

---

## Step 3: Visual Analysis Prompts

Location: `src/app/api/chat/route.ts`

### Critical Prompt Components

Every visual analysis prompt MUST include:

#### 1. Sheet Layout Education
```
Most construction plan sheets have TWO MAIN SECTIONS:

**PLAN VIEW (Top 50-60% of sheet)**
- Aerial/overhead view showing horizontal layout
- May have callout boxes pointing to components

**PROFILE VIEW (Bottom 40-50% of sheet)**
- Side view showing vertical alignment
- HAS A STATION SCALE AT THE BOTTOM (0+00, 5+00, etc.)
- Contains VERTICAL TEXT LABELS rotated 90°
- THIS IS THE PRIMARY SOURCE FOR COMPONENT COUNTS
```

#### 2. Scanning Methodology
```
**SCANNING TECHNIQUE:**
1. Look at the PROFILE VIEW (bottom section with elevations)
2. Start at the LEFT side, scan slowly to the RIGHT
3. Look for ANY vertical text along the utility line
4. Note EVERY component label you see
5. Record the approximate station from the scale below
```

#### 3. Size Filtering Instructions
```
**READ CAREFULLY - THESE ARE DIFFERENT:**
- "12-IN" = twelve inch ✓ COUNT THIS
- "8-IN" = eight inch ✗ EXCLUDE
- "1-1/2-IN" = one and a half inch ✗ EXCLUDE

If user asks for "12 inch valves", ONLY count items marked "12-IN".
```

#### 4. Construction Terminology (Critical!)
```
**WATER LINE COMPONENTS (Part of Water Line A - NOT crossings):**
- VERT DEFL = Vertical deflection fitting
- TEE = Tee fitting where branch connects
- GATE VALVE = Valve on the water line
- BEND = Elbow/bend fitting
- CAP = End cap

**ACTUAL UTILITY CROSSINGS (Different utilities):**
- ELEC = Electrical line
- SS = Sanitary Sewer
- STM = Storm Drain
- GAS = Gas line
```

#### 5. Response Format Specification
```
For each sheet, report EVERYTHING you found:

**Sheet [NAME]:**
- Profile view: [List each label with station]
- Plan view callouts: [List any callout boxes]
- Count for this sheet: [Number]

**TOTAL COUNT** across all sheets
**BREAKDOWN BY SHEET** (for verification)
**CONFIDENCE LEVEL**
```

---

## Step 4: API Implementation

Location: `src/app/api/chat/route.ts`

### Standard Pattern

```typescript
// 1. Check if vision is needed
const classification = await classifyQuery(userQuery);

if (classification.needsVision) {
  // 2. Get PDF attachments
  const pdfResult = await getProjectPdfAttachments(projectId, 8);

  if (pdfResult.success && pdfResult.attachments.length > 0) {
    // 3. Build task-specific prompt
    const systemPrompt = buildVisualCountingPrompt(
      classification.componentType,
      classification.sizeFilter,
      classification.visualTask
    );

    // 4. Build message with PDF attachments
    const messageContent = buildMessageWithPdfAttachments(
      pdfResult.attachments,
      userQuery
    );

    // 5. Call Claude with PDFs attached
    const stream = anthropicDirect.messages.stream({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: messageContent
      }],
      temperature: 0.3  // Lower for accuracy
    });

    // 6. Stream response
    return new Response(stream.toReadableStream());
  }
}
```

---

## Adding New Query Types

When adding a new visual query feature:

### 1. Add Detection Pattern to Router

```typescript
// In smart-router.ts
if (/your.*new.*pattern/i.test(query)) {
  return {
    needsVision: true,
    visualTask: 'your_new_task',
    // ... other fields
  };
}
```

### 2. Create Task-Specific Prompt Builder

```typescript
// In route.ts
function buildYourNewTaskPrompt(): string {
  return `## YOUR NEW TASK ANALYSIS

You are analyzing construction plan PDFs to [TASK DESCRIPTION].

**CRITICAL: [Key distinction or rule]**

## WHAT TO LOOK FOR
[Detailed instructions]

## WHAT TO IGNORE
[Common mistakes to avoid]

## RESPONSE FORMAT
[Expected output structure]
`;
}
```

### 3. Add to Prompt Selection Logic

```typescript
function buildVisualCountingPrompt(
  componentType?: string,
  sizeFilter?: string,
  visualTask?: string
): string {
  if (visualTask === 'your_new_task') {
    return buildYourNewTaskPrompt();
  }
  // ... existing logic
}
```

### 4. Test Thoroughly

- Test with actual construction plans
- Verify accuracy against known answers
- Check for common misinterpretations
- Ensure terminology education is sufficient

---

## Prompt Engineering Principles

### 1. Teach Domain Knowledge
Claude doesn't inherently know construction terminology. The prompt must educate:
- What components look like on plans
- How profile views vs plan views work
- What abbreviations mean
- What IS and IS NOT a particular thing

### 2. Provide Scanning Methodology
Don't just ask "count the valves." Tell Claude HOW to scan:
- Where to look (profile view)
- How to scan (left to right)
- What to look for (vertical text labels)
- How to avoid duplicates

### 3. Include Sanity Checks
```
**Sanity check:** Projects typically have 0-5 crossings.
Finding 10+ means you're probably counting water line fittings.
```

### 4. Specify Response Format
Always tell Claude exactly how to structure the response:
- Per-sheet breakdown
- Total count
- Confidence level
- Notes on uncertainties

### 5. Use Examples
Show what correct analysis looks like:
```
**Example - YES, this is a crossing:**
Sheet CU102 shows "ELEC" with "28.71±"
Analysis: Electrical utility crossing
Count: 1 crossing ✓

**Example - NO, this is NOT a crossing:**
Profile shows "VERT DEFL"
Analysis: This is a water line fitting
Count: 0 crossings ✗
```

---

## Common Pitfalls to Avoid

### 1. Image Conversion
**Wrong:** Convert PDF → Images → Send to Claude
**Right:** Attach PDF directly as document

### 2. Generic Prompts
**Wrong:** "Count the valves in these plans"
**Right:** Detailed prompt with terminology, scanning method, examples

### 3. Missing Size Filtering
**Wrong:** Count all valves
**Right:** "12-IN valves ONLY, exclude 8-IN"

### 4. Terminology Confusion
**Wrong:** Assume Claude knows VERT DEFL ≠ crossing
**Right:** Explicitly teach the distinction

### 5. No Verification Structure
**Wrong:** "Tell me how many"
**Right:** "Report per-sheet breakdown so user can verify"

---

## File Reference

| File | Purpose |
|------|---------|
| `src/lib/chat/smart-router.ts` | Query classification |
| `src/lib/chat/pdf-attachment.ts` | PDF fetching and attachment |
| `src/app/api/chat/route.ts` | API handler with prompt builders |
| `src/lib/chat/vision-queries.ts` | Database queries for vision data |
| `src/lib/vision/claude-vision.ts` | Vision processing during indexing |

---

## Version History

| Date | Change |
|------|--------|
| 2026-01-31 | Initial standard established |

---

## Summary

The key to accurate visual analysis:

1. **Attach PDFs directly** (not images)
2. **Classify the query** to determine visual task type
3. **Build task-specific prompts** with terminology education
4. **Teach scanning methodology** (profile view, left-to-right)
5. **Include sanity checks** and examples
6. **Request structured responses** for verification

This pattern works. Follow it for all new visual query features.
