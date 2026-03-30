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
import { useCreatureBroadcast } from '@/features/combat';
import { usePartyBroadcast } from '@/features/party';
import { useNPCs, NPC } from '@/features/creatures';
import NPCDialogPanel from '@/features/creatures/components/NPCDialogPanel';
import SoulforgeDialog from '@/features/inventory/components/SoulforgeDialog';
import { useInventory } from '@/features/inventory';
import { useParty } from '@/features/party';
import { usePartyCombatLog } from '@/features/combat';
import { usePartyCombat } from '@/features/combat';
import { getBagWeight, getStatModifier, getMaxCp, getMaxMp, calculateStats, CLASS_LEVEL_BONUSES, calculateHP, calculateAC } from '@/lib/game-data';
import { CLASS_ABILITIES, UNIVERSAL_ABILITIES } from '@/features/combat';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { User, Map as MapIconLucide, Zap, LogOut, RefreshCw, MessageCircle } from 'lucide-react';
import { logActivity as _logActivity } from '@/hooks/useActivityLog';
import { useKeyboardMovement } from '@/features/world';

import { useChat } from '@/features/chat';
import { useXpBoost } from '@/hooks/useXpBoost';
import { APP_VERSION } from '@/lib/version';
import { Input } from '@/components/ui/input';
import ReportIssueDialog from '@/components/game/ReportIssueDialog';
import { useCreateGameEventBus, useGameEvent } from '@/hooks/useGameEvents';
import { useGameLoop } from '@/features/combat';
import { useActions } from '@/hooks/useActions';
import BroadcastDebugOverlay from '@/components/game/BroadcastDebugOverlay';
import MovementPad from '@/features/world/components/MovementPad';

// Memoized log color cache to avoid re-running 20+ regex checks per render
const logColorCache = new Map<string, string>();
function getLogColor(log: string): string {
  const cached = logColorCache.get(log);
  if (cached) return cached;
  let color = 'text-foreground/80';
  if (log.startsWith('⏳')) color = 'text-muted-foreground italic';
  else if (log.startsWith('💬')) color = 'text-foreground';
  else if (log.startsWith('🤫 To ')) color = 'text-purple-400/70';
  else if (log.startsWith('🤫')) color = 'text-purple-400';
  else if (log.includes('(remote)') && (log.startsWith('🩸') || log.startsWith('🧪') || log.startsWith('🔥'))) color = 'text-muted-foreground/60 italic text-[10px]';
  else if (log.includes('bleeds for') && log.startsWith('🩸')) color = 'text-dot-bleed italic';
  else if (log.includes('poison damage') && log.startsWith('🧪')) color = 'text-dot-poison italic';
  else if (log.includes('burns for') && log.startsWith('🔥')) color = 'text-dot-burn italic';
  else if (log.includes('CRITICAL!')) color = 'text-primary font-semibold';
  else if (log.startsWith('💀') || log.includes('been defeated') || log.includes('struck down')) color = 'text-destructive';
  else if (log.startsWith('☠️')) color = 'text-elvish';
  else if (log.startsWith('🎉') || log.includes('Level Up')) color = 'text-primary font-semibold';
  else if (log.startsWith('📈')) color = 'text-primary';
  else if (log.startsWith('⚠️')) color = 'text-dwarvish';
  else if (log.startsWith('💔')) color = 'text-destructive/80';
  else if (log.startsWith('💉')) color = 'text-blood font-semibold';
  else if (log.startsWith('💚') || log.startsWith('💪') || log.includes('restore') || log.includes('recover')) color = 'text-elvish';
  else if (log.startsWith('🌑')) color = 'text-primary';
  else if (log.startsWith('🦅')) color = 'text-primary';
  else if (log.startsWith('🎶') || log.startsWith('✨')) color = 'text-elvish';
  else if (log.startsWith('🌿')) color = 'text-elvish';
  else if (log.startsWith('🏹🏹')) color = 'text-primary';
  else if (log.startsWith('🛡️')) color = 'text-dwarvish';
  else if (log.startsWith('📯')) color = 'text-dwarvish';
  else if (log.startsWith('🩸')) color = 'text-blood';
  else if (log.startsWith('🧪')) color = 'text-elvish';
  else if (log.startsWith('🔪')) color = 'text-primary font-semibold';
  else if (log.startsWith('🌫️')) color = 'text-primary';
  else if (log.startsWith('🔥🔥') || log.startsWith('🔥')) color = 'text-dwarvish';
  else if (log.startsWith('🦘')) color = 'text-elvish font-semibold';
  else if (log.startsWith('🎯')) color = 'text-primary font-semibold';
  else if (log.startsWith('💥')) color = 'text-primary font-semibold';
  else if (log.startsWith('🛡️✨')) color = 'text-primary';
  else if (log.startsWith('🎵💢')) color = 'text-dwarvish';
  else if (log.startsWith('🎶✨')) color = 'text-elvish';
  else if (log.startsWith('🔄🎭')) color = 'text-primary font-semibold';
  else if (log.startsWith('🔨')) color = 'text-dwarvish font-semibold';
  else if (log.includes('miss')) color = 'text-muted-foreground';
  else if (log.includes('damage')) color = 'text-foreground/90';
  // Keep cache bounded
  if (logColorCache.size > 200) logColorCache.clear();
  logColorCache.set(log, color);
  return color;
}

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
  const { creatures } = useCreatures(character.current_node_id, nodeChannel, currentNodeForPrefetch);
  const { broadcastOverrides, broadcastDamage, cleanupOverrides } = useCreatureBroadcast(nodeChannel, character.current_node_id, character.id);

  useEffect(() => {
    cleanupOverrides(creatures.map(c => c.id));
  }, [creatures, cleanupOverrides]);
  const { npcs } = useNPCs(character.current_node_id);
  const { xpMultiplier, xpBoostExpiresAt } = useXpBoost();
  const [talkingToNPC, setTalkingToNPC] = useState<NPC | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const { equipped, unequipped, equipmentBonuses, fetchInventory, equipItem, unequipItem, dropItem, useConsumable, inventory: _inventory, beltedPotions, beltCapacity, beltPotion, unbeltPotion } = useInventory(character.id);
  const {
    party, members: partyMembers, pendingInvites, isLeader, isTank, myMembership,
    createParty, invitePlayer, acceptInvite, declineInvite,
    leaveParty, kickMember, setTank, toggleFollow, fetchParty,
  } = useParty(character.id);
  const { entries: partyCombatEntries, addPartyCombatLog } = usePartyCombatLog(party?.id ?? null); // entries now always empty — log arrives via broadcast
  const {
    hpOverrides: partyHpOverrides, moveEvents: partyMoveEvents,
    broadcastLogEntries, rewardEvents: partyRewardEvents,
    incomingPartyRegenBuff,
    broadcastHp, broadcastMove, broadcastCombatMsg, broadcastReward: _broadcastReward, broadcastPartyRegenBuff,
  } = usePartyBroadcast(party?.id ?? null, character.id);

  // Broadcast own HP whenever it changes (use effective max HP including gear bonuses)
  const gearConMod = Math.floor((equipmentBonuses.con || 0) / 2);
  const effectiveMaxHp = character.max_hp + (equipmentBonuses.hp || 0) + gearConMod;
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
      // The setRegenBuff is in gameLoop — we need a ref-based approach
      // Since processIncomingLog runs after gameLoop, we can access setRegenBuff via the gameLoop return
      setRegenBuffFromIncoming({ multiplier: 2, expiresAt: Date.now() + 90000 });
      const cleanMsg = msg.replace('[INSPIRE_BUFF]', '').trim();
      setEventLog(prev => [...prev.slice(-49), cleanMsg]);
      return;
    }
    setEventLog(prev => [...prev.slice(-49), msg]);
  }, [character.current_node_id]);

  // Placeholder for setRegenBuff from incoming logs — will be updated after gameLoop
  const setRegenBuffFromIncomingRef = useRef<(v: { multiplier: number; expiresAt: number }) => void>(() => {});
  const setRegenBuffFromIncoming = useCallback((v: { multiplier: number; expiresAt: number }) => {
    setRegenBuffFromIncomingRef.current(v);
  }, []);

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
  useEffect(() => {
    if (!party) return;
    for (const entry of partyCombatEntries) {
      if (seenIdsRef.current.has(entry.id)) continue;
      seenIdsRef.current.add(entry.id);
      if (ownLogIdsRef.current.has(entry.id)) continue;
      // Fallback: skip own messages that arrived via postgres_changes before ownLogIdsRef was populated
      if (entry.character_name === character.name) continue;
      processIncomingLog(entry.message, entry.character_name, entry.node_id);
    }
  }, [partyCombatEntries, party, processIncomingLog, character.name]);

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

  // Wire setRegenBuff for incoming log processing
  useEffect(() => { setRegenBuffFromIncomingRef.current = buffSetters.setRegenBuff; }, [buffSetters.setRegenBuff]);

  const {
    isDead,
    regenTick, deathCountdown, itemHpRegen, baseRegen,
    inCombatRegenRef, deathGoldRef,
  } = gameLoop;

  // Destructure buff state for convenient access in render
  const {
    regenBuff, foodBuff, critBuff, stealthBuff, damageBuff, rootDebuff, acBuff,
    poisonBuff, poisonStacks, evasionBuff, disengageNextHit, igniteBuff, igniteStacks,
    absorbBuff, partyRegenBuff, sunderDebuff, focusStrikeBuff, bleedStacks,
  } = buffState;

  // Apply incoming party regen buff from another party member
  useEffect(() => {
    if (!incomingPartyRegenBuff) return;
    buffSetters.setPartyRegenBuff(incomingPartyRegenBuff);
  }, [incomingPartyRegenBuff, buffSetters]);

  // ── Instant follower movement: when the leader broadcasts a move, followers
  //    update their own node immediately instead of waiting for Postgres Realtime.
  const lastLeaderMoveRef = useRef(0);
  useEffect(() => {
    if (!party || isLeader || !myMembership?.is_following) return;
    // Find the leader's latest move event
    const leaderMoves = partyMoveEvents.filter(e => e.character_id === party.leader_id);
    if (leaderMoves.length === 0) return;
    const latestMove = leaderMoves[leaderMoves.length - 1];
    // Skip if we already processed this (compare node_id + timestamp guard)
    if (latestMove.node_id === character.current_node_id) return;
    if (leaderMoves.length <= lastLeaderMoveRef.current) return;
    lastLeaderMoveRef.current = leaderMoves.length;
    // Optimistically update our own node to match the leader
    updateCharacter({ current_node_id: latestMove.node_id });
    addLocalLog(`You follow ${latestMove.character_name}.`);
  }, [party, isLeader, myMembership?.is_following, partyMoveEvents, character.current_node_id, updateCharacter, addLocalLog]);

  // Broadcast party regen buff when caster sets it
  const prevPartyRegenBuffRef = useRef<typeof partyRegenBuff>(null);
  useEffect(() => {
    if (!party || !partyRegenBuff || partyRegenBuff === prevPartyRegenBuffRef.current) return;
    prevPartyRegenBuffRef.current = partyRegenBuff;
    broadcastPartyRegenBuff(partyRegenBuff.healPerTick, partyRegenBuff.expiresAt, partyRegenBuff.source || 'bard', character.id);
  }, [party, buffState.partyRegenBuff, broadcastPartyRegenBuff, character.id]);

  // effectiveAC — recalculate from class + effective DEX (base + gear) to match server logic
  const acBuffBonus = acBuff && Date.now() < acBuff.expiresAt ? acBuff.bonus : 0;
  const effectiveDex = character.dex + (equipmentBonuses.dex || 0);
  const effectiveAC = calculateAC(character.class, effectiveDex) + (equipmentBonuses.ac || 0) + acBuffBonus;

  // ── Server effect sync — delegated to useBuffState via useGameLoop ──
  const handleActiveDots = useCallback((dots: Record<string, any>) => {
    gameLoop.syncFromServerEffects(dots[character.id]);
  }, [character.id, gameLoop.syncFromServerEffects]);

  // Determine if this character should use party combat mode:
  // Party mode when in a party AND on the same node as the leader
  const leaderMember = mergedPartyMembers.find(m => m.character_id === party?.leader_id);
  const leaderNodeId = leaderMember?.character?.current_node_id ?? null;
  const usePartyCombatMode = !!party && (isLeader || leaderNodeId === character.current_node_id);

  // Ref to break circular dependency: usePartyCombat needs ability executor, useActions needs queueAbility
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
    onPoisonProc: gameLoop.handleAddPoisonStack,
    onIgniteProc: gameLoop.handleAddIgniteStack,
    onAbilityExecute: async (index, targetId) => {
      await executeAbilityRef.current?.(index, targetId);
    },
  });

  const { inCombat, activeCombatCreatureId, engagedCreatureIds, creatureHpOverrides,
    lastTickTime, updateCreatureHp, startCombat, stopCombat: stopCombatFn,
    pendingAbility: _pendingAbility, queueAbility } = combat;

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

  // ── useActions: all player action handlers ─────────────────────
  const actions = useActions({
    character, updateCharacter, updateCharacterLocal, addLog,
    equipped, unequipped, equipmentBonuses,
    getNode, getRegion, getNodeArea, currentNode,
    creatures, creatureHpOverrides, updateCreatureHp,
    party, partyMembers, isLeader, myMembership,
    inCombat, activeCombatCreatureId, startCombat, stopCombat: stopCombatFn,
    queueAbility,
    isDead, effectiveAC,
    fetchInventory, fetchGroundLoot, fetchParty,
    broadcastMove, broadcastHp, broadcastDamage,
    useConsumable, xpMultiplier, toggleFollow,
    // All buff states + setters
    regenBuff, setRegenBuff: gameLoop.setRegenBuff,
    foodBuff, setFoodBuff: gameLoop.setFoodBuff,
    critBuff, setCritBuff: gameLoop.setCritBuff,
    stealthBuff, setStealthBuff: gameLoop.setStealthBuff,
    damageBuff, setDamageBuff: gameLoop.setDamageBuff,
    rootDebuff, setRootDebuff: gameLoop.setRootDebuff,
    acBuff, setAcBuff: gameLoop.setAcBuff,
    bleedStacks: gameLoop.bleedStacks, setBleedStacks: gameLoop.setBleedStacks,
    poisonBuff, setPoisonBuff: gameLoop.setPoisonBuff,
    poisonStacks, setPoisonStacks: gameLoop.setPoisonStacks,
    evasionBuff, setEvasionBuff: gameLoop.setEvasionBuff,
    disengageNextHit, setDisengageNextHit: gameLoop.setDisengageNextHit,
    igniteBuff, setIgniteBuff: gameLoop.setIgniteBuff,
    igniteStacks, setIgniteStacks: gameLoop.setIgniteStacks,
    absorbBuff, setAbsorbBuff: gameLoop.setAbsorbBuff,
    partyRegenBuff, setPartyRegenBuff: gameLoop.setPartyRegenBuff,
    sunderDebuff, setSunderDebuff: gameLoop.setSunderDebuff,
    focusStrikeBuff, setFocusStrikeBuff: gameLoop.setFocusStrikeBuff,
    notifyCreatureKilled: gameLoop.notifyCreatureKilled,
    unlockedConnections,
    onUnlockPath: handleUnlockPath,
  });

  // Wire forward-declared refs
  useEffect(() => { rollLootRef.current = actions.rollLoot; }, [actions.rollLoot]);
  useEffect(() => { degradeEquipmentRef.current = actions.degradeEquipment; }, [actions.degradeEquipment]);
  useEffect(() => { awardKillRewardsRef.current = actions.awardKillRewards; }, [actions.awardKillRewards]);

  // Wire ability executor ref (updated synchronously to avoid stale closures)
  executeAbilityRef.current = (index: number, targetId?: string) => actions.handleUseAbility(index, targetId, true);


  const { handleMove, handleTeleport, handleReturnToWaymark, handleSearch,
    handleUseConsumable, handleUseAbility, handleAttack,
    waymarkNodeId, teleportOpen, setTeleportOpen } = actions;

  // ── Aggro processing is now handled inside usePartyCombat ──

  // ── Keyboard + chat ────────────────────────────────────────────
  const handleAbilityKey = useCallback((index: number) => {
    // For creature-targeting abilities, prefer selectedTargetId; for ally abilities, prefer abilityTargetId
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
    // If a target is selected via Tab, engage it (even mid-combat to switch targets)
    if (selectedTargetId) {
      const target = creatures.find(c => c.id === selectedTargetId && c.is_alive);
      if (target) { startCombat(target.id); return; }
    }
    // If already in combat with no new selection, do nothing
    if (inCombat) return;
    const firstCreature = creatures.find(c => c.is_alive);
    if (firstCreature) startCombat(firstCreature.id);
  }, [isDead, inCombat, creatures, selectedTargetId, startCombat]);

  const handleCycleTarget = useCallback(() => {
    if (isDead) return;
    const aliveCreatures = creatures.filter(c => c.is_alive);
    if (aliveCreatures.length === 0) return;

    // Cycle through ALL alive creatures
    const currentIdx = aliveCreatures.findIndex(c => c.id === (selectedTargetId ?? activeCombatCreatureId));
    const nextIdx = (currentIdx + 1) % aliveCreatures.length;
    const next = aliveCreatures[nextIdx];

    setSelectedTargetId(next.id);

    // Only auto-attack if the creature itself is aggressive or already engaged
    const engagedSet = new Set(engagedCreatureIds);
    if (next.is_aggressive || engagedSet.has(next.id)) {
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
                onAllocateStat={async (stat: string) => {
                  if (character.unspent_stat_points <= 0) return;
                  const currentVal = (character as any)[stat] ?? 10;
                  const updates: Partial<Character> = {
                    [stat]: currentVal + 1,
                    unspent_stat_points: character.unspent_stat_points - 1,
                  };
                  if (stat === 'con') {
                    updates.max_hp = character.max_hp + (getStatModifier(currentVal + 1) - getStatModifier(currentVal));
                    if (updates.max_hp !== character.max_hp) {
                      updates.hp = character.hp + (updates.max_hp - character.max_hp);
                    }
                  }
                  if (stat === 'int' || stat === 'wis' || stat === 'cha') {
                    const eInt = stat === 'int' ? currentVal + 1 : character.int;
                    const eWis = stat === 'wis' ? currentVal + 1 : character.wis;
                    const eCha = stat === 'cha' ? currentVal + 1 : character.cha;
                    const newMaxCp = getMaxCp(character.level, eInt, eWis, eCha);
                    if (newMaxCp !== character.max_cp) {
                      updates.max_cp = newMaxCp;
                      updates.cp = Math.min((character.cp ?? 0) + (newMaxCp - character.max_cp), newMaxCp);
                    }
                  }
                  if (stat === 'dex') {
                    const newMaxMp = getMaxMp(character.level, currentVal + 1);
                    if (newMaxMp !== (character.max_mp ?? 100)) {
                      updates.max_mp = newMaxMp;
                      updates.mp = Math.min((character.mp ?? 100) + (newMaxMp - (character.max_mp ?? 100)), newMaxMp);
                    }
                  }
                  await updateCharacter(updates);
                  addLog(`📊 +1 ${stat.toUpperCase()}! (${character.unspent_stat_points - 1} points remaining)`);
                }}
                onFullRespec={async () => {
                  if ((character.respec_points || 0) <= 0) return;
                  const creationStats = calculateStats(character.race, character.class);
                  const levelBonuses = CLASS_LEVEL_BONUSES[character.class] || {};
                  let totalRefunded = 0;
                  const updates: Partial<Character> = {
                    respec_points: (character.respec_points || 0) - 1,
                  };
                  for (const stat of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
                    const levelBonusTotal = Math.floor((character.level - 1) / 3) * (levelBonuses[stat] || 0);
                    const nonManualBase = (creationStats[stat] || 8) + levelBonusTotal;
                    const manualPoints = (character as any)[stat] - nonManualBase;
                    if (manualPoints > 0) {
                      (updates as any)[stat] = nonManualBase;
                      totalRefunded += manualPoints;
                    }
                  }
                  updates.unspent_stat_points = character.unspent_stat_points + totalRefunded;
                  const newCon = (updates.con ?? character.con) as number;
                  const newMaxHp = calculateHP(character.class, newCon) + (character.level - 1) * 5;
                  updates.max_hp = newMaxHp;
                  updates.hp = Math.min(character.hp, newMaxHp);
                  const newInt = (updates.int ?? character.int) as number;
                  const newWis = (updates.wis ?? character.wis) as number;
                  const newCha = (updates.cha ?? character.cha) as number;
                  updates.max_cp = getMaxCp(character.level, newInt, newWis, newCha);
                  updates.cp = Math.min(character.cp ?? 0, updates.max_cp);
                  const newDex = (updates.dex ?? character.dex) as number;
                  updates.max_mp = getMaxMp(character.level, newDex);
                  updates.mp = Math.min(character.mp ?? 100, updates.max_mp);
                  await updateCharacter(updates);
                  addLog(`🔄 Full respec! ${totalRefunded} stat point${totalRefunded !== 1 ? 's' : ''} refunded.`);
                }}
                onBatchAllocateStats={async (allocations: Record<string, number>) => {
                  const totalPoints = Object.values(allocations).reduce((s, v) => s + v, 0);
                  if (totalPoints <= 0 || totalPoints > character.unspent_stat_points) return;
                  const updates: Partial<Character> = {
                    unspent_stat_points: character.unspent_stat_points - totalPoints,
                  };
                  for (const [stat, amount] of Object.entries(allocations)) {
                    const currentVal = (character as any)[stat] ?? 10;
                    (updates as any)[stat] = currentVal + amount;
                  }
                  const newCon = (updates.con ?? character.con) as number;
                  const oldConMod = getStatModifier(character.con);
                  const newConMod = getStatModifier(newCon);
                  if (newConMod !== oldConMod) {
                    const hpDelta = newConMod - oldConMod;
                    updates.max_hp = character.max_hp + hpDelta;
                    updates.hp = character.hp + hpDelta;
                  }
                  const newInt = (updates.int ?? character.int) as number;
                  const newWis = (updates.wis ?? character.wis) as number;
                  const newCha = (updates.cha ?? character.cha) as number;
                  const newMaxCp = getMaxCp(character.level, newInt, newWis, newCha);
                  if (newMaxCp !== character.max_cp) {
                    updates.max_cp = newMaxCp;
                    updates.cp = Math.min((character.cp ?? 0) + (newMaxCp - character.max_cp), newMaxCp);
                  }
                  const newDex = (updates.dex ?? character.dex) as number;
                  const newMaxMp = getMaxMp(character.level, newDex);
                  if (newMaxMp !== (character.max_mp ?? 100)) {
                    updates.max_mp = newMaxMp;
                    updates.mp = Math.min((character.mp ?? 100) + (newMaxMp - (character.max_mp ?? 100)), newMaxMp);
                  }
                  await updateCharacter(updates);
                  const statList = Object.entries(allocations).map(([s, v]) => `+${v} ${s.toUpperCase()}`).join(', ');
                  addLog(`📊 Batch allocation: ${statList} (${character.unspent_stat_points - totalPoints} points remaining)`);
                }}
              />
            </SheetContent>
          </Sheet>
        ) : (
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
              onAllocateStat={async (stat: string) => {
                if (character.unspent_stat_points <= 0) return;
                const currentVal = (character as any)[stat] ?? 10;
                const updates: Partial<Character> = {
                  [stat]: currentVal + 1,
                  unspent_stat_points: character.unspent_stat_points - 1,
                };
                if (stat === 'con') {
                  updates.max_hp = character.max_hp + (getStatModifier(currentVal + 1) - getStatModifier(currentVal));
                  if (updates.max_hp !== character.max_hp) {
                    updates.hp = character.hp + (updates.max_hp - character.max_hp);
                  }
                }
                if (stat === 'int' || stat === 'wis' || stat === 'cha') {
                  const eInt = stat === 'int' ? currentVal + 1 : character.int;
                  const eWis = stat === 'wis' ? currentVal + 1 : character.wis;
                  const eCha = stat === 'cha' ? currentVal + 1 : character.cha;
                  const newMaxCp = getMaxCp(character.level, eInt, eWis, eCha);
                  if (newMaxCp !== character.max_cp) {
                    updates.max_cp = newMaxCp;
                    updates.cp = Math.min((character.cp ?? 0) + (newMaxCp - character.max_cp), newMaxCp);
                  }
                }
                if (stat === 'dex') {
                  const newMaxMp = getMaxMp(character.level, currentVal + 1);
                  if (newMaxMp !== (character.max_mp ?? 100)) {
                    updates.max_mp = newMaxMp;
                    updates.mp = Math.min((character.mp ?? 100) + (newMaxMp - (character.max_mp ?? 100)), newMaxMp);
                  }
                }
                await updateCharacter(updates);
                addLog(`📊 +1 ${stat.toUpperCase()}! (${character.unspent_stat_points - 1} points remaining)`);
              }}
              onFullRespec={async () => {
                if ((character.respec_points || 0) <= 0) return;
                const creationStats = calculateStats(character.race, character.class);
                const levelBonuses = CLASS_LEVEL_BONUSES[character.class] || {};
                let totalRefunded = 0;
                const updates: Partial<Character> = {
                  respec_points: (character.respec_points || 0) - 1,
                };
                for (const stat of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
                  const levelBonusTotal = Math.floor((character.level - 1) / 3) * (levelBonuses[stat] || 0);
                  const nonManualBase = (creationStats[stat] || 8) + levelBonusTotal;
                  const manualPoints = (character as any)[stat] - nonManualBase;
                  if (manualPoints > 0) {
                    (updates as any)[stat] = nonManualBase;
                    totalRefunded += manualPoints;
                  }
                }
                updates.unspent_stat_points = character.unspent_stat_points + totalRefunded;
                const newCon = (updates.con ?? character.con) as number;
                const newMaxHp = calculateHP(character.class, newCon) + (character.level - 1) * 5;
                updates.max_hp = newMaxHp;
                updates.hp = Math.min(character.hp, newMaxHp);
                const newInt = (updates.int ?? character.int) as number;
                const newWis = (updates.wis ?? character.wis) as number;
                const newCha = (updates.cha ?? character.cha) as number;
                updates.max_cp = getMaxCp(character.level, newInt, newWis, newCha);
                updates.cp = Math.min(character.cp ?? 0, updates.max_cp);
                const newDex = (updates.dex ?? character.dex) as number;
                updates.max_mp = getMaxMp(character.level, newDex);
                updates.mp = Math.min(character.mp ?? 100, updates.max_mp);
                await updateCharacter(updates);
                addLog(`🔄 Full respec! ${totalRefunded} stat point${totalRefunded !== 1 ? 's' : ''} refunded.`);
              }}
              onBatchAllocateStats={async (allocations: Record<string, number>) => {
                const totalPoints = Object.values(allocations).reduce((s, v) => s + v, 0);
                if (totalPoints <= 0 || totalPoints > character.unspent_stat_points) return;
                const updates: Partial<Character> = {
                  unspent_stat_points: character.unspent_stat_points - totalPoints,
                };
                for (const [stat, amount] of Object.entries(allocations)) {
                  const currentVal = (character as any)[stat] ?? 10;
                  (updates as any)[stat] = currentVal + amount;
                }
                const newCon = (updates.con ?? character.con) as number;
                const oldConMod = getStatModifier(character.con);
                const newConMod = getStatModifier(newCon);
                if (newConMod !== oldConMod) {
                  const hpDelta = newConMod - oldConMod;
                  updates.max_hp = character.max_hp + hpDelta;
                  updates.hp = character.hp + hpDelta;
                }
                const newInt = (updates.int ?? character.int) as number;
                const newWis = (updates.wis ?? character.wis) as number;
                const newCha = (updates.cha ?? character.cha) as number;
                const newMaxCp = getMaxCp(character.level, newInt, newWis, newCha);
                if (newMaxCp !== character.max_cp) {
                  updates.max_cp = newMaxCp;
                  updates.cp = Math.min((character.cp ?? 0) + (newMaxCp - character.max_cp), newMaxCp);
                }
                const newDex = (updates.dex ?? character.dex) as number;
                const newMaxMp = getMaxMp(character.level, newDex);
                if (newMaxMp !== (character.max_mp ?? 100)) {
                  updates.max_mp = newMaxMp;
                  updates.mp = Math.min((character.mp ?? 100) + (newMaxMp - (character.max_mp ?? 100)), newMaxMp);
                }
                await updateCharacter(updates);
                const statList = Object.entries(allocations).map(([s, v]) => `+${v} ${s.toUpperCase()}`).join(', ');
                addLog(`📊 Batch allocation: ${statList} (${character.unspent_stat_points - totalPoints} points remaining)`);
              }}
            />
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
              creatureHpOverrides={{ ...broadcastOverrides, ...creatureHpOverrides }}
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
              partyMemberHp={party ? new Map(mergedPartyMembers.filter(m => m.status === 'accepted').map(m => [m.character_id, { hp: m.character.hp, max_hp: m.character.max_hp }])) : undefined}
              statusBarsProps={{
                equipmentBonuses,
                inventoryCount: getBagWeight(unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined)),
                isAtInn: currentNode?.is_inn ?? false,
                regenBuff, regenTick, baseRegen, itemHpRegen, foodBuff, critBuff, acBuff,
                poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, focusStrikeBuff, stealthBuff,
              }}
            />
          </div>
          {/* Event Log */}
          <div className="flex-[1] min-h-0 border-t border-border px-3 py-2 flex flex-col">
            <h3 className="font-display text-xs text-muted-foreground mb-1 shrink-0">Event Log</h3>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 bg-background/30 rounded border border-border space-y-0.5">
              {filteredEventLog.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Your journey begins...</p>
              ) : (
                filteredEventLog.map((log, i) =>
                  log === '---tick---' ? (
                    <div key={i} className="border-t-2 border-border/60 my-2" />
                  ) : (
                    <p key={i} className={`text-xs ${getLogColor(log)}`}>{log}</p>
                  )
                )
              )}
              <div ref={logEndRef} />
            </div>
            {(!isWideScreen && chatOpen) && (
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
                onOpenTrainer={(currentNode.is_trainer && character.level >= 30) ? () => setTrainerOpen(true) : undefined}
                onOpenTeleport={(currentNode.is_teleport || character.level >= 25) ? () => {
                  if (inCombat) { addLog('⚠️ You cannot teleport while in combat!'); return; }
                  setTeleportOpen(true);
                } : undefined}
searchDisabled={character.cp < 5 || creatures.length > 0}
                hasDiscoverable={!!(currentNode.connections?.some((c: any) => c.hidden) || (currentNode.searchable_items && currentNode.searchable_items.length > 0))}
                unlockedConnections={unlockedConnections}
              />
            </SheetContent>
          </Sheet>
        ) : (
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
              onOpenTrainer={(currentNode.is_trainer && character.level >= 30) ? () => setTrainerOpen(true) : undefined}
              onOpenTeleport={(currentNode.is_teleport || character.level >= 25) ? () => {
                if (inCombat) { addLog('⚠️ You cannot teleport while in combat!'); return; }
                setTeleportOpen(true);
              } : undefined}
              searchDisabled={character.cp < 5 || creatures.length > 0}
              hasDiscoverable={!!(currentNode.connections?.some((c: any) => c.hidden) || (currentNode.searchable_items && currentNode.searchable_items.length > 0))}
              unlockedConnections={unlockedConnections}
            />
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
          <div className="h-full w-[320px] shrink-0 ornate-border bg-card/60 flex flex-col">
            <div className="px-3 py-2 border-b border-border shrink-0 flex items-center justify-between">
              <h3 className="font-display text-xs text-muted-foreground">Chat</h3>
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6"
                onClick={() => { setChatPanelOpen(false); localStorage.setItem('chatPanelOpen', 'false'); }}
                title="Collapse chat panel"
              >
                <MessageCircle className="w-3 h-3" />
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
              {chatMessages.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No messages yet. Press Enter to chat.</p>
              ) : (
                chatMessages.map((log, i) => (
                  <p key={i} className={`text-xs ${getLogColor(log)}`}>{log}</p>
                ))
              )}
            </div>
            <div className="shrink-0 px-2 pb-2">
              <Input
                ref={isWideScreen ? chatInputRef : undefined}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); handleChatSubmit(); }
                  if (e.key === 'Escape') { setChatInput(''); }
                }}
                placeholder="/w name msg to whisper"
                className="h-7 text-xs bg-background/50 border-border"
                autoComplete="off"
              />
            </div>
          </div>
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

      {/* Broadcast Debug Overlay — admin only */}
      {isAdmin && <BroadcastDebugOverlay />}

      {/* Movement Pad — tablet only */}
      {isTablet && <MovementPad currentNode={currentNode} onMove={handleMove} disabled={isDead} unlockedConnections={unlockedConnections} />}
    </div>
  );
}
