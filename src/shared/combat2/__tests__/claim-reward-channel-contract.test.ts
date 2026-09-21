/**
 * Regression for the proven live failure: the installed `node_tick_claim`
 * projection omits the creature reward-channel fields the deployed decoder
 * requires, so every claim is rejected immediately after acquisition
 * (`snapshot_rejected after claim_acquired`) and no tick ever commits.
 *
 * The fixture below is the sanitized INSTALLED shape: the captured claim with
 * exactly the six fields the installed SQL does not emit removed. The decoder
 * must keep rejecting it (fail-closed, never defaulted), the worker must stop
 * at decode, and the authored forward migration must repair the projection.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import type { AuthoredAbilityInventory, AuthoredAbilityRecord } from '../catalog';
import { decodeClaim } from '../decode';
import { CLAIM } from './roundtrip-contract.test';
import { processNodeTickOnce } from '../../../server/combat2/process-node-tick-once';

const MISSING = ['gold_enabled', 'gold_min', 'gold_max', 'gold_chance', 'salvage_enabled', 'item_source'] as const;
const abilities = (inventory as { abilities: AuthoredAbilityRecord[] }).abilities;
const statuses = (inventory as AuthoredAbilityInventory).statuses;

function installedShapeClaim() {
  const claim = patchedShapeClaim();
  for (const creature of claim.snapshot.creatures) for (const field of MISSING) delete creature[field];
  return claim;
}

function patchedShapeClaim() {
  const claim = structuredClone(CLAIM) as any;
  claim.snapshot.boss_configurations = claim.snapshot.creatures.map((creature: any) => ({
    encounter_id: claim.encounter_id,
    node_creature_id: creature.id,
    creature_id: creature.creature_id,
    spawn_seq: creature.spawn_seq,
    boss_cast: null,
  }));
  return claim;
}

describe('installed claim reward-channel contract', () => {
  it('rejects the installed projection at the exact creature field paths', () => {
    const decoded = decodeClaim(installedShapeClaim());
    expect(decoded.ok).toBe(false);
    const errors = (decoded as { ok: false; errors: string[] }).errors;
    expect(errors).toEqual(expect.arrayContaining([
      'snapshot.creatures[0].gold_enabled: expected boolean',
      'snapshot.creatures[0].gold_min: expected finite number',
      'snapshot.creatures[0].gold_max: expected finite number',
      'snapshot.creatures[0].gold_chance: expected finite number',
      'snapshot.creatures[0].salvage_enabled: expected boolean',
      'snapshot.creatures[0].item_source: expected non-empty string',
    ]));
  });

  it('accepts the patched projection and still rejects a mistyped one', () => {
    expect(decodeClaim(patchedShapeClaim()).ok).toBe(true);
    const malformed = patchedShapeClaim();
    malformed.snapshot.creatures[0].item_source = 42;
    malformed.snapshot.creatures[0].gold_chance = 'often';
    const decoded = decodeClaim(malformed);
    expect(decoded.ok).toBe(false);
    expect((decoded as { ok: false; errors: string[] }).errors).toEqual(expect.arrayContaining([
      'snapshot.creatures[0].item_source: expected non-empty string',
      'snapshot.creatures[0].gold_chance: expected finite number',
    ]));
  });

  it('stops the worker at decode for the installed shape and never commits', async () => {
    const commits: unknown[] = [];
    const result = await processNodeTickOnce(CLAIM.snapshot.encounter.node_id, {
      abilityRecords: abilities,
      statusRecords: statuses,
      transport: {
        async claimNode() { return installedShapeClaim(); },
        async commitTick(args) { commits.push(args); return { ok: true, kind: 'committed', tick: 1 }; },
      },
    });
    expect(result.kind).toBe('snapshot_rejected');
    expect(commits).toHaveLength(0);
  });

  it('processes past claim acquisition exactly once for the patched shape', async () => {
    const claims: string[] = [];
    const commits: unknown[] = [];
    const result = await processNodeTickOnce(CLAIM.snapshot.encounter.node_id, {
      abilityRecords: abilities,
      statusRecords: statuses,
      transport: {
        async claimNode(nodeId) { claims.push(nodeId); return patchedShapeClaim(); },
        async commitTick(args) { commits.push(args); return { ok: true, kind: 'committed', tick: 1 }; },
      },
    });
    expect(result.kind).toBe('committed');
    expect(claims).toHaveLength(1);
    expect(commits).toHaveLength(1);
  });

  it('the installed forward migration repairs the projection without ADM-025B work', () => {
    const staged = readFileSync('supabase/pending/20260922000000_combat2_claim_reward_channel_contract.sql', 'utf8');
    const installed = readFileSync('supabase/migrations/20260921223049_274ba4d5-ba04-41c3-90fd-ab79cd77b566.sql', 'utf8');
    expect(staged).toBe(installed);
    for (const field of MISSING) expect(installed).toContain(`cr.${field}`);
    expect(installed).toContain('pg_get_functiondef');
    expect(installed).toContain('node_tick_claim_without_canary_gate(uuid,integer)');
    expect(installed).toMatch(/projection marker not found/);
    const statements = installed.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
    expect(statements).not.toMatch(/unique_boss_drop|unique_item_id|unique_drop_chance|CREATE TRIGGER|DELETE FROM|ADM-025B preflight/);
  });
});
