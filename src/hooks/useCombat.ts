import { useState, useCallback, useEffect, useRef } from 'react';
import { Character } from '@/hooks/useCharacter';
import { Creature } from '@/hooks/useCreatures';
import {
  rollD20, getStatModifier, getXpForLevel, getWisDodgeChance,
  getChaGoldMultiplier, CLASS_LEVEL_BONUSES, CLASS_LABELS,
  resolveAttackRoll, applyOffensiveBuffs, applyDefensiveBuffs,
  rollCreatureDamage, calculateKillRewards,
  AttackContext,
} from '@/lib/combat-math';
import { getMaxCp, getMaxHp } from '@/lib/game-data';
import { CLASS_COMBAT } from '@/lib/class-abilities';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/hooks/useActivityLog';
import { setWorkerInterval, clearWorkerInterval } from '@/lib/worker-timer';

// ── Types ────────────────────────────────────────────────────────

interface EquipmentBonuses {
  [key: string]: number;
}

interface PartyMember {
  character_id: string;
  character: { name: string; hp: number; max_hp: number; current_node_id: string | null };
  is_following: boolean;
  status: string;
}

interface Party {
  id: string;
  leader_id: string;
  tank_id: string | null;
}

export interface UseCombatParams {
  character: Character;
  creatures: Creature[];
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  equipmentBonuses: EquipmentBonuses;
  effectiveAC: number;
  addLog: (msg: string) => void;
  rollLoot: (lootTable: any[], creatureName: string, lootTableId?: string | null, dropChance?: number, creatureNodeId?: string | null) => Promise<void>;
  degradeEquipment: () => Promise<void>;
  party: Party | null;
  partyMembers: PartyMember[];
  isDead: boolean;
  critBuff?: { bonus: number; expiresAt: number };
  stealthBuff?: { expiresAt: number } | null;
  onClearStealthBuff?: () => void;
  damageBuff?: { expiresAt: number } | null;
  rootDebuff?: { damageReduction: number; expiresAt: number } | null;
  acBuff?: { bonus: number; expiresAt: number } | null;
  poisonBuff?: { expiresAt: number } | null;
  onAddPoisonStack?: (creatureId: string) => void;
  evasionBuff?: { dodgeChance: number; expiresAt: number } | null;
  igniteBuff?: { expiresAt: number } | null;
  onAddIgniteStack?: (creatureId: string) => void;
  absorbBuff?: { shieldHp: number; expiresAt: number } | null;
  onAbsorbDamage?: (remaining: number) => void;
  sunderDebuff?: { acReduction: number; expiresAt: number; creatureId: string; creatureName: string } | null;
  disengageNextHit?: { bonusMult: number; expiresAt: number } | null;
  onClearDisengage?: () => void;
  focusStrikeBuff?: { bonusDmg: number } | null;
  onClearFocusStrike?: () => void;
  onCreatureKilled?: (creatureId: string) => void;
  broadcastDamage?: (creatureId: string, newHp: number, damage: number, attackerName: string, killed: boolean) => void;
  broadcastHp?: (characterId: string, hp: number, maxHp: number, source: string) => void;
  broadcastReward?: (characterId: string, xp: number, gold: number, source: string) => void;
  xpMultiplier?: number;
  disabled?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// useCombat — manages the auto-attack combat loop.
//
// All external props are stored in a SINGLE ref (`ext`) that is
// updated every render. The combat interval reads from `ext.current`
// so it always sees the latest values without stale closures.
//
// This replaces the previous pattern of 30+ individual useRef mirrors
// each synced by their own useEffect.
// ═══════════════════════════════════════════════════════════════════

export function useCombat(params: UseCombatParams) {
  // ── Single ref for ALL external state ──────────────────────────
  const ext = useRef<UseCombatParams>(params);
  if (ext && typeof ext === 'object' && 'current' in ext) {
    ext.current = params;
  }

  // Destructure for useEffect dependency arrays (React-tracked)
  const { character, creatures, isDead, disabled } = params;

  // ── Internal combat state (exposed to callers) ─────────────────
  const [activeCombatCreatureId, setActiveCombatCreatureId] = useState<string | null>(null);
  const [inCombat, setInCombat] = useState(false);
  const [creatureHpOverrides, setCreatureHpOverrides] = useState<Record<string, number>>({});
  const creatureHpOverridesRef = useRef<Record<string, number>>({});
  const [engagedCreatureIds, setEngagedCreatureIds] = useState<string[]>([]);

  // ── Internal coordination refs ─────────────────────────────────
  const engagedCreatureIdsRef = useRef<Set<string>>(new Set());
  const combatCreatureIdRef = useRef<string | null>(null);
  const inCombatRef = useRef(false);
  const intervalRef = useRef<number | null>(null);
  const combatBusyRef = useRef(false);
  const tankAbsentWarnedRef = useRef(false);
  const startCombatRef = useRef<(id: string) => void>(() => {});
  const justStoppedRef = useRef(false);
  const prevNodeRef = useRef(character.current_node_id);
   /** Tracks last counterattack timestamp per creature (2s round timer) */
   const lastCreatureAttackRef = useRef<Record<string, number>>({});

  // ── Helpers ────────────────────────────────────────────────────

  const updateCreatureHp = useCallback((creatureId: string, hp: number) => {
    setCreatureHpOverrides(prev => {
      const next = { ...prev, [creatureId]: hp };
      creatureHpOverridesRef.current = next;
      return next;
    });
  }, []);

  const stopCombat = useCallback(() => {
    if (intervalRef.current) {
      clearWorkerInterval(intervalRef.current);
      intervalRef.current = null;
    }
    combatCreatureIdRef.current = null;
    inCombatRef.current = false;
    engagedCreatureIdsRef.current = new Set();
    setEngagedCreatureIds([]);
    setActiveCombatCreatureId(null);
    setInCombat(false);
    setCreatureHpOverrides({});
    creatureHpOverridesRef.current = {};
    tankAbsentWarnedRef.current = false;
    lastCreatureAttackRef.current = {};
  }, []);

  // ── Lifecycle effects ──────────────────────────────────────────

  // Stop combat when player dies
  useEffect(() => {
    if (isDead) stopCombat();
  }, [isDead, stopCombat]);

  // Stop combat when disabled (e.g. switching to party mode)
  useEffect(() => {
    if (disabled) stopCombat();
  }, [disabled, stopCombat]);

  // Stop combat when node changes
  useEffect(() => {
    if (character.current_node_id !== prevNodeRef.current) {
      prevNodeRef.current = character.current_node_id;
      stopCombat();
    }
  }, [character.current_node_id, stopCombat]);

  // If active creature dies (from realtime update), remove from engaged set and pick next target
  useEffect(() => {
    if (!inCombat || !activeCombatCreatureId) return;
    const target = creatures.find(c => c.id === activeCombatCreatureId);
    if (!target || !target.is_alive || target.hp <= 0) {
      engagedCreatureIdsRef.current.delete(activeCombatCreatureId);
      setEngagedCreatureIds([...engagedCreatureIdsRef.current]);

      const nextEngaged = [...engagedCreatureIdsRef.current].find(id => {
        const c = creatures.find(cr => cr.id === id);
        return c && c.is_alive && c.hp > 0;
      });
      if (nextEngaged) {
        combatCreatureIdRef.current = nextEngaged;
        setActiveCombatCreatureId(nextEngaged);
      } else {
        const nextAggro = creatures.find(c => c.id !== activeCombatCreatureId && c.is_alive && c.hp > 0 && c.is_aggressive);
        if (nextAggro) {
          engagedCreatureIdsRef.current.add(nextAggro.id);
          setEngagedCreatureIds([...engagedCreatureIdsRef.current]);
          combatCreatureIdRef.current = nextAggro.id;
          setActiveCombatCreatureId(nextAggro.id);
        } else {
          stopCombat();
        }
      }
    }
    // Clean up dead creatures from engaged set
    let changed = false;
    for (const id of [...engagedCreatureIdsRef.current]) {
      const c = creatures.find(cr => cr.id === id);
      if (!c || !c.is_alive || c.hp <= 0) {
        engagedCreatureIdsRef.current.delete(id);
        changed = true;
      }
    }
    if (changed) setEngagedCreatureIds([...engagedCreatureIdsRef.current]);
  }, [creatures, inCombat, activeCombatCreatureId, stopCombat]);

  // After combat stops, auto-engage next aggressive creature
  useEffect(() => {
    if (!inCombat) {
      justStoppedRef.current = true;
    } else {
      justStoppedRef.current = false;
    }
  }, [inCombat]);

  useEffect(() => {
    if (inCombat || !justStoppedRef.current || ext.current.isDead || ext.current.disabled) return;
    const nextAggro = creatures.find(c => c.is_alive && c.hp > 0 && c.is_aggressive);
    if (nextAggro) {
      justStoppedRef.current = false; // consume flag only when aggro creature found
      const timeout = setTimeout(() => {
        ext.current.addLog(`⚠️ ${nextAggro.name} attacks!`);
        startCombatRef.current(nextAggro.id);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [creatures, inCombat]);

  // Auto-aggro: when aggressive creatures appear at the node while in combat, add them to engaged set
  useEffect(() => {
    if (!inCombat || ext.current.disabled) return;
    for (const c of creatures) {
      if (c.is_aggressive && c.is_alive && c.hp > 0 && !engagedCreatureIdsRef.current.has(c.id)) {
        engagedCreatureIdsRef.current.add(c.id);
        setEngagedCreatureIds([...engagedCreatureIdsRef.current]);
        ext.current.addLog(`⚠️ ${c.name} joins the fight!`);
      }
    }
  }, [creatures, inCombat]);

  // ── Combat tick ────────────────────────────────────────────────

  const doCombatTick = useCallback(async () => {
    if (combatBusyRef.current) return;
    combatBusyRef.current = true;

    try {
      // Read ALL external state once at tick start
      const e = ext.current;
      const char = e.character;
      const creatureId = combatCreatureIdRef.current;
      if (!creatureId || e.isDead || char.hp <= 0) {
        stopCombat();
        return;
      }

      const creature = e.creatures.find(c => c.id === creatureId);
      const creatureOverrideHp = creatureHpOverridesRef.current[creatureId];
      const effectiveCreatureHp = creatureOverrideHp !== undefined ? creatureOverrideHp : creature?.hp ?? 0;
      if (!creature || !creature.is_alive || effectiveCreatureHp <= 0) {
        engagedCreatureIdsRef.current.delete(creatureId);
        setEngagedCreatureIds([...engagedCreatureIdsRef.current]);
        const nextEngaged = [...engagedCreatureIdsRef.current].find(id => {
          const c = e.creatures.find(cr => cr.id === id);
          return c && c.is_alive && c.hp > 0;
        });
        if (nextEngaged) {
          combatCreatureIdRef.current = nextEngaged;
          setActiveCombatCreatureId(nextEngaged);
        } else {
          stopCombat();
        }
        return;
      }

      const _addLog = e.addLog;
      const _updateCharacter = e.updateCharacter;
      const _degradeEquipment = e.degradeEquipment;
      const _rollLoot = e.rollLoot;
      const _party = e.party;
      const _partyMembers = e.partyMembers;
      const _eqBonuses = e.equipmentBonuses;
      const _effectiveAC = e.effectiveAC;

      const ability = CLASS_COMBAT[char.class] || CLASS_COMBAT.warrior;
      const statBonus = _eqBonuses[ability.stat] || 0;
      const who = _party ? char.name : 'You';
      const statLabel = ability.stat.toUpperCase();

      // Sunder Armor
      const _sunderDebuff = e.sunderDebuff;
      const sunderReduction = (_sunderDebuff && Date.now() < _sunderDebuff.expiresAt && _sunderDebuff.creatureId === creatureId) ? _sunderDebuff.acReduction : 0;

      // Build attack context for shared helper
      const _critBuff = e.critBuff;
      const critBonus = (_critBuff && Date.now() < _critBuff.expiresAt) ? _critBuff.bonus : 0;
      const atkCtx: AttackContext = {
        attackerStat: (char as any)[ability.stat] + statBonus,
        int: char.int + (_eqBonuses.int || 0),
        dex: char.dex + (_eqBonuses.dex || 0),
        str: char.str + (_eqBonuses.str || 0),
        level: char.level,
        classKey: char.class,
        critBuffBonus: critBonus,
      };

      const atkResult = resolveAttackRoll(atkCtx, creature.ac, sunderReduction);

      if (atkResult.hit) {
        // Gather active buff flags
        const _stealthBuff = e.stealthBuff;
        const isAmbush = !!(_stealthBuff && Date.now() < _stealthBuff.expiresAt);
        const _damageBuff = e.damageBuff;
        const isDmgBuffed = !!(_damageBuff && Date.now() < _damageBuff.expiresAt);
        const _disengageNextHit = e.disengageNextHit;
        const isDisengageHit = !!(_disengageNextHit && Date.now() < _disengageNextHit.expiresAt);
        const _focusStrike = e.focusStrikeBuff;

        const { finalDamage: finalDmg, consumed } = applyOffensiveBuffs(atkResult.baseDamage, {
          isStealth: isAmbush,
          isDamageBuff: isDmgBuffed,
          focusStrikeDmg: _focusStrike?.bonusDmg ?? 0,
          disengageMult: isDisengageHit ? _disengageNextHit!.bonusMult - 1 : 0,
        });

        // Clear consumed one-shot buffs
        if (consumed.includes('stealth')) e.onClearStealthBuff?.();
        if (consumed.includes('disengage')) e.onClearDisengage?.();
        if (consumed.includes('focus_strike')) e.onClearFocusStrike?.();

        const currentCreatureHp = creatureHpOverridesRef.current[creatureId] ?? creature.hp;
        const newHp = Math.max(currentCreatureHp - finalDmg, 0);

        // Build log
        const ambushPrefix = isAmbush ? '🌑 AMBUSH! ' : '';
        const surgePrefix = isDmgBuffed ? '✨ ' : '';
        const disengagePrefix = isDisengageHit ? '🦘 ' : '';
        const focusPrefix = _focusStrike ? '🎯 ' : '';
        const intHitLabel = atkResult.intHitBonus > 0 ? ` + ${atkResult.intHitBonus} INT` : '';
        const statMod = getStatModifier(atkCtx.attackerStat);
        _addLog(
          `${ambushPrefix}${disengagePrefix}${focusPrefix}${surgePrefix}${sunderReduction > 0 ? '🔨 ' : ''}${atkResult.isCrit ? `${ability.emoji} CRITICAL! ` : ability.emoji + ' '}${who} ${ability.verb} ${creature.name}! Rolled ${atkResult.roll} + ${statMod} ${statLabel}${intHitLabel} = ${atkResult.totalAtk} vs AC ${atkResult.effectiveCreatureAC}${sunderReduction > 0 ? ' (Sundered -' + sunderReduction + ')' : ''} — ${finalDmg} damage.`
        );

        // Poison proc
        const _poisonBuff = e.poisonBuff;
        if (_poisonBuff && Date.now() < _poisonBuff.expiresAt && Math.random() < 0.4) {
          e.onAddPoisonStack?.(creatureId);
          _addLog(`🧪 Your poisoned blade leaves a toxic wound on ${creature.name}!`);
        }

        // Ignite proc
        const _igniteBuff = e.igniteBuff;
        if (_igniteBuff && Date.now() < _igniteBuff.expiresAt && Math.random() < 0.4) {
          e.onAddIgniteStack?.(creatureId);
          _addLog(`🔥 Your spell sets ${creature.name} ablaze!`);
        }

        if (newHp <= 0) {
          // Creature dies — use shared reward calculator
          const lootTable = creature.loot_table as any[];

          updateCreatureHp(creatureId, 0);
          e.broadcastDamage?.(creatureId, 0, finalDmg, char.name, true);
          e.onCreatureKilled?.(creatureId);
          await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: 0, _killed: true });

          // Fresh query for party members at the same node
          let membersHere: { character_id: string }[] = [];
          if (_party?.id) {
            const { data: freshMembers } = await supabase
              .from('party_members')
              .select('character_id, character:characters(current_node_id)')
              .eq('party_id', _party.id)
              .eq('status', 'accepted');

            membersHere = (freshMembers || []).filter(
              m => (m.character as any)?.current_node_id === char.current_node_id
            );
          }
          const splitCount = membersHere.length > 1 ? membersHere.length : 1;

          const { xpShares, goldEach } = calculateKillRewards(
            creature.level, creature.rarity, lootTable,
            !!(creature as any).is_humanoid, char.cha + (_eqBonuses.cha || 0),
            e.xpMultiplier ?? 1, [char.level], splitCount
          );
          const xpShare = xpShares[0];
          const goldShare = goldEach;

          const xpPenaltyPct = xpShare > 0 ? Math.round((xpShare * splitCount) / (creature.level * 10 * ({ regular: 1, rare: 1.5, boss: 2.5 }[creature.rarity] || 1)) * 100) : 100;
          const penaltyNote = xpPenaltyPct < 100 ? ` (${xpPenaltyPct}% XP — level penalty)` : '';
          const goldNote = goldShare > 0 ? `, +${goldShare} gold` : '';
          if (splitCount > 1) {
            _addLog(`☠️ ${creature.name} has been slain! Rewards split ${splitCount} ways: +${xpShare} XP${goldNote} each.${penaltyNote}`);
            for (const m of membersHere) {
              if (m.character_id === char.id) continue;
              if (!m.character_id || m.character_id === 'undefined') {
                console.error('Skipping award: invalid character_id', m.character_id);
                continue;
              }
              try {
                await supabase.rpc('award_party_member', {
                  _character_id: m.character_id,
                  _xp: xpShare,
                  _gold: goldShare,
                });
                e.broadcastReward?.(m.character_id, xpShare, goldShare, creature.name);
              } catch (err) {
                console.error('Failed to award party member:', m.character_id, err);
              }
            }
          } else {
            _addLog(`☠️ ${creature.name} has been slain! (+${xpShare} XP${goldNote})${penaltyNote}`);
          }

          logActivity(char.user_id, char.id, 'combat_kill', `Slew ${creature.name} (Lvl ${creature.level}) +${xpShare} XP`, {
            creature_name: creature.name, creature_level: creature.level, xp: xpShare, gold: goldShare,
          });

          const newXp = char.xp + xpShare;
          const newGold = char.gold + goldShare;
          const xpForNext = getXpForLevel(char.level);
          if (newXp >= xpForNext) {
            const newLevel = char.level + 1;
            const levelUpUpdates: Partial<Character> = {
              xp: newXp - xpForNext,
              level: newLevel,
              gold: newGold,
            };

            const statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

            levelUpUpdates.unspent_stat_points = (char.unspent_stat_points || 0) + 1;
            _addLog(`📊 You gained 1 stat point to allocate!`);

            if ([10, 20, 30, 40].includes(newLevel)) {
              levelUpUpdates.respec_points = (char.respec_points || 0) + 1;
              _addLog(`🔄 You earned a respec point! You can reallocate a stat point.`);
            }

            if (newLevel % 3 === 0) {
              const bonuses = CLASS_LEVEL_BONUSES[char.class] || {};
              const bonusNames: string[] = [];
              for (const [stat, amount] of Object.entries(bonuses)) {
                const currentVal = (levelUpUpdates as any)[stat] ?? (char as any)[stat] ?? 10;
                (levelUpUpdates as any)[stat] = currentVal + amount;
                bonusNames.push(`+${amount} ${stat.toUpperCase()}`);
              }
              if (bonusNames.length > 0) {
                _addLog(`📈 ${CLASS_LABELS[char.class] || char.class} bonus: ${bonusNames.join(', ')}!`);
              }
            }

            // Recalculate max_hp from formula to account for CON changes
            const finalCon = (levelUpUpdates as any).con ?? char.con;
            const newMaxHp = getMaxHp(char.class, finalCon, newLevel);
            levelUpUpdates.max_hp = newMaxHp;
            levelUpUpdates.hp = newMaxHp;

            const finalInt = (levelUpUpdates as any).int ?? char.int;
            const finalWis = (levelUpUpdates as any).wis ?? char.wis;
            const finalCha = (levelUpUpdates as any).cha ?? char.cha;
            const newMaxCp = getMaxCp(newLevel, finalInt, finalWis, finalCha);
            const oldMaxCp = char.max_cp ?? 30;
            levelUpUpdates.max_cp = newMaxCp;
            levelUpUpdates.cp = Math.min((char.cp ?? 0) + (newMaxCp - oldMaxCp), newMaxCp);

            _addLog(`🎉 Level Up! ${who} ${_party ? 'is' : 'are'} now level ${newLevel}!`);
            logActivity(char.user_id, char.id, 'level_up', `Reached level ${newLevel}`, { level: newLevel });
            await _updateCharacter(levelUpUpdates);
          } else {
            await _updateCharacter({ xp: newXp, gold: newGold });
          }

          // Award BHP for boss kills
          if (creature.rarity === 'boss' && char.level >= 30) {
            const bhpReward = Math.floor(creature.level * 0.5);
            if (bhpReward > 0) {
              const bhpShare = Math.floor(bhpReward / splitCount);
              if (bhpShare > 0) {
                const newBhp = (char.bhp || 0) + bhpShare;
                await _updateCharacter({ bhp: newBhp });
                _addLog(`🏋️ +${bhpShare} Boss Hunter Points!`);
              }
            }
          }

          await _rollLoot(creature.loot_table as any[], creature.name, (creature as any).loot_table_id, (creature as any).drop_chance, creature.node_id);

          engagedCreatureIdsRef.current.delete(creatureId);
          setEngagedCreatureIds([...engagedCreatureIdsRef.current]);

          const nextEngaged = [...engagedCreatureIdsRef.current].find(id => {
            const c = ext.current.creatures.find(cr => cr.id === id);
            return c && c.is_alive && c.hp > 0;
          });
          if (nextEngaged) {
            combatCreatureIdRef.current = nextEngaged;
            setActiveCombatCreatureId(nextEngaged);
          } else {
            stopCombat();
          }
          return;
        } else {
          updateCreatureHp(creatureId, newHp);
          e.broadcastDamage?.(creatureId, newHp, finalDmg, char.name, false);
          await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: newHp, _killed: false });
        }
      } else {
        const statMod = getStatModifier(atkCtx.attackerStat);
        const intHitMissLabel = atkResult.intHitBonus > 0 ? ` + ${atkResult.intHitBonus} INT` : '';
        _addLog(`${ability.emoji} ${who} ${ability.verb} ${creature.name} — miss! Rolled ${atkResult.roll} + ${statMod} ${statLabel}${intHitMissLabel} = ${atkResult.totalAtk} vs AC ${atkResult.effectiveCreatureAC}${sunderReduction > 0 ? ' (Sundered -' + sunderReduction + ')' : ''}.`);
      }

      // ── Creature counterattack ─────────────────────────────────
      const effectiveTankId = _party ? (_party.tank_id ?? _party.leader_id) : null;
      const iAmTheTank = !_party || effectiveTankId === char.id;

      // Check if tank is present at this node (once for all creatures)
      let tankPresentAtNode = false;
      if (_party && effectiveTankId && effectiveTankId !== char.id) {
        const localTankMember = _partyMembers.find(m => m.character_id === effectiveTankId && m.character.current_node_id === char.current_node_id);
        if (localTankMember) {
          try {
            const { data: freshTank } = await supabase
              .from('characters')
              .select('current_node_id')
              .eq('id', effectiveTankId)
              .single();
            tankPresentAtNode = !!(freshTank && freshTank.current_node_id === char.current_node_id);
          } catch {
            tankPresentAtNode = false;
          }
        }
      }

      if (!iAmTheTank && tankPresentAtNode) {
        // Non-tank members skip counterattack when tank is present
      } else {
      // Warn once if tank is absent
      if (_party && !iAmTheTank && !tankPresentAtNode && !tankAbsentWarnedRef.current) {
        tankAbsentWarnedRef.current = true;
        _addLog(`⚠️ Tank is not here — creatures target you directly!`);
      }

      // Loop over ALL engaged creatures for counterattacks
      const engagedIds = [...engagedCreatureIdsRef.current];
      const now = Date.now();
      for (const engagedId of engagedIds) {
        // Creatures attack once per 2s round, skip if too soon
        const lastAtk = lastCreatureAttackRef.current[engagedId] || 0;
        if (now - lastAtk < 1800) continue; // 1800ms threshold to avoid drift issues

        // Re-read character to get latest HP (may have changed from previous creature's hit)
        const currentChar = ext.current.character;
        if (currentChar.hp <= 0) break;

        const engagedCreature = ext.current.creatures.find(c => c.id === engagedId);
        if (!engagedCreature || !engagedCreature.is_alive || engagedCreature.hp <= 0) continue;
        const overrideHp = creatureHpOverridesRef.current[engagedId];
        if (overrideHp !== undefined && overrideHp <= 0) continue;

        // Mark this creature's attack time
        lastCreatureAttackRef.current[engagedId] = now;

      // Root debuff
      const _rootDebuff = ext.current.rootDebuff;
      const isRooted = _rootDebuff && Date.now() < _rootDebuff.expiresAt;

      // AC buff from Battle Cry
      const _acBuff = ext.current.acBuff;
      const acBuffBonus = (_acBuff && Date.now() < _acBuff.expiresAt) ? _acBuff.bonus : 0;
      const buffedAC = _effectiveAC + acBuffBonus;
      const creatureAtk = rollD20() + getStatModifier(engagedCreature.stats.str || 10);

      let tankMember = _party && effectiveTankId
        ? _partyMembers.find(m => m.character_id === effectiveTankId && m.character.current_node_id === char.current_node_id)
        : null;

      // Double-check tank is still at this node
      if (tankMember && tankMember.character_id !== char.id) {
        try {
          const { data: freshTank } = await supabase
            .from('characters')
            .select('current_node_id')
            .eq('id', tankMember.character_id)
            .single();
          if (!freshTank || freshTank.current_node_id !== char.current_node_id) {
            tankMember = null;
          }
        } catch {
          tankMember = null;
        }
      }

      if (_party && tankMember) {
        // Evasion check for tank
        const _evasionBuff = ext.current.evasionBuff;
        const isEvading = _evasionBuff && Date.now() < _evasionBuff.expiresAt;
        if (isEvading && Math.random() < _evasionBuff!.dodgeChance) {
          _addLog(`🌫️ ${tankMember.character.name} dodges ${engagedCreature.name}'s attack from the shadows!`);
        } else if (creatureAtk >= buffedAC) {
          const rawCreatureDmg = rollCreatureDamage(engagedCreature.level, engagedCreature.rarity, engagedCreature.stats.str || 10, char.level);
          const wisChanceTank = iAmTheTank ? getWisDodgeChance(char.wis + (_eqBonuses.wis || 0)) : 0;
          const _absorbBuff = ext.current.absorbBuff;
          const shieldHp = (_absorbBuff && Date.now() < _absorbBuff.expiresAt) ? _absorbBuff.shieldHp : 0;
          const defResult = applyDefensiveBuffs(rawCreatureDmg, {
            isRooted: !!isRooted,
            wisAwarenessChance: wisChanceTank,
            absorbShieldHp: shieldHp,
          });

          if (defResult.wisReduced) {
            _addLog(`🧘 ${who}'s awareness softens ${engagedCreature.name}'s blow! (${defResult.finalDamage + defResult.absorbed} damage)`);
          }

          if (defResult.absorbed > 0) {
            ext.current.onAbsorbDamage?.(defResult.remainingShield);
            if (defResult.finalDamage > 0) {
              _addLog(`🛡️✨ ${engagedCreature.name} hits ${tankMember.character.name} — Force Shield absorbs ${defResult.absorbed} damage! ${defResult.finalDamage} bleeds through. (Shield broken)`);
              try {
                const { data: tankNewHp, error: dmgError } = await supabase.rpc('damage_party_member', {
                  _character_id: tankMember.character_id,
                  _damage: defResult.finalDamage,
                });
                if (!dmgError && tankNewHp !== null) {
                  ext.current.broadcastHp?.(tankMember.character_id, tankNewHp, tankMember.character.max_hp, engagedCreature.name);
                }
                await supabase.rpc('degrade_party_member_equipment' as any, { _character_id: tankMember.character_id });
              } catch (err) {
                console.error('Failed to update tank HP/equipment:', err);
              }
            } else {
              _addLog(`🛡️✨ ${engagedCreature.name} hits ${tankMember.character.name} — Force Shield absorbs all ${defResult.absorbed} damage! (${defResult.remainingShield} shield HP left)`);
            }
          } else {
            const totalDmg = defResult.finalDamage;
            _addLog(`${isRooted ? '🌿 ' : ''}🛡️ ${engagedCreature.name} strikes ${tankMember.character.name} (Tank)! ${totalDmg} damage.`);
            try {
              const { data: tankNewHp, error: dmgError } = await supabase.rpc('damage_party_member', {
                _character_id: tankMember.character_id,
                _damage: totalDmg,
              });
              if (!dmgError && tankNewHp !== null) {
                ext.current.broadcastHp?.(tankMember.character_id, tankNewHp, tankMember.character.max_hp, engagedCreature.name);
              }
              await supabase.rpc('degrade_party_member_equipment' as any, { _character_id: tankMember.character_id });
            } catch (err) {
              console.error('Failed to update tank HP/equipment:', err);
            }
          }
        } else {
          _addLog(`${acBuffBonus > 0 ? '📯 ' : ''}${engagedCreature.name} attacks ${tankMember.character.name} (Tank) — misses!${acBuffBonus > 0 ? ' (Battle Cry AC+' + acBuffBonus + ')' : ''}`);
        }
      } else {
        // Evasion check (Cloak of Shadows)
        const _evasionBuff = ext.current.evasionBuff;
        const isEvading = _evasionBuff && Date.now() < _evasionBuff.expiresAt;
        if (isEvading && Math.random() < _evasionBuff!.dodgeChance) {
          _addLog(`🌫️ ${who} ${_party ? 'dodges' : 'dodge'} ${engagedCreature.name}'s attack from the shadows!`);
        } else if (creatureAtk >= buffedAC) {
          const rawCreatureDmg = rollCreatureDamage(engagedCreature.level, engagedCreature.rarity, engagedCreature.stats.str || 10, char.level);
          const wisChance = getWisDodgeChance(char.wis + (_eqBonuses.wis || 0));
          const _absorbBuff = ext.current.absorbBuff;
          const shieldHp = (_absorbBuff && Date.now() < _absorbBuff.expiresAt) ? _absorbBuff.shieldHp : 0;
          const defResult = applyDefensiveBuffs(rawCreatureDmg, {
            isRooted: !!isRooted,
            wisAwarenessChance: wisChance,
            absorbShieldHp: shieldHp,
          });

          if (defResult.wisReduced) {
            _addLog(`🧘 ${who}'s awareness softens ${engagedCreature.name}'s blow! (${defResult.finalDamage + defResult.absorbed} damage)`);
          }

          if (defResult.absorbed > 0) {
            ext.current.onAbsorbDamage?.(defResult.remainingShield);
            if (defResult.finalDamage > 0) {
              const playerNewHp = Math.max(currentChar.hp - defResult.finalDamage, 0);
              _addLog(`🛡️✨ ${engagedCreature.name} hits ${who} — Force Shield absorbs ${defResult.absorbed} damage! ${defResult.finalDamage} bleeds through. (Shield broken)`);
              await _updateCharacter({ hp: playerNewHp });
              await _degradeEquipment();
              if (playerNewHp <= 0) {
                _addLog(`💀 ${who} ${_party ? 'has' : 'have'} been defeated...`);
                stopCombat();
                break;
              }
            } else {
              _addLog(`🛡️✨ ${engagedCreature.name} hits ${who} — Force Shield absorbs all ${defResult.absorbed} damage! (${defResult.remainingShield} shield HP left)`);
            }
          } else {
            const playerNewHp = Math.max(currentChar.hp - defResult.finalDamage, 0);
            _addLog(`${isRooted ? '🌿 ' : ''}${acBuffBonus > 0 ? '📯 ' : ''}${engagedCreature.name} strikes back at ${who}! Rolled ${creatureAtk} vs AC ${buffedAC} — Hit! ${defResult.finalDamage} damage.`);
            await _updateCharacter({ hp: playerNewHp });
            await _degradeEquipment();
            if (playerNewHp <= 0) {
              _addLog(`💀 ${who} ${_party ? 'has' : 'have'} been defeated...`);
              stopCombat();
              break;
            }
          }
        } else {
          _addLog(`${acBuffBonus > 0 ? '📯 ' : ''}${engagedCreature.name} attacks ${who} — misses!${acBuffBonus > 0 ? ' (Battle Cry AC+' + acBuffBonus + ')' : ''}`);
        }
      }
      } // end engaged creature loop
      } // end iAmTheTank
    } finally {
      combatBusyRef.current = false;
    }
  }, [stopCombat, updateCreatureHp]);

  // ── Start combat ───────────────────────────────────────────────

  const startCombat = useCallback((creatureId: string) => {
    if (ext.current.disabled || ext.current.isDead || ext.current.character.hp <= 0) return;
    const creature = ext.current.creatures.find(c => c.id === creatureId);
    if (!creature || !creature.is_alive || creature.hp <= 0) return;

    if (inCombatRef.current && combatCreatureIdRef.current === creatureId) return;

    if (intervalRef.current) {
      clearWorkerInterval(intervalRef.current);
      intervalRef.current = null;
    }

    engagedCreatureIdsRef.current.add(creatureId);
    setEngagedCreatureIds([...engagedCreatureIdsRef.current]);

    combatCreatureIdRef.current = creatureId;
    inCombatRef.current = true;
    setActiveCombatCreatureId(creatureId);
    setInCombat(true);

    doCombatTick();

    intervalRef.current = setWorkerInterval(() => {
      doCombatTick();
    }, 2000);
  }, [doCombatTick]);

  // Keep startCombatRef in sync
  useEffect(() => { startCombatRef.current = startCombat; }, [startCombat]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearWorkerInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    inCombat,
    activeCombatCreatureId,
    engagedCreatureIds,
    creatureHpOverrides,
    updateCreatureHp,
    startCombat,
    stopCombat,
  };
}
