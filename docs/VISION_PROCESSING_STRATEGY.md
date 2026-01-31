# Vision Processing Strategy for Construction Documents

## Problem Statement

Construction civil plans do NOT have complete quantity tables on title/summary sheets. Instead:

### What Title Sheets Actually Show:
```
ITEM SUMMARY TABLE:
Item          | Description           | Station Range
Water Line A  | 12" PVC Water Main   | Sta 13+00 to End
Storm Drain B | 18" RCP Storm Drain  | Sta 15+50 to 36+00
Sewer Line    | 8" PVC Sewer         | Sta 13+00 to End
```

### What We Need to Calculate:
```
ACTUAL QUANTITIES (from plan/profile sheets):
Water Line A: 2,450 LF  (calculated from actual alignment on plans)
Storm Drain B: 2,050 LF (calculated from station range: 36+00 - 15+50 = 20.50 stations = 2,050 LF)
Sewer Line: 2,450 LF    (calculated from alignment)
```

## Correct Multi-Pass Vision Strategy

### Pass 1: Title/Summary Sheet Analysis
**Goal:** Identify what utilities exist and their approximate station ranges

**Input:** Pages 1-3 (title, summary, legend)

**Extract:**
- Utility names (Water Line A, Storm Drain B, etc.)
- Utility types (waterline, storm drain, sewer, etc.)
- Approximate station ranges ("Sta 13+00 to End", "Sta 15+50 to 36+00")
- Item numbers/codes (WL-A, SD-B, etc.)
- Pipe sizes and materials (12" PVC, 18" RCP, etc.)
- Sheet references (which plan sheets show this utility)

**Output:** Utility inventory with metadata

```json
{
  "utilities": [
    {
      "name": "Water Line A",
      "code": "WL-A",
      "type": "waterline",
      "material": "12\" PVC",
      "stationFrom": "13+00",
      "stationTo": "end",
      "planSheets": ["C-002", "C-003"],
      "profileSheets": ["C-101"]
    }
  ]
}
```

---

### Pass 2: Plan Sheet Analysis
**Goal:** Extract actual alignments and station markers

**Input:** Plan sheets (C-001 to C-0XX) identified in Pass 1

**Extract:**
- Station markers visible on plan view (13+00, 15+00, 20+00, etc.)
- Utility alignments (visual lines showing pipe routes)
- Alignment changes (bends, tees, crosses)
- Begin and end points
- Match utility lines to names from Pass 1

**Strategy:**
1. Use Claude Vision to identify station labels
2. Trace utility lines between stations
3. Identify beginning and end stations
4. Calculate lengths using station math

**Example:**
```
Plan Sheet C-002 shows:
- Water Line A runs from Sta 13+00 to Sta 36+00
- Length = 36+00 - 13+00 = 23.00 stations = 2,300 LF

Plan Sheet C-003 shows:
- Water Line A continues from Sta 36+00 to Sta 37+50
- Length = 37+50 - 36+00 = 1.50 stations = 150 LF

Total Water Line A = 2,300 + 150 = 2,450 LF ✓
```

---

### Pass 3: Profile Sheet Analysis (Optional Enhancement)
**Goal:** Extract vertical alignment and verify horizontal lengths

**Input:** Profile sheets (C-101, C-102, etc.)

**Extract:**
- Station ranges shown in profile view
- Vertical alignment changes
- Pipe inverts and depths
- Verify lengths against plan sheets

---

### Pass 4: Quantity Consolidation
**Goal:** Combine data from all passes into final quantities

**Process:**
1. For each utility from Pass 1:
   - Find all plan sheets showing that utility
   - Extract station ranges from each sheet
   - Calculate total length using station math
   - Apply unit conversions (stations to LF: 1 station = 100 LF)
   - Store with confidence scores

**Output:** Final quantity database entries

```sql
INSERT INTO project_quantities (
  item_name,
  quantity,
  unit,
  station_from,
  station_to,
  confidence,
  source_type
) VALUES (
  'Water Line A',
  2450,
  'LF',
  '13+00',
  '37+50',
  0.95,
  'vision'
);
```

---

## Implementation Priority

### Phase 1: Title Sheet Only (Quick Win) ✅
- Extract utility inventory from title sheets
- Store approximate station ranges
- Provides context for semantic search
- **Status: Currently implemented**

### Phase 2: Station Range Calculation (Medium Complexity) 🎯
- Parse station ranges like "13+00 to 36+00"
- Calculate lengths: (36+00 - 13+00) = 23 stations = 2,300 LF
- Handle "to end" by finding max station from plans
- **Priority: HIGH - Implement this next**

### Phase 3: Plan Sheet Analysis (Complex) 🔮
- Process plan sheets to find actual alignments
- Extract station markers from visual sheets
- Trace utility lines between stations
- Calculate exact lengths
- **Priority: FUTURE - After Phase 2 working**

---

## Updated maxSheets Strategy

Current setting: `maxSheets: 5` processes pages 1-5

### Recommended Settings:

**For Quick Deployment (Phase 1):**
```typescript
{
  maxSheets: 3,        // Title + 2 summary sheets
  sheetTypes: ['title', 'summary', 'legend']
}
```

**For Accurate Quantities (Phase 2):**
```typescript
{
  maxSheets: 10,       // Title + summary + key plan sheets
  sheetTypes: ['title', 'summary', 'plan', 'legend']
}
```

**For Complete Analysis (Phase 3):**
```typescript
{
  maxSheets: 20,       // Process all critical sheets
  sheetTypes: ['title', 'summary', 'plan', 'profile', 'detail']
}
```

---

## Cost Estimates

| Phase | Sheets Processed | Cost per Doc | Accuracy |
|-------|------------------|--------------|----------|
| Phase 1 (Title only) | 3 sheets | $0.05 | 60% (ranges only) |
| Phase 2 (Station calc) | 3 sheets | $0.05 | 85% (calculated) |
| Phase 3 (Full plans) | 10-20 sheets | $0.15-$0.30 | 95% (measured) |

---

## Next Steps

1. ✅ **Phase 1 Complete:** Title sheet extraction works
2. 🎯 **Phase 2 Implementation:** Add station range parser
   - Create `parseStationRange()` function
   - Handle "Sta XX+XX to YY+YY" format
   - Handle "Sta XX+XX to End" format
   - Calculate lengths using station math
3. 🔮 **Phase 3 Planning:** Design plan sheet analysis
   - Research best approach for visual station extraction
   - Consider OCR + vision hybrid approach
   - Build station-to-coordinate mapping

---

## User Feedback Loop

Users should understand what the system can/cannot do:

### Current Capabilities (Phase 1):
✅ Extracts utility names and types
✅ Identifies approximate station ranges
✅ Provides context for semantic search
❌ Does NOT calculate exact quantities yet

### With Phase 2:
✅ Calculates quantities from station ranges
✅ Handles "13+00 to 36+00" format
✅ 85% accuracy for simple alignments
⚠️ May not handle complex alignments perfectly

### With Phase 3:
✅ Full plan sheet analysis
✅ Exact measurements from visual plans
✅ 95%+ accuracy
💰 Higher cost per document

---

**Recommendation:** Ship Phase 1 now, implement Phase 2 within 1-2 weeks, consider Phase 3 based on user feedback.
