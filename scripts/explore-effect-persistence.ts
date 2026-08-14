/**
 * Scratch probe (not part of the suite): show what the second tick looks like
 * with and without a persisted semantic effect, so the persistence goldens
 * assert on real observables rather than guessed ones.
 */
import inventory from '../src/shared/combat/inventory/active-abilities.json';
import { resolveTickPure } from '../src/shared/combat/pure';
import { abilityEncounter, abilityId, type AbilityRow } from '../src/test/combat/c3a/ability-fixtures';
import { commitEffects, decodeRows, nextSnapshot } from '../src/test/combat/effects/roundtrip';

const rows = inventory.abilities as unknown as AbilityRow[];
const target = process.argv[2];

for (const row of rows) {
  if (target && abilityId(row) !== target) continue;
  const snap = abilityEncounter(row);
  const creatureIds = new Set(snap.creatures.map((c) => c.id));
  const out = resolveTickPure(snap);
  const commit = commitEffects([], out, { nodeId: snap.nodeId, creatureIds, nowMs: snap.nowMs });
  const semantic = commit.rows.filter((r) => r.mechanic);
  if (semantic.length === 0) continue;
  const effects = decodeRows(commit.rows, { creatureIds, statusDefs: snap.config.statusDefs });
  const next = nextSnapshot(snap, effects);
  const bare = nextSnapshot(snap, []);
  const a = resolveTickPure(next);
  const b = resolveTickPure(bare);
  console.log('==', abilityId(row), row.mechanic);
  console.log('  rows:', JSON.stringify(semantic.map((r) => ({
    t: r.effect_type, m: r.mechanic, mag: r.magnitude, rem: r.remaining,
    st: r.stacks, dpt: r.damage_per_tick, p: r.params, tgt: r.target_id, src: r.source_id,
  }))));
  console.log('  next chars   :', JSON.stringify(a.characters.map((c) => `${c.characterId} hp ${c.hpBefore}->${c.hpAfter} cp ${c.cpBefore}->${c.cpAfter}`)));
  console.log('  bare  chars  :', JSON.stringify(b.characters.map((c) => `${c.characterId} hp ${c.hpBefore}->${c.hpAfter} cp ${c.cpBefore}->${c.cpAfter}`)));
  console.log('  next crt     :', JSON.stringify(a.creatures.map((c) => `${c.creatureId} ${c.hpBefore}->${c.hpAfter}`)), 'bare', JSON.stringify(b.creatures.map((c) => `${c.creatureId} ${c.hpBefore}->${c.hpAfter}`)));
  console.log('  next upserts :', JSON.stringify(a.effectUpserts.map((e) => ({ t: e.effectType, m: e.mechanic, rem: e.remaining, st: e.stacks, ntk: e.nextTickAtMs - snap.nowMs }))));
  console.log('  next deletes :', a.effectDeleteIds.length, 'events', JSON.stringify([...new Set(a.events.map((e) => e.type))]));
}

// Detail dump for one ability: full event list of the second tick.
if (process.env.DETAIL) {
  const row = rows.find((r) => abilityId(r) === target)!;
  const snap = abilityEncounter(row);
  const creatureIds = new Set(snap.creatures.map((c) => c.id));
  const out = resolveTickPure(snap);
  const commit = commitEffects([], out, { nodeId: snap.nodeId, creatureIds, nowMs: snap.nowMs });
  const effects = decodeRows(commit.rows, { creatureIds, statusDefs: snap.config.statusDefs });
  const next = nextSnapshot(snap, effects);
  console.log('buffs:', JSON.stringify(next.participants.map((p) => [p.id, p.buffs])));
  const a = resolveTickPure(next);
  console.log('events:', JSON.stringify(a.events, null, 1));
  console.log('upserts:', JSON.stringify(a.effectUpserts));
}

if (process.env.DETAIL2) {
  const row = rows.find((r) => abilityId(r) === target)!;
  const snap = abilityEncounter(row);
  const creatureIds = new Set(snap.creatures.map((c) => c.id));
  const out = resolveTickPure(snap);
  const commit = commitEffects([], out, { nodeId: snap.nodeId, creatureIds, nowMs: snap.nowMs });
  const effects = decodeRows(commit.rows, { creatureIds, statusDefs: snap.config.statusDefs });
  const a = resolveTickPure(nextSnapshot(snap, effects));
  for (const u of a.effectUpserts) {
    console.log('nowMs', snap.nowMs, 'expiresAtMs', u.expiresAtMs, 'nextTickAtMs', u.nextTickAtMs, 'interval', u.intervalMs, 'amount', u.amountPerTick);
  }
}
