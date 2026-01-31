import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function checkValveDetails() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from('project_quantities')
    .select('id, item_name, quantity, station_from, sheet_number, confidence, created_at')
    .ilike('item_name', '%12%valve%')
    .order('station_from');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('\n=== 12-INCH VALVE DETAILS ===\n');

  data?.forEach((q, i) => {
    console.log(`${i + 1}. ${q.item_name}`);
    console.log(`   Station: ${q.station_from || 'N/A'}`);
    console.log(`   Sheet: ${q.sheet_number}`);
    console.log(`   Confidence: ${(q.confidence * 100).toFixed(0)}%`);
    console.log(`   ID: ${q.id}`);
    console.log(`   Created: ${q.created_at}`);
    console.log('');
  });

  console.log(`TOTAL: ${data?.length} entries`);

  // Group by station to see if there are duplicates
  const byStation: Record<string, any[]> = {};
  data?.forEach(q => {
    const station = q.station_from || 'unknown';
    if (!byStation[station]) byStation[station] = [];
    byStation[station].push(q);
  });

  console.log('\n=== GROUPED BY STATION ===');
  const duplicateStations = Object.entries(byStation).filter(([_, items]) => items.length > 1);
  if (duplicateStations.length > 0) {
    console.log('\nDUPLICATE STATIONS:');
    duplicateStations.forEach(([station, items]) => {
      console.log(`  ${station}: ${items.length} entries (sheets: ${items.map(i => i.sheet_number).join(', ')})`);
    });
  } else {
    console.log('\nNo duplicate stations found - all 8 entries are at unique stations.');
  }
}

checkValveDetails();
