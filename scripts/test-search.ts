import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function testSearch() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const projectId = 'c455e726-b3b4-4f87-97e9-70a89ec17228';
  const searchTerms = ['valves', '12 inch valves', 'valve', 'gate valve', '12-IN'];

  for (const term of searchTerms) {
    console.log(`\n=== Searching for: "${term}" ===`);

    const { data, error } = await supabase
      .rpc('search_quantities', {
        p_project_id: projectId,
        p_search_term: term,
        p_limit: 10
      });

    if (error) {
      console.log('Error:', error.message);
    } else {
      console.log(`Found ${data?.length || 0} results`);
      data?.slice(0, 3).forEach((q: any) => {
        console.log(`  - ${q.item_name} (similarity: ${q.similarity})`);
      });
    }
  }
}

testSearch();
