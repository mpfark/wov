/**
 * One-shot, internal provisioning boundary.
 *
 * Reads the already-configured COMBAT2_WORKER_SECRET from the runtime
 * environment and hands it to a single fixed-purpose database routine that
 * stores it in Database Vault under one hardcoded name. The value never enters
 * a request, a response, or a log line.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createCombat2ProvisionHandler } from './handler.ts';

const handler = createCombat2ProvisionHandler({
  env: (name) => Deno.env.get(name),
  createClient: (url, serviceRoleKey) => createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  log: (message, detail) => console.log(message, detail),
});

Deno.serve(handler);
