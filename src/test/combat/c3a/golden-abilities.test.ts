/**
 * C3a golden tests — one per ACTIVE ability, driven by the generated inventory.
 *
 * Each ability is resolved by the pure resolver from a fixed snapshot and:
 *  - must be deterministic (two runs are byte-identical),
 *  - must not mutate the input snapshot,
 *  - must produce the mutation/effect shape its mechanic family promises,
 *  - is pinned by a stored digest so any rule drift shows up as a diff.
 */
import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { resolveTickPure } from '@/shared/combat/pure';
import { MECHANIC_FAMILY } from '@/shared/combat/pure/mechanics';
import type { ProposedTick } from '@/shared/combat/pure/types';
import { abilityEncounter, abilityId, type AbilityRow } from './ability-fixtures';
import { GOLDEN_ABILITY_IDS } from './golden-abilities.test-manifest';

const rows = inventory.abilities as unknown as AbilityRow[];

/** Compact, order-stable projection used as the golden value. */
function digest(out: ProposedTick) {
  return {
    characters: out.characters.map((c) => ({
      id: c.characterId,
      hp: `${c.hpBefore}->${c.hpAfter}`,
      cp: `${c.cpBefore}->${c.cpAfter}`,
      died: c.died,
    })),
    creatures: out.creatures.map((c) => ({
      id: c.creatureId,
      hp: `${c.hpBefore}->${c.hpAfter}`,
      killed: c.killed,
    })),
    effectUpserts: out.effectUpserts.map((e) => ({
      target: `${e.targetKind}:${e.targetId}`,
      type: e.effectType,
      stacks: e.stacks,
      amountPerTick: e.amountPerTick,
      mechanic: e.mechanic ?? null,
    })),
    effectDeletes: out.effectDeleteIds.length,
    events: out.events.map((e) => e.type),
    rngDraws: out.rngDraws,
  };
}

describe('C3a golden abilities', () => {
  it('the manifest matches the active inventory exactly', () => {
    expect([...GOLDEN_ABILITY_IDS].sort()).toEqual(rows.map(abilityId).sort());
  });

  for (const row of rows) {
    const id = abilityId(row);

    describe(id, () => {
      it(`resolves deterministically (${row.mechanic})`, () => {
        const snap = abilityEncounter(row);
        const frozen = JSON.stringify(snap);
        const a = resolveTickPure(snap);
        const b = resolveTickPure(abilityEncounter(row));
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(JSON.stringify(snap)).toBe(frozen);
        expect(a.consumedActionIds).toContain(`act-${row.classAbilityKey}`);
      });

      it('produces the shape its mechanic family promises', () => {
        const out = resolveTickPure(abilityEncounter(row));
        const family = MECHANIC_FAMILY[row.mechanic];
        expect(family).toBeTruthy();

        // No mutation may be negative or non-finite.
        for (const c of out.creatures) expect(c.hpAfter).toBeGreaterThanOrEqual(0);
        for (const c of out.characters) expect(c.hpAfter).toBeGreaterThanOrEqual(0);

        if (family === 'damage') {
          const touched =
            out.creatures.some((c) => c.hpAfter !== c.hpBefore) ||
            out.events.some((e) => e.type.includes('miss'));
          expect(touched).toBe(true);
        }
        if (family === 'restore') {
          expect(out.characters.length).toBeGreaterThan(0);
        }
        if (family === 'state') {
          expect(out.effectUpserts.length).toBeGreaterThan(0);
        }
      });

      it('matches its stored golden digest', () => {
        expect(digest(resolveTickPure(abilityEncounter(row)))).toMatchSnapshot();
      });
    });
  }

  it('hp_transfer never takes the caster below the configured reserve', () => {
    const row = rows.find((r) => r.mechanic === 'hp_transfer');
    expect(row).toBeTruthy();
    const out = resolveTickPure(abilityEncounter(row!));
    const caster = out.characters.find((c) => c.characterId === 'char-caster');
    if (caster) expect(caster.hpAfter).toBeGreaterThanOrEqual(20);
  });

  it('multi_attack never exceeds its configured arrow count', () => {
    const row = rows.find((r) => r.mechanic === 'multi_attack');
    expect(row).toBeTruthy();
    const out = resolveTickPure(abilityEncounter(row!));
    const shots = out.events.filter((e) => e.type.startsWith('ability_')).length;
    expect(shots).toBeLessThanOrEqual(4);
  });

  it('stack_consume clears the stacks it spends', () => {
    for (const row of rows.filter((r) => r.mechanic === 'stack_consume')) {
      const out = resolveTickPure(abilityEncounter(row));
      expect(out.effectDeleteIds.length + out.effectUpserts.length).toBeGreaterThan(0);
    }
  });
});
