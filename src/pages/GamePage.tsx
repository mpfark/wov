import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
import { getBagWeight, getStatModifier, getMaxCp, getMaxMp, calculateStats, CLASS_LEVEL_BONUSES, calculateHP } from '@/lib/game-data';
import { CLASS_ABILITIES, UNIVERSAL_ABILITIES } from '@/lib/class-abilities';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { logActivity } from '@/hooks/useActivityLog';
import { useKeyboardMovement } from '@/hooks/useKeyboardMovement';
import { useChat } from '@/hooks/useChat';
import { useXpBoost } from '@/hooks/useXpBoost';
import { APP_VERSION } from '@/lib/version';
import { Input } from '@/components/ui/input';
import ReportIssueDialog from '@/components/game/ReportIssueDialog';
import { useCreateGameEventBus, useGameEvent } from '@/hooks/useGameEvents';
import { useGameLoop } from '@/hooks/useGameLoop';
import { useActions } from '@/hooks/useActions';

function getLogColor(log: string): string {
  if (log.startsWith('💬')) return 'text-foreground';
  if (log.startsWith('🤫 To ')) return 'text-purple-400/70';
  if (log.startsWith('🤫')) return 'text-purple-400';
  if (log.includes('(remote)') && (log.startsWith('🩸') || log.startsWith('🧪') || log.startsWith('🔥'))) return 'text-muted-foreground/60 italic text-[10px]';
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
  const bus = useCreateGameEventBus();
  const { regions, nodes, areas, loading: nodesLoading, getNode, getRegion, getNodeArea } = useNodes(true);
  const { playersHere } = usePresence(character.current_node_id, character);
  const { onlinePlayers } = useGlobalPresence(character);
  const { creatures } = useCreatures(character.current_node_id);
  const { broadcastOverrides, broadcastDamage, cleanupOverrides } = useCreatureBroadcast(character.current_node_id, character.id);

  useEffect(() => {
    cleanupOverrides(creatures.map(c => c.id));
  }, [creatures, cleanupOverrides]);
  const { npcs } = useNPCs(character.current_node_id);
  const { xpMultiplier, xpBoostExpiresAt } = useXpBoost();
  const [talkingToNPC, setTalkingToNPC] = useState<NPC | null>(null);
  const { equipped, unequipped, equipmentBonuses, fetchInventory, equipItem, unequipItem, dropItem, useConsumable, inventory, beltedPotions, beltCapacity, beltPotion, unbeltPotion } = useInventory(character.id);
  const {
    party, members: partyMembers, pendingInvites, isLeader, isTank, myMembership,
    createParty, invitePlayer, acceptInvite, declineInvite,
    leaveParty, kickMember, setTank, toggleFollow, fetchParty,
  } = useParty(character.id);
  const { entries: partyCombatEntries, addPartyCombatLog } = usePartyCombatLog(party?.id ?? null);
  const {
    hpOverrides: partyHpOverrides, moveEvents: partyMoveEvents,
    broadcastLogEntries, rewardEvents: partyRewardEvents,
    broadcastHp, broadcastMove, broadcastCombatMsg, broadcastReward,
  } = usePartyBroadcast(party?.id ?? null, character.id);

  // Broadcast own HP whenever it changes
  const lastBroadcastedHpRef = useRef<{ hp: number; max_hp: number } | null>(null);
  useEffect(() => {
    if (!party || !character) return;
    const last = lastBroadcastedHpRef.current;
    if (last && last.hp === character.hp && last.max_hp === character.max_hp) return;
    lastBroadcastedHpRef.current = { hp: character.hp, max_hp: character.max_hp };
    broadcastHp(character.id, character.hp, character.max_hp, 'sync');
  }, [party, character?.hp, character?.max_hp, broadcastHp]);

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
  const [abilityTargetId, setAbilityTargetId] = useState<string | null>(null);
  const { groundLoot, pickUpItem, dropItemToGround, fetchGroundLoot } = useGroundLoot(character.current_node_id, character.id);

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
      processIncomingLog(entry.message, entry.character_name, entry.node_id);
    }
  }, [partyCombatEntries, party, processIncomingLog]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [eventLog]);

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

  // Combat state ref bridge (useGameLoop reads this for DoT ticks)
  const combatStateRef = useRef<{ creatureHpOverrides: Record<string, number>; updateCreatureHp: (id: string, hp: number) => void }>({
    creatureHpOverrides: {},
    updateCreatureHp: () => {},
  });

  // ── useGameLoop: regen, death, DoTs, buff state ────────────────
  const gameLoop = useGameLoop({
    character, updateCharacter, equipped, equipmentBonuses, getNode, addLog,
    startingNodeId, creatures, combatStateRef, broadcastDamage,
    party, partyMembers, awardKillRewardsRef,
  });

  // Wire setRegenBuff for incoming log processing
  useEffect(() => { setRegenBuffFromIncomingRef.current = gameLoop.setRegenBuff; }, [gameLoop.setRegenBuff]);

  const {
    regenBuff, foodBuff, isDead, critBuff, stealthBuff, damageBuff, rootDebuff, acBuff,
    poisonBuff, poisonStacks, evasionBuff, disengageNextHit, igniteBuff, igniteStacks,
    absorbBuff, partyRegenBuff, sunderDebuff, focusStrikeBuff,
    regenTick, deathCountdown, itemHpRegen, baseRegen,
    handleAddPoisonStack, handleAddIgniteStack, handleAbsorbDamage,
    inCombatRegenRef, deathGoldRef,
  } = gameLoop;

  // effectiveAC
  const acBuffBonus = acBuff && Date.now() < acBuff.expiresAt ? acBuff.bonus : 0;
  const effectiveAC = character.ac + (equipmentBonuses.ac || 0) + acBuffBonus;

  // ── useCombat ──────────────────────────────────────────────────
  const { inCombat, activeCombatCreatureId, engagedCreatureIds, creatureHpOverrides, updateCreatureHp, startCombat, stopCombat: stopCombatFn } = useCombat({
    character, creatures, updateCharacter, equipmentBonuses, effectiveAC, addLog,
    rollLoot: useCallback(async (lootTable: any[], creatureName: string, lootTableId?: string | null, dropChance?: number, creatureNodeId?: string | null) => {
      await rollLootRef.current(lootTable, creatureName, lootTableId, dropChance, creatureNodeId);
    }, []),
    degradeEquipment: useCallback(async () => { await degradeEquipmentRef.current(); }, []),
    party, partyMembers, isDead, critBuff,
    stealthBuff, onClearStealthBuff: useCallback(() => gameLoop.setStealthBuff(null), []),
    damageBuff, rootDebuff, acBuff,
    poisonBuff, onAddPoisonStack: handleAddPoisonStack,
    evasionBuff, igniteBuff, onAddIgniteStack: handleAddIgniteStack,
    absorbBuff, onAbsorbDamage: handleAbsorbDamage,
    sunderDebuff, disengageNextHit,
    onClearDisengage: useCallback(() => gameLoop.setDisengageNextHit(null), []),
    focusStrikeBuff, onClearFocusStrike: useCallback(() => gameLoop.setFocusStrikeBuff(null), []),
    broadcastDamage, broadcastHp, broadcastReward, xpMultiplier,
  });

  // Sync combat state ref for DoT ticks in useGameLoop
  combatStateRef.current = { creatureHpOverrides, updateCreatureHp };
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
    character, updateCharacter, addLog,
    equipped, unequipped, equipmentBonuses,
    getNode, getRegion, getNodeArea, currentNode,
    creatures, creatureHpOverrides, updateCreatureHp,
    party, partyMembers, isLeader, myMembership,
    inCombat, activeCombatCreatureId, startCombat, stopCombat: stopCombatFn,
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
    dotDebuff: gameLoop.dotDebuff, setDotDebuff: gameLoop.setDotDebuff,
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
  });

  // Wire forward-declared refs
  useEffect(() => { rollLootRef.current = actions.rollLoot; }, [actions.rollLoot]);
  useEffect(() => { degradeEquipmentRef.current = actions.degradeEquipment; }, [actions.degradeEquipment]);
  useEffect(() => { awardKillRewardsRef.current = actions.awardKillRewards; }, [actions.awardKillRewards]);

  const { handleMove, handleTeleport, handleReturnToWaymark, handleSearch,
    handleUseConsumable, handleUseAbility, handleAttack,
    waymarkNodeId, teleportOpen, setTeleportOpen } = actions;

  // ── Aggro processing ───────────────────────────────────────────
  const prevNodeRef = useRef<string | null>(null);
  const aggroProcessedRef = useRef<Set<string>>(new Set());
  const pendingAggroRef = useRef(false);

  useEffect(() => {
    if (!character.current_node_id || character.hp <= 0) return;
    if (prevNodeRef.current === character.current_node_id) return;
    prevNodeRef.current = character.current_node_id;
    aggroProcessedRef.current = new Set();
    pendingAggroRef.current = true;
  }, [character.current_node_id, character.hp]);

  useEffect(() => {
    if (!pendingAggroRef.current || !creatures.length || character.hp <= 0) return;
    pendingAggroRef.current = false;
    const aggressiveCreatures = creatures.filter(
      c => c.is_aggressive && c.is_alive && c.hp > 0 && !aggroProcessedRef.current.has(c.id)
    );
    if (aggressiveCreatures.length === 0) return;
    for (const c of aggressiveCreatures) aggroProcessedRef.current.add(c.id);
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

  // ── Keyboard + chat ────────────────────────────────────────────
  const handleAbilityKey = useCallback((index: number) => {
    handleUseAbility(index, abilityTargetId ?? undefined);
  }, [handleUseAbility, abilityTargetId]);

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
    if (inCombat) return;
    const firstCreature = creatures.find(c => c.is_alive);
    if (firstCreature) startCombat(firstCreature.id);
  }, [isDead, inCombat, creatures, startCombat]);

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
    const whisperMatch = text.match(/^\/w(?:hisper)?\s+(\S+)\s+(.+)$/i);
    if (whisperMatch) {
      const err = sendWhisper(whisperMatch[1], whisperMatch[2]);
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
  });

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
          <ReportIssueDialog userId={character.user_id} characterId={character.id} characterName={character.name} />
          <Button variant="ghost" size="sm" onClick={onSignOut} className="text-xs text-muted-foreground">
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex">
        {/* Left: Character Panel */}
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
              // Recalculate derived stats affected by the allocation
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
              // Calculate non-manual base for each stat
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
              // Recalculate derived stats from new base values
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
          />
        </div>

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

        {/* Right: Map + Party */}
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
