/**
 * Water Line A Test Script
 *
 * Validates the hybrid retrieval system for quantitative queries.
 *
 * Expected behavior for query: "How many 12-inch gate valves on Water Line A?"
 * 1. Query classifier detects: QUANTITATIVE query
 * 2. Entity extraction finds: system='Water Line A', component='12-inch gate valves'
 * 3. Metadata lookup finds: sheets CU102-CU109 contain Water Line A
 * 4. Retrieval fetches: ALL callout chunks from sheets CU102-CU109
 * 5. Context includes full text from all callouts
 * 6. Claude scans all callouts, finds 2 instances
 * 7. Response format:
 *    - Table with Sheet | Station | Component | Qty
 *    - Total count with breakdown
 */

import { classifyQuery } from '../query-classifier';
import { routeQuery } from '../smart-router';
import { getCompleteSystemData } from '@/lib/embeddings/station-aware-search';

/**
 * Test Case 1: Query Classification
 */
export async function testQueryClassification() {
  console.log('\n=== TEST 1: Query Classification ===\n');

  const testQueries = [
    'How many 12-inch gate valves on Water Line A?',
    'Count all gate valves on Storm Drain B',
    'Give me a takeoff of fire hydrants',
    'Total length of Water Line A',
    'What is the invert elevation at station 15+00?',
    'Where does Water Line A connect to the main?',
    'Explain the valve detail on sheet C-12'
  ];

  for (const query of testQueries) {
    const classification = classifyQuery(query);

    console.log(`Query: "${query}"`);
    console.log(`Type: ${classification.type}`);
    console.log(`Intent: ${classification.intent}`);
    console.log(`Needs Complete Data: ${classification.needsCompleteData}`);
    console.log(`System Name: ${classification.searchHints.systemName || 'N/A'}`);
    console.log(`Item Name: ${classification.itemName || 'N/A'}`);
    console.log(`Confidence: ${(classification.confidence * 100).toFixed(0)}%`);
    console.log('---');
  }

  // Validate Water Line A query
  const waterLineQuery = testQueries[0];
  const waterLineClassification = classifyQuery(waterLineQuery);

  const validations = [
    {
      check: waterLineClassification.intent === 'quantitative',
      message: '✓ Intent correctly identified as QUANTITATIVE'
    },
    {
      check: waterLineClassification.needsCompleteData === true,
      message: '✓ needsCompleteData flag is TRUE'
    },
    {
      check: waterLineClassification.searchHints.systemName?.toLowerCase().includes('water line'),
      message: '✓ System name extracted correctly'
    },
    {
      check: waterLineClassification.itemName?.toLowerCase().includes('valve'),
      message: '✓ Component name (valve) extracted'
    }
  ];

  console.log('\nValidation Results:');
  validations.forEach(v => {
    console.log(v.check ? v.message : `✗ FAILED: ${v.message}`);
  });

  const allPassed = validations.every(v => v.check);
  console.log(`\nTest 1 Result: ${allPassed ? 'PASSED ✓' : 'FAILED ✗'}\n`);

  return allPassed;
}

/**
 * Test Case 2: Complete Data Retrieval
 */
export async function testCompleteDataRetrieval(projectId: string) {
  console.log('\n=== TEST 2: Complete Data Retrieval ===\n');

  if (!projectId) {
    console.log('⚠ Skipping test: No project ID provided');
    return false;
  }

  try {
    const systemName = 'Water Line A';
    console.log(`Fetching complete data for: ${systemName}`);
    console.log(`Project ID: ${projectId}\n`);

    const completeData = await getCompleteSystemData(projectId, systemName, {
      includeNonCallouts: false,
      chunkTypes: ['callout_box']
    });

    console.log('Complete Data Results:');
    console.log(`  Total Chunks: ${completeData.totalChunks}`);
    console.log(`  Callout Boxes: ${completeData.calloutChunks}`);
    console.log(`  Sheet Count: ${completeData.sheets.length}`);
    console.log(`  Sheets: ${completeData.sheets.join(', ')}`);

    if (completeData.coverage.stationRange) {
      console.log(`  Station Range: ${completeData.coverage.stationRange.min} to ${completeData.coverage.stationRange.max}`);
    }

    console.log('\nSample Chunks:');
    completeData.chunks.slice(0, 3).forEach((chunk: any, i: number) => {
      console.log(`  [${i + 1}] Sheet ${chunk.sheet_number} - Station ${chunk.stations?.[0] || 'N/A'}`);
      console.log(`      Content preview: ${chunk.content.substring(0, 100)}...`);
    });

    const validations = [
      {
        check: completeData.totalChunks > 0,
        message: '✓ Retrieved at least one chunk'
      },
      {
        check: completeData.calloutChunks > 0,
        message: '✓ Retrieved callout boxes'
      },
      {
        check: completeData.sheets.length >= 2,
        message: '✓ Multiple sheets found (expected CU102-CU109)'
      },
      {
        check: completeData.coverage.hasCallouts,
        message: '✓ Coverage confirms callouts present'
      }
    ];

    console.log('\nValidation Results:');
    validations.forEach(v => {
      console.log(v.check ? v.message : `✗ FAILED: ${v.message}`);
    });

    const allPassed = validations.every(v => v.check);
    console.log(`\nTest 2 Result: ${allPassed ? 'PASSED ✓' : 'FAILED ✗'}\n`);

    return allPassed;
  } catch (error) {
    console.error('Error in complete data retrieval test:', error);
    console.log('\nTest 2 Result: FAILED ✗\n');
    return false;
  }
}

/**
 * Test Case 3: Full Query Routing
 */
export async function testFullQueryRouting(projectId: string) {
  console.log('\n=== TEST 3: Full Query Routing ===\n');

  if (!projectId) {
    console.log('⚠ Skipping test: No project ID provided');
    return false;
  }

  try {
    const query = 'How many 12-inch gate valves on Water Line A?';
    console.log(`Query: "${query}"`);
    console.log(`Project ID: ${projectId}\n`);

    const routingResult = await routeQuery(query, projectId, {
      includeMetadata: true,
      maxResults: 20
    });

    console.log('Routing Results:');
    console.log(`  Query Type: ${routingResult.classification.type}`);
    console.log(`  Query Intent: ${routingResult.classification.intent}`);
    console.log(`  Method Used: ${routingResult.method}`);
    console.log(`  Total Results: ${routingResult.metadata.totalResults}`);
    console.log(`  Direct Lookup Used: ${routingResult.metadata.directLookupUsed}`);
    console.log(`  Vector Search Used: ${routingResult.metadata.vectorSearchUsed}`);
    console.log(`  Processing Time: ${routingResult.metadata.processingTimeMs}ms`);

    console.log('\nContext Preview:');
    console.log(routingResult.context.substring(0, 500) + '...');

    console.log('\nSystem Prompt Addition:');
    console.log(routingResult.systemPromptAddition?.substring(0, 300) + '...');

    const validations = [
      {
        check: routingResult.classification.intent === 'quantitative',
        message: '✓ Query intent is quantitative'
      },
      {
        check: routingResult.method === 'complete_data' || routingResult.method === 'hybrid',
        message: `✓ Method is ${routingResult.method} (expected complete_data or hybrid)`
      },
      {
        check: routingResult.metadata.totalResults > 0,
        message: '✓ Retrieved results'
      },
      {
        check: routingResult.context.includes('WATER LINE') || routingResult.context.includes('Water Line'),
        message: '✓ Context contains Water Line data'
      },
      {
        check: routingResult.systemPromptAddition?.includes('QUANTITATIVE') ||
               routingResult.systemPromptAddition?.includes('quantity'),
        message: '✓ System prompt includes quantitative instructions'
      }
    ];

    console.log('\nValidation Results:');
    validations.forEach(v => {
      console.log(v.check ? v.message : `✗ FAILED: ${v.message}`);
    });

    const allPassed = validations.every(v => v.check);
    console.log(`\nTest 3 Result: ${allPassed ? 'PASSED ✓' : 'FAILED ✗'}\n`);

    return allPassed;
  } catch (error) {
    console.error('Error in full query routing test:', error);
    console.log('\nTest 3 Result: FAILED ✗\n');
    return false;
  }
}

/**
 * Test Case 4: Response Format Validation (Manual Check)
 */
export function printExpectedResponseFormat() {
  console.log('\n=== TEST 4: Expected Response Format ===\n');

  console.log('When Claude receives the complete data, it should respond with:\n');

  console.log('```');
  console.log('12-Inch Gate Valve Takeoff - Water Line A');
  console.log('Reviewed sheets: CU102-CU109');
  console.log('');
  console.log('| Sheet | Station | Component | Qty |');
  console.log('|-------|---------|-----------|-----|');
  console.log('| CU109 | 30+11.78 | 12-IN GATE VALVE AND VALVE BOX | 1 |');
  console.log('| CU109 | 32+44.21 | 12-IN GATE VALVE AND VALVE BOX | 1 |');
  console.log('');
  console.log('TOTAL: 2 × 12-IN GATE VALVES (with valve boxes)');
  console.log('```\n');

  console.log('Validation Checklist:');
  console.log('  [ ] Response includes table with Sheet | Station | Component | Qty');
  console.log('  [ ] All sheets reviewed are listed');
  console.log('  [ ] Each component has station reference');
  console.log('  [ ] Total count is provided');
  console.log('  [ ] Breakdown by size if multiple sizes');
  console.log('  [ ] No generic responses like "multiple valves are shown"');
  console.log('  [ ] No claims of unreadable text without trying extraction\n');

  console.log('This test requires manual validation with actual Claude API response.\n');
}

/**
 * Run all tests
 */
export async function runAllTests(projectId?: string) {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║  WATER LINE A TEST SUITE                              ║');
  console.log('║  Hybrid Retrieval System Validation                   ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  const results: { test: string; passed: boolean }[] = [];

  // Test 1: Query Classification (no project needed)
  const test1 = await testQueryClassification();
  results.push({ test: 'Query Classification', passed: test1 });

  // Tests 2-3: Require project ID
  if (projectId) {
    const test2 = await testCompleteDataRetrieval(projectId);
    results.push({ test: 'Complete Data Retrieval', passed: test2 });

    const test3 = await testFullQueryRouting(projectId);
    results.push({ test: 'Full Query Routing', passed: test3 });
  } else {
    console.log('\n⚠ Tests 2-3 skipped: No project ID provided');
    console.log('To run complete tests, provide a project ID with Water Line A data\n');
  }

  // Test 4: Manual validation guide
  printExpectedResponseFormat();

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║  TEST SUMMARY                                         ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  results.forEach(r => {
    const status = r.passed ? '✓ PASSED' : '✗ FAILED';
    console.log(`  ${r.test}: ${status}`);
  });

  const totalPassed = results.filter(r => r.passed).length;
  const totalTests = results.length;

  console.log(`\n  Total: ${totalPassed}/${totalTests} tests passed`);

  if (totalPassed === totalTests) {
    console.log('\n  🎉 All automated tests PASSED!');
  } else {
    console.log('\n  ⚠ Some tests FAILED - review output above');
  }

  console.log('\n');

  return totalPassed === totalTests;
}

/**
 * Example usage:
 *
 * // Without project ID (runs classification tests only)
 * import { runAllTests } from '@/lib/chat/__tests__/water-line-a-test';
 * await runAllTests();
 *
 * // With project ID (runs all tests)
 * await runAllTests('your-project-id-here');
 */
