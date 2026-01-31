/**
 * Test Vision Processing Script
 *
 * Usage:
 *   npx tsx scripts/test-vision-processing.ts <documentId> <projectId>
 *
 * Example:
 *   npx tsx scripts/test-vision-processing.ts abc-123 def-456
 */

async function testVisionProcessing(documentId: string, projectId: string) {
  const apiUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const endpoint = `${apiUrl}/api/documents/${documentId}/process-vision`;

  console.log('🔍 Testing Vision Processing');
  console.log('Document ID:', documentId);
  console.log('Project ID:', projectId);
  console.log('Endpoint:', endpoint);
  console.log('---\n');

  try {
    console.log('📤 Sending POST request...');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        maxSheets: 5
      })
    });

    const result = await response.json();

    if (response.ok) {
      console.log('✅ Success!');
      console.log('\nResults:');
      console.log('  Sheets Processed:', result.data.sheetsProcessed);
      console.log('  Quantities Extracted:', result.data.quantitiesExtracted);
      console.log('  Total Cost: $' + result.data.totalCost.toFixed(4));
      console.log('  Processing Time:', (result.data.processingTimeMs / 1000).toFixed(1) + 's');
    } else {
      console.log('❌ Error:', response.status);
      console.log(result);
    }

    // Check status
    console.log('\n📊 Checking processing status...');
    const statusResponse = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const statusResult = await statusResponse.json();

    if (statusResponse.ok) {
      console.log('Status:', statusResult.visionProcessed ? '✅ Processed' : '⏳ Not processed');
      console.log('Sheets Processed:', statusResult.sheetsProcessed);
      console.log('Quantities Extracted:', statusResult.quantitiesExtracted);
      console.log('Critical Sheets:', statusResult.criticalSheets);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: npx tsx scripts/test-vision-processing.ts <documentId> <projectId>');
  process.exit(1);
}

const [documentId, projectId] = args;

testVisionProcessing(documentId, projectId);
