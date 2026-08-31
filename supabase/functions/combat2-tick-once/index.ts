/**
 * Internal, manual Edge boundary for exactly one Combat2 node tick.
 *
 * The imported worker and its dependency graph use only environment-neutral
 * TypeScript/Web APIs, so Node/Vite tests and the Deno Edge bundle execute the
 * same orchestration implementation; there is deliberately no Edge mirror.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import inventory from "../../../src/shared/combat/inventory/active-abilities.json" with { type: "json" };
import type { AuthoredAbilityRecord } from "../../../src/shared/combat2/catalog.ts";
import { processNodeTickOnce } from "../../../src/server/combat2/process-node-tick-once.ts";
import { createCombat2TickHandler } from "./handler.ts";

const handler = createCombat2TickHandler({
  env: (name) => Deno.env.get(name),
  createClient: (url, serviceRoleKey) => createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  processNodeTickOnce,
  abilityRecords: (inventory as { abilities: AuthoredAbilityRecord[] }).abilities,
  log: (message, detail) => console.log(message, detail),
});

Deno.serve(handler);
