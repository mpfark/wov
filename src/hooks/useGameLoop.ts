/**
 * useGameLoop — owns buff/debuff state, regen intervals, death detection,
 * and DoT tick effects. Mirrors LPMud's heart_beat() pattern.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Character } from '@/hooks/useCharacter';
import { getBaseRegen, CLASS_PRIMARY_STAT, getCpRegenRate, getMaxCp, getMaxMp, getMpRegenRate, getStatModifier } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/hooks/useActivityLog';

// ─── Buff / debuff types ──────────────────────────────────────────
export interface RegenBuff { multiplier: number; expiresAt: number }
export interface FoodBuff { flatRegen: number; expiresAt: number }
export interface CritBuff { bonus: number; expiresAt: number }
export interface StealthBuff { expiresAt: number }
export interface DamageBuff { expiresAt: number }
export interface RootDebuff { damageReduction: number; expiresAt: number }
export interface AcBuff { bonus: number; expiresAt: number }
export interface DotDebuff {
  damagePerTick: number; intervalMs: number; expiresAt: number;
  creatureId: string; creatureName: string; creatureLevel: number; creatureRarity: string;
  creatureLootTable: any[]; lootTableId: string | null; dropChance: number;
  creatureNodeId: string | null;
  maxHp: number; lastKnownHp: number;
}
export interface PoisonBuff { expiresAt: number }
export interface PoisonStack {
  stacks: number; damagePerTick: number; expiresAt: number;
  creatureName: string; creatureLevel: number; creatureRarity: string;
  creatureLootTable: any[]; lootTableId: string | null; dropChance: number;
  creatureNodeId: string | null;
  maxHp: number; lastKnownHp: number;
}
export interface EvasionBuff { dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' }
export interface DisengageNextHit { bonusMult: number; expiresAt: number }
export interface IgniteBuff { expiresAt: number }
export interface IgniteStack {
  stacks: number; damagePerTick: number; expiresAt: number;
  creatureName: string; creatureLevel: number; creatureRarity: string;
  creatureLootTable: any[]; lootTableId: string | null; dropChance: number;
  creatureNodeId: string | null;
  maxHp: number; lastKnownHp: number;
}
export interface AbsorbBuff { shieldHp: number; expiresAt: number }
export interface PartyRegenBuff { healPerTick: number; expiresAt: number }
export interface SunderDebuff { acReduction: number; expiresAt: number; creatureId: string; creatureName: string }
export interface FocusStrikeBuff { bonusDmg: number }

// ─── Local type aliases (avoid coupling to hook internals) ────────
interface EquippedItem {
  item: { stats: any; name: string; rarity: string; item_type: string; [k: string]: any };
  [k: string]: any;
}

// ─── Params ───────────────────────────────────────────────────────
export interface UseGameLoopParams {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  equipped: EquippedItem[];
  equipmentBonuses: Record<string, number>;
  getNode: (id: string) => any;
  addLog: (msg: string) => void;
  startingNodeId?: string;
  creatures: { id: string; name: string; level: number; rarity: string; hp: number; max_hp: number; loot_table: any; loot_table_id: string | null; drop_chance: number; [k: string]: any }[];
  combatStateRef: React.MutableRefObject<{
    creatureHpOverrides: Record<string, number>;
    updateCreatureHp: (id: string, hp: number) => void;
  }>;
  broadcastDamage: (creatureId: string, newHp: number, damage: number, attackerName: string, killed: boolean) => void;
  party: any;
  partyMembers: any[];
  /** When true, DoT ticking is handled server-side by combat-tick */
  inParty?: boolean;
  awardKillRewardsRef: React.MutableRefObject<(creature: any, opts?: { stopCombat?: boolean }) => Promise<void>>;
}

// ─── Hook ─────────────────────────────────────────────────────────
export function useGameLoop(params: UseGameLoopParams) {
  const {
    character, updateCharacter, equipped, equipmentBonuses, getNode, addLog,
    startingNodeId, creatures, combatStateRef, broadcastDamage,
    party, partyMembers, awardKillRewardsRef,
  } = params;

  // ── Buff / debuff state ────────────────────────────────────────
  const [regenBuff, setRegenBuff] = useState<RegenBuff>({ multiplier: 1, expiresAt: 0 });
  const [foodBuff, setFoodBuff] = useState<FoodBuff>({ flatRegen: 0, expiresAt: 0 });
  const [isDead, setIsDead] = useState(false);
  const [critBuff, setCritBuff] = useState<CritBuff>({ bonus: 0, expiresAt: 0 });
  const [stealthBuff, setStealthBuff] = useState<StealthBuff | null>(null);
  const [damageBuff, setDamageBuff] = useState<DamageBuff | null>(null);
  const [rootDebuff, setRootDebuff] = useState<RootDebuff | null>(null);
  const [acBuff, setAcBuff] = useState<AcBuff | null>(null);
  const [dotDebuff, setDotDebuff] = useState<DotDebuff | null>(null);
  const [poisonBuff, setPoisonBuff] = useState<PoisonBuff | null>(null);
  const [poisonStacks, setPoisonStacks] = useState<Record<string, PoisonStack>>({});
  const [evasionBuff, setEvasionBuff] = useState<EvasionBuff | null>(null);
  const [disengageNextHit, setDisengageNextHit] = useState<DisengageNextHit | null>(null);
  const [igniteBuff, setIgniteBuff] = useState<IgniteBuff | null>(null);
  const [igniteStacks, setIgniteStacks] = useState<Record<string, IgniteStack>>({});
  const [absorbBuff, setAbsorbBuff] = useState<AbsorbBuff | null>(null);
  const [partyRegenBuff, setPartyRegenBuff] = useState<PartyRegenBuff | null>(null);
  const [sunderDebuff, setSunderDebuff] = useState<SunderDebuff | null>(null);
  const [focusStrikeBuff, setFocusStrikeBuff] = useState<FocusStrikeBuff | null>(null);
  const [regenTick, setRegenTick] = useState(false);
  const [deathCountdown, setDeathCountdown] = useState(3);
  const isDeadRef = useRef(false);
  // Track creatures killed by DoTs to prevent re-damaging after respawn
  const dotKilledRef = useRef<Set<string>>(new Set());
  // Refs for DoT stacks — prevents stale closures in intervals
  const poisonStacksRef = useRef(poisonStacks);
  useEffect(() => { poisonStacksRef.current = poisonStacks; }, [poisonStacks]);
  const igniteStacksRef = useRef(igniteStacks);
  useEffect(() => { igniteStacksRef.current = igniteStacks; }, [igniteStacks]);

  // ── Regen refs (avoid stale closures in intervals) ─────────────
  const regenCharRef = useRef({ hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id, con: character.con, level: character.level });
  const regenBuffRef = useRef(regenBuff);
  const foodBuffRef = useRef(foodBuff);
  const getNodeRef = useRef(getNode);
  const updateCharRegenRef = useRef(updateCharacter);
  const equippedRef = useRef(equipped);
  const inCombatRegenRef = useRef(false);
  const equipmentBonusesRef = useRef(equipmentBonuses);

  useEffect(() => { regenCharRef.current = { hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id, con: character.con, level: character.level }; }, [character.hp, character.max_hp, character.current_node_id, character.con, character.level]);
  useEffect(() => { regenBuffRef.current = regenBuff; }, [regenBuff]);
  useEffect(() => { foodBuffRef.current = foodBuff; }, [foodBuff]);
  useEffect(() => { getNodeRef.current = getNode; }, [getNode]);
  useEffect(() => { updateCharRegenRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { equippedRef.current = equipped; }, [equipped]);
  useEffect(() => { equipmentBonusesRef.current = equipmentBonuses; }, [equipmentBonuses]);

  // ── Computed values ────────────────────────────────────────────
  const itemHpRegen = equipped.reduce((sum, inv) => sum + ((inv.item.stats as any)?.hp_regen || 0), 0);
  const baseRegen = getBaseRegen(character.con + (equipmentBonuses.con || 0));

  // ── HP Regen (every 15s) ───────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const { hp, max_hp, current_node_id, con } = regenCharRef.current;
      const gearHpBonus = equipmentBonusesRef.current.hp || 0;
      const gearConMod = Math.floor((equipmentBonusesRef.current.con || 0) / 2);
      const effectiveMaxHp = max_hp + gearHpBonus + gearConMod;
      if (hp < effectiveMaxHp && hp > 0) {
        const buff = regenBuffRef.current;
        const potionBonus = Date.now() < buff.expiresAt ? (buff.multiplier - 1) : 0; // +2 from potion
        const node = current_node_id ? getNodeRef.current(current_node_id) : null;
        const innBonus = node?.is_inn ? 2 : 0; // +2 from inn
        const conWithGear = con + (equippedRef.current.reduce((s, inv) => s + ((inv.item.stats as any)?.con || 0), 0));
        const conRegen = getBaseRegen(conWithGear);
        const eqItemRegen = equippedRef.current.reduce((s, inv) => s + ((inv.item.stats as any)?.hp_regen || 0), 0);
        const food = foodBuffRef.current;
        const foodRegen = Date.now() < food.expiresAt ? food.flatRegen : 0;
        const milestoneBonus = regenCharRef.current.level >= 35 ? 1 : 0; // +1 from milestone
        const totalMult = 1 + potionBonus + milestoneBonus + innBonus; // additive: max 1+2+1+2 = 6x
        const combatMult = inCombatRegenRef.current ? 0.1 : 1;
        const regenAmount = Math.max(Math.floor((conRegen + eqItemRegen + foodRegen) * totalMult * combatMult), 1);
        const newHp = Math.min(hp + regenAmount, effectiveMaxHp);
        if (newHp !== hp) {
          updateCharRegenRef.current({ hp: newHp });
          setRegenTick(true);
          setTimeout(() => setRegenTick(false), 1200);
        }
      }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // ── CP Regen (every 6s) ────────────────────────────────────────
  const cpCharRef = useRef({ cp: character.cp ?? 100, class: character.class, level: character.level, int: character.int, wis: character.wis, cha: character.cha });
  const cpStatRef = useRef(character);
  useEffect(() => { cpCharRef.current = { cp: character.cp ?? 100, class: character.class, level: character.level, int: character.int, wis: character.wis, cha: character.cha }; }, [character.cp, character.class, character.level, character.int, character.wis, character.cha]);
  useEffect(() => { cpStatRef.current = character; }, [character]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { cp, class: charClass, level, int, wis, cha } = cpCharRef.current;
      const eqB = equipmentBonusesRef.current;
      const gearAwareMaxCp = getMaxCp(level, int + (eqB.int || 0), wis + (eqB.wis || 0), cha + (eqB.cha || 0));
      if (cp >= gearAwareMaxCp) return;
      const primaryStat = CLASS_PRIMARY_STAT[charClass] || 'con';
      const primaryVal = (cpStatRef.current as any)[primaryStat] ?? 10;
      const bRegen = getCpRegenRate(primaryVal);
      const nodeId = regenCharRef.current.current_node_id;
      const node = nodeId ? getNodeRef.current(nodeId) : null;
      const innMult = node?.is_inn ? 3 : 1;
      const buff = regenBuffRef.current;
      const inspireMult = Date.now() < buff.expiresAt ? buff.multiplier : 1;
      const food = foodBuffRef.current;
      const foodCpRegen = Date.now() < food.expiresAt ? food.flatRegen * 0.5 : 0;
      const combatMult = inCombatRegenRef.current ? 0.1 : 1;
      const regenAmount = (bRegen + foodCpRegen) * innMult * inspireMult * combatMult;
      const newCp = Math.min(Math.floor(cp + regenAmount), gearAwareMaxCp);
      if (newCp > cp) {
        updateCharRegenRef.current({ cp: newCp });
      }
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // ── MP Regen (every 3s) ────────────────────────────────────────
  const mpCharRef = useRef({ mp: character.mp ?? 100, max_mp: character.max_mp ?? 100, current_node_id: character.current_node_id, dex: character.dex, level: character.level });
  useEffect(() => { mpCharRef.current = { mp: character.mp ?? 100, max_mp: character.max_mp ?? 100, current_node_id: character.current_node_id, dex: character.dex, level: character.level }; }, [character.mp, character.max_mp, character.current_node_id, character.dex, character.level]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { mp, current_node_id, dex, level } = mpCharRef.current;
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

  // ── Death detection & respawn ──────────────────────────────────
  const deathGoldRef = useRef(character.gold);
  const deathNodeRef = useRef(startingNodeId);
  const updateCharRef = useRef(updateCharacter);
  const addLogRef = useRef(addLog);
  useEffect(() => { deathGoldRef.current = character.gold; }, [character.gold]);
  useEffect(() => { deathNodeRef.current = startingNodeId; }, [startingNodeId]);
  useEffect(() => { updateCharRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { addLogRef.current = addLog; }, [addLog]);

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

  // ── Buff handlers ──────────────────────────────────────────────
  const handleAddPoisonStack = useCallback((creatureId: string) => {
    const dexMod = getStatModifier(character.dex);
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
        creatureNodeId: existing?.creatureNodeId ?? creature?.node_id ?? null,
        maxHp: existing?.maxHp || creature?.max_hp || 10,
        lastKnownHp: existing?.lastKnownHp ?? creature?.hp ?? 10,
      }};
    });
  }, [character.dex, creatures]);

  const handleAddIgniteStack = useCallback((creatureId: string) => {
    const intMod = getStatModifier(character.int);
    const dmgPerTick = Math.max(1, Math.floor(intMod * 0.7));
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
        creatureNodeId: existing?.creatureNodeId ?? creature?.node_id ?? null,
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

  // ── DoT: Bleed (Rend) ─────────────────────────────────────────
  useEffect(() => {
    if (!dotDebuff || Date.now() >= dotDebuff.expiresAt) return;
    if (params.inParty) return; // Server handles DoT in party mode
    const interval = setInterval(async () => {
      if (Date.now() >= dotDebuff.expiresAt) {
        setDotDebuff(null); clearInterval(interval); return;
      }
      const { creatureHpOverrides, updateCreatureHp } = combatStateRef.current;
      const localCreature = creatures.find(c => c.id === dotDebuff.creatureId);
      const currentHp = creatureHpOverrides[dotDebuff.creatureId] ?? localCreature?.hp ?? dotDebuff.lastKnownHp;
      if (currentHp <= 0 || dotKilledRef.current.has(dotDebuff.creatureId)) { setDotDebuff(null); clearInterval(interval); return; }
      const newHp = Math.max(currentHp - dotDebuff.damagePerTick, 0);
      if (localCreature) {
        updateCreatureHp(dotDebuff.creatureId, newHp);
        broadcastDamage(dotDebuff.creatureId, newHp, dotDebuff.damagePerTick, character.name, newHp <= 0);
      }
      await supabase.rpc('damage_creature', { _creature_id: dotDebuff.creatureId, _new_hp: newHp, _killed: newHp <= 0 });
      setDotDebuff(prev => prev ? { ...prev, lastKnownHp: newHp } : null);
      const cName = localCreature?.name || dotDebuff.creatureName;
      const isRemote = dotDebuff.creatureNodeId !== character.current_node_id;
      addLog(`🩸${isRemote ? '📡 ' : ' '}${cName} bleeds for ${dotDebuff.damagePerTick} damage!${isRemote ? ' (remote)' : ''}`);
      if (newHp <= 0) {
        dotKilledRef.current.add(dotDebuff.creatureId);
        setDotDebuff(null); clearInterval(interval);
        const creatureData = localCreature || {
          name: dotDebuff.creatureName, level: dotDebuff.creatureLevel, rarity: dotDebuff.creatureRarity,
          loot_table: dotDebuff.creatureLootTable, loot_table_id: dotDebuff.lootTableId, drop_chance: dotDebuff.dropChance,
          node_id: dotDebuff.creatureNodeId,
        };
        await awardKillRewardsRef.current(creatureData, { stopCombat: true });
      }
    }, dotDebuff.intervalMs);
    return () => clearInterval(interval);
  }, [dotDebuff, creatures, addLog]);

  // ── DoT: Poison ────────────────────────────────────────────────
  useEffect(() => {
    const activeStacks = Object.entries(poisonStacks).filter(([, s]) => Date.now() < s.expiresAt);
    if (activeStacks.length === 0) return;
    if (params.inParty) return; // Server handles DoT in party mode
    const interval = setInterval(async () => {
      const currentStacks = poisonStacksRef.current;
      const { creatureHpOverrides, updateCreatureHp } = combatStateRef.current;
      const now = Date.now();
      let anyExpired = false;
      for (const [creatureId, stack] of Object.entries(currentStacks)) {
        if (now >= stack.expiresAt) { anyExpired = true; continue; }
        const localCreature = creatures.find(c => c.id === creatureId);
        const currentHp = creatureHpOverrides[creatureId] ?? localCreature?.hp ?? stack.lastKnownHp;
        if (currentHp <= 0 || dotKilledRef.current.has(creatureId)) {
          anyExpired = true;
          setPoisonStacks(prev => { const next = { ...prev }; delete next[creatureId]; return next; });
          continue;
        }
        const totalDmg = stack.stacks * stack.damagePerTick;
        const newHp = Math.max(currentHp - totalDmg, 0);
        if (localCreature) {
          updateCreatureHp(creatureId, newHp);
          broadcastDamage(creatureId, newHp, totalDmg, character.name, newHp <= 0);
        }
        await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: newHp, _killed: newHp <= 0 });
        setPoisonStacks(prev => {
          if (!prev[creatureId]) return prev;
          if (newHp <= 0) {
            const next = { ...prev };
            delete next[creatureId];
            return next;
          }
          return { ...prev, [creatureId]: { ...prev[creatureId], lastKnownHp: newHp } };
        });
        const cName = localCreature?.name || stack.creatureName;
        const isRemote = stack.creatureNodeId !== character.current_node_id;
        addLog(`🧪${isRemote ? '📡 ' : ' '}${cName} takes ${totalDmg} poison damage! (${stack.stacks} stack${stack.stacks > 1 ? 's' : ''})${isRemote ? ' (remote)' : ''}`);
        if (newHp <= 0) {
          anyExpired = true;
          dotKilledRef.current.add(creatureId);
          const creatureData = localCreature || {
            name: stack.creatureName, level: stack.creatureLevel, rarity: stack.creatureRarity,
            loot_table: stack.creatureLootTable, loot_table_id: stack.lootTableId, drop_chance: stack.dropChance,
            node_id: stack.creatureNodeId,
          };
          await awardKillRewardsRef.current(creatureData, { stopCombat: true });
        }
      }
      if (anyExpired) {
        setPoisonStacks(prev => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (Date.now() >= next[key].expiresAt || next[key].lastKnownHp <= 0) {
              dotKilledRef.current.delete(key);
              delete next[key];
            }
          }
          return next;
        });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [poisonStacks, creatures, addLog]);

  // ── DoT: Ignite ────────────────────────────────────────────────
  useEffect(() => {
    const activeStacks = Object.entries(igniteStacks).filter(([, s]) => Date.now() < s.expiresAt);
    if (activeStacks.length === 0) return;
    if (params.inParty) return; // Server handles DoT in party mode
    const interval = setInterval(async () => {
      const { creatureHpOverrides, updateCreatureHp } = combatStateRef.current;
      const now = Date.now();
      let anyExpired = false;
      const currentIgniteStacks = igniteStacksRef.current;
      for (const [creatureId, stack] of Object.entries(currentIgniteStacks)) {
        if (now >= stack.expiresAt) { anyExpired = true; continue; }
        const localCreature = creatures.find(c => c.id === creatureId);
        const currentHp = creatureHpOverrides[creatureId] ?? localCreature?.hp ?? stack.lastKnownHp;
        if (currentHp <= 0 || dotKilledRef.current.has(creatureId)) {
          anyExpired = true;
          setIgniteStacks(prev => { const next = { ...prev }; delete next[creatureId]; return next; });
          continue;
        }
        const totalDmg = stack.stacks * stack.damagePerTick;
        const newHp = Math.max(currentHp - totalDmg, 0);
        if (localCreature) {
          updateCreatureHp(creatureId, newHp);
          broadcastDamage(creatureId, newHp, totalDmg, character.name, newHp <= 0);
        }
        await supabase.rpc('damage_creature', { _creature_id: creatureId, _new_hp: newHp, _killed: newHp <= 0 });
        setIgniteStacks(prev => {
          if (!prev[creatureId]) return prev;
          if (newHp <= 0) {
            const next = { ...prev };
            delete next[creatureId];
            return next;
          }
          return { ...prev, [creatureId]: { ...prev[creatureId], lastKnownHp: newHp } };
        });
        const cName = localCreature?.name || stack.creatureName;
        const isRemote = stack.creatureNodeId !== character.current_node_id;
        addLog(`🔥${isRemote ? '📡 ' : ' '}${cName} burns for ${totalDmg} fire damage! (${stack.stacks} stack${stack.stacks > 1 ? 's' : ''})${isRemote ? ' (remote)' : ''}`);
        if (newHp <= 0) {
          anyExpired = true;
          dotKilledRef.current.add(creatureId);
          const creatureData = localCreature || {
            name: stack.creatureName, level: stack.creatureLevel, rarity: stack.creatureRarity,
            loot_table: stack.creatureLootTable, loot_table_id: stack.lootTableId, drop_chance: stack.dropChance,
            node_id: stack.creatureNodeId,
          };
          await awardKillRewardsRef.current(creatureData, { stopCombat: true });
        }
      }
      if (anyExpired) {
        setIgniteStacks(prev => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (Date.now() >= next[key].expiresAt || next[key].lastKnownHp <= 0) {
              dotKilledRef.current.delete(key);
              delete next[key];
            }
          }
          return next;
        });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [igniteStacks, creatures, addLog]);

  // ── Crescendo / Purifying Light party regen ────────────────────
  useEffect(() => {
    if (!partyRegenBuff || Date.now() >= partyRegenBuff.expiresAt) return;
    const interval = setInterval(async () => {
      if (Date.now() >= partyRegenBuff.expiresAt) {
        setPartyRegenBuff(null); clearInterval(interval); return;
      }
      const charState = regenCharRef.current;
      const gearHpBonus = equipmentBonusesRef.current.hp || 0;
      const gearConMod = Math.floor((equipmentBonusesRef.current.con || 0) / 2);
      const effectiveMaxHp = charState.max_hp + gearHpBonus + gearConMod;
      const selfNewHp = Math.min(effectiveMaxHp, charState.hp + partyRegenBuff.healPerTick);
      if (selfNewHp > charState.hp) {
        await updateCharacter({ hp: selfNewHp });
      }
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

  // ── Notify that a creature was killed (purge all DoTs targeting it) ──
  const notifyCreatureKilled = useCallback((creatureId: string) => {
    dotKilledRef.current.add(creatureId);
    setDotDebuff(prev => (prev && prev.creatureId === creatureId) ? null : prev);
    setPoisonStacks(prev => {
      if (!prev[creatureId]) return prev;
      const next = { ...prev };
      delete next[creatureId];
      return next;
    });
    setIgniteStacks(prev => {
      if (!prev[creatureId]) return prev;
      const next = { ...prev };
      delete next[creatureId];
      return next;
    });
  }, []);

  return {
    // Buff states + setters
    regenBuff, setRegenBuff, foodBuff, setFoodBuff,
    isDead, critBuff, setCritBuff,
    stealthBuff, setStealthBuff, damageBuff, setDamageBuff,
    rootDebuff, setRootDebuff, acBuff, setAcBuff,
    dotDebuff, setDotDebuff, poisonBuff, setPoisonBuff,
    poisonStacks, setPoisonStacks,
    evasionBuff, setEvasionBuff, disengageNextHit, setDisengageNextHit,
    igniteBuff, setIgniteBuff, igniteStacks, setIgniteStacks,
    absorbBuff, setAbsorbBuff, partyRegenBuff, setPartyRegenBuff,
    sunderDebuff, setSunderDebuff, focusStrikeBuff, setFocusStrikeBuff,
    // Computed
    regenTick, deathCountdown, itemHpRegen, baseRegen,
    // Handlers
    handleAddPoisonStack, handleAddIgniteStack, handleAbsorbDamage, notifyCreatureKilled,
    // Refs
    inCombatRegenRef, deathGoldRef,
  };
}
