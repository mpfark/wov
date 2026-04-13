import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

import CharacterPanel from '@/features/character/components/CharacterPanel';
import NodeView from '@/features/world/components/NodeView';
import MapPanel from '@/features/world/components/MapPanel';
import VendorPanel from '@/features/inventory/components/VendorPanel';
import BlacksmithPanel from '@/features/inventory/components/BlacksmithPanel';
import BossTrainerPanel from '@/features/character/components/BossTrainerPanel';
import TeleportDialog from '@/features/world/components/TeleportDialog';
import { useGroundLoot } from '@/features/inventory';
import { Character } from '@/features/character';
import { useNodes } from '@/features/world';
import { useNodeChannel } from '@/features/world';
import { useGlobalPresence } from '@/hooks/useGlobalPresence';
import OnlinePlayersDialog from '@/components/game/OnlinePlayersDialog';
import { useCreatures } from '@/features/creatures';
import { useItemCache } from '@/features/inventory';
import { useCreatureBroadcast, useMergedCreatureHpOverrides } from '@/features/combat';
import { usePartyBroadcast } from '@/features/party';
import { useNPCs, NPC } from '@/features/creatures';
import NPCDialogPanel from '@/features/creatures/components/NPCDialogPanel';
import SoulforgeDialog from '@/features/inventory/components/SoulforgeDialog';
import { useInventory } from '@/features/inventory';
import { useParty } from '@/features/party';
import { usePartyCombatLog } from '@/features/combat';
import { usePartyCombat } from '@/features/combat';
import { getBagWeight, calculateAC, getMaxCp, getMaxMp } from '@/lib/game-data';
import { CLASS_ABILITIES, UNIVERSAL_ABILITIES } from '@/features/combat';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { User, Map as MapIconLucide, Zap, LogOut, RefreshCw, MessageCircle } from 'lucide-react';

import { useKeyboardMovement } from '@/features/world';

import { useChat } from '@/features/chat';
import { useXpBoost } from '@/hooks/useXpBoost';
import { APP_VERSION } from '@/lib/version';
import ReportIssueDialog from '@/components/game/ReportIssueDialog';
import { useCreateGameEventBus, useGameEvent } from '@/hooks/useGameEvents';
import { useGameLoop } from '@/features/combat';
import { useCombatActions } from '@/features/combat/hooks/useCombatActions';
import { useOffscreenDotWakeup } from '@/features/combat';
import { useMovementActions } from '@/features/world/hooks/useMovementActions';
import { useConsumableActions } from '@/features/inventory/hooks/useConsumableActions';
import BroadcastDebugOverlay from '@/components/game/BroadcastDebugOverlay';
import MovementPad from '@/features/world/components/MovementPad';
import { useStatAllocation } from '@/features/character/hooks/useStatAllocation';
import EventLogPanel from '@/features/combat/components/EventLogPanel';
import ChatPanel from '@/features/chat/components/ChatPanel';
import { useSummonRequests } from '@/features/world/hooks/useSummonRequests';


interface Props {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  updateCharacterLocal?: (updates: Partial<Character>) => void;
  onSignOut: () => void;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  startingNodeId?: string;
  onSwitchCharacter?: () => void;
}

export default function GamePage({ character, updateCharacter, updateCharacterLocal, onSignOut, isAdmin, onOpenAdmin, startingNodeId, onSwitchCharacter }: Props) {
  
  const bus = useCreateGameEventBus();
  useItemCache(); // Preload item cache on game entry

  // Tablet detection: left panel becomes a slide-out sheet on screens ≤1024px
  // Mobile detection: right panel also becomes a sheet on screens ≤768px
  const [isTablet, setIsTablet] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [charPanelOpen, setCharPanelOpen] = useState(false);
  const [mapPanelOpen, setMapPanelOpen] = useState(false);
  const [isWideScreen, setIsWideScreen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(() => {
    const stored = localStorage.getItem('chatPanelOpen');
    return stored !== null ? stored === 'true' : true;
  });
  useEffect(() => {
    const tabletMql = window.matchMedia('(max-width: 1024px)');
    const mobileMql = window.matchMedia('(max-width: 768px)');
    const wideMql = window.matchMedia('(min-width: 1600px)');
    const onChange = () => {
      setIsTablet(tabletMql.matches);
      setIsMobile(mobileMql.matches);
      setIsWideScreen(wideMql.matches);
    };
    tabletMql.addEventListener('change', onChange);
    mobileMql.addEventListener('change', onChange);
    wideMql.addEventListener('change', onChange);
    onChange();
    return () => {
      tabletMql.removeEventListener('change', onChange);
      mobileMql.removeEventListener('change', onChange);
      wideMql.removeEventListener('change', onChange);
    };
  }, []);
  const { regions, nodes, areas, loading: nodesLoading, getNode, getRegion, getNodeArea } = useNodes(true);
  const nodeChannel = useNodeChannel(character.current_node_id, character);
  const { playersHere } = nodeChannel;
  const { onlinePlayers } = useGlobalPresence(character);
  const currentNodeForPrefetch = getNode(character.current_node_id || '');
  const { creatures, creaturesLoading } = useCreatures(character.current_node_id, nodeChannel, currentNodeForPrefetch);
  const creatureNameResolver = useCallback((creatureId: string) => {
    return creatures.find(c => c.id === creatureId)?.name;
  }, [creatures]);
  const emitLocalLog = useCallback((msg: string) => { bus.emit('log:local', { message: msg }); }, [bus]);
  const { broadcastOverrides, broadcastDamage, cleanupOverrides } = useCreatureBroadcast(nodeChannel, character.current_node_id, character.id, emitLocalLog, creatureNameResolver);

  useEffect(() => {
    cleanupOverrides(creatures.map(c => c.id));
  }, [creatures, cleanupOverrides]);
  const { npcs } = useNPCs(character.current_node_id);
  const { xpMultiplier, xpBoostExpiresAt } = useXpBoost();
  const [talkingToNPC, setTalkingToNPC] = useState<NPC | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const { equipped, unequipped, equipmentBonuses, fetchInventory, equipItem, unequipItem, dropItem, useConsumable, beltedPotions, beltCapacity, beltPotion, unbeltPotion, togglePin } = useInventory(character.id);
  const {
    party, members: partyMembers, pendingInvites, isLeader, isTank, myMembership,
    createParty, invitePlayer, acceptInvite, declineInvite,
    leaveParty, kickMember, setTank, toggleFollow, fetchParty,
  } = useParty(character.id);
  const { pendingSummons, acceptSummon, declineSummon } = useSummonRequests(character.id);
  const { addPartyCombatLog } = usePartyCombatLog(party?.id ?? null);
  const {
    hpOverrides: partyHpOverrides, moveEvents: partyMoveEvents,
    broadcastLogEntries, rewardEvents: partyRewardEvents,
    incomingPartyRegenBuff,
    broadcastHp, broadcastMove, broadcastCombatMsg, broadcastPartyRegenBuff,
  } = usePartyBroadcast(party?.id ?? null, character.id);

  // Broadcast own HP whenever it changes (use effective max HP including gear bonuses)
  const gearConMod = Math.floor((equipmentBonuses.con || 0) / 2);
  const effectiveMaxHp = character.max_hp + (equipmentBonuses.hp || 0) + gearConMod;

  // Login top-up removed — resources now capped at authoritative base max to prevent snap-down
  const lastBroadcastedHpRef = useRef<{ hp: number; max_hp: number } | null>(null);
  useEffect(() => {
    if (!party || !character) return;
    const last = lastBroadcastedHpRef.current;
    if (last && last.hp === character.hp && last.max_hp === effectiveMaxHp) return;
    lastBroadcastedHpRef.current = { hp: character.hp, max_hp: effectiveMaxHp };
    broadcastHp(character.id, character.hp, effectiveMaxHp, 'sync');
  }, [party, character?.hp, effectiveMaxHp, broadcastHp]);

  // Merge broadcast HP/movement overrides into party members
  const mergedPartyMembers = useMemo(() => {
    if (!partyHpOverrides && partyMoveEvents.length === 0) return partyMembers;
    return partyMembers.map(m => {
      const hpOvr = partyHpOverrides[m.character_id];
      const moveMatches = partyMoveEvents.filter(e => e.character_id === m.character_id);
      const moveOvr = moveMatches.length > 0 ? moveMatches[moveMatches.length - 1] : undefined;
      if (!hpOvr && !moveOvr) return m;
      return {
        ...m, character: {
          ...m.character,
          ...(hpOvr ? { hp: hpOvr.hp, max_hp: hpOvr.max_hp } : {}),
          ...(moveOvr ? { current_node_id: moveOvr.node_id } : {}),
        },
      };
    });
  }, [partyMembers, partyHpOverrides, partyMoveEvents]);

  // ── Follower: grace-window based local node sync via broadcast ──
  const FOLLOW_GRACE_MS = 1000;
  const missedFollowCountRef = useRef(0);
  const lastFollowMoveTimestampRef = useRef(0);

  useEffect(() => {
    if (!character || !partyMoveEvents.length) return;
    const myMove = partyMoveEvents.find(e => e.character_id === character.id);
    if (!myMove) return;

    // Only process follow-moves for followers that are actually following
    const isFollowing = myMembership?.is_following && !isLeader;
    if (!isFollowing) {
      // Non-following members still get the instant node snap (server already moved them)
      if (myMove.node_id !== character.current_node_id) {
        updateCharacterLocal?.({ current_node_id: myMove.node_id });
      }
      return;
    }

    // Discard stale events (only process the newest)
    if (myMove.timestamp <= lastFollowMoveTimestampRef.current) return;

    const age = Date.now() - myMove.timestamp;
    const atOrigin = character.current_node_id === myMove.from_node_id;

    if (atOrigin && age <= FOLLOW_GRACE_MS) {
      // Successful follow within grace window
      lastFollowMoveTimestampRef.current = myMove.timestamp;
      missedFollowCountRef.current = 0;
      updateCharacterLocal?.({ current_node_id: myMove.node_id });

      // Resolve leader name for feedback
      const leaderName = partyMembers.find(m => m.character_id === party?.leader_id)?.character?.name;
      if (leaderName) {
        bus.emit('log', { message: `You hurry after ${leaderName}.` });
      }
    } else {
      // Mismatch or grace expired — tolerate one miss before breaking
      lastFollowMoveTimestampRef.current = myMove.timestamp;
      missedFollowCountRef.current += 1;
      if (missedFollowCountRef.current >= 2) {
        missedFollowCountRef.current = 0;
        toggleFollow(false);
        const leaderName = partyMembers.find(m => m.character_id === party?.leader_id)?.character?.name;
        bus.emit('log', { message: `You lose track of ${leaderName ?? 'your leader'} and stop following.` });
      }
    }
  }, [partyMoveEvents, character?.id, character?.current_node_id, updateCharacterLocal, myMembership?.is_following, isLeader, partyMembers, party?.leader_id, toggleFollow, bus]);

  const [eventLog, setEventLog] = useState<string[]>(['Welcome, Wayfarer!']);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [blacksmithOpen, setBlacksmithOpen] = useState(false);
  const [trainerOpen, setTrainerOpen] = useState(false);
  const [abilityTargetId, setAbilityTargetId] = useState<string | null>(null);
  const { groundLoot, pickUpItem, dropItemToGround, fetchGroundLoot } = useGroundLoot(nodeChannel, character.current_node_id, character.id);

  // ── Locked connections — temporary unlock state ──
  const [unlockedConnections, setUnlockedConnections] = useState<Map<string, number>>(new Map());
  const unlockTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clear unlock state on node change
  useEffect(() => {
    unlockTimersRef.current.forEach(t => clearTimeout(t));
    unlockTimersRef.current.clear();
    setUnlockedConnections(new Map());
  }, [character.current_node_id]);

  // Handle unlock_path broadcasts from other players
  useEffect(() => {
    nodeChannel.onUnlockPath.current = (payload: any) => {
      const { direction, node_id: _node_id, expires } = payload.payload || {};
      if (!direction || !expires) return;
      const key = `${character.current_node_id}-${direction}`;
      const remaining = expires - Date.now();
      if (remaining <= 0) return;
      setUnlockedConnections(prev => {
        const next = new Map(prev);
        next.set(key, expires);
        return next;
      });
      // Clear existing timer for this key
      const existing = unlockTimersRef.current.get(key);
      if (existing) clearTimeout(existing);
      unlockTimersRef.current.set(key, setTimeout(() => {
        setUnlockedConnections(prev => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        unlockTimersRef.current.delete(key);
      }, remaining));
    };
  }, [character.current_node_id, nodeChannel]);

  const handleUnlockPath = useCallback((direction: string, targetNodeId: string, expires: number) => {
    const key = `${character.current_node_id}-${direction}`;
    setUnlockedConnections(prev => {
      const next = new Map(prev);
      next.set(key, expires);
      return next;
    });
    const remaining = expires - Date.now();
    const existing = unlockTimersRef.current.get(key);
    if (existing) clearTimeout(existing);
    unlockTimersRef.current.set(key, setTimeout(() => {
      setUnlockedConnections(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      unlockTimersRef.current.delete(key);
    }, remaining));
    // Broadcast to other players at this node
    nodeChannel.channelRef.current?.send({
      type: 'broadcast',
      event: 'unlock_path',
      payload: { direction, node_id: targetNodeId, expires },
    });
  }, [character.current_node_id, nodeChannel]);

  const logEndRef = useRef<HTMLDivElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);
  const ownLogIdsRef = useRef<Set<string>>(new Set());

  // ── Event bus subscribers ──────────────────────────────────────
  useGameEvent(bus, 'log', ({ message }) => {
    const displayMsg = message.replace('[INSPIRE_BUFF]', '').trim();
    setEventLog(prev => [...prev.slice(-49), displayMsg]);
  });
  useGameEvent(bus, 'log', ({ message }) => {
    (async () => {
      const id = await addPartyCombatLog(message, character.current_node_id, character.name);
      if (id) {
        ownLogIdsRef.current.add(id);
        broadcastCombatMsg(id, message, character.current_node_id, character.name);
      }
    })();
  });
  useGameEvent(bus, 'log:local', ({ message }) => {
    setEventLog(prev => [...prev.slice(-49), message]);
  });
  useGameEvent(bus, 'creature:damage', (payload) => {
    broadcastDamage(payload.creatureId, payload.newHp, payload.damage, payload.attackerName, payload.killed);
  });

  // ── Log emitters ───────────────────────────────────────────────
  const addLocalLog = useCallback((msg: string) => { bus.emit('log:local', { message: msg }); }, [bus]);
  const addLog = useCallback((msg: string) => { bus.emit('log', { message: msg }); }, [bus]);

  // Track player arrivals/departures
  const prevPlayersRef = useRef<Set<string>>(new Set());
  const prevPlayerNamesRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const currentIds = new Set(playersHere.map(p => p.id));
    const prevIds = prevPlayersRef.current;
    if (prevIds.size > 0 || currentIds.size === 0) {
      for (const p of playersHere) {
        if (!prevIds.has(p.id)) addLocalLog(`⚔️ ${p.name} has arrived.`);
      }
      for (const id of prevIds) {
        if (!currentIds.has(id)) {
          const name = prevPlayerNamesRef.current.get(id);
          if (name) addLocalLog(`🚶 ${name} has departed.`);
        }
      }
    }
    prevPlayersRef.current = currentIds;
    const nameMap = new Map<string, string>();
    for (const p of playersHere) nameMap.set(p.id, p.name);
    prevPlayerNamesRef.current = nameMap;
  }, [playersHere, addLocalLog]);

  // Incoming party log processing
  const processIncomingLog = useCallback((message: string, characterName: string | null, nodeId: string | null) => {
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
      const cleanMsg = msg.replace('[INSPIRE_BUFF]', '').trim();
      setEventLog(prev => [...prev.slice(-49), cleanMsg]);
      return;
    }
    setEventLog(prev => [...prev.slice(-49), msg]);
  }, [character.current_node_id]);


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

  // Debounced scroll — prevent layout thrashing on rapid log updates
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
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

  // When a party reward broadcast arrives for this character, refetch character data
  const lastRewardCountRef = useRef(0);
  useEffect(() => {
    if (partyRewardEvents.length === 0 || partyRewardEvents.length === lastRewardCountRef.current) return;
    lastRewardCountRef.current = partyRewardEvents.length;
    (async () => {
      const { data } = await supabase.from('characters').select('*').eq('id', character.id).single();
      if (data) {
        await updateCharacter({ gold: data.gold, xp: data.xp, level: data.level, hp: data.hp, max_hp: data.max_hp,
          str: data.str, dex: data.dex, con: data.con, int: data.int, wis: data.wis, cha: data.cha,
          cp: data.cp, max_cp: data.max_cp });
      }
    })();
  }, [partyRewardEvents, character.id, updateCharacter]);

  // ── Forward-declared refs for circular deps ────────────────────
  const rollLootRef = useRef<(lootTable: any[], creatureName: string, lootTableId?: string | null, dropChance?: number, creatureNodeId?: string | null) => Promise<void>>(async () => {});
  const degradeEquipmentRef = useRef<() => Promise<void>>(async () => {});
  const awardKillRewardsRef = useRef<(creature: any, opts?: { stopCombat?: boolean }) => Promise<void>>(async () => {});

  // ── useGameLoop: regen, death, buff state ────────────────
  const gameLoop = useGameLoop({
    character, updateCharacter, equipped, equipmentBonuses, getNode, addLog,
    startingNodeId, creatures,
    party, partyMembers,
  });

  const { buffState, buffSetters } = gameLoop;

  const {
    isDead,
    regenTick, deathCountdown, itemHpRegen, baseRegen,
    inCombatRegenRef, deathGoldRef,
  } = gameLoop;

  const {
    foodBuff, critBuff, stealthBuff, damageBuff, rootDebuff, battleCryBuff,
    poisonBuff, poisonStacks, evasionBuff, igniteBuff, igniteStacks,
    absorbBuff, partyRegenBuff, sunderDebuff, focusStrikeBuff, bleedStacks,
  } = buffState;

  // Apply incoming party regen buff from another party member
  useEffect(() => {
    if (!incomingPartyRegenBuff) return;
    buffSetters.setPartyRegenBuff(incomingPartyRegenBuff);
  }, [incomingPartyRegenBuff, buffSetters]);

  // Follower movement is handled server-side by leader's moveFollowers() —
  // no duplicate broadcast-based movement needed here.

  // Broadcast party regen buff when caster sets it
  const prevPartyRegenBuffRef = useRef<typeof partyRegenBuff>(null);
  useEffect(() => {
    if (!party || !partyRegenBuff || partyRegenBuff === prevPartyRegenBuffRef.current) return;
    prevPartyRegenBuffRef.current = partyRegenBuff;
    broadcastPartyRegenBuff(partyRegenBuff.healPerTick, partyRegenBuff.expiresAt, partyRegenBuff.source || 'bard', character.id);
  }, [party, partyRegenBuff, broadcastPartyRegenBuff, character.id]);

  // effectiveAC — recalculate from class + effective DEX (base + gear) to match server logic
  const effectiveDex = character.dex + (equipmentBonuses.dex || 0);
  const effectiveAC = calculateAC(character.class, effectiveDex) + (equipmentBonuses.ac || 0);

  // ── Server effect sync — delegated to useBuffState via useGameLoop ──
  const handleActiveDots = useCallback((dots: Record<string, any>) => {
    gameLoop.syncFromServerEffects(dots[character.id]);
  }, [character.id, gameLoop.syncFromServerEffects]);

  const handleCreatureDebuffs = useCallback((debuffs: Record<string, any>) => {
    gameLoop.syncCreatureDebuffs(debuffs);
  }, [gameLoop.syncCreatureDebuffs]);

  // Determine if this character should use party combat mode
  const leaderMember = mergedPartyMembers.find(m => m.character_id === party?.leader_id);
  const leaderNodeId = leaderMember?.character?.current_node_id ?? null;
  const usePartyCombatMode = !!party && (isLeader || leaderNodeId === character.current_node_id);

  // Ref to break circular dependency: usePartyCombat needs ability executor, useCombatActions needs queueAbility
  const executeAbilityRef = useRef<(index: number, targetId?: string) => Promise<void>>();

  const combat = usePartyCombat({
    character, creatures,
    party: usePartyCombatMode ? party : null,
    isLeader, isDead,
    addLocalLog, updateCharacter, updateCharacterLocal, fetchGroundLoot,
    gatherBuffs: gameLoop.gatherBuffs,
    onConsumedBuffs: gameLoop.handleConsumedBuffs,
    onClearedDots: gameLoop.handleClearedDots,
    onActiveDots: handleActiveDots,
    onCreatureDebuffs: handleCreatureDebuffs,
    onPoisonProc: gameLoop.handleAddPoisonStack,
    onIgniteProc: gameLoop.handleAddIgniteStack,
    onAbilityExecute: async (index, targetId) => {
      await executeAbilityRef.current?.(index, targetId);
    },
    onAbsorbSync: gameLoop.handleAbsorbDamage,
    setPoisonBuff: buffSetters.setPoisonBuff,
    setIgniteBuff: buffSetters.setIgniteBuff,
  });

  const { inCombat, activeCombatCreatureId, engagedCreatureIds, creatureHpOverrides,
    lastTickTime, startCombat, stopCombat: stopCombatFn,
    fleeStopCombat, queueAbility } = combat;

  // Merge creature HP from all sources: combat-tick > broadcast > base
  const mergedCreatureHpOverrides = useMergedCreatureHpOverrides(creatureHpOverrides, broadcastOverrides);

  // ── Offscreen DoT wake-up scheduler ──────────────────────────────
  useOffscreenDotWakeup({
    currentNodeId: character.current_node_id,
    eventBus: bus,
  });

  useEffect(() => { inCombatRegenRef.current = inCombat; }, [inCombat]);

  // Sync follower's local character when leader moves them
  useEffect(() => {
    if (!myMembership?.character?.current_node_id) return;
    if (myMembership.character.current_node_id !== character.current_node_id) {
      updateCharacter({ current_node_id: myMembership.character.current_node_id });
    }
  }, [myMembership?.character?.current_node_id]);

  const currentNode = character.current_node_id ? getNode(character.current_node_id) : null;
  const currentRegion = currentNode ? getRegion(currentNode.region_id) : null;

  // ── Feature-specific action hooks ──────────────────────────────
  const combatActions = useCombatActions({
    character, updateCharacter, updateCharacterLocal, addLog,
    equipped, equipmentBonuses,
    creatures, creatureHpOverrides,
    party, partyMembers,
    inCombat, activeCombatCreatureId, startCombat, stopCombat: stopCombatFn,
    queueAbility,
    isDead, xpMultiplier,
    fetchInventory, fetchGroundLoot,
    buffState, buffSetters,
    notifyCreatureKilled: gameLoop.notifyCreatureKilled,
  });

  const movementActions = useMovementActions({
    character, updateCharacter, addLog,
    equipped, unequipped, equipmentBonuses,
    getNode, getRegion, getNodeArea, currentNode,
    creatures,
    party, partyMembers, isLeader, myMembership,
    inCombat, activeCombatCreatureId, fleeStopCombat,
    effectiveAC, isDead,
    broadcastMove, broadcastHp, toggleFollow,
    fetchInventory, fetchParty,
    buffState, buffSetters,
    degradeEquipment: combatActions.degradeEquipment,
    unlockedConnections,
    onUnlockPath: handleUnlockPath,
  });

  const consumableActions = useConsumableActions({
    character, updateCharacter, addLog,
    equipmentBonuses,
    useConsumable,
    buffSetters,
  });

  // Wire forward-declared refs
  useEffect(() => { rollLootRef.current = combatActions.rollLoot; }, [combatActions.rollLoot]);
  useEffect(() => { degradeEquipmentRef.current = combatActions.degradeEquipment; }, [combatActions.degradeEquipment]);
  useEffect(() => { awardKillRewardsRef.current = combatActions.awardKillRewards; }, [combatActions.awardKillRewards]);

  // Wire ability executor ref (updated synchronously to avoid stale closures)
  executeAbilityRef.current = (index: number, targetId?: string) => combatActions.handleUseAbility(index, targetId, true);

  const { handleMove, handleTeleport, handleReturnToWaymark, handleSearch, waymarkNodeId, teleportOpen, setTeleportOpen } = movementActions;
  const { handleUseConsumable } = consumableActions;
  const { handleUseAbility, handleAttack } = combatActions;

  // ── Stat allocation (extracted hook) ───────────────────────────
  const { handleAllocateStat, handleFullRespec, handleBatchAllocateStats } = useStatAllocation({
    character, updateCharacter, addLog,
  });

  // ── Keyboard + chat ────────────────────────────────────────────
  const handleAbilityKey = useCallback((index: number) => {
    handleUseAbility(index, abilityTargetId ?? selectedTargetId ?? undefined);
  }, [handleUseAbility, abilityTargetId, selectedTargetId]);

  const handleBeltPotionKey = useCallback((index: number) => {
    if (beltedPotions[index]) handleUseConsumable(beltedPotions[index].id);
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
    if (selectedTargetId) {
      const target = creatures.find(c => c.id === selectedTargetId && c.is_alive);
      if (target) {
        if (!target.is_aggressive) addLog(`⚔️ You start attacking ${target.name}.`);
        startCombat(target.id);
        return;
      }
    }
    if (inCombat) return;
    const firstCreature = creatures.find(c => c.is_alive);
    if (firstCreature) {
      if (!firstCreature.is_aggressive) addLog(`⚔️ You start attacking ${firstCreature.name}.`);
      startCombat(firstCreature.id);
    }
  }, [isDead, inCombat, creatures, selectedTargetId, startCombat, addLog]);

  const handleCycleTarget = useCallback(() => {
    if (isDead) return;
    const aliveCreatures = creatures.filter(c => c.is_alive);
    if (aliveCreatures.length === 0) return;
    const currentIdx = aliveCreatures.findIndex(c => c.id === (selectedTargetId ?? activeCombatCreatureId));
    const nextIdx = (currentIdx + 1) % aliveCreatures.length;
    const next = aliveCreatures[nextIdx];
    setSelectedTargetId(next.id);
    const engagedSet = new Set(engagedCreatureIds);
    if (next.is_aggressive || engagedSet.has(next.id)) {
      if (!next.is_aggressive) addLog(`⚔️ You start attacking ${next.name}.`);
      startCombat(next.id);
    }
  }, [isDead, creatures, selectedTargetId, activeCombatCreatureId, engagedCreatureIds, inCombat, startCombat]);

  // Clear selected target when changing nodes
  useEffect(() => {
    setSelectedTargetId(null);
  }, [character.current_node_id]);

  const handleChatMessage = useCallback((formatted: string) => {
    setEventLog(prev => [...prev.slice(-49), formatted]);
  }, []);

  const { sendSay, sendWhisper } = useChat({
    handle: nodeChannel,
    nodeId: character.current_node_id,
    characterId: character.id,
    characterName: character.name,
    onlinePlayers,
    onMessage: handleChatMessage,
  });

  const handleChatSubmit = useCallback(async () => {
    const text = chatInput.trim();
    if (!text) { setChatOpen(false); return; }
    setChatInput('');
    setChatOpen(false);
    const whisperMatch = text.match(/^\/w(?:hisper)?\s+(\S+)\s+(.+)$/i);
    if (whisperMatch) {
      const err = await sendWhisper(whisperMatch[1], whisperMatch[2]);
      if (err) setEventLog(prev => [...prev.slice(-49), `⚠️ ${err}`]);
      return;
    }
    const sayText = text.replace(/^\/say\s+/i, '');
    sendSay(sayText);
  }, [chatInput, sendSay, sendWhisper]);

  const handleOpenChat = useCallback(() => {
    setChatOpen(true);
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }, []);

  const keyboardMovement = useKeyboardMovement({
    currentNode, nodes,
    onMove: handleMove, disabled: isDead,
    onAttackFirst: handleAttackFirst, onSearch: handleSearch,
    onUseAbility: handleAbilityKey, onUseBeltPotion: handleBeltPotionKey,
    onPickUpLoot: handlePickUpFirst, onOpenChat: handleOpenChat,
    onCycleTarget: handleCycleTarget,
  });

  // Separate chat messages from event log for wide-screen chat panel
  const chatMessages = useMemo(() =>
    eventLog.filter(log => log.startsWith('💬') || log.startsWith('🤫')),
    [eventLog]
  );
  const filteredEventLog = useMemo(() =>
    (isWideScreen && chatPanelOpen) ? eventLog.filter(log => !log.startsWith('💬') && !log.startsWith('🤫')) : eventLog,
    [eventLog, isWideScreen, chatPanelOpen]
  );

  // ── Shared drop handler ────────────────────────────────────────
  const handleDropItem = useCallback(async (inventoryId: string) => {
    const inv = [...equipped, ...unequipped].find(i => i.id === inventoryId);
    if (inv && character.current_node_id) {
      await dropItemToGround(inventoryId, inv.item_id, character.current_node_id);
      fetchInventory();
      addLog(`You dropped ${inv.item.name} on the ground.`);
    }
  }, [equipped, unequipped, character.current_node_id, dropItemToGround, fetchInventory, addLog]);

  // ── De-duplicated prop blocks ──────────────────────────────────
  const charPanelProps = useMemo(() => ({
    character,
    equipped,
    unequipped,
    equipmentBonuses,
    onEquip: equipItem,
    onUnequip: unequipItem,
    onDrop: handleDropItem,
    onDestroy: dropItem,
    onTogglePin: togglePin,
    onUseConsumable: handleUseConsumable,
    isAtInn: currentNode?.is_inn ?? false,
    regenTick,
    beltedPotions,
    beltCapacity,
    onBeltPotion: beltPotion,
    onUnbeltPotion: unbeltPotion,
    inCombat,
    actionBindings: keyboardMovement.actionBindings,
    baseRegen,
    itemHpRegen,
    foodBuff,
    critBuff,
    battleCryBuff,
    poisonBuff,
    evasionBuff,
    igniteBuff,
    absorbBuff,
    damageBuff,
    partyRegenBuff,
    focusStrikeBuff,
    onAllocateStat: handleAllocateStat,
    onFullRespec: handleFullRespec,
    onBatchAllocateStats: handleBatchAllocateStats,
  }), [
    character, equipped, unequipped, equipmentBonuses, equipItem, unequipItem,
    handleDropItem, dropItem, togglePin, handleUseConsumable, currentNode?.is_inn,
    regenTick, beltedPotions, beltCapacity, beltPotion, unbeltPotion,
    inCombat, keyboardMovement.actionBindings, baseRegen, itemHpRegen,
    foodBuff, critBuff, battleCryBuff, poisonBuff, evasionBuff, igniteBuff, absorbBuff,
    damageBuff, partyRegenBuff, focusStrikeBuff,
    handleAllocateStat, handleFullRespec, handleBatchAllocateStats,
  ]);

  const activeBuffs = useMemo(() => ({
    stealth: !!(stealthBuff && Date.now() < stealthBuff.expiresAt),
    damageBuff: !!(damageBuff && Date.now() < damageBuff.expiresAt),
    battleCry: !!(battleCryBuff && Date.now() < battleCryBuff.expiresAt),
    battleCryDr: battleCryBuff && Date.now() < battleCryBuff.expiresAt ? Math.round(battleCryBuff.damageReduction * 100) : 0,
    poison: !!(poisonBuff && Date.now() < poisonBuff.expiresAt),
    evasion: !!(evasionBuff && Date.now() < evasionBuff.expiresAt),
    ignite: !!(igniteBuff && Date.now() < igniteBuff.expiresAt),
    absorb: !!(absorbBuff && Date.now() < absorbBuff.expiresAt && absorbBuff.shieldHp > 0),
    absorbHp: absorbBuff && Date.now() < absorbBuff.expiresAt ? absorbBuff.shieldHp : 0,
    root: !!(rootDebuff && Date.now() < rootDebuff.expiresAt),
    sunder: Object.values(sunderDebuff).some(s => Date.now() < s.expiresAt),
    focusStrike: !!focusStrikeBuff,
  }), [stealthBuff, damageBuff, battleCryBuff, poisonBuff, evasionBuff, igniteBuff, absorbBuff, rootDebuff, sunderDebuff, focusStrikeBuff]);

  const showTargetSelector = useMemo(() =>
    [...UNIVERSAL_ABILITIES, ...(CLASS_ABILITIES[character.class] || [])].some(a => a.type === 'hp_transfer' || a.type === 'ally_absorb'),
    [character.class]
  );

  const mapPanelProps = useMemo(() => ({
    regions,
    nodes,
    areas,
    currentNodeId: character.current_node_id,
    currentRegionId: currentNode?.region_id ?? '',
    characterLevel: character.level,
    onNodeClick: handleMove,
    partyMembers: mergedPartyMembers,
    myCharacterId: character.id,
    character,
    party,
    pendingInvites,
    isLeader,
    isTank,
    myMembership,
    playersHere,
    onCreateParty: createParty,
    onInvite: invitePlayer,
    onAcceptInvite: acceptInvite,
    onDeclineInvite: declineInvite,
    onLeaveParty: leaveParty,
    onKick: kickMember,
    onSetTank: setTank,
    onToggleFollow: toggleFollow,
    keyboardBindings: keyboardMovement,
    activeBuffs,
    abilityTargetId,
    onSetAbilityTarget: setAbilityTargetId,
    showTargetSelector,
    onSearch: handleSearch,
    onOpenVendor: currentNode?.is_vendor ? () => setVendorOpen(true) : undefined,
    onOpenBlacksmith: currentNode?.is_blacksmith ? () => setBlacksmithOpen(true) : undefined,
    onOpenTrainer: (currentNode?.is_trainer && character.level >= 30) ? () => setTrainerOpen(true) : undefined,
    onOpenTeleport: (currentNode?.is_teleport || character.level >= 22) ? () => {
      if (inCombat) { addLog('⚠️ You cannot teleport while in combat!'); return; }
      setTeleportOpen(true);
    } : undefined,
    searchDisabled: character.cp < 5 || creatures.length > 0,
    hasDiscoverable: !!(currentNode?.connections?.some((c: any) => c.hidden) || (currentNode?.searchable_items && currentNode.searchable_items.length > 0)),
    unlockedConnections,
    onMapTeleport: handleTeleport,
    onlinePlayers,
    addLog,
    inCombat,
    isDead,
    getRegionForNode: (nodeId: string) => { const n = getNode(nodeId); return n ? getRegion(n.region_id) : undefined; },
    currentRegionMinLevel: currentRegion?.min_level,
    pendingSummons,
    onAcceptSummon: acceptSummon,
    onDeclineSummon: declineSummon,
    onSummonRefetch: async () => {
      const { data } = await supabase.from('characters').select('current_node_id').eq('id', character.id).single();
      if (data?.current_node_id && updateCharacterLocal) {
        updateCharacterLocal({ current_node_id: data.current_node_id });
      }
    },
  }), [
    regions, nodes, areas, character, currentNode, handleMove, mergedPartyMembers,
    party, pendingInvites, isLeader, isTank, myMembership, playersHere,
    createParty, invitePlayer, acceptInvite, declineInvite, leaveParty, kickMember,
    setTank, toggleFollow, keyboardMovement, activeBuffs, abilityTargetId,
    showTargetSelector, handleSearch, inCombat, addLog, setTeleportOpen,
    creatures.length, unlockedConnections, onlinePlayers, isDead, updateCharacter, pendingSummons, acceptSummon, declineSummon, handleTeleport,
    getNode, getRegion, currentRegion,
  ]);

  // ── Rendering ──────────────────────────────────────────────────
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
    <div className="h-screen flex flex-col parchment-bg max-w-[1920px] mx-auto w-full">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-sm text-primary text-glow">
            {isTablet ? 'WoV' : 'Wayfarers of Varneth'}
            <span className="text-xs text-muted-foreground font-body ml-1">{APP_VERSION}</span>
          </h1>
          {xpMultiplier > 1 && xpBoostExpiresAt && (
            <span className="text-xs font-display text-primary animate-pulse px-2 py-0.5 bg-primary/10 rounded-full border border-primary/30">
              ⚡ {xpMultiplier}x XP
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <OnlinePlayersDialog onlinePlayers={onlinePlayers} myCharacterId={character.id} compact={isTablet} />
          {isAdmin && (
            isTablet ? (
              <Button variant="outline" size="icon" onClick={onOpenAdmin} className="h-8 w-8">
                <Zap className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onOpenAdmin} className="text-xs font-display">
                ⚡ Admin
              </Button>
            )
          )}
          {onSwitchCharacter && (
            isTablet ? (
              <Button variant="outline" size="icon" onClick={onSwitchCharacter} className="h-8 w-8">
                <RefreshCw className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onSwitchCharacter} className="text-xs font-display">
                Switch Character
              </Button>
            )
          )}
          <ReportIssueDialog userId={character.user_id} characterId={character.id} characterName={character.name} compact={isTablet} />
          {isTablet ? (
            <Button variant="ghost" size="icon" onClick={onSignOut} className="h-8 w-8 text-muted-foreground">
              <LogOut className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onSignOut} className="text-xs text-muted-foreground">
              Sign Out
            </Button>
          )}
        </div>
      </div>


      {/* Main Content */}
      <div className="flex-1 min-h-0 flex">
        {/* Left: Character Panel — desktop: fixed sidebar, tablet: sheet overlay */}
        {isTablet ? (
          <Sheet open={charPanelOpen} onOpenChange={setCharPanelOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="fixed left-2 top-1/3 -translate-y-1/2 z-30 h-10 w-10 rounded-full ornate-border bg-card/90 shadow-lg"
              >
                <User className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[400px] max-w-[90vw] p-0 overflow-y-auto bg-card/95">
              <CharacterPanel {...charPanelProps} />
            </SheetContent>
          </Sheet>
        ) : (
          <div className="h-full w-[400px] shrink-0 ornate-border bg-card/60 overflow-y-auto">
            <CharacterPanel {...charPanelProps} />
          </div>
        )}

        {/* Middle: Node + Event Log */}
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
              onAttack={(id) => { setSelectedTargetId(id); handleAttack(id); }}
              onTalkToNPC={npc => setTalkingToNPC(npc)}
              inCombat={inCombat}
              lastTickTime={lastTickTime}
               activeCombatCreatureId={activeCombatCreatureId}
               selectedTargetId={selectedTargetId}
               engagedCreatureIds={engagedCreatureIds}
              creatureHpOverrides={mergedCreatureHpOverrides}
              classAbilities={[...UNIVERSAL_ABILITIES, ...(CLASS_ABILITIES[character.class] || [])]}
              onUseAbility={(idx, target) => handleUseAbility(idx, target ?? selectedTargetId ?? undefined)}
              abilityTargetId={abilityTargetId}
              actionBindings={keyboardMovement.actionBindings}
              poisonStacks={poisonStacks}
              igniteStacks={igniteStacks}
              sunderDebuff={sunderDebuff}
              bleedStacks={bleedStacks}
              groundLoot={groundLoot}
              onPickUpLoot={async (id) => {
                const result = await pickUpItem(id);
                if (result === false) addLog('✨ That unique item is already claimed by another...');
                else { addLog('📦 You pick up an item.'); fetchInventory(); }
              }}
              partyMemberIds={party ? new Set(mergedPartyMembers.filter(m => m.status === 'accepted' && m.character_id !== character.id).map(m => m.character_id)) : undefined}
              creaturesLoading={creaturesLoading}
              
              partyMemberHp={party ? new Map(mergedPartyMembers.filter(m => m.status === 'accepted').map(m => [m.character_id, { hp: m.character.hp, max_hp: m.character.max_hp }])) : undefined}
              statusBarsProps={{
                equipmentBonuses,
                inventoryCount: getBagWeight(unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined)),
                isAtInn: currentNode?.is_inn ?? false,
                regenTick, baseRegen, itemHpRegen, foodBuff, critBuff, battleCryBuff,
                poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, focusStrikeBuff, stealthBuff,
              }}
            />
          </div>
          <EventLogPanel
            filteredEventLog={filteredEventLog}
            logEndRef={logEndRef}
            chatOpen={chatOpen}
            isWideScreen={isWideScreen}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onChatSubmit={handleChatSubmit}
            onChatClose={() => { setChatOpen(false); setChatInput(''); }}
            chatInputRef={chatInputRef}
          />
        </div>

        {/* Right: Map + Party — desktop/tablet: fixed sidebar, mobile: sheet overlay */}
        {isMobile ? (
          <Sheet open={mapPanelOpen} onOpenChange={setMapPanelOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="fixed right-2 top-1/3 -translate-y-1/2 z-30 h-10 w-10 rounded-full ornate-border bg-card/90 shadow-lg"
              >
                <MapIconLucide className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[400px] max-w-[90vw] p-0 overflow-y-auto bg-card/95">
              <MapPanel {...mapPanelProps} />
            </SheetContent>
          </Sheet>
        ) : (
          <div className="h-full w-[400px] shrink-0 ornate-border bg-card/60 overflow-y-auto">
            <MapPanel {...mapPanelProps} />
          </div>
        )}

        {/* Wide-screen Chat Panel toggle button */}
        {isWideScreen && !isTablet && !chatPanelOpen && (
          <Button
            size="icon"
            className="h-full w-8 shrink-0 rounded-none border-l border-border bg-card/60 hover:bg-accent/60"
            variant="ghost"
            onClick={() => { setChatPanelOpen(true); localStorage.setItem('chatPanelOpen', 'true'); }}
            title="Open chat panel"
          >
            <MessageCircle className="w-4 h-4" />
          </Button>
        )}

        {/* Wide-screen Chat Panel — 4th column */}
        {isWideScreen && !isTablet && chatPanelOpen && (
          <ChatPanel
            messages={chatMessages}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onChatSubmit={handleChatSubmit}
            onClose={() => setChatPanelOpen(false)}
            chatInputRef={chatInputRef}
          />
        )}
      </div>

      {/* Vendor Dialog */}
      {currentNode.is_vendor && (
        <VendorPanel
          open={vendorOpen}
          onClose={() => setVendorOpen(false)}
          nodeId={currentNode.id}
          characterId={character.id}
          gold={character.gold}
          cha={character.cha}
          equipmentBonuses={equipmentBonuses}
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
          salvage={character.salvage ?? 0}
          level={character.level}
          inventory={[...equipped, ...unequipped]}
          onGoldChange={(g) => updateCharacter({ gold: g })}
          onSalvageChange={(s) => updateCharacter({ salvage: s })}
          onInventoryChange={fetchInventory}
          addLog={addLog}
        />
      )}

      {/* Boss Trainer Dialog */}
      {currentNode.is_trainer && character.level >= 30 && (
        <BossTrainerPanel
          open={trainerOpen}
          onClose={() => setTrainerOpen(false)}
          character={character}
          updateCharacter={updateCharacter}
          addLog={addLog}
        />
      )}

      {/* Teleport Dialog */}
      {(currentNode.is_teleport || character.level >= 22) && (
        <TeleportDialog
          open={teleportOpen}
          onClose={() => setTeleportOpen(false)}
          currentNode={currentNode}
          currentRegion={currentRegion}
          regions={regions}
          nodes={nodes}
          areas={areas}
          playerCp={character.cp ?? 0}
          playerMaxCp={character.max_cp ?? 30}
          characterLevel={character.level}
          characterId={character.id}
          onTeleport={handleTeleport}
          waymark={waymarkNodeId ? { node: getNode(waymarkNodeId)!, region: getRegion(getNode(waymarkNodeId)?.region_id ?? '') } : null}
          onReturnToWaymark={waymarkNodeId ? handleReturnToWaymark : undefined}
          partyMembers={mergedPartyMembers}
          myCharacterId={character.id}
        />
      )}

      {/* NPC Dialog — route Soulwright to special dialog */}
      {talkingToNPC?.name === 'The Soulwright' ? (
        <SoulforgeDialog
          open={!!talkingToNPC}
          onClose={() => setTalkingToNPC(null)}
          character={character}
          onForged={() => { fetchInventory(); }}
        />
      ) : (
        <NPCDialogPanel npc={talkingToNPC} open={!!talkingToNPC} onClose={() => setTalkingToNPC(null)} />
      )}

      {/* Death Overlay */}
      {isDead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md animate-polish-fade-in">
          <div className="text-center space-y-4">
            <p className="font-display text-5xl text-destructive animate-pulse">💀</p>
            <p className="font-display text-2xl text-destructive">You Have Fallen</p>
            <p className="font-display text-6xl text-destructive/80 tabular-nums">{deathCountdown}</p>
            <p className="text-sm text-muted-foreground">Respawning at the starting area...</p>
            <p className="text-xs text-muted-foreground">You lost {Math.floor(deathGoldRef.current * 0.1)} gold.</p>
          </div>
        </div>
      )}

      {/* Broadcast Debug Overlay — admin only */}
      {isAdmin && <BroadcastDebugOverlay />}

      {/* Movement Pad — tablet only */}
      {isTablet && <MovementPad currentNode={currentNode} onMove={handleMove} disabled={isDead} unlockedConnections={unlockedConnections} />}
    </div>
  );
}
