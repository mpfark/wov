import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import CharacterPanel from '@/components/game/CharacterPanel';
import NodeView from '@/components/game/NodeView';
import MapPanel from '@/components/game/MapPanel';
import VendorPanel from '@/components/game/VendorPanel';
import BlacksmithPanel from '@/components/game/BlacksmithPanel';
import TeleportDialog from '@/components/game/TeleportDialog';
import { useGroundLoot } from '@/hooks/useGroundLoot';

import { Character } from '@/hooks/useCharacter';
import { useNodes, getNodeDisplayName } from '@/hooks/useNodes';
import { usePresence } from '@/hooks/usePresence';
import { useGlobalPresence } from '@/hooks/useGlobalPresence';
import OnlinePlayersDialog from '@/components/game/OnlinePlayersDialog';
import { useCreatures } from '@/hooks/useCreatures';
import { useCreatureBroadcast } from '@/hooks/useCreatureBroadcast';
import { usePartyBroadcast } from '@/hooks/usePartyBroadcast';
import { useNPCs, NPC } from '@/hooks/useNPCs';
import NPCDialogPanel from '@/components/game/NPCDialogPanel';
import { useInventory } from '@/hooks/useInventory';
import { useParty } from '@/hooks/useParty';
import { usePartyCombatLog } from '@/hooks/usePartyCombatLog';
import { useCombat } from '@/hooks/useCombat';
import { rollD20, getStatModifier, rollDamage, CLASS_LEVEL_BONUSES, CLASS_LABELS, getBaseRegen, CLASS_PRIMARY_STAT, getCpRegenRate, XP_RARITY_MULTIPLIER, getXpForLevel, getXpPenalty, getMaxCp, getMaxMp, getMpRegenRate } from '@/lib/game-data';
import { CLASS_COMBAT, CLASS_ABILITIES, UNIVERSAL_ABILITIES } from '@/lib/class-abilities';
import { getStatModifier as getStatMod2 } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { logActivity } from '@/hooks/useActivityLog';
import { useKeyboardMovement } from '@/hooks/useKeyboardMovement';
import { useChat } from '@/hooks/useChat';
import { useXpBoost } from '@/hooks/useXpBoost';
import { APP_VERSION } from '@/lib/version';
import { Input } from '@/components/ui/input';

function getLogColor(log: string): string {
  // Chat messages
  if (log.startsWith('💬')) return 'text-foreground';
  if (log.startsWith('🤫 To ')) return 'text-purple-400/70';
  if (log.startsWith('🤫')) return 'text-purple-400';

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
  if (log.startsWith('🎯')) return 'text-primary font-semibold';
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
  const { regions, nodes, areas, loading: nodesLoading, getNode, getRegion, getNodeArea } = useNodes(true);
  const { playersHere } = usePresence(character.current_node_id, character);
  const { onlinePlayers } = useGlobalPresence(character);
  const { creatures } = useCreatures(character.current_node_id);
  const { broadcastOverrides, broadcastDamage, cleanupOverrides } = useCreatureBroadcast(character.current_node_id, character.id);

  // Clean up stale broadcast overrides when creature list changes (respawns, deaths)
  useEffect(() => {
    cleanupOverrides(creatures.map(c => c.id));
  }, [creatures, cleanupOverrides]);
  const { npcs } = useNPCs(character.current_node_id);
  const { xpMultiplier, xpBoostExpiresAt } = useXpBoost();
  const [talkingToNPC, setTalkingToNPC] = useState<NPC | null>(null);
  const { equipped, unequipped, equipmentBonuses, fetchInventory, equipItem, unequipItem, dropItem, useConsumable, inventory, beltedPotions, beltCapacity, beltPotion, unbeltPotion } = useInventory(character.id);
  // Party broadcast must be initialized before useParty merge, but needs partyId
  // Solution: useParty returns raw party first, broadcast hooks use it, then useParty merges
  const {
    party, members: partyMembers, pendingInvites, isLeader, isTank, myMembership,
    createParty, invitePlayer, acceptInvite, declineInvite,
    leaveParty, kickMember, setTank, toggleFollow, fetchParty,
  } = useParty(character.id);
  const { entries: partyCombatEntries, addPartyCombatLog } = usePartyCombatLog(party?.id ?? null);
  const {
    hpOverrides: partyHpOverrides,
    moveEvents: partyMoveEvents,
    broadcastLogEntries,
    rewardEvents: partyRewardEvents,
    broadcastHp,
    broadcastMove,
    broadcastCombatMsg,
    broadcastReward,
  } = usePartyBroadcast(party?.id ?? null, character.id);

  // Broadcast own HP whenever it changes so party members see updates instantly (throttled)
  const lastBroadcastedHpRef = useRef<{ hp: number; max_hp: number } | null>(null);
  useEffect(() => {
    if (!party || !character) return;
    const last = lastBroadcastedHpRef.current;
    if (last && last.hp === character.hp && last.max_hp === character.max_hp) return;
    lastBroadcastedHpRef.current = { hp: character.hp, max_hp: character.max_hp };
    broadcastHp(character.id, character.hp, character.max_hp, 'sync');
  }, [party, character?.hp, character?.max_hp, broadcastHp]);

  // Merge broadcast HP/movement overrides into party members for instant display
  const mergedPartyMembers = useMemo(() => {
    if (!partyHpOverrides && partyMoveEvents.length === 0) return partyMembers;
    return partyMembers.map(m => {
      const hpOvr = partyHpOverrides[m.character_id];
      const moveMatches = partyMoveEvents.filter(e => e.character_id === m.character_id);
      const moveOvr = moveMatches.length > 0 ? moveMatches[moveMatches.length - 1] : undefined;
      if (!hpOvr && !moveOvr) return m;
      return {
        ...m,
        character: {
          ...m.character,
          ...(hpOvr ? { hp: hpOvr.hp, max_hp: hpOvr.max_hp } : {}),
          ...(moveOvr ? { current_node_id: moveOvr.node_id } : {}),
        },
      };
    });
  }, [partyMembers, partyHpOverrides, partyMoveEvents]);

  const [eventLog, setEventLog] = useState<string[]>(['Welcome, Wayfarer!']);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [blacksmithOpen, setBlacksmithOpen] = useState(false);
  const [teleportOpen, setTeleportOpen] = useState(false);
  const [waymarkNodeId, setWaymarkNodeId] = useState<string | null>(null);
  const [abilityTargetId, setAbilityTargetId] = useState<string | null>(null);
  const { groundLoot, pickUpItem, dropItemToGround, fetchGroundLoot } = useGroundLoot(character.current_node_id, character.id);
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
  const [poisonStacks, setPoisonStacks] = useState<Record<string, { stacks: number; damagePerTick: number; expiresAt: number; creatureName: string; creatureLevel: number; creatureRarity: string; creatureLootTable: any[]; lootTableId: string | null; dropChance: number; maxHp: number; lastKnownHp: number }>>({});
  const [evasionBuff, setEvasionBuff] = useState<{ dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' } | null>(null);
  const [disengageNextHit, setDisengageNextHit] = useState<{ bonusMult: number; expiresAt: number } | null>(null);
  const [igniteBuff, setIgniteBuff] = useState<{ expiresAt: number } | null>(null);
  const [igniteStacks, setIgniteStacks] = useState<Record<string, { stacks: number; damagePerTick: number; expiresAt: number; creatureName: string; creatureLevel: number; creatureRarity: string; creatureLootTable: any[]; lootTableId: string | null; dropChance: number; maxHp: number; lastKnownHp: number }>>({});
  const [absorbBuff, setAbsorbBuff] = useState<{ shieldHp: number; expiresAt: number } | null>(null);
  const [partyRegenBuff, setPartyRegenBuff] = useState<{ healPerTick: number; expiresAt: number } | null>(null);
  const [lastUsedAbilityCost, setLastUsedAbilityCost] = useState<number>(0);
  const [sunderDebuff, setSunderDebuff] = useState<{ acReduction: number; expiresAt: number; creatureId: string } | null>(null);
  const [focusStrikeBuff, setFocusStrikeBuff] = useState<{ bonusDmg: number } | null>(null);
  const isDeadRef = useRef(false);
  const [deathCountdown, setDeathCountdown] = useState(3);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);

  const ownLogIdsRef = useRef<Set<string>>(new Set());

  // Local-only log (no party combat log broadcast)
  const addLocalLog = useCallback((msg: string) => {
    setEventLog(prev => [...prev.slice(-49), msg]);
  }, []);

  // Track player arrivals and departures via presence
  const prevPlayersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(playersHere.map(p => p.id));
    const prevIds = prevPlayersRef.current;

    // Skip on first render (don't announce everyone already here)
    if (prevIds.size > 0 || currentIds.size === 0) {
      // Arrivals
      for (const p of playersHere) {
        if (!prevIds.has(p.id)) {
          addLocalLog(`⚔️ ${p.name} has arrived.`);
        }
      }
      // Departures
      for (const id of prevIds) {
        if (!currentIds.has(id)) {
          const prev = prevPlayersRef.current;
          // We need the name — store a name map
          const name = prevPlayerNamesRef.current.get(id);
          if (name) {
            addLocalLog(`🚶 ${name} has departed.`);
          }
        }
      }
    }

    // Update refs
    prevPlayersRef.current = currentIds;
    const nameMap = new Map<string, string>();
    for (const p of playersHere) nameMap.set(p.id, p.name);
    prevPlayerNamesRef.current = nameMap;
  }, [playersHere, addLocalLog]);
  const prevPlayerNamesRef = useRef<Map<string, string>>(new Map());

  const addLog = useCallback((msg: string) => {
    // Strip internal buff tags from the displayed message
    const displayMsg = msg.replace('[INSPIRE_BUFF]', '').trim();
    setEventLog(prev => [...prev.slice(-49), displayMsg]);
    // Also write to party combat log if in a party, and track own IDs to prevent duplicates
    (async () => {
      const id = await addPartyCombatLog(msg, character.current_node_id, character.name);
      if (id) {
        ownLogIdsRef.current.add(id);
        // Broadcast for instant delivery to party members (~50ms vs ~300ms DB)
        broadcastCombatMsg(id, msg, character.current_node_id, character.name);
      }
    })();
  }, [addPartyCombatLog, character.current_node_id, character.name, broadcastCombatMsg]);

  // Helper to process incoming log messages from other players
  const processIncomingLog = useCallback((message: string, characterName: string | null, nodeId: string | null) => {
    // Only show entries from the same node
    if (nodeId && nodeId !== character.current_node_id) return;

    let msg = message;
    const name = characterName;
    if (name) {
      msg = msg.replace(/^((?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*)*)You /u, `$1${name} `);
      msg = msg.replace(/ you /gi, ` ${name} `);
      msg = msg.replace(/^((?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*)*)Your /u, `$1${name}'s `);
      msg = msg.replace(/ your /gi, ` ${name}'s `);
      msg = msg.replace(/ you\./gi, ` ${name}.`);
      msg = msg.replace(/ you!/gi, ` ${name}!`);
    }

    if (msg.includes('[INSPIRE_BUFF]')) {
      setRegenBuff({ multiplier: 2, expiresAt: Date.now() + 90000 });
      const cleanMsg = msg.replace('[INSPIRE_BUFF]', '').trim();
      setEventLog(prev => [...prev.slice(-49), cleanMsg]);
      return;
    }
    setEventLog(prev => [...prev.slice(-49), msg]);
  }, [character.current_node_id]);

  // Merge broadcast log entries (instant, ~50ms)
  const seenIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!party) return;
    for (const entry of broadcastLogEntries) {
      if (seenIdsRef.current.has(entry.id)) continue;
      seenIdsRef.current.add(entry.id);
      if (ownLogIdsRef.current.has(entry.id)) continue;
      processIncomingLog(entry.message, entry.character_name, entry.node_id);
    }
  }, [broadcastLogEntries, party, processIncomingLog]);

  // Merge Postgres Changes log entries (correction layer, ~300ms) — skip already-seen
  useEffect(() => {
    if (!party) return;
    for (const entry of partyCombatEntries) {
      if (seenIdsRef.current.has(entry.id)) continue;
      seenIdsRef.current.add(entry.id);
      if (ownLogIdsRef.current.has(entry.id)) continue;
      processIncomingLog(entry.message, entry.character_name, entry.node_id);
    }
  }, [partyCombatEntries, party, processIncomingLog]);

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
  const regenCharRef = useRef({ hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id, con: character.con, level: character.level });
  const regenBuffRef = useRef(regenBuff);
  const foodBuffRef = useRef(foodBuff);
  const getNodeRef = useRef(getNode);
  const updateCharRegenRef = useRef(updateCharacter);
  const equippedRef = useRef(equipped);
  const inCombatRegenRef = useRef(false);
  useEffect(() => { regenCharRef.current = { hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id, con: character.con, level: character.level }; }, [character.hp, character.max_hp, character.current_node_id, character.con, character.level]);
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
        const milestoneMult = regenCharRef.current.level >= 35 ? 2 : 1;
        const combatMult = inCombatRegenRef.current ? 0.1 : 1;
        const regenAmount = Math.max(Math.floor((conRegen + itemRegen + foodRegen) * totalMult * milestoneMult * combatMult), 1);
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

  // CP regeneration — 1 CP per 6 seconds, scaling with primary stat
  const cpCharRef = useRef({ cp: character.cp ?? 100, max_cp: character.max_cp ?? 100, class: character.class });
  useEffect(() => { cpCharRef.current = { cp: character.cp ?? 100, max_cp: character.max_cp ?? 100, class: character.class }; }, [character.cp, character.max_cp, character.class]);
  const cpStatRef = useRef(character);
  useEffect(() => { cpStatRef.current = character; }, [character]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { cp, max_cp, class: charClass } = cpCharRef.current;
      if (cp >= max_cp) return;
      const primaryStat = CLASS_PRIMARY_STAT[charClass] || 'con';
      const primaryVal = (cpStatRef.current as any)[primaryStat] ?? 10;
      const baseRegen = getCpRegenRate(primaryVal);
      // Inn gives 3x CP regen
      const nodeId = regenCharRef.current.current_node_id;
      const node = nodeId ? getNodeRef.current(nodeId) : null;
      const innMult = node?.is_inn ? 3 : 1;
      // Inspire buff doubles CP regen too
      const buff = regenBuffRef.current;
      const inspireMult = Date.now() < buff.expiresAt ? buff.multiplier : 1;
      // Food buff adds flat CP regen
      const food = foodBuffRef.current;
      const foodCpRegen = Date.now() < food.expiresAt ? food.flatRegen * 0.5 : 0;
      const combatMult = inCombatRegenRef.current ? 0.1 : 1;
      const regenAmount = (baseRegen + foodCpRegen) * innMult * inspireMult * combatMult;
      const newCp = Math.min(Math.floor(cp + regenAmount), max_cp);
      if (newCp > cp) {
        updateCharRegenRef.current({ cp: newCp });
      }
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // MP (Stamina) regeneration — DEX-based rate every 3 seconds, 3× at inns
  const mpCharRef = useRef({ mp: character.mp ?? 100, max_mp: character.max_mp ?? 100, current_node_id: character.current_node_id, dex: character.dex, level: character.level });
  useEffect(() => { mpCharRef.current = { mp: character.mp ?? 100, max_mp: character.max_mp ?? 100, current_node_id: character.current_node_id, dex: character.dex, level: character.level }; }, [character.mp, character.max_mp, character.current_node_id, character.dex, character.level]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { mp, current_node_id, dex, level } = mpCharRef.current;
      // Use gear-inclusive DEX to compute true max MP so regen doesn't stall below displayed max
      const dexWithGear = dex + (equippedRef.current.reduce((s, inv) => s + ((inv.item.stats as any)?.dex || 0), 0));
      const effectiveMaxMp = getMaxMp(level, dexWithGear);
      if (mp >= effectiveMaxMp) return;
      const node = current_node_id ? getNodeRef.current(current_node_id) : null;
      const innMult = node?.is_inn ? 3 : 1;
      const regenAmount = getMpRegenRate(dexWithGear) * innMult;
      const newMp = Math.min(mp + regenAmount, effectiveMaxMp);
      if (newMp > mp) {
        updateCharRegenRef.current({ mp: newMp });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // When a party reward broadcast arrives for this character, refetch character data from DB
  const lastRewardCountRef = useRef(0);
  useEffect(() => {
    if (partyRewardEvents.length === 0 || partyRewardEvents.length === lastRewardCountRef.current) return;
    lastRewardCountRef.current = partyRewardEvents.length;
    (async () => {
      const { data } = await supabase
        .from('characters')
        .select('*')
        .eq('id', character.id)
        .single();
      if (data) {
        await updateCharacter({ gold: data.gold, xp: data.xp, level: data.level, hp: data.hp, max_hp: data.max_hp,
          str: data.str, dex: data.dex, con: data.con, int: data.int, wis: data.wis, cha: data.cha,
          cp: data.cp, max_cp: data.max_cp });
      }
    })();
  }, [partyRewardEvents, character.id, updateCharacter]);



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
  const rollLootRef = useRef<(lootTable: any[], creatureName: string, lootTableId?: string | null, dropChance?: number) => Promise<void>>(async () => {});
  const degradeEquipmentRef = useRef<() => Promise<void>>(async () => {});
  const awardKillRewardsRef = useRef<(creature: any, opts?: { stopCombat?: boolean }) => Promise<void>>(async () => {});

  const handleAddPoisonStack = useCallback((creatureId: string) => {
    const dexMod = getStatMod2(character.dex);
    const dmgPerTick = Math.max(1, Math.floor(dexMod * 1.2));
    const creature = creatures.find(c => c.id === creatureId);
    setPoisonStacks(prev => {
      const existing = prev[creatureId];
      const newStacks = existing ? Math.min(existing.stacks + 1, 5) : 1;
      return { ...prev, [creatureId]: {
        stacks: newStacks, damagePerTick: dmgPerTick, expiresAt: Date.now() + 25000,
        creatureName: existing?.creatureName || creature?.name || 'Unknown',
        creatureLevel: existing?.creatureLevel || creature?.level || 1,
        creatureRarity: existing?.creatureRarity || creature?.rarity || 'regular',
        creatureLootTable: existing?.creatureLootTable || (creature?.loot_table as any[]) || [],
        lootTableId: existing?.lootTableId ?? creature?.loot_table_id ?? null,
        dropChance: existing?.dropChance ?? creature?.drop_chance ?? 0.5,
        maxHp: existing?.maxHp || creature?.max_hp || 10,
        lastKnownHp: existing?.lastKnownHp ?? creature?.hp ?? 10,
      }};
    });
  }, [character.dex, creatures]);

  const handleAddIgniteStack = useCallback((creatureId: string) => {
    const intMod = getStatMod2(character.int);
    const dmgPerTick = Math.max(1, Math.floor(intMod * 1.2));
    const creature = creatures.find(c => c.id === creatureId);
    setIgniteStacks(prev => {
      const existing = prev[creatureId];
      const newStacks = existing ? Math.min(existing.stacks + 1, 5) : 1;
      const duration = Math.min(45000, 30000 + intMod * 1000);
      return { ...prev, [creatureId]: {
        stacks: newStacks, damagePerTick: dmgPerTick, expiresAt: Date.now() + duration,
        creatureName: existing?.creatureName || creature?.name || 'Unknown',
        creatureLevel: existing?.creatureLevel || creature?.level || 1,
        creatureRarity: existing?.creatureRarity || creature?.rarity || 'regular',
        creatureLootTable: existing?.creatureLootTable || (creature?.loot_table as any[]) || [],
        lootTableId: existing?.lootTableId ?? creature?.loot_table_id ?? null,
        dropChance: existing?.dropChance ?? creature?.drop_chance ?? 0.5,
        maxHp: existing?.maxHp || creature?.max_hp || 10,
        lastKnownHp: existing?.lastKnownHp ?? creature?.hp ?? 10,
      }};
    });
  }, [character.int, creatures]);

  const handleAbsorbDamage = useCallback((remaining: number) => {
    setAbsorbBuff(prev => {
      if (!prev) return null;
      if (remaining <= 0) return null;
      return { ...prev, shieldHp: remaining };
    });
  }, []);

  // --- Auto-combat hook (must be before aggro effect) ---
  const { inCombat, activeCombatCreatureId, engagedCreatureIds, creatureHpOverrides, updateCreatureHp, startCombat, stopCombat: stopCombatFn } = useCombat({
    character,
    creatures,
    updateCharacter,
    equipmentBonuses,
    effectiveAC,
    addLog,
    rollLoot: useCallback(async (lootTable: any[], creatureName: string, lootTableId?: string | null, dropChance?: number) => {
      await rollLootRef.current(lootTable, creatureName, lootTableId, dropChance);
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
    focusStrikeBuff,
    onClearFocusStrike: useCallback(() => setFocusStrikeBuff(null), []),
    broadcastDamage,
    broadcastHp,
    broadcastReward,
    xpMultiplier,
  });

  // Keep combat ref updated for regen
  useEffect(() => { inCombatRegenRef.current = inCombat; }, [inCombat]);

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
      broadcastDamage(dotDebuff.creatureId, newHp, dotDebuff.damagePerTick, character.name, newHp <= 0);
      await supabase.rpc('damage_creature', { _creature_id: dotDebuff.creatureId, _new_hp: newHp, _killed: newHp <= 0 });
      addLog(`🩸 ${creature.name} bleeds for ${dotDebuff.damagePerTick} damage!`);
      if (newHp <= 0) {
        setDotDebuff(null);
        clearInterval(interval);
        await awardKillRewardsRef.current(creature, { stopCombat: true });
        return;
      }
    }, dotDebuff.intervalMs);
    return () => clearInterval(interval);
  }, [dotDebuff, creatures, creatureHpOverrides, addLog]);

  // Poison DoT tick effect — every 3 seconds, deal cumulative poison damage per creature
  // Now persists across node changes using stored creature metadata + server-side RPC
  useEffect(() => {
    const activeStacks = Object.entries(poisonStacks).filter(([, s]) => Date.now() < s.expiresAt);
    if (activeStacks.length === 0) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      let anyExpired = false;
      for (const [creatureId, stack] of Object.entries(poisonStacks)) {
        if (now >= stack.expiresAt) { anyExpired = true; continue; }
        // Use local creature if available (same node), otherwise use stored metadata
        const localCreature = creatures.find(c => c.id === creatureId);
        const currentHp = creatureHpOverrides[creatureId] ?? localCreature?.hp ?? stack.lastKnownHp;
        if (currentHp <= 0) { anyExpired = true; continue; }
        const totalDmg = stack.stacks * stack.damagePerTick;
        const newHp = Math.max(currentHp - totalDmg, 0);
        // Update local overrides if creature is in current node
        if (localCreature) {
          updateCreatureHp(creatureId, newHp);
          broadcastDamage(creatureId, newHp, totalDmg, character.name, newHp <= 0);
        }
        // Always apply damage server-side via RPC
        await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: newHp, _killed: newHp <= 0 });
        // Update lastKnownHp in stack state for future ticks
        setPoisonStacks(prev => {
          if (!prev[creatureId]) return prev;
          return { ...prev, [creatureId]: { ...prev[creatureId], lastKnownHp: newHp } };
        });
        const cName = localCreature?.name || stack.creatureName;
        addLog(`🧪 ${cName} takes ${totalDmg} poison damage! (${stack.stacks} stack${stack.stacks > 1 ? 's' : ''})`);
        if (newHp <= 0) {
          // Build a creature-like object for reward calculation
          const creatureData = localCreature || {
            name: stack.creatureName, level: stack.creatureLevel, rarity: stack.creatureRarity,
            loot_table: stack.creatureLootTable, loot_table_id: stack.lootTableId, drop_chance: stack.dropChance,
          };
          await awardKillRewardsRef.current(creatureData, { stopCombat: true });
        }
      }
      if (anyExpired) {
        setPoisonStacks(prev => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (Date.now() >= next[key].expiresAt || next[key].lastKnownHp <= 0) delete next[key];
          }
          return next;
        });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [poisonStacks, creatures, creatureHpOverrides, addLog]);

  // Ignite DoT tick effect — every 3 seconds, deal cumulative burn damage per creature
  // Now persists across node changes using stored creature metadata + server-side RPC
  useEffect(() => {
    const activeStacks = Object.entries(igniteStacks).filter(([, s]) => Date.now() < s.expiresAt);
    if (activeStacks.length === 0) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      let anyExpired = false;
      for (const [creatureId, stack] of Object.entries(igniteStacks)) {
        if (now >= stack.expiresAt) { anyExpired = true; continue; }
        const localCreature = creatures.find(c => c.id === creatureId);
        const currentHp = creatureHpOverrides[creatureId] ?? localCreature?.hp ?? stack.lastKnownHp;
        if (currentHp <= 0) { anyExpired = true; continue; }
        const totalDmg = stack.stacks * stack.damagePerTick;
        const newHp = Math.max(currentHp - totalDmg, 0);
        if (localCreature) {
          updateCreatureHp(creatureId, newHp);
          broadcastDamage(creatureId, newHp, totalDmg, character.name, newHp <= 0);
        }
        await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: newHp, _killed: newHp <= 0 });
        setIgniteStacks(prev => {
          if (!prev[creatureId]) return prev;
          return { ...prev, [creatureId]: { ...prev[creatureId], lastKnownHp: newHp } };
        });
        const cName = localCreature?.name || stack.creatureName;
        addLog(`🔥 ${cName} burns for ${totalDmg} fire damage! (${stack.stacks} stack${stack.stacks > 1 ? 's' : ''})`);
        if (newHp <= 0) {
          const creatureData = localCreature || {
            name: stack.creatureName, level: stack.creatureLevel, rarity: stack.creatureRarity,
            loot_table: stack.creatureLootTable, loot_table_id: stack.lootTableId, drop_chance: stack.dropChance,
          };
          await awardKillRewardsRef.current(creatureData, { stopCombat: true });
        }
      }
      if (anyExpired) {
        setIgniteStacks(prev => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (Date.now() >= next[key].expiresAt || next[key].lastKnownHp <= 0) delete next[key];
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
    // 25% chance to degrade 1 random equipped item (matches party RPC)
    if (Math.random() > 0.25) return;
    const shuffled = [...equipped].sort(() => Math.random() - 0.5);
    const toDamage = shuffled.slice(0, 1);
    for (const item of toDamage) {
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
    }
    fetchInventory();
  }, [equipped, addLog, fetchInventory]);

  const handleMove = useCallback(async (nodeId: string, direction?: string) => {
    if (isDead) return;
    // MP check — need at least 10 MP to move
    if ((character.mp ?? 100) < 10) {
      addLog('⚠️ You are too exhausted to move! Wait for your stamina to recover.');
      return;
    }
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

    // Attack of Opportunity — each living creature gets a free strike against ALL party members at this node
    const livingCreatures = creatures.filter(c => c.is_alive && c.hp > 0 && (c.is_aggressive || c.id === activeCombatCreatureId));
    let currentHp = character.hp;
    const isStealthed = stealthBuff && Date.now() < stealthBuff.expiresAt;
    if (isStealthed) {
      addLog('🌑 You slip through the shadows unnoticed...');
      setStealthBuff(null);
    } else {
      // Opportunity attack against the fleeing player (absorb shields soak damage first)
      let currentAbsorb = absorbBuff && Date.now() < absorbBuff.expiresAt ? absorbBuff.shieldHp : 0;
      const hasEvasion = evasionBuff && Date.now() < evasionBuff.expiresAt && evasionBuff.dodgeChance > 0;
      for (const creature of livingCreatures) {
        if (currentHp <= 0) break;
        // Evasion buff (Cloak of Shadows) grants dodge chance on opportunity attacks
        if (hasEvasion && Math.random() < evasionBuff!.dodgeChance) {
          addLog(`🌫️ ${party ? character.name : 'You'} dodge${party ? 's' : ''} ${creature.name}'s opportunity attack!`);
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
            if (absorbed > 0) {
              addLog(`🛡️ Your shield absorbs ${absorbed} damage from ${creature.name}'s opportunity attack!`);
            }
          }
          if (dmgToHp > 0) {
            currentHp = Math.max(currentHp - dmgToHp, 0);
          }
          addLog(`⚔️ ${creature.name} strikes ${party ? character.name : 'you'} while fleeing! (Rolled ${atkRoll} vs AC ${effectiveAC}) — ${rawDmg} damage${dmgToHp < rawDmg ? ` (${dmgToHp} after shield)` : ''}!`);
        } else {
          addLog(`${creature.name} swipes at ${party ? character.name : 'you'} while fleeing — misses! (Rolled ${atkRoll} vs AC ${effectiveAC})`);
        }
      }
      // Update absorb buff with remaining shield HP
      if (absorbBuff && Date.now() < absorbBuff.expiresAt) {
        if (currentAbsorb <= 0) {
          setAbsorbBuff(null);
        } else if (currentAbsorb !== absorbBuff.shieldHp) {
          setAbsorbBuff({ ...absorbBuff, shieldHp: currentAbsorb });
        }
      }
      // Opportunity attacks against party members at the same node (excluding self)
      if (party && livingCreatures.length > 0) {
        const membersHere = partyMembers.filter(
          m => m.character_id !== character.id && m.character.current_node_id === character.current_node_id && m.character.hp > 0
        );
        for (const member of membersHere) {
          for (const creature of livingCreatures) {
            const atkRoll = rollD20() + getStatModifier(creature.stats.str || 10);
            // Use a basic AC of 10 for party members (we don't have their full AC here)
            const memberAC = 10;
            if (atkRoll >= memberAC) {
              const dmg = Math.max(rollDamage(1, 6) + getStatModifier(creature.stats.str || 10), 1);
              addLog(`⚔️ ${creature.name} strikes ${member.character.name} while fleeing! (Rolled ${atkRoll}) — ${dmg} damage!`);
              try {
                const { data: newHp } = await supabase.rpc('damage_party_member', {
                  _character_id: member.character_id,
                  _damage: dmg,
                });
                if (newHp !== null) {
                  broadcastHp?.(member.character_id, newHp, member.character.max_hp, creature.name);
                }
              } catch (e) {
                console.error('Failed to apply opportunity attack to party member:', e);
              }
            } else {
              addLog(`${creature.name} swipes at ${member.character.name} while fleeing — misses!`);
            }
          }
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
      await updateCharacter({ current_node_id: nodeId, mp: Math.max((character.mp ?? 100) - 10, 0) });
      // Broadcast movement instantly to party members
      broadcastMove(character.id, character.name, nodeId);
      const dirNames: Record<string, string> = { N: 'North', S: 'South', E: 'East', W: 'West', NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest' };
      const dirLabel = direction ? (dirNames[direction] || direction) : null;
      const targetArea = getNodeArea(targetNode);
      const moveName = getNodeDisplayName(targetNode, targetArea);
      addLog(`You travel ${dirLabel || moveName}.`);
      logActivity(character.user_id, character.id, 'move', `Traveled ${dirLabel || 'to ' + moveName}`, { node_id: nodeId });
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

  const handleTeleport = useCallback(async (nodeId: string, cpCost: number) => {
    if (isDead) return;
    if (inCombat) { addLog('⚠️ You cannot teleport while in combat!'); return; }
    const effectiveCpCost = character.level >= 39 ? Math.ceil(cpCost * 0.9) : cpCost;
    if ((character.cp ?? 0) < effectiveCpCost) { addLog('⚠️ Not enough CP to teleport.'); return; }
    const targetNode = getNode(nodeId);
    if (!targetNode) return;
    const currentNodeObj = getNode(character.current_node_id!);
    // Save waymark if teleporting from a non-teleport node (level 25+ perk)
    if (currentNodeObj && !currentNodeObj.is_teleport && character.level >= 25) {
      setWaymarkNodeId(character.current_node_id!);
      addLog(`📍 You leave a hidden waymark at ${currentNodeObj.name}.`);
    }
    await updateCharacter({ current_node_id: nodeId, cp: (character.cp ?? 0) - effectiveCpCost });
    broadcastMove(character.id, character.name, nodeId);
    addLog(`🌀 You teleport to ${targetNode.name} for ${effectiveCpCost} CP.`);
    logActivity(character.user_id, character.id, 'teleport', `Teleported to ${targetNode.name}`, { node_id: nodeId, cpCost });
    setTeleportOpen(false);
    // Move all co-located party members (followers always, all co-located if level 25+ recall)
    if (party && isLeader) {
      const coLocated = partyMembers.filter(m =>
        m.character_id !== character.id &&
        m.status === 'accepted' &&
        m.character.current_node_id === character.current_node_id
      );
      const toMove = character.level >= 25 ? coLocated : coLocated.filter(m => m.is_following);
      for (const f of toMove) {
        await supabase.from('characters').update({ current_node_id: nodeId }).eq('id', f.character_id);
      }
      if (toMove.length > 0) { addLog('Your party follows you.'); fetchParty(); }
    }
  }, [character, getNode, updateCharacter, addLog, broadcastMove, party, isLeader, partyMembers, fetchParty, isDead, inCombat]);

  const handleReturnToWaymark = useCallback(async (cpCost: number) => {
    if (!waymarkNodeId) return;
    const waymarkNode = getNode(waymarkNodeId);
    if (!waymarkNode) { addLog('⚠️ Your waymark has faded.'); setWaymarkNodeId(null); return; }
    if (isDead) return;
    if (inCombat) { addLog('⚠️ You cannot teleport while in combat!'); return; }
    const effectiveWayCost = character.level >= 39 ? Math.ceil(cpCost * 0.9) : cpCost;
    if ((character.cp ?? 0) < effectiveWayCost) { addLog('⚠️ Not enough CP to return to waymark.'); return; }
    await updateCharacter({ current_node_id: waymarkNodeId, cp: (character.cp ?? 0) - effectiveWayCost });
    broadcastMove(character.id, character.name, waymarkNodeId);
    addLog(`📍 You return to your waymark at ${waymarkNode.name} for ${effectiveWayCost} CP.`);
    logActivity(character.user_id, character.id, 'teleport', `Returned to waymark at ${waymarkNode.name}`, { node_id: waymarkNodeId, cpCost });
    setWaymarkNodeId(null);
    setTeleportOpen(false);
    // Move co-located party members
    if (party && isLeader) {
      const coLocated = partyMembers.filter(m =>
        m.character_id !== character.id &&
        m.status === 'accepted' &&
        m.character.current_node_id === character.current_node_id
      );
      for (const f of coLocated) {
        await supabase.from('characters').update({ current_node_id: waymarkNodeId }).eq('id', f.character_id);
      }
      if (coLocated.length > 0) { addLog('Your party follows you.'); fetchParty(); }
    }
  }, [waymarkNodeId, character, getNode, updateCharacter, addLog, broadcastMove, party, isLeader, partyMembers, fetchParty, isDead, inCombat]);

  // Keyboard movement bindings — declared after handleSearch/handleUseAbility/handleUseConsumable (see below)

  const SEARCH_CP_COST = 5;

  const handleSearch = useCallback(async () => {
    if (isDead) return;
    if (!currentNode) return;
    if ((character.cp ?? 0) < SEARCH_CP_COST) {
      addLog('❌ Not enough CP to search! (Need 5 CP)');
      return;
    }
    // Deduct CP
    const newCp = (character.cp ?? 0) - SEARCH_CP_COST;
    await supabase.from('characters').update({ cp: newCp }).eq('id', character.id);
    updateCharacter({ cp: newCp });

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

  const rollLoot = useCallback(async (lootTable: any[], creatureName: string, lootTableId?: string | null, dropChance?: number) => {
    if (!character.current_node_id) return;

    // New loot table system: weighted single-item drop
    if (lootTableId) {
      const chance = dropChance ?? 0.5;
      if (Math.random() > chance) return; // No drop

      const { data: tableEntries } = await supabase
        .from('loot_table_entries')
        .select('item_id, weight')
        .eq('loot_table_id', lootTableId);

      if (!tableEntries || tableEntries.length === 0) return;

      const totalWeight = tableEntries.reduce((s, e) => s + e.weight, 0);
      let roll = Math.random() * totalWeight;
      let pickedItemId: string | null = null;
      for (const entry of tableEntries) {
        roll -= entry.weight;
        if (roll <= 0) { pickedItemId = entry.item_id; break; }
      }
      if (!pickedItemId) pickedItemId = tableEntries[tableEntries.length - 1].item_id;

      const { data: item } = await supabase.from('items').select('name, rarity').eq('id', pickedItemId).single();
      if (item) {
        if (item.rarity === 'unique') {
          const { count } = await supabase.from('character_inventory').select('id', { count: 'exact', head: true }).eq('item_id', pickedItemId);
          if (count && count > 0) {
            addLog(`✨ The unique power of ${item.name} is already claimed by another...`);
            fetchGroundLoot();
            return;
          }
        }
        await supabase.from('node_ground_loot' as any).insert({
          node_id: character.current_node_id,
          item_id: pickedItemId,
          creature_name: creatureName,
        });
        addLog(`💎 ${creatureName} dropped ${item.name}!`);
      }
      fetchGroundLoot();
      return;
    }

    // Legacy inline loot table
    if (!lootTable || lootTable.length === 0) return;
    for (const entry of lootTable) {
      if (entry.type === 'gold') continue;
      if (Math.random() <= (entry.chance || 0.1)) {
        const { data: item } = await supabase.from('items').select('name, rarity').eq('id', entry.item_id).single();
        if (item) {
          if (item.rarity === 'unique') {
            const { count } = await supabase.from('character_inventory').select('id', { count: 'exact', head: true }).eq('item_id', entry.item_id);
            if (count && count > 0) {
              addLog(`✨ The unique power of ${item.name} is already claimed by another...`);
              continue;
            }
          }
          await supabase.from('node_ground_loot' as any).insert({
            node_id: character.current_node_id,
            item_id: entry.item_id,
            creature_name: creatureName,
          });
          addLog(`💎 ${creatureName} dropped ${item.name}!`);
        }
      }
    }
    fetchGroundLoot();
  }, [character.current_node_id, addLog, fetchGroundLoot]);

  // Shared reward helper for ability/DoT kills
  const awardKillRewards = useCallback(async (creature: any, opts?: { stopCombat?: boolean }) => {
    const baseXp = Math.floor(creature.level * 10 * (XP_RARITY_MULTIPLIER[creature.rarity] || 1));
    const xpPenalty = getXpPenalty(character.level, creature.level);
    const totalXp = Math.floor(baseXp * xpPenalty * xpMultiplier);

    const lootTableData = creature.loot_table as any[];
    const goldEntry = lootTableData?.find((e: any) => e.type === 'gold');
    let totalGold = 0;
    if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
      totalGold = Math.floor(goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1));
    }

    let splitCount = 1;
    if (party?.id) {
      const { data: freshMembers } = await supabase
        .from('party_members')
        .select('character_id, character:characters(current_node_id)')
        .eq('party_id', party.id)
        .eq('status', 'accepted');
      const membersHere = (freshMembers || []).filter(
        (m: any) => m.character?.current_node_id === character.current_node_id
      );
      splitCount = membersHere.length > 1 ? membersHere.length : 1;
      const xpShare = Math.floor(totalXp / splitCount);
      const goldShare = Math.floor(totalGold / splitCount);
      for (const m of membersHere) {
        if (m.character_id === character.id || !m.character_id) continue;
        try {
          await supabase.rpc('award_party_member', { _character_id: m.character_id, _xp: xpShare, _gold: goldShare });
        } catch (e) { console.error('Failed to award party member:', e); }
      }
    }

    const xpShare = Math.floor(totalXp / splitCount);
    const goldShare = Math.floor(totalGold / splitCount);
    const penaltyNote = xpPenalty < 1 ? ` (${Math.round(xpPenalty * 100)}% XP — level penalty)` : '';
    const boostNote = xpMultiplier > 1 ? ` ⚡${xpMultiplier}x` : '';
    const goldNote = goldShare > 0 ? `, +${goldShare} gold` : '';
    addLog(`☠️ ${creature.name} has been slain! (+${xpShare} XP${goldNote})${penaltyNote}${boostNote}`);

    const newXp = character.xp + xpShare;
    const newGold = character.gold + goldShare;
    const xpForNext = getXpForLevel(character.level);
    if (newXp >= xpForNext) {
      const newLevel = character.level + 1;
      const newMaxCp = getMaxCp(newLevel, character.int, character.wis, character.cha);
      const oldMaxCp = character.max_cp ?? 60;
      const newMaxMp = getMaxMp(newLevel, character.dex);
      const oldMaxMp = character.max_mp ?? 100;
      const levelUpUpdates: Partial<Character> = {
        xp: newXp - xpForNext, level: newLevel, max_hp: character.max_hp + 5,
        hp: character.max_hp + 5, gold: newGold,
        max_cp: newMaxCp, cp: Math.min((character.cp ?? 0) + (newMaxCp - oldMaxCp), newMaxCp),
        max_mp: newMaxMp, mp: Math.min((character.mp ?? 100) + (newMaxMp - oldMaxMp), newMaxMp),
      };
      addLog(`🎉 Level Up! You are now level ${newLevel}!`);
      await updateCharacter(levelUpUpdates);
    } else {
      await updateCharacter({ xp: newXp, gold: newGold });
    }

    await rollLoot(creature.loot_table as any[], creature.name, (creature as any).loot_table_id, (creature as any).drop_chance);
    if (opts?.stopCombat) stopCombatFn();
  }, [character, party, addLog, updateCharacter, rollLoot, stopCombatFn, xpMultiplier]);


  // Wire up refs for forward-declared callbacks
  useEffect(() => { rollLootRef.current = rollLoot; }, [rollLoot]);
  useEffect(() => { degradeEquipmentRef.current = degradeEquipment; }, [degradeEquipment]);
  useEffect(() => { awardKillRewardsRef.current = awardKillRewards; }, [awardKillRewards]);

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
        addLog(`🍞 You consumed ${result.itemName}. +${result.hpRegen} HP & CP regen for 5 minutes.`);
        logActivity(character.user_id, character.id, 'general', `Consumed ${result.itemName} (+${result.hpRegen} regen)`);
        setFoodBuff({ flatRegen: result.hpRegen, expiresAt: Date.now() + 300000 });
      }
    }
  }, [useConsumable, character.id, character.hp, character.max_hp, updateCharacter, addLog]);

  const handleUseAbility = useCallback(async (abilityIndex: number, targetId?: string) => {
    if (isDead || character.hp <= 0) return;
    const allAbilities = [...UNIVERSAL_ABILITIES, ...(CLASS_ABILITIES[character.class] || [])];
    if (!allAbilities[abilityIndex]) return;
    const ability = allAbilities[abilityIndex];
    if (character.level < ability.levelRequired) {
      addLog(`⚠️ ${ability.emoji} ${ability.label} unlocks at level ${ability.levelRequired}.`);
      return;
    }
    const effectiveCpCost = character.level >= 39 ? Math.ceil(ability.cpCost * 0.9) : ability.cpCost;
    if ((character.cp ?? 0) < effectiveCpCost) {
      addLog(`⚠️ Not enough CP for ${ability.label}! (${effectiveCpCost} CP needed, ${character.cp ?? 0} available)`);
      return;
    }

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
      const inspireMsg = `${ability.emoji} ${character.name} plays an inspiring song! HP & CP regeneration doubled for 90 seconds.`;
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
        updateCreatureHp(creature.id, newHp);
        await supabase.rpc('damage_creature', { _creature_id: creature.id, _new_hp: newHp, _killed: newHp <= 0 });
        addLog(`${ability.emoji} Barrage total: ${totalDmg} damage! (${arrowCount} arrows)`);

        if (newHp <= 0) {
          await awardKillRewards(creature, { stopCombat: true });
          return;
        }
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
      const durationSec = 20 + Math.min(strMod, 6);
      setDotDebuff({ damagePerTick: dmgPerTick, intervalMs: 3000, expiresAt: Date.now() + durationSec * 1000, creatureId: creature.id });
      addLog(`${ability.emoji} Rend! ${creature.name} is bleeding for ${dmgPerTick} damage every 3s for ${durationSec}s.`);
    } else if (ability.type === 'poison_buff') {
      const dexMod = getStatMod2(character.dex + (equipmentBonuses.dex || 0));
      const durationMs = Math.min(45000, 30000 + dexMod * 1000);
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
      updateCreatureHp(creature.id, newHp);
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
      if (newHp <= 0) {
        await awardKillRewards(creature, { stopCombat: true });
        return;
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
      const durationMs = Math.min(45000, 30000 + intMod * 1000);
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
      updateCreatureHp(creature.id, newHp);
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
      if (newHp <= 0) {
        await awardKillRewards(creature, { stopCombat: true });
        return;
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
    } else if (ability.type === 'burst_damage') {
      if (!inCombat || !activeCombatCreatureId) {
        addLog(`${ability.emoji} You must be in combat to use Grand Finale!`);
        return;
      }
      const creature = creatures.find(c => c.id === activeCombatCreatureId);
      if (!creature || !creature.is_alive || creature.hp <= 0) {
        addLog(`${ability.emoji} No valid target for Grand Finale.`);
        return;
      }
      const chaMod = getStatMod2(character.cha + (equipmentBonuses.cha || 0));
      const baseDmg = Math.max(8, chaMod * 4 + Math.floor(character.level * 1.5));
      const damage = baseDmg + rollDamage(1, Math.max(1, chaMod * 2));
      const creatureCurrentHp = creatureHpOverrides[creature.id] ?? creature.hp;
      const newHp = Math.max(0, creatureCurrentHp - damage);
      const killed = newHp <= 0;
      updateCreatureHp(creature.id, newHp);
      await supabase.rpc('damage_creature', { _creature_id: creature.id, _new_hp: newHp, _killed: killed });
      addLog(`${ability.emoji} Grand Finale! A devastating blast of sound strikes ${creature.name} for ${damage} damage!`);
      if (killed) {
        await awardKillRewards(creature, { stopCombat: true });
        return;
      }
    } else if (ability.type === 'focus_strike') {
      // Use base stats only (no gear bonuses) to prevent scaling too hard at high levels
      const totalStats = character.str + character.dex + character.con
                       + character.int + character.wis + character.cha;
      const avgStat = Math.floor(totalStats / 6);
      const avgMod = getStatMod2(avgStat);
      const bonusDmg = Math.max(3, Math.floor(avgMod * 2) + Math.floor(character.level / 2));
      setFocusStrikeBuff({ bonusDmg });
      addLog(`${ability.emoji} Focus Strike! Your next attack will deal +${bonusDmg} bonus damage.`);
    }

    // Deduct CP cost (with milestone discount)
    const finalCpCost = character.level >= 39 ? Math.ceil(ability.cpCost * 0.9) : ability.cpCost;
    const newCp = Math.max((character.cp ?? 0) - finalCpCost, 0);
    await updateCharacter({ cp: newCp });

    // Track last used ability cost
    setLastUsedAbilityCost(finalCpCost);
  }, [isDead, character, updateCharacter, addLog, party, partyMembers, inCombat, activeCombatCreatureId, creatures, equipmentBonuses, creatureHpOverrides, poisonStacks, igniteStacks, lastUsedAbilityCost]);

  // Keyboard movement + action bindings
  const handleAbilityKey = useCallback((index: number) => {
    handleUseAbility(index, abilityTargetId ?? undefined);
  }, [handleUseAbility, abilityTargetId]);

  const handleBeltPotionKey = useCallback((index: number) => {
    if (beltedPotions[index]) {
      handleUseConsumable(beltedPotions[index].id);
    }
  }, [beltedPotions, handleUseConsumable]);

  const handlePickUpFirst = useCallback(async () => {
    if (isDead) return;
    if (groundLoot.length === 0) return;
    const first = groundLoot[0];
    const result = await pickUpItem(first.id);
    if (result === false) addLog('✨ That unique item is already claimed by another...');
    else { addLog('📦 You pick up an item.'); fetchInventory(); }
  }, [isDead, groundLoot, pickUpItem, addLog, fetchInventory]);

  const handleAttackFirst = useCallback(() => {
    if (isDead) return;
    if (inCombat) return; // already fighting
    const firstCreature = creatures.find(c => c.is_alive);
    if (firstCreature) {
      startCombat(firstCreature.id);
    }
  }, [isDead, inCombat, creatures, startCombat]);

  // Chat system
  const handleChatMessage = useCallback((formatted: string) => {
    setEventLog(prev => [...prev.slice(-49), formatted]);
  }, []);

  const { sendSay, sendWhisper } = useChat({
    nodeId: character.current_node_id,
    characterId: character.id,
    characterName: character.name,
    onlinePlayers,
    onMessage: handleChatMessage,
  });

  const handleChatSubmit = useCallback(() => {
    const text = chatInput.trim();
    if (!text) { setChatOpen(false); return; }
    setChatInput('');
    setChatOpen(false);

    // Whisper
    const whisperMatch = text.match(/^\/w(?:hisper)?\s+(\S+)\s+(.+)$/i);
    if (whisperMatch) {
      const err = sendWhisper(whisperMatch[1], whisperMatch[2]);
      if (err) setEventLog(prev => [...prev.slice(-49), `⚠️ ${err}`]);
      return;
    }

    // Say (strip /say prefix if present)
    const sayText = text.replace(/^\/say\s+/i, '');
    sendSay(sayText);
  }, [chatInput, sendSay, sendWhisper]);

  const handleOpenChat = useCallback(() => {
    setChatOpen(true);
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }, []);

  const keyboardMovement = useKeyboardMovement({
    currentNode,
    nodes,
    onMove: handleMove,
    disabled: isDead,
    onAttackFirst: handleAttackFirst,
    onSearch: handleSearch,
    onUseAbility: handleAbilityKey,
    onUseBeltPotion: handleBeltPotionKey,
    onPickUpLoot: handlePickUpFirst,
    onOpenChat: handleOpenChat,
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
        <div className="flex items-center gap-2">
          <h1 className="font-display text-sm text-primary text-glow">Wayfarers of Edhelard <span className="text-xs text-muted-foreground font-body ml-1">{APP_VERSION}</span></h1>
          {xpMultiplier > 1 && xpBoostExpiresAt && (
            <span className="text-xs font-display text-primary animate-pulse px-2 py-0.5 bg-primary/10 rounded-full border border-primary/30">
              ⚡ {xpMultiplier}x XP
            </span>
          )}
        </div>
          <div className="flex items-center gap-2">
            <OnlinePlayersDialog onlinePlayers={onlinePlayers} myCharacterId={character.id} />
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
            onDrop={async (inventoryId) => {
              const inv = [...equipped, ...unequipped].find(i => i.id === inventoryId);
              if (inv && character.current_node_id) {
                await dropItemToGround(inventoryId, inv.item_id, character.current_node_id);
                fetchInventory();
                addLog(`You dropped ${inv.item.name} on the ground.`);
              }
            }}
            onDestroy={dropItem}
            onUseConsumable={handleUseConsumable}
            isAtInn={currentNode?.is_inn ?? false}
            regenBuff={regenBuff}
            regenTick={regenTick}
            beltedPotions={beltedPotions}
            beltCapacity={beltCapacity}
            onBeltPotion={beltPotion}
            onUnbeltPotion={unbeltPotion}
            inCombat={inCombat}
            actionBindings={keyboardMovement.actionBindings}
            baseRegen={baseRegen}
            itemHpRegen={itemHpRegen}
            foodBuff={foodBuff}
            critBuff={critBuff}
            acBuff={acBuff}
            poisonBuff={poisonBuff}
            evasionBuff={evasionBuff}
            igniteBuff={igniteBuff}
            absorbBuff={absorbBuff}
            damageBuff={damageBuff}
            partyRegenBuff={partyRegenBuff}
            focusStrikeBuff={focusStrikeBuff}
          />
        </div>

        {/* Middle: Node + Event Log — flexible */}
        <div className="h-full flex-1 min-w-0 ornate-border bg-card/60 flex flex-col">
          <div className="flex-[2] min-h-0">
            <NodeView
              node={currentNode}
              region={currentRegion}
              area={currentNode.area_id ? getNodeArea(currentNode) : undefined}
              players={playersHere}
              creatures={creatures}
              npcs={npcs}
              character={character}
              eventLog={eventLog}
              onAttack={handleAttack}
              onTalkToNPC={npc => setTalkingToNPC(npc)}
              inCombat={inCombat}
              activeCombatCreatureId={activeCombatCreatureId}
              engagedCreatureIds={engagedCreatureIds}
              creatureHpOverrides={{ ...broadcastOverrides, ...creatureHpOverrides }}
              classAbilities={[...UNIVERSAL_ABILITIES, ...(CLASS_ABILITIES[character.class] || [])]}
              onUseAbility={handleUseAbility}
              abilityTargetId={abilityTargetId}
              actionBindings={keyboardMovement.actionBindings}
              poisonStacks={poisonStacks}
              igniteStacks={igniteStacks}
              sunderDebuff={sunderDebuff}
              groundLoot={groundLoot}
              onPickUpLoot={async (id) => {
                const result = await pickUpItem(id);
                if (result === false) addLog('✨ That unique item is already claimed by another...');
                else { addLog('📦 You pick up an item.'); fetchInventory(); }
              }}
              partyMemberIds={party ? new Set(mergedPartyMembers.filter(m => m.status === 'accepted' && m.character_id !== character.id).map(m => m.character_id)) : undefined}
              partyMemberHp={party ? new Map(mergedPartyMembers.filter(m => m.status === 'accepted').map(m => [m.character_id, { hp: m.character.hp, max_hp: m.character.max_hp }])) : undefined}
              statusBarsProps={{
                equipmentBonuses,
                isAtInn: currentNode?.is_inn ?? false,
                regenBuff,
                regenTick,
                baseRegen,
                itemHpRegen,
                foodBuff,
                critBuff,
                acBuff,
                poisonBuff,
                damageBuff,
                evasionBuff,
                igniteBuff,
                absorbBuff,
                partyRegenBuff,
                focusStrikeBuff,
                stealthBuff,
              }}
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
            {chatOpen && (
              <div className="shrink-0 mt-1">
                <Input
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); handleChatSubmit(); }
                    if (e.key === 'Escape') { setChatOpen(false); setChatInput(''); }
                  }}
                  placeholder="Say something... (/w name message to whisper)"
                  className="h-7 text-xs bg-background/50 border-border"
                  autoComplete="off"
                />
              </div>
            )}
          </div>
        </div>

        {/* Right: Map + Party — fit content */}
        <div className="h-full w-[400px] shrink-0 ornate-border bg-card/60 overflow-y-auto">
          <MapPanel
            regions={regions}
            nodes={nodes}
            areas={areas}
            currentNodeId={character.current_node_id}
            currentRegionId={currentNode.region_id}
            characterLevel={character.level}
            onNodeClick={handleMove}
            partyMembers={mergedPartyMembers}
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
            activeBuffs={{
              stealth: !!(stealthBuff && Date.now() < stealthBuff.expiresAt),
              damageBuff: !!(damageBuff && Date.now() < damageBuff.expiresAt),
              acBuff: !!(acBuff && Date.now() < acBuff.expiresAt),
              acBuffBonus: acBuff && Date.now() < acBuff.expiresAt ? acBuff.bonus : 0,
              poison: !!(poisonBuff && Date.now() < poisonBuff.expiresAt),
              evasion: !!(evasionBuff && Date.now() < evasionBuff.expiresAt),
              ignite: !!(igniteBuff && Date.now() < igniteBuff.expiresAt),
              absorb: !!(absorbBuff && Date.now() < absorbBuff.expiresAt && absorbBuff.shieldHp > 0),
              absorbHp: absorbBuff && Date.now() < absorbBuff.expiresAt ? absorbBuff.shieldHp : 0,
              root: !!(rootDebuff && Date.now() < rootDebuff.expiresAt),
              sunder: !!(sunderDebuff && Date.now() < sunderDebuff.expiresAt),
              focusStrike: !!focusStrikeBuff,
            }}
            abilityTargetId={abilityTargetId}
            onSetAbilityTarget={setAbilityTargetId}
            showTargetSelector={
              [...UNIVERSAL_ABILITIES, ...(CLASS_ABILITIES[character.class] || [])].some(a => a.type === 'hp_transfer' || a.type === 'ally_absorb')
            }
            onSearch={handleSearch}
            onOpenVendor={currentNode.is_vendor ? () => setVendorOpen(true) : undefined}
            onOpenBlacksmith={currentNode.is_blacksmith ? () => setBlacksmithOpen(true) : undefined}
            onOpenTeleport={(currentNode.is_teleport || character.level >= 25) ? () => {
              if (inCombat) { addLog('⚠️ You cannot teleport while in combat!'); return; }
              setTeleportOpen(true);
            } : undefined}
            searchDisabled={character.cp < 5}
            hasDiscoverable={!!(currentNode.connections?.some((c: any) => c.hidden) || (currentNode.searchable_items && currentNode.searchable_items.length > 0))}
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

      {/* Teleport Dialog */}
      {(currentNode.is_teleport || character.level >= 25) && (
        <TeleportDialog
          open={teleportOpen}
          onClose={() => setTeleportOpen(false)}
          currentNode={currentNode}
          currentRegion={currentRegion}
          regions={regions}
          nodes={nodes}
          areas={areas}
          playerCp={character.cp ?? 0}
          playerMaxCp={character.max_cp ?? 60}
          characterLevel={character.level}
          onTeleport={handleTeleport}
          waymark={waymarkNodeId ? { node: getNode(waymarkNodeId)!, region: getRegion(getNode(waymarkNodeId)?.region_id ?? '') } : null}
          onReturnToWaymark={waymarkNodeId ? handleReturnToWaymark : undefined}
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
