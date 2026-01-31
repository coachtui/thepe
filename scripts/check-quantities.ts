import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function checkQuantities() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from('project_quantities')
    .select('item_name, quantity, station_from, sheet_number, confidence')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('\n=== Recent Vision-Extracted Quantities ===\n');
    data?.forEach((q, i) => {
      console.log(`${i + 1}. ${q.item_name}`);
      console.log(`   Quantity: ${q.quantity}`);
      console.log(`   Station: ${q.station_from || 'N/A'}`);
      console.log(`   Sheet: ${q.sheet_number || 'N/A'}`);
      console.log(`   Confidence: ${q.confidence}`);
      console.log('');
    });
    console.log(`Total: ${data?.length} quantities found`);
  }
}

checkQuantities();
