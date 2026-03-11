# Construction PE Agent Integration

## Summary

Successfully integrated the `ConstructionPEAgent` into both mobile and web chat endpoints to provide proper multi-utility support and PE-level domain expertise.

## What Changed

### Before
- **Mobile chat** ([src/app/api/mobile/chat/route.ts](src/app/api/mobile/chat/route.ts)): Used hardcoded prompts specific to water line analysis
- **Web chat** ([src/app/api/chat/route.ts](src/app/api/chat/route.ts)): Used smart-router with hardcoded system detection (water/storm/sewer/fire only)
- **Result**: Queries about electrical, gas, telecom utilities were not properly recognized or routed

### After
Both endpoints now use:
1. **ConstructionPEAgent** - Domain expert AI with 15+ years PE experience
2. **ConstructionDocumentAnalyzer** - Structured extraction from plan PDFs
3. **Multi-utility support** - Electrical, gas, telecom, water, sewer, storm

## Key Features

### 1. Multi-Utility Recognition
The system now properly identifies and analyzes ALL utility types:

- **Electrical**: conduit, duct banks, power lines, electrical crossings
- **Gas**: gas lines, regulators, meters
- **Telecom**: fiber optic, telephone, CATV
- **Water**: water mains, valves, hydrants
- **Sewer**: sanitary sewer, force mains, pump stations
- **Storm**: storm drains, catch basins, detention basins

### 2. Smart Document Selection
When processing queries, the system:
- Detects utility type mentioned in query (e.g., "electrical")
- Prioritizes relevant sheets (e.g., E-series sheets for electrical)
- Falls back to analyzing all sheets if no specific utility mentioned

**Example:**
```
Query: "How much LF of electrical conduit?"
→ System finds sheets matching /elect|elec|power|e-\d+/i
→ Prioritizes E-101, E-102, etc.
→ Analyzes up to 15 electrical sheets
```

### 3. PE-Level Analysis
The `ConstructionDocumentAnalyzer` provides:

- **Component extraction**: Valves, fittings, structures by size and type
- **Utility crossings**: Proper identification (ELEC, GAS, TEL, etc.)
- **Quantity summaries**: Linear footage, item counts
- **PE recommendations**: Concerns, field verification needs, estimating notes

### 4. Structured Output
Analysis results are grouped by utility type:

```
## Utilities Found:

### ELECTRICAL:
- 2-IN CONDUIT: 450 LF
- 4-IN DUCT BANK: 1200 LF
- ELECTRICAL JUNCTION BOX: 12 EA

### GAS:
- 2-IN GAS MAIN: 850 LF
- GAS METER ASSEMBLY: 3 EA

## Utility Crossings:
- ELEC: 5 crossing(s)
- GAS: 2 crossing(s)
```

## Technical Implementation

### Mobile Chat Route
**File**: [src/app/api/mobile/chat/route.ts](src/app/api/mobile/chat/route.ts)

**Flow**:
1. Bearer token authentication
2. Load project context from database
3. Initialize `ConstructionPEAgent` with project context
4. Check if query needs visual analysis
5. If yes:
   - Download relevant PDFs
   - Use `ConstructionDocumentAnalyzer` to extract data
   - Group results by utility type
   - Ask PE Agent to interpret findings
6. If no:
   - Use PE Agent for conversational response

### Web Chat Route
**File**: [src/app/api/chat/route.ts](src/app/api/chat/route.ts)

**Flow**: Same as mobile, but uses cookie-based auth instead of Bearer token

### Key Dependencies

```typescript
import {
  createPEAgent,
  createDocumentAnalyzer,
  type PEAgentConfig
} from '@/agents/constructionPEAgent'
```

## Usage Examples

### Example 1: Electrical LF Query
```
User: "How much LF of electrical conduit do I have?"

System:
1. Detects "electrical" keyword
2. Filters to electrical sheets (E-101, E-102, etc.)
3. Analyzes PDFs using DocumentAnalyzer
4. Groups components by utility type
5. PE Agent responds with:
   - Total electrical conduit LF by size
   - Breakdown by sheet/station
   - Any concerns or notes
```

### Example 2: Gas Crossings
```
User: "Show me all gas utility crossings"

System:
1. Detects "gas" and "crossings" keywords
2. Prioritizes gas-related sheets
3. Extracts all utility crossings from profiles
4. Filters to show only gas crossings
5. PE Agent responds with:
   - Count and locations
   - Elevations/depths
   - Coordination notes
```

### Example 3: General Conversation
```
User: "What are the typical cover requirements for duct banks?"

System:
1. No visual analysis needed
2. PE Agent responds from domain knowledge
3. Provides typical requirements
4. Cites relevant standards (NEC, local codes)
```

## Benefits

### 1. Accurate Multi-Utility Support
- No longer limited to water/sewer/storm
- Properly recognizes electrical, gas, telecom queries
- Extracts quantities for ALL utility types

### 2. PE-Level Communication
- Responds like a senior project engineer
- Uses proper construction terminology
- Provides actionable recommendations

### 3. Structured Data Extraction
- Component counts by type and size
- Linear footage calculations
- Utility crossing identification
- Station-based references

### 4. Reduced Hallucination
- DocumentAnalyzer uses low temperature (0.1) for extraction
- Confidence scoring for extracted data
- Source tracking (profile view, callout box, etc.)

## Limitations & Future Improvements

### Current Limitations
1. **Document limit**: 15 sheets per query (API size constraints)
2. **Concurrency**: 2 sheets analyzed at a time (rate limiting)
3. **Cost**: Uses Sonnet 4.5 for vision (~$3/$15 per 1M tokens)

### Future Improvements
1. **Batch processing**: Pre-analyze all sheets on upload
2. **Caching**: Store analysis results in database
3. **Incremental updates**: Only re-analyze changed sheets
4. **Cost optimization**: Use Haiku for simple sheets, Sonnet for complex

## Testing Recommendations

### Test Cases
1. ✅ Query for electrical LF on project with electrical plans
2. ✅ Query for gas components on project with gas plans
3. ✅ Query for water valves (ensure backward compatibility)
4. ✅ Query for crossings (all utility types)
5. ✅ Conversational queries without visual analysis

### Verification
- Check that electrical queries return electrical data (not water)
- Verify LF calculations are accurate
- Confirm PE Agent provides proper terminology
- Test both mobile and web endpoints

## Migration Notes

### Breaking Changes
- **None** - This is backward compatible

### Configuration Required
- Ensure `ANTHROPIC_API_KEY` is set in environment
- Verify Supabase storage access for PDF downloads

### Deployment
1. Deploy updated routes
2. Test with sample queries
3. Monitor token usage (vision models are more expensive)
4. Consider enabling batch processing for cost savings

## Cost Analysis

### Per-Query Cost (Estimated)

**Visual Analysis (15 PDFs)**:
- Input: ~150K tokens (15 sheets × 10K tokens/sheet)
- Output: ~2K tokens
- Cost: $0.45 input + $0.03 output = **~$0.48 per query**

**Conversational (No PDFs)**:
- Input: ~5K tokens
- Output: ~500 tokens
- Cost: $0.015 input + $0.0075 output = **~$0.023 per query**

### Cost Optimization Strategies
1. **Pre-process on upload**: One-time cost per sheet (~$0.05)
2. **Cache results**: Reduce repeat analysis costs to $0
3. **Batch processing**: Analyze entire project overnight

## Support

For issues or questions:
- Check logs: `console.log` statements throughout both routes
- Verify PE Agent initialization: Look for `[PE Agent] Initialized` logs
- Check DocumentAnalyzer: Look for `[DocAnalyzer] Analyzing` logs

## Conclusion

The ConstructionPEAgent integration provides a robust, multi-utility solution for construction plan analysis. Users can now query about electrical, gas, telecom, and other utilities with the same accuracy as water/sewer/storm queries.

**Key Achievement**: The system now properly answers "How much LF of electrical do I have?" by analyzing electrical plan sheets and returning electrical quantities - not defaulting to water line data.
