/**
 * WoV engine entry point (modernization phase 2).
 *
 * One pure function family: `(state, commands) -> (proposal, nextState)`.
 * Rules live in the Combat2 resolver; this module adds the commit fold so a
 * whole fight can run in TypeScript without the database. Workers switch by
 * calling `step` instead of `resolveNodeTick`; behaviour is identical and
 * guarded by the golden master.
 */
import { resolveNodeTick, type ResolveDeps } from './resolver.ts';
import type { NodeSnapshot, ProposedTick, SnapshotEffect } from './types.ts';

export const ENGINE_VERSION = 'wov-engine-1';

export type EngineState = NodeSnapshot;
export type EngineCommand = NodeSnapshot['intents'][number];
export type EngineDeps = ResolveDeps;

export interface StepResult {
  proposal: ProposedTick;
  next: EngineState;
}

/** Resolve one 2-second round. Pure: never mutates `state`. */
export function step(state: EngineState, deps: EngineDeps): ProposedTick {
  return resolveNodeTick(state, deps);
}

/** Fold a proposal into the next state, as the atomic commit persists it. */
export function applyTick(prev: EngineState, out: ProposedTick, commands: EngineCommand[] = []): EngineState {
  const next: EngineState = structuredClone(prev);
  for (const c of out.characters) {
    const f = next.fighters.find(x => x.character_id === c.id);
    if (!f) continue;
    if (c.hp !== undefined) f.hp = c.hp;
    if (c.cp !== undefined) f.cp = c.cp;
    if (c.mp !== undefined) f.mp = c.mp;
  }
  for (const c of out.creatures) {
    const cr = next.creatures.find(x => x.id === c.id);
    if (!cr) continue;
    for (const k of ['hp', 'is_alive', 'engaged', 'pending_action', 'tank_fighter_id'] as const) {
      if (c[k] !== undefined) (cr as unknown as Record<string, unknown>)[k] = c[k];
    }
  }
  const dead = new Set(out.effects_delete);
  next.effects = next.effects.filter(e => !dead.has(e.id));
  for (const u of out.effects_update) {
    const e = next.effects.find(x => x.id === u.id);
    if (e) Object.assign(e, Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)));
  }
  out.effects_insert.forEach((ins, i) => {
    next.effects.push({ id: `e-${out.tick}-${i}`, ability_key: null, target_character_id: null,
      target_creature_id: null, source_character_id: null, source_creature_id: null, stacks: 1,
      magnitude: null, config: {}, expires_at: null, next_due_at: null, interval_ms: null,
      last_pulse_tick: null, is_reservation: false, ...ins } as SnapshotEffect);
  });
  next.encounter = { ...next.encounter, tick: out.tick, candidate_tick: out.tick + 1,
    state_version: next.encounter.state_version + 1,
    now: new Date(Date.parse(next.encounter.now) + 2000).toISOString() };
  next.intents = commands;
  return next;
}

/** Resolve one round and produce the next state. */
export function advance(state: EngineState, deps: EngineDeps, nextCommands: EngineCommand[] = []): StepResult {
  const proposal = step(state, deps);
  return { proposal, next: applyTick(state, proposal, nextCommands) };
}
