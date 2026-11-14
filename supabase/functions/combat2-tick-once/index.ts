/**
 * Internal, manual Edge boundary for exactly one Combat2 node tick.
 *
 * The worker dependency graph is mechanically generated from the canonical
 * environment-neutral source into `_shared/combat2`; an exact parity test
 * prevents the deployable Edge mirror from drifting from Node/Vite.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import inventory from "../_shared/combat2/active-abilities.json" with { type: "json" };
import type { AuthoredAbilityRecord } from "../_shared/combat2/engine.ts";
import type { AppliedStatusRow } from "../_shared/combat2/engine.ts";
import { processNodeTickOnce } from "../_shared/combat2/process-node-tick-once.ts";
import { createCombat2TickHandler } from "./handler.ts";
import { reusableRpcClient } from "../_shared/combat2-rpc-client.ts";

const httpClient = Deno.createHttpClient({ poolMaxIdlePerHost: 4, poolIdleTimeout: 90_000 });
const pooledClient = reusableRpcClient((url, serviceRoleKey) => createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => Deno.fetch(input, { ...init, client: httpClient }) },
}));

const handler = createCombat2TickHandler({
  env: (name) => Deno.env.get(name),
  createClient: pooledClient,
  processNodeTickOnce,
  abilityRecords: (inventory as { abilities: AuthoredAbilityRecord[] }).abilities,
  statusRecords: (inventory as { statuses: AppliedStatusRow[] }).statuses,
  log: (message, detail) => console.log(message, detail),
});

Deno.serve(handler);
