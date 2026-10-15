import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialize, parseRate, settle, transition, fraction, blockers, activeAttachment,
  editRate, captureClaim, applyCombatResult, observeOrdinaryRespawn } from './legacy-001g4a4-creature-regen.mjs';

const fresh = (over = {}) => initialize({ hp: 1n, maxHp: 100n, ...over });
const facts = (over = {}) => ({ encounterStatus: null, projection: null,
  fighters: [], effects: [], pendingIntents: [], pendingEvents: [], ...over });
const projection = (over = {}) => ({ id: 'projection', creature_id: 'fixture', spawn_seq: 1n,
  engaged: false, pending_action: null, ...over });
const member = { present: true, hp: 10, character_id: 'char', id: 'fighter', entry_seq: 2 };
const hpCredit = s => [s.hp, s.credit, s.through, s.eligibleSince];

test('approved default 5% and exact custom decimal', () => {
  assert.equal(settle(fresh(), 120_000n).hp, 6n);
  const s = settle(fresh({ rate: '2.125', maxHp: 80n }), 120_000n);
  assert.equal(s.hp, 2n); assert.deepEqual(s.credit, fraction(7n, 10n));
  assert.deepEqual(parseRate('0.000000000000001'), fraction(1n, 1_000_000_000_000_000n));
});
test('0% disables healing; 100% accepted, cap enforced', () => {
  assert.equal(settle(fresh({ rate: '0' }), 10_000_000n).hp, 1n);
  assert.equal(settle(fresh({ rate: '100' }), 120_000n).hp, 100n);
});
test('invalid rate syntax and range refuse without rounding', () => {
  for (const input of ['-1', '100.00001', 'NaN', 'Infinity', '1e1', '.5', '5.', '', ' 5', 5]) {
    assert.throws(() => parseRate(input));
  }
  assert.deepEqual(parseRate('5.000'), parseRate('5'));
});
test('60 seconds delay: before, exactly at and one millisecond after', () => {
  const s = fresh();
  assert.equal(settle(s, 59_999n).hp, 1n);
  assert.deepEqual(settle(s, 60_000n).credit, fraction(0n));
  assert.deepEqual(settle(s, 60_001n).credit, fraction(1n, 12_000n));
});
test('fractional HP persists across short settlements', () => {
  let s = fresh({ maxHp: 23n });
  s = settle(s, 90_000n);
  assert.deepEqual(s.credit, fraction(23n, 40n));
  s = settle(s, 120_000n);
  assert.equal(s.hp, 2n); assert.deepEqual(s.credit, fraction(3n, 20n));
});
test('partition invariance over multiple rates, caps, and deterministic irregular partitions', () => {
  for (const rate of ['0', '5', '1.23456789', '33.333', '100']) {
    for (const maxHp of [2n, 23n, 100n, 100_003n]) {
      const original = fresh({ maxHp, rate });
      let segmented = original;
      let t = 0n;
      for (let i = 1; t < 1_000_000n; i++) {
        t += BigInt((i * 7919) % 17_003 + 1);
        if (t > 1_000_000n) t = 1_000_000n;
        segmented = settle(segmented, t);
      }
      assert.deepEqual(hpCredit(segmented), hpCredit(settle(original, t)));
    }
  }
});
test('same timestamp replay returns identical state', () => {
  const s = settle(fresh(), 80_000n);
  assert.strictEqual(settle(s, 80_000n), s);
});
test('combat re-entry resets 60 second delay; earned fraction retained as explicit proposal', () => {
  let s = transition(fresh(), 66_000n, true);
  assert.deepEqual(s.credit, fraction(1n, 2n));
  s = transition(s, 500_000n, false);
  assert.equal(settle(s, 560_000n).hp, 1n);
  assert.equal(settle(s, 566_000n).hp, 2n);
});
test('repeated blocker observation does not restart eligibility after canonical release', () => {
  let s = transition(fresh(), 0n, true);
  s = transition(s, 100_000n, false);
  s = transition(s, 110_000n, false);
  assert.equal(s.eligibleSince, 100_000n);
  assert.equal(settle(s, 220_000n).hp, 6n);
});
test('current engagement requires active attachment and living present fighters', () => {
  const s = fresh(); const f = facts({ encounterStatus: 'active',
    projection: projection({ engaged: true }), fighters: [member] });
  assert(blockers(s, f).includes('engaged_with_present_fighters'));
  assert.deepEqual(blockers(s, { ...f, fighters: [{ ...member, present: false }] }), []);
});
test('empty active and retained ended projections do not permanently block OOC', () => {
  for (const encounterStatus of ['active', 'ended']) {
    assert.deepEqual(blockers(fresh(), facts({ encounterStatus,
      projection: projection({ engaged: true }) })), []);
  }
});
test('active attachment still refuses configuration in an empty quiet encounter', () => {
  const s = fresh(); const f = facts({ encounterStatus: 'active', projection: projection() });
  assert(activeAttachment(s, f));
  assert.throws(() => editRate(s, 60_000n, '2', f), /attachment refused/);
});
test('unresolved DoT blocks even without fighters and despite wall-clock expiry', () => {
  const f = facts({ projection: projection(), effects: [{ kind: 'dot', target_creature_id: 'fixture',
    expires_at: '1970-01-01T00:00:00Z', config: { node_creature_id: 'projection', spawn_seq: 1n } }] });
  assert.deepEqual(blockers(fresh(), f), ['unresolved_effect']);
});
test('stale generation DoT does not address the current spawn; legacy unfenced effect blocks', () => {
  const s = fresh(); const effect = { kind: 'dot', target_creature_id: 'fixture',
    config: { node_creature_id: 'old', spawn_seq: 0n } };
  assert.deepEqual(blockers(s, facts({ projection: projection(), effects: [effect] })), []);
  assert.deepEqual(blockers(s, facts({ effects: [{ ...effect, config: {} }] })), ['unresolved_effect']);
});
test('presence-fenced aura is relevant even when persistent and reservation flagged', () => {
  const aura = { kind: 'aura', source_character_id: 'char', is_reservation: true,
    config: { persistent_stance: true, source_fighter_id: 'fighter', source_entry_seq: 2 } };
  assert.deepEqual(blockers(fresh(), facts({ fighters: [member], effects: [aura] })), ['unresolved_effect']);
  assert.deepEqual(blockers(fresh(), facts({ effects: [aura] })), []);
});
test('unrelated permanent stance does not block an empty encounter', () => {
  assert.deepEqual(blockers(fresh(), facts({ effects: [{ kind: 'offense',
    target_character_id: 'char', is_reservation: true, config: { persistent_stance: true } }] })), []);
});
test('pending creature action blocks even ended attachment until canonically resolved', () => {
  const f = facts({ encounterStatus: 'ended', projection: projection({ pending_action: { resolve_at_tick: 1 } }) });
  assert.deepEqual(blockers(fresh(), f), ['pending_creature_action']);
  assert.deepEqual(blockers(fresh(), { ...f, projection: projection() }), []);
});
test('pending intents/events and unknown applicability fail closed', () => {
  assert.deepEqual(blockers(fresh(), facts({ projection: projection(), pendingIntents: [{ id: 'intent' }],
    pendingEvents: [{ event_type: 'fighter_entered' }], uncertain: true })),
  ['requires_evidence', 'pending_intent', 'pending_event']);
});
test('source-shaped DoT and pending cast observations drive blocking and canonical release', () => {
  for (const observation of [
    facts({ projection: projection(), effects: [{ kind: 'dot', target_creature_id: 'fixture', config: {} }] }),
    facts({ projection: projection({ pending_action: { resolve_at_tick: 5 } }) }),
  ]) {
    let s = fresh();
    s = transition(s, 0n, blockers(s, observation).length > 0);
    s = settle(s, 1_000_000n);
    assert.equal(s.hp, 1n);
    const resolved = facts({ encounterStatus: 'ended', projection: projection() });
    s = transition(s, 1_000_000n, blockers(s, resolved).length > 0);
    assert.equal(settle(s, 1_060_000n).hp, 1n);
    assert.equal(settle(s, 1_120_000n).hp, 6n);
  }
});
test('eligible sleep and equivalent awake partitions produce identical HP/credit', () => {
  const s = fresh({ maxHp: 1000n, rate: '0.125' });
  const awake = [60_000n, 100_000n, 300_000n, 600_000n].reduce((x, t) => settle(x, t), s);
  assert.deepEqual(hpCredit(awake), hpCredit(settle(s, 600_000n)));
});
test('sleep with unresolved blockers earns nothing; release starts new delay', () => {
  let s = fresh({ blocked: true });
  s = settle(s, 86_400_000n);
  assert.equal(s.hp, 1n);
  s = transition(s, 86_400_000n, false);
  assert.equal(settle(s, 86_460_000n).hp, 1n);
  assert.equal(settle(s, 86_520_000n).hp, 6n);
});
test('initial wounded creature gets default, no historical credit and full new delay', () => {
  const s = fresh({ at: 1_000_000n, hp: 43n });
  assert.deepEqual(s.rate, parseRate('5'));
  assert.equal(settle(s, 1_060_000n).hp, 43n);
  assert.equal(settle(s, 1_120_000n).hp, 48n);
});
test('repeated wake and retries do not duplicate settlement', () => {
  let s = settle(fresh(), 120_000n);
  for (let i = 0; i < 10; i++) s = settle(s, 120_000n);
  assert.equal(s.hp, 6n);
});
test('full cap discards excess and fractional credit; later wounds have no banked healing', () => {
  let s = settle(fresh({ hp: 99n }), 1_000_000n);
  assert.equal(s.hp, 100n); assert.deepEqual(s.credit, fraction(0n));
  s = applyCombatResult(s, captureClaim(s), 50n, 1_000_000n);
  s = transition(s, 1_000_000n, false);
  assert.equal(settle(s, 1_060_000n).hp, 50n);
});
test('dead creature cannot regenerate or revive; ordinary respawn is separate/new generation', () => {
  let s = fresh({ hp: 0n, alive: false, rate: '0' });
  s = settle(s, 86_400_000n); assert.equal(s.hp, 0n);
  assert.throws(() => observeOrdinaryRespawn(s, s.through, 1n));
  s = observeOrdinaryRespawn(s, s.through, 2n);
  assert.equal(s.hp, 100n); assert.equal(s.generation, 2n);
  assert.deepEqual(s.credit, fraction(0n)); assert.deepEqual(s.rate, parseRate('0'));
});
test('inactive rate edit settles old rate then preserves exact accrued fractional HP', () => {
  let s = editRate(fresh(), 66_000n, '2.5', facts({ encounterStatus: 'ended', projection: projection() }));
  assert.deepEqual(s.credit, fraction(1n, 2n));
  s = settle(s, 78_000n); assert.equal(s.hp, 2n);
});
test('disable/enable accounts zero interval without retroactive new-rate credit', () => {
  let s = editRate(fresh(), 66_000n, '0', facts());
  s = editRate(s, 1_000_000n, '5', facts());
  assert.equal(s.hp, 1n); assert.deepEqual(s.credit, fraction(1n, 2n));
  assert.equal(settle(s, 1_006_000n).hp, 2n);
});
test('invalid/refused edit leaves all original modeled state intact', () => {
  const s = fresh(); const original = structuredClone(s);
  assert.throws(() => editRate(s, 120_000n, '101', facts()));
  assert.throws(() => editRate(s, 120_000n, '5', facts({ uncertain: true })));
  assert.deepEqual(s, original);
});
test('maintenance defers a live claim without moving cursor; later settlement catches up once', () => {
  const s = fresh(); assert.strictEqual(settle(s, 120_000n, { liveClaim: true }), s);
  assert.equal(settle(s, 120_000n).hp, 6n);
});
test('modeled interleaving: regen first invalidates old claim, preserving newer HP', () => {
  const s = fresh(); const old = captureClaim(s); const healed = settle(s, 120_000n);
  assert.throws(() => applyCombatResult(healed, old, 1n, 120_000n), /stale claim/);
  assert.equal(healed.hp, 6n); assert.equal(healed.projectionHp, 6n);
});
test('modeled interleaving: combat first rejects stale accounting plan; re-read sees blocked state', () => {
  const s = fresh(); const claim = captureClaim(s);
  const damage = applyCombatResult(s, claim, 1n, 1000n);
  assert.throws(() => settle(damage, 120_000n, { expectedVersion: s.version }), /stale/);
  assert.equal(settle(damage, 120_000n).hp, 1n);
});
test('accounting-only transition also invalidates a prior claim in this proposed conservative model', () => {
  const s = fresh(); const claim = captureClaim(s); const moved = transition(s, 0n, true);
  assert.throws(() => applyCombatResult(moved, claim, 1n, 0n), /stale claim/);
});
test('new generation fences old claim; projection mismatch and backward clocks fail without repair', () => {
  const dead = fresh({ hp: 0n, alive: false }); const claim = captureClaim(dead);
  const respawn = observeOrdinaryRespawn(dead, 100n, 2n);
  assert.throws(() => applyCombatResult(respawn, claim, 1n, 100n));
  assert.throws(() => settle({ ...respawn, projectionHp: 2n }, 200n), /requires evidence/);
  assert.throws(() => settle(respawn, 99n), /nonmonotonic/);
});
test('source anchors: model assumptions remain distinguishable from existing production mechanics', () => {
  const source = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
  const resolver = source('src/shared/combat2/resolver.ts');
  assert(resolver.includes('const effectAppliesToSpawn'));
  assert(resolver.includes('creature.pendingAction.resolve_at_tick > tick'));
  assert(resolver.includes("effect.kind === 'aura'"));
  const commit = source('drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql');
  assert(commit.includes('e.state_version IS DISTINCT FROM _expected_state_version'));
  assert(commit.includes("cr.spawn_seq = (rec->>'spawn_seq')::int"));
});
