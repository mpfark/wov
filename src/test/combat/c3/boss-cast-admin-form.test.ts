import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bossCastFormFromCreature, buildBossCastSave } from '@/components/admin/boss-cast-form';
import { adaptBossCast, deriveBossAbilityKey, TICK_MS } from '@/shared/combat2/boss-catalog';
import { BOSS_CAST_PRODUCTION_IMAGES } from './fixtures/boss-cast-production-images';

const CID = 'df33b7d1-44db-48a4-a80b-2d86657cc6ce';
const save = (form: ReturnType<typeof bossCastFormFromCreature>, creatureId = CID) =>
  buildBossCastSave(form, { rarity: 'boss', creatureId, level: 35, tickRateMs: TICK_MS });
const normalized = (row: (typeof BOSS_CAST_PRODUCTION_IMAGES)[number]) => {
  const cast = { ...row.before, enabled: true, ability_key: row.expectedKey,
    base_amount: Number(row.before.base_amount ?? row.before.amount), base_aoe_amount: 0, target_mode: 'tank' } as Record<string, unknown>;
  for (const key of ['stored_power', 'accumulate', 'amount', 'lock_ms']) delete cast[key];
  if (row.expectedKey === 'the_drowning_toll__3d082fe3') cast.base_aoe_amount = 10;
  return cast;
};

describe('Creature Manager Combat2 boss-cast form', () => {
  it('loads every installed cast and saves it without authored drift', () => {
    const arena = { enabled: true, ability_key: 'proving_ground_slam', label: 'Proving Ground Slam',
      base_amount: 35, base_aoe_amount: 0, damage_type: 'physical', target_mode: 'tank', cast_ms: 4000,
      cooldown_ms: 4000, chance: 1 };
    const casts = [...BOSS_CAST_PRODUCTION_IMAGES.map(row => ({ id: row.creatureId, cast: normalized(row) })),
      { id: 'ffff5001-0000-4000-8000-000000000001', cast: arena }];
    expect(casts).toHaveLength(29);
    for (const row of casts) {
      const form = bossCastFormFromCreature({ rarity: 'boss', boss_cast: row.cast }, TICK_MS);
      expect(save(form, row.id).payload).toEqual(row.cast);
    }
  });

  it('preserves Ser Caldris exactly', () => {
    const row = BOSS_CAST_PRODUCTION_IMAGES.find(item => item.creatureId === '3fc61566-798a-4a6c-8020-4db41dcb3b0a')!;
    const cast = normalized(row);
    const form = bossCastFormFromCreature({ rarity: 'boss', boss_cast: cast }, TICK_MS);
    expect(form).toMatchObject({ boss_cast_label: 'Riptide Cut', boss_cast_ability_key: 'riptide_cut__3fc61566',
      boss_cast_base_amount: 55, boss_cast_damage_type: 'physical', boss_cast_windup_ticks: 2,
      boss_cast_cooldown_ticks: 12 });
    expect(save(form, row.creatureId).payload).toEqual(cast);
  });

  it('models tank, AoE, and hybrid targeting through the installed stored shape', () => {
    const base = { enabled: true, ability_key: 'tidal_crash__df33b7d1', label: 'Tidal Crash', base_amount: 24,
      base_aoe_amount: 0, damage_type: 'frost', target_mode: 'tank', cast_ms: 4000, cooldown_ms: 24000, chance: 0.25 };
    const tank = bossCastFormFromCreature({ rarity: 'boss', boss_cast: base }, TICK_MS);
    expect(tank.boss_cast_targeting).toBe('current_tank_at_resolution');
    expect(adaptBossCast(CID, save(tank).payload)).toMatchObject({ ability: { targeting: 'current_tank_at_resolution' } });
    const aoe = { ...tank, boss_cast_targeting: 'all_present_at_resolution' as const };
    expect(adaptBossCast(CID, save(aoe).payload)).toMatchObject({ ability: { targeting: 'all_present_at_resolution', magnitude: 24 } });
    const hybrid = { ...tank, boss_cast_targeting: 'tank_plus_others' as const, boss_cast_base_aoe_amount: 10 };
    expect(save(hybrid).payload).toMatchObject({ target_mode: 'tank', base_amount: 24, base_aoe_amount: 10 });
    expect(adaptBossCast(CID, save(hybrid).payload)).toMatchObject({ ability: { targeting: 'tank_plus_others', magnitude: 24,
      secondary_magnitude: 10 } });
  });

  it('converts edited ticks to milliseconds but preserves untouched non-aligned values', () => {
    const cast = { enabled: true, ability_key: 'solar_fracture__df33b7d1', label: 'Solar Fracture', base_amount: 45,
      base_aoe_amount: 0, target_mode: 'tank', cast_ms: 3001, cooldown_ms: 23000, chance: 0.25 };
    const form = bossCastFormFromCreature({ rarity: 'boss', boss_cast: cast }, TICK_MS);
    expect(form).toMatchObject({ boss_cast_windup_ticks: 2, boss_cast_cooldown_ticks: 12 });
    expect(save(form).payload).toMatchObject({ cast_ms: 3001, cooldown_ms: 23000 });
    expect(save({ ...form, boss_cast_windup_ticks: 3, boss_cast_cooldown_ticks: 7 }).payload)
      .toMatchObject({ cast_ms: 6000, cooldown_ms: 14000 });
  });

  it('preserves an existing key across label edits and derives the established key for a new cast', () => {
    const existing = bossCastFormFromCreature({ rarity: 'boss', boss_cast: { enabled: true,
      ability_key: 'old_name__df33b7d1', label: 'Old Name', base_amount: 10, cast_ms: 2000, cooldown_ms: 0,
      chance: 1, target_mode: 'tank' } }, TICK_MS);
    expect(save({ ...existing, boss_cast_label: 'New Name' }).payload?.ability_key).toBe('old_name__df33b7d1');
    const blank = bossCastFormFromCreature({ rarity: 'boss', boss_cast: null }, TICK_MS);
    const created = save({ ...blank, boss_cast_enabled: true, boss_cast_label: 'New Name', boss_cast_base_amount: 10 });
    expect(created.payload?.ability_key).toBe(deriveBossAbilityKey('New Name', CID));
  });

  it('validates tick counts, weight, key, and hybrid secondary damage', () => {
    const blank = bossCastFormFromCreature({ rarity: 'boss', boss_cast: null }, TICK_MS);
    const out = save({ ...blank, boss_cast_enabled: true, boss_cast_ability_key: 'bad key', boss_cast_base_amount: 10,
      boss_cast_windup_ticks: 1.5, boss_cast_cooldown_ticks: -1, boss_cast_selection_weight: -1,
      boss_cast_targeting: 'tank_plus_others', boss_cast_base_aoe_amount: 0 });
    expect(out.problems.join(';')).toContain('stable ability key is invalid');
    expect(out.problems.join(';')).toContain('windup must be a positive integer tick count');
    expect(out.problems.join(';')).toContain('cooldown must be a non-negative integer tick count');
    expect(out.problems.join(';')).toContain('selection weight must be non-negative');
    expect(out.problems.join(';')).toContain('hybrid targeting requires secondary damage');
  });

  it('strips legacy stored-power controls and keeps the editor free of obsolete fields', () => {
    const legacy = { enabled: true, label: 'Legacy', ability_key: 'legacy__df33b7d1', base_amount: 20, amount: 20,
      base_aoe_amount: 0, cast_ms: 4000, cooldown_ms: 8000, chance: 1, target_mode: 'tank', lock_ms: 2000,
      stored_power: { cap: 100 }, accumulate: { enabled: true }, damage_primary: 5, damage_aoe: 5 };
    const payload = save(bossCastFormFromCreature({ rarity: 'boss', boss_cast: legacy }, TICK_MS)).payload!;
    for (const key of ['stored_power', 'accumulate', 'amount', 'lock_ms', 'damage_primary', 'damage_aoe']) expect(payload).not.toHaveProperty(key);
    const component = readFileSync('src/components/admin/CreatureManager.tsx', 'utf8');
    for (const label of ['Stored Power cap', 'Primary share', 'AoE share', 'Lock ticks after resolve', 'Chance (0–1) per tick']) {
      expect(component).not.toContain(label);
    }
    expect(component).toContain("form.boss_cast_targeting === 'tank_plus_others'");
  });
});
