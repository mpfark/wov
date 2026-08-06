/**
 * ability-seed.ts — Canonical seed data for the configurable class/ability system.
 *
 * This module is the single source of truth used to (a) seed the `class_ability_roles`,
 * `abilities` and `class_ability_assignments` tables and (b) pin the structured
 * `amount_calc` / `duration_calc` records against the legacy hardcoded formulas
 * in the parity harness (`ability-calc-parity.test.ts`).
 *
 * Notes:
 *  - Durations are milliseconds (wall-clock `expires_at` model). No cooldowns.
 *  - Stances have no `duration_calc` (they persist until dropped); a few keep a
 *    legacy timed calc because their non-stance preview path still exists.
 *  - `amount_calc: null` means the magnitude is still mechanic-owned server-side
 *    (weapon-die rolls, stack consumption). Those move in Phase 2.
 */

import type { AbilityCalc } from '../formulas/ability-calc.ts';

export type AbilityActivationMode = 'instant' | 'queued' | 'stance';
export type AbilityKind = 'damage' | 'heal' | 'buff' | 'debuff' | 'utility';
export type AbilityTarget = 'self' | 'ally' | 'enemy' | 'party' | 'node';

export interface AbilityRoleSeed {
  slot: number;
  name: string;
  description: string;
  unlock_level: number;
}

/** Stable named slots, identical across every class. Assignments reference the role id. */
export const ABILITY_ROLE_SEED: AbilityRoleSeed[] = [
  { slot: 0, name: 'Signature', description: 'Class identity attack, available from level 1.', unlock_level: 1 },
  { slot: 1, name: 'Discipline', description: 'Early sustain, stance or utility tool.', unlock_level: 5 },
  { slot: 2, name: 'Doctrine', description: 'Mid-tier stance or control tool.', unlock_level: 10 },
  { slot: 3, name: 'Pressure', description: 'Sustained damage, healing or control over time.', unlock_level: 15 },
  { slot: 4, name: 'Mastery', description: 'Capstone ability unlocked at level 20.', unlock_level: 20 },
];

export interface AbilitySeed {
  ability_key: string;
  label: string;
  description: string;
  tooltip: string;
  /** Legacy ability `type` — the runtime mechanic that consumes this row. */
  mechanic_key: string;
  ability_type: AbilityKind;
  damage_type: string | null;
  target_type: AbilityTarget;
  activation_mode: AbilityActivationMode;
  cp_cost: number;
  /** Stance CP reservation percentage (tier 1 = 0.10, 2 = 0.15, 3 = 0.20). */
  cp_reserve_pct: number | null;
  amount_calc: AbilityCalc | null;
  duration_calc: AbilityCalc | null;
  interval_ms: number | null;
  effect_config: Record<string, unknown>;
  /**
   * Named typed mechanic calculations (`abilities.mechanic_calcs`). Keys must
   * belong to the row's mechanic template (`shared/config/mechanic-templates`);
   * unknown keys are rejected by the DB validation trigger.
   */
  mechanic_calcs?: Record<string, AbilityCalc>;
  combat_text: Record<string, unknown>;
  /**
   * Reusable base ability this class entry resolves through, when it differs
   * from `ability_key` (which is the per-class identity). Consolidation Phase 3.
   */
  base_ability_key?: string;
  /** Class + role slot this ability is assigned to by default. */
  class_key: string;
  slot: number;
}

const stat = (
  s: AbilityCalc['terms'][number]['stat'],
  mult = 1,
  extra: Partial<AbilityCalc['terms'][number]> = {},
): AbilityCalc['terms'][number] => ({ source: 'stat', stat: s, mult, ...extra });

/** Weapon-die term: the equipped main hand, unarmed falling back to 1d4. */
const weaponDie = (): AbilityCalc['terms'][number] =>
  ({ source: 'dice', die: 'weapon_main', fallbackDie: 4, count: 1, label: 'weapon die' });

/** Level term with its own rounding (e.g. floor(level / 3)). */
const lvl = (
  mult: number,
  rounding: AbilityCalc['rounding'] = 'floor',
): AbilityCalc['terms'][number] => ({ source: 'level', mult, rounding });

/**
 * Tier-0 physical identity attack (checkpoint 4, contract v2):
 *   1d{weapon} + statMod + round(3 + soft(statMod,'damage') + floor(level/3))
 * Per-term rounding reproduces the legacy grouping exactly: every other term is
 * an integer, so rounding the soft-scaled stat alone equals rounding the sum.
 */
const physicalT0 = (s: 'str' | 'dex'): AbilityCalc => ({
  version: 2, base: 3,
  terms: [
    weaponDie(),
    // `role: 'primary'` makes the scaling attribute class-overridable through
    // `class_ability_assignments.overrides.scaling.primary_attribute`, so the
    // one consolidated base ability can scale on STR for a Warrior and DEX for
    // a Ranger without duplicating the curve.
    stat(s, 1, { label: 'raw modifier', role: 'primary' }),
    stat(s, 1, { clampAtZero: true, role: 'primary', transform: { kind: 'soft', profile: 'damage' }, rounding: 'round' }),
    lvl(1 / 3),
  ],
  rounding: 'none', floor: 1, cap: null, unit: 'hp',
  note: 'weapon die + stat + (3 + soft stat + level/3)',
});

/**
 * Tier-0 spell identity attack (contract v2):
 *   round(5 + 2 × soft(statMod,'damage') + floor(level/3))
 */
const spellT0 = (s: 'int' | 'wis' | 'cha', finalMult?: number): AbilityCalc => ({
  version: 2, base: 5,
  terms: [
    // `role: 'primary'` keeps the casting attribute class-overridable, so the one
    // consolidated `spell_attack` base scales on INT for a Wizard, WIS for a
    // Healer/Templar and CHA for a Bard without duplicating the curve.
    stat(s, 2, { clampAtZero: true, role: 'primary', transform: { kind: 'soft', profile: 'damage' }, rounding: 'round' }),
    lvl(1 / 3),
  ],
  ...(finalMult !== undefined ? { finalMult } : {}),
  rounding: 'floor', floor: 1, cap: null, unit: 'hp',
  note: finalMult !== undefined
    ? `5 + 2× soft stat + level/3, ×${finalMult} ability rider`
    : '5 + 2× soft stat + level/3',
});

/** Standard weapon-scaled queued attack: magnitude stays server-owned for now. */
/** Consolidated spell strike: one base ability, class-configured casting stat. */
const SPELL_ATTACK_CONFIG = { resolved_by: 'combat-tick' };

const WEAPON_ATTACK_CONFIG = {
  weapon_scaled: true, unarmed_die: '1d4', resolved_by: 'combat-tick',
  /** Class assignments may configure at most one of these (Phase 2 registry). */
  on_hit_allowed: ['bleed', 'poison'],
};

/**
 * Consolidated party regeneration (Phase 5, Group B):
 *   heal/tick = 2 + primaryMod ; duration = 15s + secondaryMod × 1s (cap 30s)
 * One curve, one mechanic. The healing attribute is `role: 'primary'` and the
 * duration attribute `role: 'secondary'`, so Healer (WIS/CON) and Bard
 * (CHA/INT) share the base and differ only through Class Config overrides.
 */
const partyRegenAmount = (s: 'wis' | 'cha'): AbilityCalc => ({
  base: 2, terms: [stat(s, 1, { role: 'primary' })],
  floor: 1, cap: null, unit: 'hp', note: 'heal per tick (primary attribute)',
});

const partyRegenDuration = (s: 'con' | 'int'): AbilityCalc => ({
  base: 15000, terms: [stat(s, 1000, { clampAtZero: true, role: 'secondary' })],
  cap: 30000, unit: 'ms', note: 'duration (secondary attribute)',
});

/** Shared party-regen contract: identity/presentation comes from the class row. */
const PARTY_REGEN_CONFIG = { ticking_party_heal: true, resolved_by: 'client-loop' };

/**
 * Absorb shield (Consolidation Phase 6) — Force Shield and Divine Aegis share
 * one `absorb_buff` base. The pool attribute is `role: 'primary'` and the
 * duration attribute `role: 'secondary'`, so a class assignment can retarget
 * both without touching coefficients. Target scope (self vs ally) is the row's
 * `target_type`; the client targeting UI reads that, not the mechanic key.
 */
const shieldPool = (
  s: 'wis' | 'int' | 'cha' | 'con',
  mult = 1,
  levelMult = 0.5,
  floor: number | null = null,
): AbilityCalc => ({
  base: 0,
  terms: [stat(s, mult, { role: 'primary' }), { source: 'level', mult: levelMult, rounding: 'floor' }],
  floor, cap: null, unit: 'hp', note: 'shield pool (primary attribute)',
});

const shieldDuration = (
  s: 'int' | 'con' | 'wis' | 'cha',
  perPoint: number,
  base: number,
  cap: number,
  clampAtZero = true,
): AbilityCalc => ({
  base, terms: [stat(s, perPoint, { clampAtZero, role: 'secondary' })],
  cap, unit: 'ms', note: 'shield duration (secondary attribute)',
});

/** Shared absorb contract: identity/presentation comes from the class row. */
const ABSORB_CONFIG = { absorb_shield: true, resolved_by: 'client-cast' };

export const ABILITY_SEED: AbilitySeed[] = [
  // ══════════════════ Warrior ══════════════════
  {
    ability_key: 'power_strike', label: 'Power Strike', description: 'A heavy, focused blow. Rolls your equipped weapon damage + STR + ability bonus (unarmed falls back to 1d4).',
    tooltip: 'Heavy blow. Rolls weapon damage + STR + bonus.',
    mechanic_key: 'weapon_attack', ability_type: 'damage', damage_type: 'physical',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 10, cp_reserve_pct: null,
    amount_calc: physicalT0('str'), duration_calc: null, interval_ms: null,
    effect_config: { ...WEAPON_ATTACK_CONFIG, stat: 'str' }, combat_text: { hit_verb: 'delivers a crushing blow to', miss_verb: 'swings at' },
    base_ability_key: 'weapon_attack',
    class_key: 'warrior', slot: 0,
  },
  {
    ability_key: 'second_wind', label: 'Second Wind', description: 'Catch your breath and recover HP based on CON',
    tooltip: 'Recover your HP. Scales with CON.',
    mechanic_key: 'heal', ability_type: 'heal', damage_type: null,
    target_type: 'self', activation_mode: 'instant', cp_cost: 15, cp_reserve_pct: null,
    amount_calc: { base: 0, terms: [stat('con', 3, { role: 'primary' }), { source: 'level', mult: 1 }], floor: 3, cap: null, unit: 'hp', note: 'CON magnitude' },
    duration_calc: null, interval_ms: null, effect_config: {},
    combat_text: {
      self_text: 'You use Second Wind and catch your breath!',
      self_full_text: "You use Second Wind but you're already at full health.",
    },
    base_ability_key: 'heal',
    class_key: 'warrior', slot: 1,
  },
  {
    ability_key: 'battle_cry', label: 'Battle Cry', description: 'Stance. Reduces incoming damage and softens crits — magnitude scales with STR (with a small shield bonus), duration with DEX. Click again to drop.',
    tooltip: 'Reduce incoming damage and soften crits. Magnitude scales with STR, duration with DEX. Stance.',
    mechanic_key: 'mitigation_buff', base_ability_key: 'mitigation_buff', ability_type: 'buff', damage_type: null,
    target_type: 'self', activation_mode: 'stance', cp_cost: 25, cp_reserve_pct: 0.15,
    amount_calc: { base: 0.10, terms: [stat('str', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 0.02, cap: 0.12 } })], floor: null, cap: null, unit: 'percent', note: 'STR magnitude; +0.05 DR with a shield equipped' },
    duration_calc: null, interval_ms: null,
    effect_config: { mitigation_mode: 'percent', shield_dr_bonus: 0.05, applies_crit_reduction: true, resolved_by: 'combat-tick' },
    combat_text: { mitigate_text: "{target}'s war cry softens the blow! [{amount}]" },
    class_key: 'warrior', slot: 2,
  },
  {
    ability_key: 'rend', label: 'Rend', description: 'Slice your target, applying a bleed that ticks every 2s. Per-tick damage scales with your equipped weapon (bigger swords bleed harder) and STR. Duration scales with DEX (precision keeps the wound open).',
    tooltip: 'Bleed your target over time. Per-tick scales with weapon + STR, duration with DEX.',
    mechanic_key: 'dot_debuff', ability_type: 'debuff', damage_type: 'physical',
    target_type: 'enemy', activation_mode: 'instant', cp_cost: 40, cp_reserve_pct: null,
    amount_calc: { base: 2, terms: [stat('str', 1.5, { clampAtZero: true, transform: { kind: 'soft', profile: 'dot' } })], postMult: 0.67, rounding: 'floor', floor: 1, cap: null, unit: 'hp', note: 'STR magnitude, per tick' },
    duration_calc: { base: 20000, terms: [stat('dex', 1000, { clampAtZero: true })], cap: 30000, unit: 'ms', note: 'DEX duration' },
    interval_ms: 2000,
    effect_config: { effect_type: 'bleed', effect_noun: 'bleed', weapon_based: true, magnitude_stat: 'str', duration_stat: 'dex', max_stacks: 5 },
    combat_text: {
      apply_text: 'rends {target} — blood weeps from the gash! [{damage}/tick]',
      miss_text: "Rend glances off {target} — no wound opens.",
    },
    class_key: 'warrior', slot: 3,
  },
  {
    ability_key: 'sunder_armor', label: 'Sunder Armor', description: "A crushing blow that reduces your target's AC by a STR-scaled amount. Duration scales with DEX (precise strike, lasting weakness).",
    tooltip: "Reduce target's AC. Amount scales with STR, duration with DEX.",
    mechanic_key: 'control_debuff', base_ability_key: 'control_debuff', ability_type: 'debuff', damage_type: null,
    target_type: 'enemy', activation_mode: 'instant', cp_cost: 60, cp_reserve_pct: null,
    amount_calc: { base: 2, terms: [stat('str', 1, { clampAtZero: true, transform: { kind: 'soft', profile: 'utility' } })], rounding: 'round', floor: null, cap: null, unit: 'flat', note: 'STR magnitude (AC reduction)' },
    duration_calc: { base: 12000, terms: [stat('dex', 1000, { clampAtZero: true })], cap: 20000, unit: 'ms', note: 'DEX duration' },
    interval_ms: null,
    effect_config: { control_mode: 'ac_reduction', magnitude_stat: 'str', duration_stat: 'dex' },
    combat_text: { activate_text: "{ability}! {target}'s AC reduced by {amount} for {seconds}s." },
    class_key: 'warrior', slot: 4,
  },

  // ══════════════════ Wizard ══════════════════
  {
    ability_key: 'fireball', label: 'Fireball', description: 'Hurl a ball of arcane flame at your target, scaling with INT',
    tooltip: 'Damage one target. Scales with INT.',
    mechanic_key: 'spell_attack', ability_type: 'damage', damage_type: 'fire',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 10, cp_reserve_pct: null,
    amount_calc: spellT0('int'), duration_calc: null, interval_ms: null,
    effect_config: { ...SPELL_ATTACK_CONFIG, stat: 'int' },
    combat_text: { hit_verb: 'hurls a fireball at', miss_verb: 'hurls a fireball past' },
    base_ability_key: 'spell_attack',
    class_key: 'wizard', slot: 0,
  },
  {
    ability_key: 'force_shield', label: 'Force Shield', description: 'Stance. Maintains an arcane absorb shield (WIS-scaled pool, INT-scaled regen) that re-forms out of combat. Click again to drop.',
    tooltip: 'Maintain an arcane absorb shield. Pool scales with WIS, regen with INT. Stance.',
    mechanic_key: 'absorb_buff', ability_type: 'buff', damage_type: null,
    target_type: 'self', activation_mode: 'stance', cp_cost: 15, cp_reserve_pct: 0.10,
    amount_calc: shieldPool('wis', 1, 0.5, 1),
    duration_calc: shieldDuration('int', 1000, 8000, 15000, false),
    interval_ms: null,
    effect_config: { ...ABSORB_CONFIG, regen_stat: 'int', reforms_out_of_combat: true, stat: 'wis', duration_stat: 'int' },
    combat_text: {
      self_text: 'Force Shield! An arcane ward wraps you for {seconds}s.',
      ally_text: 'Force Shield! You ward {target} for {seconds}s.',
    },
    base_ability_key: 'absorb_buff',
    class_key: 'wizard', slot: 1,
  },
  {
    ability_key: 'arcane_surge', label: 'Arcane Surge', description: 'Stance. All your damage is increased — bonus magnitude scales with INT. Click again to drop.',
    tooltip: 'Increase all your damage. Bonus scales with INT. Stance.',
    mechanic_key: 'offense_buff', base_ability_key: 'offense_buff', ability_type: 'buff', damage_type: null,
    target_type: 'self', activation_mode: 'stance', cp_cost: 25, cp_reserve_pct: 0.15,
    amount_calc: { base: 1.10, terms: [stat('int', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 0.02, cap: 0.12 } })], floor: null, cap: null, unit: 'multiplier', note: 'INT magnitude' },
    duration_calc: null, interval_ms: null,
    effect_config: { offense_mode: 'damage_mult' },
    combat_text: { activate_text: 'Arcane Surge! Your damage is amplified (x{mult}).' },
    class_key: 'wizard', slot: 2,
  },
  {
    ability_key: 'ignite', label: 'Orbs of Fire', description: 'Stance. While in combat, an orb of fire pulses each heartbeat at your target — proc chance and spark damage scale with INT, and each spark applies the Ignite burn (stacks/duration scale with WIS). Mutually exclusive with Envenom. Click again to drop.',
    tooltip: 'Orbs strike your target and apply Ignite burn. Proc/spark scale with INT, burn with WIS. Stance.',
    mechanic_key: 'stack_apply', base_ability_key: 'stack_apply', ability_type: 'buff', damage_type: 'fire',
    target_type: 'self', activation_mode: 'stance', cp_cost: 50, cp_reserve_pct: 0.20,
    amount_calc: { base: 0.25, terms: [stat('int', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 0.04, cap: 0.25 } })], floor: null, cap: null, unit: 'percent', note: 'INT orb proc chance per heartbeat' },
    duration_calc: null, interval_ms: null,
    effect_config: {
      mutually_exclusive_with: ['envenom'], consumes_all_cp: true,
      trigger: 'pulse', effect_type: 'ignite', stack_noun: 'burn',
      pulse_damage_base: 2, pulse_damage_stat: 'int', engages_target: true,
      dot_stat: 'wis', dot_stat_mult: 0.7, dot_global_mult: 0.67,
      dot_duration_ms: 30000, dot_duration_stat: 'wis',
      dot_duration_per_point_ms: 1000, dot_duration_cap_ms: 45000,
      resolved_by: 'combat-tick',
    },
    mechanic_calcs: {
      max_stacks: { base: 5, terms: [], unit: 'count', note: 'Burn stack ceiling' },
    },
    combat_text: {
      activate_text: 'Ignite! A shield of fireballs orbits you — each heartbeat in combat, an orb may strike your target. Lasts 5 minutes.',
      pulse_text: 'A flaming orb leaps from {attacker} and sears {target} (burn x{stacks})! [{damage}]',
      stack_text: "{attacker}'s orb of fire seared {target} with Ignite.",
    },
    class_key: 'wizard', slot: 3,

  },
  {
    ability_key: 'conflagrate', label: 'Conflagrate', description: 'Consume all burn stacks on your target for bonus damage per stack. Per-stack bonus scales with INT; stack count scales with WIS via Orbs of Fire.',
    tooltip: 'Consume burn stacks for bonus damage. Per-stack scales with INT.',
    mechanic_key: 'stack_consume', base_ability_key: 'stack_consume', ability_type: 'damage', damage_type: 'fire',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 60, cp_reserve_pct: null,
    amount_calc: {
      version: 2, base: 4,
      terms: [
        stat('int', 2, { clampAtZero: true, transform: { kind: 'soft', profile: 'burst' }, rounding: 'round' }),
        lvl(1 / 3),
      ],
      rounding: 'none', floor: 1, cap: null, unit: 'hp', note: 'INT base damage before the burn-stack multiplier',
    },
    duration_calc: null, interval_ms: null,
    effect_config: { consumes: 'burn_stacks', stack_type: 'ignite', stack_noun: 'burn', weapon_based: false, stat: 'int', resolved_by: 'combat-tick' },
    mechanic_calcs: {
      per_stack_multiplier: { base: 0.30, terms: [stat('int', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 0.05, cap: 0.40 } })], floor: null, cap: null, unit: 'percent', note: 'INT bonus damage per consumed burn stack' },
    },
    combat_text: {
      hit_text: 'detonates {stacks} burn stack{plural} on {target}! [{damage}]',
      hit_no_stacks_text: 'blasts {target} (no burn stacks). [{damage}]',
      miss_text: 'Conflagrate gutters out against {target}{stacknote}!',
    },
    class_key: 'wizard', slot: 4,
  },

  // ══════════════════ Ranger ══════════════════
  {
    ability_key: 'aimed_shot', label: 'Aimed Shot', description: 'A careful shot. Rolls your equipped weapon damage + DEX + ability bonus (unarmed falls back to 1d4).',
    tooltip: 'Careful shot. Rolls weapon damage + DEX + bonus.',
    mechanic_key: 'weapon_attack', ability_type: 'damage', damage_type: 'physical',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 10, cp_reserve_pct: null,
    amount_calc: physicalT0('dex'), duration_calc: null, interval_ms: null,
    effect_config: { ...WEAPON_ATTACK_CONFIG, stat: 'dex' }, combat_text: { hit_verb: 'looses an aimed shot at', miss_verb: 'looses an arrow at' },
    base_ability_key: 'weapon_attack',
    class_key: 'ranger', slot: 0,
  },
  {
    ability_key: 'eagle_eye', label: 'Eagle Eye', description: 'Stance. Widens your critical hit range based on a blend of DEX (precision) and WIS (attunement) while active. Click again to drop.',
    tooltip: 'Widen your crit range. Scales with DEX and WIS. Stance.',
    mechanic_key: 'offense_buff', base_ability_key: 'offense_buff', ability_type: 'buff', damage_type: null,
    target_type: 'self', activation_mode: 'stance', cp_cost: 15, cp_reserve_pct: 0.10,
    amount_calc: { base: 0, terms: [stat('dex', 0.5, { clampAtZero: true }), stat('wis', 0.5, { clampAtZero: true })], rounding: 'floor', floor: 1, cap: 5, unit: 'flat', note: 'DEX+WIS blend — crit range widening' },
    duration_calc: { base: 30000, terms: [], cap: null, unit: 'ms', note: 'legacy timed preview path (stance has no duration)' },
    interval_ms: null,
    effect_config: { offense_mode: 'crit_edge' },
    combat_text: { activate_text: 'Eagle Eye! Your crit range is now {crit_low}-20 for {seconds}s.' },
    class_key: 'ranger', slot: 1,
  },
  {
    ability_key: 'barrage', label: 'Barrage', description: 'Fire a volley of arrows. Each arrow rolls your equipped weapon damage (unarmed: 1d4) + half DEX. Arrow count scales with WIS: 2 base, +1 with DEX≥3, +1 more with WIS≥4 (max 4).',
    tooltip: 'Volley of arrows. Each rolls weapon damage + half DEX; count scales with WIS.',
    mechanic_key: 'multi_attack', ability_type: 'damage', damage_type: 'physical',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 25, cp_reserve_pct: null,
    amount_calc: {
      version: 2, base: 0,
      terms: [weaponDie(), stat('dex', 0.5, { clampAtZero: true, rounding: 'floor' })],
      rounding: 'none', floor: 1, cap: null, unit: 'hp', note: 'per-arrow damage: weapon die + half DEX',
    },
    duration_calc: null, interval_ms: null,
    effect_config: { ...WEAPON_ATTACK_CONFIG, attack_stat: 'dex' },
    mechanic_calcs: {
      arrow_count: { base: 2, terms: [{ source: 'stat_threshold', stat: 'dex', steps: [{ at: 3, add: 1 }] }, { source: 'stat_threshold', stat: 'wis', steps: [{ at: 4, add: 1 }] }], cap: 4, unit: 'count', note: 'DEX/WIS arrow ladder' },
    },
    combat_text: {
      cast_text: '{caster} unleashes Barrage of {count} arrows!',
      hit_text: 'Arrow {index}/{count} strikes {target}! [{damage}]',
      miss_text: 'Arrow {index}/{count} misses {target}.',
    },
    class_key: 'ranger', slot: 2,
  },
  {
    ability_key: 'natures_snare', label: "Nature's Snare", description: "Entangle your target. Damage-reduction magnitude scales with DEX (precise binding), duration scales with WIS.",
    tooltip: "Reduce target's damage. Reduction scales with DEX, duration with WIS.",
    mechanic_key: 'control_debuff', base_ability_key: 'control_debuff', ability_type: 'debuff', damage_type: 'nature',
    target_type: 'enemy', activation_mode: 'instant', cp_cost: 40, cp_reserve_pct: null,
    amount_calc: { base: 0.25, terms: [stat('wis', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 0.02, cap: 0.15 } })], floor: null, cap: null, unit: 'percent', note: 'WIS-scaled damage reduction (live formula uses the scaling stat)' },
    duration_calc: { base: 8000, terms: [stat('wis', 1000, { clampAtZero: true })], cap: 15000, unit: 'ms', note: 'WIS duration' },
    interval_ms: null,
    effect_config: { control_mode: 'damage_reduction', magnitude_stat: 'wis', duration_stat: 'wis' },
    combat_text: { activate_text: "{ability}! {target}'s damage reduced by {pct}% for {seconds}s." },
    class_key: 'ranger', slot: 3,
  },
  {
    ability_key: 'disengage', label: 'Disengage', description: 'Leap backward — dodge all attacks briefly. Dodge duration scales with DEX, next-strike bonus damage scales with WIS (calm aim).',
    tooltip: 'Dodge briefly; next strike deals bonus damage. Bonus scales with WIS, duration with DEX.',
    mechanic_key: 'evasion_buff', base_ability_key: 'evasion_buff', ability_type: 'buff', damage_type: null,
    target_type: 'self', activation_mode: 'instant', cp_cost: 60, cp_reserve_pct: null,
    amount_calc: { base: 1.30, terms: [stat('wis', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 0.05, cap: 0.40 } })], floor: null, cap: null, unit: 'multiplier', note: 'WIS next-hit damage multiplier' },
    duration_calc: { base: 5000, terms: [stat('dex', 500)], cap: 8000, unit: 'ms', note: 'DEX dodge duration' },
    interval_ms: null,
    effect_config: { next_hit_window_ms: 15000, dodge_chance: 1.0, evasion_source: 'disengage' },
    combat_text: {
      activate_text: 'Disengage! You leap back — dodging all attacks for {seconds}s. Your next strike deals +{bonus_pct}% bonus damage!',
    },
    class_key: 'ranger', slot: 4,
  },

  // ══════════════════ Assassin ══════════════════
  {
    ability_key: 'backstab', label: 'Backstab', description: 'Strike at a vital point. Rolls your equipped weapon damage + DEX + ability bonus (unarmed falls back to 1d4).',
    tooltip: 'Vital strike. Rolls weapon damage + DEX + bonus.',
    mechanic_key: 'weapon_attack', ability_type: 'damage', damage_type: 'physical',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 10, cp_reserve_pct: null,
    amount_calc: physicalT0('dex'), duration_calc: null, interval_ms: null,
    effect_config: { ...WEAPON_ATTACK_CONFIG, stat: 'dex' }, combat_text: { hit_verb: 'backstabs', miss_verb: 'lunges at' },
    base_ability_key: 'weapon_attack',
    class_key: 'assassin', slot: 0,
  },
  {
    ability_key: 'shadowstep', label: 'Shadowstep', description: 'Vanish into shadow — duration scales with DEX, and your next strike from stealth deals an ambush multiplier scaling with CHA (cap ×2.5).',
    tooltip: 'Vanish into stealth; next strike is an ambush. Duration scales with DEX, ambush with CHA.',
    mechanic_key: 'stealth_buff', ability_type: 'buff', damage_type: null,
    target_type: 'self', activation_mode: 'instant', cp_cost: 15, cp_reserve_pct: null,
    amount_calc: { base: 2, terms: [stat('cha', 0.05, { clampAtZero: true })], floor: null, cap: 2.5, unit: 'multiplier', note: 'CHA ambush multiplier' },
    duration_calc: { base: 15000, terms: [stat('dex', 1000)], cap: 25000, unit: 'ms', note: 'DEX duration' },
    interval_ms: null, effect_config: {}, combat_text: { activate_text: '{ability}! You vanish into the shadows for {seconds}s (ambush x{mult}).' },
    class_key: 'assassin', slot: 1,
  },
  {
    ability_key: 'envenom', label: 'Envenom', description: 'Stance. Each hit may apply a stackable poison DoT — proc chance scales with DEX, max stack ceiling scales with CHA. Mutually exclusive with Orbs of Fire. Click again to drop.',
    tooltip: 'Hits may apply stacking poison. Proc scales with DEX, max stacks with CHA. Stance.',
    mechanic_key: 'stack_apply', base_ability_key: 'stack_apply', ability_type: 'buff', damage_type: 'poison',
    target_type: 'self', activation_mode: 'stance', cp_cost: 50, cp_reserve_pct: 0.20,
    amount_calc: { base: 0.25, terms: [stat('dex', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 0.04, cap: 0.20 } })], floor: null, cap: null, unit: 'percent', note: 'DEX hit-proc chance' },
    duration_calc: null, interval_ms: null,
    effect_config: {
      mutually_exclusive_with: ['ignite'], consumes_all_cp: true,
      trigger: 'on_hit', effect_type: 'poison', stack_noun: 'poison',
      dot_stat: 'dex', dot_stat_mult: 1.2, dot_global_mult: 0.67,
      dot_duration_ms: 25000,
      resolved_by: 'combat-tick',
    },
    mechanic_calcs: {
      max_stacks: { base: 3, terms: [{ source: 'stat', stat: 'cha', clampAtZero: true, transform: { kind: 'diminishing', cap: 4 } }], unit: 'count', note: 'CHA stack ceiling' },
    },
    combat_text: {
      activate_text: 'Envenom! Your weapons drip with poison for 5 minutes.',
      proc_text: "{attacker}'s attack poisons {target}!",
    },

    class_key: 'assassin', slot: 2,
  },
  {
    ability_key: 'eviscerate', label: 'Eviscerate', description: 'A vicious finisher. Rolls your equipped weapon damage + DEX + ability bonus, then multiplied by consumed poison stacks (per-stack bonus scales with CHA showmanship). Unarmed falls back to 1d4.',
    tooltip: 'Rolls weapon damage + DEX + bonus, multiplied by poison stacks (CHA).',
    mechanic_key: 'stack_consume', base_ability_key: 'stack_consume', ability_type: 'damage', damage_type: 'physical',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 40, cp_reserve_pct: null,
    amount_calc: {
      version: 2, base: 2,
      terms: [
        weaponDie(),
        stat('dex', 1, { label: 'raw modifier' }),
        stat('dex', 1, { clampAtZero: true, transform: { kind: 'soft', profile: 'damage' } }),
        lvl(1 / 3),
      ],
      rounding: 'none', floor: null, cap: null, unit: 'hp',
      note: 'base damage before the poison-stack multiplier',
    },
    duration_calc: null, interval_ms: null,
    effect_config: { ...WEAPON_ATTACK_CONFIG, stat: 'dex', consumes: 'poison_stacks', stack_type: 'poison', stack_noun: 'poison', weapon_based: true, per_stack_stat: 'cha' },
    mechanic_calcs: {
      per_stack_multiplier: {
        version: 2, base: 0.50,
        terms: [stat('cha', 0.02, { clampAtZero: true, transform: { kind: 'soft', profile: 'stacking' } })],
        floor: null, cap: null, unit: 'multiplier', note: 'CHA bonus per consumed poison stack',
      },
    },
    combat_text: {
      hit_text: 'eviscerates {target}, detonating {stacks} poison stack{plural}! [{damage}]',
      hit_no_stacks_text: 'eviscerates {target} (no poison stacks). [{damage}]',
      miss_text: 'Eviscerate misses {target}{stacknote}!',
    },
    class_key: 'assassin', slot: 3,
  },
  {
    ability_key: 'cloak_of_shadows', label: 'Cloak of Shadows', description: 'Wrap yourself in shadow. Dodge chance scales with CHA (theatrical misdirection), duration scales with DEX.',
    tooltip: 'Chance to dodge attacks. Dodge scales with CHA, duration with DEX.',
    mechanic_key: 'evasion_buff', base_ability_key: 'evasion_buff', ability_type: 'buff', damage_type: null,
    target_type: 'self', activation_mode: 'instant', cp_cost: 60, cp_reserve_pct: null,
    amount_calc: { base: 0.40, terms: [stat('cha', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 0.03, cap: 0.20 } })], floor: null, cap: null, unit: 'percent', note: 'CHA dodge chance' },
    duration_calc: { base: 10000, terms: [stat('dex', 500)], cap: 15000, unit: 'ms', note: 'DEX duration' },
    interval_ms: null,
    effect_config: { evasion_source: 'cloak' },
    combat_text: {
      activate_text: 'Cloak of Shadows! {dodge_pct}% dodge chance for {seconds}s.',
    },
    class_key: 'assassin', slot: 4,
  },

  // ══════════════════ Healer ══════════════════
  {
    ability_key: 'smite', label: 'Smite', description: 'Channel a burst of divine light at your target, scaling with WIS',
    tooltip: 'Damage one target. Scales with WIS.',
    mechanic_key: 'spell_attack', ability_type: 'damage', damage_type: 'holy',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 10, cp_reserve_pct: null,
    amount_calc: spellT0('wis'), duration_calc: null, interval_ms: null,
    effect_config: { ...SPELL_ATTACK_CONFIG, stat: 'wis' },
    combat_text: { hit_verb: 'smites', miss_verb: 'calls down light upon' },
    base_ability_key: 'spell_attack',
    class_key: 'healer', slot: 0,
  },
  {
    ability_key: 'heal', label: 'Heal', description: 'Restore HP based on your Wisdom',
    tooltip: 'Restore your HP. Scales with WIS.',
    mechanic_key: 'heal', ability_type: 'heal', damage_type: null,
    target_type: 'self', activation_mode: 'instant', cp_cost: 15, cp_reserve_pct: null,
    amount_calc: { base: 0, terms: [stat('wis', 3, { role: 'primary' }), { source: 'level', mult: 1 }], floor: 3, cap: null, unit: 'hp', note: 'WIS magnitude' },
    duration_calc: null, interval_ms: null, effect_config: {},
    combat_text: {
      self_text: 'You cast Heal and mend your wounds!',
      self_full_text: "You cast Heal but you're already at full health.",
    },
    class_key: 'healer', slot: 1,
  },
  {
    ability_key: 'transfer_health', label: 'Transfer Health', description: 'Sacrifice your own HP (amount = WIS) to heal a targeted ally. CON sets your safety floor — hardy healers can give more without dropping themselves low.',
    tooltip: 'Sacrifice HP to heal an ally. Scales with WIS; CON sets your safety floor.',
    mechanic_key: 'hp_transfer', ability_type: 'heal', damage_type: null,
    target_type: 'ally', activation_mode: 'instant', cp_cost: 25, cp_reserve_pct: null,
    amount_calc: { base: 0, terms: [stat('wis', 2), { source: 'level', mult: 0.5, rounding: 'floor' }], floor: 3, cap: null, unit: 'hp', note: 'WIS magnitude' },
    duration_calc: null, interval_ms: null,
    effect_config: {},
    mechanic_calcs: {
      reserve_hp: { base: 0, terms: [{ source: 'stat', stat: 'con' }], floor: 1, unit: 'hp', note: 'CON safety floor' },
    },
    combat_text: { transfer_text: '{caster} sacrifices life to heal {target}!' },
    class_key: 'healer', slot: 2,
  },
  {
    ability_key: 'purifying_light', label: 'Purifying Light', description: 'A wave of divine radiance that heals all nearby allies over time. Heal/tick scales with WIS; duration scales with CON (stamina sustains the radiance).',
    tooltip: 'Heal nearby allies over time. Heal scales with WIS, duration with CON.',
    mechanic_key: 'party_regen', ability_type: 'heal', damage_type: null,
    target_type: 'party', activation_mode: 'instant', cp_cost: 40, cp_reserve_pct: null,
    amount_calc: partyRegenAmount('wis'), duration_calc: partyRegenDuration('con'),
    interval_ms: 3000,
    effect_config: { ...PARTY_REGEN_CONFIG, source: 'healer', stat: 'wis', duration_stat: 'con' },
    combat_text: {
      cast_text: 'Purifying Light! Divine radiance heals {who} every 3s for {seconds}s.',
      tick_text: 'Purifying Light heals {who} for {amount} HP!',
    },
    base_ability_key: 'party_regen',
    class_key: 'healer', slot: 3,
  },
  {
    ability_key: 'divine_aegis', label: 'Divine Aegis', description: 'Create an absorb shield on a targeted ally (or self). Pool scales with WIS; duration (up to 60s) scales with CON.',
    tooltip: 'Shield an ally with an absorb pool. Pool scales with WIS, duration with CON.',
    mechanic_key: 'absorb_buff', ability_type: 'buff', damage_type: null,
    target_type: 'ally', activation_mode: 'instant', cp_cost: 60, cp_reserve_pct: null,
    amount_calc: shieldPool('wis', 2, 0.7),
    duration_calc: shieldDuration('con', 2000, 30000, 60000),
    interval_ms: null,
    effect_config: { ...ABSORB_CONFIG, stat: 'wis', duration_stat: 'con' },
    combat_text: {
      self_text: 'Divine Aegis! An absorb shield wraps you for up to {seconds}s.',
      ally_text: 'Divine Aegis! You shield {target} for up to {seconds}s.',
    },
    base_ability_key: 'absorb_buff',
    class_key: 'healer', slot: 4,
  },

  // ══════════════════ Bard ══════════════════
  {
    ability_key: 'cutting_words', label: 'Cutting Words', description: 'Unleash a barbed insult that wounds your target, scaling with CHA',
    tooltip: 'Damage one target. Scales with CHA.',
    mechanic_key: 'spell_attack', ability_type: 'damage', damage_type: 'psychic',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 10, cp_reserve_pct: null,
    amount_calc: spellT0('cha'), duration_calc: null, interval_ms: null,
    effect_config: { ...SPELL_ATTACK_CONFIG, stat: 'cha' },
    combat_text: { hit_verb: 'mocks', miss_verb: 'jeers at' },
    base_ability_key: 'spell_attack',
    class_key: 'bard', slot: 0,
  },
  {
    ability_key: 'inspire', label: 'Inspire', description: 'A song that grants you and your party flat HP & CP regen, scaling with your Charisma. Duration scales with Intelligence (60–180s). Recasting refreshes the duration and keeps the stronger regen values.',
    tooltip: 'Grant party HP & CP regen. Regen scales with CHA, duration with INT.',
    mechanic_key: 'regen_buff', ability_type: 'buff', damage_type: null,
    target_type: 'party', activation_mode: 'instant', cp_cost: 15, cp_reserve_pct: null,
    amount_calc: { base: 2, terms: [stat('cha', 1, { clampAtZero: true })], floor: 2, cap: null, unit: 'hp', note: 'CHA HP regen per tick' },
    duration_calc: { base: 60000, terms: [stat('int', 8000, { clampAtZero: true })], floor: 60000, cap: 180000, unit: 'ms', note: 'INT duration' },
    interval_ms: null,
    effect_config: { refresh_policy: 'best_of' },
    mechanic_calcs: {
      cp_per_tick: { base: 1, terms: [{ source: 'stat', stat: 'cha', mult: 0.5, clampAtZero: true, rounding: 'ceil' }], floor: 1, unit: 'flat', note: 'CHA CP regen per tick' },
    },
    combat_text: { activate_text: '{caster} plays an inspiring song for {seconds}s!', renew_text: '{caster} renews the inspiring song! ({seconds}s remaining)' },
    class_key: 'bard', slot: 1,
  },
  {
    ability_key: 'dissonance', label: 'Dissonance', description: "A discordant note that reduces your target's damage. Reduction magnitude scales with CHA (cutting cadence), duration scales with INT.",
    tooltip: "Reduce target's damage. Reduction scales with CHA, duration with INT.",
    mechanic_key: 'control_debuff', base_ability_key: 'control_debuff', ability_type: 'debuff', damage_type: 'psychic',
    target_type: 'enemy', activation_mode: 'instant', cp_cost: 25, cp_reserve_pct: null,
    amount_calc: { base: 0.25, terms: [stat('int', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 0.02, cap: 0.15 } })], floor: null, cap: null, unit: 'percent', note: 'scaling stat = INT for bards' },
    duration_calc: { base: 8000, terms: [stat('int', 1000, { clampAtZero: true })], cap: 15000, unit: 'ms', note: 'INT duration' },
    interval_ms: null,
    effect_config: { control_mode: 'damage_reduction', magnitude_stat: 'int', duration_stat: 'int' },
    combat_text: { activate_text: "{ability}! {target}'s damage reduced by {pct}% for {seconds}s." },
    class_key: 'bard', slot: 2,
  },
  {
    ability_key: 'crescendo', label: 'Crescendo', description: 'A rising melody that heals all nearby allies over time. Heal/tick scales with CHA; duration scales with INT.',
    tooltip: 'Heal nearby allies over time. Heal scales with CHA, duration with INT.',
    mechanic_key: 'party_regen', ability_type: 'heal', damage_type: null,
    target_type: 'party', activation_mode: 'instant', cp_cost: 40, cp_reserve_pct: null,
    amount_calc: partyRegenAmount('cha'), duration_calc: partyRegenDuration('int'),
    interval_ms: 3000,
    effect_config: { ...PARTY_REGEN_CONFIG, source: 'bard', stat: 'cha', duration_stat: 'int' },
    combat_text: {
      cast_text: 'Crescendo! A rising melody heals {who} every 3s for {seconds}s.',
      tick_text: 'Crescendo heals {who} for {amount} HP!',
    },
    base_ability_key: 'party_regen',
    class_key: 'bard', slot: 3,
  },
  {
    ability_key: 'grand_finale', label: 'Grand Finale', description: 'Unleash a devastating crescendo of sound (CHA-scaled damage). INT sharpens the killing note — each point of INT widens the crit-edge.',
    tooltip: 'Burst damage on one target. Damage scales with CHA, crit-edge with INT.',
    mechanic_key: 'burst_damage', ability_type: 'damage', damage_type: 'psychic',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 60, cp_reserve_pct: null,
    amount_calc: {
      version: 2, base: 0,
      terms: [
        stat('cha', 4, { clampAtZero: true, transform: { kind: 'soft', profile: 'burst' }, rounding: 'round' }),
        lvl(1.5),
      ],
      rounding: 'none', floor: 8, cap: null, unit: 'hp',
      note: 'CHA burst base (the CHA-sided bonus die stays mechanic-owned)',
    },
    duration_calc: null, interval_ms: null,
    effect_config: { stat: 'cha', crit_edge_stat: 'int', crit_threshold_floor: 17, resolved_by: 'combat-tick' },
    mechanic_calcs: {
      crit_edge: {
        version: 2, base: 0,
        terms: [stat('int', 0.5, { clampAtZero: true, rounding: 'floor' })],
        floor: null, cap: null, unit: 'flat', note: 'INT crit-threshold widening',
      },
    },
    combat_text: {
      hit_text: '{ability}!{crit} {caster} unleashes a devastating blast of sound at {target}! [{damage}]',
      miss_text: "{caster}'s {ability} falls flat — {target} is untouched!",
    },
    class_key: 'bard', slot: 4,
  },

  // ══════════════════ Templar ══════════════════
  {
    ability_key: 'judgment', label: 'Judgment', description: 'Pass divine judgment, dealing holy damage scaling with WIS',
    tooltip: 'Holy damage to one target. Scales with WIS.',
    mechanic_key: 'spell_attack', ability_type: 'damage', damage_type: 'holy',
    target_type: 'enemy', activation_mode: 'queued', cp_cost: 10, cp_reserve_pct: null,
    amount_calc: spellT0('wis', 0.8), duration_calc: null, interval_ms: null,
    effect_config: { ...SPELL_ATTACK_CONFIG, stat: 'wis' },
    combat_text: { hit_verb: 'passes divine judgment upon', miss_verb: 'pronounces sentence on' },
    base_ability_key: 'spell_attack',
    class_key: 'templar', slot: 0,
  },
  {
    ability_key: 'holy_shield', label: 'Holy Shield', description: 'Stance. Attackers who strike you take holy damage in return — WIS scaling reduced 20%, with a CON kicker (CON adds to retaliation damage). Once per attacker per tick. Click again to drop.',
    tooltip: 'Attackers take holy damage in return. WIS scaling reduced 20%, CON adds a kicker. Stance.',
    mechanic_key: 'reactive_holy', ability_type: 'buff', damage_type: 'holy',
    target_type: 'self', activation_mode: 'stance', cp_cost: 15, cp_reserve_pct: 0.10,
    amount_calc: null, duration_calc: { base: 30000, terms: [], cap: null, unit: 'ms', note: 'legacy timed preview path (stance has no duration)' },
    interval_ms: null,
    effect_config: { magnitude_stat: 'wis', kicker_stat: 'con', once_per_attacker_per_tick: true, resolved_by: 'combat-tick' },
    mechanic_calcs: {
      retaliation_damage: {
        version: 2, base: 2,
        terms: [
          stat('wis', 0.8, { clampAtZero: true, transform: { kind: 'soft', profile: 'damage' }, rounding: 'floor' }),
          stat('con', 1, { clampAtZero: true, transform: { kind: 'soft', profile: 'damage' } }),
          lvl(0.25),
        ],
        rounding: 'round', floor: 1, cap: null, unit: 'hp',
        note: 'WIS core (-20%) + CON kicker + level/4',
      },
    },
    combat_text: { retaliate_text: "{caster}'s Holy Shield burns {target}! [{damage}]" },
    class_key: 'templar', slot: 1,
  },
  {
    ability_key: 'shield_wall', label: 'Shield Wall', description: 'Stance. Dual-primary: WIS adds bonus block chance (+25.5% floor, up to +46.75% at high WIS), CON adds bonus block amount (+~4 floor, up to +~9 at high CON). Final block chance capped at 95%. Requires a shield equipped to benefit. Click again to drop.',
    tooltip: 'Boost block chance and amount. Chance scales with WIS, amount with CON. Stance.',
    mechanic_key: 'block_buff', ability_type: 'buff', damage_type: null,
    target_type: 'self', activation_mode: 'stance', cp_cost: 25, cp_reserve_pct: 0.15,
    amount_calc: null, duration_calc: null, interval_ms: null,
    effect_config: { chance_stat: 'wis', amount_stat: 'con', block_chance_cap: 0.95, requires_shield: true, resolved_by: 'combat-tick' },
    mechanic_calcs: {
      block_chance: {
        version: 2, base: 0.255,
        terms: [stat('wis', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 0.0425, cap: 0.2125 } })],
        floor: null, cap: null, unit: 'percent', note: 'WIS bonus block chance (clamped to 95% at the call site)',
      },
      block_amount: {
        version: 2, base: 4.25,
        terms: [stat('con', 1, { clampAtZero: true, transform: { kind: 'diminishing', cap: 5.1 } })],
        floor: null, cap: null, unit: 'hp', note: 'CON bonus block amount',
      },
    },
    combat_text: {},
    class_key: 'templar', slot: 2,
  },
  {
    ability_key: 'consecrate', label: 'Consecrate', description: 'Hallow the ground you stand upon — holy light mends every ally on the node and sears the creatures fighting you. Healing and holy burn scale with WIS (35% reduced); how long the sanctity endures scales with CON (6s base, up to 10s).',
    tooltip: 'Hallowed ground mends allies and burns enemies. Power scales with WIS, endurance with CON.',
    mechanic_key: 'aura_pulse', ability_type: 'heal', damage_type: 'holy',
    target_type: 'node', activation_mode: 'instant', cp_cost: 40, cp_reserve_pct: null,
    amount_calc: {
      version: 2, base: 2,
      terms: [stat('wis', 1, { clampAtZero: true })],
      finalMult: 0.65,
      rounding: 'none', floor: null, cap: null, unit: 'hp',
      note: 'WIS heal/burn per tick, x0.65 balance rider',
    },
    duration_calc: { base: 6000, terms: [{ source: 'stat_threshold', stat: 'con', mult: 2000, steps: [{ at: 3, add: 1 }, { at: 6, add: 1 }] }], cap: 10000, unit: 'ms', note: 'CON tick ladder × 2000ms interval' },
    interval_ms: 2000,
    effect_config: { magnitude_stat: 'wis', magnitude_reduction: 0.35, heals_allies: true, damages_enemies: true, resolved_by: 'combat-tick' },
    combat_text: {
      cast_text: 'You consecrate the ground — hallowed light wells up beneath your feet for {duration}s, mending allies and searing the unholy.',
      heal_text: 'Consecrated ground soothes {ally}. [{amount}]',
      burn_text: 'Holy fire sears {target}! [{amount}]',
    },
    class_key: 'templar', slot: 3,
  },
  {
    ability_key: 'divine_challenge', label: 'Divine Challenge', description: 'Reduces each incoming hit by a flat amount. Mitigation scales with WIS (min 6, up to ~24 at high WIS), duration scales with CON.',
    tooltip: 'Flat damage reduction per hit. Min 6, up to ~24 at high WIS; duration scales with CON.',
    mechanic_key: 'mitigation_buff', ability_type: 'buff', damage_type: null,
    target_type: 'self', activation_mode: 'instant', cp_cost: 60, cp_reserve_pct: null,
    amount_calc: { base: 6, terms: [stat('wis', 1, { clampAtZero: true, transform: { kind: 'diminishing_float', perPoint: 1.8, cap: 18 } })], rounding: 'round', floor: null, cap: null, unit: 'flat', note: 'WIS flat mitigation per hit' },
    duration_calc: { base: 30000, terms: [stat('con', 1000, { clampAtZero: true })], cap: 45000, unit: 'ms', note: 'CON duration' },
    interval_ms: null,
    effect_config: { mitigation_mode: 'flat', is_taunt: true, resolved_by: 'combat-tick' },
    combat_text: {
      self_text: 'Divine Challenge! You mitigate incoming blows for {seconds}s. [{amount}]',
      mitigate_text: "{target}'s Divine Challenge mitigates the strike! [{amount}]",
    },
    base_ability_key: 'mitigation_buff',
    class_key: 'templar', slot: 4,
  },
];

/** All distinct playable class keys covered by the seed. */
export const SEEDED_CLASS_KEYS = Array.from(new Set(ABILITY_SEED.map(a => a.class_key)));
