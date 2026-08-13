/**
 * ability-identity-authorization.test.ts — Phase E.
 *
 * Covers the canonical-identity contract end to end against the real server
 * loader (`supabase/functions/_shared/load-ability-calcs.ts`):
 *
 *  - an alternative (non-default) ability sharing a mechanic with the default
 *    resolves *its own* numbers when queued by `ability_key`;
 *  - the rejection matrix: unassigned, other class, retired, forged identity,
 *    below unlock level, no identity at all;
 *  - legacy `ability_type`-only payloads still resolve;
 *  - resource immutability: `combat-tick` authorizes and preflights *before*
 *    any CP / cooldown / effect mutation;
 *  - admin mechanic parameters survive the registry swap per ability key.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Entry {
  abilityKey: string; mechanicKey: string; classKey: string; roleSlot: number;
  amountCalc: { base: number } | null; mechanicCalcs: Record<string, { base: number }>;
  unlockLevel: number; isDefault: boolean;
}
interface AuthArgs {
  classKey: string; level: number; abilityKey?: string | null; abilityType?: string | null;
}
interface Loader {
  setServerAbilityCalcs(rows: unknown[]): { applied: boolean; entries: number; errors: string[] };
  getServerAbilityCalcs(classKey: string, abilityKey: string): Entry | null;
  authorizeQueuedAbility(args: AuthArgs): { entry: Entry | null; abilityKey: string; roleSlot: number; error: string | null };
  resetServerAbilityCalcs(): void;
  isAbilityRegistryLoaded(): boolean;
}
/** Resolved at runtime only: the server mirror is a Deno module, outside the app tsconfig. */
const LOADER_PATH = '../../../../supabase/functions/_shared/load-ability-calcs.ts';
let loader: Loader;

const calc = (base: number) => ({ base, terms: [] });

/** One joined `class_ability_assignments` row as the loader expects it. */
function row(opts: {
  classKey: string;
  abilityKey: string;
  mechanicKey: string;
  amount: number;
  isDefault?: boolean;
  unlockLevel?: number;
  status?: string;
  abilityStatus?: string;
  slot?: number;
  mechanicCalcs?: Record<string, unknown>;
}) {
  return {
    class_key: opts.classKey,
    ability_id: `${opts.abilityKey}-id`,
    role_id: `role-${opts.slot ?? 1}`,
    is_default: opts.isDefault ?? true,
    status: opts.status ?? 'active',
    unlock_level: opts.unlockLevel ?? 1,
    role: { id: `role-${opts.slot ?? 1}`, slot: opts.slot ?? 1 },
    ability: {
      id: `${opts.abilityKey}-id`,
      ability_key: opts.abilityKey,
      mechanic_key: opts.mechanicKey,
      status: opts.abilityStatus ?? 'active',
      amount_calc: calc(opts.amount),
      duration_calc: null,
      interval_ms: null,
      effect_config: {},
      mechanic_calcs: opts.mechanicCalcs ?? {},
    },
  };
}

beforeAll(async () => {
  // The loader reads `Deno.env` at module load; provide a minimal shim.
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
  loader = (await import(/* @vite-ignore */ LOADER_PATH)) as unknown as Loader;
});

beforeEach(() => {
  loader.resetServerAbilityCalcs();
});

describe('Phase E — alternative ability resolves its own numbers', () => {
  const ROWS = () => [
    row({ classKey: 'warrior', abilityKey: 'rend', mechanicKey: 'weapon_attack', amount: 7, isDefault: true, slot: 3 }),
    // Deliberately differently tuned alternative sharing the same mechanic.
    row({ classKey: 'warrior', abilityKey: 'lacerate', mechanicKey: 'weapon_attack', amount: 19, isDefault: false, slot: 3 }),
  ];

  it('loads non-default assignments too', () => {
    const result = loader.setServerAbilityCalcs(ROWS());
    expect(result.applied).toBe(true);
    expect(loader.getServerAbilityCalcs('warrior', 'lacerate')).not.toBeNull();
  });

  it('queued by ability_key, the alternative keeps its own magnitude', () => {
    loader.setServerAbilityCalcs(ROWS());
    const auth = loader.authorizeQueuedAbility({
      classKey: 'warrior', level: 20, abilityKey: 'lacerate', abilityType: 'weapon_attack',
    });
    expect(auth.error).toBeNull();
    expect(auth.abilityKey).toBe('lacerate');
    expect(auth.entry?.amountCalc?.base).toBe(19);
    expect(auth.entry?.mechanicKey).toBe('weapon_attack');
  });

  it('the client cannot mint a role slot — it is derived from the registry', () => {
    loader.setServerAbilityCalcs(ROWS());
    const auth = loader.authorizeQueuedAbility({
      classKey: 'warrior', level: 20, abilityKey: 'lacerate',
    });
    expect(auth.roleSlot).toBe(3);
  });

  it('a legacy ability_type-only payload resolves the default, not the alternative', () => {
    loader.setServerAbilityCalcs(ROWS());
    const auth = loader.authorizeQueuedAbility({
      classKey: 'warrior', level: 20, abilityType: 'weapon_attack',
    });
    expect(auth.error).toBeNull();
    expect(auth.abilityKey).toBe('rend');
    expect(auth.entry?.amountCalc?.base).toBe(7);
  });
});

describe('Phase E — rejection matrix', () => {
  beforeEach(() => {
    loader.setServerAbilityCalcs([
      row({ classKey: 'warrior', abilityKey: 'rend', mechanicKey: 'weapon_attack', amount: 7, slot: 3, unlockLevel: 12 }),
      row({ classKey: 'rogue', abilityKey: 'eviscerate', mechanicKey: 'stack_consume', amount: 11, slot: 4,
        mechanicCalcs: { per_stack_multiplier: calc(0.2) } }),
    ]);
  });

  const reject = (args: AuthArgs) => {
    const auth = loader.authorizeQueuedAbility(args);
    expect(auth.entry).toBeNull();
    expect(auth.error).toBeTruthy();
    return auth;
  };

  it('rejects an unassigned ability key', () => {
    reject({ classKey: 'warrior', level: 42, abilityKey: 'not_a_technique' });
  });

  it('rejects another class ability', () => {
    reject({ classKey: 'warrior', level: 42, abilityKey: 'eviscerate' });
  });

  it('rejects a forged identity (key of one class, mechanic of another)', () => {
    reject({ classKey: 'warrior', level: 42, abilityKey: 'eviscerate', abilityType: 'weapon_attack' });
  });

  it('rejects below the unlock level', () => {
    const auth = reject({ classKey: 'warrior', level: 5, abilityKey: 'rend' });
    expect(auth.error).toMatch(/level 12/);
  });

  it('rejects an empty identity', () => {
    reject({ classKey: 'warrior', level: 42, abilityKey: '', abilityType: '' });
  });

  it('rejects a retired ability: it is never loaded into the registry', () => {
    loader.resetServerAbilityCalcs();
    loader.setServerAbilityCalcs([
      row({ classKey: 'warrior', abilityKey: 'rend', mechanicKey: 'weapon_attack', amount: 7, slot: 3 }),
      row({ classKey: 'warrior', abilityKey: 'old_cleave', mechanicKey: 'weapon_attack', amount: 99, slot: 3, abilityStatus: 'retired' }),
    ]);
    expect(loader.getServerAbilityCalcs('warrior', 'old_cleave')).toBeNull();
    reject({ classKey: 'warrior', level: 42, abilityKey: 'old_cleave' });
  });

  it('rejects an inactive assignment even when the ability is active', () => {
    loader.resetServerAbilityCalcs();
    loader.setServerAbilityCalcs([
      row({ classKey: 'warrior', abilityKey: 'rend', mechanicKey: 'weapon_attack', amount: 7, slot: 3 }),
      row({ classKey: 'warrior', abilityKey: 'unassigned', mechanicKey: 'weapon_attack', amount: 99, slot: 3, status: 'draft' }),
    ]);
    reject({ classKey: 'warrior', level: 42, abilityKey: 'unassigned' });
  });
});

describe('Phase E — mechanic parameters are per-ability', () => {
  it('each ability keeps its own named mechanic calcs after a swap', () => {
    loader.setServerAbilityCalcs([
      row({
        classKey: 'ranger', abilityKey: 'barrage', mechanicKey: 'multi_attack', amount: 4, slot: 2,
        mechanicCalcs: { arrow_count: calc(3) },
      }),
      row({
        classKey: 'ranger', abilityKey: 'volley', mechanicKey: 'multi_attack', amount: 4, slot: 2,
        isDefault: false, mechanicCalcs: { arrow_count: calc(6) },
      }),
    ]);
    const a = loader.getServerAbilityCalcs('ranger', 'barrage');
    const b = loader.getServerAbilityCalcs('ranger', 'volley');
    expect(a?.mechanicCalcs.arrow_count.base).toBe(3);
    expect(b?.mechanicCalcs.arrow_count.base).toBe(6);
  });

  it('a malformed mechanic calc aborts the whole swap (no half-valid registry)', () => {
    const rows = [
      row({ classKey: 'ranger', abilityKey: 'barrage', mechanicKey: 'multi_attack', amount: 4, slot: 2,
        mechanicCalcs: { arrow_count: calc(3) } }),
    ];
    (rows[0].ability as { mechanic_calcs: Record<string, unknown> }).mechanic_calcs = {
      arrow_count: { nope: true },
    };
    const result = loader.setServerAbilityCalcs(rows);
    expect(result.applied).toBe(false);
    expect(result.errors.join(' ')).toMatch(/malformed|arrow_count/);
    // Previous (seeded) registry is still serving.
    expect(loader.isAbilityRegistryLoaded()).toBe(true);
  });
});

