/**
 * TEMPORARY validation-only endpoint.
 *
 * Deletes leftover harness Auth users (`*@harness.invalid`) created by deployed
 * validation fixtures. Gated by a shared secret; deletes nothing else. Remove
 * together with the `HARNESS_PURGE_TOKEN` secret once teardown is complete.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const expected = Deno.env.get('HARNESS_PURGE_TOKEN');
  const provided = req.headers.get('x-harness-token');
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ ok: false, reason: 'forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const deleted: string[] = [];
  const errors: string[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      errors.push(error.message);
      break;
    }
    const users = data?.users ?? [];
    for (const u of users) {
      if (!u.email?.toLowerCase().endsWith('@harness.invalid')) continue;
      const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
      if (delErr) errors.push(`${u.id}: ${delErr.message}`);
      else deleted.push(u.email);
    }
    if (users.length < 200) break;
    page += 1;
  }

  return new Response(JSON.stringify({ ok: errors.length === 0, deleted, errors }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
