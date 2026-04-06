/**
 * Client-side mirror of the pure `resolveEffectTicks` logic from
 * `supabase/functions/_shared/combat-resolver.ts`.
 *
 * This file exists solely so Vitest can import and test the deterministic
 * resolver without touching the Deno edge-function import graph.
 * The edge functions remain the authoritative copy.
 *
 * IMPORTANT: keep this in sync with the _shared version. Both are pure
 * (no DB calls) and must produce identical results.
 */

// ── Types ────────────────────────────────────────────────────────

export interface LootQueueEntry {
  nodeId: string;
  lootTableId: string | null;
  itemId: string | null;
  creatureName: string;
  dropChance: number;
  mode: 'legacy' | 'item_pool';
  creatureLevel?: number;
}

export interface EffectTickResult {
  expiredIds: string[];
  newKills: Set<string>;
  lootQueue: LootQueueEntry[];
  events: { type: string; message: string }[];
  clearedDots: { character_id: string; creature_id: string; dot_type: string }[];
  advancedEffects: any[];
}

// ── resolveEffectTicks ───────────────────────────────────────────

export function resolveEffectTicks(
  effects: any[],
  cHp: Record<string, number>,
  cKilled: Set<string>,
  creatures: any[],
  tickCap: number,
  opts: {
    tickTime?: number;
    now?: number;
    memberNameMap?: Record<string, string>;
  } = {},
): EffectTickResult {
  const { tickTime, now, memberNameMap } = opts;
  const isSingleTick = tickTime !== undefined;

  const expiredIds: string[] = [];
  const newKills = new Set<string>();
  const lootQueue: LootQueueEntry[] = [];
  const events: { type: string; message: string }[] = [];
  const clearedDots: { character_id: string; creature_id: string; dot_type: string }[] = [];
  const advancedEffects: any[] = [];

  for (const eff of effects) {
    if (cKilled.has(eff.target_id) || cHp[eff.target_id] === undefined || cHp[eff.target_id] <= 0) {
      continue;
    }

    const creature = creatures.find((cr: any) => cr.id === eff.target_id);
    if (!creature) continue;

    const charName = memberNameMap?.[eff.source_id] || 'Unknown';

    if (isSingleTick) {
      if (eff.expires_at <= tickTime!) {
        eff._expired = true;
        expiredIds.push(eff.id);
        clearedDots.push({ character_id: eff.source_id, creature_id: eff.target_id, dot_type: eff.effect_type });
        continue;
      }

      if (eff.next_tick_at <= tickTime!) {
        const totalDmg = (eff.effect_type === 'bleed') ? eff.damage_per_tick : eff.stacks * eff.damage_per_tick;
        cHp[eff.target_id] = Math.max(cHp[eff.target_id] - totalDmg, 0);

        const emoji = eff.effect_type === 'bleed' ? '🩸' : eff.effect_type === 'poison' ? '🧪' : '🔥';
        const verb = eff.effect_type === 'bleed' ? 'bleeds' : eff.effect_type === 'poison' ? 'takes' : 'burns';
        const suffix = eff.effect_type === 'bleed'
          ? `(${charName}'s Rend)`
          : `(${eff.stacks} stack${eff.stacks > 1 ? 's' : ''}, ${charName})`;
        const dmgLabel = eff.effect_type === 'bleed' ? eff.damage_per_tick : totalDmg;
        const dmgType = eff.effect_type === 'bleed' ? '' : eff.effect_type === 'poison' ? ' poison' : ' fire';
        events.push({ type: 'dot_tick', message: `${emoji} ${creature.name} ${verb} for ${dmgLabel}${dmgType} damage! ${suffix}` });

        eff.next_tick_at += eff.tick_rate_ms;
        advancedEffects.push(eff);

        if (cHp[eff.target_id] <= 0 && !cKilled.has(eff.target_id)) {
          cKilled.add(eff.target_id);
          newKills.add(eff.target_id);
          pushCreatureLoot(creature, eff.target_id, lootQueue);
        }
      }
    } else {
      const currentNow = now!;
      const elapsedMs = currentNow - eff.next_tick_at;
      if (elapsedMs < 0) continue;

      const ticksToProcess = Math.floor(elapsedMs / eff.tick_rate_ms) + 1;
      const maxTicksByExpiry = Math.max(0, Math.floor((eff.expires_at - eff.next_tick_at) / eff.tick_rate_ms) + 1);
      const ticks = Math.min(ticksToProcess, tickCap, maxTicksByExpiry);

      if (ticks <= 0) {
        if (currentNow >= eff.expires_at) expiredIds.push(eff.id);
        continue;
      }

      for (let t = 0; t < ticks; t++) {
        const tt = eff.next_tick_at + t * eff.tick_rate_ms;
        if (tt > eff.expires_at) break;
        if (cKilled.has(eff.target_id) || cHp[eff.target_id] <= 0) break;

        const totalDmg = (eff.effect_type === 'bleed') ? eff.damage_per_tick : eff.stacks * eff.damage_per_tick;
        cHp[eff.target_id] = Math.max(cHp[eff.target_id] - totalDmg, 0);

        if (cHp[eff.target_id] <= 0 && !cKilled.has(eff.target_id)) {
          cKilled.add(eff.target_id);
          newKills.add(eff.target_id);
          pushCreatureLoot(creature, eff.target_id, lootQueue);
        }
      }

      const newNextTickAt = eff.next_tick_at + ticks * eff.tick_rate_ms;
      if (newNextTickAt >= eff.expires_at || cKilled.has(eff.target_id)) {
        expiredIds.push(eff.id);
      } else {
        eff.next_tick_at = newNextTickAt;
        advancedEffects.push(eff);
      }
    }
  }

  return { expiredIds, newKills, lootQueue, events, clearedDots, advancedEffects };
}

// ── Helper: push loot queue entries for a killed creature ─────────
function pushCreatureLoot(creature: any, _creatureId: string, lootQueue: LootQueueEntry[]) {
  const nodeId = creature.node_id;
  if (creature.loot_table_id) {
    lootQueue.push({
      nodeId,
      lootTableId: creature.loot_table_id,
      itemId: null,
      creatureName: creature.name,
      dropChance: creature.drop_chance ?? 0.5,
    });
  } else {
    const lt = (creature.loot_table || []) as any[];
    for (const entry of lt) {
      if (entry.type === 'gold') continue;
      if (Math.random() <= (entry.chance || 0.1)) {
        lootQueue.push({
          nodeId,
          lootTableId: null,
          itemId: entry.item_id,
          creatureName: creature.name,
          dropChance: 1,
        });
      }
    }
  }
}
