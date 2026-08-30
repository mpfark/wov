/** Manual development entry point. Mutates at most one selected node encounter. */
import { createClient } from '@supabase/supabase-js';
import inventory from '../src/shared/combat/inventory/active-abilities.json' with { type: 'json' };
import type { AuthoredAbilityRecord } from '../src/shared/combat2/catalog.ts';
import {
  processNodeTickOnce,
  type CommitTickArgs,
  type NodeTickTransport,
} from '../src/server/combat2/process-node-tick-once.ts';

const nodeId = process.argv[2];
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!nodeId || !UUID.test(nodeId)) throw new Error('usage: npm run combat2:tick-once -- <explicit-node-uuid>');
if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

console.error(`WARNING: a successful invocation mutates the active encounter at node ${nodeId}.`);
const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const transport: NodeTickTransport = {
  async claimNode(id) {
    const { data, error } = await client.rpc('node_tick_claim', { _node_id: id });
    if (error) throw new Error(`node_tick_claim failed: ${error.code ?? 'database_error'}`);
    return data;
  },
  async commitTick(args: CommitTickArgs) {
    const { data, error } = await client.rpc('node_tick_commit', args as never);
    if (error) throw new Error(`node_tick_commit failed: ${error.code ?? 'database_error'}`);
    return data;
  },
};

const result = await processNodeTickOnce(nodeId, {
  transport,
  abilityRecords: (inventory as { abilities: AuthoredAbilityRecord[] }).abilities,
});
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
