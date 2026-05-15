import { createClient } from '@supabase/supabase-js';

// node --env-file=.env --import tsx/esm scratch/check_schema.ts

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  console.log('--- Schema de "visits" ---');
  const { data: v, error: ve } = await supabase.from('visits').select('*').limit(1);
  if (ve) console.error(ve);
  else console.log('Colunas em visits:', Object.keys(v[0] || {}));

  console.log('\n--- Schema de "engagement_actions" ---');
  const { data: e, error: ee } = await supabase.from('engagement_actions').select('*').limit(1);
  if (ee) console.error(ee);
  else console.log('Colunas em engagement_actions:', Object.keys(e[0] || {}));
}

check();
