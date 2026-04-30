/**
 * useBuffState — owns all transient combat buff/debuff UI state.
 *
 * This hook is narrowly focused on local display state for buffs, debuffs,
 * and DoT stacks. It does NOT own combat flow, regen intervals, networking,
 * or kill/reward business logic.
 *
 * State classification: Local UI state (synced from server but owned locally for rendering)
 */
import { useState, useCallback } from 'react';
import { getStatModifier } from '@/lib/game-data';
import { mapServerEffectsToStacks, type ServerDotState } from '../utils/mapServerEffectsToBuffState';
import type {
  FoodBuff, CritBuff, StealthBuff, DamageBuff, RootDebuff, BattleCryBuff,
  DotDebuff, PoisonBuff, PoisonStack, EvasionBuff, DisengageNextHit, IgniteBuff,
  IgniteStack, AbsorbBuff, PartyRegenBuff, SunderDebuff, InspireBuff,
  HolyShieldBuff, ShieldWallBuff, ConsecrateBuff, DivineChallengeBuff,
} from './useGameLoop';

// ─── Typed interfaces for bundled state ────────────────────────
export interface BuffState {
  foodBuff: FoodBuff;
  critBuff: CritBuff;
  stealthBuff: StealthBuff | null;
  damageBuff: DamageBuff | null;
  rootDebuff: RootDebuff | null;
  battleCryBuff: BattleCryBuff | null;
  bleedStacks: Record<string, DotDebuff>;
  poisonBuff: PoisonBuff | null;
  poisonStacks: Record<string, PoisonStack>;
  evasionBuff: EvasionBuff | null;
  disengageNextHit: DisengageNextHit | null;
  igniteBuff: IgniteBuff | null;
  igniteStacks: Record<string, IgniteStack>;
  absorbBuff: AbsorbBuff | null;
  partyRegenBuff: PartyRegenBuff | null;
  sunderDebuff: Record<string, SunderDebuff>;
  inspireBuff: InspireBuff | null;
  holyShieldBuff: HolyShieldBuff | null;
  shieldWallBuff: ShieldWallBuff | null;
  consecrateBuff: ConsecrateBuff | null;
  divineChallengeBuff: DivineChallengeBuff | null;
}

export interface BuffSetters {
  setFoodBuff: React.Dispatch<React.SetStateAction<FoodBuff>>;
  setCritBuff: React.Dispatch<React.SetStateAction<CritBuff>>;
  setStealthBuff: React.Dispatch<React.SetStateAction<StealthBuff | null>>;
  setDamageBuff: React.Dispatch<React.SetStateAction<DamageBuff | null>>;
  setRootDebuff: React.Dispatch<React.SetStateAction<RootDebuff | null>>;
  setBattleCryBuff: React.Dispatch<React.SetStateAction<BattleCryBuff | null>>;
  setBleedStacks: React.Dispatch<React.SetStateAction<Record<string, DotDebuff>>>;
  setPoisonBuff: React.Dispatch<React.SetStateAction<PoisonBuff | null>>;
  setPoisonStacks: React.Dispatch<React.SetStateAction<Record<string, PoisonStack>>>;
  setEvasionBuff: React.Dispatch<React.SetStateAction<EvasionBuff | null>>;
  setDisengageNextHit: React.Dispatch<React.SetStateAction<DisengageNextHit | null>>;
  setIgniteBuff: React.Dispatch<React.SetStateAction<IgniteBuff | null>>;
  setIgniteStacks: React.Dispatch<React.SetStateAction<Record<string, IgniteStack>>>;
  setAbsorbBuff: React.Dispatch<React.SetStateAction<AbsorbBuff | null>>;
  setPartyRegenBuff: React.Dispatch<React.SetStateAction<PartyRegenBuff | null>>;
  setSunderDebuff: React.Dispatch<React.SetStateAction<Record<string, SunderDebuff>>>;
  setInspireBuff: React.Dispatch<React.SetStateAction<InspireBuff | null>>;
  setHolyShieldBuff: React.Dispatch<React.SetStateAction<HolyShieldBuff | null>>;
  setShieldWallBuff: React.Dispatch<React.SetStateAction<ShieldWallBuff | null>>;
  setConsecrateBuff: React.Dispatch<React.SetStateAction<ConsecrateBuff | null>>;
  setDivineChallengeBuff: React.Dispatch<React.SetStateAction<DivineChallengeBuff | null>>;
}

// ─── Params ───────────────────────────────────────────────────
export interface UseBuffStateParams {
  characterDex: number;
  characterInt: number;
  creatures: { id: string; name: string; level: number; rarity: string; hp: number; max_hp: number; loot_table: any; loot_table_id: string | null; drop_chance: number; node_id?: string | null; [k: string]: any }[];
}

// ─── Hook ─────────────────────────────────────────────────────
export function useBuffState(params: UseBuffStateParams) {
  const { characterDex, characterInt, creatures } = params;

  // ── All buff/debuff state declarations ──────────────────
  const [foodBuff, setFoodBuff] = useState<FoodBuff>({ flatRegen: 0, expiresAt: 0 });
  const [critBuff, setCritBuff] = useState<CritBuff>({ bonus: 0, expiresAt: 0 });
  const [stealthBuff, setStealthBuff] = useState<StealthBuff | null>(null);
  const [damageBuff, setDamageBuff] = useState<DamageBuff | null>(null);
  const [rootDebuff, setRootDebuff] = useState<RootDebuff | null>(null);
  const [battleCryBuff, setBattleCryBuff] = useState<BattleCryBuff | null>(null);
  const [bleedStacks, setBleedStacks] = useState<Record<string, DotDebuff>>({});
  const [poisonBuff, setPoisonBuff] = useState<PoisonBuff | null>(null);
  const [poisonStacks, setPoisonStacks] = useState<Record<string, PoisonStack>>({});
  const [evasionBuff, setEvasionBuff] = useState<EvasionBuff | null>(null);
  const [disengageNextHit, setDisengageNextHit] = useState<DisengageNextHit | null>(null);
  const [igniteBuff, setIgniteBuff] = useState<IgniteBuff | null>(null);
  const [igniteStacks, setIgniteStacks] = useState<Record<string, IgniteStack>>({});
  const [absorbBuff, setAbsorbBuff] = useState<AbsorbBuff | null>(null);
  const [partyRegenBuff, setPartyRegenBuff] = useState<PartyRegenBuff | null>(null);
  const [sunderDebuff, setSunderDebuff] = useState<Record<string, SunderDebuff>>({});
  const [inspireBuff, setInspireBuff] = useState<InspireBuff | null>(null);
  const [holyShieldBuff, setHolyShieldBuff] = useState<HolyShieldBuff | null>(null);
  const [shieldWallBuff, setShieldWallBuff] = useState<ShieldWallBuff | null>(null);
  const [consecrateBuff, setConsecrateBuff] = useState<ConsecrateBuff | null>(null);
  const [divineChallengeBuff, setDivineChallengeBuff] = useState<DivineChallengeBuff | null>(null);

  // ── Purge all DoT stacks targeting a killed creature (UI cleanup) ──
  const notifyCreatureKilled = useCallback((creatureId: string) => {
    setBleedStacks(prev => {
      if (!prev[creatureId]) return prev;
      const next = { ...prev };
      delete next[creatureId];
      return next;
    });
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

  // ── Add poison stack from server proc event ──
  const handleAddPoisonStack = useCallback((creatureId: string) => {
    const dexMod = getStatModifier(characterDex);
    const dmgPerTick = Math.max(1, Math.floor(dexMod * 1.2 * 0.67));
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
  }, [characterDex, creatures]);

  // ── Add ignite stack from server proc event ──
  const handleAddIgniteStack = useCallback((creatureId: string) => {
    const intMod = getStatModifier(characterInt);
    const dmgPerTick = Math.max(1, Math.floor(intMod * 0.7 * 0.67));
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
  }, [characterInt, creatures]);

  // ── Absorb damage against shield ──
  const handleAbsorbDamage = useCallback((remaining: number) => {
    setAbsorbBuff(prev => {
      if (!prev) return null;
      if (remaining <= 0) return null;
      return { ...prev, shieldHp: remaining };
    });
  }, []);

  // ── Gather active buffs for server combat-tick request ──
  const gatherBuffs = useCallback(() => {
    const now = Date.now();
    const buffs: Record<string, any> = {};
    if (critBuff && now < critBuff.expiresAt) buffs.crit_buff = { bonus: critBuff.bonus };
    if (stealthBuff && now < stealthBuff.expiresAt) buffs.stealth_buff = true;
    if (damageBuff && now < damageBuff.expiresAt) buffs.damage_buff = true;
    if (rootDebuff && now < rootDebuff.expiresAt) {
      buffs.root_debuff_target = (rootDebuff as any).creatureId;
      buffs.root_debuff_reduction = rootDebuff.damageReduction;
    }
    if (battleCryBuff && now < battleCryBuff.expiresAt) buffs.battle_cry_dr = { reduction: battleCryBuff.damageReduction, crit_reduction: battleCryBuff.critReduction };
    if (poisonBuff && now < poisonBuff.expiresAt) buffs.poison_buff = true;
    if (evasionBuff && now < evasionBuff.expiresAt) buffs.evasion_buff = { dodge_chance: evasionBuff.dodgeChance };
    if (igniteBuff && now < igniteBuff.expiresAt) buffs.ignite_buff = true;
    if (absorbBuff && now < absorbBuff.expiresAt) buffs.absorb_buff = { shield_hp: absorbBuff.shieldHp };
    const activeSunder = Object.values(sunderDebuff).find(s => now < s.expiresAt);
    if (activeSunder) {
      buffs.sunder_target = activeSunder.creatureId;
      buffs.sunder_reduction = activeSunder.acReduction;
    }
    if (disengageNextHit) buffs.disengage_next_hit = { bonus_mult: disengageNextHit.bonusMult };
    return buffs;
  }, [critBuff, stealthBuff, damageBuff, rootDebuff, battleCryBuff, poisonBuff, evasionBuff, igniteBuff, absorbBuff, sunderDebuff, disengageNextHit]);

  // ── Handle consumed one-shot buffs after server tick ──
  const handleConsumedBuffs = useCallback((consumed: { buff: string; character_id: string }[]) => {
    for (const c of consumed) {
      if (c.buff === 'stealth') setStealthBuff(null);
      if (c.buff === 'disengage') setDisengageNextHit(null);
    }
  }, []);

  // ── Handle cleared DoTs (creature killed server-side) ──
  const handleClearedDots = useCallback((cleared: { character_id: string; creature_id: string; dot_type: string }[]) => {
    for (const c of cleared) {
      notifyCreatureKilled(c.creature_id);
    }
  }, [notifyCreatureKilled]);

  // ── Sync server DoT state to local UI display state ──
  const syncFromServerEffects = useCallback((myDots: ServerDotState | undefined) => {
    if (!myDots) return;
    const result = mapServerEffectsToStacks(myDots, poisonStacks, igniteStacks, bleedStacks);
    setPoisonStacks(result.poison);
    setIgniteStacks(result.ignite);
    setBleedStacks(result.bleed);
  }, [poisonStacks, igniteStacks, bleedStacks]);

  // ── Sync merged creature-centric debuffs for shared party display ──
  const syncCreatureDebuffs = useCallback((debuffs: Record<string, { poison?: { stacks: number; damage_per_tick: number }; ignite?: { stacks: number; damage_per_tick: number }; bleed?: { stacks: number; damage_per_tick: number }; sunder?: { stacks: number } }>) => {
    // Build merged ServerDotState from creature-centric data
    // Since these come from live active_effects, set a reasonable expires_at so the UI considers them active
    const now = Date.now();
    const defaultExpiry = now + 30000;
    const merged: ServerDotState = { poison: {}, ignite: {}, bleed: {} };
    const sunderUpdates: Record<string, SunderDebuff> = {};
    for (const [creatureId, entry] of Object.entries(debuffs)) {
      if (entry.poison) merged.poison![creatureId] = { stacks: entry.poison.stacks, damage_per_tick: entry.poison.damage_per_tick, expires_at: defaultExpiry };
      if (entry.ignite) merged.ignite![creatureId] = { stacks: entry.ignite.stacks, damage_per_tick: entry.ignite.damage_per_tick, expires_at: defaultExpiry };
      if (entry.bleed) merged.bleed![creatureId] = { damage_per_tick: entry.bleed.damage_per_tick, expires_at: defaultExpiry };
      if (entry.sunder) {
        sunderUpdates[creatureId] = { creatureId, acReduction: entry.sunder.stacks * 2, expiresAt: defaultExpiry, creatureName: '' };
      }
    }
    if (Object.keys(sunderUpdates).length > 0) {
      setSunderDebuff(prev => ({ ...prev, ...sunderUpdates }));
    }
    const result = mapServerEffectsToStacks(merged, poisonStacks, igniteStacks, bleedStacks);
    setPoisonStacks(result.poison);
    setIgniteStacks(result.ignite);
    setBleedStacks(result.bleed);
  }, [poisonStacks, igniteStacks, bleedStacks]);

  // ── Bundled state objects ──────────────────────────────────
  const buffState: BuffState = {
    foodBuff, critBuff, stealthBuff, damageBuff, rootDebuff, battleCryBuff,
    bleedStacks, poisonBuff, poisonStacks, evasionBuff, disengageNextHit,
    igniteBuff, igniteStacks, absorbBuff, partyRegenBuff, sunderDebuff,
    inspireBuff,
  };

  const buffSetters: BuffSetters = {
    setFoodBuff, setCritBuff, setStealthBuff, setDamageBuff,
    setRootDebuff, setBattleCryBuff, setBleedStacks, setPoisonBuff, setPoisonStacks,
    setEvasionBuff, setDisengageNextHit, setIgniteBuff, setIgniteStacks,
    setAbsorbBuff, setPartyRegenBuff, setSunderDebuff,
    setInspireBuff,
  };

  return {
    buffState,
    buffSetters,
    notifyCreatureKilled,
    handleAddPoisonStack,
    handleAddIgniteStack,
    handleAbsorbDamage,
    gatherBuffs,
    handleConsumedBuffs,
    handleClearedDots,
    syncFromServerEffects,
    syncCreatureDebuffs,
  };
}
