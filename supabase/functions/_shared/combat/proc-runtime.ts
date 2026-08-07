/**
 * proc-runtime.ts — Phase 8 decomposition.
 *
 * Item proc resolution (damage/heal procs and `item_buff:*` self-buff procs)
 * and boss crit-flavor selection, extracted verbatim out of
 * `combat-tick/index.ts` so the resolver file only orchestrates ticks.
 *
 * Zero behaviour change: the math, rolls, event shapes and message strings are
 * identical to the inline versions they replace.
 */
import { formatProcMessage } from "../proc-log-format.ts";
import { resolveDamage, resolveHeal } from "./resolution.ts";
import type { CreatureDamageSource } from "./creature-damage-modifiers.ts";

export interface BossFlavor {
  name: string;
  text: string;
  damage_type?: string;
}

/** Boss crit flavor selection (weighted random). */
export function pickBossFlavor(raw: any): BossFlavor | null {
  const flavors = (Array.isArray(raw) ? raw : [])
    .filter((f: any) => typeof f.text === 'string' && f.text.trim().length > 0)
    .map((f: any) => ({
      name: ((f.name as string) || '').trim(),
      text: (f.text as string).trim(),
      weight: Number.isFinite(f.weight) && (f.weight as number) > 0 ? (f.weight as number) : 1,
      damage_type: ((f.damage_type as string) || '').trim() || undefined,
    }));
  if (flavors.length === 0) return null;
  const totalWeight = flavors.reduce((s: number, f: any) => s + f.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const f of flavors) {
    roll -= f.weight;
    if (roll <= 0) return { name: f.name, text: f.text, damage_type: f.damage_type };
  }
  const last = flavors[flavors.length - 1];
  return { name: last.name, text: last.text, damage_type: last.damage_type };
}

/** Proc-on-hit resolver (lifesteal / heal pulse / burst damage / flavor-only). */
export function resolveProcs(
  procs: { type: string; chance: number; value: number; text: string }[],
  attackerName: string,
  attackerId: string,
  targetName: string,
  targetId: string,
  mHp: Record<string, number>,
  cHp: Record<string, number>,
  maxHp: number,
  events: any[],
  cKilled: Set<string>,
  /**
   * Target-side incoming-damage modifier stage (Chilled). Injected so this
   * helper shares the caller's frozen per-tick snapshot.
   */
  ampCreature: (amount: number, source: CreatureDamageSource, creatureId: string) => number
    = (amount) => amount,
) {
  for (const proc of procs) {
    if (Math.random() >= proc.chance) continue;
    const message = formatProcMessage(proc, attackerName, targetName);
    switch (proc.type) {
      case 'lifesteal':
      case 'heal_pulse': {
        mHp[attackerId] = resolveHeal({ amount: proc.value, hp: mHp[attackerId], maxHp }).hpAfter;
        events.push({ type: 'proc', message, character_id: attackerId });
        break;
      }
      case 'burst_damage': {
        if (cKilled.has(targetId)) break;
        // Target-side incoming-damage modifiers (Chilled) before final resolution.
        cHp[targetId] = resolveDamage({
          amount: ampCreature(proc.value, 'proc', targetId), hp: cHp[targetId],
        }).hpAfter;
        events.push({ type: 'proc', message, character_id: attackerId });
        break;
      }
      default: {
        events.push({ type: 'proc', message, character_id: attackerId });
      }
    }
  }
}

/**
 * Buff-on-trigger resolver (`item_buff:*` effects).
 *
 * Procs whose `type` starts with `buff_` apply a self-buff to the wearer via an
 * `active_effects` row of effect_type `item_buff:<sub>` where
 * <sub> ∈ ac | dr | str | dex | con | int | wis | cha.
 * "Ignore while active": if the wearer already has the same sub-effect
 * running, the proc no-ops.
 */
export function resolveBuffProcs(
  procs: any[],
  wearerId: string,
  wearerName: string,
  trigger: 'on_hit' | 'on_taken',
  activeEffects: any[],
  memberBuffActive: Record<string, Set<string>>,
  events: any[],
  combatNodeId: string,
  nowMs: number,
) {
  if (!Array.isArray(procs) || procs.length === 0) return;
  for (const p of procs) {
    if (!p?.type || typeof p.type !== 'string' || !p.type.startsWith('buff_')) continue;
    const procTrigger = (p.trigger === 'on_taken' ? 'on_taken' : 'on_hit');
    if (procTrigger !== trigger) continue;
    if (Math.random() >= (p.chance ?? 0)) continue;

    let sub: string | null = null;
    if (p.type === 'buff_ac') sub = 'ac';
    else if (p.type === 'buff_resist') sub = 'dr';
    else if (p.type === 'buff_attribute') {
      const a = String(p.attribute || '').toLowerCase();
      if (['str','dex','con','int','wis','cha'].includes(a)) sub = a;
    }
    if (!sub) continue;

    const effectType = `item_buff:${sub}`;
    const active = (memberBuffActive[wearerId] ??= new Set());
    if (active.has(effectType)) continue; // ignore while active

    const durSec = Math.max(5, Math.min(600, Math.round(p.duration_sec || 30)));
    const magnitude = sub === 'dr'
      ? Math.max(1, Math.min(95, Math.round((p.value || 0) * 100)))
      : Math.max(1, Math.round(p.value || 0));

    activeEffects.push({
      id: crypto.randomUUID(),
      node_id: combatNodeId,
      target_id: wearerId,
      source_id: wearerId,
      session_id: null,
      effect_type: effectType,
      stacks: magnitude,
      damage_per_tick: 0,
      next_tick_at: nowMs + durSec * 1000,
      expires_at: nowMs + durSec * 1000,
      tick_rate_ms: 2000,
    });
    active.add(effectType);

    const suffix = sub === 'dr'
      ? `${magnitude}% DR, ${durSec}s`
      : sub === 'ac'
        ? `+${magnitude} AC, ${durSec}s`
        : `+${magnitude} ${sub.toUpperCase()}, ${durSec}s`;
    const interpolated = String(p.text || 'is empowered')
      .replace(/%a/g, wearerName)
      .replace(/%v/g, String(magnitude));
    events.push({
      type: 'buff_proc',
      message: `${wearerName} — ${interpolated} (${suffix})`,
      character_id: wearerId,
    });
  }
}
