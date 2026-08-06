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
  resolveStanceForAbility,
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
  'party_regen', 'control_debuff', 'root_debuff', 'sunder_debuff', 'ally_absorb',
  // Templar instant buffs (non-stance)
  'aura_pulse',
]);

/**
 * Mechanics shared by a stance and a non-stance ability (Consolidation Phase 6:
 * Force Shield vs Divine Aegis on `absorb_buff`). They resolve instantly only
 * when the cast ability is *not* a stance, so the stance path stays exclusive.
 */
const INSTANT_WHEN_NOT_STANCE = new Set(['absorb_buff', 'mitigation_buff']);

/** Ability types that require being in combat with a valid target */
const COMBAT_REQUIRED_TYPES = new Set([
  'multi_attack', 'dot_debuff', 'stack_consume', 'execute_attack', 'ignite_consume',
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
    const stanceDef = resolveStanceForAbility(ability);
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

    const isInstantBuff = INSTANT_BUFF_TYPES.has(ability.type)
      // `stanceDef` is null here (the stance branch above returns), so a shared
      // mechanic reaching this point is the non-stance variant.
      || INSTANT_WHEN_NOT_STANCE.has(ability.type);

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
      // Consolidation Group I: ONE reusable life-sacrifice heal. The sacrificed
      // amount is `amount_calc`, the safety floor the named `reserve_hp` calc
      // (never below `effect_config.min_reserve_hp`), and both lines are
      // authored — Transfer Health is the Healer identity of this base.
      if (!targetId || targetId === p.character.id) {
        p.addLogEvent(buildHealEvent(`You must target an ally to transfer health.`));
        return;
      }
      const transferCfg = (ability.effectConfig || {}) as Record<string, unknown>;
      const minReserve = typeof transferCfg.min_reserve_hp === 'number'
        ? Math.max(0, Math.floor(transferCfg.min_reserve_hp))
        : 1;
      const transferAmount = amountOf();
      const reserveHp = Math.max(minReserve, Math.floor(mechanicOf('reserve_hp', minReserve)));
      const maxTransfer = p.character.hp - reserveHp;
      const transferText = getAuthoredCombatText(ability.abilityKey);
      if (maxTransfer <= 0) {
        const noHpTpl = transferText.no_hp_text;
        const noHpLine = typeof noHpTpl === 'string' && noHpTpl.trim()
          ? noHpTpl.trim()
          : "You don't have enough HP to transfer! (need to keep {reserve} HP)";
        p.addLogEvent(buildErrorEvent(
          noHpLine
            .replace(/\{ability\}/g, ability.label)
            .replace(/\{reserve\}/g, String(reserveHp)),
        ));
        return;
      }
      const actualTransfer = Math.min(transferAmount, maxTransfer);
      await p.updateCharacter({ hp: p.character.hp - actualTransfer });
      const { data: restored, error } = await supabase.rpc('heal_party_member', {
        _healer_id: p.character.id, _target_id: targetId, _heal_amount: actualTransfer,
      });
      if (error) { p.addLogEvent(buildErrorEvent(`Failed to transfer health: ${error.message}`)); return; }
      const targetMember = p.partyMembers.find(m => m.character_id === targetId);
      const targetName = targetMember?.character.name || 'ally';
      // The wording is authored on the ability row (`combat_text.transfer_text`),
      // never hardcoded per class.
      const transferTpl = transferText.transfer_text;
      const transferLine = typeof transferTpl === 'string' && transferTpl.trim()
        ? transferTpl.trim()
        : '{caster} sacrifices life to heal {target}!';
      p.addLogEvent(buildHealEvent(
        `${transferLine
          .replace(/\{caster\}/g, p.character.name)
          .replace(/\{target\}/g, targetName)
          .replace(/\{ability\}/g, ability.label)} [${restored ?? actualTransfer}]`,
      ));

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
      // Consolidation Group I: ONE reusable additive HP/CP regen buff. The
      // magnitudes come from `amount_calc` / `mechanic_calcs.cp_per_tick`, the
      // duration from `duration_calc`, how a recast merges with a live buff from
      // `effect_config.refresh_policy` and the wording from authored
      // `combat_text` (`activate_text` / `renew_text`) — Inspire is the Bard
      // identity of this base.
      const regenCfg = (ability.effectConfig || {}) as Record<string, unknown>;
      const minCp = typeof regenCfg.min_cp_per_tick === 'number'
        ? Math.max(0, Math.floor(regenCfg.min_cp_per_tick))
        : 1;
      // 'best_of' never weakens a live buff; 'replace' always takes the new cast.
      const refreshPolicy = typeof regenCfg.refresh_policy === 'string' && regenCfg.refresh_policy.trim()
        ? regenCfg.refresh_policy.trim()
        : 'best_of';
      const newHp = amountOf();
      // CP regen per tick is the configured `cp_per_tick` mechanic calc.
      const newCp = Math.max(minCp, Math.ceil(mechanicOf('cp_per_tick', minCp)));
      const durationMs = durationOf();
      const now = Date.now();
      const prev = p.buffState.inspireBuff;
      const wasActive = !!(prev && prev.expiresAt > now);
      const keepBest = wasActive && refreshPolicy === 'best_of';
      const mergedHp = keepBest ? Math.max(prev!.hpPerTick, newHp) : newHp;
      const mergedCp = keepBest ? Math.max(prev!.cpPerTick, newCp) : newCp;

      p.buffSetters.setInspireBuff({
        hpPerTick: mergedHp,
        cpPerTick: mergedCp,
        expiresAt: now + durationMs,
        durationMs,
        casterId: p.character.id,
      });
      const durSec = Math.round(durationMs / 1000);
      const regenText = getAuthoredCombatText(ability.abilityKey);
      const regenTpl = regenText[wasActive ? 'renew_text' : 'activate_text'];
      const regenLine = typeof regenTpl === 'string' && regenTpl.trim()
        ? regenTpl.trim()
        : wasActive
          ? '{caster} renews {ability}! ({seconds}s remaining)'
          : '{caster} sustains {ability} for {seconds}s!';
      p.addLogEvent(buildBuffEvent(
        `${regenLine
          .replace(/\{caster\}/g, p.character.name)
          .replace(/\{ability\}/g, ability.label)
          .replace(/\{seconds\}/g, String(durSec))} [+${mergedHp}HP +${mergedCp}CP]`,
      ));
    } else if (ability.type === 'offense_buff' || ability.type === 'crit_buff' || ability.type === 'damage_buff') {
      // Consolidation Group F: ONE offensive self-buff. Whether it widens the
      // crit range or amplifies damage is configuration
      // (`effect_config.offense_mode`), and the wording is authored — Eagle Eye
      // and Arcane Surge are identities of the same base. Both ship as stances,
      // so this path only runs for a timed (non-stance) variant.
      const cfg = (ability.effectConfig || {}) as Record<string, unknown>;
      const mode = typeof cfg.offense_mode === 'string' && cfg.offense_mode.trim()
        ? cfg.offense_mode.trim()
        : ability.type === 'damage_buff' ? 'damage_mult' : 'crit_edge';
      const magnitude = amountOf();
      const durationMs = durationOf();
      const seconds = Math.round(durationMs / 1000);
      const authoredLine = getAuthoredCombatText(ability.abilityKey).activate_text;
      if (mode === 'damage_mult') {
        p.buffSetters.setDamageBuff({ expiresAt: Date.now() + durationMs, abilityKey: ability.abilityKey });
        const line = typeof authoredLine === 'string' && authoredLine.trim()
          ? authoredLine
              .replace(/\{mult\}/g, magnitude.toFixed(2))
              .replace(/\{seconds\}/g, String(seconds))
          : `${ability.label}! Your damage is amplified (x${magnitude.toFixed(2)}) for ${seconds}s.`;
        p.addLogEvent(buildBuffEvent(line));
      } else {
        p.buffSetters.setCritBuff({ bonus: magnitude, expiresAt: Date.now() + durationMs });
        const line = typeof authoredLine === 'string' && authoredLine.trim()
          ? authoredLine
              .replace(/\{crit_low\}/g, String(20 - magnitude))
              .replace(/\{seconds\}/g, String(seconds))
          : `${ability.label}! Your crit range is now ${20 - magnitude}-20 for ${seconds}s.`;
        p.addLogEvent(buildBuffEvent(line));
      }
    } else if (ability.type === 'stealth_buff') {
      // Consolidation Group G: ONE reusable stealth buff. Duration and ambush
      // multiplier come from the configured calcs, wording from authored
      // `combat_text.activate_text` — Shadowstep is the Assassin identity.
      const durationMs = durationOf();
      const ambushMult = amountOf();
      p.buffSetters.setStealthBuff({ expiresAt: Date.now() + durationMs, mult: ambushMult });
      const stealthTpl = getAuthoredCombatText(ability.abilityKey).activate_text;
      const stealthLine = typeof stealthTpl === 'string' && stealthTpl.trim()
        ? stealthTpl.trim()
        : '{ability}! You vanish into the shadows for {seconds}s (ambush x{mult}).';
      p.addLogEvent(buildBuffEvent(
        stealthLine
          .replace(/\{ability\}/g, ability.label)
          .replace(/\{seconds\}/g, String(Math.round(durationMs / 1000)))
          .replace(/\{mult\}/g, ambushMult.toFixed(2)),
      ));
    } else if (ability.type === 'multi_attack') {
      // Processed server-side via combat-tick heartbeat
    } else if (
      ability.type === 'control_debuff'
      || ability.type === 'root_debuff'
      || ability.type === 'sunder_debuff'
    ) {
      // Consolidation Group H: ONE reusable control debuff. Whether it saps the
      // target's outgoing damage or shears its armour comes from
      // `effect_config.control_mode`; the scaling attributes live on the row's
      // calcs and the wording is authored `combat_text.activate_text`.
      // Nature's Snare, Dissonance and Sunder Armor are class identities here.
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) { p.addLogEvent(buildErrorEvent(`You must be in combat to use ${ability.label}!`)); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLogEvent(buildErrorEvent(`No valid target for ${ability.label}.`)); return; }
      const controlCfg = (ability.effectConfig || {}) as Record<string, unknown>;
      const controlMode = typeof controlCfg.control_mode === 'string' && controlCfg.control_mode.trim()
        ? controlCfg.control_mode.trim()
        // Legacy rows carry no mode: the retired mechanic key decides.
        : (ability.type === 'sunder_debuff' ? 'ac_reduction' : 'damage_reduction');
      const durationMs = durationOf();
      const magnitude = amountOf();
      const seconds = Math.round(durationMs / 1000);

      if (controlMode === 'ac_reduction') {
        p.buffSetters.setSunderDebuff(prev => ({
          ...prev,
          [cTargetId]: { acReduction: magnitude, expiresAt: Date.now() + durationMs, creatureId: cTargetId, creatureName: creature.name },
        }));
      } else {
        p.buffSetters.setRootDebuff({ damageReduction: magnitude, expiresAt: Date.now() + durationMs, creatureId: cTargetId });
      }

      const controlTpl = getAuthoredCombatText(ability.abilityKey).activate_text;
      const controlLine = typeof controlTpl === 'string' && controlTpl.trim()
        ? controlTpl.trim()
        : controlMode === 'ac_reduction'
          ? "{ability}! {target}'s AC reduced by {amount} for {seconds}s."
          : "{ability}! {target}'s damage reduced by {pct}% for {seconds}s.";
      p.addLogEvent(buildDebuffEvent(
        controlLine
          .replace(/\{ability\}/g, ability.label)
          .replace(/\{target\}/g, creature.name)
          .replace(/\{amount\}/g, String(magnitude))
          .replace(/\{pct\}/g, String(Math.round(magnitude * 100)))
          .replace(/\{seconds\}/g, String(seconds)),
      ));
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
    } else if (ability.type === 'stack_apply' || ability.type === 'poison_buff' || ability.type === 'ignite_buff') {
      // Consolidation Group D: ONE stance that applies stacks. Which persistent
      // effect it feeds (`effect_config.effect_type`) picks the local stack
      // tracker, and the activation line is authored — Envenom and Orbs of Fire
      // are configuration, not branches. (Legacy types stay matched so archived
      // assignments still resolve.)
      const cfg = (ability.effectConfig || {}) as Record<string, unknown>;
      const effectType = typeof cfg.effect_type === 'string' && cfg.effect_type.trim()
        ? cfg.effect_type.trim()
        : (ability.type === 'ignite_buff' ? 'ignite' : 'poison');
      const isIgnite = effectType === 'ignite';
      const existing = isIgnite ? p.buffState.igniteBuff : p.buffState.poisonBuff;
      if (existing && existing.expiresAt > Date.now()) {
        p.addLogEvent(buildErrorEvent(`${ability.label} is already active.`));
        return;
      }
      const durationMs = 300_000; // 5 minutes
      const next = { expiresAt: Date.now() + durationMs, abilityKey: ability.abilityKey };
      if (isIgnite) p.buffSetters.setIgniteBuff(next);
      else p.buffSetters.setPoisonBuff(next);
      const text = getAuthoredCombatText(ability.abilityKey);
      const authored = typeof text.activate_text === 'string' && text.activate_text.trim()
        ? text.activate_text.trim()
        : `${ability.label}! Active for 5 minutes.`;
      p.addLogEvent(buildBuffEvent(`${authored} (${p.character.cp ?? 0} CP consumed)`));

    } else if (ability.type === 'stack_consume' || ability.type === 'execute_attack' || ability.type === 'ignite_consume') {
      // Consolidation Group D: stack finishers (Eviscerate / Conflagrate) run
      // entirely server-side in the combat-tick heartbeat.
    } else if (ability.type === 'evasion_buff' || ability.type === 'disengage_buff') {
      // Consolidation Group E: ONE reusable evasion buff. Whether the dodge
      // chance comes from the calc (Cloak of Shadows: CHA magnitude) or is a
      // configured certainty with a next-hit damage window (Disengage: DEX
      // duration, WIS next-hit bonus) is `effect_config`, not a class branch.
      // Wording comes from authored `combat_text.activate_text`.
      // (`disengage_buff` stays matched so archived assignments still resolve.)
      const cfg = (ability.effectConfig || {}) as Record<string, unknown>;
      const configuredDodge = typeof cfg.dodge_chance === 'number' ? cfg.dodge_chance : null;
      const nextHitWindowMs = typeof cfg.next_hit_window_ms === 'number' ? cfg.next_hit_window_ms : 0;
      const source = cfg.evasion_source === 'disengage' || ability.type === 'disengage_buff'
        ? ('disengage' as const)
        : ('cloak' as const);
      const durationMs = durationOf();
      const amount = amountOf();
      // With a configured dodge certainty the calc amount is the next-hit
      // multiplier; otherwise the calc amount IS the dodge chance.
      const dodgeChance = configuredDodge ?? amount;
      const bonusMult = configuredDodge != null ? amount : 1;
      p.buffSetters.setEvasionBuff({ dodgeChance, expiresAt: Date.now() + durationMs, source });
      if (nextHitWindowMs > 0 && bonusMult > 1) {
        p.buffSetters.setDisengageNextHit({ bonusMult, expiresAt: Date.now() + nextHitWindowMs });
      }
      const text = getAuthoredCombatText(ability.abilityKey);
      const raw = typeof text.activate_text === 'string' && text.activate_text.trim()
        ? text.activate_text.trim()
        : `${ability.label}! {dodge_pct}% dodge chance for {seconds}s.`;
      p.addLogEvent(buildBuffEvent(raw
        .replace('{dodge_pct}', String(Math.round(dodgeChance * 100)))
        .replace('{seconds}', String(Math.round(durationMs / 1000)))
        .replace('{bonus_pct}', String(Math.round((bonusMult - 1) * 100)))));
      // (Orbs of Fire is handled by the consolidated `stack_apply` branch above.)



    } else if (ability.type === 'absorb_buff' || ability.type === 'ally_absorb') {
      // Consolidation Phase 6: Force Shield and Divine Aegis share the one
      // `absorb_buff` base. Pool = primary attribute, duration = secondary, both
      // configured. Whether the ward can land on an ally is the row's
      // `target_type`, and the wording comes from authored `combat_text` —
      // never a per-class branch. (`ally_absorb` stays matched so archived
      // assignments still resolve.)
      const shieldHp = amountOf();
      const durationMs = durationOf();
      const allyCast = ability.targetType === 'ally' || ability.targetType === 'party';
      p.buffSetters.setAbsorbBuff(
        allyCast
          ? { shieldHp, shieldCap: shieldHp, expiresAt: Date.now() + durationMs }
          : { shieldHp, expiresAt: Date.now() + durationMs },
      );
      const text = getAuthoredCombatText(ability.abilityKey);
      const authored = (key: string): string | null => {
        const raw = text[key];
        return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
      };
      const seconds = Math.round(durationMs / 1000);
      const otherTarget = allyCast && targetId && targetId !== p.character.id ? targetId : null;
      const targetName = otherTarget
        ? (p.partyMembers.find(m => m.character_id === otherTarget)?.character.name || 'ally')
        : null;
      const line = (targetName
        ? (authored('ally_text') ?? `${ability.label}! You shield {target} for up to {seconds}s.`)
        : (authored('self_text') ?? `${ability.label}! An absorb shield wraps you for {seconds}s.`))
        .replace('{target}', targetName ?? 'you')
        .replace('{seconds}', String(seconds));
      p.addLogEvent(buildBuffEvent(`${line} [${shieldHp}]`));

    } else if (ability.type === 'party_regen') {
      // Consolidation Phase 5: Purifying Light and Crescendo share the one
      // `party_regen` base. Attributes come from the configured calcs (primary =
      // heal/tick, secondary = duration) and the wording from authored
      // `combat_text` keyed by ability identity — never a per-class branch.
      const healPerTick = amountOf();
      const durationMs = durationOf();
      const text = getAuthoredCombatText(ability.abilityKey);
      const authored = (key: string): string | null => {
        const raw = text[key];
        return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
      };
      const who = p.party ? 'your party' : 'you';
      const seconds = Math.round(durationMs / 1000);
      const tickText = authored('tick_text') ?? `${ability.label} heals {who} for {amount} HP!`;
      p.buffSetters.setPartyRegenBuff({
        healPerTick,
        expiresAt: Date.now() + durationMs,
        source: ability.abilityKey,
        abilityKey: ability.abilityKey,
        label: ability.label,
        durationMs,
        tickText,
      });
      const castLine = (authored('cast_text')
        ?? `${ability.label}! Healing energy mends {who} every 3s for {seconds}s.`)
        .replace('{who}', who)
        .replace('{seconds}', String(seconds));
      p.addLogEvent(buildHealEvent(`${castLine} [${healPerTick}/tick]`));
    } else if (ability.type === 'burst_damage') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'reactive_holy') {
      // Consolidation Group G: timed (non-stance) variant of the reactive
      // retaliation base. The magnitude attribute comes from
      // `effect_config.magnitude_stat`; wording is authored.
      const reactiveCfg = (ability.effectConfig || {}) as Record<string, unknown>;
      const magStat = typeof reactiveCfg.magnitude_stat === 'string' && reactiveCfg.magnitude_stat.trim()
        ? reactiveCfg.magnitude_stat.trim() : 'wis';
      const statTotal = ((p.character as unknown as Record<string, number>)[magStat] ?? 10)
        + (((p.equipmentBonuses as unknown as Record<string, number>)[magStat]) || 0);
      const wisMod = Math.max(0, getStatModifier(statTotal));
      const durationMs = durationOf();
      p.buffSetters.setHolyShieldBuff({ wisMod, expiresAt: Date.now() + durationMs });
      const reactiveTpl = getAuthoredCombatText(ability.abilityKey).activate_text;
      const reactiveLine = typeof reactiveTpl === 'string' && reactiveTpl.trim()
        ? reactiveTpl.trim()
        : '{ability}! Attackers will be burned in return for {seconds}s.';
      p.addLogEvent(buildBuffEvent(
        reactiveLine
          .replace(/\{ability\}/g, ability.label)
          .replace(/\{seconds\}/g, String(Math.round(durationMs / 1000))),
      ));
    } else if (ability.type === 'block_buff') {
      // Shield Wall is now a stance — handled at the stance toggle block above.
      // This branch should be unreachable; left as a no-op safety net.
    } else if (ability.type === 'aura_pulse') {
      // Consolidated node aura (Group D). Which attribute drives the pulse and
      // the authored cast wording both come from config, so any class can bind
      // its own aura to this base — Consecrate is just the Templar identity.
      const cfg = (ability.effectConfig || {}) as Record<string, unknown>;
      const statKey = typeof cfg.magnitude_stat === 'string' ? cfg.magnitude_stat : 'wis';
      const statRaw = (p.character as unknown as Record<string, number>)[statKey] ?? 10;
      const statBonus = (p.equipmentBonuses as unknown as Record<string, number>)[statKey] ?? 0;
      const magMod = Math.max(0, getStatModifier(statRaw + statBonus));
      const durationMs = durationOf();
      p.buffSetters.setConsecrateBuff({
        wisMod: magMod, expiresAt: Date.now() + durationMs, durationMs,
        abilityKey: ability.abilityKey,
      });
      const authored = (ability.combatText || {}) as Record<string, unknown>;
      const castText = typeof authored.cast_text === 'string'
        ? authored.cast_text.replace('{duration}', String(Math.round(durationMs / 1000)))
        : `${ability.label}! Hallowed ground wells up beneath your feet for ${Math.round(durationMs / 1000)}s.`;
      p.addLogEvent(buildHealEvent(castText));
    } else if (ability.type === 'mitigation_buff' || ability.type === 'battle_cry') {
      // Consolidation Group D: ONE mitigation base. Percent mode (Battle Cry)
      // is a stance and is intercepted above, so anything reaching here is the
      // timed flat variant; whether it taunts and how it reads are config.
      const cfg = (ability.effectConfig || {}) as Record<string, unknown>;
      if (cfg.mitigation_mode === 'percent') return;
      const durationMs = durationOf();
      const flat = amountOf();
      const authored = (ability.combatText || {}) as Record<string, unknown>;
      p.buffSetters.setDivineChallengeBuff({
        flat, expiresAt: Date.now() + durationMs,
        ...(typeof authored.mitigate_text === 'string' ? { text: authored.mitigate_text } : {}),
      });
      const seconds = String(Math.round(durationMs / 1000));
      const message = typeof authored.self_text === 'string'
        ? authored.self_text.replace('{seconds}', seconds).replace('{amount}', String(flat))
        : `${ability.label}! You mitigate incoming blows for ${seconds}s. [${flat}]`;
      // A mitigation buff only reads as a taunt when it is configured as one.
      const event = cfg.is_taunt === true
        ? buildTauntEvent(message, { kind: 'player', id: p.character.id, name: p.character.name })
        : buildBuffEvent(message);
      if (p.addLogEvent) p.addLogEvent(event);
      else p.addLogEvent(buildAbilityEvent(event.message));
    }
    // T0 damage abilities (fireball / power_strike / aimed_shot / backstab /
    // spell_attack) are resolved entirely server-side by combat-tick
    // via the queued pending_action above. No client branch needed.

    // Deduct CP — "consumes all CP" is configuration (`effect_config`), not a
    // per-class mechanic check, so the consolidated stack appliers keep the
    // drain-everything cost of Envenom / Orbs of Fire.
    const consumesAllCp = ((ability.effectConfig || {}) as Record<string, unknown>).consumes_all_cp === true
      || ability.type === 'poison_buff' || ability.type === 'ignite_buff';
    const finalCpCost = consumesAllCp ? (p.character.cp ?? 0) : ability.cpCost;

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
