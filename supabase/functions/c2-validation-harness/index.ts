// TEMPORARY: C2 validation harness runner. Deleted after the checkpoint.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    return new Response(JSON.stringify({ error: 'runner not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const main = await db.rpc('c2_harness_run');
  if (main.error) {
    return new Response(JSON.stringify({ error: main.error.message, code: main.error.code }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supplemental = await db.rpc('c2_harness_run_c');
  const data = {
    main: main.data,
    supplemental: supplemental.error
      ? { error: supplemental.error.message, code: supplemental.error.code }
      : supplemental.data,
  };
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
