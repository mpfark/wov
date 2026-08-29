/**
 * scripts/combat2-roundtrip-harness.ts — TEST HARNESS ONLY.
 *
 * Reads a real `public.node_tick_claim` envelope as JSON on stdin, decodes it
 * through the strict TypeScript contract (`decodeClaim`), resolves one tick with
 * the pure resolver against the real authored ability catalogue, and prints the
 * `node_tick_commit` arguments as JSON on stdout.
 *
 * This is deliberately NOT a worker: it has no scheduler, no lease renewal, no
 * database client, no retry loop and no Realtime path. It exists so an isolated
 * claim -> decode -> resolve -> commit round trip can be run and inspected by
 * hand while combat is closed.
 *
 *   bun scripts/combat2-roundtrip-harness.ts < claim.json > proposed.json
 */

import inventory from '../src/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityRecord } from '../src/shared/combat2/catalog';
import { decodeClaim } from '../src/shared/combat2/decode';
import { resolveNodeTick } from '../src/shared/combat2/resolver';

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks).toString('utf8');
}

const raw = JSON.parse(await readStdin());
const envelope = raw.claim ?? raw;

const decoded = decodeClaim(envelope);
if (!decoded.ok) {
  console.error(JSON.stringify({ ok: false, errors: decoded.errors }, null, 2));
  process.exit(1);
}

const { specs, rejected } = buildAbilityCatalog(
  (inventory as { abilities: AuthoredAbilityRecord[] }).abilities,
);

const proposed = resolveNodeTick(decoded.snapshot, { abilities: specs });

console.log(
  JSON.stringify(
    {
      commit_args: {
        _encounter_id: decoded.snapshot.encounter.id,
        _claim_token: decoded.claimToken,
        _candidate_tick: decoded.snapshot.encounter.candidate_tick,
        _expected_last_tick: decoded.snapshot.encounter.tick,
        _expected_state_version: decoded.snapshot.encounter.state_version,
        _intent_ids: proposed.intent_ids,
        _proposed: proposed,
      },
      weapon: decoded.snapshot.fighters.map((f) => ({
        character_id: f.character_id,
        main_hand: f.equipment.find((e) => e.slot === 'main_hand') ?? null,
      })),
      rejected_abilities: rejected.length,
    },
    null,
    2,
  ),
);
