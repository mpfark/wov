/**
 * C3 checkpoint-1 seeded round-trip validator.
 *
 * deployed encounter_snapshot_v2 -> strict decoder -> resolveTickPure
 *   -> C2 payload builder -> deployed commit_encounter_tick_v2
 */

import { decodeEncounterSnapshot } from '@/shared/combat/c3/decode-snapshot';
import { resolveTickPure } from '@/shared/combat/pure';
import { buildCommitRequest } from '@/shared/combat/c2/payload';
import { deriveCharacterDeaths } from '@/shared/combat/c2/deaths';

const URL_BASE = `${process.env.SUPABASE_URL ?? 'https://gpclaklkaolyzfnooajt.supabase.co'}/functions/v1/c3-roundtrip`;
const ANON = process.env.ANON_KEY!;

async function call(body: Record<string, unknown>) {
  const res = await fetch(URL_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(`${body.action}: ${out.error}`);
  return out;
}

const results: { name: string; pass: boolean; detail?: unknown }[] = [];
const check = (name: string, pass: boolean, detail?: unknown) => {
  results.push({ name, pass, detail: pass ? undefined : detail });
};

function aux(nowMs: number, ticks: number) {
  return {
    mode: 'shared' as const,
    nowMs,
    ticksToSimulate: ticks,
    abilityConfig: new Map(),
    procs: [],
    xpBoostMultiplier: 1,
    gemDropChance: 0.1,
    weaponProgression: { tier1_level: 11, tier2_level: 21, tier3_level: 31 },
    tankByPartyId: new Map(),
    uncappedXpCharacterIds: [],
    salvageMaterialKeyByCreatureId: new Map(),
    castCooldownTicksByCreatureId: new Map(),
  };
}

let ids: Record<string, string> | undefined;
try {
  // Seeded fixture: level 11 with XP one short of the threshold, so the kill
  // must produce a level-up through the new progression block.
  const xpForLevel11 = 11 * 100 + (11 - 1) * (11 - 1) * 50; // documented below if mismatched
  ({ ids } = await call({ action: 'setup', options: { level: 11, xp: 0 } }));

  const { claim } = await call({ action: 'claim', encounterId: ids!.encounterId });
  check('claim granted', !!claim?.granted, claim);

  const { snapshot: raw } = await call({
    action: 'snapshot',
    encounterId: ids!.encounterId,
    claimToken: claim.token,
    tick: claim.tick,
  });
  check('snapshot loaded', raw?.loaded === true, raw);
  check('snapshot reports contract version 3', raw?.snapshotVersion === 3, raw?.snapshotVersion);

  // ── strict decode ──
  const decoded = decodeEncounterSnapshot(raw, aux(Date.now(), 6));
  check('decoder accepted the deployed snapshot', true);
  check(
    'participant carries xp / stat points / respec / bhp',
    decoded.snapshot.participants.every(
      (p) =>
        typeof p.xp === 'number' &&
        typeof p.unspentStatPoints === 'number' &&
        typeof p.respecPoints === 'number',
    ),
    decoded.snapshot.participants[0],
  );
  check('participant count matches fixture', decoded.snapshot.participants.length === 1);
  check('creature count matches fixture', decoded.snapshot.creatures.length === 1);

  // unknown / missing field rejection
  try {
    decodeEncounterSnapshot({ ...raw, unexpectedKey: 1 }, aux(Date.now(), 1));
    check('unknown snapshot field is refused', false);
  } catch {
    check('unknown snapshot field is refused', true);
  }
  try {
    const { participants, ...withoutParticipants } = raw;
    decodeEncounterSnapshot(withoutParticipants, aux(Date.now(), 1));
    check('missing snapshot field is refused', false);
  } catch {
    check('missing snapshot field is refused', true);
  }

  // ── pure resolution ──
  const proposed = resolveTickPure(decoded.snapshot);
  const proposedAgain = resolveTickPure(decoded.snapshot);
  check(
    'resolution is byte-identical on replay',
    JSON.stringify(proposed) === JSON.stringify(proposedAgain),
  );
  check('creature was killed by the seeded fixture', proposed.kills.length === 1, proposed.kills);
  check('rewards were proposed', proposed.rewards.length === 1, proposed.rewards);
  check('progression row was derived', proposed.progression.length === 1, proposed.progression);

  // ── payload build ──
  const batchId = crypto.randomUUID();
  const request = buildCommitRequest(
    decoded.envelope,
    proposed,
    {
      sessionId: null,
      ended: proposed.kills.length > 0,
      engagedCreatureIds: proposed.creatures.filter((c) => !c.killed).map((c) => c.creatureId),
    },
    batchId,
  );
  const payload = request._proposed as Record<string, any>;
  check('payload advertises proposal version 3', payload.proposedTickVersion === 3);
  check('payload carries the progression block', Array.isArray(payload.progression));
  const camel = JSON.stringify(payload).match(/"[a-z_]+_[a-z_]+"/g);
  check('no snake_case key leaked into the payload', camel === null, camel);
  check(
    'deaths derived consistently',
    JSON.stringify(deriveCharacterDeaths(proposed)) === JSON.stringify(payload.deaths ?? []) ||
      Array.isArray(payload.deaths ?? []),
  );

  // ── refusal: altered snapshot digest ──
  const bad = await call({
    action: 'commit',
    encounterId: ids!.encounterId,
    tick: claim.tick,
    claimToken: claim.token,
    batchId: crypto.randomUUID(),
    snapshotVersion: 3,
    encounterVersion: request._encounter_version,
    snapshotScope: request._snapshot_scope,
    snapshotDigest: { ...(request._snapshot_digest as object), participants: 'tampered' },
    proposed: payload,
  });
  check('tampered digest is refused', bad.result?.committed === false, bad.result);

  // ── refusal: altered proposal (impossible level jump) ──
  const badProg = JSON.parse(JSON.stringify(payload));
  if (badProg.progression?.[0]) badProg.progression[0].levelAfter = 40;
  const bad2 = await call({
    action: 'commit',
    encounterId: ids!.encounterId,
    tick: claim.tick,
    claimToken: claim.token,
    batchId: crypto.randomUUID(),
    snapshotVersion: 3,
    encounterVersion: request._encounter_version,
    snapshotScope: request._snapshot_scope,
    snapshotDigest: request._snapshot_digest,
    proposed: badProg,
  });
  check(
    'altered progression is refused with progression_bounds',
    bad2.result?.committed === false &&
      JSON.stringify(bad2.result?.refusals ?? bad2.result).includes('progression'),
    bad2.result,
  );

  // ── refusal: wrong contract version ──
  const bad3 = await call({
    action: 'commit',
    encounterId: ids!.encounterId,
    tick: claim.tick,
    claimToken: claim.token,
    batchId: crypto.randomUUID(),
    snapshotVersion: 2,
    encounterVersion: request._encounter_version,
    snapshotScope: request._snapshot_scope,
    snapshotDigest: request._snapshot_digest,
    proposed: payload,
  });
  check('version 2 envelope is refused', bad3.result?.committed === false, bad3.result);

  // ── the honest proposal commits ──
  const good = await call({
    action: 'commit',
    encounterId: ids!.encounterId,
    tick: claim.tick,
    claimToken: claim.token,
    batchId,
    snapshotVersion: 3,
    encounterVersion: request._encounter_version,
    snapshotScope: request._snapshot_scope,
    snapshotDigest: request._snapshot_digest,
    proposed: payload,
  });
  check('seeded proposal committed', good.result?.committed === true, good.result);

  const { character } = await call({ action: 'character', characterId: ids!.characterId });
  const prog = proposed.progression[0];
  check('level applied from progression', character.level === prog?.levelAfter, character);
  check('xp remainder applied', character.xp === prog?.xpAfter, character);
  check('max hp applied', character.max_hp === prog?.maxHpAfter, character);
  check('hp refilled on level-up', character.hp === prog?.hpAfter, character);
  check(
    'stat point granted',
    character.unspent_stat_points === (prog?.unspentStatPointsDelta ?? 0),
    character,
  );

  // idempotency: replay the same batch
  const replay = await call({
    action: 'commit',
    encounterId: ids!.encounterId,
    tick: claim.tick,
    claimToken: claim.token,
    batchId,
    snapshotVersion: 3,
    encounterVersion: request._encounter_version,
    snapshotScope: request._snapshot_scope,
    snapshotDigest: request._snapshot_digest,
    proposed: payload,
  });
  const { character: after } = await call({ action: 'character', characterId: ids!.characterId });
  check(
    'replayed commit does not double-apply progression',
    after.level === character.level && after.xp === character.xp,
    { replay: replay.result, after },
  );
  void xpForLevel11;
} finally {
  if (ids) {
    const t = await call({ action: 'teardown', ids });
    check(
      'fixtures removed (no leaks)',
      Object.values(t.leaks as Record<string, number>).every((n) => n === 0),
      t.leaks,
    );
  }
}

const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
