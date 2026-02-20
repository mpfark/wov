import { useState, useCallback, useEffect, useRef } from 'react';
import { Character } from '@/hooks/useCharacter';
import { Creature } from '@/hooks/useCreatures';
import { rollD20, getStatModifier, rollDamage, getCreatureDamageDie, CLASS_LEVEL_BONUSES, CLASS_LABELS, XP_RARITY_MULTIPLIER, getXpForLevel } from '@/lib/game-data';
import { CLASS_COMBAT } from '@/lib/class-abilities';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/hooks/useActivityLog';

interface EquipmentBonuses {
  [key: string]: number;
}

interface PartyMember {
  character_id: string;
  character: { name: string; hp: number; current_node_id: string | null };
  is_following: boolean;
  status: string;
}

interface Party {
  id: string;
  leader_id: string;
  tank_id: string | null;
}

interface UseCombatParams {
  character: Character;
  creatures: Creature[];
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  equipmentBonuses: EquipmentBonuses;
  effectiveAC: number;
  addLog: (msg: string) => void;
  rollLoot: (lootTable: any[], creatureName: string) => Promise<void>;
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
  sunderDebuff?: { acReduction: number; expiresAt: number; creatureId: string } | null;
  disengageNextHit?: { bonusMult: number; expiresAt: number } | null;
  onClearDisengage?: () => void;
  broadcastDamage?: (creatureId: string, newHp: number, damage: number, attackerName: string, killed: boolean) => void;
  broadcastHp?: (characterId: string, hp: number, maxHp: number, source: string) => void;
  broadcastReward?: (characterId: string, xp: number, gold: number, source: string) => void;
}

export function useCombat({
  character,
  creatures,
  updateCharacter,
  equipmentBonuses,
  effectiveAC,
  addLog,
  rollLoot,
  degradeEquipment,
  party,
  partyMembers,
  isDead,
  critBuff,
  stealthBuff,
  onClearStealthBuff,
  damageBuff,
  rootDebuff,
  acBuff,
  poisonBuff,
  onAddPoisonStack,
  evasionBuff,
  igniteBuff,
  onAddIgniteStack,
  absorbBuff,
  onAbsorbDamage,
  sunderDebuff,
  disengageNextHit,
  onClearDisengage,
  broadcastDamage,
  broadcastHp,
  broadcastReward,
}: UseCombatParams) {
  const [activeCombatCreatureId, setActiveCombatCreatureId] = useState<string | null>(null);
  const [inCombat, setInCombat] = useState(false);
  const [creatureHpOverrides, setCreatureHpOverrides] = useState<Record<string, number>>({});
  const creatureHpOverridesRef = useRef<Record<string, number>>({});

  // Use refs for values accessed inside the interval to avoid stale closures
  const characterRef = useRef(character);
  const creaturesRef = useRef(creatures);
  const equipmentBonusesRef = useRef(equipmentBonuses);
  const effectiveACRef = useRef(effectiveAC);
  const addLogRef = useRef(addLog);
  const rollLootRef = useRef(rollLoot);
  const degradeEquipmentRef = useRef(degradeEquipment);
  const updateCharacterRef = useRef(updateCharacter);
  const partyRef = useRef(party);
  const partyMembersRef = useRef(partyMembers);
  const isDeadRef = useRef(isDead);
  const critBuffRef = useRef(critBuff);
  const stealthBuffRef = useRef(stealthBuff);
  const onClearStealthBuffRef = useRef(onClearStealthBuff);
  const damageBuffRef = useRef(damageBuff);
  const rootDebuffRef = useRef(rootDebuff);
  const acBuffRef = useRef(acBuff);
  const poisonBuffRef = useRef(poisonBuff);
  const onAddPoisonStackRef = useRef(onAddPoisonStack);
  const evasionBuffRef = useRef(evasionBuff);
  const igniteBuffRef = useRef(igniteBuff);
  const onAddIgniteStackRef = useRef(onAddIgniteStack);
  const absorbBuffRef = useRef(absorbBuff);
  const onAbsorbDamageRef = useRef(onAbsorbDamage);
  const sunderDebuffRef = useRef(sunderDebuff);
  const disengageNextHitRef = useRef(disengageNextHit);
  const onClearDisengageRef = useRef(onClearDisengage);
  const broadcastDamageRef = useRef(broadcastDamage);
  const broadcastHpRef = useRef(broadcastHp);
  const broadcastRewardRef = useRef(broadcastReward);
  const combatCreatureIdRef = useRef<string | null>(null);
  const inCombatRef = useRef(false);

  useEffect(() => { characterRef.current = character; }, [character]);
  useEffect(() => { creaturesRef.current = creatures; }, [creatures]);
  useEffect(() => { equipmentBonusesRef.current = equipmentBonuses; }, [equipmentBonuses]);
  useEffect(() => { effectiveACRef.current = effectiveAC; }, [effectiveAC]);
  useEffect(() => { addLogRef.current = addLog; }, [addLog]);
  useEffect(() => { rollLootRef.current = rollLoot; }, [rollLoot]);
  useEffect(() => { degradeEquipmentRef.current = degradeEquipment; }, [degradeEquipment]);
  useEffect(() => { updateCharacterRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { partyRef.current = party; }, [party]);
  useEffect(() => { partyMembersRef.current = partyMembers; }, [partyMembers]);
  useEffect(() => { isDeadRef.current = isDead; }, [isDead]);
  useEffect(() => { critBuffRef.current = critBuff; }, [critBuff]);
  useEffect(() => { stealthBuffRef.current = stealthBuff; }, [stealthBuff]);
  useEffect(() => { onClearStealthBuffRef.current = onClearStealthBuff; }, [onClearStealthBuff]);
  useEffect(() => { damageBuffRef.current = damageBuff; }, [damageBuff]);
  useEffect(() => { rootDebuffRef.current = rootDebuff; }, [rootDebuff]);
  useEffect(() => { acBuffRef.current = acBuff; }, [acBuff]);
  useEffect(() => { poisonBuffRef.current = poisonBuff; }, [poisonBuff]);
  useEffect(() => { onAddPoisonStackRef.current = onAddPoisonStack; }, [onAddPoisonStack]);
  useEffect(() => { evasionBuffRef.current = evasionBuff; }, [evasionBuff]);
  useEffect(() => { igniteBuffRef.current = igniteBuff; }, [igniteBuff]);
  useEffect(() => { onAddIgniteStackRef.current = onAddIgniteStack; }, [onAddIgniteStack]);
  useEffect(() => { absorbBuffRef.current = absorbBuff; }, [absorbBuff]);
  useEffect(() => { onAbsorbDamageRef.current = onAbsorbDamage; }, [onAbsorbDamage]);
  useEffect(() => { sunderDebuffRef.current = sunderDebuff; }, [sunderDebuff]);
  useEffect(() => { disengageNextHitRef.current = disengageNextHit; }, [disengageNextHit]);
  useEffect(() => { onClearDisengageRef.current = onClearDisengage; }, [onClearDisengage]);
  useEffect(() => { broadcastDamageRef.current = broadcastDamage; }, [broadcastDamage]);
  useEffect(() => { broadcastHpRef.current = broadcastHp; }, [broadcastHp]);
  useEffect(() => { broadcastRewardRef.current = broadcastReward; }, [broadcastReward]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const combatBusyRef = useRef(false);

  const updateCreatureHp = useCallback((creatureId: string, hp: number) => {
    setCreatureHpOverrides(prev => {
      const next = { ...prev, [creatureId]: hp };
      creatureHpOverridesRef.current = next;
      return next;
    });
  }, []);

  const stopCombat = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    combatCreatureIdRef.current = null;
    inCombatRef.current = false;
    setActiveCombatCreatureId(null);
    setInCombat(false);
    setCreatureHpOverrides({});
    creatureHpOverridesRef.current = {};
  }, []);

  // Stop combat when player dies or node changes
  useEffect(() => {
    if (isDead) stopCombat();
  }, [isDead, stopCombat]);

  // Stop combat when node changes
  const prevNodeRef = useRef(character.current_node_id);
  useEffect(() => {
    if (character.current_node_id !== prevNodeRef.current) {
      prevNodeRef.current = character.current_node_id;
      stopCombat();
    }
  }, [character.current_node_id, stopCombat]);

  // If active creature dies (from realtime update), auto-target next aggressive or stop
  useEffect(() => {
    if (!inCombat || !activeCombatCreatureId) return;
    const target = creatures.find(c => c.id === activeCombatCreatureId);
    if (!target || !target.is_alive || target.hp <= 0) {
      // Target is dead — find next aggressive creature
      const nextAggro = creatures.find(c => c.id !== activeCombatCreatureId && c.is_alive && c.hp > 0 && c.is_aggressive);
      if (nextAggro) {
        combatCreatureIdRef.current = nextAggro.id;
        setActiveCombatCreatureId(nextAggro.id);
      } else {
        stopCombat();
      }
    }
  }, [creatures, inCombat, activeCombatCreatureId, stopCombat]);

  // After combat stops (e.g. creature killed), auto-engage next aggressive creature
  const justStoppedRef = useRef(false);
  useEffect(() => {
    if (!inCombat) {
      justStoppedRef.current = true;
    } else {
      justStoppedRef.current = false;
    }
  }, [inCombat]);

  const startCombatRef = useRef<(id: string) => void>(() => {});

  useEffect(() => {
    if (inCombat || !justStoppedRef.current || isDeadRef.current) return;
    justStoppedRef.current = false;
    const nextAggro = creatures.find(c => c.is_alive && c.hp > 0 && c.is_aggressive);
    if (nextAggro) {
      const timeout = setTimeout(() => {
        addLogRef.current(`⚠️ ${nextAggro.name} attacks!`);
        startCombatRef.current(nextAggro.id);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [creatures, inCombat]);

  const doCombatTick = useCallback(async () => {
    if (combatBusyRef.current) return;
    combatBusyRef.current = true;

    try {
      const char = characterRef.current;
      const creatureId = combatCreatureIdRef.current;
      if (!creatureId || isDeadRef.current || char.hp <= 0) {
        stopCombat();
        return;
      }

      const creature = creaturesRef.current.find(c => c.id === creatureId);
      if (!creature || !creature.is_alive || creature.hp <= 0) {
        // Will be handled by the useEffect above
        return;
      }

      const _addLog = addLogRef.current;
      const _updateCharacter = updateCharacterRef.current;
      const _degradeEquipment = degradeEquipmentRef.current;
      const _rollLoot = rollLootRef.current;
      const _party = partyRef.current;
      const _partyMembers = partyMembersRef.current;
      const _eqBonuses = equipmentBonusesRef.current;
      const _effectiveAC = effectiveACRef.current;

      const ability = CLASS_COMBAT[char.class] || CLASS_COMBAT.warrior;
      const statBonus = _eqBonuses[ability.stat] || 0;
      const atkRoll = rollD20();
      const statMod = getStatModifier((char as any)[ability.stat] + statBonus);
      const totalAtk = atkRoll + statMod;
      const statLabel = ability.stat.toUpperCase();
      const who = _party ? char.name : 'You';
      const _critBuff = critBuffRef.current;
      const critBonus = (_critBuff && Date.now() < _critBuff.expiresAt) ? _critBuff.bonus : 0;
      const effectiveCritRange = ability.critRange - critBonus;

      // Sunder Armor — reduce creature AC if active on this target
      const _sunderDebuff = sunderDebuffRef.current;
      const sunderReduction = (_sunderDebuff && Date.now() < _sunderDebuff.expiresAt && _sunderDebuff.creatureId === creatureId) ? _sunderDebuff.acReduction : 0;
      const effectiveCreatureAC = Math.max(creature.ac - sunderReduction, 0);

      if (atkRoll >= effectiveCritRange || (atkRoll !== 1 && totalAtk >= effectiveCreatureAC)) {
        const dmg = rollDamage(ability.diceMin, ability.diceMax) + statMod;
        const isCrit = atkRoll >= effectiveCritRange;
        let finalDmg = isCrit ? dmg * 2 : Math.max(dmg, 1);

        // Stealth ambush — double damage on first strike
        const _stealthBuff = stealthBuffRef.current;
        const isAmbush = _stealthBuff && Date.now() < _stealthBuff.expiresAt;
        if (isAmbush) {
          finalDmg *= 2;
          onClearStealthBuffRef.current?.();
        }

        // Arcane Surge — 1.5x damage while active
        const _damageBuff = damageBuffRef.current;
        const isDmgBuffed = _damageBuff && Date.now() < _damageBuff.expiresAt;
        if (isDmgBuffed) {
          finalDmg = Math.floor(finalDmg * 1.5);
        }

        // Disengage next-hit bonus — one-shot 50% bonus, consumed on use
        const _disengageNextHit = disengageNextHitRef.current;
        const isDisengageHit = _disengageNextHit && Date.now() < _disengageNextHit.expiresAt;
        if (isDisengageHit) {
          finalDmg = Math.floor(finalDmg * _disengageNextHit!.bonusMult);
          onClearDisengageRef.current?.();
        }

        const currentCreatureHp = creatureHpOverridesRef.current[creatureId] ?? creature.hp;
        const newHp = Math.max(currentCreatureHp - finalDmg, 0);

        const ambushPrefix = isAmbush ? '🌑 AMBUSH! ' : '';
        const surgePrefix = isDmgBuffed ? '✨ ' : '';
        const disengagePrefix = isDisengageHit ? '🦘 ' : '';
        _addLog(
          `${ambushPrefix}${disengagePrefix}${surgePrefix}${sunderReduction > 0 ? '🔨 ' : ''}${isCrit ? `${ability.emoji} CRITICAL! ` : ability.emoji + ' '}${who} ${ability.verb} ${creature.name}! Rolled ${atkRoll} + ${statMod} ${statLabel} = ${totalAtk} vs AC ${effectiveCreatureAC}${sunderReduction > 0 ? ' (Sundered -' + sunderReduction + ')' : ''} — ${finalDmg} damage.`
        );

        // Poison proc — 40% chance to add a poison stack if Envenom is active
        const _poisonBuff = poisonBuffRef.current;
        if (_poisonBuff && Date.now() < _poisonBuff.expiresAt && Math.random() < 0.4) {
          onAddPoisonStackRef.current?.(creatureId);
          _addLog(`🧪 Your poisoned blade leaves a toxic wound on ${creature.name}!`);
        }

        // Ignite proc — 40% chance to add a burn stack if Ignite is active
        const _igniteBuff = igniteBuffRef.current;
        if (_igniteBuff && Date.now() < _igniteBuff.expiresAt && Math.random() < 0.4) {
          onAddIgniteStackRef.current?.(creatureId);
          _addLog(`🔥 Your spell sets ${creature.name} ablaze!`);
        }

        if (newHp <= 0) {
          // Creature dies
          const baseXp = Math.floor(creature.level * 10 * (XP_RARITY_MULTIPLIER[creature.rarity] || 1));
          const levelDiff = Math.max(char.level - creature.level, 0);
          const xpPenalty = Math.max(1 - levelDiff * 0.2, 0.1);
          const totalXp = Math.floor(baseXp * xpPenalty);

          const lootTable = creature.loot_table as any[];
          const goldEntry = lootTable?.find((e: any) => e.type === 'gold');
          let totalGold = 0;
          if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
            totalGold = Math.floor(goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1));
          }

          updateCreatureHp(creatureId, 0);
          broadcastDamageRef.current?.(creatureId, 0, finalDmg, char.name, true);
          await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: 0, _killed: true });

          // Fresh query for party members at the same node to avoid stale ref data
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
              // Guard against undefined character_id to prevent UUID errors
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
                // Broadcast reward so the member's client refetches character data instantly
                broadcastRewardRef.current?.(m.character_id, xpShare, goldShare, creature.name);
              } catch (e) {
                console.error('Failed to award party member:', m.character_id, e);
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

            // Only increase all stats by +1 every 5th level
            if (newLevel % 5 === 0) {
              const boostedStats: string[] = [];
              for (const stat of statKeys) {
                const current = (char as any)[stat] || 10;
                (levelUpUpdates as any)[stat] = current + 1;
                boostedStats.push(stat.toUpperCase());
              }
              _addLog(`📊 All stats increased: ${boostedStats.join(', ')} +1`);
            }

            // Class bonus every 3 levels (uncapped, always applies)
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

            _addLog(`🎉 Level Up! ${who} ${_party ? 'is' : 'are'} now level ${newLevel}!`);
            logActivity(char.user_id, char.id, 'level_up', `Reached level ${newLevel}`, { level: newLevel });
            await _updateCharacter(levelUpUpdates);
          } else {
            await _updateCharacter({ xp: newXp, gold: newGold });
          }

          await _rollLoot(creature.loot_table as any[], creature.name);
          // Stop combat immediately after kill — the useEffect watching creatures
          // will auto-start combat with the next aggressive creature if any
          stopCombat();
          return;
        } else {
          updateCreatureHp(creatureId, newHp);
          broadcastDamageRef.current?.(creatureId, newHp, finalDmg, char.name, false);
          await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: newHp, _killed: false });
        }
      } else {
        _addLog(`${ability.emoji} ${who} ${ability.verb} ${creature.name} — miss! Rolled ${atkRoll} + ${statMod} ${statLabel} = ${totalAtk} vs AC ${effectiveCreatureAC}${sunderReduction > 0 ? ' (Sundered -' + sunderReduction + ')' : ''}.`);
      }

      // Creature counterattack — only fires once per round from the tank's combat loop.
      // Non-tank party members only deal damage; they don't trigger creature retaliation.
      const effectiveTankId = _party ? (_party.tank_id ?? _party.leader_id) : null;
      const iAmTheTank = !_party || effectiveTankId === char.id;

      if (!iAmTheTank) {
        // Non-tank members skip creature counterattack entirely
      } else {
      // Root debuff — reduce creature damage by 30% if active
      const _rootDebuff = rootDebuffRef.current;
      const isRooted = _rootDebuff && Date.now() < _rootDebuff.expiresAt;

      // AC buff from Battle Cry
      const _acBuff = acBuffRef.current;
      const acBuffBonus = (_acBuff && Date.now() < _acBuff.expiresAt) ? _acBuff.bonus : 0;
      const buffedAC = _effectiveAC + acBuffBonus;
      const creatureAtk = rollD20() + getStatModifier(creature.stats.str || 10);

      // When I am the tank in a party, creature hits me directly
      const tankMember = _party && effectiveTankId
        ? _partyMembers.find(m => m.character_id === effectiveTankId && m.character.current_node_id === char.current_node_id)
        : null;
      if (_party && tankMember) {
        // Use tank's actual AC (buffedAC since I am the tank)
        if (creatureAtk >= buffedAC) {
          const dmgDie = getCreatureDamageDie(creature.level, creature.rarity);
          let creatureDmg = Math.max(rollDamage(1, dmgDie) + getStatModifier(creature.stats.str || 10), 1);
          if (isRooted) creatureDmg = Math.max(Math.floor(creatureDmg * 0.7), 1);
          _addLog(`${isRooted ? '🌿 ' : ''}🛡️ ${creature.name} strikes ${tankMember.character.name} (Tank)! ${creatureDmg} damage.`);
          try {
            // Use atomic damage RPC to avoid race conditions when multiple party members
            // each redirect creature counterattacks to the same tank
            const { data: tankNewHp, error: dmgError } = await supabase.rpc('damage_party_member', {
              _character_id: tankMember.character_id,
              _damage: creatureDmg,
            });
            if (!dmgError && tankNewHp !== null) {
              broadcastHpRef.current?.(tankMember.character_id, tankNewHp, tankMember.character.hp, creature.name);
            }
            await supabase.rpc('degrade_party_member_equipment' as any, { _character_id: tankMember.character_id });
          } catch (e) {
            console.error('Failed to update tank HP/equipment:', e);
          }
        } else {
          _addLog(`${creature.name} attacks ${tankMember.character.name} (Tank) — misses!`);
        }
      } else {
        // Evasion check (Cloak of Shadows)
        const _evasionBuff = evasionBuffRef.current;
        const isEvading = _evasionBuff && Date.now() < _evasionBuff.expiresAt;
        if (isEvading && Math.random() < _evasionBuff!.dodgeChance) {
          _addLog(`🌫️ ${who} ${_party ? 'dodges' : 'dodge'} ${creature.name}'s attack from the shadows!`);
        } else if (creatureAtk >= buffedAC) {
          const dmgDie2 = getCreatureDamageDie(creature.level, creature.rarity);
          let creatureDmg = Math.max(rollDamage(1, dmgDie2) + getStatModifier(creature.stats.str || 10), 1);
          if (isRooted) creatureDmg = Math.max(Math.floor(creatureDmg * 0.7), 1);

          // Force Shield absorb check
          const _absorbBuff = absorbBuffRef.current;
          const hasShield = _absorbBuff && Date.now() < _absorbBuff.expiresAt && _absorbBuff.shieldHp > 0;
          if (hasShield) {
            const absorbed = Math.min(creatureDmg, _absorbBuff!.shieldHp);
            const remainingShield = _absorbBuff!.shieldHp - absorbed;
            const remainingDmg = creatureDmg - absorbed;
            onAbsorbDamageRef.current?.(remainingShield);
            if (remainingDmg > 0) {
              const playerNewHp = Math.max(char.hp - remainingDmg, 0);
              _addLog(`🛡️✨ Force Shield absorbs ${absorbed} damage! ${remainingDmg} damage bleeds through. (Shield broken)`);
              await _updateCharacter({ hp: playerNewHp });
              await _degradeEquipment();
              if (playerNewHp <= 0) {
                _addLog(`💀 ${who} ${_party ? 'has' : 'have'} been defeated...`);
                stopCombat();
              }
            } else {
              _addLog(`🛡️✨ Force Shield absorbs all ${absorbed} damage! (${remainingShield} shield HP left)`);
            }
          } else {
            const playerNewHp = Math.max(char.hp - creatureDmg, 0);
            _addLog(`${isRooted ? '🌿 ' : ''}${acBuffBonus > 0 ? '📯 ' : ''}${creature.name} strikes back at ${who}! Rolled ${creatureAtk} vs AC ${buffedAC} — Hit! ${creatureDmg} damage.`);
            await _updateCharacter({ hp: playerNewHp });
            await _degradeEquipment();
            if (playerNewHp <= 0) {
              _addLog(`💀 ${who} ${_party ? 'has' : 'have'} been defeated...`);
              stopCombat();
            }
          }
        } else {
          _addLog(`${acBuffBonus > 0 ? '📯 ' : ''}${creature.name} attacks ${who} — misses!${acBuffBonus > 0 ? ' (Battle Cry AC+' + acBuffBonus + ')' : ''}`);
        }
      }
      } // end iAmTheTank
    } finally {
      combatBusyRef.current = false;
    }
  }, [stopCombat]);

  const startCombat = useCallback((creatureId: string) => {
    if (isDeadRef.current || characterRef.current.hp <= 0) return;
    const creature = creaturesRef.current.find(c => c.id === creatureId);
    if (!creature || !creature.is_alive || creature.hp <= 0) return;

    // If already fighting this creature, do nothing
    if (inCombatRef.current && combatCreatureIdRef.current === creatureId) return;

    // Stop any existing combat first
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    combatCreatureIdRef.current = creatureId;
    inCombatRef.current = true;
    setActiveCombatCreatureId(creatureId);
    setInCombat(true);

    // Calculate attack speed based on DEX
    const char = characterRef.current;
    const dexMod = Math.floor((char.dex - 10) / 2);
    const attackInterval = Math.max(3000 - (dexMod * 250), 1000);

    // First tick immediately
    doCombatTick();

    // Then loop
    intervalRef.current = setInterval(() => {
      doCombatTick();
    }, attackInterval);
  }, [doCombatTick]);

  // Keep startCombatRef in sync
  useEffect(() => { startCombatRef.current = startCombat; }, [startCombat]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    inCombat,
    activeCombatCreatureId,
    creatureHpOverrides,
    updateCreatureHp,
    startCombat,
    stopCombat,
  };
}
