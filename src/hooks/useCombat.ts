import { useState, useCallback, useEffect, useRef } from 'react';
import { Character } from '@/hooks/useCharacter';
import { Creature } from '@/hooks/useCreatures';
import { rollD20, getStatModifier, rollDamage, getCreatureDamageDie, CLASS_LEVEL_BONUSES, CLASS_LABELS, XP_RARITY_MULTIPLIER, getXpForLevel, getXpPenalty, getMaxCp, getIntCritBonus, getWisDodgeChance, getStrDamageFloor, getChaGoldMultiplier } from '@/lib/game-data';
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
  rollLoot: (lootTable: any[], creatureName: string, lootTableId?: string | null, dropChance?: number) => Promise<void>;
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
  broadcastDamage?: (creatureId: string, newHp: number, damage: number, attackerName: string, killed: boolean) => void;
  broadcastHp?: (characterId: string, hp: number, maxHp: number, source: string) => void;
  broadcastReward?: (characterId: string, xp: number, gold: number, source: string) => void;
  xpMultiplier?: number;
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
  const ext = useRef(params);
  ext.current = params;

  // Destructure for useEffect dependency arrays (React-tracked)
  const { character, creatures, isDead } = params;

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
  }, []);

  // ── Lifecycle effects ──────────────────────────────────────────

  // Stop combat when player dies
  useEffect(() => {
    if (isDead) stopCombat();
  }, [isDead, stopCombat]);

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
    if (inCombat || !justStoppedRef.current || ext.current.isDead) return;
    justStoppedRef.current = false;
    const nextAggro = creatures.find(c => c.is_alive && c.hp > 0 && c.is_aggressive);
    if (nextAggro) {
      const timeout = setTimeout(() => {
        ext.current.addLog(`⚠️ ${nextAggro.name} attacks!`);
        startCombatRef.current(nextAggro.id);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [creatures, inCombat]);

  // Auto-aggro: when aggressive creatures appear at the node while in combat, add them to engaged set
  useEffect(() => {
    if (!inCombat) return;
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
      if (!creature || !creature.is_alive || creature.hp <= 0) {
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
      const atkRoll = rollD20();
      const statMod = getStatModifier((char as any)[ability.stat] + statBonus);
      const totalAtk = atkRoll + statMod;
      const statLabel = ability.stat.toUpperCase();
      const who = _party ? char.name : 'You';
      const _critBuff = e.critBuff;
      const critBonus = (_critBuff && Date.now() < _critBuff.expiresAt) ? _critBuff.bonus : 0;
      const milestoneCritBonus = char.level >= 28 ? 1 : 0;
      const intCritBonus = getIntCritBonus(char.int + (_eqBonuses.int || 0));
      const effectiveCritRange = ability.critRange - critBonus - milestoneCritBonus - intCritBonus;

      // Sunder Armor
      const _sunderDebuff = e.sunderDebuff;
      const sunderReduction = (_sunderDebuff && Date.now() < _sunderDebuff.expiresAt && _sunderDebuff.creatureId === creatureId) ? _sunderDebuff.acReduction : 0;
      const effectiveCreatureAC = Math.max(creature.ac - sunderReduction, 0);

      if (atkRoll >= effectiveCritRange || (atkRoll !== 1 && totalAtk >= effectiveCreatureAC)) {
        const dmg = rollDamage(ability.diceMin, ability.diceMax) + statMod;
        const isCrit = atkRoll >= effectiveCritRange;
        const strFloor = getStrDamageFloor(char.str + (_eqBonuses.str || 0));
        let finalDmg = isCrit ? dmg * 2 : Math.max(dmg, 1 + strFloor);

        // Stealth ambush
        const _stealthBuff = e.stealthBuff;
        const isAmbush = _stealthBuff && Date.now() < _stealthBuff.expiresAt;
        if (isAmbush) {
          finalDmg *= 2;
          e.onClearStealthBuff?.();
        }

        // Arcane Surge
        const _damageBuff = e.damageBuff;
        const isDmgBuffed = _damageBuff && Date.now() < _damageBuff.expiresAt;
        if (isDmgBuffed) {
          finalDmg = Math.floor(finalDmg * 1.5);
        }

        // Disengage next-hit bonus
        const _disengageNextHit = e.disengageNextHit;
        const isDisengageHit = _disengageNextHit && Date.now() < _disengageNextHit.expiresAt;
        if (isDisengageHit) {
          finalDmg = Math.floor(finalDmg * _disengageNextHit!.bonusMult);
          e.onClearDisengage?.();
        }

        // Focus Strike
        const _focusStrike = e.focusStrikeBuff;
        const isFocusStrike = !!_focusStrike;
        if (isFocusStrike) {
          finalDmg += _focusStrike!.bonusDmg;
          e.onClearFocusStrike?.();
        }

        const currentCreatureHp = creatureHpOverridesRef.current[creatureId] ?? creature.hp;
        const newHp = Math.max(currentCreatureHp - finalDmg, 0);

        const ambushPrefix = isAmbush ? '🌑 AMBUSH! ' : '';
        const surgePrefix = isDmgBuffed ? '✨ ' : '';
        const disengagePrefix = isDisengageHit ? '🦘 ' : '';
        const focusPrefix = isFocusStrike ? '🎯 ' : '';
        _addLog(
          `${ambushPrefix}${disengagePrefix}${focusPrefix}${surgePrefix}${sunderReduction > 0 ? '🔨 ' : ''}${isCrit ? `${ability.emoji} CRITICAL! ` : ability.emoji + ' '}${who} ${ability.verb} ${creature.name}! Rolled ${atkRoll} + ${statMod} ${statLabel} = ${totalAtk} vs AC ${effectiveCreatureAC}${sunderReduction > 0 ? ' (Sundered -' + sunderReduction + ')' : ''} — ${finalDmg} damage.`
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
          // Creature dies
          const baseXp = Math.floor(creature.level * 10 * (XP_RARITY_MULTIPLIER[creature.rarity] || 1));
          const xpPenalty = getXpPenalty(char.level, creature.level);
          const totalXp = Math.floor(baseXp * xpPenalty * (e.xpMultiplier ?? 1));

          const lootTable = creature.loot_table as any[];
          const goldEntry = lootTable?.find((entry: any) => entry.type === 'gold');
        let totalGold = 0;
          if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
            totalGold = Math.floor(goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1));
            // CHA gold bonus for humanoid kills
            if ((creature as any).is_humanoid) {
              totalGold = Math.floor(totalGold * getChaGoldMultiplier(char.cha + (_eqBonuses.cha || 0)));
            }
          }

          updateCreatureHp(creatureId, 0);
          e.broadcastDamage?.(creatureId, 0, finalDmg, char.name, true);
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
          const xpShare = Math.floor(totalXp / splitCount);
          const goldShare = Math.floor(totalGold / splitCount);

          const penaltyNote = xpPenalty < 1 ? ` (${Math.round(xpPenalty * 100)}% XP — level penalty)` : '';
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
              max_hp: char.max_hp + 5,
              hp: char.max_hp + 5,
              gold: newGold,
            };

            const statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

            // Grant 1 unspent stat point per level
            levelUpUpdates.unspent_stat_points = (char.unspent_stat_points || 0) + 1;
            _addLog(`📊 You gained 1 stat point to allocate!`);

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

            const finalInt = (levelUpUpdates as any).int ?? char.int;
            const finalWis = (levelUpUpdates as any).wis ?? char.wis;
            const finalCha = (levelUpUpdates as any).cha ?? char.cha;
            const newMaxCp = getMaxCp(newLevel, finalInt, finalWis, finalCha);
            const oldMaxCp = char.max_cp ?? 60;
            levelUpUpdates.max_cp = newMaxCp;
            levelUpUpdates.cp = Math.min((char.cp ?? 0) + (newMaxCp - oldMaxCp), newMaxCp);

            _addLog(`🎉 Level Up! ${who} ${_party ? 'is' : 'are'} now level ${newLevel}!`);
            logActivity(char.user_id, char.id, 'level_up', `Reached level ${newLevel}`, { level: newLevel });
            await _updateCharacter(levelUpUpdates);
          } else {
            await _updateCharacter({ xp: newXp, gold: newGold });
          }

          await _rollLoot(creature.loot_table as any[], creature.name, (creature as any).loot_table_id, (creature as any).drop_chance);

          // Remove dead creature from engaged set
          engagedCreatureIdsRef.current.delete(creatureId);
          setEngagedCreatureIds([...engagedCreatureIdsRef.current]);

          // Pick next engaged creature or stop
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
        _addLog(`${ability.emoji} ${who} ${ability.verb} ${creature.name} — miss! Rolled ${atkRoll} + ${statMod} ${statLabel} = ${totalAtk} vs AC ${effectiveCreatureAC}${sunderReduction > 0 ? ' (Sundered -' + sunderReduction + ')' : ''}.`);
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
      for (const engagedId of engagedIds) {
        // Re-read character to get latest HP (may have changed from previous creature's hit)
        const currentChar = ext.current.character;
        if (currentChar.hp <= 0) break;

        const engagedCreature = ext.current.creatures.find(c => c.id === engagedId);
        if (!engagedCreature || !engagedCreature.is_alive || engagedCreature.hp <= 0) continue;
        const overrideHp = creatureHpOverridesRef.current[engagedId];
        if (overrideHp !== undefined && overrideHp <= 0) continue;

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
          const dmgDie = getCreatureDamageDie(engagedCreature.level, engagedCreature.rarity);
          let creatureDmg = Math.max(rollDamage(1, dmgDie) + getStatModifier(engagedCreature.stats.str || 10), 1);
          if (isRooted) creatureDmg = Math.max(Math.floor(creatureDmg * 0.7), 1);
          // WIS chance to halve damage (tank path)
          const wisChanceTank = getWisDodgeChance(char.wis + (_eqBonuses.wis || 0));
          if (iAmTheTank && wisChanceTank > 0 && Math.random() < wisChanceTank) {
            creatureDmg = Math.max(Math.floor(creatureDmg / 2), 1);
            _addLog(`🧘 ${who}'s awareness halves ${engagedCreature.name}'s blow! (${creatureDmg} damage)`);
          }

          // Force Shield absorb for tank
          const _absorbBuff = ext.current.absorbBuff;
          const hasShield = _absorbBuff && Date.now() < _absorbBuff.expiresAt && _absorbBuff.shieldHp > 0;
          if (hasShield) {
            const absorbed = Math.min(creatureDmg, _absorbBuff!.shieldHp);
            const remainingShield = _absorbBuff!.shieldHp - absorbed;
            const remainingDmg = creatureDmg - absorbed;
            ext.current.onAbsorbDamage?.(remainingShield);
            if (remainingDmg > 0) {
              _addLog(`🛡️✨ Force Shield absorbs ${absorbed} damage! ${remainingDmg} damage bleeds through. (Shield broken)`);
              try {
                const { data: tankNewHp, error: dmgError } = await supabase.rpc('damage_party_member', {
                  _character_id: tankMember.character_id,
                  _damage: remainingDmg,
                });
                if (!dmgError && tankNewHp !== null) {
                  ext.current.broadcastHp?.(tankMember.character_id, tankNewHp, tankMember.character.max_hp, engagedCreature.name);
                }
                await supabase.rpc('degrade_party_member_equipment' as any, { _character_id: tankMember.character_id });
              } catch (err) {
                console.error('Failed to update tank HP/equipment:', err);
              }
            } else {
              _addLog(`🛡️✨ Force Shield absorbs all ${absorbed} damage! (${remainingShield} shield HP left)`);
            }
          } else {
          _addLog(`${isRooted ? '🌿 ' : ''}🛡️ ${engagedCreature.name} strikes ${tankMember.character.name} (Tank)! ${creatureDmg} damage.`);
          try {
            const { data: tankNewHp, error: dmgError } = await supabase.rpc('damage_party_member', {
              _character_id: tankMember.character_id,
              _damage: creatureDmg,
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
          const dmgDie2 = getCreatureDamageDie(engagedCreature.level, engagedCreature.rarity);
          let creatureDmg = Math.max(rollDamage(1, dmgDie2) + getStatModifier(engagedCreature.stats.str || 10), 1);
          if (isRooted) creatureDmg = Math.max(Math.floor(creatureDmg * 0.7), 1);
          // WIS chance to halve damage
          const wisChance = getWisDodgeChance(char.wis + (_eqBonuses.wis || 0));
          if (wisChance > 0 && Math.random() < wisChance) {
            creatureDmg = Math.max(Math.floor(creatureDmg / 2), 1);
            _addLog(`🧘 ${who}'s awareness halves ${engagedCreature.name}'s blow! (${creatureDmg} damage)`);
          }

          // Force Shield absorb
          const _absorbBuff = ext.current.absorbBuff;
          const hasShield = _absorbBuff && Date.now() < _absorbBuff.expiresAt && _absorbBuff.shieldHp > 0;
          if (hasShield) {
            const absorbed = Math.min(creatureDmg, _absorbBuff!.shieldHp);
            const remainingShield = _absorbBuff!.shieldHp - absorbed;
            const remainingDmg = creatureDmg - absorbed;
            ext.current.onAbsorbDamage?.(remainingShield);
            if (remainingDmg > 0) {
              const playerNewHp = Math.max(currentChar.hp - remainingDmg, 0);
              _addLog(`🛡️✨ Force Shield absorbs ${absorbed} damage! ${remainingDmg} damage bleeds through. (Shield broken)`);
              await _updateCharacter({ hp: playerNewHp });
              await _degradeEquipment();
              if (playerNewHp <= 0) {
                _addLog(`💀 ${who} ${_party ? 'has' : 'have'} been defeated...`);
                stopCombat();
                break;
              }
            } else {
              _addLog(`🛡️✨ Force Shield absorbs all ${absorbed} damage! (${remainingShield} shield HP left)`);
            }
          } else {
            const playerNewHp = Math.max(currentChar.hp - creatureDmg, 0);
            _addLog(`${isRooted ? '🌿 ' : ''}${acBuffBonus > 0 ? '📯 ' : ''}${engagedCreature.name} strikes back at ${who}! Rolled ${creatureAtk} vs AC ${buffedAC} — Hit! ${creatureDmg} damage.`);
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
    if (ext.current.isDead || ext.current.character.hp <= 0) return;
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

    const char = ext.current.character;
    const dexMod = Math.floor((char.dex - 10) / 2);
    const attackInterval = Math.max(3000 - (dexMod * 250), 1000);

    doCombatTick();

    intervalRef.current = setWorkerInterval(() => {
      doCombatTick();
    }, attackInterval);
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
