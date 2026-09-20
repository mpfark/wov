import { createClient } from 'npm:@supabase/supabase-js@2';
import inventory from '../_shared/combat2/active-abilities.json' with { type: 'json' };
import type { AuthoredAbilityRecord } from '../_shared/combat2/catalog.ts';
import type { AppliedStatusRow } from '../_shared/config/status-contract.ts';
import { processNodeTickOnce } from '../_shared/combat2/process-node-tick-once.ts';
import { createCombat2DispatchHandler } from './handler.ts';

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void };

const handler = createCombat2DispatchHandler({
  env: (name) => Deno.env.get(name),
  createClient: (url, serviceRoleKey) => createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  processNodeTickOnce,
  abilityRecords: (inventory as { abilities: AuthoredAbilityRecord[] }).abilities,
  statusRecords: (inventory as { statuses: AppliedStatusRow[] }).statuses,
  log: (message, detail) => console.log(message, detail),
  defer: (work) => EdgeRuntime.waitUntil(Promise.resolve(work)),
});

Deno.serve(handler);
