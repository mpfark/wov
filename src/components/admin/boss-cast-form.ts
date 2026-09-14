/** Pure load/save boundary for Creature Manager's installed Combat2 boss-cast document. */
import { adaptBossCast, deriveBossAbilityKey, TICK_MS, type AuthoredBossCast } from '@/shared/combat2/boss-catalog';
import { bossCastIsEnabled, type CreatureRarity } from '@/shared/combat/c3/boss-cast-contract';

export type BossCastTargeting = 'current_tank_at_resolution' | 'all_present_at_resolution'
  | 'tank_plus_others' | 'random_present_at_resolution';

export interface BossCastFormFields {
  boss_cast_enabled: boolean;
  boss_cast_label: string;
  boss_cast_ability_key: string;
  boss_cast_damage_type: string;
  boss_cast_targeting: BossCastTargeting;
  boss_cast_windup_ticks: number;
  boss_cast_cooldown_ticks: number;
  boss_cast_selection_weight: number;
  boss_cast_base_amount: number;
  boss_cast_base_aoe_amount: number;
  /** Original document preserves non-editor prose and exact untouched millisecond values. */
  boss_cast_raw: Record<string, unknown> | null;
}

const rec = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const finite = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const ticks = (milliseconds: unknown, fallback: number, minimum: number): number =>
  Math.max(minimum, Math.ceil(finite(milliseconds, fallback) / TICK_MS));

function targetingFromStored(raw: Record<string, unknown> | null): BossCastTargeting {
  if (finite(raw?.base_aoe_amount, 0) > 0) return 'tank_plus_others';
  if (raw?.target_mode === 'aoe') return 'all_present_at_resolution';
  if (raw?.target_mode === 'random' || raw?.target_mode === 'random_alive') return 'random_present_at_resolution';
  return 'current_tank_at_resolution';
}

export function bossCastFormFromCreature(
  input: { readonly rarity: string | null | undefined; readonly boss_cast: unknown },
  _tickRateMs = TICK_MS,
): BossCastFormFields {
  const raw = rec(input.boss_cast);
  return {
    boss_cast_enabled: bossCastIsEnabled(raw, input.rarity as CreatureRarity | null | undefined),
    boss_cast_label: typeof raw?.label === 'string' ? raw.label : 'Cataclysm',
    boss_cast_ability_key: typeof raw?.ability_key === 'string' ? raw.ability_key : '',
    boss_cast_damage_type: typeof raw?.damage_type === 'string' ? raw.damage_type : '',
    boss_cast_targeting: targetingFromStored(raw),
    boss_cast_windup_ticks: ticks(raw?.cast_ms, TICK_MS * 2, 1),
    boss_cast_cooldown_ticks: ticks(raw?.cooldown_ms, TICK_MS * 10, 0),
    boss_cast_selection_weight: finite(raw?.chance, 0.3),
    boss_cast_base_amount: finite(raw?.base_amount, finite(raw?.amount, 0)),
    boss_cast_base_aoe_amount: finite(raw?.base_aoe_amount, 0),
    boss_cast_raw: raw,
  };
}

export interface BossCastSaveResult {
  readonly payload: Record<string, unknown> | null;
  readonly problems: readonly string[];
  readonly preservedDisabled: boolean;
}

const editedMilliseconds = (raw: Record<string, unknown> | null, key: 'cast_ms' | 'cooldown_ms',
  selectedTicks: number, minimumTicks: number): number => {
  const normalizedTicks = Math.max(minimumTicks, Math.floor(selectedTicks));
  const original = finite(raw?.[key], Number.NaN);
  return Number.isFinite(original) && Math.max(minimumTicks, Math.ceil(original / TICK_MS)) === normalizedTicks
    ? original : normalizedTicks * TICK_MS;
};

export function buildBossCastSave(
  form: BossCastFormFields,
  ctx: { readonly rarity: string; readonly creatureId: string; readonly level: number; readonly tickRateMs: number },
): BossCastSaveResult {
  const raw = form.boss_cast_raw;
  const hasExisting = raw !== null && Object.keys(raw).length > 0;
  const enabled = (ctx.rarity === 'boss' || ctx.rarity === 'rare') && form.boss_cast_enabled;
  if (!enabled && !hasExisting) return { payload: null, problems: [], preservedDisabled: false };

  const label = form.boss_cast_label.trim() || 'Cataclysm';
  const abilityKey = form.boss_cast_ability_key.trim()
    || (typeof raw?.ability_key === 'string' && raw.ability_key.trim())
    || deriveBossAbilityKey(label, ctx.creatureId);
  const targeting = form.boss_cast_targeting;
  const payload: Record<string, unknown> = {
    ...(raw ?? {}), enabled, label, ability_key: abilityKey,
    base_amount: Math.max(0, Math.floor(form.boss_cast_base_amount)),
    base_aoe_amount: targeting === 'tank_plus_others' ? Math.max(0, Math.floor(form.boss_cast_base_aoe_amount)) : 0,
    target_mode: targeting === 'all_present_at_resolution' ? 'aoe'
      : targeting === 'random_present_at_resolution' ? 'random' : 'tank',
    cast_ms: editedMilliseconds(raw, 'cast_ms', form.boss_cast_windup_ticks, 1),
    cooldown_ms: editedMilliseconds(raw, 'cooldown_ms', form.boss_cast_cooldown_ticks, 0),
    chance: Math.max(0, finite(form.boss_cast_selection_weight, 0)),
  };
  if (form.boss_cast_damage_type || (raw && Object.prototype.hasOwnProperty.call(raw, 'damage_type'))) {
    payload.damage_type = form.boss_cast_damage_type || null;
  }
  for (const key of ['stored_power', 'accumulate', 'amount', 'lock_ms', 'damage_primary', 'damage_aoe']) delete payload[key];

  if (!enabled) return { payload, problems: [], preservedDisabled: true };
  const problems: string[] = [];
  if (!form.boss_cast_label.trim()) problems.push('cast label is required');
  const existingKey = typeof raw?.ability_key === 'string' ? raw.ability_key.trim() : '';
  if (abilityKey !== existingKey && !/^[a-z0-9]+(?:_[a-z0-9]+)*__[a-f0-9]{8}$/.test(abilityKey)) {
    problems.push('stable ability key is invalid');
  }
  if (!Number.isInteger(form.boss_cast_windup_ticks) || form.boss_cast_windup_ticks < 1) problems.push('windup must be a positive integer tick count');
  if (!Number.isInteger(form.boss_cast_cooldown_ticks) || form.boss_cast_cooldown_ticks < 0) problems.push('cooldown must be a non-negative integer tick count');
  if (!Number.isFinite(form.boss_cast_selection_weight) || form.boss_cast_selection_weight < 0) problems.push('selection weight must be non-negative');
  if (targeting === 'tank_plus_others' && form.boss_cast_base_aoe_amount <= 0) problems.push('hybrid targeting requires secondary damage');
  const adapted = adaptBossCast(ctx.creatureId, payload as AuthoredBossCast);
  if ('rejection' in adapted) problems.push(`Combat2 rejects this cast: ${adapted.rejection.reason}`);
  return { payload, problems: [...new Set(problems)], preservedDisabled: false };
}
