/**
 * mapServerEffectsToBuffState — pure helper that transforms server-side
 * active_effects data into local UI stack shapes for display.
 *
 * This is intentionally a pure function with no hooks or side effects,
 * making it easy to unit test.
 */
import type { PoisonStack, IgniteStack, DotDebuff } from '../hooks/useGameLoop';

export interface ServerDotState {
  poison?: Record<string, { stacks?: number; damage_per_tick?: number; expires_at?: number }>;
  ignite?: Record<string, { stacks?: number; damage_per_tick?: number; expires_at?: number }>;
  bleed?: Record<string, { damage_per_tick?: number; expires_at?: number }>;
}

/**
 * Maps server DoT effect data to local UI stack state.
 * Preserves creature metadata from previous local state where available,
 * since the server only sends effect parameters, not creature display info.
 */
export function mapServerEffectsToStacks(
  serverDots: ServerDotState | undefined,
  prevPoison: Record<string, PoisonStack>,
  prevIgnite: Record<string, IgniteStack>,
  prevBleed: Record<string, DotDebuff>,
): { poison: Record<string, PoisonStack>; ignite: Record<string, IgniteStack>; bleed: Record<string, DotDebuff> } {
  const poison: Record<string, PoisonStack> = {};
  const ignite: Record<string, IgniteStack> = {};
  const bleed: Record<string, DotDebuff> = {};

  if (serverDots?.poison) {
    for (const [cid, dot] of Object.entries(serverDots.poison)) {
      const prev = prevPoison[cid];
      poison[cid] = {
        stacks: dot.stacks || 1,
        damagePerTick: dot.damage_per_tick || 0,
        expiresAt: dot.expires_at || 0,
        creatureName: prev?.creatureName || 'Unknown',
        creatureLevel: prev?.creatureLevel || 1,
        creatureRarity: prev?.creatureRarity || 'regular',
        creatureLootTable: prev?.creatureLootTable || [],
        lootTableId: prev?.lootTableId ?? null,
        dropChance: prev?.dropChance ?? 0.5,
        creatureNodeId: prev?.creatureNodeId ?? null,
        maxHp: prev?.maxHp || 10,
        lastKnownHp: prev?.lastKnownHp ?? 10,
      };
    }
  }

  if (serverDots?.ignite) {
    for (const [cid, dot] of Object.entries(serverDots.ignite)) {
      const prev = prevIgnite[cid];
      ignite[cid] = {
        stacks: dot.stacks || 1,
        damagePerTick: dot.damage_per_tick || 0,
        expiresAt: dot.expires_at || 0,
        creatureName: prev?.creatureName || 'Unknown',
        creatureLevel: prev?.creatureLevel || 1,
        creatureRarity: prev?.creatureRarity || 'regular',
        creatureLootTable: prev?.creatureLootTable || [],
        lootTableId: prev?.lootTableId ?? null,
        dropChance: prev?.dropChance ?? 0.5,
        creatureNodeId: prev?.creatureNodeId ?? null,
        maxHp: prev?.maxHp || 10,
        lastKnownHp: prev?.lastKnownHp ?? 10,
      };
    }
  }

  if (serverDots?.bleed) {
    for (const [cid, dot] of Object.entries(serverDots.bleed)) {
      const prev = prevBleed[cid];
      bleed[cid] = {
        damagePerTick: dot.damage_per_tick || 0,
        intervalMs: 2000,
        expiresAt: dot.expires_at || 0,
        creatureId: cid,
        creatureName: prev?.creatureName || 'Unknown',
        creatureLevel: prev?.creatureLevel || 1,
        creatureRarity: prev?.creatureRarity || 'regular',
        creatureLootTable: prev?.creatureLootTable || [],
        lootTableId: prev?.lootTableId ?? null,
        dropChance: prev?.dropChance ?? 0.5,
        creatureNodeId: prev?.creatureNodeId ?? null,
        maxHp: prev?.maxHp || 10,
        lastKnownHp: prev?.lastKnownHp ?? 10,
      };
    }
  }

  return { poison, ignite, bleed };
}
