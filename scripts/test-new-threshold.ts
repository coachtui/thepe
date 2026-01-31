import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function test() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .rpc('search_quantities', {
      p_project_id: 'c455e726-b3b4-4f87-97e9-70a89ec17228',
      p_search_term: 'valve',
      p_limit: 20
    });

  // Apply NEW filter: confidence >= 0.7 AND similarity >= 0.20
  const validMatches = data?.filter((q: any) => q.confidence >= 0.7 && q.similarity >= 0.20) || [];

  console.log('After lowering similarity threshold to 0.20:');
  console.log('Valid matches: ' + validMatches.length);
  console.log('');

  // Group and count
  const counts: Record<string, number> = {};
  validMatches.forEach((m: any) => {
    counts[m.item_name] = (counts[m.item_name] || 0) + 1;
  });

  console.log('Breakdown:');
  Object.entries(counts).forEach(([name, count]) => {
    console.log('  - ' + name + ': ' + count);
  });

  console.log('');
  console.log('TOTAL VALVES: ' + validMatches.length);
}

test().catch(console.error);
