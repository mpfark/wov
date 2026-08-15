/**
 * c5-authprobe — TEMPORARY. Reports what identity an inbound request carries so
 * the C5 validation harness can be reached through a service-role-only path.
 * Deleted together with the harness.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  let role: unknown = null;
  let sub: unknown = null;
  let err: string | null = null;
  if (token) {
    try {
      const c = createClient(url, anonKey);
      const { data, error } = await c.auth.getClaims(token);
      role = data?.claims?.role ?? null;
      sub = data?.claims?.sub ?? null;
      err = error?.message ?? null;
    } catch (e) {
      err = (e as Error).message;
    }
  }
  return new Response(
    JSON.stringify({
      has_authorization: !!auth,
      role,
      sub,
      claims_error: err,
      is_service_role_key: !!token && token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      is_anon_key: !!token && token === anonKey,
      headers: [...req.headers.keys()].sort(),
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
