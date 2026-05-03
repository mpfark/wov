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
import { ARCANE_SURGE_DAMAGE_BONUS_PCT } from '@/shared/formulas/combat';
import {
  getStanceForAbility,
  isStanceActive,
  isMutuallyExcluded,
  sumStanceReserved,
  getStanceReserveCost,
  type ReservedBuffsMap,
} from '@/features/combat/utils/stances';
import { getEffectiveMaxCp } from '@/lib/game-data';

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
  'fireball', 'power_strike', 'aimed_shot', 'backstab', 'smite', 'cutting_words',
]);

/** Flavour text for queued abilities */
function getQueueFlavour(ability: { label: string; emoji: string; type: string }, creatureName?: string): string {
  const target = creatureName || 'your target';
  switch (ability.type) {
    case 'self_heal': return `⏳ ${ability.emoji} You brace yourself and begin catching your breath...`;
    case 'heal': return `⏳ ${ability.emoji} You channel healing energy...`;
    case 'dot_debuff': return `⏳ ${ability.emoji} You look for an opportunity to rend ${target}...`;
    case 'multi_attack': return `⏳ ${ability.emoji} You nock multiple arrows...`;
    case 'execute_attack': return `⏳ ${ability.emoji} You line up a vicious strike on ${target}...`;
    case 'ignite_consume': return `⏳ ${ability.emoji} You gather the flames building on ${target}...`;
    case 'hp_transfer': return `⏳ ${ability.emoji} You begin channeling your life force...`;
    case 'burst_damage': return `⏳ ${ability.emoji} You draw breath for a devastating crescendo...`;
    case 'fireball': return `⏳ ${ability.emoji} You begin shaping a ball of arcane flame at ${target}...`;
    case 'power_strike': return `⏳ ${ability.emoji} You wind up a heavy strike at ${target}...`;
    case 'aimed_shot': return `⏳ ${ability.emoji} You take careful aim at ${target}...`;
    case 'backstab': return `⏳ ${ability.emoji} You slip into the shadows behind ${target}...`;
    case 'smite': return `⏳ ${ability.emoji} You call down divine light upon ${target}...`;
    case 'cutting_words': return `⏳ ${ability.emoji} You ready a barbed insult for ${target}...`;
    default: return `⏳ ${ability.emoji} ${ability.label}...`;
  }
}

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
  addLog: (msg: string) => void;
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
          p.addLog(`💔 Your ${item.item.name} shatters and its essence returns to its origin...`);
          await supabase.from('character_inventory').delete().eq('id', item.id);
        } else {
          p.addLog(`💔 Your ${item.item.name} has broken! Visit a blacksmith to repair it.`);
          await supabase.from('character_inventory').update({ current_durability: 0, equipped_slot: null, belt_slot: null } as any).eq('id', item.id);
        }
      } else {
        await supabase.from('character_inventory').update({ current_durability: newDur }).eq('id', item.id);
      }
    }
    p.fetchInventory();
  }, [p.equipped, p.addLog, p.fetchInventory]);

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
      p.addLog(`⚠️ ${ability.emoji} ${ability.label} unlocks at level ${ability.levelRequired}.`);
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
          p.addLog(`⚠️ ${ability.emoji} Failed to drop ${stanceDef.label}: ${error.message}`);
          return;
        }
        // Optimistically reflect the new reserved_buffs map immediately so the
        // CP bar / pip row updates without waiting for a full character refetch.
        p.updateCharacter({ reserved_buffs: (data as any) ?? {} } as any);
        p.addLog(`${ability.emoji} You drop ${stanceDef.label}. The reserved CP is not refunded — you must regenerate it.`);
        return;
      }

      if (isMutuallyExcluded(reservedBuffs, stanceDef.key)) {
        p.addLog(`⚠️ ${ability.emoji} You cannot maintain Ignite and Envenom at the same time.`);
        return;
      }

      const maxCp = getEffectiveMaxCp(p.character.level, p.character.wis, p.equipmentBonuses);
      const cost = getStanceReserveCost(stanceDef.tier, maxCp);
      const stanceReservedNow = sumStanceReserved(reservedBuffs);
      const usable = getAvailableCp(p.character.cp ?? 0, p.pendingCpCost ?? 0, stanceReservedNow);
      if (usable < cost) {
        p.addLog(`⚠️ Not enough usable CP to maintain ${stanceDef.label}! (${cost} CP needed, ${usable} available)`);
        return;
      }

      const { data, error } = await supabase.rpc('activate_stance', {
        p_character_id: p.character.id,
        p_stance_key: stanceDef.key,
        p_tier: stanceDef.tier,
      });
      if (error) {
        p.addLog(`⚠️ ${ability.emoji} Failed to activate ${stanceDef.label}: ${error.message}`);
        return;
      }
      // Optimistic reflect — RPC returns the full reserved_buffs map.
      p.updateCharacter({ reserved_buffs: (data as any) ?? {} } as any);
      p.addLog(`${ability.emoji} ${stanceDef.label} activated! Reserves ${cost} CP until you drop it.`);
      return;
    }

    const effectiveCpCost = ability.cpCost;
    const stanceReserved = sumStanceReserved((p.character as any).reserved_buffs);
    const availableCp = getAvailableCp(p.character.cp ?? 0, p.pendingCpCost ?? 0, stanceReserved);
    if (availableCp < effectiveCpCost) {
      p.addLog(`⚠️ Not enough CP for ${ability.label}! (${effectiveCpCost} CP needed, ${availableCp} available)`);
      return;
    }

    const isInstantBuff = INSTANT_BUFF_TYPES.has(ability.type);

    // Early combat check before queuing
    if (!isInstantBuff && !_fromTick && COMBAT_REQUIRED_TYPES.has(ability.type)) {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) {
        p.addLog(`${ability.emoji} You must be in combat to use ${ability.label}!`);
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
        p.addLog(`${ability.emoji} No target for ${ability.label}!`);
        return;
      }
      resolvedT0TargetId = cTargetId;
    }

    // Damage/heal abilities must be queued for the heartbeat tick
    if (!isInstantBuff && !_fromTick) {
      const queueTargetId = resolvedT0TargetId ?? targetId;
      p.queueAbility(abilityIndex, queueTargetId);
      const cTarget = queueTargetId ? p.creatures?.find(c => c.id === queueTargetId)
        : p.activeCombatCreatureId ? p.creatures?.find(c => c.id === p.activeCombatCreatureId) : undefined;
      p.addLog(getQueueFlavour(ability, cTarget?.name));
      return;
    }

    // ── Ability type switch ──
    if (ability.type === 'hp_transfer') {
      if (!targetId || targetId === p.character.id) {
        p.addLog(`${ability.emoji} You must target an ally to transfer health.`);
        return;
      }
      const wisMod = getStatModifier(p.character.wis);
      const transferAmount = Math.max(3, wisMod * 2 + Math.floor(p.character.level / 2));
      const maxTransfer = p.character.hp - 1;
      if (maxTransfer <= 0) { p.addLog(`${ability.emoji} You don't have enough HP to transfer!`); return; }
      const actualTransfer = Math.min(transferAmount, maxTransfer);
      await p.updateCharacter({ hp: p.character.hp - actualTransfer });
      const { data: restored, error } = await supabase.rpc('heal_party_member', {
        _healer_id: p.character.id, _target_id: targetId, _heal_amount: actualTransfer,
      });
      if (error) { p.addLog(`${ability.emoji} Failed to transfer health: ${error.message}`); return; }
      const targetMember = p.partyMembers.find(m => m.character_id === targetId);
      const targetName = targetMember?.character.name || 'ally';
      p.addLog(`${ability.emoji} ${p.character.name} sacrifices ${actualTransfer} HP to heal ${targetName} for ${restored ?? actualTransfer} HP!`);
    } else if (ability.type === 'heal') {
      const wisMod = getStatModifier(p.character.wis);
      const healAmount = Math.max(3, wisMod * 3 + p.character.level);
      const healEffMaxHp = getEffectiveMaxHp(p.character.class, p.character.con, p.character.level, p.equipmentBonuses);
      const newHp = Math.min(healEffMaxHp, p.character.hp + healAmount);
      const restored = newHp - p.character.hp;
      if (restored > 0) { await p.updateCharacter({ hp: newHp }); p.addLog(`${ability.emoji} You cast Heal and restore ${restored} HP!`); }
      else p.addLog(`${ability.emoji} You cast Heal but you're already at full health.`);
    } else if (ability.type === 'self_heal') {
      const conMod = getStatModifier(p.character.con);
      const healAmount = Math.max(3, conMod * 3 + p.character.level);
      const healEffMaxHp = getEffectiveMaxHp(p.character.class, p.character.con, p.character.level, p.equipmentBonuses);
      const newHp = Math.min(healEffMaxHp, p.character.hp + healAmount);
      const restored = newHp - p.character.hp;
      if (restored > 0) { await p.updateCharacter({ hp: newHp }); p.addLog(`${ability.emoji} You use Second Wind and recover ${restored} HP!`); }
      else p.addLog(`${ability.emoji} You use Second Wind but you're already at full health.`);
    } else if (ability.type === 'regen_buff') {
      // Inspire — additive flat HP/CP regen.
      // Magnitude scales with CHA (Bard's primary stat); duration scales with INT.
      // Recast policy: refresh the timer to the new duration; keep the
      // best-of HP/CP regen across the prior and new cast (never weakens an
      // active buff). Does not stack.
      const chaMod = Math.max(0, getStatModifier(p.character.cha + (p.equipmentBonuses.cha || 0)));
      const intMod = Math.max(0, getStatModifier(p.character.int + (p.equipmentBonuses.int || 0)));
      const newHp = Math.max(2, chaMod + 2);
      const newCp = Math.max(1, Math.ceil(chaMod / 2) + 1);
      const durationMs = Math.min(180_000, Math.max(60_000, 60_000 + intMod * 8_000));
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
        p.addLog(`${ability.emoji} ${p.character.name} renews the inspiring song! (+${mergedHp} HP & +${mergedCp} CP regen, ${durSec}s remaining)`);
      } else {
        p.addLog(`${ability.emoji} ${p.character.name} plays an inspiring song! (+${mergedHp} HP & +${mergedCp} CP regen for ${durSec}s)`);
      }
    } else if (ability.type === 'crit_buff') {
      const dexMod = getStatModifier(p.character.dex);
      const critBonus = Math.max(1, Math.min(dexMod, 5));
      p.buffSetters.setCritBuff({ bonus: critBonus, expiresAt: Date.now() + 30000 });
      p.addLog(`${ability.emoji} Eagle Eye! Your crit range is now ${20 - critBonus}-20 for 30s.`);
    } else if (ability.type === 'stealth_buff') {
      const dexMod = getStatModifier(p.character.dex);
      const durationMs = Math.min(15000 + dexMod * 1000, 25000);
      p.buffSetters.setStealthBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Shadowstep! You vanish into the shadows for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'damage_buff') {
      const intMod = getStatModifier(p.character.int);
      const durationMs = Math.min(25, 15 + intMod) * 1000;
      p.buffSetters.setDamageBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Arcane Surge! All your damage is amplified (+${ARCANE_SURGE_DAMAGE_BONUS_PCT}%) for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'multi_attack') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'root_debuff') {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) { p.addLog(`${ability.emoji} You must be in combat to use ${ability.label}!`); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLog(`${ability.emoji} No valid target for ${ability.label}.`); return; }
      const wisMod = getStatModifier(p.character.wis);
      const durationMs = Math.min(15000, 8000 + wisMod * 1000);
      const reduction = 0.3;
      p.buffSetters.setRootDebuff({ damageReduction: reduction, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} ${ability.label}! ${creature.name}'s damage reduced by ${Math.round(reduction * 100)}% for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'battle_cry') {
      const dexMod = getStatModifier(p.character.dex + (p.equipmentBonuses.dex || 0));
      const hasShield = p.equipped.some((e: any) => e.item?.weapon_tag === 'shield');
      const baseDR = 0.15;
      const shieldBonus = hasShield ? 0.05 : 0;
      const totalDR = baseDR + shieldBonus;
      const critReduction = 0.15;
      const durationMs = Math.min(25000, 15000 + dexMod * 1000);
      p.buffSetters.setBattleCryBuff({ damageReduction: totalDR, critReduction, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Battle Cry! ${Math.round(totalDR * 100)}% damage reduction${hasShield ? ' (shield bonus!)' : ''} for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'dot_debuff') {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) { p.addLog(`${ability.emoji} You must be in combat to use Rend!`); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLog(`${ability.emoji} No valid target for Rend.`); return; }
      const strMod = getStatModifier(p.character.str + (p.equipmentBonuses.str || 0));
      const dmgPerTick = Math.max(1, Math.floor((strMod * 1.5 + 2) * 0.67));
      const durationMs = Math.min(30000, 20000 + strMod * 1000);
      const intervalMs = 2000;
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
      p.addLog(`${ability.emoji} Rend! ${creature.name} bleeds for ${dmgPerTick} damage every ${intervalMs / 1000}s for ${durationMs / 1000}s.`);
    } else if (ability.type === 'poison_buff') {
      if (p.buffState.poisonBuff && p.buffState.poisonBuff.expiresAt > Date.now()) {
        p.addLog(`⚠️ ${ability.emoji} Envenom is already active.`);
        return;
      }
      const durationMs = 300_000; // 5 minutes
      p.buffSetters.setPoisonBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Envenom! Your weapons drip with poison for 5 minutes. (${p.character.cp ?? 0} CP consumed)`);
    } else if (ability.type === 'execute_attack') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'evasion_buff') {
      const dexMod = getStatModifier(p.character.dex + (p.equipmentBonuses.dex || 0));
      const durationMs = Math.min(15000, 10000 + dexMod * 500);
      p.buffSetters.setEvasionBuff({ dodgeChance: 0.5, expiresAt: Date.now() + durationMs, source: 'cloak' as const });
      p.addLog(`${ability.emoji} Cloak of Shadows! 50% dodge chance for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'disengage_buff') {
      const dexMod = getStatModifier(p.character.dex + (p.equipmentBonuses.dex || 0));
      const dodgeDurationMs = Math.min(8000, 5000 + dexMod * 500);
      const nextHitDurationMs = 15000;
      p.buffSetters.setEvasionBuff({ dodgeChance: 1.0, expiresAt: Date.now() + dodgeDurationMs, source: 'disengage' as const });
      p.buffSetters.setDisengageNextHit({ bonusMult: 1.5, expiresAt: Date.now() + nextHitDurationMs });
      p.addLog(`${ability.emoji} Disengage! You leap back — dodging all attacks for ${Math.round(dodgeDurationMs / 1000)}s. Your next strike deals 50% bonus damage!`);
    } else if (ability.type === 'ignite_buff') {
      if (p.buffState.igniteBuff && p.buffState.igniteBuff.expiresAt > Date.now()) {
        p.addLog(`⚠️ ${ability.emoji} Ignite is already active.`);
        return;
      }
      const durationMs = 300_000; // 5 minutes
      p.buffSetters.setIgniteBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Ignite! A shield of fireballs orbits you — each heartbeat in combat, an orb has a 40% chance to strike your target. Lasts 5 minutes. (${p.character.cp ?? 0} CP consumed)`);
    } else if (ability.type === 'ignite_consume') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'absorb_buff') {
      const intMod = getStatModifier(p.character.int + (p.equipmentBonuses.int || 0));
      const shieldHp = intMod + Math.floor(p.character.level * 0.5);
      const durationMs = Math.min(15000, 8000 + intMod * 1000);
      p.buffSetters.setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Force Shield! Absorb shield with ${shieldHp} HP for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'party_regen') {
      const scaleStat = p.character.class === 'healer'
        ? getStatModifier(p.character.wis + (p.equipmentBonuses.wis || 0))
        : getStatModifier(p.character.cha + (p.equipmentBonuses.cha || 0));
      const healPerTick = Math.max(1, scaleStat + 2);
      const durationMs = Math.min(25000, 15000 + scaleStat * 1000);
      p.buffSetters.setPartyRegenBuff({ healPerTick, expiresAt: Date.now() + durationMs, source: p.character.class === 'healer' ? 'healer' : 'bard' });
      const who = p.party ? 'your party' : 'you';
      const abilityName = p.character.class === 'healer' ? 'Purifying Light! Divine radiance' : 'Crescendo! A rising melody';
      p.addLog(`${ability.emoji} ${abilityName} heals ${who} for ${healPerTick} HP every 3s for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'ally_absorb') {
      // Divine Aegis — no timer; ward persists until fully absorbed.
      const wisMod = getStatModifier(p.character.wis + (p.equipmentBonuses.wis || 0));
      const shieldHp = wisMod * 2 + Math.floor(p.character.level * 0.7);
      const NO_EXPIRY = Number.MAX_SAFE_INTEGER;
      p.buffSetters.setAbsorbBuff({ shieldHp, shieldCap: shieldHp, expiresAt: NO_EXPIRY });
      if (targetId && targetId !== p.character.id) {
        const targetMember = p.partyMembers.find(m => m.character_id === targetId);
        const targetName = targetMember?.character.name || 'ally';
        p.addLog(`${ability.emoji} Divine Aegis! You shield ${targetName} with ${shieldHp} HP — lasts until absorbed.`);
      } else {
        p.addLog(`${ability.emoji} Divine Aegis! Absorb shield with ${shieldHp} HP — lasts until absorbed.`);
      }
    } else if (ability.type === 'sunder_debuff') {
      const cTargetId = resolveCreatureTarget(p.creatures, p.activeCombatCreatureId, targetId);
      if (!p.inCombat || !cTargetId) { p.addLog(`${ability.emoji} You must be in combat to use Sunder Armor!`); return; }
      const creature = p.creatures.find(c => c.id === cTargetId);
      if (!creature || !creature.is_alive || creature.hp <= 0) { p.addLog(`${ability.emoji} No valid target for Sunder Armor.`); return; }
      const strMod = getStatModifier(p.character.str + (p.equipmentBonuses.str || 0));
      const acReduction = Math.max(2, strMod);
      const durationSec = Math.min(20, 12 + strMod);
      p.buffSetters.setSunderDebuff(prev => ({ ...prev, [cTargetId]: { acReduction, expiresAt: Date.now() + durationSec * 1000, creatureId: cTargetId, creatureName: creature.name } }));
      p.addLog(`${ability.emoji} Sunder Armor! ${creature.name}'s AC reduced by ${acReduction} for ${durationSec}s.`);
    } else if (ability.type === 'burst_damage') {
      // Processed server-side via combat-tick heartbeat
    } else if (ability.type === 'reactive_holy') {
      // Templar — Holy Shield: 30s reactive holy retaliation.
      const wisMod = Math.max(0, getStatModifier(p.character.wis + (p.equipmentBonuses.wis || 0)));
      const durationMs = 30_000;
      p.buffSetters.setHolyShieldBuff({ wisMod, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Holy Shield! Attackers will be burned by holy light for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'block_buff') {
      // Templar — Shield Wall: 100% block for ~4s. Requires shield.
      const hasShield = p.equipped.some((e: any) => e.item?.weapon_tag === 'shield');
      if (!hasShield) {
        p.addLog(`${ability.emoji} Shield Wall requires a shield equipped!`);
        return;
      }
      const durationMs = 4_000;
      p.buffSetters.setShieldWallBuff({ expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Shield Wall! You brace behind your shield — all incoming attacks blocked for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'consecrate') {
      // Templar — Consecrate: 3 ticks (~6s) of node heal + creature burn.
      const wisMod = Math.max(0, getStatModifier(p.character.wis + (p.equipmentBonuses.wis || 0)));
      const durationMs = 6_000;
      p.buffSetters.setConsecrateBuff({ wisMod, expiresAt: Date.now() + durationMs, durationMs });
      p.addLog(`${ability.emoji} Consecrate! Holy ground sanctified for ${Math.round(durationMs / 1000)}s — allies healed, enemies burned.`);
    } else if (ability.type === 'mitigation_buff') {
      // Templar — Divine Challenge: 30s flat 30% damage reduction.
      const durationMs = 30_000;
      p.buffSetters.setDivineChallengeBuff({ reduction: 0.30, expiresAt: Date.now() + durationMs });
      p.addLog(`${ability.emoji} Divine Challenge! You take 30% less damage from all sources for ${Math.round(durationMs / 1000)}s.`);
    }
    // T0 damage abilities (fireball / power_strike / aimed_shot / backstab /
    // smite / cutting_words) are resolved entirely server-side by combat-tick
    // via the queued pending_action above. No client branch needed.

    // Deduct CP — Envenom/Ignite drain all current CP
    const isAllCpAbility = ability.type === 'poison_buff' || ability.type === 'ignite_buff';
    const finalCpCost = isAllCpAbility ? (p.character.cp ?? 0) : ability.cpCost;
    const newCp = Math.max((p.character.cp ?? 0) - finalCpCost, 0);
    await p.updateCharacter({ cp: newCp });
    setLastUsedAbilityCost(finalCpCost);
  }, [p.isDead, p.character, p.updateCharacter, p.addLog, p.party, p.partyMembers, p.inCombat, p.activeCombatCreatureId, p.creatures, p.equipmentBonuses, p.creatureHpOverrides, p.buffState.poisonStacks, p.buffState.igniteStacks, p.buffState.poisonBuff, p.buffState.igniteBuff, lastUsedAbilityCost]);

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
