import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { LoadingScreen } from '@/components/LoadingScreen';

import CharacterPanel from '@/features/character/components/CharacterPanel';
import { useAbilityLoadout } from '@/hooks/useAbilityLoadout';
import { useAbilityRegistry } from '@/hooks/useAbilityRegistry';
import NodeView from '@/features/world/components/NodeView';
import MapPanel from '@/features/world/components/MapPanel';
import VendorPanel from '@/features/inventory/components/VendorPanel';
import MapItemDialog from '@/features/inventory/components/MapItemDialog';
import BlacksmithPanel from '@/features/inventory/components/BlacksmithPanel';
import JewelcrafterPanel from '@/features/inventory/components/JewelcrafterPanel';
import StonebinderPanel from '@/features/inventory/components/StonebinderPanel';
import HeraldryPanel from '@/features/character/components/HeraldryPanel';
import TrainerPanel from '@/features/character/components/TrainerPanel';
import TeleportDialog from '@/features/world/components/TeleportDialog';
import { useGroundLoot } from '@/features/inventory';
import { Character } from '@/features/character';
import { useNodes } from '@/features/world';
import { useNodeChannel } from '@/features/world';
import { useGlobalPresence } from '@/hooks/useGlobalPresence';
import { useCreatures } from '@/features/creatures';
import { useItemCache } from '@/features/inventory';
import { useCreatureBroadcast, useMergedCreatureHpOverrides, useBossCasts } from '@/features/combat';
import { usePartyBroadcast } from '@/features/party';
import { useNPCs, NPC } from '@/features/creatures';
import NPCDialogPanel from '@/features/creatures/components/NPCDialogPanel';
import OrderRecruiterDialog from '@/features/character/components/OrderRecruiterDialog';
import SoulforgeDialog from '@/features/inventory/components/SoulforgeDialog';
import { useFirstEntryWelcome } from '@/features/world/hooks/useFirstEntryWelcome';
import { useSoulringGlow } from '@/features/inventory/hooks/useSoulringGlow';
import MarketplacePanel from '@/features/marketplace/components/MarketplacePanel';
import { useMarketplaceSaleAlerts } from '@/features/marketplace/hooks/useMarketplaceSaleAlerts';
import { useInventory } from '@/features/inventory';
import { useParty } from '@/features/party';
import { usePartyCombatLog } from '@/features/combat';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import { buildEngageEvent } from '@/features/combat/events/threat-event-builder';
import { legacyStringToEvent } from '@/features/combat/events/legacy-adapter';

import { useCombatDriver } from '@/features/combat';
import { getBagWeight, getEffectiveMaxHp, getEffectiveAC } from '@/lib/game-data';
import { CLASS_ABILITIES } from '@/features/combat';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { User, Map as MapIconLucide, MessageCircle, Users } from 'lucide-react';

import { useKeyboardMovement } from '@/features/world';

import { useChat, parseCommand } from '@/features/chat';
import { getNodeDisplayName, getNodeDisplayDescription } from '@/features/world';
import { useXpBoost } from '@/hooks/useXpBoost';
import { APP_VERSION } from '@/lib/version';
import { useCreateGameEventBus, useGameEvent } from '@/hooks/useGameEvents';
import { useGameLoop } from '@/features/combat';
import { useCombatActions } from '@/features/combat/hooks/useCombatActions';
import { useWimp } from '@/features/combat/hooks/useWimp';
import { useMovementActions } from '@/features/world/hooks/useMovementActions';
import { useConsumableActions } from '@/features/inventory/hooks/useConsumableActions';
import BroadcastDebugOverlay from '@/components/game/BroadcastDebugOverlay';
import CombatTimingPanel from '@/components/admin/CombatTimingPanel';
import MovementPad from '@/features/world/components/MovementPad';
import { useStatAllocation } from '@/features/character/hooks/useStatAllocation';
import EventLogPanel from '@/features/combat/components/EventLogPanel';
import EventLogControls from '@/features/combat/components/EventLogControls';
import { useEventLogDisplay } from '@/features/combat/hooks/useEventLogDisplay';
import { useLogArchive } from '@/features/combat/hooks/useLogArchive';
import { AbilityBarMeasurer } from '@/features/combat/components/AbilityBarMeasurer';
import ChatPanel from '@/features/chat/components/ChatPanel';
import OnlinePanel from '@/features/chat/components/OnlinePanel';
import CommandInputBar from '@/features/chat/components/CommandInputBar';
import { useSummonRequests } from '@/features/world/hooks/useSummonRequests';
import { useGlobalBroadcastSender, useGlobalBroadcastListener } from '@/hooks/useGlobalBroadcast';
import { OnboardingCoachmark } from '@/components/OnboardingCoachmark';
import { useGuide } from '@/features/guide/hooks/useGuide';
import { GuideReader } from '@/features/guide/components/GuideReader';
import { useCombat2ClientSession } from '@/features/combat2/Combat2ClientSession';
import { COMBAT2_CLIENT_ENABLED, COMBAT2_TEST_CHARACTER_ID } from '@/shared/config/feature-flags';
import { useCombat2TestOwnership } from '@/features/combat2/useCombat2TestOwnership';
import { useExecutionFence } from '@/features/combat2/execution-fence';
import { useControlledAction, isCombatMutation } from '@/features/combat2/controlled-actions';
import { Combat2TestStatus } from '@/features/combat2/Combat2TestStatus';
import { useCombat2Targets } from '@/features/combat2/useCombat2Targets';
import { routeCombat2Action, routeCombat2BasicAttack } from '@/features/combat2/routeCombat2Action';
import { selectCombat2Character, selectCombat2Creatures, selectCombat2Events } from '@/features/combat2/presentation-selectors';
import { combat2FleeCommandRefusal } from '@/features/combat2/event-message';

import { buildBuffEvent, buildErrorEvent, buildLootEvent, buildMovementEvent, buildSystemEvent } from '@/features/combat/events/client-event-builder';


interface Props {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  updateCharacterLocal?: (updates: Partial<Character>, hold?: boolean) => void;
  clearCharacterFields?: (updates: Partial<Character>) => void;

  onSignOut: () => void;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  startingNodeId?: string;
  onSwitchCharacter?: () => void;
  refetchCharacters?: () => void;
  /** True once `sync_character_resources` has resolved on entry. The regen
   *  loop waits on this so it doesn't write against pre-sync `max_*`. */
  resourcesSynced?: boolean;
}

export default function GamePage({ character, updateCharacter: writeCharacter, updateCharacterLocal: writeCharacterLocal, clearCharacterFields: clearFields, onSignOut, isAdmin, onOpenAdmin, startingNodeId, onSwitchCharacter, refetchCharacters, resourcesSynced = true }: Props) {
  const ownership = useCombat2TestOwnership({
    enabled: COMBAT2_CLIENT_ENABLED, characterId: character.id, nodeId: character.current_node_id,
    characterSetting: COMBAT2_TEST_CHARACTER_ID,
  });
  const combat2OwnsSession = ownership.combat2OwnsSession;
  // Reservation suspends legacy execution even before solo preflight/entry resolves.
  const combat2BlocksLegacy = ownership.blocksLegacy;
  const legacyExecution = useExecutionFence(!combat2BlocksLegacy);
  const [combat2Diagnostic, setCombat2Diagnostic] = useState<string | null>(null);
  const updateCharacter = useCallback(async (updates: Partial<Character>) => {
    if (!legacyExecution.allowed() && isCombatMutation(updates)) return;
    await writeCharacter(updates);
  }, [writeCharacter, legacyExecution]);
  const guardedCharacterLocal = useCallback((updates: Partial<Character>, hold?: boolean) => {
    if (!legacyExecution.allowed() && isCombatMutation(updates)) return;
    writeCharacterLocal?.(updates, hold);
  }, [writeCharacterLocal, legacyExecution]);
  const updateCharacterLocal = writeCharacterLocal ? guardedCharacterLocal : undefined;
  const guardedClearFields = useCallback((updates: Partial<Character>) => {
    if (!legacyExecution.allowed() && isCombatMutation(updates)) return;
    clearFields?.(updates);
  }, [clearFields, legacyExecution]);
  const clearCharacterFields = clearFields ? guardedClearFields : undefined;

  
  const bus = useCreateGameEventBus();
  useItemCache(); // Preload item cache on game entry

  // Tablet detection: left panel becomes a slide-out sheet on screens ≤1024px
  // Mobile detection: right panel also becomes a sheet on screens ≤768px
  const [isTablet, setIsTablet] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [charPanelOpen, setCharPanelOpen] = useState(false);
  const [mapPanelOpen, setMapPanelOpen] = useState(false);

  // Wayfarer's Guide — informational reader; never mutates game state.
  const [guideOpen, setGuideOpen] = useState(false);
  const guide = useGuide(character?.id);
  const openGuide = useCallback(() => {
    // Mobile: close the map sheet first so overlays never nest.
    setMapPanelOpen(false);
    setGuideOpen(true);
  }, []);

  const [isWideScreen, setIsWideScreen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(() => {
    const stored = localStorage.getItem('chatPanelOpen');
    return stored !== null ? stored === 'true' : true;
  });
  const [onlinePanelOpen, setOnlinePanelOpen] = useState(() => {
    const stored = localStorage.getItem('onlinePanelOpen');
    return stored !== null ? stored === 'true' : true;
  });
  // Chat lives in the right viewport gutter outside the centered game area.
  // Gutter width = max(0, (vw - 1920) / 2). If < 320 we collapse to an icon
  // pinned to the right edge that opens chat as a fixed 320px overlay.
  const GAME_MAX_WIDTH = 1920;
  const CHAT_MIN_WIDTH = 320;
  const [gutterWidth, setGutterWidth] = useState(() =>
    typeof window === 'undefined' ? 0 : Math.max(0, (window.innerWidth - GAME_MAX_WIDTH) / 2)
  );
  // Center panel max width is derived from the widest class's ability bar
  // (measured at runtime by AbilityBarMeasurer). Fallback ≈ Templar estimate.
  const [abilityBarWidth, setAbilityBarWidth] = useState<number>(720);
  const centerMaxWidth = Math.ceil(abilityBarWidth) + 256; // 128px wiggle each side
  const rowMaxWidth = Math.min(GAME_MAX_WIDTH, 400 + centerMaxWidth + 400);
  useEffect(() => {
    const onResize = () => setGutterWidth(Math.max(0, (window.innerWidth - rowMaxWidth) / 2));
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [rowMaxWidth]);
  const canFitChat = gutterWidth >= CHAT_MIN_WIDTH;
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
  const characterWithKing = character
    ? { ...character, is_king_slayer: !!character.king_slayer_at }
    : character;
  const nodeChannel = useNodeChannel(character.current_node_id, characterWithKing);
  const { playersHere } = nodeChannel;
  const { onlinePlayers } = useGlobalPresence(characterWithKing);
  const currentNodeForPrefetch = getNode(character.current_node_id || '');
  // Offscreen kill rewards are no longer surfaced from a client-triggered
  // catch-up: `combat-catchup` is an internal service-role endpoint. Rewards
  // arrive with the authoritative batch once an internal catch-up owner exists.

  // Resolver uses a ref so we can wire broadcast (which needs name lookup) BEFORE
  // useCreatures (which needs softDeadIds from broadcast). Avoids TDZ on `creatures`.
  const creaturesRef = useRef<{ id: string; name: string }[]>([]);
  const creatureNameResolver = useCallback((creatureId: string) => {
    return creaturesRef.current.find(c => c.id === creatureId)?.name;
  }, []);
  const emitLocalLog = useCallback((msg: string) => { bus.emit('log:local', { event: legacyStringToEvent(msg) }); }, [bus]);
  const { broadcastOverrides, softDeadIds, broadcastDamage, cleanupOverrides, markSoftDead } = useCreatureBroadcast(nodeChannel, character.current_node_id, character.id, emitLocalLog, creatureNameResolver);
  const { creatures, creaturesLoading, removeCreatureLocal, rosterActionable, rosterStatus, rosterError } = useCreatures(character.current_node_id, nodeChannel, currentNodeForPrefetch, softDeadIds, character.id);
  const combat2 = useCombat2ClientSession({
    enabled: combat2OwnsSession,
    controlled: true,
    inputLocked: ownership.locked,
    characterId: ownership.origin.characterId,
    classKey: character.class,
    nodeId: ownership.origin.nodeId,
    hasLivingCreatures: !ownership.locked && rosterActionable ? creatures.some((creature) => creature.is_alive) : null,
  });
  const activeCombat2Presentation = combat2OwnsSession
    ? combat2.presentation.model
    : null;
  const presentedCharacter = useMemo(() => selectCombat2Character(
    combat2BlocksLegacy, activeCombat2Presentation, character,
  ), [activeCombat2Presentation, character]);
  const presentedCreatures = useMemo(() => selectCombat2Creatures(
    combat2BlocksLegacy, activeCombat2Presentation, combat2BlocksLegacy
      ? creatures.filter(c => activeCombat2Presentation?.creatures.some(a => a.creatureId === c.id)) : creatures,
  ), [activeCombat2Presentation, creatures, combat2BlocksLegacy]);
  const combat2Targets = useCombat2Targets(combat2.actionsReady && !ownership.locked ? activeCombat2Presentation : null);
  const actionEpoch = `${activeCombat2Presentation?.encounterId}:${activeCombat2Presentation?.stateVersion}:${combat2.actionsReady}:${ownership.locked}`;
  const actionEpochRef = useRef(actionEpoch);
  actionEpochRef.current = actionEpoch;
  const combat2Status = ownership.locked ? 'Locked — unexpected relocation or party membership'
    : ownership.preflight === 'refused' ? 'Refused — solo, idle entry could not be verified'
    : ownership.preflight === 'checking' ? 'Checking solo eligibility'
    : combat2.dead ? 'Dead — recovery unavailable in this controlled test'
    : combat2.sessionStatus === 'exited' ? 'Exited — controlled session remains locked'
    : combat2.pendingFlee ? 'Flee pending'
    : combat2.entry.status === 'refused' ? 'Refused'
    : combat2.entry.status === 'error' || combat2.entry.status === 'uncertain' ? 'Transport/decoding error'
    : combat2.presentation.status === 'gap' ? 'Gap detected'
    : combat2.presentation.status === 'refused' ? 'Refused'
    : combat2.presentation.status === 'error' ? 'Transport/decoding error'
    : combat2.actionsReady ? 'Ready'
    : combat2.presentation.status === 'reconnecting' ? 'Reconnecting'
    : combat2.entry.status === 'entered' ? 'Synchronizing' : 'Entering';
  const presentedCreatureHp = useMemo(() => activeCombat2Presentation
    ? Object.fromEntries(activeCombat2Presentation.creatures.map((creature) => [creature.creatureId, creature.hp]))
    : null, [activeCombat2Presentation]);
  useEffect(() => { creaturesRef.current = creatures; }, [creatures]);

  useEffect(() => {
    cleanupOverrides(creatures.map(c => c.id));
  }, [creatures, cleanupOverrides]);
  const { npcs } = useNPCs(character.current_node_id);
  const { xpMultiplier, xpBoostExpiresAt } = useXpBoost();
  const [talkingToNPC, setTalkingToNPC] = useState<NPC | null>(null);
  const [openMapInvId, setOpenMapInvId] = useState<string | null>(null);
  const [legacySelectedTargetId, setLegacySelectedTargetId] = useState<string | null>(null);
  const selectedTargetId = combat2BlocksLegacy ? combat2Targets.selectedId : legacySelectedTargetId;
  const setSelectedTargetId = combat2BlocksLegacy ? combat2Targets.select : setLegacySelectedTargetId;
  const { equipped, unequipped, equipmentBonuses, fetchInventory, equipItem: legacyEquipItem, unequipItem: legacyUnequipItem, dropItem, useConsumable: legacyUseConsumable, togglePin } = useInventory(character.id, { onResourcesSynced: refetchCharacters });
  const equipItem = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyEquipItem);
  const unequipItem = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyUnequipItem);
  const useConsumable = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyUseConsumable);
  const {
    party, members: partyMembers, pendingInvites, isLeader, isTank, myMembership,
    createParty: legacyCreateParty, invitePlayer: legacyInvitePlayer, acceptInvite: legacyAcceptInvite, declineInvite,
    leaveParty, kickMember, setTank, toggleFollow: legacyToggleFollow, fetchParty,
  } = useParty(character.id);
  const createParty = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyCreateParty);
  const invitePlayer = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyInvitePlayer);
  const acceptInvite = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyAcceptInvite);
  const toggleFollow = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyToggleFollow);
  const { pendingSummons, acceptSummon: legacyAcceptSummon, declineSummon } = useSummonRequests(character.id);
  const acceptSummon = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyAcceptSummon);
  useEffect(() => {
    if (combat2BlocksLegacy && (party || myMembership?.is_following)) ownership.lock();
  }, [combat2BlocksLegacy, party, myMembership?.is_following]);
  const { addPartyCombatLog } = usePartyCombatLog(party?.id ?? null);
  const {
    hpOverrides: partyHpOverrides, moveEvents: partyMoveEvents,
    broadcastLogEntries, rewardEvents: partyRewardEvents,
    incomingPartyRegenBuff, incomingInspireBuff,
    broadcastHp, broadcastMove, broadcastCombatMsg, broadcastPartyRegenBuff, broadcastInspireBuff,
  } = usePartyBroadcast(party?.id ?? null, character.id);

  // Broadcast own HP whenever it changes (use effective max HP including gear bonuses)
  const effectiveMaxHp = getEffectiveMaxHp(character.class, character.con, character.level, equipmentBonuses);

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
        bus.emit('log', { event: buildMovementEvent(`You hurry after ${leaderName}.`, { effectType: 'party_follow' }) });
      }
    } else {
      // Mismatch or grace expired — tolerate one miss before breaking
      lastFollowMoveTimestampRef.current = myMove.timestamp;
      missedFollowCountRef.current += 1;
      if (missedFollowCountRef.current >= 2) {
        missedFollowCountRef.current = 0;
        toggleFollow(false);
        const leaderName = partyMembers.find(m => m.character_id === party?.leader_id)?.character?.name;
        bus.emit('log', { event: buildSystemEvent(`You lose track of ${leaderName ?? 'your leader'} and stop following.`, { effectType: 'party_follow' }) });
      }
    }
  }, [partyMoveEvents, character?.id, character?.current_node_id, updateCharacterLocal, myMembership?.is_following, isLeader, partyMembers, party?.leader_id, toggleFollow, bus]);

  const [eventLog, setEventLog] = useState<GameLogEvent[]>([]);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [blacksmithOpen, setBlacksmithOpen] = useState(false);
  const [jewelcrafterOpen, setJewelcrafterOpen] = useState(false);
  const [stonebinderOpen, setStonebinderOpen] = useState(false);
  const [heraldryOpen, setHeraldryOpen] = useState(false);
  /** Service NPC currently framing the open Vendor/Blacksmith panel (subtitle). */
  const [activeServiceNpc, setActiveServiceNpc] = useState<NPC | null>(null);

  /**
   * Talk routing: service-role NPCs (vendor/blacksmith/jewelcrafter/trainer) open the matching
   * service panel directly with the NPC's name + flavor as subtitle. All
   * other NPCs fall through to the standard dialog.
   */
  const handleTalkToNPC = (npc: NPC) => {
    if (npc.service_role === 'vendor' && currentNode?.is_vendor) {
      setActiveServiceNpc(npc);
      setVendorOpen(true);
      return;
    }
    if (npc.service_role === 'blacksmith' && currentNode?.is_blacksmith) {
      setActiveServiceNpc(npc);
      setBlacksmithOpen(true);
      return;
    }
    if (npc.service_role === 'jewelcrafter' && (currentNode as any)?.is_jewelcrafter) {
      setActiveServiceNpc(npc);
      setJewelcrafterOpen(true);
      return;
    }
    if (npc.service_role === 'trainer' && currentNode?.is_trainer) {
      setActiveServiceNpc(npc);
      setTrainerOpen(true);
      return;
    }
    if (npc.service_role === 'recruiter' && (currentNode as any)?.class_hall) {
      setActiveServiceNpc(npc);
      setRecruiterOpen(true);
      return;
    }
    if (npc.service_role === 'heraldry' && (currentNode as any)?.is_heraldry) {
      setActiveServiceNpc(npc);
      setHeraldryOpen(true);
      return;
    }
    setTalkingToNPC(npc);
  };
  const [trainerOpen, setTrainerOpen] = useState(false);
  const [recruiterOpen, setRecruiterOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [abilityTargetId, setAbilityTargetId] = useState<string | null>(null);
  /**
   * Loot lines from other characters on this node. Party mates already get the
   * line through the party log, so they are skipped here to avoid duplicates.
   */
  const partyMateIdsRef = useRef<Set<string>>(new Set());
  partyMateIdsRef.current = new Set(
    partyMembers.filter(m => m.status === 'accepted' && m.character_id !== character.id).map(m => m.character_id),
  );
  const handleRemoteLootLog = useCallback((info: { actorId: string; actorName: string; itemName: string; kind: 'pickup' | 'drop' }) => {
    if (partyMateIdsRef.current.has(info.actorId)) return;
    const text = info.kind === 'pickup'
      ? `${info.actorName} picks up ${info.itemName}.`
      : `${info.actorName} dropped ${info.itemName} on the ground.`;
    bus.emit('log:local', { event: buildLootEvent(text, { player: { kind: 'player', id: info.actorId, name: info.actorName } }) });
  }, [bus]);
  const { groundLoot, pickUpItem, dropItemToGround, fetchGroundLoot } = useGroundLoot(
    nodeChannel,
    character.current_node_id,
    character.id,
    { characterName: character.name, onRemoteLootLog: handleRemoteLootLog },
  );


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

  
  const [chatInput, setChatInput] = useState('');
  const eventLogDisplay = useEventLogDisplay();
  const chatInputRef = useRef<HTMLInputElement>(null);
  const ownLogIdsRef = useRef<Set<string>>(new Set());

  // ── Event bus subscribers ──────────────────────────────────────
  useGameEvent(bus, 'log', ({ event }) => {
    setEventLog(prev => [...prev.slice(-99), event]);
  });
  useGameEvent(bus, 'log', ({ event }) => {
    (async () => {
      const id = await addPartyCombatLog(event, character.current_node_id, character.name);
      if (id) {
        ownLogIdsRef.current.add(id);
        broadcastCombatMsg(event, character.current_node_id, character.name);
      }
    })();
  });
  useGameEvent(bus, 'log:local', ({ event }) => {
    setEventLog(prev => [...prev.slice(-99), event]);
  });
  useGameEvent(bus, 'creature:damage', (payload) => {
    broadcastDamage(payload.creatureId, payload.newHp, payload.damage, payload.attackerName, payload.killed);
  });

  // ── Log emitters ───────────────────────────────────────────────
  // String emitters are a stage-1 shim: they adapt at the emit boundary so
  // the bus, state and renderer only ever see structured events. Callers are
  // migrated to structured emits in later stages.
  /** Structured emitter — no adapter, no string inspection (stage 2+). */
  const addLocalLogEvent = useCallback((event: GameLogEvent) => {
    bus.emit('log:local', { event });
  }, [bus]);

  /** Structured emitter on the shared log path (stage 9+). */
  const addLogEvent = useCallback((event: GameLogEvent) => {
    bus.emit('log', { event });
  }, [bus]);

  // First-entry immersive welcome (staggered) or short returning greeting.
  // Uses the local-only emitter — these are personal narrative and must not
  // be persisted to the party log or broadcast to nearby players.
  useFirstEntryWelcome(character?.id, character?.level, addLocalLogEvent);
  // Whisper + transient ring glow when soulring tier increases. Local-only
  // for the same reason as the welcome above.
  const soulringGlow = useSoulringGlow(character?.id, character?.soulring_tier, addLocalLogEvent);

  // Sale-completed alert: fires whenever one of this character's listings sells,
  // whether or not the marketplace panel is open. Tells the seller to go collect.
  useMarketplaceSaleAlerts(character.id, (sale) => {
    addLogEvent(buildSystemEvent(`Your ${sale.item_name} sold for ${sale.price.toLocaleString()} gold — collect your earnings at any marketplace.`, { amount: sale.price, amountKind: 'gold', effectType: 'market_sale', severity: 'notable' }));
    toast.success(`${sale.item_name} sold for ${sale.price.toLocaleString()} gold`, {
      description: 'Visit any marketplace to collect your earnings.',
    });
  });

  // ── Unified global broadcast (`world-global`) ─────────────────
  // Receives flavor events visible to every online player:
  //   - market_listed  — "Market: X lists Y for Z gold"
  //   - player_death   — "X has fallen."
  //   - boss_death     — "<world emote>" (atmospheric narration, no boss name)
  // Self-echo is skipped via `actor === character.name`.
  const sendGlobal = useGlobalBroadcastSender();
  useGlobalBroadcastListener((p) => {
    // King crowning: the slayer themselves needs to refresh their character row
    // so the King/Queen title appears immediately (the realtime UPDATE on
    // characters.king_slayer_at can lag behind this broadcast). Skip the log
    // for the slayer but still trigger the refetch.
    if (p.kind === 'king_crowned' && p.actor && p.actor === character.name) {
      refetchCharacters?.();
      return;
    }
    if (p.actor && p.actor === character.name) return;
    addLocalLogEvent(buildSystemEvent(p.text, { scope: 'global', severity: 'notable' }));
  });

  // ── Player death cry — broadcast to other players ─────────────
  useGameEvent(bus, 'player:death', () => {
    sendGlobal({
      kind: 'player_death',
      text: `${character.name} has fallen.`,
      actor: character.name,
    });
  });

  // Track player arrivals/departures
  const prevPlayersRef = useRef<Set<string>>(new Set());
  const prevPlayerNamesRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const currentIds = new Set(playersHere.map(p => p.id));
    const prevIds = prevPlayersRef.current;
    if (prevIds.size > 0 || currentIds.size === 0) {
      for (const p of playersHere) {
        if (!prevIds.has(p.id)) addLocalLogEvent(buildSystemEvent(`${p.name} has arrived.`, { effectType: 'presence' }));
      }
      for (const id of prevIds) {
        if (!currentIds.has(id)) {
          const name = prevPlayerNamesRef.current.get(id);
          if (name) addLocalLogEvent(buildSystemEvent(`${name} has departed.`, { effectType: 'presence' }));
        }
      }
    }
    prevPlayersRef.current = currentIds;
    const nameMap = new Map<string, string>();
    for (const p of playersHere) nameMap.set(p.id, p.name);
    prevPlayerNamesRef.current = nameMap;
  }, [playersHere, addLocalLogEvent]);

  // Incoming party log processing
  /**
   * Ingest a party/broadcast entry. A structured `event` always wins; only
   * string-only entries (older clients, historical rows) go through the
   * legacy adapter, which also performs the observer "you → Name" rewrite.
   */
  const processIncomingLog = useCallback((
    entry: { id: string; message: string; event?: GameLogEvent },
    characterName: string | null,
    nodeId: string | null,
  ) => {
    if (nodeId && nodeId !== character.current_node_id) return;
    if (entry.event) {
      const ev = entry.event;
      setEventLog(prev => [...prev.slice(-99), {
        ...ev,
        // Observer perspective: prefer the emitter-authored remote wording.
        message: ev.remoteMessage ?? ev.message,
        observed: true,
      }]);
      return;
    }
    const cleaned = entry.message.replace('[INSPIRE_BUFF]', '').trim();
    setEventLog(prev => [...prev.slice(-99), legacyStringToEvent(cleaned, {
      id: entry.id,
      remoteName: characterName,
    })]);
  }, [character.current_node_id]);


  const seenIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!party) return;
    for (const entry of broadcastLogEntries) {
      if (seenIdsRef.current.has(entry.id)) continue;
      seenIdsRef.current.add(entry.id);
      if (ownLogIdsRef.current.has(entry.id)) continue;
      processIncomingLog(entry, entry.character_name, entry.node_id);
    }
  }, [broadcastLogEntries, party, processIncomingLog]);


  // Update last_online periodically — but only while the tab is visible,
  // plus one final write when the tab is hidden / unloaded. This cuts the
  // heartbeat write rate dramatically for backgrounded tabs without
  // hurting "last seen" precision (all readers use ≥30 min granularity).
  useEffect(() => {
    const updateOnline = () => {
      // Skip heartbeat in admin-only sessions so admins poking around
      // /admin don't wake the world.
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('lovable.adminOnlySession') === '1') return;
      supabase.from('characters').update({ last_online: new Date().toISOString() } as any).eq('id', character.id).then(() => {});
    };
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval !== null) return;
      updateOnline();
      interval = setInterval(updateOnline, 60000);
    };
    const stop = () => {
      if (interval !== null) { clearInterval(interval); interval = null; }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else { updateOnline(); stop(); }
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', updateOnline);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', updateOnline);
    };
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
  const degradeEquipmentRef = useRef<() => Promise<void>>(async () => {});

  // ── useGameLoop: regen, death, buff state ────────────────
  const gameLoop = useGameLoop({
    combatEnabled: !combat2BlocksLegacy,
    character, updateCharacter: writeCharacter, updateCharacterLocal: writeCharacterLocal, equipped, equipmentBonuses, getNode, addLogEvent,
    startingNodeId, creatures,
    party, partyMembers,
    bus,
    enabled: resourcesSynced,
  });


  const { buffState, buffSetters } = gameLoop;

  const {
    isDead: legacyIsDead,
    regenTick, deathCountdown, itemHpRegen, baseRegen,
    inCombatRegenRef, deathGoldRef,
  } = gameLoop;
  const isDead = combat2BlocksLegacy ? combat2.dead : legacyIsDead;

  const {
    foodBuff, critBuff, stealthBuff, damageBuff, rootDebuff, battleCryBuff,
    poisonBuff, poisonStacks, evasionBuff, igniteBuff, igniteStacks,
    absorbBuff, partyRegenBuff, sunderDebuff, bleedStacks,
    inspireBuff,
    holyShieldBuff, consecrateBuff, divineChallengeBuff,
  } = buffState;

  // Apply incoming party regen buff from another party member
  useEffect(() => {
    if (!incomingPartyRegenBuff) return;
    buffSetters.setPartyRegenBuff(incomingPartyRegenBuff);
  }, [incomingPartyRegenBuff, buffSetters]);

  // Apply incoming Inspire buff from a party Bard (same party channel — listener
  // already filters caster self-echo). Recast policy mirrors the caster path:
  // refresh the timer to the new caster's duration; keep the best-of HP/CP regen.
  useEffect(() => {
    if (!incomingInspireBuff) return;
    buffSetters.setInspireBuff(prev => {
      const now = Date.now();
      const stillActive = !!(prev && prev.expiresAt > now);
      if (!stillActive) return incomingInspireBuff;
      return {
        hpPerTick: Math.max(prev!.hpPerTick, incomingInspireBuff.hpPerTick),
        cpPerTick: Math.max(prev!.cpPerTick, incomingInspireBuff.cpPerTick),
        expiresAt: incomingInspireBuff.expiresAt,
        durationMs: incomingInspireBuff.durationMs,
        casterId: incomingInspireBuff.casterId,
      };
    });
  }, [incomingInspireBuff, buffSetters]);

  // Follower movement is handled server-side by leader's moveFollowers() —
  // no duplicate broadcast-based movement needed here.

  // Broadcast party regen buff when caster sets it
  const prevPartyRegenBuffRef = useRef<typeof partyRegenBuff>(null);
  useEffect(() => {
    if (!party || !partyRegenBuff || partyRegenBuff === prevPartyRegenBuffRef.current) return;
    prevPartyRegenBuffRef.current = partyRegenBuff;
    broadcastPartyRegenBuff(
      partyRegenBuff.healPerTick, partyRegenBuff.expiresAt, partyRegenBuff.source || partyRegenBuff.abilityKey || 'party_regen', character.id,
      {
        abilityKey: partyRegenBuff.abilityKey,
        label: partyRegenBuff.label,
        durationMs: partyRegenBuff.durationMs,
        tickText: partyRegenBuff.tickText,
      },
    );
  }, [party, partyRegenBuff, broadcastPartyRegenBuff, character.id]);

  // Broadcast Inspire when this character casts it (only the caster's
  // setInspireBuff produces a buff with `casterId === character.id`; allies
  // receive the buff via the broadcast listener above and won't re-broadcast).
  const prevInspireBuffRef = useRef<typeof inspireBuff>(null);
  useEffect(() => {
    if (!party || !inspireBuff || inspireBuff === prevInspireBuffRef.current) return;
    prevInspireBuffRef.current = inspireBuff;
    if (inspireBuff.casterId !== character.id) return;
    broadcastInspireBuff(
      inspireBuff.hpPerTick,
      inspireBuff.cpPerTick,
      inspireBuff.expiresAt,
      inspireBuff.durationMs,
      character.id,
    );
  }, [party, inspireBuff, broadcastInspireBuff, character.id]);

  // effectiveAC — recalculate from class + effective DEX (base + gear) to match server logic
  const effectiveAC = getEffectiveAC(character.class, character.dex, equipmentBonuses, false);

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

  // Ref to break circular dependency: useCombatDriver needs ability executor, useCombatActions needs queueAbility
  const executeAbilityRef = useRef<(index: number, targetId?: string) => Promise<void>>();
  // Ref to break circular dependency: useCombatDriver needs the wimp pre-flee
  // hook, but useWimp is initialised AFTER useCombatDriver (it needs handleMove).
  const wimpFleeRef = useRef<((newHp: number) => boolean) | null>(null);
  // Same forward-declaration pattern for the "player moved manually" notifier —
  // useMovementActions is created before useWimp exists.
  const wimpNotifyRef = useRef<(() => void) | null>(null);

  // Telegraph feed. Created before the driver so committed cast transitions can
  // be handed straight to it as each batch is applied.
  const bossCastFeed = useBossCasts(character.current_node_id);
  const bossCasts = bossCastFeed.casts;

  const combat = useCombatDriver({
    enabled: !combat2BlocksLegacy,
    character, creatures,
    party: usePartyCombatMode ? party : null,
    isLeader, isDead,
    addLocalLogEvent, updateCharacter, updateCharacterLocal, fetchGroundLoot,
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
    onBossCasts: bossCastFeed.applyCommitted,
    onBossDeathCry: ({ text }) => {
      // World emote — atmospheric narration, broadcast verbatim with no boss-name framing.
      sendGlobal({
        kind: 'boss_death',
        text,
      });
    },
    onCreaturesKilled: (ids) => {
      // Optimistic local hide via soft-dead (8s TTL) AND hard-remove from the
      // creatures list. The realtime UPDATE (is_alive=false) is the canonical
      // source, but if it's delayed beyond the soft-dead TTL the creature
      // would otherwise linger until the next node entry.
      for (const id of ids) {
        markSoftDead(id);
        removeCreatureLocal(id);
      }
    },
    setPoisonBuff: buffSetters.setPoisonBuff,
    setIgniteBuff: buffSetters.setIgniteBuff,
    clearReservedBuffsLocal: () => clearCharacterFields?.({ reserved_buffs: {} as any }),
    onIncomingPlayerHp: (newHp) => wimpFleeRef.current?.(newHp) ?? false,
  });

  const { inCombat, activeCombatCreatureId, engagedCreatureIds, creatureHpOverrides,
    lastTickTime, startCombat, stopCombat: stopCombatFn,
    fleeStopCombat, queueAbility, pendingCpCost, pendingAbility,
    pendingAbilityIndex, pendingAbilityStage } = combat;

  // Merge creature HP from all sources: combat-tick > broadcast > base
  const mergedCreatureHpOverrides = useMergedCreatureHpOverrides(creatureHpOverrides, broadcastOverrides);

  // Offscreen DoT wake-up was a player-triggered call into the internal
  // `combat-catchup` endpoint and has been removed. Offscreen progression is
  // internal authority; no client path may drive it.

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
    enabled: !combat2BlocksLegacy,
    character, updateCharacter, updateCharacterLocal, addLogEvent,
    equipped, equipmentBonuses,
    creatures, creatureHpOverrides,
    party, partyMembers,
    inCombat, activeCombatCreatureId, startCombat, stopCombat: stopCombatFn,
    queueAbility,
    pendingCpCost,
    isDead,
    fetchInventory,
    buffState, buffSetters,
  });

  const authorizeCombat2Depart = useCallback(async (destinationNodeId: string, destinationName: string) => {
    const result = await combat2.departure.move(destinationNodeId);
    if (result.status === 'queued') {
      addLocalLogEvent(buildSystemEvent(`You attempt to flee toward ${destinationName}.`));
    } else if (result.status === 'moved') {
      addLocalLogEvent(buildMovementEvent(`You travel to ${destinationName}.`));
    } else if (result.status !== 'stale') {
      const detail = 'reason' in result && result.reason ? `: ${result.reason}` : '';
      addLocalLogEvent(buildErrorEvent(`Combat2 movement refused${detail}`));
    }
  }, [combat2.departure, addLocalLogEvent]);

  const movementActions = useMovementActions({
    movementBlocked: combat2BlocksLegacy,
    character, updateCharacter, addLogEvent,
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
    onPlayerCombatMove: () => wimpNotifyRef.current?.(),
    authorizeCombat2Depart: combat2BlocksLegacy ? authorizeCombat2Depart : undefined,
  });

  const consumableActions = useConsumableActions({
    character, updateCharacter, addLogEvent,
    equipmentBonuses,
    useConsumable,
    buffSetters,
  });

  // Wire forward-declared refs
  useEffect(() => { degradeEquipmentRef.current = combatActions.degradeEquipment; }, [combatActions.degradeEquipment]);

  // Wire ability executor ref (updated synchronously to avoid stale closures)
  executeAbilityRef.current = (index: number, targetId?: string) => combatActions.handleUseAbility(index, targetId, true);

  const { handleMove, handleTeleport, handleReturnToWaymark, handleSearch, waymarkNodeId, teleportOpen, setTeleportOpen } = movementActions;
  const handleUseConsumable = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, consumableActions.handleUseConsumable);
  const { handleUseAbility, handleAttack } = combatActions;

  const handlePlayerUseAbility = useCallback(async (abilityIndex: number, targetId?: string) => {
    if (combat2BlocksLegacy && actionEpochRef.current !== actionEpoch) return;
    const ability = (CLASS_ABILITIES[character.class] || [])[abilityIndex];
    await routeCombat2Action({
      enabled: combat2BlocksLegacy,
      sessionReady: combat2.actionsReady && !ownership.locked,
      ability: ability ?? null,
      resolveTarget: combat2Targets.resolve,
      reservedBuffs: combat2BlocksLegacy
        ? Object.fromEntries((activeCombat2Presentation?.characterEffects ?? []).filter(e => e.isReservation).map(e => [e.abilityKey ?? e.kind, {}]))
        : (character as { reserved_buffs?: Record<string, unknown> | null }).reserved_buffs ?? {},
      legacy: () => handleUseAbility(abilityIndex, targetId),
      submit: combat2.intents.submit,
      diagnose: (message) => {
        if (message === null) { setCombat2Diagnostic(null); return; }
        if (combat2BlocksLegacy) setCombat2Diagnostic(message);
        else addLocalLogEvent(buildErrorEvent(message));
      },
    });
  }, [handleUseAbility, combat2, addLocalLogEvent, character, rosterActionable, creatures, combat2BlocksLegacy, combat2Targets, activeCombat2Presentation, ownership.locked, actionEpoch]);

  // ── Wimp: auto-flee when HP drops below the player's configured threshold ──
  const wimp = useWimp({ character, inCombat, currentNode, onMove: handleMove, addLogEvent });
  useEffect(() => { wimpFleeRef.current = wimp.tryFleeForIncomingHp; }, [wimp.tryFleeForIncomingHp]);
  useEffect(() => { wimpNotifyRef.current = wimp.notifyPlayerMoved; }, [wimp.notifyPlayerMoved]);

  // ── Stat allocation (extracted hook) ───────────────────────────
  const { handleFullRespec: legacyFullRespec, handleBatchAllocateStats: legacyAllocateStats } = useStatAllocation({
    character, updateCharacter, addLogEvent,
    onResourcesSynced: refetchCharacters,
  });
  const handleFullRespec = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyFullRespec);
  const handleBatchAllocateStats = useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyAllocateStats);

  // ── Keyboard + chat ────────────────────────────────────────────
  const handleAbilityKey = useCallback((index: number) => {
    void handlePlayerUseAbility(index, abilityTargetId ?? selectedTargetId ?? undefined);
  }, [handlePlayerUseAbility, abilityTargetId, selectedTargetId]);

  // Belt-potion hotkeys removed with the belt slot.

  const handlePickUpFirst = useCallback(async () => {
    if (isDead) return;
    if (groundLoot.length === 0) return;
    const first = groundLoot[0];
    const result = await pickUpItem(first.id);
    if (result === false) addLogEvent(buildSystemEvent('That unique item is already claimed by another...'));
    else {
      addLogEvent(buildLootEvent(`You pick up ${first.item?.name ?? 'an item'}.`, {
        player: { kind: 'player', id: character.id, name: character.name },
        remoteMessage: `${character.name} picks up ${first.item?.name ?? 'an item'}.`,
      }));
      fetchInventory();
    }
  }, [isDead, groundLoot, pickUpItem, addLogEvent, fetchInventory, character.id, character.name]);


  /** Stage 9 — the player deliberately picking a target is a structured aggro event. */
  const emitEngage = useCallback((creature: { id: string; name: string }) => {
    addLogEvent(buildEngageEvent(
      { id: creature.id, name: creature.name },
      { kind: 'player', id: character.id, name: character.name },
    ));
  }, [addLogEvent, character.id, character.name]);

  const handleAttackFirst = useCallback(() => {
    if (!legacyExecution.allowed()) {
      void routeCombat2BasicAttack({ enabled: true, sessionReady: combat2.actionsReady && !ownership.locked,
        resolveTarget: combat2Targets.resolveManualAttack, legacy: () => {}, submit: combat2.intents.submit,
        diagnose: setCombat2Diagnostic });
      return;
    }
    if (isDead) return;
    if (selectedTargetId) {
      const target = creatures.find(c => c.id === selectedTargetId && c.is_alive);
      if (target) {
        if (!target.is_aggressive) emitEngage(target);
        startCombat(target.id);
        return;
      }
    }
    if (inCombat) return;
    const firstCreature = creatures.find(c => c.is_alive);
    if (firstCreature) {
      if (!firstCreature.is_aggressive) emitEngage(firstCreature);
      startCombat(firstCreature.id);
    }
  }, [isDead, inCombat, creatures, selectedTargetId, startCombat, emitEngage, combat2, ownership.locked, combat2Targets]);

  const handleSelectedBasicAttack = useCallback((id: string) => {
    if (!combat2BlocksLegacy) { setSelectedTargetId(id); handleAttack(id); return; }
    combat2Targets.select(id);
    void routeCombat2BasicAttack({ enabled: true, sessionReady: combat2.actionsReady && !ownership.locked,
      resolveTarget: () => combat2Targets.resolveManualAttackId(id), legacy: () => {}, submit: combat2.intents.submit,
      diagnose: setCombat2Diagnostic });
  }, [combat2BlocksLegacy, combat2Targets, combat2, ownership.locked, handleAttack, setSelectedTargetId]);

  const handleCycleTarget = useCallback(() => {
    if (combat2BlocksLegacy) { if (combat2.actionsReady) combat2Targets.cycle(); return; }
    if (isDead) return;
    const aliveCreatures = creatures.filter(c => c.is_alive);
    if (aliveCreatures.length === 0) return;
    const currentIdx = aliveCreatures.findIndex(c => c.id === (selectedTargetId ?? activeCombatCreatureId));
    const nextIdx = (currentIdx + 1) % aliveCreatures.length;
    const next = aliveCreatures[nextIdx];
    setSelectedTargetId(next.id);
    const engagedSet = new Set(engagedCreatureIds);
    if (next.is_aggressive || engagedSet.has(next.id)) {
      if (!next.is_aggressive) emitEngage(next);
      startCombat(next.id);
    }
  }, [isDead, creatures, selectedTargetId, activeCombatCreatureId, engagedCreatureIds, inCombat, startCombat, emitEngage, combat2BlocksLegacy, combat2.actionsReady, combat2Targets]);

  // Clear selected target when changing nodes
  useEffect(() => {
    setSelectedTargetId(null);
  }, [character.current_node_id]);

  const handleChatMessage = useCallback((event: GameLogEvent) => {
    setEventLog(prev => [...prev.slice(-99), event]);
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
    if (!text) return;
    setChatInput('');

    // Hidden cheat code: activates a 2x XP boost for 1 hour
    if (text.toLowerCase() === 'iddqd') {
      const { data, error } = await supabase.rpc('activate_cheat_xp_boost' as any);
      const res = data as any;
      if (error) {
        addLocalLogEvent(buildErrorEvent('The ancient words fizzle out.'));
      } else if (res?.ok) {
        addLocalLogEvent(buildBuffEvent('IDDQD — A surge of insight floods you! 2x XP for 1 hour.', { effectType: 'xp_boost', severity: 'notable' }));
      } else if (res?.error === 'already_active') {
        addLocalLogEvent(buildSystemEvent('The surge of insight already courses through the realm.'));
      } else {
        addLocalLogEvent(buildErrorEvent('The ancient words fizzle out.'));
      }
      return;
    }


    // Whisper shortcut
    const whisperMatch = text.match(/^\/w(?:hisper)?\s+(\S+)\s+(.+)$/i);
    if (whisperMatch) {
      const err = await sendWhisper(whisperMatch[1], whisperMatch[2]);
      if (err) setEventLog(prev => [...prev.slice(-99), buildErrorEvent(err)]);
      return;
    }

    // MUD-style command parsing
    const fleeRefusal = combat2FleeCommandRefusal(combat2BlocksLegacy, text);
    if (fleeRefusal) {
      addLocalLogEvent(buildErrorEvent(fleeRefusal));
      return;
    }
    const cmd = parseCommand(text);
    if (cmd) {
      switch (cmd.type) {
        case 'move': {
          if (!currentNode) { addLocalLogEvent(buildErrorEvent("You can't go that way.")); break; }
          const conn = currentNode.connections?.find(
            (c: any) => c.direction?.toUpperCase() === cmd.direction && !c.hidden
          );
          if (conn) {
            handleMove(conn.node_id, cmd.direction as any);
          } else {
            addLocalLogEvent(buildErrorEvent("You can't go that way."));
          }
          break;
        }
        case 'attack': {
          const aliveCreatures = creatures.filter(c => c.is_alive);
          if (aliveCreatures.length === 0) {
            addLocalLogEvent(buildErrorEvent('Nothing to attack here.'));
          } else {
            if (cmd.target) addLocalLogEvent(buildSystemEvent('You attack the nearest creature.'));
            handleAttackFirst();
          }
          break;
        }
        case 'search': {
          handleSearch(cmd.target);
          break;
        }
        case 'loot': {
          if (groundLoot.length === 0) {
            addLocalLogEvent(buildErrorEvent('No loot to pick up.'));
          } else {
            if (cmd.target) addLocalLogEvent(buildLootEvent('Picking up the nearest item.'));
            handlePickUpFirst();
          }
          break;
        }
        case 'look': {
          if (currentNode) {
            const area = currentNode.area_id ? getNodeArea(currentNode) : undefined;
            const name = getNodeDisplayName(currentNode, area);
            const desc = getNodeDisplayDescription(currentNode, area);
            addLocalLogEvent(buildSystemEvent(name, { effectType: 'look' }));
            if (desc) addLocalLogEvent(buildSystemEvent(desc, { effectType: 'look' }));
            // List exits
            const exits = currentNode.connections
              ?.filter((c: any) => !c.hidden)
              .map((c: any) => c.direction)
              .join(', ');
            if (exits) addLocalLogEvent(buildSystemEvent(`Exits: ${exits}`, { effectType: 'look' }));
          }
          break;
        }
        case 'summon': {
          addLocalLogEvent(buildSystemEvent(`Summon target set to ${cmd.name}. Use the Summon panel to confirm.`, { effectType: 'summon' }));
          break;
        }
      }
      return;
    }

    // Fallthrough to chat
    const sayText = text.replace(/^\/say\s+/i, '');
    sendSay(sayText);
  }, [chatInput, sendSay, sendWhisper, currentNode, creatures, groundLoot, handleMove, handleAttackFirst, handleSearch, handlePickUpFirst, addLocalLogEvent, getNodeArea, combat2BlocksLegacy]);

  const handleOpenChat = useCallback(() => {
    chatInputRef.current?.focus();
  }, []);

  const keyboardMovement = useKeyboardMovement({
    currentNode, nodes,
    onMove: handleMove, disabled: isDead,
    onAttackFirst: handleAttackFirst, onSearch: handleSearch,
    onUseAbility: handleAbilityKey,
    onPickUpLoot: handlePickUpFirst, onOpenChat: handleOpenChat,
    onCycleTarget: handleCycleTarget,
  });

  // Separate chat messages from event log for wide-screen chat panel.
  // Routing uses the structured event type — no text or emoji inspection.
  const chatMessages = useMemo(() =>
    eventLog.filter(e => e.type === 'speech' || e.type === 'whisper'),
    [eventLog]
  );
  const filteredEventLog = useMemo(() => {
    if (!(isWideScreen && chatPanelOpen)) return eventLog;
    return eventLog.filter(e => e.type !== 'speech' && e.type !== 'whisper');
  }, [eventLog, isWideScreen, chatPanelOpen]);
  const presentedEventLog = useMemo(() => {
    return selectCombat2Events(combat2BlocksLegacy, combat2.presentation.model, filteredEventLog);
  }, [filteredEventLog, combat2.presentation.model]);

  // On-device archive: full personal log history with infinite scrollback.
  const logArchive = useLogArchive(character.id, eventLog);
  const filteredOlderEvents = useMemo(() => {
    if (!(isWideScreen && chatPanelOpen)) return logArchive.olderEvents;
    return logArchive.olderEvents.filter(e => e.type !== 'speech' && e.type !== 'whisper');
  }, [logArchive.olderEvents, isWideScreen, chatPanelOpen]);


  // ── Shared drop handler ────────────────────────────────────────
  const handleDropItem = useCallback(async (inventoryId: string) => {
    const inv = [...equipped, ...unequipped].find(i => i.id === inventoryId);
    if (inv && character.current_node_id) {
      await dropItemToGround(inventoryId, inv.item_id, character.current_node_id, inv.item.name);
      fetchInventory();
      addLogEvent(buildSystemEvent(`You dropped ${inv.item.name} on the ground.`, {
        player: { kind: 'player', id: character.id, name: character.name },
        remoteMessage: `${character.name} dropped ${inv.item.name} on the ground.`,
      }));
    }
  }, [equipped, unequipped, character.current_node_id, character.id, character.name, dropItemToGround, fetchInventory, addLogEvent]);

  // ── De-duplicated prop blocks ──────────────────────────────────
  // Phase 4: per-character ability choices. Applying a loadout rewrites the live
  // ability lists, so holding it here keeps the bar and the panel in sync.
  const abilityRegistry = useAbilityRegistry();
  const abilityLoadout = useAbilityLoadout(
    character?.id, character?.class, abilityRegistry.loaded,
  );

  const charPanelProps = useMemo(() => ({
    character,
    abilityLoadout,
    equipped,
    unequipped,
    equipmentBonuses,
    onEquip: equipItem,
    onUnequip: unequipItem,
    onDrop: handleDropItem,
    onDestroy: dropItem,
    onTogglePin: togglePin,
    onUseConsumable: handleUseConsumable,
    onOpenMap: (invId: string) => setOpenMapInvId(invId),
    isAtInn: currentNode?.is_inn ?? false,
    regenTick,
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
    inspireBuff,
    soulringGlow,
    // Stat allocation moved to TrainerPanel; CharacterPanel only displays balances now.
  }), [
    character, equipped, unequipped, equipmentBonuses, equipItem, unequipItem,
    handleDropItem, dropItem, togglePin, handleUseConsumable, currentNode?.is_inn,
    regenTick,
    inCombat, keyboardMovement.actionBindings, baseRegen, itemHpRegen,
    foodBuff, critBuff, battleCryBuff, poisonBuff, evasionBuff, igniteBuff, absorbBuff,
    damageBuff, partyRegenBuff, inspireBuff, soulringGlow, abilityLoadout,
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
  }), [stealthBuff, damageBuff, battleCryBuff, poisonBuff, evasionBuff, igniteBuff, absorbBuff, rootDebuff, sunderDebuff]);

  const showTargetSelector = useMemo(() =>
    (CLASS_ABILITIES[character.class] || []).some(a => a.type === 'hp_transfer' || a.targetType === 'ally'),
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
    onOpenJewelcrafter: (currentNode as any)?.is_jewelcrafter ? () => setJewelcrafterOpen(true) : undefined,
    onOpenStonebinder: (currentNode as any)?.is_stonebinder ? () => setStonebinderOpen(true) : undefined,
    onOpenTrainer: currentNode?.is_trainer ? () => setTrainerOpen(true) : undefined,
    onOpenMarketplace: (currentNode as any)?.is_marketplace ? () => setMarketplaceOpen(true) : undefined,
    onOpenTeleport: (currentNode?.is_teleport || character.level >= 22) ? () => {
      if (inCombat) { addLogEvent(buildErrorEvent('You cannot teleport while in combat!')); return; }
      setTeleportOpen(true);
    } : undefined,
    searchDisabled: character.cp < 5 || creatures.length > 0,
    hasDiscoverable: !!(currentNode?.connections?.some((c: any) => c.hidden) || (currentNode?.searchable_items && currentNode.searchable_items.length > 0)),
    unlockedConnections,
    onMapTeleport: handleTeleport,
    onlinePlayers,
    addLogEvent,
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
    appVersion: APP_VERSION,
    xpMultiplier,
    xpBoostExpiresAt,
    isAdmin,
    onOpenAdmin,
    onSwitchCharacter,
    onSignOut,
    onOpenGuide: openGuide,
    guideNeedsAttention: guide.needsAttention,
  }), [
    regions, nodes, areas, character, currentNode, handleMove, mergedPartyMembers,
    party, pendingInvites, isLeader, isTank, myMembership, playersHere,
    createParty, invitePlayer, acceptInvite, declineInvite, leaveParty, kickMember,
    setTank, toggleFollow, keyboardMovement, activeBuffs, abilityTargetId,
    showTargetSelector, handleSearch, inCombat, addLogEvent, setTeleportOpen,
    creatures.length, unlockedConnections, onlinePlayers, isDead, updateCharacter, pendingSummons, acceptSummon, declineSummon, handleTeleport,
    getNode, getRegion, currentRegion, openGuide, guide.needsAttention,

    xpMultiplier, xpBoostExpiresAt, isAdmin, onOpenAdmin, onSwitchCharacter, onSignOut,
  ]);

  // ── Rendering ──────────────────────────────────────────────────
  if (nodesLoading) {
    return <LoadingScreen message="Loading world..." />;
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
    <div className="h-screen flex flex-col parchment-bg w-full relative">
      {combat2BlocksLegacy && <Combat2TestStatus status={combat2Status}
        stale={!combat2.actionsReady && !!activeCombat2Presentation}
        diagnostic={combat2.intents.pending?.message ?? combat2Diagnostic} />}
      <AbilityBarMeasurer onMeasure={setAbilityBarWidth} />

      {/* Main Content — centered game area; row width caps to fit widest ability bar */}
      <div className="flex-1 min-h-0 flex w-full mx-auto" style={{ maxWidth: rowMaxWidth }}>
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
        <div className="h-full flex-1 min-w-0 ornate-border bg-card/60 flex flex-col" style={{ maxWidth: centerMaxWidth }}>
          <div className="flex-[45] min-h-0">
            <NodeView
              node={currentNode}
              region={currentRegion}
              area={currentNode.area_id ? getNodeArea(currentNode) : undefined}
              allNodes={nodes}
              players={playersHere}
              creatures={presentedCreatures}
              npcs={npcs}
              character={presentedCharacter}
              eventLog={eventLog}
              onAttack={handleSelectedBasicAttack}
              onSelectTarget={(id) => setSelectedTargetId(id)}
              onTalkToNPC={handleTalkToNPC}
              inCombat={inCombat}
              lastTickTime={lastTickTime}
               activeCombatCreatureId={activeCombatCreatureId}
               selectedTargetId={selectedTargetId}
              authoritativeTargetSelection={combat2BlocksLegacy}
              pendingBasicAttackTargetId={combat2.intents.pending?.action.kind === 'basic_attack'
                ? combat2.intents.pending.action.targetCreatureId : null}
               engagedCreatureIds={combat2BlocksLegacy
                 ? activeCombat2Presentation?.creatures.filter(creature => creature.engaged).map(creature => creature.creatureId) ?? []
                 : engagedCreatureIds}
              creatureHpOverrides={presentedCreatureHp ?? mergedCreatureHpOverrides}
              authoritativeCreatureEffects={activeCombat2Presentation?.creatureEffects}
              classAbilities={CLASS_ABILITIES[character.class] || []}
              onUseAbility={(idx, target) => void handlePlayerUseAbility(idx, target ?? selectedTargetId ?? undefined)}
              combatActionsReady={!combat2BlocksLegacy || (combat2.actionsReady && !ownership.locked)}
              abilityTargetId={abilityTargetId}
              pendingAbilityIndex={pendingAbilityIndex ?? pendingAbility?.index ?? null}
              pendingAbilityStage={pendingAbilityStage ?? null}
              reservedBuffs={(character as any).reserved_buffs ?? null}
              actionBindings={keyboardMovement.actionBindings}
              poisonStacks={poisonStacks}
              igniteStacks={igniteStacks}
              sunderDebuff={sunderDebuff}
              rootDebuff={rootDebuff}
              bleedStacks={bleedStacks}
              bossCasts={bossCasts}
              authoritativeTelegraphs={activeCombat2Presentation?.telegraphsByCreatureLife}
              authoritativeEncounterTick={activeCombat2Presentation?.encounterTick}
              authoritativeTankByCreatureLife={activeCombat2Presentation ? Object.fromEntries(
                activeCombat2Presentation.creatures.map((creature) => [
                  `${creature.creatureId}:${creature.spawnSeq}`,
                  creature.isCurrentCharacterTank,
                ]),
              ) : undefined}
              groundLoot={groundLoot}
              onPickUpLoot={async (id) => {
                const picked = groundLoot.find(g => g.id === id);
                const itemName = picked?.item?.name ?? 'an item';
                const result = await pickUpItem(id);
                if (result === false) addLogEvent(buildSystemEvent('That unique item is already claimed by another...'));
                else {
                  addLogEvent(buildLootEvent(`You pick up ${itemName}.`, {
                    player: { kind: 'player', id: character.id, name: character.name },
                    remoteMessage: `${character.name} picks up ${itemName}.`,
                  }));
                  fetchInventory();
                }
              }}
              partyMemberIds={party ? new Set(mergedPartyMembers.filter(m => m.status === 'accepted' && m.character_id !== character.id).map(m => m.character_id)) : undefined}
              creaturesLoading={creaturesLoading}
              rosterActionable={rosterActionable}
              rosterStatus={rosterStatus}
              rosterError={rosterError}
              
              partyMemberHp={party ? new Map(mergedPartyMembers.filter(m => m.status === 'accepted').map(m => [m.character_id, { hp: m.character.hp, max_hp: m.character.max_hp }])) : undefined}
              statusBarsProps={{
                equipmentBonuses,
                inventoryCount: getBagWeight(unequipped),
                isAtInn: currentNode?.is_inn ?? false,
                regenTick, baseRegen, itemHpRegen, foodBuff, critBuff, battleCryBuff,
                poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, stealthBuff,
                inspireBuff,
                holyShieldBuff, consecrateBuff, divineChallengeBuff,
                reservedCp: pendingCpCost,
                stanceReservedCp: (() => {
                  const rb = (character as any).reserved_buffs as Record<string, { reserved: number }> | null;
                  if (!rb) return 0;
                  return Object.values(rb).reduce((s, e) => s + (Number(e?.reserved) || 0), 0);
                })(),
                reservedBuffs: (character as any).reserved_buffs ?? null,
                authoritativeEffects: activeCombat2Presentation?.characterEffects,
              }}
            />
          </div>
          <EventLogPanel
            filteredEventLog={presentedEventLog}
            display={eventLogDisplay}
            className="flex-[55]"
            olderEvents={filteredOlderEvents}
            hasMoreHistory={logArchive.hasMore}
            loadingHistory={logArchive.loadingOlder}
            onLoadOlder={logArchive.loadOlder}
          />
          <CommandInputBar
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onChatSubmit={handleChatSubmit}
            chatInputRef={chatInputRef}
            isMobile={isMobile}
            trailing={<EventLogControls display={eventLogDisplay} />}
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

      </div>

      {/* Chat lives in the right viewport gutter, outside the centered game area. */}
      {isWideScreen && !isTablet && chatPanelOpen && canFitChat && (
        <div
          className="absolute top-0 bottom-0 right-0 z-30"
          style={{ width: gutterWidth }}
        >
          <ChatPanel
            messages={chatMessages}
            onClose={() => { setChatPanelOpen(false); localStorage.setItem('chatPanelOpen', 'false'); }}
          />
        </div>
      )}

      {/* Overlay fallback when the gutter is too narrow for inline chat. */}
      {isWideScreen && !isTablet && chatPanelOpen && !canFitChat && (
        <div className="fixed right-0 top-0 bottom-0 w-[320px] z-40 shadow-2xl">
          <ChatPanel
            messages={chatMessages}
            onClose={() => { setChatPanelOpen(false); localStorage.setItem('chatPanelOpen', 'false'); }}
          />
        </div>
      )}

      {/* Collapsed chat icon — pinned to right edge of viewport. */}
      {isWideScreen && !isTablet && !chatPanelOpen && (
        <Button
          size="icon"
          className="fixed right-0 top-0 bottom-0 h-full w-8 z-30 rounded-none border-l border-border bg-card/60 hover:bg-accent/60"
          variant="ghost"
          onClick={() => { setChatPanelOpen(true); localStorage.setItem('chatPanelOpen', 'true'); }}
          title="Open chat panel"
        >
          <MessageCircle className="w-4 h-4" />
        </Button>
      )}

      {/* Online players live in the left viewport gutter, mirroring the chat panel. */}
      {isWideScreen && !isTablet && onlinePanelOpen && canFitChat && (
        <div
          className="absolute top-0 bottom-0 left-0 z-30"
          style={{ width: gutterWidth }}
        >
          <OnlinePanel
            onlinePlayers={onlinePlayers}
            myCharacterId={character.id}
            onClose={() => { setOnlinePanelOpen(false); localStorage.setItem('onlinePanelOpen', 'false'); }}
          />
        </div>
      )}

      {/* Overlay fallback when the gutter is too narrow for inline online panel. */}
      {isWideScreen && !isTablet && onlinePanelOpen && !canFitChat && (
        <div className="fixed left-0 top-0 bottom-0 w-[320px] z-40 shadow-2xl">
          <OnlinePanel
            onlinePlayers={onlinePlayers}
            myCharacterId={character.id}
            onClose={() => { setOnlinePanelOpen(false); localStorage.setItem('onlinePanelOpen', 'false'); }}
          />
        </div>
      )}

      {/* Collapsed online players icon — pinned to left edge of viewport. */}
      {isWideScreen && !isTablet && !onlinePanelOpen && (
        <Button
          size="icon"
          className="fixed left-0 top-0 bottom-0 h-full w-8 z-30 rounded-none border-r border-border bg-card/60 hover:bg-accent/60"
          variant="ghost"
          onClick={() => { setOnlinePanelOpen(true); localStorage.setItem('onlinePanelOpen', 'true'); }}
          title="Open online players panel"
        >
          <Users className="w-4 h-4" />
          {onlinePlayers.length > 0 && (
            <span className="absolute top-1 left-1 text-[9px] bg-primary text-primary-foreground rounded-full min-w-4 h-4 px-1 flex items-center justify-center font-display">
              {onlinePlayers.length}
            </span>
          )}
        </Button>
      )}

      {/* Vendor Dialog */}
      {currentNode.is_vendor && (
        <VendorPanel
          open={vendorOpen}
          onClose={() => { setVendorOpen(false); setActiveServiceNpc(null); }}
          nodeId={currentNode.id}
          characterId={character.id}
          gold={character.gold}
          cha={character.cha}
          equipmentBonuses={equipmentBonuses}
          inventory={[...equipped, ...unequipped]}
          onGoldChange={(g) => updateCharacter({ gold: g })}
          onInventoryChange={fetchInventory}
          addLogEvent={addLogEvent}
          npcName={activeServiceNpc?.service_role === 'vendor' ? activeServiceNpc.name : undefined}
          npcFlavor={activeServiceNpc?.service_role === 'vendor' ? (activeServiceNpc.dialogue || activeServiceNpc.description) : undefined}
        />
      )}

      {/* Blacksmith Dialog */}
      {currentNode.is_blacksmith && (
        <BlacksmithPanel
          open={blacksmithOpen}
          onClose={() => { setBlacksmithOpen(false); setActiveServiceNpc(null); }}
          characterId={character.id}
          gold={character.gold}
          level={character.level}
          inventory={[...equipped, ...unequipped]}
          onGoldChange={(g) => updateCharacter({ gold: g })}
          onInventoryChange={fetchInventory}
          onCharacterRefresh={refetchCharacters}
          addLogEvent={addLogEvent}
          isSoulforgeNode={(currentNode as any).is_soulforge === true}
          character={character}
          npcName={activeServiceNpc?.service_role === 'blacksmith' ? activeServiceNpc.name : undefined}
          npcFlavor={activeServiceNpc?.service_role === 'blacksmith' ? (activeServiceNpc.dialogue || activeServiceNpc.description) : undefined}
        />
      )}




      {/* Jewelcrafter Dialog */}
      {(currentNode as any).is_jewelcrafter && (
        <JewelcrafterPanel
          open={jewelcrafterOpen}
          onClose={() => { setJewelcrafterOpen(false); setActiveServiceNpc(null); }}
          characterId={character.id}
          gold={character.gold}
          level={character.level}
          inventory={[...equipped, ...unequipped]}
          onGoldChange={(g) => updateCharacter({ gold: g })}
          onInventoryChange={fetchInventory}
          onCharacterRefresh={refetchCharacters}
          addLogEvent={addLogEvent}
          character={character}
          npcName={activeServiceNpc?.service_role === 'jewelcrafter' ? activeServiceNpc.name : undefined}
          npcFlavor={activeServiceNpc?.service_role === 'jewelcrafter' ? (activeServiceNpc.dialogue || activeServiceNpc.description) : undefined}
        />
      )}

      {/* Stonebinder Dialog */}
      {(currentNode as any).is_stonebinder && (
        <StonebinderPanel
          open={stonebinderOpen}
          onClose={() => setStonebinderOpen(false)}
          characterId={character.id}
          inventory={[...equipped, ...unequipped]}
          onInventoryChange={fetchInventory}
          addLogEvent={addLogEvent}
        />
      )}

      {/* Heraldry Dialog */}
      {(currentNode as any).is_heraldry && (
        <HeraldryPanel
          open={heraldryOpen}
          onClose={() => { setHeraldryOpen(false); setActiveServiceNpc(null); }}
          characterId={character.id}
          currentFamilyName={(character as any).family_name ?? null}
          familyChangedAfterCreation={!!(character as any).family_changed_after_creation}
          userId={character.user_id}
          npcName={activeServiceNpc?.service_role === 'heraldry' ? activeServiceNpc.name : undefined}
          npcFlavor={activeServiceNpc?.service_role === 'heraldry' ? (activeServiceNpc.dialogue || activeServiceNpc.description) : undefined}
          onFamilyChanged={() => refetchCharacters?.()}
        />
      )}



      {/* Marketplace Dialog */}
      {(currentNode as any).is_marketplace && (
        <MarketplacePanel
          open={marketplaceOpen}
          onClose={() => setMarketplaceOpen(false)}
          characterId={character.id}
          characterName={character.name}
          characterGold={character.gold}
          inventory={[...equipped, ...unequipped]}
          onTransacted={() => { fetchInventory(); }}
          addLogEvent={addLogEvent}
          atMarketplace={true}
        />
      )}

      {/* Trainer Service Panel — allocate, respec, Renown training, leaderboard */}
      {currentNode.is_trainer && (
        <TrainerPanel
          open={trainerOpen}
          onClose={() => { setTrainerOpen(false); setActiveServiceNpc(null); }}
          character={character}
          equipmentBonuses={equipmentBonuses}
          updateCharacterLocal={updateCharacterLocal}
          addLogEvent={addLogEvent}
          onBatchAllocateStats={handleBatchAllocateStats}
          onFullRespec={handleFullRespec}
          npcName={activeServiceNpc?.service_role === 'trainer' ? activeServiceNpc.name : undefined}
          npcFlavor={activeServiceNpc?.service_role === 'trainer' ? (activeServiceNpc.dialogue || activeServiceNpc.description) : undefined}
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
        <NPCDialogPanel
          npc={talkingToNPC}
          open={!!talkingToNPC}
          onClose={() => setTalkingToNPC(null)}
          worldContext={{
            fromNode: currentNode,
            nodes,
            regions,
            areas,
            characterLevel: character.level,
            character: {
              id: character.id,
              class: character.class as string,
              contracts_completed: (character as any).contracts_completed ?? 0,
              active_contract: (character as any).active_contract ?? null,
            },
          }}
          onContractChanged={() => { refetchCharacters?.(); }}
        />

      )}

      <MapItemDialog
        open={!!openMapInvId}
        inv={unequipped.find(i => i.id === openMapInvId) ?? null}
        onClose={() => setOpenMapInvId(null)}
        nodes={nodes}
        areas={areas}
        regions={regions}
        currentNodeId={character.current_node_id}
      />


      <OrderRecruiterDialog
        open={recruiterOpen}
        onClose={() => { setRecruiterOpen(false); setActiveServiceNpc(null); }}
        npc={activeServiceNpc?.service_role === 'recruiter' ? activeServiceNpc : null}
        hallClass={(currentNode as any)?.class_hall ?? null}
        characterId={character.id}
        currentClass={character.class}
        onJoined={() => { refetchCharacters?.(); }}
        worldContext={{ fromNode: currentNode, nodes, regions, areas, characterLevel: character.level }}
      />

      {/* Death Overlay */}
      {isDead && !combat2BlocksLegacy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md animate-polish-fade-in">
          <div className="text-center space-y-4">
            <p className="font-display text-5xl text-destructive animate-pulse"> </p>
            <p className="font-display text-2xl text-destructive">You Have Fallen</p>
            <p className="font-display text-6xl text-destructive/80 tabular-nums">{deathCountdown}</p>
            <p className="text-sm text-muted-foreground">Respawning at the starting area...</p>
            <p className="text-xs text-muted-foreground">You lost {Math.floor(deathGoldRef.current * 0.1)} gold.</p>
          </div>
        </div>
      )}

      {/* Broadcast Debug Overlay — admin only */}
      {isAdmin && <BroadcastDebugOverlay />}

      {/* Combat timing breakdown — development instrumentation only */}
      {isAdmin && <CombatTimingPanel />}

      {/* Movement Pad — tablet only */}
      {isTablet && <MovementPad currentNode={currentNode} onMove={handleMove} disabled={isDead} unlockedConnections={unlockedConnections} />}

      {/* First-time hint pointing at the keyboard shortcuts button */}
      {!isMobile && !isTablet && character && (
        <OnboardingCoachmark
          targetId="keyboard-shortcuts"
          title="Keyboard Shortcuts"
          body="Open this panel to see and customize movement (QWE/ASD/ZXC), attack, abilities, and more."
        />
      )}

      {/* The Wayfarer's Guide — reader overlay */}
      <GuideReader
        open={guideOpen}
        onOpenChange={setGuideOpen}
        characterId={character?.id}
        isMobile={isMobile}
      />

      {/* First-time hint pointing at the Guide button — dismissed per character */}
      {character && guide.needsAttention && !guideOpen && (
        <OnboardingCoachmark
          targetId="guide-button"
          scopeId={character.id}
          title="The Wayfarer's Guide"
          body="New here? Open the Guide and read Your First Steps. It explains where to go and what to do first."
          delayMs={2000}
        />
      )}
    </div>

  );
}
