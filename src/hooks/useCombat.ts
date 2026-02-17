import { useState, useCallback, useEffect, useRef } from 'react';
import { Character } from '@/hooks/useCharacter';
import { Creature } from '@/hooks/useCreatures';
import { rollD20, getStatModifier, rollDamage, CLASS_LEVEL_BONUSES, CLASS_LABELS } from '@/lib/game-data';
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
}: UseCombatParams) {
  const [activeCombatCreatureId, setActiveCombatCreatureId] = useState<string | null>(null);
  const [inCombat, setInCombat] = useState(false);
  const [creatureHpOverrides, setCreatureHpOverrides] = useState<Record<string, number>>({});

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

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const combatBusyRef = useRef(false);

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

      if (atkRoll >= effectiveCritRange || (atkRoll !== 1 && totalAtk >= creature.ac)) {
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

        const newHp = Math.max(creature.hp - finalDmg, 0);

        const ambushPrefix = isAmbush ? '🌑 AMBUSH! ' : '';
        const surgePrefix = isDmgBuffed ? '✨ ' : '';
        _addLog(
          `${ambushPrefix}${surgePrefix}${isCrit ? `${ability.emoji} CRITICAL! ` : ability.emoji + ' '}${who} ${ability.verb} ${creature.name}! Rolled ${atkRoll} + ${statMod} ${statLabel} = ${totalAtk} vs AC ${creature.ac} — ${finalDmg} damage.`
        );

        if (newHp <= 0) {
          // Creature dies
          const baseXp = creature.level * 10;
          const levelDiff = Math.max(char.level - creature.level, 0);
          const xpPenalty = Math.max(1 - levelDiff * 0.2, 0.1);
          const totalXp = Math.floor(baseXp * xpPenalty);

          const lootTable = creature.loot_table as any[];
          const goldEntry = lootTable?.find((e: any) => e.type === 'gold');
          let totalGold = 0;
          if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
            totalGold = Math.floor(goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1));
          }

          setCreatureHpOverrides(prev => ({ ...prev, [creatureId]: 0 }));
          await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: 0, _killed: true });

          const membersHere = _party
            ? _partyMembers.filter(m => m.character?.current_node_id === char.current_node_id)
            : [];
          const splitCount = membersHere.length > 1 ? membersHere.length : 1;
          const xpShare = Math.floor(totalXp / splitCount);
          const goldShare = Math.floor(totalGold / splitCount);

          const penaltyNote = xpPenalty < 1 ? ` (${Math.round(xpPenalty * 100)}% XP — level penalty)` : '';
          const goldNote = goldShare > 0 ? `, +${goldShare} gold` : '';
          if (splitCount > 1) {
            _addLog(`☠️ ${creature.name} has been slain! Rewards split ${splitCount} ways: +${xpShare} XP${goldNote} each.${penaltyNote}`);
            for (const m of membersHere) {
              if (m.character_id === char.id) continue;
              await supabase.rpc('award_party_member', {
                _character_id: m.character_id,
                _xp: xpShare,
                _gold: goldShare,
              });
            }
          } else {
            _addLog(`☠️ ${creature.name} has been slain! (+${xpShare} XP${goldNote})${penaltyNote}`);
          }

          logActivity(char.user_id, char.id, 'combat_kill', `Slew ${creature.name} (Lvl ${creature.level}) +${xpShare} XP`, {
            creature_name: creature.name, creature_level: creature.level, xp: xpShare, gold: goldShare,
          });

          const newXp = char.xp + xpShare;
          const newGold = char.gold + goldShare;
          const xpForNext = char.level * 100;
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

            // Only increase all stats by +1 before level 30
            if (newLevel < 30) {
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
          setCreatureHpOverrides(prev => ({ ...prev, [creatureId]: newHp }));
          await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: newHp, _killed: false });
        }
      } else {
        _addLog(`${ability.emoji} ${who} ${ability.verb} ${creature.name} — miss! Rolled ${atkRoll} + ${statMod} ${statLabel} = ${totalAtk} vs AC ${creature.ac}.`);
      }

      // Creature counterattack
      const tankMember = _party && _party.tank_id && _party.tank_id !== char.id
        ? _partyMembers.find(m => m.character_id === _party.tank_id)
        : null;
      const creatureAtk = rollD20() + getStatModifier(creature.stats.str || 10);
      if (tankMember) {
        const tankAC = 10;
        if (creatureAtk >= tankAC) {
          const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
          const tankNewHp = Math.max(tankMember.character.hp - creatureDmg, 0);
          _addLog(`🛡️ ${creature.name} strikes ${tankMember.character.name} (Tank)! ${creatureDmg} damage.`);
          await supabase.rpc('update_party_member_hp', { _character_id: tankMember.character_id, _new_hp: tankNewHp });
        } else {
          _addLog(`${creature.name} attacks ${tankMember.character.name} (Tank) — misses!`);
        }
      } else {
        if (creatureAtk >= _effectiveAC) {
          const creatureDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
          const playerNewHp = Math.max(char.hp - creatureDmg, 0);
          _addLog(`${creature.name} strikes back at ${who}! Rolled ${creatureAtk} vs AC ${_effectiveAC} — Hit! ${creatureDmg} damage.`);
          await _updateCharacter({ hp: playerNewHp });
          await _degradeEquipment();
          if (playerNewHp <= 0) {
            _addLog(`💀 ${who} ${_party ? 'has' : 'have'} been defeated...`);
            stopCombat();
          }
        } else {
          _addLog(`${creature.name} attacks ${who} — misses!`);
        }
      }
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
    startCombat,
    stopCombat,
  };
}
