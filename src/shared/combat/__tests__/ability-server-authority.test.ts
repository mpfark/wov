/**
 * ability-server-authority.test.ts — Phase 3.
 *
 * The server owns every value a cast resolves with:
 *   - CP cost comes from `abilities.cp_cost` (the queued row is a claim);
 *   - damage type comes from `abilities.damage_type` and is stamped on events;
 *   - the mechanic dispatched is the registry mechanic, not the queued hint;
 *   - a technique may only be cast from the bar slot the character equipped.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Entry {
  abilityKey: string; mechanicKey: string; classKey: string; roleSlot: number;
  abilityId: string | null; roleId: string | null; isDefault: boolean;
  cpCost: number; damageType: string | null;
}
interface Loader {
  setServerAbilityCalcs(rows: unknown[]): { applied: boolean; errors: string[] };
  getServerAbilityCalcs(classKey: string, abilityKey: string): Entry | null;
  authorizeQueuedAbility(args: {
    classKey: string; level: number; abilityKey?: string | null; abilityType?: string | null;
    equippedByRole?: Record<string, string> | null;
  }): { entry: Entry | null; abilityKey: string; roleSlot: number; error: string | null };
  resetServerAbilityCalcs(): void;
}
const LOADER_PATH = '../../../../supabase/functions/_shared/load-ability-calcs.ts';
let loader: Loader;

const calc = (base: number) => ({ base, terms: [] });

function row(opts: {
  abilityKey: string; mechanicKey: string; cpCost: number; damageType: string | null;
  isDefault?: boolean; slot?: number; classKey?: string;
}) {
  return {
    class_key: opts.classKey ?? 'warrior',
    ability_id: `${opts.abilityKey}-id`,
    role_id: `role-${opts.slot ?? 3}`,
    is_default: opts.isDefault ?? true,
    status: 'active',
    unlock_level: 1,
    role: { id: `role-${opts.slot ?? 3}`, slot: opts.slot ?? 3 },
    ability: {
      id: `${opts.abilityKey}-id`,
      ability_key: opts.abilityKey,
      mechanic_key: opts.mechanicKey,
      status: 'active',
      cp_cost: opts.cpCost,
      damage_type: opts.damageType,
      amount_calc: calc(10),
      duration_calc: null,
      interval_ms: null,
      effect_config: {},
      mechanic_calcs: {},
    },
  };
}

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
  loader = (await import(/* @vite-ignore */ LOADER_PATH)) as unknown as Loader;
});

beforeEach(() => {
  loader.resetServerAbilityCalcs();
  loader.setServerAbilityCalcs([
    row({ abilityKey: 'rend', mechanicKey: 'power_strike', cpCost: 12, damageType: 'physical' }),
    row({ abilityKey: 'lacerate', mechanicKey: 'power_strike', cpCost: 30, damageType: 'physical', isDefault: false }),
  ]);
});

describe('Phase 3 — authoritative cost and damage type', () => {
  it('carries cp_cost and damage_type from configuration', () => {
    const e = loader.getServerAbilityCalcs('warrior', 'rend')!;
    expect(e.cpCost).toBe(12);
    expect(e.damageType).toBe('physical');
  });

  it('the alternative keeps its own cost, not the default one', () => {
    const auth = loader.authorizeQueuedAbility({
      classKey: 'warrior', level: 42, abilityKey: 'lacerate',
      equippedByRole: { 'role-3': 'lacerate-id' },
    });
    expect(auth.error).toBeNull();
    expect(auth.entry?.cpCost).toBe(30);
  });

  it('normalizes an unknown damage type to null rather than trusting it', () => {
    loader.resetServerAbilityCalcs();
    loader.setServerAbilityCalcs([
      row({ abilityKey: 'rend', mechanicKey: 'power_strike', cpCost: 12, damageType: 'nonsense' }),
    ]);
    expect(loader.getServerAbilityCalcs('warrior', 'rend')?.damageType).toBeNull();
  });
});

describe('Phase 3 — equipped-loadout enforcement', () => {
  it('rejects a technique that is not equipped in its slot', () => {
    const auth = loader.authorizeQueuedAbility({
      classKey: 'warrior', level: 42, abilityKey: 'lacerate',
      equippedByRole: { 'role-3': 'rend-id' },
    });
    expect(auth.entry).toBeNull();
    expect(auth.error).toMatch(/not equipped/);
  });

  it('rejects a non-default technique when the role has no selection', () => {
    const auth = loader.authorizeQueuedAbility({
      classKey: 'warrior', level: 42, abilityKey: 'lacerate', equippedByRole: {},
    });
    expect(auth.entry).toBeNull();
  });

  it('allows the default technique when the role has no selection', () => {
    const auth = loader.authorizeQueuedAbility({
      classKey: 'warrior', level: 42, abilityKey: 'rend', equippedByRole: {},
    });
    expect(auth.error).toBeNull();
  });

  it('reports an unavailable equipped technique distinctly', () => {
    const auth = loader.authorizeQueuedAbility({
      classKey: 'warrior', level: 42, abilityKey: 'rend',
      equippedByRole: { 'role-3': 'retired-ability-id' },
    });
    expect(auth.entry).toBeNull();
    expect(auth.error).toMatch(/unavailable/);
  });
});

describe('Phase 3 — combat-tick uses server values only', () => {
  const src = readFileSync(resolve(process.cwd(), 'supabase/functions/combat-tick/index.ts'), 'utf8');

  it('spends the configured cost, never the queued cp_cost', () => {
    expect(src).toContain('const cpCost = auth.entry.cpCost;');
    expect(src).not.toContain('pa.cp_cost');
  });

  it('dispatches on the registry mechanic, not the queued ability_type', () => {
    expect(src).toContain('const paMech = auth.entry.mechanicKey;');
    // The only remaining use is passing the legacy hint into authorization.
    expect((src.match(/pa\.ability_type/g) ?? []).length).toBe(1);
  });

  it('stamps the authoritative damage type on ability events', () => {
    expect(src).toContain('const paDamageType = auth.entry.damageType;');
    expect(src).toContain('pushAbilityEvent(');
  });

  it('passes the persisted loadout into authorization', () => {
    expect(src).toContain('equippedByRole: loadoutByCharacter[pa.character_id]');
  });
});
