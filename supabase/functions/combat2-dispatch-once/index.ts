import { createClient } from 'npm:@supabase/supabase-js@2';
import inventory from '../_shared/combat2/active-abilities.json' with { type: 'json' };
import type { AuthoredAbilityRecord } from '../_shared/combat2/catalog.ts';
import { processNodeTickOnce } from '../_shared/combat2/process-node-tick-once.ts';
import { createCombat2DispatchHandler } from './handler.ts';

const handler = createCombat2DispatchHandler({
  env: (name) => Deno.env.get(name),
  createClient: (url, serviceRoleKey) => createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  processNodeTickOnce,
  abilityRecords: (inventory as { abilities: AuthoredAbilityRecord[] }).abilities,
  log: (message, detail) => console.log(message, detail),
});

Deno.serve(handler);
