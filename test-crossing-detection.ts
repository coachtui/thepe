import { extractCrossingIndicators, formatCrossingTable } from './src/lib/metadata/utility-abbreviations';

const sampleProfileText = `
WATER LINE 'A' PROFILE VIEW
STA 0+00 BEGIN WATER LINE 'A'
STA 5+23.50 ELEC 35.73±
STA 10+15 EXIST SS INV ELEV = 28.50
STA 32+62.01 END WATER LINE 'A'
`;

console.log('Testing crossing detection with sample text:');
console.log('='.repeat(60));
console.log(sampleProfileText);
console.log('='.repeat(60));

const indicators = extractCrossingIndicators(sampleProfileText);
console.log(`\nFound ${indicators.length} crossing indicator(s):`);

indicators.forEach((ind, i) => {
  console.log(`\n${i+1}. ${ind.utilityFullName} (${ind.utilityCode})`);
  console.log(`   Station: ${ind.station || 'Not specified'}`);
  console.log(`   Elevation: ${ind.elevation !== undefined ? ind.elevation + '± ft' : 'Not specified'}`);
  console.log(`   Type: ${ind.isExisting ? 'Existing' : 'Unknown'}`);
});

console.log('\n' + '='.repeat(60));
console.log('Formatted table:');
console.log('='.repeat(60));
const table = formatCrossingTable(indicators, 'Water Line A');
console.log(table);
