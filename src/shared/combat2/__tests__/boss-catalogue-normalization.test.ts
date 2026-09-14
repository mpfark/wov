import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSS_CAST_PRODUCTION_IMAGES } from '@/test/combat/c3/fixtures/boss-cast-production-images';
import { adaptBossCast, deriveBossAbilityKey, TICK_MS } from '../boss-catalog';

const migration = readFileSync('supabase/migrations/20260914100000_combat2_boss_catalogue_normalization.sql', 'utf8')
  .replaceAll('\r\n', '\n').toLowerCase();

describe('ordinary-world boss catalogue normalization', () => {
  it('accounts for the exact 28-row frozen production inventory', () => {
    expect(BOSS_CAST_PRODUCTION_IMAGES).toHaveLength(28);
    expect(new Set(BOSS_CAST_PRODUCTION_IMAGES.map(row => row.creatureId)).size).toBe(28);
    expect(BOSS_CAST_PRODUCTION_IMAGES.filter(row => row.before.stored_power)).toHaveLength(28);
    expect(BOSS_CAST_PRODUCTION_IMAGES.filter(row => Number(row.before.base_aoe_amount) > 0)).toHaveLength(1);
  });

  it('gives every cast its unique established creature-anchored identity', () => {
    expect(migration.match(/\('[0-9a-f-]{36}','[a-z0-9_]+'\)/g)).toHaveLength(28);
    const keys = BOSS_CAST_PRODUCTION_IMAGES.map(row => {
      const key = deriveBossAbilityKey(String(row.before.label), row.creatureId);
      expect(key).toBe(row.expectedKey);
      expect(migration).toContain(`'${row.creatureId}'`);
      expect(migration).toContain(`'${row.expectedKey}'`);
      return key;
    });
    expect(new Set(keys).size).toBe(28);
  });

  it('adapts every stored-power cast to deterministic resolution-time targeting and tick timing', () => {
    for (const row of BOSS_CAST_PRODUCTION_IMAGES) {
      const out = adaptBossCast(row.creatureId, row.before);
      expect('ability' in out, row.name).toBe(true);
      if (!('ability' in out)) continue;
      expect(out.ability).toMatchObject({
        id: `${row.creatureId}:${row.expectedKey}`,
        ability_key: row.expectedKey,
        creature_id: row.creatureId,
        magnitude: Number(row.before.base_amount ?? row.before.amount),
        damage_type: row.before.damage_type ?? null,
        targeting: Number(row.before.base_aoe_amount) > 0 ? 'tank_plus_others' : 'current_tank_at_resolution',
        windup_ticks: Math.max(1, Math.ceil(Number(row.before.cast_ms) / TICK_MS)),
        cooldown_ticks: Math.max(0, Math.ceil(Number(row.before.cooldown_ms ?? 0) / TICK_MS)),
      });
    }
  });

  it('removes only unsupported accumulation and split targeting fields in SQL', () => {
    expect(migration).toContain("c.boss_cast-'stored_power'-'accumulate'-'amount'");
    expect(migration).toContain("'base_amount',coalesce(c.boss_cast->'base_amount',c.boss_cast->'amount')");
    expect(migration).toContain("'base_aoe_amount',0");
    expect(migration).toContain("'target_mode','tank'");
    expect(migration).not.toMatch(/update public\.(characters|node_encounter|node_fighter|character_inventory|node_reward)/);
  });

  it('represents Drowning Toll as one 24-primary plus 10-secondary hybrid cast', () => {
    const row = BOSS_CAST_PRODUCTION_IMAGES.find(candidate => candidate.expectedKey === 'the_drowning_toll__3d082fe3');
    expect(row).toBeDefined();
    const out = adaptBossCast(row!.creatureId, { ...row!.before, ability_key: row!.expectedKey,
      base_amount: 24, base_aoe_amount: 10, target_mode: 'tank' });
    expect(out).toMatchObject({ ability: { magnitude: 24, secondary_magnitude: 10,
      targeting: 'tank_plus_others' } });
  });
});
