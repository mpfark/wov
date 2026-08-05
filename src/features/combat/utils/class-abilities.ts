import { ABILITY_SEED } from '@/shared/config/ability-seed';

export interface ClassAbility {
  /**
   * Canonical `abilities.ability_key` — the identity used for presentation,
   * authored combat text, calc lookup and server authorization. Distinct from
   * `type`, which is the *mechanic* (executable handler) key. Two abilities may
   * share a mechanic (Fireball / Frost Bolt) without sharing identity.
   */
  abilityKey: string;
  label: string;
  description: string;
  /** Short one-liner shown in the center-panel ability tooltip. */
  tooltip: string;
  cpCost: number;
  type:
    | 'heal' | 'regen_buff' | 'self_heal' | 'crit_buff' | 'stealth_buff' | 'damage_buff'
    | 'hp_transfer' | 'multi_attack' | 'root_debuff' | 'battle_cry' | 'dot_debuff'
    | 'poison_buff' | 'execute_attack' | 'evasion_buff' | 'ignite_buff' | 'ignite_consume'
    | 'absorb_buff' | 'party_regen' | 'ally_absorb' | 'sunder_debuff' | 'disengage_buff'
    | 'burst_damage'
    // Templar abilities (sword-and-shield holy defender)
    | 'reactive_holy' | 'block_buff' | 'consecrate' | 'mitigation_buff'
    // Consolidated reusable spell strike (+ legacy per-class mechanics).
    | 'spell_attack' | 'fireball' | 'smite' | 'cutting_words'
    // Consolidated reusable weapon strike (+ legacy per-class mechanics).
    | 'weapon_attack' | 'power_strike' | 'aimed_shot' | 'backstab';
  tier: number;
  levelRequired: number;
  /** Canonical damage type key (null for buffs, heals and utility). */
  damageType: string | null;
}

/** Fallback literal without identity fields — they are derived from the seed. */
type FallbackAbility = Omit<ClassAbility, 'abilityKey' | 'damageType'>;

// Phase 1 T0 abilities are class-specific (defined per-class below in CLASS_ABILITIES).
// Focus Strike has been removed; there are no universal abilities at present.

const FALLBACK_LITERALS: Record<string, FallbackAbility[]> = {

  healer: [
    { label: 'Smite', description: 'Channel a burst of divine light at your target, scaling with WIS', tooltip: 'Damage one target. Scales with WIS.', cpCost: 10, type: 'spell_attack', tier: 0, levelRequired: 1 },
    { label: 'Heal', description: 'Restore HP based on your Wisdom', tooltip: 'Restore your HP. Scales with WIS.', cpCost: 15, type: 'heal', tier: 1, levelRequired: 5 },
    { label: 'Transfer Health', description: 'Sacrifice your own HP (amount = WIS) to heal a targeted ally. CON sets your safety floor — hardy healers can give more without dropping themselves low.', tooltip: 'Sacrifice HP to heal an ally. Scales with WIS; CON sets your safety floor.', cpCost: 25, type: 'hp_transfer', tier: 2, levelRequired: 10 },
    { label: 'Purifying Light', description: 'A wave of divine radiance that heals all nearby allies over time. Heal/tick scales with WIS; duration scales with CON (stamina sustains the radiance).', tooltip: 'Heal nearby allies over time. Heal scales with WIS, duration with CON.', cpCost: 40, type: 'party_regen', tier: 3, levelRequired: 15 },
    { label: 'Divine Aegis', description: 'Create an absorb shield on a targeted ally (or self). Pool scales with WIS; duration (up to 60s) scales with CON.', tooltip: 'Shield an ally with an absorb pool. Pool scales with WIS, duration with CON.', cpCost: 60, type: 'ally_absorb', tier: 4, levelRequired: 20 },
  ],
  warrior: [
    { label: 'Power Strike', description: 'A heavy, focused blow. Rolls your equipped weapon damage + STR + ability bonus (unarmed falls back to 1d4).', tooltip: 'Heavy blow. Rolls weapon damage + STR + bonus.', cpCost: 10, type: 'weapon_attack', tier: 0, levelRequired: 1 },
    { label: 'Second Wind', description: 'Catch your breath and recover HP based on CON', tooltip: 'Recover your HP. Scales with CON.', cpCost: 15, type: 'heal', tier: 1, levelRequired: 5 },
    { label: 'Battle Cry', description: 'Stance. Reduces incoming damage and softens crits — magnitude scales with STR (with a small shield bonus), duration with DEX. Click again to drop.', tooltip: 'Reduce incoming damage and soften crits. Magnitude scales with STR, duration with DEX. Stance.', cpCost: 25, type: 'battle_cry', tier: 2, levelRequired: 10 },
    { label: 'Rend', description: 'Slice your target, applying a bleed that ticks every 2s. Per-tick damage scales with your equipped weapon (bigger swords bleed harder) and STR. Duration scales with DEX (precision keeps the wound open).', tooltip: 'Bleed your target over time. Per-tick scales with weapon + STR, duration with DEX.', cpCost: 40, type: 'dot_debuff', tier: 3, levelRequired: 15 },
    { label: 'Sunder Armor', description: "A crushing blow that reduces your target's AC by a STR-scaled amount. Duration scales with DEX (precise strike, lasting weakness).", tooltip: "Reduce target's AC. Amount scales with STR, duration with DEX.", cpCost: 60, type: 'sunder_debuff', tier: 4, levelRequired: 20 },
  ],
  ranger: [
    { label: 'Aimed Shot', description: 'A careful shot. Rolls your equipped weapon damage + DEX + ability bonus (unarmed falls back to 1d4).', tooltip: 'Careful shot. Rolls weapon damage + DEX + bonus.', cpCost: 10, type: 'weapon_attack', tier: 0, levelRequired: 1 },
    { label: 'Eagle Eye', description: 'Stance. Widens your critical hit range based on a blend of DEX (precision) and WIS (attunement) while active. Click again to drop.', tooltip: 'Widen your crit range. Scales with DEX and WIS. Stance.', cpCost: 15, type: 'crit_buff', tier: 1, levelRequired: 5 },
    { label: 'Barrage', description: 'Fire a volley of arrows. Each arrow rolls your equipped weapon damage (unarmed: 1d4) + half DEX. Arrow count scales with WIS: 2 base, +1 with DEX≥3, +1 more with WIS≥4 (max 4).', tooltip: 'Volley of arrows. Each rolls weapon damage + half DEX; count scales with WIS.', cpCost: 25, type: 'multi_attack', tier: 2, levelRequired: 10 },
    { label: "Nature's Snare", description: "Entangle your target. Damage-reduction magnitude scales with DEX (precise binding), duration scales with WIS.", tooltip: "Reduce target's damage. Reduction scales with DEX, duration with WIS.", cpCost: 40, type: 'root_debuff', tier: 3, levelRequired: 15 },
    { label: 'Disengage', description: 'Leap backward — dodge all attacks briefly. Dodge duration scales with DEX, next-strike bonus damage scales with WIS (calm aim).', tooltip: 'Dodge briefly; next strike deals bonus damage. Bonus scales with WIS, duration with DEX.', cpCost: 60, type: 'disengage_buff', tier: 4, levelRequired: 20 },
  ],
  bard: [
    { label: 'Cutting Words', description: 'Unleash a barbed insult that wounds your target, scaling with CHA', tooltip: 'Damage one target. Scales with CHA.', cpCost: 10, type: 'spell_attack', tier: 0, levelRequired: 1 },
    { label: 'Inspire', description: 'A song that grants you and your party flat HP & CP regen, scaling with your Charisma. Duration scales with Intelligence (60–180s). Recasting refreshes the duration and keeps the stronger regen values.', tooltip: 'Grant party HP & CP regen. Regen scales with CHA, duration with INT.', cpCost: 15, type: 'regen_buff', tier: 1, levelRequired: 5 },
    { label: 'Dissonance', description: "A discordant note that reduces your target's damage. Reduction magnitude scales with CHA (cutting cadence), duration scales with INT.", tooltip: "Reduce target's damage. Reduction scales with CHA, duration with INT.", cpCost: 25, type: 'root_debuff', tier: 2, levelRequired: 10 },
    { label: 'Crescendo', description: 'A rising melody that heals all nearby allies over time. Heal/tick scales with CHA; duration scales with INT.', tooltip: 'Heal nearby allies over time. Heal scales with CHA, duration with INT.', cpCost: 40, type: 'party_regen', tier: 3, levelRequired: 15 },
    { label: 'Grand Finale', description: 'Unleash a devastating crescendo of sound (CHA-scaled damage). INT sharpens the killing note — each point of INT widens the crit-edge.', tooltip: 'Burst damage on one target. Damage scales with CHA, crit-edge with INT.', cpCost: 60, type: 'burst_damage', tier: 4, levelRequired: 20 },
  ],
  assassin: [
    { label: 'Backstab', description: 'Strike at a vital point. Rolls your equipped weapon damage + DEX + ability bonus (unarmed falls back to 1d4).', tooltip: 'Vital strike. Rolls weapon damage + DEX + bonus.', cpCost: 10, type: 'weapon_attack', tier: 0, levelRequired: 1 },
    { label: 'Shadowstep', description: 'Vanish into shadow — duration scales with DEX, and your next strike from stealth deals an ambush multiplier scaling with CHA (cap ×2.5).', tooltip: 'Vanish into stealth; next strike is an ambush. Duration scales with DEX, ambush with CHA.', cpCost: 15, type: 'stealth_buff', tier: 1, levelRequired: 5 },
    { label: 'Envenom', description: 'Stance. Each hit may apply a stackable poison DoT — proc chance scales with DEX, max stack ceiling scales with CHA. Mutually exclusive with Orbs of Fire. Click again to drop.', tooltip: 'Hits may apply stacking poison. Proc scales with DEX, max stacks with CHA. Stance.', cpCost: 50, type: 'poison_buff', tier: 2, levelRequired: 10 },
    { label: 'Eviscerate', description: 'A vicious finisher. Rolls your equipped weapon damage + DEX + ability bonus, then multiplied by consumed poison stacks (per-stack bonus scales with CHA showmanship). Unarmed falls back to 1d4.', tooltip: 'Rolls weapon damage + DEX + bonus, multiplied by poison stacks (CHA).', cpCost: 40, type: 'execute_attack', tier: 3, levelRequired: 15 },
    { label: 'Cloak of Shadows', description: 'Wrap yourself in shadow. Dodge chance scales with CHA (theatrical misdirection), duration scales with DEX.', tooltip: 'Chance to dodge attacks. Dodge scales with CHA, duration with DEX.', cpCost: 60, type: 'evasion_buff', tier: 4, levelRequired: 20 },
  ],
  wizard: [
    { label: 'Fireball', description: 'Hurl a ball of arcane flame at your target, scaling with INT', tooltip: 'Damage one target. Scales with INT.', cpCost: 10, type: 'spell_attack', tier: 0, levelRequired: 1 },
    { label: 'Force Shield', description: 'Stance. Maintains an arcane absorb shield (WIS-scaled pool, INT-scaled regen) that re-forms out of combat. Click again to drop.', tooltip: 'Maintain an arcane absorb shield. Pool scales with WIS, regen with INT. Stance.', cpCost: 15, type: 'absorb_buff', tier: 1, levelRequired: 5 },
    { label: 'Arcane Surge', description: 'Stance. All your damage is increased — bonus magnitude scales with INT. Click again to drop.', tooltip: 'Increase all your damage. Bonus scales with INT. Stance.', cpCost: 25, type: 'damage_buff', tier: 2, levelRequired: 10 },
    { label: 'Orbs of Fire', description: 'Stance. While in combat, an orb of fire pulses each heartbeat at your target — proc chance and spark damage scale with INT, and each spark applies the Ignite burn (stacks/duration scale with WIS). Mutually exclusive with Envenom. Click again to drop.', tooltip: 'Orbs strike your target and apply Ignite burn. Proc/spark scale with INT, burn with WIS. Stance.', cpCost: 50, type: 'ignite_buff', tier: 3, levelRequired: 15 },
    { label: 'Conflagrate', description: 'Consume all burn stacks on your target for bonus damage per stack. Per-stack bonus scales with INT; stack count scales with WIS via Orbs of Fire.', tooltip: 'Consume burn stacks for bonus damage. Per-stack scales with INT.', cpCost: 60, type: 'ignite_consume', tier: 4, levelRequired: 20 },
  ],
  templar: [
    { label: 'Judgment',         description: 'Pass divine judgment, dealing holy damage scaling with WIS', tooltip: 'Holy damage to one target. Scales with WIS.', cpCost: 10, type: 'spell_attack', tier: 0, levelRequired: 1 },
    { label: 'Holy Shield',      description: 'Stance. Attackers who strike you take holy damage in return — WIS scaling reduced 20%, with a CON kicker (CON adds to retaliation damage). Once per attacker per tick. Click again to drop.', tooltip: 'Attackers take holy damage in return. WIS scaling reduced 20%, CON adds a kicker. Stance.', cpCost: 15, type: 'reactive_holy', tier: 1, levelRequired: 5 },
    { label: 'Shield Wall',      description: 'Stance. Dual-primary: WIS adds bonus block chance (+25.5% floor, up to +46.75% at high WIS), CON adds bonus block amount (+~4 floor, up to +~9 at high CON). Final block chance capped at 95%. Requires a shield equipped to benefit. Click again to drop.', tooltip: 'Boost block chance and amount. Chance scales with WIS, amount with CON. Stance.', cpCost: 25, type: 'block_buff', tier: 2, levelRequired: 10 },
    { label: 'Consecrate',       description: 'Hallow the ground you stand upon — holy light mends every ally on the node and sears the creatures fighting you. Healing and holy burn scale with WIS (35% reduced); how long the sanctity endures scales with CON (6s base, up to 10s).', tooltip: 'Hallowed ground mends allies and burns enemies. Power scales with WIS, endurance with CON.', cpCost: 40, type: 'consecrate', tier: 3, levelRequired: 15 },
    { label: 'Divine Challenge', description: 'Reduces each incoming hit by a flat amount. Mitigation scales with WIS (min 6, up to ~24 at high WIS), duration scales with CON.', tooltip: 'Flat damage reduction per hit. Min 6, up to ~24 at high WIS; duration scales with CON.', cpCost: 60, type: 'mitigation_buff', tier: 4, levelRequired: 20 },
  ],
};

/**
 * Canonical identity for the compiled fallback: `ability_key` and `damage_type`
 * come from `ABILITY_SEED` (the same rows seeded into `abilities`), matched by
 * class + slot. Sealed mode therefore always carries a canonical `abilityKey`.
 */
const SEED_BY_SLOT = new Map(
  ABILITY_SEED.map(s => [`${s.class_key}:${s.slot}`, s] as const),
);

export const CLASS_ABILITIES: Record<string, ClassAbility[]> = Object.fromEntries(
  Object.entries(FALLBACK_LITERALS).map(([classKey, list]) => [
    classKey,
    list.map((a): ClassAbility => {
      const seed = SEED_BY_SLOT.get(`${classKey}:${a.tier}`);
      return {
        ...a,
        abilityKey: seed?.ability_key ?? `${classKey}_slot_${a.tier}`,
        damageType: seed?.damage_type ?? null,
      };
    }),
  ]),
);



// ── Configurable ability registry (Phase 2b) ────────────────────
//
// `CLASS_ABILITIES` above is the balance-identical fallback (matches the rows
// seeded into `abilities` / `class_ability_assignments`). At boot,
// `useAbilityRegistry` fetches the configured rows and calls
// `setAbilityRegistry`, which rewrites `CLASS_ABILITIES` **in place** so every
// existing consumer (ability bar, combat driver, admin manual) reads configured
// labels, descriptions, CP costs and unlock levels with no refactor.
//
// The runtime *mechanic* stays code-owned: `mechanic_key` must match one of the
// `ClassAbility['type']` handlers. Rows with an unknown mechanic are skipped and
// logged rather than silently breaking a class bar.

/** Shape of one joined `class_ability_assignments` row. */
export interface AbilityConfigRow {
  class_key: string;
  /** Per-class identity; preferred over the base `ability_key` (Phase 1). */
  class_ability_key?: string | null;
  unlock_level: number;
  is_default: boolean;
  status: string;
  /** `abilities.id` — present once the loadout columns are selected. */
  ability_id?: string;
  role: { id?: string; slot: number; name?: string } | null;
  ability: {
    ability_key?: string;
    label: string;
    description: string;
    tooltip: string;
    cp_cost: number;
    mechanic_key: string;
    status: string;
    damage_type?: string | null;
    amount_calc?: unknown;
    duration_calc?: unknown;
    interval_ms?: number | null;
    effect_config?: unknown;
  } | null;
}


const KNOWN_MECHANICS = new Set<string>([
  ...Object.values(CLASS_ABILITIES).flatMap(list => list.map(a => a.type as string)),
  // Legacy per-class weapon mechanics: consolidated into `weapon_attack`, but
  // still handled by the runtime so archived assignments keep resolving.
  'power_strike', 'aimed_shot', 'backstab',
]);

/** Snapshot of the fallback tables, so a reload/registry reset can restore them. */
const FALLBACK_ABILITIES: Record<string, ClassAbility[]> = Object.fromEntries(
  Object.entries(CLASS_ABILITIES).map(([k, list]) => [k, list.map(a => ({ ...a }))]),
);

let abilityRegistryLoaded = false;

export function isAbilityRegistryLoaded(): boolean {
  return abilityRegistryLoaded;
}

/** True when `mechanic_key` maps to an implemented runtime handler. */
export function isKnownAbilityMechanic(mechanicKey: string): boolean {
  return KNOWN_MECHANICS.has(mechanicKey);
}

/**
 * Every code-owned mechanic an authored ability may bind to (Phase 4).
 * Admin authoring can compose new abilities/classes only from these handlers —
 * a brand-new mechanic still requires a code change.
 */
export function getKnownAbilityMechanics(): string[] {
  return [...KNOWN_MECHANICS].sort();
}

/**
 * Apply configured ability rows, mutating `CLASS_ABILITIES` in place.
 * Only classes present in `rows` are replaced; every other class keeps its
 * fallback list. An empty payload is ignored (treated as a failed load).
 */
export function setAbilityRegistry(rows: AbilityConfigRow[]): void {
  if (!rows || rows.length === 0) return;

  const byClass = new Map<string, ClassAbility[]>();

  for (const row of rows) {
    if (!row.ability || !row.role) continue;
    if (row.status !== 'active' || row.ability.status !== 'active') continue;
    if (!row.is_default) continue;
    if (!isKnownAbilityMechanic(row.ability.mechanic_key)) {
      console.warn(
        `[ability-registry] skipping ${row.class_key}/${row.ability.label}: `
        + `unknown mechanic "${row.ability.mechanic_key}"`,
      );
      continue;
    }
    const list = byClass.get(row.class_key) ?? [];
    list.push({
      // Per-class identity first: consolidated bases are shared, so the class
      // key is what keeps Power Strike and Backstab distinct.
      abilityKey: row.class_ability_key || row.ability.ability_key || '',
      label: row.ability.label,
      description: row.ability.description,
      tooltip: row.ability.tooltip,
      cpCost: row.ability.cp_cost,
      type: row.ability.mechanic_key as ClassAbility['type'],
      tier: row.role.slot, // provisional: normalized to a 0-based index below
      levelRequired: row.unlock_level,
      damageType: row.ability.damage_type ?? null,
    });

    byClass.set(row.class_key, list);
  }

  for (const [classKey, list] of byClass) {
    if (list.length === 0) continue;
    // Role slots may be 1-based in config; the runtime tier is a 0-based index
    // into the class bar, so normalize after ordering.
    list.sort((a, b) => a.tier - b.tier);
    list.forEach((a, i) => { a.tier = i; });
    CLASS_ABILITIES[classKey] = list;
  }
  abilityRegistryLoaded = true;
}

/** Restore the hardcoded fallback lists (used by tests). */
export function resetAbilityRegistry(): void {
  for (const key of Object.keys(CLASS_ABILITIES)) delete CLASS_ABILITIES[key];
  for (const [k, list] of Object.entries(FALLBACK_ABILITIES)) {
    CLASS_ABILITIES[k] = list.map(a => ({ ...a }));
  }
  abilityRegistryLoaded = false;
}

/** Abilities a character of `classKey` has unlocked at `level`. */
export function getUnlockedAbilities(classKey: string, level: number): ClassAbility[] {
  return (CLASS_ABILITIES[classKey] ?? []).filter(a => level >= a.levelRequired);
}

/**
 * Replace one class's live bar (Phase 4 loadouts). The incoming list is ordered
 * by config slot; tiers are re-indexed to the 0-based bar position so every
 * consumer keeps its existing tier semantics.
 */
export function setClassAbilityList(classKey: string, list: ClassAbility[]): void {
  if (!list || list.length === 0) return;
  const ordered = [...list].sort((a, b) => a.tier - b.tier);
  ordered.forEach((a, i) => { a.tier = i; });
  CLASS_ABILITIES[classKey] = ordered;
}
