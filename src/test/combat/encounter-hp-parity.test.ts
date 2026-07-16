/**
 * M2 parity harness — simulates the two write paths against a shared
 * in-memory creature row to prove the encounter-owned delta path
 * preserves total damage under concurrent writers, while the legacy
 * absolute-hp path loses updates.
 *
 * This is a client-side unit test with a hand-rolled db shim that
 * mirrors the pg RPC contracts. It intentionally does NOT hit a real
 * database — the real RPCs are exercised by the shadow parity script.
 */
import { describe, it, expect } from 'vitest';
import { writeCreatureState } from '../../../supabase/functions/_shared/combat-resolver.ts';

// ── DB shim ─────────────────────────────────────────────────────
function makeDb(initialCreature: { id: string; hp: number; max_hp: number; is_alive?: boolean; is_aggressive?: boolean }) {
  const state = {
    id: initialCreature.id,
    hp: initialCreature.hp,
    max_hp: initialCreature.max_hp,
    is_alive: initialCreature.is_alive ?? true,
    is_aggressive: initialCreature.is_aggressive ?? false,
    caused_kill_count: 0,
    encounter_attached: false,
  };

  const db = {
    _state: state,
    rpc: async (name: string, args: any) => {
      if (name === 'damage_creature') {
        if (args._killed) {
          state.hp = 0;
          state.is_alive = false;
        } else {
          state.hp = args._new_hp; // legacy: absolute write (lossy)
        }
        return { data: null, error: null };
      }
      if (name === 'encounter_apply_damage') {
        // Attach idempotently
        state.encounter_attached = true;
        if (!state.is_alive) return { data: [{ new_hp: 0, old_hp: 0, caused_kill: false }], error: null };
        const oldHp = state.hp;
        const newHp = Math.max(oldHp - args._amount, 0);
        state.hp = newHp;
        state.is_aggressive = true;
        let causedKill = false;
        if (newHp === 0) {
          state.is_alive = false;
          state.caused_kill_count += 1;
          state.encounter_attached = false; // detach on kill
          causedKill = true;
        }
        return { data: [{ new_hp: newHp, old_hp: oldHp, caused_kill: causedKill }], error: null };
      }
      throw new Error('unexpected rpc ' + name);
    },
    from: (_table: string) => ({
      update: (_patch: any) => ({ in: (_col: string, _ids: string[]) => Promise.resolve({ data: null, error: null }) }),
    }),
  };
  return db;
}

// ── Cases ──────────────────────────────────────────────────────

describe('M2 encounter-owned HP delta parity', () => {
  it('single writer: legacy and encounter paths land the same HP', async () => {
    const legacy = makeDb({ id: 'c1', hp: 100, max_hp: 100 });
    const enc = makeDb({ id: 'c1', hp: 100, max_hp: 100 });
    const cr = [{ id: 'c1', hp: 100, is_aggressive: false }];
    const cHp = { c1: 80 };
    const cKilled = new Set<string>();

    await writeCreatureState(legacy, cr, cHp, cKilled);
    await writeCreatureState(enc, cr, cHp, cKilled, {
      useEncounter: true,
      sourceCharacterId: 'char1',
      sourceKind: 'autoattack',
    });

    expect(legacy._state.hp).toBe(80);
    expect(enc._state.hp).toBe(80);
    expect(enc._state.is_aggressive).toBe(true);
  });

  it('two parties same creature: legacy loses an update; encounter preserves total damage', async () => {
    // Both ticks start from the same snapshot (hp=100) and each intend to
    // deal 20 damage. Correct behavior: hp = 60 after both writes.
    const legacy = makeDb({ id: 'c1', hp: 100, max_hp: 100 });
    const enc = makeDb({ id: 'c1', hp: 100, max_hp: 100 });

    const crSnapshotA = [{ id: 'c1', hp: 100, is_aggressive: false }];
    const crSnapshotB = [{ id: 'c1', hp: 100, is_aggressive: false }];
    const cHpA = { c1: 80 };
    const cHpB = { c1: 80 };
    const empty = new Set<string>();

    // Legacy: two absolute writes both land 80 → total damage recorded = 20.
    await writeCreatureState(legacy, crSnapshotA, cHpA, empty);
    await writeCreatureState(legacy, crSnapshotB, cHpB, empty);
    expect(legacy._state.hp).toBe(80); // lost update

    // Encounter: two deltas of 20 stack → hp = 60.
    await writeCreatureState(enc, crSnapshotA, cHpA, empty, {
      useEncounter: true, sourceCharacterId: 'a', sourceKind: 'autoattack',
    });
    await writeCreatureState(enc, crSnapshotB, cHpB, empty, {
      useEncounter: true, sourceCharacterId: 'b', sourceKind: 'autoattack',
    });
    expect(enc._state.hp).toBe(60); // total damage preserved
  });

  it('kill transition: caused_kill fires exactly once and detaches the encounter row', async () => {
    const enc = makeDb({ id: 'c1', hp: 25, max_hp: 100 });
    const crA = [{ id: 'c1', hp: 25, is_aggressive: true }];
    const crB = [{ id: 'c1', hp: 25, is_aggressive: true }];
    const cHpA = { c1: 5 };  // 20 dmg
    const cHpB = { c1: 5 };  // 20 dmg (from same snapshot)
    const empty = new Set<string>();

    await writeCreatureState(enc, crA, cHpA, empty, {
      useEncounter: true, sourceCharacterId: 'a', sourceKind: 'autoattack',
    });
    await writeCreatureState(enc, crB, cHpB, empty, {
      useEncounter: true, sourceCharacterId: 'b', sourceKind: 'autoattack',
    });

    expect(enc._state.hp).toBe(0);
    expect(enc._state.is_alive).toBe(false);
    expect(enc._state.caused_kill_count).toBe(1);
    expect(enc._state.encounter_attached).toBe(false); // detached on kill
  });

  it('skips no-op writes (intended hp equals current hp)', async () => {
    const enc = makeDb({ id: 'c1', hp: 100, max_hp: 100 });
    const cr = [{ id: 'c1', hp: 100, is_aggressive: false }];
    const cHp = { c1: 100 };
    await writeCreatureState(enc, cr, cHp, new Set(), {
      useEncounter: true, sourceCharacterId: 'a', sourceKind: 'autoattack',
    });
    expect(enc._state.hp).toBe(100);
    expect(enc._state.encounter_attached).toBe(false);
  });
});
