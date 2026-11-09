/**
 * Test-only model of the commit step: folds a ProposedTick back into the next
 * NodeSnapshot so multi-round fights can be recorded. Mirrors what the hosted
 * commit persists for the fields the resolver reads; it is the reference the
 * future single commit function must agree with.
 */
import type { NodeSnapshot, ProposedTick, SnapshotEffect } from '../types';

export function applyTick(prev: NodeSnapshot, out: ProposedTick, intents: NodeSnapshot['intents'] = []): NodeSnapshot {
  const next: NodeSnapshot = structuredClone(prev);
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
      if (c[k] !== undefined) (cr as Record<string, unknown>)[k] = c[k];
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
  next.intents = intents;
  return next;
}
