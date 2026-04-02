/**
 * useMovementActions — owns movement, teleportation, waymarks, and search.
 *
 * Pure helpers are extracted at module level for readability and future testability.
 * The hook orchestrates movement flow: validation → effects → node update → followers.
 *
 * State owned: waymarkNodeId, teleportOpen
 */
import { useState, useCallback } from 'react';
import { Character } from '@/features/character';
import {
  rollD20, getStatModifier, rollDamage, getMoveCost, getCarryCapacity, getBagWeight,
} from '@/lib/game-data';
import { getNodeDisplayName } from '@/features/world';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/hooks/useActivityLog';
import { getCachedItemAsync } from '@/features/inventory';
import type { BuffState, BuffSetters } from '@/features/combat/hooks/useBuffState';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pure helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface OpportunityAttackParams {
  character: Character;
  creatures: any[];
  activeCombatCreatureId: string | null;
  buffState: BuffState;
  effectiveAC: number;
  party: any;
  partyMembers: any[];
}

interface OpportunityAttackResult {
  newHp: number;
  logs: string[];
  clearStealth: boolean;
  clearEvasion: boolean;
  newAbsorbHp: number | null; // null = clear, undefined = no change
  memberDamages: { characterId: string; damage: number; creatureName: string; maxHp: number }[];
}

/**
 * Resolve opportunity attacks when fleeing. Returns damage, logs, and shield changes
 * without performing any side effects (pure).
 */
function resolveOpportunityAttacks(params: OpportunityAttackParams): OpportunityAttackResult {
  const { character, creatures, activeCombatCreatureId, buffState, effectiveAC, party, partyMembers } = params;
  const livingCreatures = creatures.filter(c => c.is_alive && c.hp > 0 && (c.is_aggressive || c.id === activeCombatCreatureId));
  const logs: string[] = [];
  let currentHp = character.hp;
  const memberDamages: OpportunityAttackResult['memberDamages'] = [];

  const isStealthed = buffState.stealthBuff && Date.now() < buffState.stealthBuff.expiresAt;
  const isDisengaged = buffState.evasionBuff && Date.now() < buffState.evasionBuff.expiresAt && buffState.evasionBuff.source === 'disengage';

  if (isStealthed) {
    logs.push('🌑 You slip through the shadows unnoticed...');
    return { newHp: currentHp, logs, clearStealth: true, clearEvasion: false, newAbsorbHp: undefined, memberDamages };
  }
  if (isDisengaged) {
    logs.push('🦘 You leap away cleanly — no opportunity attacks!');
    return { newHp: currentHp, logs, clearStealth: false, clearEvasion: true, newAbsorbHp: undefined, memberDamages };
  }

  let currentAbsorb = buffState.absorbBuff && Date.now() < buffState.absorbBuff.expiresAt ? buffState.absorbBuff.shieldHp : 0;
  const hasEvasion = buffState.evasionBuff && Date.now() < buffState.evasionBuff.expiresAt && buffState.evasionBuff.dodgeChance > 0;
  const namePrefix = party ? character.name : 'You';
  const namePrefixLower = party ? character.name : 'you';

  for (const creature of livingCreatures) {
    if (currentHp <= 0) break;
    if (hasEvasion && Math.random() < buffState.evasionBuff!.dodgeChance) {
      logs.push(`🌫️ ${namePrefix} dodge${party ? 's' : ''} ${creature.name}'s opportunity attack!`);
      continue;
    }
    const atkRoll = rollD20() + getStatModifier(creature.stats.str || 10);
    if (atkRoll >= effectiveAC) {
      const rawDmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
      let dmgToHp = rawDmg;
      if (currentAbsorb > 0) {
        const absorbed = Math.min(currentAbsorb, rawDmg);
        currentAbsorb -= absorbed;
        dmgToHp = rawDmg - absorbed;
        if (absorbed > 0) logs.push(`🛡️ Your shield absorbs ${absorbed} damage from ${creature.name}'s opportunity attack!`);
      }
      if (dmgToHp > 0) currentHp = Math.max(currentHp - dmgToHp, 0);
      logs.push(`⚔️ ${creature.name} strikes ${namePrefixLower} while fleeing! (Rolled ${atkRoll} vs AC ${effectiveAC}) — ${rawDmg} damage${dmgToHp < rawDmg ? ` (${dmgToHp} after shield)` : ''}!`);
    } else {
      logs.push(`${creature.name} swipes at ${namePrefixLower} while fleeing — misses! (Rolled ${atkRoll} vs AC ${effectiveAC})`);
    }
  }

  // Party opportunity attacks
  if (party && livingCreatures.length > 0) {
    const membersHere = partyMembers.filter(
      m => m.character_id !== character.id && m.character.current_node_id === character.current_node_id && m.character.hp > 0
    );
    for (const member of membersHere) {
      for (const creature of livingCreatures) {
        const atkRoll = rollD20() + getStatModifier(creature.stats.str || 10);
        const memberAC = 10;
        if (atkRoll >= memberAC) {
          const dmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
          logs.push(`⚔️ ${creature.name} strikes ${member.character.name} while fleeing! (Rolled ${atkRoll}) — ${dmg} damage!`);
          memberDamages.push({ characterId: member.character_id, damage: dmg, creatureName: creature.name, maxHp: member.character.max_hp });
        } else {
          logs.push(`${creature.name} swipes at ${member.character.name} while fleeing — misses!`);
        }
      }
    }
  }

  // Determine absorb shield final state
  let newAbsorbHp: number | null | undefined = undefined;
  if (buffState.absorbBuff && Date.now() < buffState.absorbBuff.expiresAt) {
    if (currentAbsorb <= 0) newAbsorbHp = null;
    else if (currentAbsorb !== buffState.absorbBuff.shieldHp) newAbsorbHp = currentAbsorb;
  }

  return { newHp: currentHp, logs, clearStealth: false, clearEvasion: false, newAbsorbHp: newAbsorbHp as number | null, memberDamages };
}

/** Move followers to a node (shared by handleMove, handleTeleport, handleReturnToWaymark) */
async function moveFollowers(
  partyMembers: any[],
  characterId: string,
  currentNodeId: string,
  targetNodeId: string,
  isLeader: boolean,
  filterFollowingOnly: boolean,
  addLog: (msg: string) => void,
  fetchParty: () => void,
  broadcastMove?: (charId: string, charName: string, nodeId: string) => void,
): Promise<void> {
  if (!isLeader) return;
  const coLocated = partyMembers.filter(m =>
    m.character_id !== characterId && m.status === 'accepted' &&
    m.character.current_node_id === currentNodeId
  );
  const toMove = filterFollowingOnly ? coLocated.filter(m => m.is_following) : coLocated;
  if (toMove.length > 0) {
    await Promise.all(toMove.map(f =>
      supabase.from('characters').update({ current_node_id: targetNodeId }).eq('id', f.character_id)
    ));
    if (broadcastMove) {
      for (const f of toMove) {
        broadcastMove(f.character_id, f.character.name, targetNodeId);
      }
    }
    addLog('Your party follows you.');
    fetchParty();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Params interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UseMovementActionsParams {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  addLog: (msg: string) => void;
  equipped: { id: string; item_id: string; item: { stats: any; name: string; rarity: string; item_type: string; [k: string]: any }; current_durability: number; [k: string]: any }[];
  unequipped: { id: string; item_id: string; item: { stats: any; name: string; rarity: string; item_type: string; [k: string]: any }; belt_slot: number | null; [k: string]: any }[];
  equipmentBonuses: Record<string, number>;
  getNode: (id: string) => any;
  getRegion: (id: string) => any;
  getNodeArea: (node: any) => any;
  currentNode: any;
  creatures: any[];
  party: any;
  partyMembers: any[];
  isLeader: boolean;
  myMembership: any;
  inCombat: boolean;
  activeCombatCreatureId: string | null;
  fleeStopCombat: () => void;
  effectiveAC: number;
  isDead: boolean;
  broadcastMove: (charId: string, charName: string, nodeId: string) => void;
  broadcastHp: (charId: string, hp: number, maxHp: number, source: string) => void;
  toggleFollow: (v: boolean) => Promise<void>;
  fetchInventory: () => void;
  fetchParty: () => void;
  buffState: BuffState;
  buffSetters: BuffSetters;
  degradeEquipment: () => Promise<void>;
  unlockedConnections?: Map<string, number>;
  onUnlockPath?: (direction: string, nodeId: string, expires: number) => void;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Hook
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function useMovementActions(params: UseMovementActionsParams) {
  const p = params;
  const [waymarkNodeId, setWaymarkNodeId] = useState<string | null>(null);
  const [teleportOpen, setTeleportOpen] = useState(false);

  // ── Movement ───────────────────────────────────────────────────
  const handleMove = useCallback(async (nodeId: string, direction?: string) => {
    if (p.isDead) return;

    // ── Locked connection check ──
    if (direction && p.currentNode) {
      const conn = (p.currentNode.connections as any[])?.find(
        (c: any) => c.node_id === nodeId && c.direction === direction
      );
      if (conn?.locked) {
        const unlockKey = `${p.currentNode.id}-${direction}`;
        const unlockExpiry = p.unlockedConnections?.get(unlockKey);
        if (!unlockExpiry || Date.now() > unlockExpiry) {
          const allItems = [...p.equipped, ...p.unequipped];
          const hasKey = allItems.some(
            inv => inv.item?.name?.toLowerCase() === (conn.lock_key || '').toLowerCase()
          );
          if (!hasKey) {
            p.addLog(`🔒 This path is locked. You need a "${conn.lock_key}" to pass.`);
            return;
          }
          const expires = Date.now() + 30_000;
          p.onUnlockPath?.(direction, nodeId, expires);
          p.addLog(`🔓 You use your ${conn.lock_key} to unlock the path...`);
        }
      }
    }

    // ── MP / encumbrance check ──
    const effectiveStr = p.character.str + (p.equipmentBonuses.str || 0);
    const bagItems = p.unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined);
    const bagWeight = getBagWeight(bagItems);
    const moveCost = getMoveCost(bagWeight, effectiveStr);
    if ((p.character.mp ?? 100) < moveCost) {
      p.addLog(`⚠️ You are too exhausted to move! Need ${moveCost} MP to move.`);
      return;
    }
    const capacity = getCarryCapacity(effectiveStr);
    if (bagWeight > capacity) {
      p.addLog(`⚠️ Over-encumbered! Carrying ${bagWeight}/${capacity} weight — movement costs ${moveCost} MP.`);
    }

    // ── Region level check ──
    const targetNode = p.getNode(nodeId);
    if (!targetNode) return;
    const targetRegion = p.getRegion(targetNode.region_id);
    const currentRegion = p.character.current_node_id ? p.getRegion(p.getNode(p.character.current_node_id)?.region_id || '') : null;
    if (targetRegion && currentRegion && targetRegion.id !== currentRegion.id && p.character.level < targetRegion.min_level) {
      const levelDiff = targetRegion.min_level - p.character.level;
      p.addLog(`⚠️ You are entering ${targetRegion.name} (Lvl ${targetRegion.min_level}–${targetRegion.max_level}). These lands are ${levelDiff >= 10 ? 'extremely' : levelDiff >= 5 ? 'very' : ''} dangerous for your level!`);
    }

    // ── Flee from combat ──
    if (p.inCombat) {
      const dirLabel: Record<string, string> = { N: 'north', S: 'south', E: 'east', W: 'west', NE: 'northeast', NW: 'northwest', SE: 'southeast', SW: 'southwest' };
      const dirText = direction ? ` to the ${dirLabel[direction] || direction}` : '';
      p.addLog(`🏃 You flee${dirText}!`);
      p.fleeStopCombat();
    }

    // ── Opportunity attacks (delegated to pure helper) ──
    const oaResult = resolveOpportunityAttacks({
      character: p.character,
      creatures: p.creatures,
      activeCombatCreatureId: p.activeCombatCreatureId,
      buffState: p.buffState,
      effectiveAC: p.effectiveAC,
      party: p.party,
      partyMembers: p.partyMembers,
    });
    for (const log of oaResult.logs) p.addLog(log);
    if (oaResult.clearStealth) p.buffSetters.setStealthBuff(null);
    if (oaResult.clearEvasion) p.buffSetters.setEvasionBuff(null);
    if (oaResult.newAbsorbHp === null) p.buffSetters.setAbsorbBuff(null);
    else if (oaResult.newAbsorbHp !== undefined && p.buffState.absorbBuff) {
      p.buffSetters.setAbsorbBuff({ ...p.buffState.absorbBuff, shieldHp: oaResult.newAbsorbHp });
    }

    // Apply party member opportunity attack damage
    for (const md of oaResult.memberDamages) {
      try {
        const { data: newHp } = await supabase.rpc('damage_party_member', { _character_id: md.characterId, _damage: md.damage });
        if (newHp !== null) p.broadcastHp?.(md.characterId, newHp, md.maxHp, md.creatureName);
      } catch (e) { console.error('Failed to apply opportunity attack to party member:', e); }
    }

    if (oaResult.newHp < p.character.hp) {
      await p.updateCharacter({ hp: oaResult.newHp });
      await p.degradeEquipment();
    }
    if (oaResult.newHp <= 0) {
      p.addLog('💀 You were struck down while retreating...');
      return;
    }

    // ── Execute move ──
    try {
      if (p.party && !p.isLeader && p.myMembership?.is_following) {
        await p.toggleFollow(false);
        p.addLog('You break away from the party leader.');
      }
      await p.updateCharacter({ current_node_id: nodeId, mp: Math.max((p.character.mp ?? 100) - moveCost, 0) });
      p.broadcastMove(p.character.id, p.character.name, nodeId);
      supabase.from('character_visited_nodes').upsert(
        { character_id: p.character.id, node_id: nodeId },
        { onConflict: 'character_id,node_id' }
      ).then();
      const dirNames: Record<string, string> = { N: 'North', S: 'South', E: 'East', W: 'West', NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest' };
      const dirLabel = direction ? (dirNames[direction] || direction) : null;
      const targetArea = p.getNodeArea(targetNode);
      const moveName = getNodeDisplayName(targetNode, targetArea);
      p.addLog(`You travel ${dirLabel || moveName}.`);
      logActivity(p.character.user_id, p.character.id, 'move', `Traveled ${dirLabel || 'to ' + moveName}`, { node_id: nodeId });

      // Move followers
      await moveFollowers(p.partyMembers, p.character.id, p.character.current_node_id!, nodeId, p.isLeader, true, p.addLog, p.fetchParty);
    } catch {
      p.addLog('Failed to move.');
    }
  }, [p.character, p.getNode, p.getRegion, p.updateCharacter, p.addLog, p.party, p.isLeader, p.partyMembers, p.creatures, p.effectiveAC, p.degradeEquipment, p.fetchParty, p.isDead, p.inCombat, p.fleeStopCombat, p.buffState, p.buffSetters, p.equipped, p.unequipped, p.equipmentBonuses, p.currentNode, p.unlockedConnections, p.onUnlockPath, p.activeCombatCreatureId, p.myMembership, p.toggleFollow, p.broadcastMove, p.broadcastHp, p.getNodeArea, p.fetchInventory]);

  // ── Teleport ───────────────────────────────────────────────────
  const handleTeleport = useCallback(async (nodeId: string, cpCost: number) => {
    if (p.isDead) return;
    if (p.inCombat) { p.addLog('⚠️ You cannot teleport while in combat!'); return; }
    const effectiveCpCost = p.character.level >= 39 ? Math.ceil(cpCost * 0.9) : cpCost;
    if ((p.character.cp ?? 0) < effectiveCpCost) { p.addLog('⚠️ Not enough CP to teleport.'); return; }
    const targetNode = p.getNode(nodeId);
    if (!targetNode) return;
    const currentNodeObj = p.getNode(p.character.current_node_id!);
    if (currentNodeObj && !currentNodeObj.is_teleport && p.character.level >= 25) {
      setWaymarkNodeId(p.character.current_node_id!);
      p.addLog(`📍 You leave a hidden waymark at ${currentNodeObj.name}.`);
    }
    const prevNodeId = p.character.current_node_id!;
    await p.updateCharacter({ current_node_id: nodeId, cp: (p.character.cp ?? 0) - effectiveCpCost });
    p.broadcastMove(p.character.id, p.character.name, nodeId);
    supabase.from('character_visited_nodes').upsert(
      { character_id: p.character.id, node_id: nodeId },
      { onConflict: 'character_id,node_id' }
    ).then();
    p.addLog(`🌀 You teleport to ${targetNode.name} for ${effectiveCpCost} CP.`);
    logActivity(p.character.user_id, p.character.id, 'teleport', `Teleported to ${targetNode.name}`, { node_id: nodeId, cpCost });
    setTeleportOpen(false);

    // Move co-located party members (level 25+ moves all, otherwise only followers)
    const filterFollowingOnly = p.character.level < 25;
    await moveFollowers(p.partyMembers, p.character.id, prevNodeId, nodeId, p.isLeader, filterFollowingOnly, p.addLog, p.fetchParty);
  }, [p.character, p.getNode, p.updateCharacter, p.addLog, p.broadcastMove, p.party, p.isLeader, p.partyMembers, p.fetchParty, p.isDead, p.inCombat]);

  // ── Return to Waymark ──────────────────────────────────────────
  const handleReturnToWaymark = useCallback(async (cpCost: number) => {
    if (!waymarkNodeId) return;
    const waymarkNode = p.getNode(waymarkNodeId);
    if (!waymarkNode) { p.addLog('⚠️ Your waymark has faded.'); setWaymarkNodeId(null); return; }
    if (p.isDead) return;
    if (p.inCombat) { p.addLog('⚠️ You cannot teleport while in combat!'); return; }
    const effectiveWayCost = p.character.level >= 39 ? Math.ceil(cpCost * 0.9) : cpCost;
    if ((p.character.cp ?? 0) < effectiveWayCost) { p.addLog('⚠️ Not enough CP to return to waymark.'); return; }
    const prevNodeId = p.character.current_node_id!;
    await p.updateCharacter({ current_node_id: waymarkNodeId, cp: (p.character.cp ?? 0) - effectiveWayCost });
    p.broadcastMove(p.character.id, p.character.name, waymarkNodeId);
    supabase.from('character_visited_nodes').upsert(
      { character_id: p.character.id, node_id: waymarkNodeId },
      { onConflict: 'character_id,node_id' }
    ).then();
    p.addLog(`📍 You return to your waymark at ${waymarkNode.name} for ${effectiveWayCost} CP.`);
    logActivity(p.character.user_id, p.character.id, 'teleport', `Returned to waymark at ${waymarkNode.name}`, { node_id: waymarkNodeId, cpCost });
    setWaymarkNodeId(null);
    setTeleportOpen(false);

    await moveFollowers(p.partyMembers, p.character.id, prevNodeId, waymarkNodeId, p.isLeader, false, p.addLog, p.fetchParty);
  }, [waymarkNodeId, p.character, p.getNode, p.updateCharacter, p.addLog, p.broadcastMove, p.party, p.isLeader, p.partyMembers, p.fetchParty, p.isDead, p.inCombat]);

  // ── Search ─────────────────────────────────────────────────────
  const SEARCH_CP_COST = 5;
  const handleSearch = useCallback(async () => {
    if (p.isDead) return;
    if (!p.currentNode) return;
    if (p.creatures && p.creatures.length > 0) {
      p.addLog('❌ You cannot search while creatures are nearby!');
      return;
    }
    if ((p.character.cp ?? 0) < SEARCH_CP_COST) {
      p.addLog('❌ Not enough CP to search! (Need 5 CP)');
      return;
    }
    const newCp = (p.character.cp ?? 0) - SEARCH_CP_COST;
    await supabase.from('characters').update({ cp: newCp }).eq('id', p.character.id);
    p.updateCharacter({ cp: newCp });
    const roll = rollD20();
    const searchStat = p.character.class === 'wizard' ? p.character.int : p.character.wis;
    const searchMod = getStatModifier(searchStat);
    const total = roll + searchMod;
    const hiddenPaths = p.currentNode.connections.filter((c: any) => c.hidden);
    const searchItems = p.currentNode.searchable_items as any[];
    const canFindPath = total >= 10 && hiddenPaths.length > 0;
    const canFindLoot = total >= 12 && searchItems && searchItems.length > 0;
    let tryPathFirst = canFindPath && (!canFindLoot || Math.random() < 0.5);
    if (tryPathFirst) {
      const discovered = hiddenPaths[Math.floor(Math.random() * hiddenPaths.length)];
      const targetNode = p.getNode(discovered.node_id);
      const targetName = targetNode?.name || 'an unknown place';
      p.addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You discover a hidden path to ${targetName}!`);
      if (targetNode) {
        await p.updateCharacter({ current_node_id: discovered.node_id });
        p.addLog(`You travel through the hidden path to ${targetName}.`);
      }
      return;
    }
    if (canFindLoot) {
      for (const entry of searchItems) {
        if (Math.random() <= (entry.chance || 0.5)) {
          const item = await getCachedItemAsync(entry.item_id);
          if (item) {
            if (item.rarity === 'unique') {
              const { data: acquired } = await supabase.rpc('try_acquire_unique_item', {
                p_character_id: p.character.id, p_item_id: entry.item_id,
              });
              if (!acquired) {
                p.addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — The unique power of ${item.name} is already claimed by another...`);
                return;
              }
            } else {
              await supabase.from('character_inventory').insert({
                character_id: p.character.id, item_id: entry.item_id, current_durability: 100,
              });
            }
            p.addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You found ${item.name}!`);
            logActivity(p.character.user_id, p.character.id, 'item_found', `Found ${item.name} while searching`, { item_name: item.name });
            p.fetchInventory();
            return;
          }
        }
      }
      p.addLog(`Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You rummage around but find nothing useful.`);
    } else if (canFindPath) {
      const discovered = hiddenPaths[Math.floor(Math.random() * hiddenPaths.length)];
      const targetNode = p.getNode(discovered.node_id);
      const targetName = targetNode?.name || 'an unknown place';
      p.addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You discover a hidden path to ${targetName}!`);
      if (targetNode) {
        await p.updateCharacter({ current_node_id: discovered.node_id });
        p.addLog(`You travel through the hidden path to ${targetName}.`);
      }
    } else {
      p.addLog(`Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You find nothing of note.`);
    }
  }, [p.currentNode, p.character, p.addLog, p.fetchInventory, p.isDead, p.getNode, p.updateCharacter, p.creatures]);

  return {
    handleMove, handleTeleport, handleReturnToWaymark, handleSearch,
    waymarkNodeId, teleportOpen, setTeleportOpen,
  };
}
