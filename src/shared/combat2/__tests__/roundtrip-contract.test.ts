/**
 * The installed-contract round trip, replayed offline.
 *
 * The claim envelope below is the VERBATIM output of the installed
 * `public.node_tick_claim` for a disposable equipped fighter whose first hit
 * kills the creature (captured while combat was closed; the fixtures were rolled
 * back). Replaying it here keeps the strict decoder and the pure resolver honest
 * about the real projection instead of a hand-shaped snapshot.
 */
import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityRecord } from '../catalog';
import { decodeClaim, decodeSnapshot } from '../decode';
import { resolveNodeTick } from '../resolver';

export const CLAIM = {
  ok: true,
  kind: 'claimed',
  encounter_id: 'aaaa0000-0000-4000-8000-000000000001',
  last_committed_tick: 0,
  candidate_tick: 1,
  state_version: 1,
  claim_token: 'af6e262e-e5e0-4637-b719-b7ba798342f2',
  intent_cutoff_seq: 1,
  snapshot: {
    boss_abilities: [],
    creatures: [
      {
        ac: 1,
        boss_crit_flavors: [],
        boss_death_cry: '',
        creature_id: 'aaaa0000-0000-4000-8000-000000000003',
        hp: 1,
        id: 'aaaa0000-0000-4000-8000-000000000004',
        is_aggressive: false,
        is_alive: true,
        engaged: true,
        is_humanoid: false,
        level: 5,
        max_hp: 1,
        name: 'Harness Dummy',
        pending_action: null,
        rarity: 'regular',
        spawn_seq: 7,
        stats: { str: 10 },
        tank_fighter_id: null,
      },
    ],
    effects: [],
    encounter: {
      candidate_tick: 1,
      id: 'aaaa0000-0000-4000-8000-000000000001',
      node_id: 'af512927-2a59-406d-8dbb-0442e1a485e5',
      now: '2026-08-29T14:02:06.813371+00:00',
      state_version: 1,
      tick: 0,
    },
    fighters: [
      {
        ac: 12,
        cha: 10,
        character_id: 'aaaa0000-0000-4000-8000-000000000002',
        class: 'warrior',
        con: 14,
        cp: 100,
        dex: 14,
        entry_seq: 1,
        equipment: [
          {
            applied_gems: {},
            character_id: 'aaaa0000-0000-4000-8000-000000000002',
            crafted_level: null,
            durability: 100,
            hands: 1,
            inventory_id: 'aaaa0000-0000-4000-8000-000000000006',
            item_id: '0c7d24c1-785b-4f4c-8ac0-5b91eed7c7e6',
            item_level: 1,
            item_present: true,
            item_type: 'equipment',
            rarity: 'common',
            slot: 'main_hand',
            stat_override: null,
            weapon_tag: 'dagger',
          },
        ],
        hp: 100,
        id: 'aaaa0000-0000-4000-8000-000000000005',
        int: 10,
        level: 10,
        max_cp: 100,
        max_hp: 100,
        max_mp: 10,
        mp: 10,
        name: 'Harnessa',
        party_id: null,
        party_id_at_entry: null,
        present: true,
        race: 'human',
        str: 18,
        wis: 10,
      },
    ],
    intents: [
      {
        ability_key: 'power_strike',
        character_id: 'aaaa0000-0000-4000-8000-000000000002',
        id: 'aaaa0000-0000-4000-8000-000000000007',
        intent_kind: 'ability',
        seq: 1,
        stance_key: null,
        target_creature_id: 'aaaa0000-0000-4000-8000-000000000003',
      },
    ],
    participation: [],
    pending_events: [],
    tank_candidates: [
      {
        fighter_id: 'aaaa0000-0000-4000-8000-000000000005',
        character_id: 'aaaa0000-0000-4000-8000-000000000002',
        entry_seq: 1,
      },
    ],
  },
};

const { specs } = buildAbilityCatalog(
  (inventory as { abilities: AuthoredAbilityRecord[] }).abilities,
);

describe('installed claim contract', () => {
  it('decodes the real claim envelope, including the equipped weapon', () => {
    const decoded = decodeClaim(CLAIM);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.claimToken).toBe(CLAIM.claim_token);
    const main = decoded.snapshot.fighters[0].equipment.find((e) => e.slot === 'main_hand');
    expect(main).toMatchObject({
      character_id: 'aaaa0000-0000-4000-8000-000000000002',
      item_present: true,
      weapon_tag: 'dagger',
      hands: 1,
      item_level: 1,
      rarity: 'common',
    });
  });

  it('refuses a claim that was not won, so no tick can be resolved for it', () => {
    expect(decodeClaim({ ok: false, kind: 'not_due' }).ok).toBe(false);
    expect(decodeClaim({ ok: true, kind: 'no_claim' }).ok).toBe(false);
  });

  it('fails closed on a mistyped projection instead of coercing it', () => {
    const broken = structuredClone(CLAIM.snapshot) as Record<string, unknown>;
    (broken.fighters as Array<Record<string, unknown>>)[0].hp = '100';
    const out = decodeSnapshot(broken) as { ok: boolean; errors?: string[] };
    expect(out.ok).toBe(false);
    expect((out.errors ?? []).join(';')).toContain('fighters[0].hp');
  });

  it('rejects a null effect_type because the claimed node_effect column is NOT NULL', () => {
    const broken = structuredClone(CLAIM.snapshot) as Record<string, unknown>;
    broken.effects = [{
      id: 'aaaa0000-0000-4000-8000-000000000008',
      kind: 'dot',
      effect_type: null,
      ability_key: null,
      target_character_id: 'aaaa0000-0000-4000-8000-000000000002',
      target_creature_id: null,
      source_character_id: null,
      source_creature_id: null,
      stacks: 1,
      magnitude: null,
      config: {},
      expires_at: null,
      next_due_at: null,
      interval_ms: null,
      last_pulse_tick: null,
      is_reservation: false,
    }];
    const out = decodeSnapshot(broken) as { ok: boolean; errors?: string[] };
    expect(out.ok).toBe(false);
    expect((out.errors ?? []).join(';')).toContain('effects[0].effect_type');
  });

  it('never invents equipment when the projection omits a field', () => {
    const broken = structuredClone(CLAIM.snapshot) as Record<string, unknown>;
    const equipment = (broken.fighters as Array<Record<string, unknown>>)[0].equipment as Array<
      Record<string, unknown>
    >;
    delete equipment[0].item_present;
    const out = decodeSnapshot(broken) as { ok: boolean; errors?: string[] };
    expect(out.ok).toBe(false);
    expect((out.errors ?? []).join(';')).toContain('equipment[0].item_present');
  });

  it('rejects malformed, duplicate, or foreign claimed tank candidates', () => {
    const malformed = structuredClone(CLAIM.snapshot) as Record<string, unknown>;
    (malformed.tank_candidates as Array<Record<string, unknown>>)[0].entry_seq = '1';
    expect(decodeSnapshot(malformed).ok).toBe(false);

    const malformedId = structuredClone(CLAIM.snapshot) as Record<string, unknown>;
    (malformedId.tank_candidates as Array<Record<string, unknown>>)[0].fighter_id = 'not-a-uuid';
    const malformedIdResult = decodeSnapshot(malformedId) as { ok: boolean; errors?: string[] };
    expect(malformedIdResult.ok).toBe(false);
    expect((malformedIdResult.errors ?? []).join(';')).toContain('expected UUID fighter and character ids');

    const duplicate = structuredClone(CLAIM.snapshot) as Record<string, unknown>;
    duplicate.tank_candidates = [CLAIM.snapshot.tank_candidates[0], CLAIM.snapshot.tank_candidates[0]];
    const duplicateResult = decodeSnapshot(duplicate) as { ok: boolean; errors?: string[] };
    expect(duplicateResult.ok).toBe(false);
    expect((duplicateResult.errors ?? []).join(';')).toContain('duplicate candidate');

    const foreign = structuredClone(CLAIM.snapshot) as Record<string, unknown>;
    foreign.tank_candidates = [{
      fighter_id: 'bbbb0000-0000-4000-8000-000000000001',
      character_id: CLAIM.snapshot.fighters[0].character_id,
      entry_seq: 1,
    }];
    const foreignResult = decodeSnapshot(foreign) as { ok: boolean; errors?: string[] };
    expect(foreignResult.ok).toBe(false);
    expect((foreignResult.errors ?? []).join(';')).toContain('binding does not match an eligible claimed fighter');
  });

  it.each(['started_at_tick', 'target_fighter_id', 'target_character_id', 'target_entry_seq'])(
    'fails closed when a pending cast omits %s',
    (field) => {
      const broken = structuredClone(CLAIM.snapshot) as Record<string, unknown>;
      const creature = (broken.creatures as Array<Record<string, unknown>>)[0];
      creature.pending_action = {
        ability_key: 'granite_slam', ability_label: 'Granite Slam',
        started_at_tick: 1, resolve_at_tick: 3,
        target_fighter_id: CLAIM.snapshot.fighters[0].id,
        target_character_id: CLAIM.snapshot.fighters[0].character_id,
        target_entry_seq: CLAIM.snapshot.fighters[0].entry_seq,
      };
      delete (creature.pending_action as Record<string, unknown>)[field];
      const out = decodeSnapshot(broken) as { ok: boolean; errors?: string[] };
      expect(out.ok).toBe(false);
      expect((out.errors ?? []).join(';')).toContain(`pending_action.${field}`);
    },
  );

  it('fails closed when pending_action is not an object', () => {
    const broken = structuredClone(CLAIM.snapshot) as Record<string, unknown>;
    (broken.creatures as Array<Record<string, unknown>>)[0].pending_action = 'granite_slam';
    const out = decodeSnapshot(broken) as { ok: boolean; errors?: string[] };
    expect(out.ok).toBe(false);
    expect((out.errors ?? []).join(';')).toContain('pending_action: expected object');
  });

  it('resolves the first-hit kill with the equipped weapon, proposing same-tick participation', () => {
    const decoded = decodeClaim(CLAIM);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const out = resolveNodeTick(decoded.snapshot, { abilities: specs });

    const attack = out.events.find((e) => e.kind === 'attack');
    expect(attack?.meta?.weaponDie).toBe(4); // the equipped dagger, not the unarmed die
    expect(out.creatures[0]).toMatchObject({ hp: 0, is_alive: false, spawn_seq: 7 });
    expect(out.events.filter((e) => e.kind === 'creature_died')).toHaveLength(1);
    expect(out.participation).toEqual([
      {
        creature_id: 'aaaa0000-0000-4000-8000-000000000003',
        spawn_seq: 7,
        character_id: 'aaaa0000-0000-4000-8000-000000000002',
        qualification: 'qualified',
        qualified_by: 'damage',
        party_id_at_qualification: null,
      },
    ]);
    expect(out.rewards).toEqual([
      {
        creature_id: 'aaaa0000-0000-4000-8000-000000000003',
        spawn_seq: 7,
        character_id: 'aaaa0000-0000-4000-8000-000000000002',
        xp_awarded: 12,
        gold_awarded: 0,
        is_killer: true,
      },
    ]);
    expect(out.intent_ids).toEqual(['aaaa0000-0000-4000-8000-000000000007']);
  });

  it('is deterministic: the same claim proposes a byte-identical tick', () => {
    const a = decodeClaim(CLAIM);
    const b = decodeClaim(CLAIM);
    if (!a.ok || !b.ok) throw new Error('decode failed');
    expect(JSON.stringify(resolveNodeTick(a.snapshot, { abilities: specs }))).toBe(
      JSON.stringify(resolveNodeTick(b.snapshot, { abilities: specs })),
    );
  });
});
