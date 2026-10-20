import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { handleGemApplication } from '../_shared/gem-application.ts';

Deno.serve(req => handleGemApplication(req, async header => {
  if (!header) return null;
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: header } } });
  const { data: { user }, error } = await client.auth.getUser();
  return error ? null : user?.id ?? null;
}, async args => {
  // Never forward the player's JWT into the trusted canonical XP context.
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  return await client.rpc('gem_application_internal', args);
}));
