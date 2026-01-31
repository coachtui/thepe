import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function checkValves() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from('project_quantities')
    .select('item_name, quantity, station_from, sheet_number')
    .ilike('item_name', '%12%valve%')
    .order('station_from');

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('\n=== 12-INCH VALVES FOUND ===\n');
    let total = 0;
    data?.forEach((q, i) => {
      console.log((i + 1) + '. ' + q.item_name);
      console.log('   Station: ' + (q.station_from || 'N/A'));
      console.log('   Qty: ' + q.quantity);
      console.log('');
      total += q.quantity || 0;
    });
    console.log('TOTAL ENTRIES: ' + data?.length);
    console.log('TOTAL QUANTITY: ' + total + ' valves');
  }
}

checkValves();
