/**
 * Full Routing Test Script
 *
 * Tests the entire query flow from user query to AI context
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const projectId = 'c455e726-b3b4-4f87-97e9-70a89ec17228';

async function testFullRouting() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('=== FULL ROUTING TEST ===\n');

  // Step 1: Check what's in the database
  console.log('--- Step 1: Database Contents ---');
  const { data: allQuantities, error: allError } = await supabase
    .from('project_quantities')
    .select('item_name, quantity, station_from, sheet_number, confidence')
    .eq('project_id', projectId)
    .order('item_name');

  if (allError) {
    console.log('Error fetching quantities:', allError.message);
    return;
  }

  console.log(`Total quantities in database: ${allQuantities?.length || 0}`);
  console.log('\nAll items:');
  allQuantities?.forEach((q, i) => {
    console.log(`  ${i + 1}. ${q.item_name} | Qty: ${q.quantity} | Station: ${q.station_from || 'N/A'} | Sheet: ${q.sheet_number}`);
  });

  // Step 2: Test the search_quantities RPC
  console.log('\n--- Step 2: Test search_quantities RPC ---');
  const searchTerms = ['valve', 'valves', 'gate valve', '12-IN GATE VALVE'];

  for (const term of searchTerms) {
    console.log(`\nSearching for: "${term}"`);
    const { data: searchResults, error: searchError } = await supabase
      .rpc('search_quantities', {
        p_project_id: projectId,
        p_search_term: term,
        p_limit: 10
      });

    if (searchError) {
      console.log(`  Error: ${searchError.message}`);
    } else {
      console.log(`  Found ${searchResults?.length || 0} results`);
      searchResults?.slice(0, 3).forEach((r: any, i: number) => {
        console.log(`    ${i + 1}. ${r.item_name}`);
        console.log(`       Similarity: ${(r.similarity * 100).toFixed(1)}%, Confidence: ${(r.confidence * 100).toFixed(1)}%`);
      });
    }
  }

  // Step 3: Test plural normalization
  console.log('\n--- Step 3: Plural Normalization Test ---');
  const pluralTests = [
    { input: 'valves', expected: 'valve' },
    { input: 'tees', expected: 'tee' },
    { input: 'assemblies', expected: 'assembly' },
    { input: 'boxes', expected: 'box' },
  ];

  for (const test of pluralTests) {
    let normalized = test.input;
    if (normalized.endsWith('ves')) {
      normalized = normalized.slice(0, -3) + 've';
    } else if (normalized.endsWith('ies')) {
      normalized = normalized.slice(0, -3) + 'y';
    } else if (normalized.endsWith('es') && !normalized.endsWith('ches') && !normalized.endsWith('shes')) {
      normalized = normalized.slice(0, -2);
    } else if (normalized.endsWith('s') && !normalized.endsWith('ss')) {
      normalized = normalized.slice(0, -1);
    }
    const match = normalized === test.expected ? '✓' : '✗';
    console.log(`  ${match} "${test.input}" -> "${normalized}" (expected: "${test.expected}")`);
  }

  // Step 4: Verify search with normalized term works
  console.log('\n--- Step 4: Normalized Search Test ---');
  const normalizedTerm = 'valve'; // After normalizing "valves"
  const { data: normalizedResults, error: normalizedError } = await supabase
    .rpc('search_quantities', {
      p_project_id: projectId,
      p_search_term: normalizedTerm,
      p_limit: 20
    });

  if (normalizedError) {
    console.log(`Error: ${normalizedError.message}`);
  } else {
    console.log(`\nSearch for "${normalizedTerm}" returned ${normalizedResults?.length || 0} results`);

    // Apply the same filters as getQuantityDirectly
    const validMatches = normalizedResults?.filter((q: any) =>
      q.confidence >= 0.7 && q.similarity >= 0.25
    ) || [];

    console.log(`After filtering (conf >= 0.7, sim >= 0.25): ${validMatches.length} valid matches\n`);

    if (validMatches.length > 0) {
      console.log('Valid matches:');
      validMatches.forEach((m: any, i: number) => {
        console.log(`  ${i + 1}. ${m.item_name}`);
        console.log(`     Station: ${m.station_from || 'N/A'} | Sheet: ${m.sheet_number}`);
        console.log(`     Similarity: ${(m.similarity * 100).toFixed(1)}%, Confidence: ${(m.confidence * 100).toFixed(1)}%`);
      });
    } else {
      console.log('NO VALID MATCHES - This explains why AI cannot see valve data!');
      console.log('\nAll results before filtering:');
      normalizedResults?.forEach((m: any, i: number) => {
        console.log(`  ${i + 1}. ${m.item_name}`);
        console.log(`     Similarity: ${(m.similarity * 100).toFixed(1)}%, Confidence: ${(m.confidence * 100).toFixed(1)}%`);
      });
    }
  }

  // Step 5: Count valve-related items directly
  console.log('\n--- Step 5: Direct Valve Count ---');
  const { data: valveItems, error: valveError } = await supabase
    .from('project_quantities')
    .select('*')
    .eq('project_id', projectId)
    .ilike('item_name', '%valve%');

  if (valveError) {
    console.log(`Error: ${valveError.message}`);
  } else {
    console.log(`Items containing "valve": ${valveItems?.length || 0}`);
    valveItems?.forEach((v: any, i: number) => {
      console.log(`  ${i + 1}. ${v.item_name}`);
      console.log(`     Station: ${v.station_from} | Qty: ${v.quantity} | Confidence: ${(v.confidence * 100).toFixed(0)}%`);
    });
  }

  console.log('\n=== TEST COMPLETE ===');
}

testFullRouting().catch(console.error);
