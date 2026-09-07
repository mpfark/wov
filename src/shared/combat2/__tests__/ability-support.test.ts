import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { combat2AbilitySupport, COMBAT2_UNSUPPORTED_ABILITIES } from '../ability-support';
import { buildAbilityCatalog, type AuthoredAbilityRecord } from '../catalog';

const records = (inventory as { abilities: AuthoredAbilityRecord[] }).abilities;

describe('Combat2 ability semantic release gate', () => {
  it('gives every one of the 36 active authored abilities an explicit support result', () => {
    expect(records).toHaveLength(36);
    for (const record of records) {
      const decision = combat2AbilitySupport(record.abilityKey);
      expect(typeof decision.supported).toBe('boolean');
      if (decision.supported) expect(decision.reason).toBeNull();
      else expect(decision.reason).toContain('not yet available');
    }
    expect(records.filter(record => combat2AbilitySupport(record.abilityKey).supported)).toHaveLength(30);
    expect(Object.keys(COMBAT2_UNSUPPORTED_ABILITIES).sort()).toEqual([
      'consecrate', 'crescendo', 'divine_aegis', 'inspire', 'purifying_light', 'transfer_health',
    ]);
  });

  it('carries the canonical support decision into every catalogue spec', () => {
    const catalog = buildAbilityCatalog(records);
    expect(catalog.rejected).toEqual([]);
    for (const key of Object.keys(COMBAT2_UNSUPPORTED_ABILITIES)) {
      expect(catalog.specs.get(key)?.support).toMatchObject({ supported: false });
    }
  });

  it('keeps the pre-queue SQL guard at exact parity with the canonical registry', () => {
    const sql = readFileSync(
      'supabase/migrations/20260907170000_combat2_stack_ability_support_gate.sql',
      'utf8',
    );
    const guarded = [...sql.matchAll(/'([a-z][a-z0-9_]*)'/g)]
      .map(match => match[1])
      .filter(value => value in COMBAT2_UNSUPPORTED_ABILITIES);
    expect([...new Set(guarded)].sort()).toEqual(Object.keys(COMBAT2_UNSUPPORTED_ABILITIES).sort());
    expect(sql).toContain("'kind', 'ability_unavailable'");
    expect(sql.lastIndexOf('ability_unavailable')).toBeLessThan(
      sql.lastIndexOf('combat_intent_without_ability_support_gate('),
    );
  });

  it('retains the ledger-recorded original gate and advances it only through the forward migration', () => {
    const applied = readFileSync(
      'supabase/migrations/20260907123241_1498e0d0-d1ff-4ad2-b149-7a8390b888bb.sql',
      'utf8',
    );
    for (const key of ['envenom', 'eviscerate', 'ignite', 'conflagrate']) {
      expect(applied).toContain(`'${key}'`);
    }
  });
});
