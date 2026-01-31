/**
 * Utility Crossing Detection - Test File
 *
 * Tests the utility crossing detection capability across all components:
 * - Query classification
 * - Pattern matching
 * - Retrieval strategy
 * - Response formatting
 */

import { classifyQuery } from '../query-classifier';
import {
  containsCrossingKeywords,
  extractCrossingIndicators,
  formatCrossingTable,
  normalizeUtilityCode,
  getUtilityFullName,
  type CrossingIndicator
} from '@/lib/metadata/utility-abbreviations';

/**
 * Test Suite 1: Query Classification
 */
describe('Utility Crossing Query Classification', () => {
  test('Should detect crossing query: "What utilities cross Water Line A?"', () => {
    const query = 'What utilities cross Water Line A?';
    const classification = classifyQuery(query);

    expect(classification.type).toBe('utility_crossing');
    expect(classification.confidence).toBeGreaterThanOrEqual(0.8);
    expect(classification.needsCompleteData).toBe(true);
    expect(classification.searchHints.systemName).toContain('Water Line A');
  });

  test('Should detect crossing query: "Where does the electrical line cross?"', () => {
    const query = 'Where does the electrical line cross?';
    const classification = classifyQuery(query);

    expect(classification.type).toBe('utility_crossing');
    expect(classification.needsCompleteData).toBe(true);
  });

  test('Should detect crossing query: "Show me all utility crossings"', () => {
    const query = 'Show me all utility crossings';
    const classification = classifyQuery(query);

    expect(classification.type).toBe('utility_crossing');
  });

  test('Should detect crossing query: "Any conflicts with existing utilities?"', () => {
    const query = 'Any conflicts with existing utilities?';
    const classification = classifyQuery(query);

    expect(classification.type).toBe('utility_crossing');
  });

  test('Should detect crossing query: "List crossing utilities with stations"', () => {
    const query = 'List crossing utilities with stations';
    const classification = classifyQuery(query);

    expect(classification.type).toBe('utility_crossing');
  });

  test('Should NOT detect as crossing: "How many gate valves on Water Line A?"', () => {
    const query = 'How many gate valves on Water Line A?';
    const classification = classifyQuery(query);

    expect(classification.type).not.toBe('utility_crossing');
    expect(classification.type).toBe('quantity');
  });

  test('Should extract system name from crossing query', () => {
    const query = 'What utilities cross Storm Drain B?';
    const classification = classifyQuery(query);

    expect(classification.searchHints.systemName).toContain('Storm Drain B');
  });
});

/**
 * Test Suite 2: Keyword Detection
 */
describe('Crossing Keyword Detection', () => {
  test('Should detect crossing keywords in query', () => {
    expect(containsCrossingKeywords('What utilities cross here?')).toBe(true);
    expect(containsCrossingKeywords('Any conflicts with existing lines?')).toBe(true);
    expect(containsCrossingKeywords('Show intersecting utilities')).toBe(true);
    expect(containsCrossingKeywords('List all crossings')).toBe(true);
  });

  test('Should NOT detect crossing in non-crossing queries', () => {
    expect(containsCrossingKeywords('How many valves?')).toBe(false);
    expect(containsCrossingKeywords('What is the length?')).toBe(false);
    expect(containsCrossingKeywords('Show me the plan')).toBe(false);
  });
});

/**
 * Test Suite 3: Utility Code Normalization
 */
describe('Utility Abbreviation Processing', () => {
  test('Should normalize utility codes', () => {
    expect(normalizeUtilityCode('ELEC')).toBe('ELEC');
    expect(normalizeUtilityCode('E')).toBe('ELEC');
    expect(normalizeUtilityCode('ELECTRICAL')).toBe('ELEC');

    expect(normalizeUtilityCode('SS')).toBe('SS');
    expect(normalizeUtilityCode('SANITARY SEWER')).toBe('SS');

    expect(normalizeUtilityCode('STM')).toBe('STM');
    expect(normalizeUtilityCode('SD')).toBe('STM');
    expect(normalizeUtilityCode('STORM DRAIN')).toBe('STM');
  });

  test('Should get full utility names', () => {
    expect(getUtilityFullName('ELEC')).toBe('Electrical');
    expect(getUtilityFullName('SS')).toBe('Sanitary Sewer');
    expect(getUtilityFullName('STM')).toBe('Storm Drain');
    expect(getUtilityFullName('GAS')).toBe('Gas Line');
    expect(getUtilityFullName('TEL')).toBe('Telephone/Telecom');
    expect(getUtilityFullName('W')).toBe('Water Line');
  });

  test('Should handle unknown codes gracefully', () => {
    expect(normalizeUtilityCode('UNKNOWN')).toBeNull();
    expect(getUtilityFullName('UNKNOWN')).toBe('UNKNOWN');
  });
});

/**
 * Test Suite 4: Crossing Indicator Extraction
 */
describe('Crossing Indicator Extraction from Text', () => {
  test('Should extract utility with elevation', () => {
    const text = 'ELEC 35.73± STA 15+20';
    const indicators = extractCrossingIndicators(text);

    expect(indicators.length).toBeGreaterThan(0);
    expect(indicators[0].utilityCode).toBe('ELEC');
    expect(indicators[0].elevation).toBeCloseTo(35.73, 2);
    expect(indicators[0].station).toBe('15+20');
  });

  test('Should extract existing utility mention', () => {
    const text = 'EXIST SS INV ELEV = 28.50 STA 8+45';
    const indicators = extractCrossingIndicators(text);

    expect(indicators.length).toBeGreaterThan(0);
    const ssIndicator = indicators.find(ind => ind.utilityCode === 'SS');
    expect(ssIndicator).toBeDefined();
    expect(ssIndicator?.isExisting).toBe(true);
  });

  test('Should extract sized utility', () => {
    const text = '12-IN W at station 10+00';
    const indicators = extractCrossingIndicators(text);

    expect(indicators.length).toBeGreaterThan(0);
    const waterIndicator = indicators.find(ind => ind.utilityCode === 'W');
    expect(waterIndicator).toBeDefined();
    expect(waterIndicator?.size).toBe('12-IN');
  });

  test('Should handle multiple crossings in text', () => {
    const text = `
      ELEC 35.73± STA 15+20
      EXIST SS INV 28.50 STA 8+45
      STM STA 22+30
    `;
    const indicators = extractCrossingIndicators(text);

    expect(indicators.length).toBeGreaterThanOrEqual(3);

    const elecIndicator = indicators.find(ind => ind.utilityCode === 'ELEC');
    expect(elecIndicator).toBeDefined();

    const ssIndicator = indicators.find(ind => ind.utilityCode === 'SS');
    expect(ssIndicator).toBeDefined();

    const stmIndicator = indicators.find(ind => ind.utilityCode === 'STM');
    expect(stmIndicator).toBeDefined();
  });

  test('Should handle real profile view text patterns', () => {
    const profileText = `
      WATER LINE 'A' PROFILE
      STA 0+00 BEGIN
      EXISTING WATER LINE
      STA 5+23.50 ELEC 35.73±
      STA 10+15 EXIST SS INV ELEV = 28.50
      12-IN STM STA 15+00
      STA 20+45 END WATER LINE 'A'
    `;

    const indicators = extractCrossingIndicators(profileText);

    expect(indicators.length).toBeGreaterThan(0);

    // Should find at least electrical and sanitary sewer
    expect(indicators.some(ind => ind.utilityCode === 'ELEC')).toBe(true);
    expect(indicators.some(ind => ind.utilityCode === 'SS')).toBe(true);
  });
});

/**
 * Test Suite 5: Response Formatting
 */
describe('Crossing Table Formatting', () => {
  test('Should format single crossing as table', () => {
    const indicators: CrossingIndicator[] = [
      {
        utilityCode: 'ELEC',
        utilityFullName: 'Electrical',
        elevation: 35.73,
        station: '15+20',
        isExisting: true,
        isProposed: false,
        rawMatch: 'ELEC 35.73±'
      }
    ];

    const table = formatCrossingTable(indicators, 'Water Line A');

    expect(table).toContain('Water Line A');
    expect(table).toContain('15+20');
    expect(table).toContain('Electrical (ELEC)');
    expect(table).toContain('35.73± ft');
    expect(table).toContain('Existing');
    expect(table).toContain('Total: 1 utility crossing');
  });

  test('Should format multiple crossings as table', () => {
    const indicators: CrossingIndicator[] = [
      {
        utilityCode: 'ELEC',
        utilityFullName: 'Electrical',
        elevation: 35.73,
        station: '15+20',
        isExisting: true,
        isProposed: false,
        rawMatch: 'ELEC 35.73±'
      },
      {
        utilityCode: 'SS',
        utilityFullName: 'Sanitary Sewer',
        elevation: 28.50,
        station: '8+45',
        isExisting: true,
        isProposed: false,
        rawMatch: 'EXIST SS INV 28.50'
      },
      {
        utilityCode: 'STM',
        utilityFullName: 'Storm Drain',
        station: '22+30',
        isExisting: false,
        isProposed: false,
        rawMatch: 'STM'
      }
    ];

    const table = formatCrossingTable(indicators);

    expect(table).toContain('15+20');
    expect(table).toContain('8+45');
    expect(table).toContain('22+30');
    expect(table).toContain('Electrical (ELEC)');
    expect(table).toContain('Sanitary Sewer (SS)');
    expect(table).toContain('Storm Drain (STM)');
    expect(table).toContain('Total: 3 utility crossing');
  });

  test('Should handle empty indicators gracefully', () => {
    const table = formatCrossingTable([]);

    expect(table).toContain('No utility crossing indicators found');
  });
});

/**
 * Integration Test: End-to-End Crossing Detection
 */
describe('End-to-End Crossing Detection', () => {
  test('Water Line A crossing query workflow', () => {
    // Step 1: User asks about crossings
    const userQuery = 'What utilities cross Water Line A?';

    // Step 2: Query is classified
    const classification = classifyQuery(userQuery);
    expect(classification.type).toBe('utility_crossing');
    expect(classification.needsCompleteData).toBe(true);

    // Step 3: System retrieves profile view text (simulated)
    const profileViewText = `
      WATER LINE 'A' PROFILE VIEW
      STA 0+00 BEGIN WATER LINE 'A'
      STA 5+23.50 ELEC 35.73±
      STA 32+62.01 END WATER LINE 'A'
    `;

    // Step 4: Extract crossing indicators
    const indicators = extractCrossingIndicators(profileViewText);
    expect(indicators.length).toBeGreaterThan(0);

    // Step 5: Format response
    const response = formatCrossingTable(indicators, 'Water Line A');
    expect(response).toContain('Water Line A');
    expect(response).toContain('Electrical (ELEC)');
    expect(response).toContain('35.73± ft');
  });

  test('Multiple system crossing query', () => {
    const userQuery = 'List all utility crossings';

    const classification = classifyQuery(userQuery);
    expect(classification.type).toBe('utility_crossing');

    // Simulated text from multiple systems
    const allProfileText = `
      WATER LINE 'A': ELEC 35.73± STA 15+20
      STORM DRAIN 'B': GAS 42.10± STA 8+00, TEL 38.50± STA 12+45
      SEWER LINE: W 45.00± STA 5+00
    `;

    const indicators = extractCrossingIndicators(allProfileText);

    // Should find crossings from all systems
    expect(indicators.some(ind => ind.utilityCode === 'ELEC')).toBe(true);
    expect(indicators.some(ind => ind.utilityCode === 'GAS')).toBe(true);
    expect(indicators.some(ind => ind.utilityCode === 'TEL')).toBe(true);
    expect(indicators.some(ind => ind.utilityCode === 'W')).toBe(true);
  });
});

/**
 * Run manual tests for debugging
 */
if (require.main === module) {
  console.log('='.repeat(70));
  console.log('UTILITY CROSSING DETECTION - MANUAL TEST RESULTS');
  console.log('='.repeat(70));

  // Test 1: Query Classification
  console.log('\n📋 TEST 1: Query Classification\n');

  const testQueries = [
    'What utilities cross Water Line A?',
    'Where does the electrical line cross?',
    'Show me all utility crossings',
    'Any conflicts with existing utilities?',
    'List crossing utilities with stations'
  ];

  testQueries.forEach(query => {
    const classification = classifyQuery(query);
    console.log(`Query: "${query}"`);
    console.log(`  Type: ${classification.type}`);
    console.log(`  Confidence: ${(classification.confidence * 100).toFixed(0)}%`);
    console.log(`  Needs Complete Data: ${classification.needsCompleteData}`);
    console.log(`  System Name: ${classification.searchHints.systemName || 'N/A'}`);
    console.log('');
  });

  // Test 2: Text Extraction
  console.log('\n📋 TEST 2: Crossing Indicator Extraction\n');

  const sampleProfileText = `
    WATER LINE 'A' PROFILE
    STA 0+00 BEGIN WATER LINE 'A'
    STA 5+23.50 ELEC 35.73±
    STA 10+15 EXIST SS INV ELEV = 28.50
    12-IN STM STA 15+00
    STA 20+45 GAS 40.25±
    STA 32+62.01 END WATER LINE 'A'
  `;

  console.log('Sample Profile View Text:');
  console.log(sampleProfileText);
  console.log('\nExtracted Crossing Indicators:');

  const indicators = extractCrossingIndicators(sampleProfileText);
  indicators.forEach((ind, i) => {
    console.log(`\n${i + 1}. ${ind.utilityFullName} (${ind.utilityCode})`);
    console.log(`   Station: ${ind.station || 'Not specified'}`);
    console.log(`   Elevation: ${ind.elevation !== undefined ? ind.elevation + '± ft' : 'Not specified'}`);
    console.log(`   Type: ${ind.isExisting ? 'Existing' : ind.isProposed ? 'Proposed' : 'Unknown'}`);
    console.log(`   Size: ${ind.size || 'N/A'}`);
    console.log(`   Raw Match: "${ind.rawMatch}"`);
  });

  // Test 3: Response Formatting
  console.log('\n📋 TEST 3: Response Formatting\n');

  const formattedTable = formatCrossingTable(indicators, 'Water Line A');
  console.log(formattedTable);

  console.log('\n' + '='.repeat(70));
  console.log('✅ Manual tests complete. Review output above.');
  console.log('='.repeat(70));
}
