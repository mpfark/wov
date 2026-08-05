/**
 * useCombatActions — owns combat-related player actions:
 * equipment degradation, loot rolling, kill rewards, abilities, and attack.
 *
 * Pure helpers are extracted at module level for testability and readability.
 * The hook itself orchestrates these helpers with React state and side effects.
 *
 * State classification: Action orchestration (no owned state beyond lastUsedAbilityCost)
 */
import { useState, useCallback } from 'react';
import { Character } from '@/features/character';
import {
  getStatModifier,
  getEffectiveMaxHp,
} from '@/lib/game-data';
import { CLASS_ABILITIES } from '@/features/combat';
import { supabase } from '@/integrations/supabase/client';
import type { DotDebuff } from '@/features/combat';
import type { BuffState, BuffSetters } from '@/features/combat/hooks/useBuffState';
import { getAvailableCp } from '@/features/combat/utils/cp-display';
import {
  buildCalcInputs, resolveAmount, resolveDuration, resolveInterval, resolveMechanic,
} from '@/features/combat/utils/ability-calcs';

import {
  getStanceForAbility,
  isStanceActive,
  isMutuallyExcluded,
  sumStanceReserved,
  getStanceReserveCost,
  getStanceActivateFlavor,
  getStanceDropFlavor,
  type ReservedBuffsMap,
} from '@/features/combat/utils/stances';
import { getEffectiveMaxCp } from '@/lib/game-data';
import { getAuthoredCombatText, resolveCastFlavor } from '@/features/combat/utils/ability-text';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import { buildTauntEvent } from '@/features/combat/events/threat-event-builder';
import { buildAbilityEvent, buildBuffEvent, buildDebuffEvent, buildErrorEvent, buildHealEvent } from '@/features/combat/events/client-event-builder';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pure helpers (module-level, outside hook)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Ability types that resolve instantly client-side (buffs only — heals stay queued for rate-limiting) */
/** Ability types that resolve instantly client-side (buffs only — heals stay queued for rate-limiting)
 *
 *  IMPORTANT:
 *  Stance-based abilities (crit_buff, absorb_buff, reactive_holy, damage_buff,
 *  battle_cry, ignite_buff, poison_buff) MUST NOT appear in this set. They are
 *  handled exclusively via activate_stance / drop_stance RPCs, intercepted by
 *  the stance toggle block at the top of `handleUseAbility`. Adding them here
 *  would reintroduce legacy timed-buff behavior alongside the stance system.
 */
const INSTANT_BUFF_TYPES = new Set([
  'stealth_buff',
  'regen_buff', 'evasion_buff', 'disengage_buff',
  'party_regen', 'root_debuff', 'sunder_debuff', 'ally_absorb',
  // Templar instant buffs (non-stance)
  'consecrate', 'mitigation_buff',
]);

/** Ability types that require being in combat with a valid target */
const COMBAT_REQUIRED_TYPES = new Set([
  'multi_attack', 'dot_debuff', 'execute_attack', 'ignite_consume',
  'burst_damage', 'hp_transfer',
]);

/** T0 damage abilities — usable as combat openers against a Tab-targeted creature.
 *  Resolved server-side by combat-tick; CP is reserved client-side and deducted by the server. */
const T0_OPENER_TYPES = new Set([
  'spell_attack', 'fireball', 'weapon_attack', 'power_strike', 'aimed_shot', 'backstab', 'smite', 'cutting_words',
]);

// (Queue-flavor chat log was removed — the ability button's pulsing
// outline is the only pending-cast indicator now.)


/** Resolve creature target — prefer explicit targetId, fall back to active combat target */
function resolveCreatureTarget(
  creatures: any[],
  activeCombatCreatureId: string | null,
  targetId?: string,
): string | null {
  if (targetId) {
    const c = creatures.find(cr => cr.id === targetId && cr.is_alive && cr.hp > 0);
    if (c) return targetId;
  }
  return activeCombatCreatureId;
}

// NOTE: Kill rewards (XP, gold, Renown, salvage), level-up bookkeeping, and loot
// rolling all live server-side in `combat-tick` (see `_shared/kill-resolver.ts`
// + `_shared/reward-calculator.ts`). The server is the SOLE writer for those
// fields; results land in `member_states` and are applied to local state by
// `interpretCombatTickResult`. Solo and party kills go through the same code
// path, which is why we no longer need a client-side `awardKillRewards`,
// `buildLevelUpUpdates`, `awardPartyXpGold`, `awardPartySalvage`, or `rollLoot`.

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Params interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UseCombatActionsParams {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  /** State-only mirror — must be used for fields the server already persisted (e.g. reserved_buffs via stance RPCs) to avoid racing redundant DB writes. */
  updateCharacterLocal?: (updates: Partial<Character>) => void;

  /** Stage 9 — structured emitter for taunt / threat lines. */
  addLogEvent?: (event: GameLogEvent) => void;
  equipped: { id: string; item_id: string; item: { stats: any; name: string; rarity: string; item_type: string; [k: string]: any }; current_durability: number; [k: string]: any }[];
  equipmentBonuses: Record<string, number>;
  creatures: any[];
  creatureHpOverrides: Record<string, number>;
  party: any;
  partyMembers: any[];
  inCombat: boolean;
  activeCombatCreatureId: string | null;
  startCombat: (id: string) => void;
  stopCombat: () => void;
  queueAbility: (index: number, targetId?: string) => void;
  /** CP reserved by an in-flight queued server ability — subtracted from affordability checks. */
  pendingCpCost?: number;
  isDead: boolean;
  fetchInventory: () => void;
  buffState: BuffState;
  buffSetters: BuffSetters;
}
// NOTE: Params trimmed after server became sole writer of kill rewards:
//   - `xpMultiplier`, `notifyCreatureKilled`, `fetchGroundLoot` were used by
//     the removed client-side `awardKillRewards` / `rollLoot`.
//   - `updateCharacterLocal`, `onResourcesSynced` were used by the removed
//     client-side level-up bookkeeping. Resource sync now flows through
//     `interpretCombatTickResult` from the server response.

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Hook
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function useCombatActions(params: UseCombatActionsParams) {
  const p = params;
  const [lastUsedAbilityCost, setLastUsedAbilityCost] = useState(0);

  // ── Equipment degradation ──────────────────────────────────────
  const degradeEquipment = useCallback(async () => {
    if (p.equipped.length === 0) return;
    const shuffled = [...p.equipped].sort(() => Math.random() - 0.5);
    const toDamage = shuffled.slice(0, 1);
    for (const item of toDamage) {
      const newDur = item.current_durability - 1;
      if (newDur <= 0) {
        if (item.item.rarity === 'unique') {
          p.addLogEvent(buildAbilityEvent(`Your ${item.item.name} shatters and its essence returns to its origin...`));
          await supabase.from('character_inventory').delete().eq('id', item.id);
        } else {
          p.addLogEvent(buildAbilityEvent(`Your ${item.item.name} has broken! Visit a blacksmith to repair it.`));
          await supabase.from('character_inventory').update({ current_durability: 0, equipped_slot: null } as any).eq('id', item.id);
        }
      } else {
        await supabase.from('character_inventory').update({ current_durability: newDur }).eq('id', item.id);
      }
    }
    p.fetchInventory();
  }, [p.equipped, p.addLogEvent, p.fetchInventory]);

  // NOTE: `rollLoot` removed — server (`combat-tick` → `processLootDrops`) is
  // the sole authority for ground-loot drops on kill.


  // NOTE: `awardKillRewards` removed — `combat-tick` is the sole authority
  // for kill rewards (XP/gold/Renown/salvage), level-ups, and loot resolution.
  // Local state lands via `interpretCombatTickResult` from the tick response.


  // ── Use Ability ────────────────────────────────────────────────
  const handleUseAbility = useCallback(async (abilityIndex: number, targetId?: string, _fromTick = false) => {
    if (p.isDead || p.character.hp <= 0) return;
    const allAbilities = CLASS_ABILITIES[p.character.class] || [];
    if (!allAbilities[abilityIndex]) return;
    const ability = allAbilities[abilityIndex];

    // ── Validation ──
    if (p.character.level < ability.levelRequired) {
      p.addLogEvent(buildErrorEvent(`${ability.label} unlocks at level ${ability.levelRequired}.`));
      return;
    }

    // ── Stance toggle interception ──────────────────────────────
    // Stance abilities (Eagle Eye, Force Shield, Holy Shield, Arcane Surge,
    // Battle Cry, Ignite, Envenom) do not behave like normal abilities. They
    // toggle on/off, reserve a percentage of max CP for as long as they are
    // active, and persist across combat / movement until the player drops
    // them or logs out. The server (`activate_stance` / `drop_stance` RPCs)
    // is authoritative; this branch never deducts CP locally — `combat-tick`
    // and the next character refresh will reconcile the canonical state.
    const stanceDef = getStanceForAbility(ability.type);
    if (stanceDef) {
      const reservedBuffs: ReservedBuffsMap = (p.character as any).reserved_buffs ?? {};
      const alreadyActive = isStanceActive(reservedBuffs, stanceDef.key);

      if (alreadyActive) {
        const { data, error } = await supabase.rpc('drop_stance', {
          p_character_id: p.character.id,
          p_stance_key: stanceDef.key,
        });
        if (error) {
          p.addLogEvent(buildErrorEvent(`Failed to drop ${stanceDef.label}: ${error.message}`));
          return;
        }
        // Optimistically reflect the new reserved_buffs map immediately so the
        // CP bar / pip row updates without waiting for a full character refetch.
        p.updateCharacterLocal?.({ reserved_buffs: (data as any) ?? {} } as any);
        p.addLogEvent(buildBuffEvent(getStanceDropFlavor(stanceDef.key), { effectType: 'stance' }));
        return;
      }

      if (isMutuallyExcluded(reservedBuffs, stanceDef.key)) {
        p.addLogEvent(buildErrorEvent(`You cannot maintain Ignite and Envenom at the same time.`));
        return;
      }

      const maxCp = getEffectiveMaxCp(p.character.level, p.character.wis, p.equipmentBonuses);
      const cost = getStanceReserveCost(stanceDef.tier, maxCp);
      const stanceReservedNow = sumStanceReserved(reservedBuffs);
      const usable = getAvailableCp(p.character.cp ?? 0, p.pendingCpCost ?? 0, stanceReservedNow);
      if (usable < cost) {
        p.addLogEvent(buildErrorEvent(`Not enough usable CP to maintain ${stanceDef.label}! (${cost} CP needed, ${usable} available)`));
        return;
      }

      const { data, error } = await supabase.rpc('activate_stance', {
        p_character_id: p.character.id,
        p_stance_key: stanceDef.key,
        p_tier: stanceDef.tier,
      });
      if (error) {
        p.addLogEvent(buildErrorEvent(`Failed to activate ${stanceDef.label}: ${error.message}`));
        return;
      }
      // Optimistic reflect — RPC returns the full reserved_buffs map.
      p.updateCharacterLocal?.({ reserved_buffs: (data as any) ?? {} } as any);
      p.addLogEvent(buildBuffEvent(getStanceActivateFlavor(stanceDef.key, cost), { effectType: 'stance' }));
      return;
    }

    const effectiveCpCost = ability.cpCost;
    const stanceReserved = sumStanceReserved((p.character as any).reserved_buffs);
    const availableCp = getAvailableCp(p.character.cp ?? 0, p.pendingCpCost ?? 0, stanceReserved);
    if (availableCp < effectiveCpCost) {
      p.addLogEvent(buildErrorEvent(`Not enough CP for ${ability.label}! (${effectiveCpCost} CP needed, ${availableCp} available)`));
      return;
    }

    const isInstantBuff = INSTANT_BUFF_TYPES.has(ability.type);

    // Early combat check before queuing
    if (!isInstantBuff && !_fromTick && COMBAT_REQUIRED_TYPES.has(ability.type)) {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) {
        p.addLogEvent(buildErrorEvent(`You must be in combat to use ${ability.label}!`));
        return;
      }
    }

    // T0 opener: requires a valid creature target on the node, but does NOT
    // require existing combat. Resolves Tab target → active target → first alive.
    let resolvedT0TargetId: string | undefined = targetId;
    if (!isInstantBuff && !_fromTick && T0_OPENER_TYPES.has(ability.type)) {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId)
        ?? p.creatures.find((c: any) => c.is_alive && c.hp > 0)?.id
        ?? null;
      if (!cTargetId) {
        p.addLogEvent(buildErrorEvent(`No target for ${ability.label}!`));
        return;
      }
      resolvedT0TargetId = cTargetId;
    }

    // Damage/heal abilities must be queued for the heartbeat tick.
    // No chat-log entry is emitted — the ability button itself pulses while
    // pending, which is sufficient visual feedback (and avoids the orphan
    // queued line landing on its own row when queued out of combat).
    if (!isInstantBuff && !_fromTick) {
      const queueTargetId = resolvedT0TargetId ?? targetId;
      const targetName = queueTargetId
        ? (p.creatures.find((c: any) => c.id === queueTargetId)?.name ?? null)
        : null;
      const castFlavor = resolveCastFlavor(ability, p.character.class, targetName);
      if (castFlavor) {
        p.addLogEvent(buildAbilityEvent(castFlavor, {
          abilityKey: ability.abilityKey,
          ...(ability.damageType ? { damageType: ability.damageType } : {}),
        }));
      }
      p.queueAbility(abilityIndex, queueTargetId);
      return;
    }

    // ── Configured magnitudes ──
    // Amount / duration / interval come exclusively from the ability's stored
    // calcs (checkpoint 7 — the inline legacy formulas are gone). The compiled
    // ABILITY_SEED primes the registry, so a failed config load still resolves.
    const calcInputs = buildCalcInputs(p.character, p.equipmentBonuses);
    const amountOf = () =>
      resolveAmount(p.character.class, ability.tier, calcInputs);
    const durationOf = () =>
      resolveDuration(p.character.class, ability.tier, calcInputs);
    const intervalOf = () =>
      resolveInterval(p.character.class, ability.tier);
    /**
     * Named mechanic parameter (`abilities.mechanic_calcs`) for this cast.
     * Admin-configured knobs are the source; `fallback` is a constant safety
     * floor only, never a formula.
     */
    const mechanicOf = (param: string, fallback: number) =>
      resolveMechanic(p.character.class, ability.tier, param, calcInputs, fallback);

    // ── Ability type switch ──
    if (ability.type === 'hp_transfer') {
      if (!targetId || targetId === p.character.id) {
        p.addLogEvent(buildHealEvent(`You must target an ally to transfer health.`));
        return;
      }
      const transferAmount = amountOf();
      // Dual-primary split: amount = WIS, safety floor scales with CON (hardy
      // healers can safely sacrifice deeper without dropping themselves dangerously low).
      // The floor is the configured `reserve_hp` mechanic calc.
      const reserveHp = Math.max(1, Math.floor(mechanicOf('reserve_hp', 1)));
      const maxTransfer = p.character.hp - reserveHp;
      if (maxTransfer <= 0) { p.addLogEvent(buildErrorEvent(`You don't have enough HP to transfer! (need to keep ${reserveHp} HP)`)); return; }
      const actualTransfer = Math.min(transferAmount, maxTransfer);
      await p.updateCharacter({ hp: p.character.hp - actualTransfer });
      const { data: restored, error } = await supabase.rpc('heal_party_member', {
        _healer_id: p.character.id, _target_id: targetId, _heal_amount: actualTransfer,
      });
      if (error) { p.addLogEvent(buildErrorEvent(`Failed to transfer health: ${error.message}`)); return; }
      const targetMember = p.partyMembers.find(m => m.character_id === targetId);
      const targetName = targetMember?.character.name || 'ally';
      p.addLogEvent(buildHealEvent(`${p.character.name} sacrifices life to heal ${targetName}! [${restored ?? actualTransfer}]`));
    } else if (ability.type === 'heal' || ability.type === 'self_heal') {
      // Consolidation Phase 4: Heal and Second Wind share the one `heal` base.
      // The wording comes from authored `combat_text` keyed by ability identity,
      // never from a per-class branch here. `self_heal` stays accepted so an
      // archived row still resolves.
      const healAmount = amountOf();
      const healEffMaxHp = getEffectiveMaxHp(p.character.class, p.character.con, p.character.level, p.equipmentBonuses);
      const newHp = Math.min(healEffMaxHp, p.character.hp + healAmount);
      const restored = newHp - p.character.hp;
      const text = getAuthoredCombatText(ability.abilityKey);
      const authored = (key: string): string | null => {
        const raw = text[key];
        return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
      };
      const hitText = authored('self_text') ?? `You cast ${ability.label} and mend your wounds!`;
      const fullText = authored('self_full_text')
        ?? `You cast ${ability.label} but you're already at full health.`;
      if (restored > 0) { await p.updateCharacter({ hp: newHp }); p.addLogEvent(buildHealEvent(`${hitText} [${restored}]`)); }
      else p.addLogEvent(buildHealEvent(fullText));
    } else if (ability.type === 'regen_buff') {
      // Inspire — additive flat HP/CP regen.
      // Magnitude scales with CHA (Bard's primary stat); duration scales with INT.
      // Recast policy: refresh the timer to the new duration; keep the
      // best-of HP/CP regen across the prior and new cast (never weakens an
      // active buff). Does not stack.
      const newHp = amountOf();
      // CP regen per tick is the configured `cp_per_tick` mechanic calc.
      const newCp = Math.max(1, Math.ceil(mechanicOf('cp_per_tick', 1)));
      const durationMs = durationOf();
      const now = Date.now();
      const prev = p.buffState.inspireBuff;
      const wasActive = !!(prev && prev.expiresAt > now);
      const mergedHp = wasActive ? Math.max(prev!.hpPerTick, newHp) : newHp;
      const mergedCp = wasActive ? Math.max(prev!.cpPerTick, newCp) : newCp;
      p.buffSetters.setInspireBuff({
        hpPerTick: mergedHp,
        cpPerTick: mergedCp,
        expiresAt: now + durationMs,
        durationMs,
        casterId: p.character.id,
      });
      const durSec = Math.round(durationMs / 1000);
      if (wasActive) {
        p.addLogEvent(buildBuffEvent(`${p.character.name} renews the inspiring song! (${durSec}s remaining) [+${mergedHp}HP +${mergedCp}CP]`));
      } else {
        p.addLogEvent(buildBuffEvent(`${p.character.name} plays an inspiring song for ${durSec}s! [+${mergedHp}HP +${mergedCp}CP]`));
      }
    } else if (ability.type === 'crit_buff') {
      // Eagle Eye (Ranger): dual-primary — focused vision blends DEX precision + WIS attunement.
      const critBonus = amountOf();
      const critDurationMs = durationOf();
      p.buffSetters.setCritBuff({ bonus: critBonus, expiresAt: Date.now() + critDurationMs });
      p.addLogEvent(buildBuffEvent(`Eagle Eye! Your crit range is now ${20 - critBonus}-20 for ${Math.round(critDurationMs / 1000)}s.`));
    } else if (ability.type === 'stealth_buff') {
      // Shadowstep (Assassin): dual-primary — duration scales with DEX, ambush mult with CHA flair.
      const durationMs = durationOf();
      const ambushMult = amountOf();
      p.buffSetters.setStealthBuff({ expiresAt: Date.now() + durationMs, mult: ambushMult });
      p.addLogEvent(buildBuffEvent(`Shadowstep! You vanish into the shadows for ${Math.round(durationMs / 1000)}s (ambush ×${ambushMult.toFixed(2)}).`));
    } else if (ability.type === 'damage_buff') {
      // Stance — unreachable here; the stance toggle block at the top of
      // handleUseAbility intercepts this ability type. Left as a no-op safety net.
      return;
    } else if (ability.type === 'multi_attack') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'root_debuff') {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) { p.addLogEvent(buildErrorEvent(`You must be in combat to use ${ability.label}!`)); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLogEvent(buildErrorEvent(`No valid target for ${ability.label}.`)); return; }
      // Class-branched dual-primary: Ranger's Nature's Snare scales duration with WIS;
      // Bard's Dissonance scales duration with INT (bards have no WIS in their kit).
      const durationMs = durationOf();
      const reduction = amountOf();
      p.buffSetters.setRootDebuff({ damageReduction: reduction, expiresAt: Date.now() + durationMs, creatureId: cTargetId });
      p.addLogEvent(buildDebuffEvent(`${ability.label}! ${creature.name}'s damage reduced by ${Math.round(reduction * 100)}% for ${Math.round(durationMs / 1000)}s.`));
    } else if (ability.type === 'battle_cry') {
      // Stance — unreachable; intercepted by stance toggle block above.
      // Magnitude is configured on the battle_cry ability row (damage_reduction /
      // crit_reduction mechanic calcs) and applied server-side via buff flags.
      return;
    } else if (ability.type === 'dot_debuff') {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) { p.addLogEvent(buildErrorEvent(`You must be in combat to use Rend!`)); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLogEvent(buildErrorEvent(`No valid target for Rend.`)); return; }
      // Damage per tick, duration and interval are all configured on the
      // `rend` ability row (STR magnitude / DEX duration).
      const dmgPerTick = amountOf();
      // Dual-primary split: damage = STR (the wound), duration = DEX (precision keeps it open).
      const durationMs = durationOf();
      const intervalMs = intervalOf();
      p.buffSetters.setBleedStacks((prev: Record<string, DotDebuff>) => ({
        ...prev,
        [cTargetId]: {
          damagePerTick: dmgPerTick, intervalMs, expiresAt: Date.now() + durationMs,
          startsAt: Date.now() + intervalMs,
          creatureId: cTargetId, creatureName: creature.name,
          creatureLevel: creature.level, creatureRarity: creature.rarity,
          creatureLootTable: (creature.loot_table as any[]) || [],
          lootTableId: creature.loot_table_id ?? null, dropChance: creature.drop_chance ?? 0.5,
          creatureNodeId: creature.node_id ?? null,
          maxHp: creature.max_hp, lastKnownHp: p.creatureHpOverrides[creature.id] ?? creature.hp,
        },
      }));
      p.addLogEvent(buildDebuffEvent(`Rend! ${creature.name} bleeds every ${intervalMs / 1000}s for ${durationMs / 1000}s. [${dmgPerTick}/tick]`));
    } else if (ability.type === 'poison_buff') {
      if (p.buffState.poisonBuff && p.buffState.poisonBuff.expiresAt > Date.now()) {
        p.addLogEvent(buildErrorEvent(`Envenom is already active.`));
        return;
      }
      const durationMs = 300_000; // 5 minutes
      p.buffSetters.setPoisonBuff({ expiresAt: Date.now() + durationMs });
      p.addLogEvent(buildBuffEvent(`Envenom! Your weapons drip with poison for 5 minutes. (${p.character.cp ?? 0} CP consumed)`));
    } else if (ability.type === 'execute_attack') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'evasion_buff') {
      // Dual-primary (Assassin DEX+CHA): dodge magnitude = CHA (showmanship),
      // duration = DEX (footwork).
      const durationMs = durationOf();
      const dodgeChance = amountOf();
      p.buffSetters.setEvasionBuff({ dodgeChance, expiresAt: Date.now() + durationMs, source: 'cloak' as const });
      p.addLogEvent(buildBuffEvent(`Cloak of Shadows! ${Math.round(dodgeChance * 100)}% dodge chance for ${Math.round(durationMs / 1000)}s.`));
    } else if (ability.type === 'disengage_buff') {
      // Dual-primary (Ranger DEX+WIS): dodge duration = DEX, next-hit
      // bonus magnitude = WIS (calm aim after the leap).
      const dodgeDurationMs = durationOf();
      const nextHitDurationMs = 15000;
      const bonusMult = amountOf();
      p.buffSetters.setEvasionBuff({ dodgeChance: 1.0, expiresAt: Date.now() + dodgeDurationMs, source: 'disengage' as const });
      p.buffSetters.setDisengageNextHit({ bonusMult, expiresAt: Date.now() + nextHitDurationMs });
      const bonusPct = Math.round((bonusMult - 1) * 100);
      p.addLogEvent(buildBuffEvent(`Disengage! You leap back — dodging all attacks for ${Math.round(dodgeDurationMs / 1000)}s. Your next strike deals +${bonusPct}% bonus damage!`));
    } else if (ability.type === 'ignite_buff') {
      if (p.buffState.igniteBuff && p.buffState.igniteBuff.expiresAt > Date.now()) {
        p.addLogEvent(buildErrorEvent(`Ignite is already active.`));
        return;
      }
      const durationMs = 300_000; // 5 minutes
      p.buffSetters.setIgniteBuff({ expiresAt: Date.now() + durationMs });
      p.addLogEvent(buildBuffEvent(`Ignite! A shield of fireballs orbits you — each heartbeat in combat, an orb has a 40% chance to strike your target. Lasts 5 minutes. (${p.character.cp ?? 0} CP consumed)`));
    } else if (ability.type === 'ignite_consume') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'absorb_buff') {
      // Force Shield (legacy timed preview — stance toggle intercepts in practice).
      // Pool scales with WIS to match server authority (combat-tick) and the
      // ability description. INT shapes regen; WIS shapes the ward.
      const shieldHp = amountOf();
      const durationMs = durationOf();
      p.buffSetters.setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
      p.addLogEvent(buildBuffEvent(`Force Shield! An arcane ward wraps you for ${Math.round(durationMs / 1000)}s. [${shieldHp}]`));

    } else if (ability.type === 'party_regen') {
      // Dual-primary split:
      //   Healer (WIS+CON): heal/tick = WIS, duration = CON (stamina sustains the radiance).
      //   Bard   (CHA+INT): heal/tick = CHA, duration = INT (knowledge stretches the melody).
      const isHealer = p.character.class === 'healer';
      const healPerTick = amountOf();
      const durationMs = durationOf();
      p.buffSetters.setPartyRegenBuff({ healPerTick, expiresAt: Date.now() + durationMs, source: isHealer ? 'healer' : 'bard' });
      const who = p.party ? 'your party' : 'you';
      const abilityName = isHealer ? 'Purifying Light! Divine radiance' : 'Crescendo! A rising melody';
      p.addLogEvent(buildHealEvent(`${abilityName} heals ${who} every 3s for ${Math.round(durationMs / 1000)}s. [${healPerTick}/tick]`));
    } else if (ability.type === 'ally_absorb') {
      // Divine Aegis — dual-primary: pool = WIS, duration = CON (endurance keeps the ward up).
      const shieldHp = amountOf();
      const durationMs = durationOf();
      p.buffSetters.setAbsorbBuff({ shieldHp, shieldCap: shieldHp, expiresAt: Date.now() + durationMs });
      const durSec = Math.round(durationMs / 1000);
      if (targetId && targetId !== p.character.id) {
        const targetMember = p.partyMembers.find(m => m.character_id === targetId);
        const targetName = targetMember?.character.name || 'ally';
        p.addLogEvent(buildBuffEvent(`Divine Aegis! You shield ${targetName} for up to ${durSec}s. [${shieldHp}]`));
      } else {
        p.addLogEvent(buildBuffEvent(`Divine Aegis! An absorb shield wraps you for up to ${durSec}s. [${shieldHp}]`));
      }
    } else if (ability.type === 'sunder_debuff') {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) { p.addLogEvent(buildErrorEvent(`You must be in combat to use Sunder Armor!`)); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLogEvent(buildErrorEvent(`No valid target for Sunder Armor.`)); return; }
      // Soft-scaled utility magnitude: floor of 2, plus soft-scaled STR contribution.
      const acReduction = amountOf();

      // Dual-primary split: AC reduction = STR (crushing blow), duration = DEX (precise targeting lingers).
      const sunderDurationMs = durationOf();
      const durationSec = Math.round(sunderDurationMs / 1000);
      p.buffSetters.setSunderDebuff(prev => ({ ...prev, [cTargetId]: { acReduction, expiresAt: Date.now() + sunderDurationMs, creatureId: cTargetId, creatureName: creature.name } }));
      p.addLogEvent(buildDebuffEvent(`Sunder Armor! ${creature.name}'s AC reduced by ${acReduction} for ${durationSec}s.`));
    } else if (ability.type === 'burst_damage') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'reactive_holy') {
      // Templar — Holy Shield: 30s reactive holy retaliation.
      const wisMod = Math.max(0, getStatModifier(p.character.wis + (p.equipmentBonuses.wis || 0)));
      const durationMs = durationOf();
      p.buffSetters.setHolyShieldBuff({ wisMod, expiresAt: Date.now() + durationMs });
      p.addLogEvent(buildBuffEvent(`Holy Shield! Attackers will be burned by holy light for ${Math.round(durationMs / 1000)}s.`));
    } else if (ability.type === 'block_buff') {
      // Shield Wall is now a stance — handled at the stance toggle block above.
      // This branch should be unreachable; left as a no-op safety net.
    } else if (ability.type === 'consecrate') {
      // Templar — Consecrate: dual-primary — magnitude (heal/burn) = WIS, number of ticks scales with CON.
      const wisMod = Math.max(0, getStatModifier(p.character.wis + (p.equipmentBonuses.wis || 0)));
      const durationMs = durationOf();
      p.buffSetters.setConsecrateBuff({ wisMod, expiresAt: Date.now() + durationMs, durationMs });
      p.addLogEvent(buildHealEvent(`You consecrate the ground — hallowed light wells up beneath your feet for ${Math.round(durationMs / 1000)}s, mending allies and searing the unholy.`));
    } else if (ability.type === 'mitigation_buff') {
      // Templar — Divine Challenge: dual-primary (WIS magnitude / CON duration).
      const durationMs = durationOf();
      const flat = amountOf();
      p.buffSetters.setDivineChallengeBuff({ flat, expiresAt: Date.now() + durationMs });
      // Stage 9 — Divine Challenge is a taunt: the player forcing attention
      // onto themselves. Structured so presentation follows the actor, not the
      // ability emoji.
      const tauntEvent = buildTauntEvent(
        `Divine Challenge! You mitigate incoming blows for ${Math.round(durationMs / 1000)}s. [${flat}]`,
        { kind: 'player', id: p.character.id, name: p.character.name },
      );
      if (p.addLogEvent) p.addLogEvent(tauntEvent);
      else p.addLogEvent(buildAbilityEvent(tauntEvent.message));
    }
    // T0 damage abilities (fireball / power_strike / aimed_shot / backstab /
    // spell_attack) are resolved entirely server-side by combat-tick
    // via the queued pending_action above. No client branch needed.

    // Deduct CP — Envenom/Ignite drain all current CP
    const isAllCpAbility = ability.type === 'poison_buff' || ability.type === 'ignite_buff';
    const finalCpCost = isAllCpAbility ? (p.character.cp ?? 0) : ability.cpCost;
    const newCp = Math.max((p.character.cp ?? 0) - finalCpCost, 0);
    await p.updateCharacter({ cp: newCp });
    setLastUsedAbilityCost(finalCpCost);
  }, [p.isDead, p.character, p.updateCharacter, p.addLogEvent, p.party, p.partyMembers, p.inCombat, p.activeCombatCreatureId, p.creatures, p.equipmentBonuses, p.creatureHpOverrides, p.buffState.poisonStacks, p.buffState.igniteStacks, p.buffState.poisonBuff, p.buffState.igniteBuff, lastUsedAbilityCost]);

  // ── Attack ─────────────────────────────────────────────────────
  const handleAttack = useCallback((creatureId: string) => {
    if (p.isDead) return;
    p.startCombat(creatureId);
  }, [p.isDead, p.startCombat]);

  return {
    degradeEquipment,
    handleUseAbility, handleAttack,
    lastUsedAbilityCost,
  };
}
