import { useState, useCallback, useEffect, useRef } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import CharacterPanel from '@/components/game/CharacterPanel';
import NodeView from '@/components/game/NodeView';
import MapPanel from '@/components/game/MapPanel';
import VendorPanel from '@/components/game/VendorPanel';
import BlacksmithPanel from '@/components/game/BlacksmithPanel';
import LootShareDialog, { LootDrop } from '@/components/game/LootShareDialog';

import { Character } from '@/hooks/useCharacter';
import { useNodes } from '@/hooks/useNodes';
import { usePresence } from '@/hooks/usePresence';
import { useCreatures } from '@/hooks/useCreatures';
import { useNPCs, NPC } from '@/hooks/useNPCs';
import NPCDialogPanel from '@/components/game/NPCDialogPanel';
import { useInventory } from '@/hooks/useInventory';
import { useParty } from '@/hooks/useParty';
import { usePartyCombatLog } from '@/hooks/usePartyCombatLog';
import { useCombat } from '@/hooks/useCombat';
import { rollD20, getStatModifier, rollDamage, CLASS_LEVEL_BONUSES, CLASS_LABELS, getBaseRegen } from '@/lib/game-data';
import { CLASS_COMBAT, CLASS_ABILITIES } from '@/lib/class-abilities';
import { getStatModifier as getStatMod2 } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { logActivity } from '@/hooks/useActivityLog';
import { useKeyboardMovement } from '@/hooks/useKeyboardMovement';
import { APP_VERSION } from '@/lib/version';

function getLogColor(log: string): string {
  // DoT tick messages — italic + dedicated colors to distinguish from ability procs
  if (log.includes('bleeds for') && log.startsWith('🩸')) return 'text-dot-bleed italic';
  if (log.includes('poison damage') && log.startsWith('🧪')) return 'text-dot-poison italic';
  if (log.includes('burns for') && log.startsWith('🔥')) return 'text-dot-burn italic';

  if (log.includes('CRITICAL!')) return 'text-primary font-semibold';
  if (log.startsWith('💀') || log.includes('been defeated') || log.includes('struck down')) return 'text-destructive';
  if (log.startsWith('☠️')) return 'text-elvish';
  if (log.startsWith('🎉') || log.includes('Level Up')) return 'text-primary font-semibold';
  if (log.startsWith('📈')) return 'text-primary';
  if (log.startsWith('⚠️')) return 'text-dwarvish';
  if (log.startsWith('💔')) return 'text-destructive/80';
  if (log.startsWith('💉')) return 'text-blood font-semibold';
  if (log.startsWith('💚') || log.startsWith('💪') || log.includes('restore') || log.includes('recover')) return 'text-elvish';
  if (log.startsWith('🌑')) return 'text-primary';
  if (log.startsWith('🦅')) return 'text-primary';
  if (log.startsWith('🎶') || log.startsWith('✨')) return 'text-elvish';
  if (log.startsWith('🌿')) return 'text-elvish';
  if (log.startsWith('🏹🏹')) return 'text-primary';
  if (log.startsWith('🛡️')) return 'text-dwarvish';
  if (log.startsWith('📯')) return 'text-dwarvish';
  if (log.startsWith('🩸')) return 'text-blood';
  if (log.startsWith('🧪')) return 'text-elvish';
  if (log.startsWith('🔪')) return 'text-primary font-semibold';
  if (log.startsWith('🌫️')) return 'text-primary';
  if (log.startsWith('🔥🔥') || log.startsWith('🔥')) return 'text-dwarvish';
  if (log.startsWith('🦘')) return 'text-elvish font-semibold';
  if (log.startsWith('💥')) return 'text-primary font-semibold';
  if (log.startsWith('🛡️✨')) return 'text-primary';
  if (log.startsWith('🎵💢')) return 'text-dwarvish';
  if (log.startsWith('🎶✨')) return 'text-elvish';
  if (log.startsWith('🔄🎭')) return 'text-primary font-semibold';
  if (log.startsWith('🔨')) return 'text-dwarvish font-semibold';
  if (log.includes('miss')) return 'text-muted-foreground';
  if (log.includes('damage')) return 'text-foreground/90';
  return 'text-foreground/80';
}

interface Props {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  onSignOut: () => void;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  startingNodeId?: string;
  onSwitchCharacter?: () => void;
}

export default function GamePage({ character, updateCharacter, onSignOut, isAdmin, onOpenAdmin, startingNodeId, onSwitchCharacter }: Props) {
  const { regions, nodes, loading: nodesLoading, getNode, getRegion } = useNodes(true);
  const { playersHere } = usePresence(character.current_node_id, character);
  const { creatures } = useCreatures(character.current_node_id);
  const { npcs } = useNPCs(character.current_node_id);
  const [talkingToNPC, setTalkingToNPC] = useState<NPC | null>(null);
  const { equipped, unequipped, equipmentBonuses, fetchInventory, equipItem, unequipItem, dropItem, useConsumable, inventory, beltedPotions, beltCapacity, beltPotion, unbeltPotion } = useInventory(character.id);
  const {
    party, members: partyMembers, pendingInvites, isLeader, isTank, myMembership,
    createParty, invitePlayer, acceptInvite, declineInvite,
    leaveParty, kickMember, setTank, toggleFollow, fetchParty,
  } = useParty(character.id);
  const { entries: partyCombatEntries, addPartyCombatLog } = usePartyCombatLog(party?.id ?? null);
  const [eventLog, setEventLog] = useState<string[]>(['Welcome, Wayfarer!']);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [blacksmithOpen, setBlacksmithOpen] = useState(false);
  const [pendingLoot, setPendingLoot] = useState<{ loot: LootDrop[]; creatureName: string } | null>(null);
  const [regenBuff, setRegenBuff] = useState<{ multiplier: number; expiresAt: number }>({ multiplier: 1, expiresAt: 0 });
  const [foodBuff, setFoodBuff] = useState<{ flatRegen: number; expiresAt: number }>({ flatRegen: 0, expiresAt: 0 });
  const [isDead, setIsDead] = useState(false);
  const [critBuff, setCritBuff] = useState<{ bonus: number; expiresAt: number }>({ bonus: 0, expiresAt: 0 });
  const [stealthBuff, setStealthBuff] = useState<{ expiresAt: number } | null>(null);
  const [damageBuff, setDamageBuff] = useState<{ expiresAt: number } | null>(null);
  const [rootDebuff, setRootDebuff] = useState<{ damageReduction: number; expiresAt: number } | null>(null);
  const [acBuff, setAcBuff] = useState<{ bonus: number; expiresAt: number } | null>(null);
  const [dotDebuff, setDotDebuff] = useState<{ damagePerTick: number; intervalMs: number; expiresAt: number; creatureId: string } | null>(null);
  const [poisonBuff, setPoisonBuff] = useState<{ expiresAt: number } | null>(null);
  const [poisonStacks, setPoisonStacks] = useState<Record<string, { stacks: number; damagePerTick: number; expiresAt: number }>>({});
  const [evasionBuff, setEvasionBuff] = useState<{ dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' } | null>(null);
  const [disengageNextHit, setDisengageNextHit] = useState<{ bonusMult: number; expiresAt: number } | null>(null);
  const [igniteBuff, setIgniteBuff] = useState<{ expiresAt: number } | null>(null);
  const [igniteStacks, setIgniteStacks] = useState<Record<string, { stacks: number; damagePerTick: number; expiresAt: number }>>({});
  const [absorbBuff, setAbsorbBuff] = useState<{ shieldHp: number; expiresAt: number } | null>(null);
  const [partyRegenBuff, setPartyRegenBuff] = useState<{ healPerTick: number; expiresAt: number } | null>(null);
  const [lastUsedAbilityIndex, setLastUsedAbilityIndex] = useState<number | null>(null);
  const [sunderDebuff, setSunderDebuff] = useState<{ acReduction: number; expiresAt: number; creatureId: string } | null>(null);
  const [abilityCooldownEnds, setAbilityCooldownEnds] = useState<Record<number, number>>({});
  const isDeadRef = useRef(false);
  const [deathCountdown, setDeathCountdown] = useState(3);
  const logEndRef = useRef<HTMLDivElement>(null);

  const ownLogIdsRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((msg: string) => {
    // Strip internal buff tags from the displayed message
    const displayMsg = msg.replace('[INSPIRE_BUFF]', '').trim();
    setEventLog(prev => [...prev.slice(-49), displayMsg]);
    // Also write to party combat log if in a party, and track own IDs to prevent duplicates
    (async () => {
      const id = await addPartyCombatLog(msg, character.current_node_id, character.name);
      if (id) ownLogIdsRef.current.add(id);
    })();
  }, [addPartyCombatLog, character.current_node_id, character.name]);

  // Merge party combat log entries from other players into event log
  const seenIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!party) return;
    for (const entry of partyCombatEntries) {
      if (!seenIdsRef.current.has(entry.id)) {
        seenIdsRef.current.add(entry.id);
        // Skip entries we created ourselves
        if (ownLogIdsRef.current.has(entry.id)) continue;
        // Only show entries from the same node
        if (entry.node_id && entry.node_id !== character.current_node_id) continue;

        // Replace "You" references with the character's name so it reads correctly for other players
        let msg = entry.message;
        const name = entry.character_name;
        if (name) {
          // Replace "You " at start or after emoji(s)
          msg = msg.replace(/^((?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*)*)You /u, `$1${name} `);
          // Replace " you " mid-sentence (case-insensitive)
          msg = msg.replace(/ you /gi, ` ${name} `);
          // Replace "Your " at start or after emoji(s)
          msg = msg.replace(/^((?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*)*)Your /u, `$1${name}'s `);
          // Replace " your " mid-sentence
          msg = msg.replace(/ your /gi, ` ${name}'s `);
          // Replace " you." at end
          msg = msg.replace(/ you\./gi, ` ${name}.`);
          // Replace " you!" at end
          msg = msg.replace(/ you!/gi, ` ${name}!`);
        }

        // Detect inspire buff signal from a party bard
        if (msg.includes('[INSPIRE_BUFF]')) {
          setRegenBuff({ multiplier: 2, expiresAt: Date.now() + 90000 });
          const cleanMsg = msg.replace('[INSPIRE_BUFF]', '').trim();
          setEventLog(prev => [...prev.slice(-49), cleanMsg]);
          continue;
        }
        setEventLog(prev => [...prev.slice(-49), msg]);
      }
    }
  }, [partyCombatEntries, party, character.current_node_id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [eventLog]);

  // Update last_online periodically
  useEffect(() => {
    const updateOnline = () => {
      supabase.from('characters').update({ last_online: new Date().toISOString() } as any).eq('id', character.id).then(() => {});
    };
    updateOnline();
    const interval = setInterval(updateOnline, 60000);
    return () => clearInterval(interval);
  }, [character.id]);

  // return_unique_items, regen_creature_hp, respawn_creatures run server-side via scheduled jobs

  // Regen tick visual indicator
  const [regenTick, setRegenTick] = useState(false);

  // Refs for regen to avoid stale closures resetting the timer
  const regenCharRef = useRef({ hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id, con: character.con });
  const regenBuffRef = useRef(regenBuff);
  const foodBuffRef = useRef(foodBuff);
  const getNodeRef = useRef(getNode);
  const updateCharRegenRef = useRef(updateCharacter);
  const equippedRef = useRef(equipped);
  useEffect(() => { regenCharRef.current = { hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id, con: character.con }; }, [character.hp, character.max_hp, character.current_node_id, character.con]);
  useEffect(() => { regenBuffRef.current = regenBuff; }, [regenBuff]);
  useEffect(() => { foodBuffRef.current = foodBuff; }, [foodBuff]);
  useEffect(() => { getNodeRef.current = getNode; }, [getNode]);
  useEffect(() => { updateCharRegenRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { equippedRef.current = equipped; }, [equipped]);

  // Compute item hp_regen for display
  const itemHpRegen = equipped.reduce((sum, inv) => sum + ((inv.item.stats as any)?.hp_regen || 0), 0);
  const baseRegen = getBaseRegen(character.con + (equipmentBonuses.con || 0));

  // Passive HP regeneration — CON-based + item regen, multiplied by regen buff and inn bonus
  useEffect(() => {
    const interval = setInterval(() => {
      const { hp, max_hp, current_node_id, con } = regenCharRef.current;
      if (hp < max_hp && hp > 0) {
        const buff = regenBuffRef.current;
        const potionMult = Date.now() < buff.expiresAt ? buff.multiplier : 1;
        const node = current_node_id ? getNodeRef.current(current_node_id) : null;
        const innMult = node?.is_inn ? 3 : 1;
        const totalMult = potionMult * innMult;
        const conWithGear = con + (equippedRef.current.reduce((s, inv) => s + ((inv.item.stats as any)?.con || 0), 0));
        const conRegen = getBaseRegen(conWithGear);
        const itemRegen = equippedRef.current.reduce((s, inv) => s + ((inv.item.stats as any)?.hp_regen || 0), 0);
        const food = foodBuffRef.current;
        const foodRegen = Date.now() < food.expiresAt ? food.flatRegen : 0;
        const regenAmount = Math.max(Math.floor((conRegen + itemRegen + foodRegen) * totalMult), 1);
        const newHp = Math.min(hp + regenAmount, max_hp);
        if (newHp !== hp) {
          updateCharRegenRef.current({ hp: newHp });
          setRegenTick(true);
          setTimeout(() => setRegenTick(false), 1200);
        }
      }
    }, 15000);
    return () => clearInterval(interval);
  }, []); // stable — no deps, reads from refs



  // Refs for death respawn to avoid stale closures / cleanup races
  const deathGoldRef = useRef(character.gold);
  const deathNodeRef = useRef(startingNodeId);
  const updateCharRef = useRef(updateCharacter);
  const addLogRef = useRef(addLog);
  useEffect(() => { deathGoldRef.current = character.gold; }, [character.gold]);
  useEffect(() => { deathNodeRef.current = startingNodeId; }, [startingNodeId]);
  useEffect(() => { updateCharRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { addLogRef.current = addLog; }, [addLog]);

  // Death detection and respawn — only depends on hp
  useEffect(() => {
    if (character.hp > 0 || isDeadRef.current) return;
    isDeadRef.current = true;
    setIsDead(true);
    setDeathCountdown(3);
    const countdownInterval = setInterval(() => {
      setDeathCountdown(prev => Math.max(prev - 1, 0));
    }, 1000);
    const goldLost = Math.floor(deathGoldRef.current * 0.1);
    const respawnTimeout = setTimeout(async () => {
      await updateCharRef.current({
        hp: 1,
        gold: deathGoldRef.current - goldLost,
        current_node_id: deathNodeRef.current,
      });
      addLogRef.current(`💀 You have fallen! You lost ${goldLost} gold and awaken at the starting area with 1 HP.`);
      logActivity(character.user_id, character.id, 'combat_death', `Died and lost ${goldLost} gold`, { gold_lost: goldLost });
      isDeadRef.current = false;
      setIsDead(false);
      clearInterval(countdownInterval);
    }, 3000);
    return () => { clearTimeout(respawnTimeout); clearInterval(countdownInterval); isDeadRef.current = false; };
  }, [character.hp]);

  // Sync follower's local character when leader moves them
  // The party realtime subscription updates faster than the character subscription in some cases
  useEffect(() => {
    if (!myMembership?.character?.current_node_id) return;
    if (myMembership.character.current_node_id !== character.current_node_id) {
      // Party data shows we've been moved — sync local state
      updateCharacter({ current_node_id: myMembership.character.current_node_id });
    }
  }, [myMembership?.character?.current_node_id]);

  const currentNode = character.current_node_id ? getNode(character.current_node_id) : null;


  const currentRegion = currentNode ? getRegion(currentNode.region_id) : null;

  // Effective AC including equipment
  const acBuffBonus = acBuff && Date.now() < acBuff.expiresAt ? acBuff.bonus : 0;
  const effectiveAC = character.ac + (equipmentBonuses.ac || 0) + acBuffBonus;

  // Track node entry to trigger aggressive creature auto-attacks only once per move
  const prevNodeRef = useRef<string | null>(null);
  const aggroProcessedRef = useRef<Set<string>>(new Set());
  const pendingAggroRef = useRef(false);

  // Flag that we moved to a new node — aggro should be checked once creatures load
  useEffect(() => {
    if (!character.current_node_id || character.hp <= 0) return;
    if (prevNodeRef.current === character.current_node_id) return;
    prevNodeRef.current = character.current_node_id;
    aggroProcessedRef.current = new Set();
    pendingAggroRef.current = true;
  }, [character.current_node_id, character.hp]);

  // Refs for forward-declared callbacks used by useCombat
  const rollLootRef = useRef<(lootTable: any[], creatureName: string) => Promise<void>>(async () => {});
  const degradeEquipmentRef = useRef<() => Promise<void>>(async () => {});

  const handleAddPoisonStack = useCallback((creatureId: string) => {
    const dexMod = getStatMod2(character.dex);
    const dmgPerTick = Math.max(1, Math.floor(dexMod * 1.2));
    setPoisonStacks(prev => {
      const existing = prev[creatureId];
      const newStacks = existing ? Math.min(existing.stacks + 1, 5) : 1;
      return { ...prev, [creatureId]: { stacks: newStacks, damagePerTick: dmgPerTick, expiresAt: Date.now() + 15000 } };
    });
  }, [character.dex]);

  const handleAddIgniteStack = useCallback((creatureId: string) => {
    const intMod = getStatMod2(character.int);
    const dmgPerTick = Math.max(1, Math.floor(intMod * 1.2));
    setIgniteStacks(prev => {
      const existing = prev[creatureId];
      const newStacks = existing ? Math.min(existing.stacks + 1, 5) : 1;
      const duration = Math.min(30000, 20000 + intMod * 1000);
      return { ...prev, [creatureId]: { stacks: newStacks, damagePerTick: dmgPerTick, expiresAt: Date.now() + duration } };
    });
  }, [character.int]);

  const handleAbsorbDamage = useCallback((remaining: number) => {
    setAbsorbBuff(prev => {
      if (!prev) return null;
      if (remaining <= 0) return null;
      return { ...prev, shieldHp: remaining };
    });
  }, []);

  // --- Auto-combat hook (must be before aggro effect) ---
  const { inCombat, activeCombatCreatureId, creatureHpOverrides, updateCreatureHp, startCombat, stopCombat: stopCombatFn } = useCombat({
    character,
    creatures,
    updateCharacter,
    equipmentBonuses,
    effectiveAC,
    addLog,
    rollLoot: useCallback(async (lootTable: any[], creatureName: string) => {
      await rollLootRef.current(lootTable, creatureName);
    }, []),
    degradeEquipment: useCallback(async () => {
      await degradeEquipmentRef.current();
    }, []),
    party,
    partyMembers,
    isDead,
    critBuff,
    stealthBuff,
    onClearStealthBuff: useCallback(() => setStealthBuff(null), []),
    damageBuff,
    rootDebuff,
    acBuff,
    poisonBuff,
    onAddPoisonStack: handleAddPoisonStack,
    evasionBuff,
    igniteBuff,
    onAddIgniteStack: handleAddIgniteStack,
    absorbBuff,
    onAbsorbDamage: handleAbsorbDamage,
    sunderDebuff,
    disengageNextHit,
    onClearDisengage: useCallback(() => setDisengageNextHit(null), []),
  });

  // DoT (Rend bleed) tick effect
  useEffect(() => {
    if (!dotDebuff || Date.now() >= dotDebuff.expiresAt) return;
    const interval = setInterval(async () => {
      if (Date.now() >= dotDebuff.expiresAt) {
        setDotDebuff(null);
        clearInterval(interval);
        return;
      }
      const creature = creatures.find(c => c.id === dotDebuff.creatureId);
      if (!creature || !creature.is_alive || creature.hp <= 0) {
        setDotDebuff(null);
        clearInterval(interval);
        return;
      }
      const newHp = Math.max((creatureHpOverrides[dotDebuff.creatureId] ?? creature.hp) - dotDebuff.damagePerTick, 0);
      updateCreatureHp(dotDebuff.creatureId, newHp);
      await supabase.rpc('damage_creature', { _creature_id: dotDebuff.creatureId, _new_hp: newHp, _killed: newHp <= 0 });
      addLog(`🩸 ${creature.name} bleeds for ${dotDebuff.damagePerTick} damage!`);
    }, dotDebuff.intervalMs);
    return () => clearInterval(interval);
  }, [dotDebuff, creatures, creatureHpOverrides, addLog]);

  // Poison DoT tick effect — every 3 seconds, deal cumulative poison damage per creature
  useEffect(() => {
    const activeStacks = Object.entries(poisonStacks).filter(([, s]) => Date.now() < s.expiresAt);
    if (activeStacks.length === 0) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      let anyExpired = false;
      for (const [creatureId, stack] of Object.entries(poisonStacks)) {
        if (now >= stack.expiresAt) { anyExpired = true; continue; }
        const creature = creatures.find(c => c.id === creatureId);
        if (!creature || !creature.is_alive || creature.hp <= 0) { anyExpired = true; continue; }
        const totalDmg = stack.stacks * stack.damagePerTick;
        const newHp = Math.max((creatureHpOverrides[creatureId] ?? creature.hp) - totalDmg, 0);
        updateCreatureHp(creatureId, newHp);
        await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: newHp, _killed: newHp <= 0 });
        addLog(`🧪 ${creature.name} takes ${totalDmg} poison damage! (${stack.stacks} stack${stack.stacks > 1 ? 's' : ''})`);
      }
      if (anyExpired) {
        setPoisonStacks(prev => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (Date.now() >= next[key].expiresAt) delete next[key];
            else {
              const c = creatures.find(cr => cr.id === key);
              if (!c || !c.is_alive || c.hp <= 0) delete next[key];
            }
          }
          return next;
        });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [poisonStacks, creatures, creatureHpOverrides, addLog]);

  // Ignite DoT tick effect — every 3 seconds, deal cumulative burn damage per creature
  useEffect(() => {
    const activeStacks = Object.entries(igniteStacks).filter(([, s]) => Date.now() < s.expiresAt);
    if (activeStacks.length === 0) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      let anyExpired = false;
      for (const [creatureId, stack] of Object.entries(igniteStacks)) {
        if (now >= stack.expiresAt) { anyExpired = true; continue; }
        const creature = creatures.find(c => c.id === creatureId);
        if (!creature || !creature.is_alive || creature.hp <= 0) { anyExpired = true; continue; }
        const totalDmg = stack.stacks * stack.damagePerTick;
        const newHp = Math.max((creatureHpOverrides[creatureId] ?? creature.hp) - totalDmg, 0);
        updateCreatureHp(creatureId, newHp);
        await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: newHp, _killed: newHp <= 0 });
        addLog(`🔥 ${creature.name} burns for ${totalDmg} fire damage! (${stack.stacks} stack${stack.stacks > 1 ? 's' : ''})`);
      }
      if (anyExpired) {
        setIgniteStacks(prev => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (Date.now() >= next[key].expiresAt) delete next[key];
            else {
              const c = creatures.find(cr => cr.id === key);
              if (!c || !c.is_alive || c.hp <= 0) delete next[key];
            }
          }
          return next;
        });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [igniteStacks, creatures, creatureHpOverrides, addLog]);

  // Crescendo party regen tick — heals self (and party members at same node) every 3s
  useEffect(() => {
    if (!partyRegenBuff || Date.now() >= partyRegenBuff.expiresAt) return;
    const interval = setInterval(async () => {
      if (Date.now() >= partyRegenBuff.expiresAt) {
        setPartyRegenBuff(null);
        clearInterval(interval);
        return;
      }
      const charState = regenCharRef.current;
      // Heal self
      const selfNewHp = Math.min(charState.max_hp, charState.hp + partyRegenBuff.healPerTick);
      if (selfNewHp > charState.hp) {
        await updateCharacter({ hp: selfNewHp });
      }
      // Heal party members at same node
      if (party) {
        const membersHere = partyMembers.filter(m => m.character_id !== character.id && m.character?.current_node_id === charState.current_node_id);
        for (const m of membersHere) {
          await supabase.rpc('heal_party_member', {
            _healer_id: character.id,
            _target_id: m.character_id,
            _heal_amount: partyRegenBuff.healPerTick,
          });
        }
        if (membersHere.length > 0) {
          addLog(`🎶✨ Crescendo heals ${membersHere.length + 1} allies for ${partyRegenBuff.healPerTick} HP!`);
        } else {
          addLog(`🎶✨ Crescendo heals you for ${partyRegenBuff.healPerTick} HP!`);
        }
      } else {
        addLog(`🎶✨ Crescendo heals you for ${partyRegenBuff.healPerTick} HP!`);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [partyRegenBuff, party, partyMembers, character, addLog, updateCharacter]);

  const handleAttack = useCallback((creatureId: string) => {
    if (isDead) return;
    startCombat(creatureId);
  }, [isDead, startCombat]);

  // Process aggressive creatures ONLY after a node change (pendingAggroRef) — now starts auto-combat
  useEffect(() => {
    if (!pendingAggroRef.current || !creatures.length || character.hp <= 0) return;
    pendingAggroRef.current = false;

    const aggressiveCreatures = creatures.filter(
      c => c.is_aggressive && c.is_alive && c.hp > 0 && !aggroProcessedRef.current.has(c.id)
    );
    if (aggressiveCreatures.length === 0) return;

    for (const c of aggressiveCreatures) {
      aggroProcessedRef.current.add(c.id);
    }

    const timeout = setTimeout(() => {
      if (character.hp <= 0) return;
      const firstAggro = aggressiveCreatures[0];
      if (firstAggro) {
        addLog(`⚠️ ${firstAggro.name} is aggressive and attacks you!`);
        startCombat(firstAggro.id);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [creatures, character.hp, addLog, startCombat]);

  const degradeEquipment = useCallback(async () => {
    if (equipped.length === 0) return;
    // Only 25% chance to degrade a single random equipped item per hit
    if (Math.random() > 0.25) return;
    const item = equipped[Math.floor(Math.random() * equipped.length)];
    const newDur = item.current_durability - 1;
    if (newDur <= 0) {
      if (item.item.rarity === 'unique') {
        addLog(`💔 Your ${item.item.name} shatters and its essence returns to its origin...`);
        await supabase.from('character_inventory').delete().eq('id', item.id);
      } else if (item.item.rarity === 'rare') {
        addLog(`💔 Your ${item.item.name} has broken beyond repair!`);
        await supabase.from('character_inventory').delete().eq('id', item.id);
      } else {
        addLog(`💔 Your ${item.item.name} has broken! Visit a blacksmith to repair it.`);
        await supabase.from('character_inventory').update({ current_durability: 0, equipped_slot: null, belt_slot: null } as any).eq('id', item.id);
      }
    } else {
      await supabase.from('character_inventory').update({ current_durability: newDur }).eq('id', item.id);
    }
    fetchInventory();
  }, [equipped, addLog, fetchInventory]);

  const handleMove = useCallback(async (nodeId: string, direction?: string) => {
    if (isDead) return;
    const targetNode = getNode(nodeId);
    if (!targetNode) return;
    const targetRegion = getRegion(targetNode.region_id);
    const currentRegion = character.current_node_id ? getRegion(getNode(character.current_node_id)?.region_id || '') : null;
    if (targetRegion && currentRegion && targetRegion.id !== currentRegion.id && character.level < targetRegion.min_level) {
      const levelDiff = targetRegion.min_level - character.level;
      addLog(`⚠️ You are entering ${targetRegion.name} (Lvl ${targetRegion.min_level}–${targetRegion.max_level}). These lands are ${levelDiff >= 10 ? 'extremely' : levelDiff >= 5 ? 'very' : ''} dangerous for your level!`);
    }

    // Flee message if in combat
    if (inCombat) {
      const dirLabel: Record<string, string> = { N: 'north', S: 'south', E: 'east', W: 'west', NE: 'northeast', NW: 'northwest', SE: 'southeast', SW: 'southwest' };
      const dirText = direction ? ` to the ${dirLabel[direction] || direction}` : '';
      addLog(`🏃 You flee${dirText}!`);
      stopCombatFn();
    }

    // Attack of Opportunity — each living creature gets a free strike (unless stealthed)
    const livingCreatures = creatures.filter(c => c.is_alive && c.hp > 0 && (c.is_aggressive || c.id === activeCombatCreatureId));
    let currentHp = character.hp;
    const isStealthed = stealthBuff && Date.now() < stealthBuff.expiresAt;
    if (isStealthed) {
      addLog('🌑 You slip through the shadows unnoticed...');
      setStealthBuff(null);
    } else {
      for (const creature of livingCreatures) {
        if (currentHp <= 0) break;
        const atkRoll = rollD20() + getStatModifier(creature.stats.str || 10);
        if (atkRoll >= effectiveAC) {
          const dmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
          currentHp = Math.max(currentHp - dmg, 0);
          addLog(`⚔️ ${creature.name} strikes as you flee! (Rolled ${atkRoll} vs AC ${effectiveAC}) — ${dmg} damage!`);
        } else {
          addLog(`${creature.name} swipes at you as you flee — misses! (Rolled ${atkRoll} vs AC ${effectiveAC})`);
        }
      }
    }
    if (currentHp < character.hp) {
      await updateCharacter({ hp: currentHp });
      await degradeEquipment();
    }
    if (currentHp <= 0) {
      addLog('💀 You were struck down while retreating...');
      return;
    }

    try {
      // If this player is following the leader, reset follow since they moved independently
      if (party && !isLeader && myMembership?.is_following) {
        await toggleFollow(false);
        addLog('You break away from the party leader.');
      }
      await updateCharacter({ current_node_id: nodeId });
      addLog(`You travel to ${targetNode.name}.`);
      logActivity(character.user_id, character.id, 'move', `Traveled to ${targetNode.name}`, { node_id: nodeId });
      // Move followers if I'm the party leader
      if (party && isLeader) {
        const followers = partyMembers.filter(m => m.is_following && m.character_id !== character.id);
        for (const f of followers) {
          await supabase.from('characters').update({ current_node_id: nodeId }).eq('id', f.character_id);
        }
        if (followers.length > 0) {
          addLog(`Your party follows you.`);
          // Refresh party member data so map shows updated positions
          fetchParty();
        }
      }
    } catch {
      addLog('Failed to move.');
    }
  }, [character, getNode, getRegion, updateCharacter, addLog, party, isLeader, partyMembers, creatures, effectiveAC, degradeEquipment, fetchParty, isDead, inCombat, stopCombatFn]);

  // Keyboard movement bindings — declared after handleSearch/handleUseAbility/handleUseConsumable (see below)

  const handleSearch = useCallback(async () => {
    if (isDead) return;
    if (!currentNode) return;
    const roll = rollD20();
    const searchStat = character.class === 'wizard' ? character.int : character.wis;
    const searchMod = getStatModifier(searchStat);
    const total = roll + searchMod;

    const hiddenPaths = currentNode.connections.filter(c => c.hidden);
    const searchItems = currentNode.searchable_items as any[];
    const canFindPath = total >= 10 && hiddenPaths.length > 0;
    const canFindLoot = total >= 12 && searchItems && searchItems.length > 0;

    // If both are possible, randomly pick one; otherwise whichever is available
    let tryPathFirst = canFindPath && (!canFindLoot || Math.random() < 0.5);

    if (tryPathFirst) {
      const discovered = hiddenPaths[Math.floor(Math.random() * hiddenPaths.length)];
      const targetNode = getNode(discovered.node_id);
      const targetName = targetNode?.name || 'an unknown place';
      addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You discover a hidden path to ${targetName}!`);
      if (targetNode) {
        await updateCharacter({ current_node_id: discovered.node_id });
        addLog(`You travel through the hidden path to ${targetName}.`);
      }
      return;
    }

    if (canFindLoot) {
      for (const entry of searchItems) {
        if (Math.random() <= (entry.chance || 0.5)) {
          const { data: item } = await supabase.from('items').select('name, rarity').eq('id', entry.item_id).single();
          if (item) {
            // Unique item: use atomic RPC to prevent race conditions
            if (item.rarity === 'unique') {
              const { data: acquired } = await supabase.rpc('try_acquire_unique_item', {
                p_character_id: character.id, p_item_id: entry.item_id,
              });
              if (!acquired) {
                addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — The unique power of ${item.name} is already claimed by another...`);
                return;
              }
            } else {
              await supabase.from('character_inventory').insert({
                character_id: character.id, item_id: entry.item_id, current_durability: 100,
              });
            }
            addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You found ${item.name}!`);
            logActivity(character.user_id, character.id, 'item_found', `Found ${item.name} while searching`, { item_name: item.name });
            fetchInventory();
            return;
          }
        }
      }
      addLog(`Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You rummage around but find nothing useful.`);
    } else if (canFindPath) {
      // Fallback: path was possible but we tried loot first and failed
      const discovered = hiddenPaths[Math.floor(Math.random() * hiddenPaths.length)];
      const targetNode = getNode(discovered.node_id);
      const targetName = targetNode?.name || 'an unknown place';
      addLog(`🔍 Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You discover a hidden path to ${targetName}!`);
      if (targetNode) {
        await updateCharacter({ current_node_id: discovered.node_id });
        addLog(`You travel through the hidden path to ${targetName}.`);
      }
    } else {
      addLog(`Search roll: ${roll}${searchMod >= 0 ? '+' : ''}${searchMod}=${total} — You find nothing of note.`);
    }
  }, [currentNode, character, addLog, fetchInventory, isDead, getNode, updateCharacter]);

  const rollLoot = useCallback(async (lootTable: any[], creatureName: string) => {
    if (!lootTable || lootTable.length === 0) return;
    const droppedItems: LootDrop[] = [];
    for (const entry of lootTable) {
      if (entry.type === 'gold') continue; // Gold handled separately in kill rewards
      if (Math.random() <= (entry.chance || 0.1)) {
        const { data: item } = await supabase.from('items').select('name, rarity, item_type').eq('id', entry.item_id).single();
        if (item) {
          // Unique item exclusivity check (pre-filter before loot dialog)
          if (item.rarity === 'unique') {
            const { count } = await supabase.from('character_inventory').select('id', { count: 'exact', head: true }).eq('item_id', entry.item_id);
            if (count && count > 0) {
              addLog(`✨ The unique power of ${item.name} is already claimed by another...`);
              continue;
            }
          }
          droppedItems.push({ item_id: entry.item_id, item_name: item.name, item_rarity: item.rarity, item_type: item.item_type });
          addLog(`💎 ${creatureName} dropped ${item.name}!`);
        }
      }
    }
    if (droppedItems.length === 0) return;

    // Filter party members at the same node
    const sameNodeMembers = partyMembers.filter(m => m.character.current_node_id === character.current_node_id);
    const hasPartyAtNode = party && sameNodeMembers.length > 1;

    // Split equipment vs non-equipment
    const equipmentDrops = droppedItems.filter(d => d.item_type === 'equipment');
    const nonEquipmentDrops = droppedItems.filter(d => d.item_type !== 'equipment');

    // Round-robin non-equipment items among same-node party members (or self if solo)
    const recipients = hasPartyAtNode
      ? sameNodeMembers
      : [{ character_id: character.id, character: { name: character.name } } as any];
    for (let i = 0; i < nonEquipmentDrops.length; i++) {
      const drop = nonEquipmentDrops[i];
      const recipient = recipients[i % recipients.length];
      if (drop.item_rarity === 'unique') {
        const { data: acquired } = await supabase.rpc('try_acquire_unique_item', {
          p_character_id: recipient.character_id, p_item_id: drop.item_id,
        });
        if (!acquired) {
          addLog(`✨ The unique power of ${drop.item_name} is already claimed by another...`);
          continue;
        }
      } else {
        await supabase.from('character_inventory').insert({
          character_id: recipient.character_id, item_id: drop.item_id, current_durability: 100,
        });
      }
      addLog(`📦 ${drop.item_name} → ${recipient.character.name}`);
    }

    // Show loot dialog only for the party leader; non-leaders auto round-robin equipment
    if (equipmentDrops.length > 0 && hasPartyAtNode) {
      if (party && party.leader_id === character.id) {
        setPendingLoot({ loot: equipmentDrops, creatureName });
      } else {
        // Non-leader: auto round-robin equipment to same-node members
        for (let i = 0; i < equipmentDrops.length; i++) {
          const drop = equipmentDrops[i];
          const recipient = sameNodeMembers[i % sameNodeMembers.length];
          if (drop.item_rarity === 'unique') {
            const { data: acquired } = await supabase.rpc('try_acquire_unique_item', {
              p_character_id: recipient.character_id, p_item_id: drop.item_id,
            });
            if (!acquired) {
              addLog(`✨ The unique power of ${drop.item_name} is already claimed by another...`);
              continue;
            }
          } else {
            await supabase.from('character_inventory').insert({
              character_id: recipient.character_id, item_id: drop.item_id, current_durability: 100,
            });
          }
          addLog(`📦 ${drop.item_name} → ${recipient.character.name}`);
        }
        fetchInventory();
      }
    } else if (equipmentDrops.length > 0) {
      // Solo or no party at node — auto-assign equipment to self
      for (const drop of equipmentDrops) {
        if (drop.item_rarity === 'unique') {
          const { data: acquired } = await supabase.rpc('try_acquire_unique_item', {
            p_character_id: character.id, p_item_id: drop.item_id,
          });
          if (!acquired) {
            addLog(`✨ The unique power of ${drop.item_name} is already claimed by another...`);
            continue;
          }
        } else {
          await supabase.from('character_inventory').insert({
            character_id: character.id, item_id: drop.item_id, current_durability: 100,
          });
        }
      }
      fetchInventory();
    } else {
      fetchInventory();
    }
  }, [character.id, character.current_node_id, character.name, addLog, fetchInventory, party, partyMembers]);

  const handleLootDistribute = useCallback(async (assignments: Record<string, string>) => {
    for (const [itemId, charId] of Object.entries(assignments)) {
      const lootItem = pendingLoot?.loot.find(l => l.item_id === itemId);
      if (lootItem && lootItem.item_rarity === 'unique') {
        const { data: acquired } = await supabase.rpc('try_acquire_unique_item', {
          p_character_id: charId, p_item_id: itemId,
        });
        if (!acquired) {
          addLog(`✨ The unique power of ${lootItem.item_name} is already claimed by another...`);
          continue;
        }
      } else {
        await supabase.from('character_inventory').insert({
          character_id: charId, item_id: itemId, current_durability: 100,
        });
      }
      const member = partyMembers.find(m => m.character_id === charId);
      if (lootItem && member) {
        addLog(`📦 ${lootItem.item_name} → ${member.character.name}`);
      }
    }
    setPendingLoot(null);
    fetchInventory();
  }, [pendingLoot, partyMembers, addLog, fetchInventory]);

  // Wire up refs for forward-declared callbacks
  useEffect(() => { rollLootRef.current = rollLoot; }, [rollLoot]);
  useEffect(() => { degradeEquipmentRef.current = degradeEquipment; }, [degradeEquipment]);

  const handleUseConsumable = useCallback(async (inventoryId: string) => {
    const result = await useConsumable(inventoryId, character.id, character.hp, character.max_hp, updateCharacter);
    if (result) {
      if (result.isPotion) {
        if (result.restored > 0) {
          addLog(`🧪 You used ${result.itemName} and restored ${result.restored} HP.`);
        } else {
          addLog(`🧪 You used ${result.itemName}. You are already at full health.`);
        }
        logActivity(character.user_id, character.id, 'general', `Used ${result.itemName} (+${result.restored} HP)`);
        // Potions grant a 3x regen multiplier for 2 minutes
        setRegenBuff({ multiplier: 3, expiresAt: Date.now() + 120000 });
        addLog(`✨ HP regeneration boosted for 2 minutes!`);
      } else if (result.hpRegen > 0) {
        addLog(`🍞 You consumed ${result.itemName}. +${result.hpRegen} regen for 2 minutes.`);
        logActivity(character.user_id, character.id, 'general', `Consumed ${result.itemName} (+${result.hpRegen} regen)`);
        setFoodBuff({ flatRegen: result.hpRegen, expiresAt: Date.now() + 120000 });
      }
    }
  }, [useConsumable, character.id, character.hp, character.max_hp, updateCharacter, addLog]);

  const handleUseAbility = useCallback(async (abilityIndex: number, targetId?: string) => {
    if (isDead || character.hp <= 0) return;
    const abilities = CLASS_ABILITIES[character.class];
    if (!abilities || !abilities[abilityIndex]) return;
    const ability = abilities[abilityIndex];
    if (character.level < ability.levelRequired) {
      addLog(`⚠️ ${ability.emoji} ${ability.label} unlocks at level ${ability.levelRequired}.`);
      return;
    }
    if (Date.now() < (abilityCooldownEnds[abilityIndex] || 0)) return;

    if (ability.type === 'hp_transfer') {
      if (!targetId || targetId === character.id) {
        addLog(`${ability.emoji} You must target an ally to transfer health.`);
        return;
      }
      const wisMod = getStatMod2(character.wis);
      const transferAmount = Math.max(3, wisMod * 2 + Math.floor(character.level / 2));
      const maxTransfer = character.hp - 1; // cannot kill self
      if (maxTransfer <= 0) {
        addLog(`${ability.emoji} You don't have enough HP to transfer!`);
        return;
      }
      const actualTransfer = Math.min(transferAmount, maxTransfer);
      // Deduct HP from healer
      await updateCharacter({ hp: character.hp - actualTransfer });
      // Heal target
      const { data: restored, error } = await supabase.rpc('heal_party_member', {
        _healer_id: character.id,
        _target_id: targetId,
        _heal_amount: actualTransfer,
      });
      if (error) {
        addLog(`${ability.emoji} Failed to transfer health: ${error.message}`);
        return;
      }
      const targetMember = partyMembers.find(m => m.character_id === targetId);
      const targetName = targetMember?.character.name || 'ally';
      addLog(`${ability.emoji} ${character.name} sacrifices ${actualTransfer} HP to heal ${targetName} for ${restored ?? actualTransfer} HP!`);
    } else if (ability.type === 'heal') {
      // Heal is self-only
      const wisMod = getStatMod2(character.wis);
      const healAmount = Math.max(3, wisMod * 3 + character.level);
      const newHp = Math.min(character.max_hp, character.hp + healAmount);
      const restored = newHp - character.hp;
      if (restored > 0) {
        await updateCharacter({ hp: newHp });
        addLog(`${ability.emoji} You cast Heal and restore ${restored} HP!`);
      } else {
        addLog(`${ability.emoji} You cast Heal but you're already at full health.`);
      }
    } else if (ability.type === 'self_heal') {
      const conMod = getStatMod2(character.con);
      const healAmount = Math.max(3, conMod * 3 + character.level);
      const newHp = Math.min(character.max_hp, character.hp + healAmount);
      const restored = newHp - character.hp;
      if (restored > 0) {
        await updateCharacter({ hp: newHp });
        addLog(`${ability.emoji} You use Second Wind and recover ${restored} HP!`);
      } else {
        addLog(`${ability.emoji} You use Second Wind but you're already at full health.`);
      }
    } else if (ability.type === 'regen_buff') {
      setRegenBuff({ multiplier: 2, expiresAt: Date.now() + 90000 });
      const inspireMsg = `${ability.emoji} ${character.name} plays an inspiring song! HP regeneration doubled for 90 seconds.`;
      if (party) {
        addLog(`${inspireMsg}[INSPIRE_BUFF]`);
      } else {
        addLog(inspireMsg);
      }
    } else if (ability.type === 'crit_buff') {
      const dexMod = getStatMod2(character.dex);
      const critBonus = Math.max(1, Math.min(dexMod, 5));
      const durationMs = 30000;
      setCritBuff({ bonus: critBonus, expiresAt: Date.now() + durationMs });
      addLog(`${ability.emoji} Eagle Eye! Your crit range is now ${20 - critBonus}-20 for ${durationMs / 1000}s.`);
    } else if (ability.type === 'stealth_buff') {
      const dexMod = getStatMod2(character.dex);
      const durationMs = Math.min(15000 + dexMod * 1000, 25000);
      setStealthBuff({ expiresAt: Date.now() + durationMs });
      addLog(`${ability.emoji} Shadowstep! You vanish into the shadows for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'damage_buff') {
      const intMod = getStatMod2(character.int);
      const durationMs = Math.min(25, 15 + intMod) * 1000;
      setDamageBuff({ expiresAt: Date.now() + durationMs });
      addLog(`${ability.emoji} Arcane Surge! Your spell damage is amplified for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'multi_attack') {
      if (!inCombat || !activeCombatCreatureId) {
        addLog(`${ability.emoji} You must be in combat to use Barrage!`);
        return;
      }
      const creature = creatures.find(c => c.id === activeCombatCreatureId);
      if (!creature || !creature.is_alive || creature.hp <= 0) {
        addLog(`${ability.emoji} No valid target for Barrage.`);
        return;
      }
      const combat = CLASS_COMBAT.ranger;
      const dexMod = getStatMod2(character.dex + (equipmentBonuses.dex || 0));
      const arrowCount = dexMod >= 3 ? 3 : 2;
      let totalDmg = 0;
      for (let i = 0; i < arrowCount; i++) {
        const atkRoll = rollD20();
        const totalAtk = atkRoll + dexMod;
        if (atkRoll !== 1 && (atkRoll === 20 || totalAtk >= creature.ac)) {
          const rawDmg = rollDamage(combat.diceMin, combat.diceMax) + dexMod;
          const arrowDmg = Math.max(Math.floor(rawDmg * 0.7), 1);
          totalDmg += arrowDmg;
          addLog(`${ability.emoji} Arrow ${i + 1}: Hit! Rolled ${atkRoll}+${dexMod}=${totalAtk} vs AC ${creature.ac} — ${arrowDmg} damage.`);
        } else {
          addLog(`${ability.emoji} Arrow ${i + 1}: Miss! Rolled ${atkRoll}+${dexMod}=${totalAtk} vs AC ${creature.ac}.`);
        }
      }
      if (totalDmg > 0) {
        const newHp = Math.max((creatureHpOverrides[creature.id] ?? creature.hp) - totalDmg, 0);
        await supabase.rpc('damage_creature', { _creature_id: creature.id, _new_hp: newHp, _killed: newHp <= 0 });
        addLog(`${ability.emoji} Barrage total: ${totalDmg} damage! (${arrowCount} arrows)`);
      }
    } else if (ability.type === 'root_debuff') {
      if (!inCombat || !activeCombatCreatureId) {
        addLog(`${ability.emoji} You must be in combat to use ${ability.label}!`);
        return;
      }
      const creature = creatures.find(c => c.id === activeCombatCreatureId);
      if (!creature || !creature.is_alive || creature.hp <= 0) {
        addLog(`${ability.emoji} No valid target for ${ability.label}.`);
        return;
      }
      // Bard uses CHA, Ranger uses WIS
      const scaleStat = character.class === 'bard'
        ? getStatMod2(character.cha + (equipmentBonuses.cha || 0))
        : getStatMod2(character.wis);
      const durationSec = 10 + Math.min(scaleStat, 5);
      setRootDebuff({ damageReduction: 0.3, expiresAt: Date.now() + durationSec * 1000 });
      addLog(`${ability.emoji} ${ability.label}! ${creature.name} is weakened — damage reduced by 30% for ${durationSec}s.`);
    } else if (ability.type === 'battle_cry') {
      if (!inCombat) {
        addLog(`${ability.emoji} You must be in combat to use Battle Cry!`);
        return;
      }
      const strMod = getStatMod2(character.str + (equipmentBonuses.str || 0));
      const conMod = getStatMod2(character.con + (equipmentBonuses.con || 0));
      const acBonus = Math.max(2, strMod);
      const durationSec = 20 + Math.min(conMod, 10);
      setAcBuff({ bonus: acBonus, expiresAt: Date.now() + durationSec * 1000 });
      addLog(`${ability.emoji} Battle Cry! Your AC is boosted by +${acBonus} for ${durationSec}s.`);
    } else if (ability.type === 'dot_debuff') {
      if (!inCombat || !activeCombatCreatureId) {
        addLog(`${ability.emoji} You must be in combat to use Rend!`);
        return;
      }
      const creature = creatures.find(c => c.id === activeCombatCreatureId);
      if (!creature || !creature.is_alive || creature.hp <= 0) {
        addLog(`${ability.emoji} No valid target for Rend.`);
        return;
      }
      const strMod = getStatMod2(character.str + (equipmentBonuses.str || 0));
      const dmgPerTick = Math.max(2, Math.floor(strMod * 1.5));
      const durationSec = 12 + Math.min(strMod, 6);
      setDotDebuff({ damagePerTick: dmgPerTick, intervalMs: 3000, expiresAt: Date.now() + durationSec * 1000, creatureId: creature.id });
      addLog(`${ability.emoji} Rend! ${creature.name} is bleeding for ${dmgPerTick} damage every 3s for ${durationSec}s.`);
    } else if (ability.type === 'poison_buff') {
      const dexMod = getStatMod2(character.dex + (equipmentBonuses.dex || 0));
      const durationMs = Math.min(30000, 20000 + dexMod * 1000);
      setPoisonBuff({ expiresAt: Date.now() + durationMs });
      addLog(`${ability.emoji} Envenom! Your blade drips with poison for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'execute_attack') {
      if (!inCombat || !activeCombatCreatureId) {
        addLog(`${ability.emoji} You must be in combat to use Eviscerate!`);
        return;
      }
      const creature = creatures.find(c => c.id === activeCombatCreatureId);
      if (!creature || !creature.is_alive || creature.hp <= 0) {
        addLog(`${ability.emoji} No valid target for Eviscerate.`);
        return;
      }
      const stacks = poisonStacks[activeCombatCreatureId];
      const stackCount = stacks?.stacks || 0;
      const combat = CLASS_COMBAT.rogue;
      const dexMod = getStatMod2(character.dex + (equipmentBonuses.dex || 0));
      const baseDmg = rollDamage(combat.diceMin, combat.diceMax) + dexMod;
      const multiplier = 1 + 0.5 * stackCount;
      const finalDmg = Math.max(Math.floor(baseDmg * multiplier), 1);
      const newHp = Math.max((creatureHpOverrides[creature.id] ?? creature.hp) - finalDmg, 0);
      await supabase.rpc('damage_creature', { _creature_id: creature.id, _new_hp: newHp, _killed: newHp <= 0 });
      if (stackCount > 0) {
        setPoisonStacks(prev => {
          const next = { ...prev };
          delete next[activeCombatCreatureId];
          return next;
        });
        addLog(`${ability.emoji} Eviscerate! You rip through ${creature.name} consuming ${stackCount} poison stack${stackCount > 1 ? 's' : ''} for ${finalDmg} damage!`);
      } else {
        addLog(`${ability.emoji} Eviscerate! You strike ${creature.name} for ${finalDmg} damage. (No poison stacks to consume)`);
      }
    } else if (ability.type === 'evasion_buff') {
      const dexMod = getStatMod2(character.dex + (equipmentBonuses.dex || 0));
      const durationMs = Math.min(15000, 10000 + dexMod * 500);
      setEvasionBuff({ dodgeChance: 0.5, expiresAt: Date.now() + durationMs, source: 'cloak' as const });
      addLog(`${ability.emoji} Cloak of Shadows! 50% dodge chance for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'disengage_buff') {
      const dexMod = getStatMod2(character.dex + (equipmentBonuses.dex || 0));
      const dodgeDurationMs = Math.min(8000, 5000 + dexMod * 500);
      const nextHitDurationMs = 15000; // 15s window to land the empowered strike
      setEvasionBuff({ dodgeChance: 1.0, expiresAt: Date.now() + dodgeDurationMs, source: 'disengage' as const });
      setDisengageNextHit({ bonusMult: 1.5, expiresAt: Date.now() + nextHitDurationMs });
      addLog(`${ability.emoji} Disengage! You leap back — dodging all attacks for ${Math.round(dodgeDurationMs / 1000)}s. Your next strike deals 50% bonus damage!`);
    } else if (ability.type === 'ignite_buff') {
      const intMod = getStatMod2(character.int + (equipmentBonuses.int || 0));
      const durationMs = Math.min(30000, 20000 + intMod * 1000);
      setIgniteBuff({ expiresAt: Date.now() + durationMs });
      addLog(`${ability.emoji} Ignite! Your spells burn with fire for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'ignite_consume') {
      if (!inCombat || !activeCombatCreatureId) {
        addLog(`${ability.emoji} You must be in combat to use Conflagrate!`);
        return;
      }
      const creature = creatures.find(c => c.id === activeCombatCreatureId);
      if (!creature || !creature.is_alive || creature.hp <= 0) {
        addLog(`${ability.emoji} No valid target for Conflagrate.`);
        return;
      }
      const stacks = igniteStacks[activeCombatCreatureId];
      const stackCount = stacks?.stacks || 0;
      const combat = CLASS_COMBAT.wizard;
      const intMod = getStatMod2(character.int + (equipmentBonuses.int || 0));
      const baseDmg = rollDamage(combat.diceMin, combat.diceMax) + intMod;
      const multiplier = 1 + 0.5 * stackCount;
      const finalDmg = Math.max(Math.floor(baseDmg * multiplier), 1);
      const newHp = Math.max((creatureHpOverrides[creature.id] ?? creature.hp) - finalDmg, 0);
      await supabase.rpc('damage_creature', { _creature_id: creature.id, _new_hp: newHp, _killed: newHp <= 0 });
      if (stackCount > 0) {
        setIgniteStacks(prev => {
          const next = { ...prev };
          delete next[activeCombatCreatureId];
          return next;
        });
        addLog(`${ability.emoji} Conflagrate! You detonate ${stackCount} burn stack${stackCount > 1 ? 's' : ''} on ${creature.name} for ${finalDmg} damage!`);
      } else {
        addLog(`${ability.emoji} Conflagrate! You blast ${creature.name} for ${finalDmg} damage. (No burn stacks to consume)`);
      }
    } else if (ability.type === 'absorb_buff') {
      const intMod = getStatMod2(character.int + (equipmentBonuses.int || 0));
      const shieldHp = intMod * 4 + character.level;
      const durationMs = Math.min(20000, 10000 + intMod * 1000);
      setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
      addLog(`${ability.emoji} Force Shield! Absorb shield with ${shieldHp} HP for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'party_regen') {
      // Bard scales with CHA, Healer scales with WIS
      const scaleStat = character.class === 'healer'
        ? getStatMod2(character.wis + (equipmentBonuses.wis || 0))
        : getStatMod2(character.cha + (equipmentBonuses.cha || 0));
      const healPerTick = Math.max(1, scaleStat + 2);
      const durationMs = Math.min(25000, 15000 + scaleStat * 1000);
      setPartyRegenBuff({ healPerTick, expiresAt: Date.now() + durationMs });
      const who = party ? 'your party' : 'you';
      const abilityName = character.class === 'healer' ? 'Purifying Light! Divine radiance' : 'Crescendo! A rising melody';
      addLog(`${ability.emoji} ${abilityName} heals ${who} for ${healPerTick} HP every 3s for ${Math.round(durationMs / 1000)}s.`);
    } else if (ability.type === 'ally_absorb') {
      const wisMod = getStatMod2(character.wis + (equipmentBonuses.wis || 0));
      const shieldHp = wisMod * 5 + character.level;
      const durationMs = Math.min(20000, 12000 + wisMod * 1000);
      if (targetId && targetId !== character.id) {
        // Apply shield to ally — for now we log it; the ally would need to receive this via party combat log signals
        // Since absorb state is local, we apply it to self and log the ally name for flavor
        // TODO: implement cross-player absorb via realtime signals
        setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
        const targetMember = partyMembers.find(m => m.character_id === targetId);
        const targetName = targetMember?.character.name || 'ally';
        addLog(`${ability.emoji} Divine Aegis! You shield ${targetName} with ${shieldHp} HP for ${Math.round(durationMs / 1000)}s.`);
      } else {
        setAbsorbBuff({ shieldHp, expiresAt: Date.now() + durationMs });
        addLog(`${ability.emoji} Divine Aegis! Absorb shield with ${shieldHp} HP for ${Math.round(durationMs / 1000)}s.`);
      }
    } else if (ability.type === 'sunder_debuff') {
      if (!inCombat || !activeCombatCreatureId) {
        addLog(`${ability.emoji} You must be in combat to use Sunder Armor!`);
        return;
      }
      const creature = creatures.find(c => c.id === activeCombatCreatureId);
      if (!creature || !creature.is_alive || creature.hp <= 0) {
        addLog(`${ability.emoji} No valid target for Sunder Armor.`);
        return;
      }
      const strMod = getStatMod2(character.str + (equipmentBonuses.str || 0));
      const acReduction = Math.max(2, strMod);
      const durationSec = Math.min(20, 12 + strMod);
      setSunderDebuff({ acReduction, expiresAt: Date.now() + durationSec * 1000, creatureId: activeCombatCreatureId });
      addLog(`${ability.emoji} Sunder Armor! ${creature.name}'s AC reduced by ${acReduction} for ${durationSec}s.`);
    } else if (ability.type === 'cooldown_reset') {
      if (lastUsedAbilityIndex === null) {
        addLog(`${ability.emoji} Encore! But there's no recent ability to reset.`);
      } else {
        const abilities = CLASS_ABILITIES[character.class];
        const resetAbility = abilities?.[lastUsedAbilityIndex];
        setAbilityCooldownEnds(prev => ({ ...prev, [lastUsedAbilityIndex]: 0 }));
        addLog(`${ability.emoji} Encore! ${resetAbility?.label || 'Ability'} cooldown reset!`);
      }
    }

    // Track last used ability (exclude cooldown_reset itself)
    if (ability.type !== 'cooldown_reset') {
      setLastUsedAbilityIndex(abilityIndex);
    }
    setAbilityCooldownEnds(prev => ({ ...prev, [abilityIndex]: Date.now() + ability.cooldownMs }));
  }, [isDead, character, abilityCooldownEnds, updateCharacter, addLog, party, partyMembers, inCombat, activeCombatCreatureId, creatures, equipmentBonuses, creatureHpOverrides, poisonStacks, igniteStacks, lastUsedAbilityIndex]);

  // Keyboard movement + action bindings
  const handleAbilityKey = useCallback((index: number) => {
    handleUseAbility(index);
  }, [handleUseAbility]);

  const handleBeltPotionKey = useCallback((index: number) => {
    if (beltedPotions[index]) {
      handleUseConsumable(beltedPotions[index].id);
    }
  }, [beltedPotions, handleUseConsumable]);

  const handleAttackFirst = useCallback(() => {
    if (isDead) return;
    if (inCombat) return; // already fighting
    const firstCreature = creatures.find(c => c.is_alive);
    if (firstCreature) {
      startCombat(firstCreature.id);
    }
  }, [isDead, inCombat, creatures, startCombat]);

  const keyboardMovement = useKeyboardMovement({
    currentNode,
    nodes,
    onMove: handleMove,
    disabled: isDead,
    onAttackFirst: handleAttackFirst,
    onSearch: handleSearch,
    onUseAbility: handleAbilityKey,
    onUseBeltPotion: handleBeltPotionKey,
  });


  if (nodesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <p className="font-display text-sm text-muted-foreground animate-pulse">Loading world...</p>
      </div>
    );
  }

  if (!currentNode) {
    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg">
        <div className="text-center text-muted-foreground">
          <p className="font-display text-lg">Lost in the void...</p>
          <p className="text-sm">No starting location found. A Valar must seed the world first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col parchment-bg">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50">
        <h1 className="font-display text-sm text-primary text-glow">Wayfarers of Eldara <span className="text-xs text-muted-foreground font-body ml-1">{APP_VERSION}</span></h1>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={onOpenAdmin} className="text-xs font-display">
                ⚡ Admin
              </Button>
            )}
            {onSwitchCharacter && (
              <Button variant="outline" size="sm" onClick={onSwitchCharacter} className="text-xs font-display">
                Switch Character
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onSignOut} className="text-xs text-muted-foreground">
              Sign Out
            </Button>
          </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex">
        {/* Left: Character Panel — fit content */}
        <div className="h-full w-[400px] shrink-0 ornate-border bg-card/60 overflow-y-auto">
          <CharacterPanel
            character={character}
            equipped={equipped}
            unequipped={unequipped}
            equipmentBonuses={equipmentBonuses}
            onEquip={equipItem}
            onUnequip={unequipItem}
            onDrop={dropItem}
            onUseConsumable={handleUseConsumable}
            
            isAtInn={currentNode?.is_inn ?? false}
            regenBuff={regenBuff}
            regenTick={regenTick}
            beltedPotions={beltedPotions}
            beltCapacity={beltCapacity}
            onBeltPotion={beltPotion}
            onUnbeltPotion={unbeltPotion}
            inCombat={inCombat}
            baseRegen={baseRegen}
            itemHpRegen={itemHpRegen}
            foodBuff={foodBuff}
            critBuff={critBuff}
            acBuff={acBuff}
            poisonBuff={poisonBuff}
            evasionBuff={evasionBuff}
            igniteBuff={igniteBuff}
            absorbBuff={absorbBuff}
            partyRegenBuff={partyRegenBuff}
          />
        </div>

        {/* Middle: Node + Event Log — flexible */}
        <div className="h-full flex-1 min-w-0 ornate-border bg-card/60 flex flex-col">
          <div className="flex-[2] min-h-0">
            <NodeView
              node={currentNode}
              region={currentRegion}
              players={playersHere}
              creatures={creatures}
              npcs={npcs}
              character={character}
              eventLog={eventLog}
              onSearch={handleSearch}
              onAttack={handleAttack}
              onTalkToNPC={npc => setTalkingToNPC(npc)}
              onOpenVendor={currentNode.is_vendor ? () => setVendorOpen(true) : undefined}
              onOpenBlacksmith={currentNode.is_blacksmith ? () => setBlacksmithOpen(true) : undefined}
              inCombat={inCombat}
              activeCombatCreatureId={activeCombatCreatureId}
              creatureHpOverrides={creatureHpOverrides}
              classAbilities={CLASS_ABILITIES[character.class] || []}
              abilityCooldownEnds={abilityCooldownEnds}
              onUseAbility={handleUseAbility}
              healTargets={
                party && character.class === 'healer'
                  ? partyMembers
                      .filter(m => m.character_id !== character.id && m.status === 'accepted' && m.character.current_node_id === character.current_node_id)
                      .map(m => ({ id: m.character_id, name: m.character.name, hp: m.character.hp, max_hp: m.character.max_hp }))
                  : []
              }
              beltedPotions={beltedPotions}
              onUseBeltPotion={handleUseConsumable}
              actionBindings={keyboardMovement.actionBindings}
              poisonStacks={poisonStacks}
              igniteStacks={igniteStacks}
              sunderDebuff={sunderDebuff}
            />
          </div>
          {/* Event Log - docked at bottom of middle column, 1/3 height */}
          <div className="flex-[1] min-h-0 border-t border-border px-3 py-2 flex flex-col">
            <h3 className="font-display text-xs text-muted-foreground mb-1 shrink-0">Event Log</h3>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 bg-background/30 rounded border border-border space-y-0.5">
              {eventLog.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Your journey begins...</p>
              ) : (
                eventLog.map((log, i) => (
                  <p key={i} className={`text-xs ${getLogColor(log)}`}>{log}</p>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* Right: Map + Party — fit content */}
        <div className="h-full w-[400px] shrink-0 ornate-border bg-card/60 overflow-y-auto">
          <MapPanel
            regions={regions}
            nodes={nodes}
            currentNodeId={character.current_node_id}
            currentRegionId={currentNode.region_id}
            characterLevel={character.level}
            onNodeClick={handleMove}
            partyMembers={partyMembers}
            myCharacterId={character.id}
            character={character}
            party={party}
            pendingInvites={pendingInvites}
            isLeader={isLeader}
            isTank={isTank}
            myMembership={myMembership}
            playersHere={playersHere}
            onCreateParty={createParty}
            onInvite={invitePlayer}
            onAcceptInvite={acceptInvite}
            onDeclineInvite={declineInvite}
            onLeaveParty={leaveParty}
            onKick={kickMember}
            onSetTank={setTank}
            onToggleFollow={toggleFollow}
            keyboardBindings={keyboardMovement}
          />
        </div>
      </div>


      {/* Vendor Dialog */}
      {currentNode.is_vendor && (
        <VendorPanel
          open={vendorOpen}
          onClose={() => setVendorOpen(false)}
          nodeId={currentNode.id}
          characterId={character.id}
          gold={character.gold}
          inventory={[...equipped, ...unequipped]}
          onGoldChange={(g) => updateCharacter({ gold: g })}
          onInventoryChange={fetchInventory}
          addLog={addLog}
        />
      )}

      {/* Blacksmith Dialog */}
      {currentNode.is_blacksmith && (
        <BlacksmithPanel
          open={blacksmithOpen}
          onClose={() => setBlacksmithOpen(false)}
          characterId={character.id}
          gold={character.gold}
          inventory={[...equipped, ...unequipped]}
          onGoldChange={(g) => updateCharacter({ gold: g })}
          onInventoryChange={fetchInventory}
          addLog={addLog}
        />
      )}

      {/* Loot Share Dialog — only equipment, only same-node members */}
      {pendingLoot && party && (
        <LootShareDialog
          open={true}
          loot={pendingLoot.loot}
          partyMembers={partyMembers.filter(m => m.character.current_node_id === character.current_node_id)}
          creatureName={pendingLoot.creatureName}
          onConfirm={handleLootDistribute}
        />
      )}

      {/* NPC Dialog */}
      <NPCDialogPanel npc={talkingToNPC} open={!!talkingToNPC} onClose={() => setTalkingToNPC(null)} />




      {/* Death Overlay */}
      {isDead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
          <div className="text-center space-y-4">
            <p className="font-display text-5xl text-destructive animate-pulse">💀</p>
            <p className="font-display text-2xl text-destructive">You Have Fallen</p>
            <p className="font-display text-6xl text-destructive/80 tabular-nums">{deathCountdown}</p>
            <p className="text-sm text-muted-foreground">Respawning at the starting area...</p>
            <p className="text-xs text-muted-foreground">You lost {Math.floor(deathGoldRef.current * 0.1)} gold.</p>
          </div>
        </div>
      )}
    </div>
  );
}
