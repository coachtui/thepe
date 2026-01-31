import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function checkDoc() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: doc } = await supabase
    .from('documents')
    .select('*')
    .ilike('filename', '%Ammunition%')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log('Document details:');
  console.log(JSON.stringify(doc, null, 2));
}

checkDoc().catch(console.error);
