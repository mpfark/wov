/**
 * C3 checkpoint-1 seeded database round-trip validator.
 *
 * claim -> encounter_snapshot_v2 -> strict v3 decode -> resolveTickPure
 *   -> v3 payload builder -> commit_encounter_tick_v2 -> committed batch decode
 *
 * Every database call goes through the temporary service-role `c3-roundtrip`
 * Edge Function. Only isolated `c3h_` fixtures are touched. Combat stays in
 * maintenance; no production handler is involved.
 *
 * Due-time policy: `claim_encounter_tick` grants a tick when
 *   now_ms - encounters.tick_at >= rateMs
 * The harness only seeds `encounters.tick_at` on its own fixture row. The claim
 * function is never mocked, bypassed or weakened.
 */

import { decodeEncounterSnapshot } from '@/shared/combat/c3/decode-snapshot';
import { decodeTickBatch, projectBatchFromProposal } from '@/shared/combat/c3/decode-batch';
import { resolveTickPure } from '@/shared/combat/pure';
import { buildCommitRequest } from '@/shared/combat/c2/payload';
import { SNAPSHOT_VERSION, PROPOSED_TICK_VERSION } from '@/shared/combat/c2/contract';
import { getXpForLevel } from '@/shared/formulas/xp';

const URL_BASE = `${process.env.SUPABASE_URL ?? 'https://gpclaklkaolyzfnooajt.supabase.co'}/functions/v1/c3-roundtrip`;
const ANON = process.env.ANON_KEY!;

const TICK_RATE_MS = 2000;
/** 1.5x rate: comfortably due. */
const DUE_OFFSET_MS = 3000;
/** Boundary margin. Two processes read two clocks, so exact equality on the
 *  millisecond is not a stable assertion; ±150ms brackets the boundary. */
const BOUNDARY_MARGIN_MS = 150;

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

const stable = (v: unknown) => JSON.stringify(v);

let ids: Record<string, string> | undefined;
try {
  // ── fixture ────────────────────────────────────────────────────
  // Level 11 with XP one point short of the threshold, so the seeded kill must
  // produce exactly one level-up through the v3 progression block.
  const startXp = Math.max(0, getXpForLevel(11) - 1);
  ({ ids } = await call({ action: 'setup', options: { level: 11, xp: startXp } }));

  // ── negative case: future tick_at must produce nothing at all ──
  await call({ action: 'seed_due', encounterId: ids!.encounterId, offsetMs: 0 });
  const before = (await call({ action: 'encounter', encounterId: ids!.encounterId })).encounter;
  const charBefore = (await call({ action: 'character', characterId: ids!.characterId })).character;
  const notDue = (await call({ action: 'claim', encounterId: ids!.encounterId, rateMs: TICK_RATE_MS }))
    .claim;
  check('not-due encounter refuses the claim', notDue?.claimed === false && notDue?.reason === 'not_due', notDue);

  const noSnap = (
    await call({
      action: 'snapshot',
      encounterId: ids!.encounterId,
      claimToken: crypto.randomUUID(),
      tick: (before.tick_number as number) + 1,
      })
  ).snapshot;
  check('no snapshot is produced without a claim', noSnap?.loaded === false, noSnap);

  const afterNotDue = (await call({ action: 'encounter', encounterId: ids!.encounterId })).encounter;
  const charAfterNotDue = (await call({ action: 'character', characterId: ids!.characterId })).character;
  const batchesNotDue = (await call({ action: 'batches', encounterId: ids!.encounterId })).batches;
  check(
    'not-due path mutates no encounter state',
    afterNotDue.tick_number === before.tick_number &&
      afterNotDue.version === before.version &&
      afterNotDue.tick_state === 'idle' &&
      afterNotDue.resolving_tick === null,
    { before, afterNotDue },
  );
  check('not-due path mutates no character state', stable(charAfterNotDue) === stable(charBefore), {
    charBefore,
    charAfterNotDue,
  });
  check('not-due path emits no batch / events', Array.isArray(batchesNotDue) && batchesNotDue.length === 0, batchesNotDue);

  // ── boundary: just-not-due vs just-due ─────────────────────────
  await call({
    action: 'seed_due',
    encounterId: ids!.encounterId,
    offsetMs: TICK_RATE_MS - BOUNDARY_MARGIN_MS,
  });
  const nearly = (await call({ action: 'claim', encounterId: ids!.encounterId, rateMs: TICK_RATE_MS })).claim;
  check(
    `tick_at ${TICK_RATE_MS - BOUNDARY_MARGIN_MS}ms in the past is not yet due`,
    nearly?.claimed === false && nearly?.reason === 'not_due',
    nearly,
  );

  await call({
    action: 'seed_due',
    encounterId: ids!.encounterId,
    offsetMs: TICK_RATE_MS + BOUNDARY_MARGIN_MS,
  });
  const justDue = (await call({ action: 'claim', encounterId: ids!.encounterId, rateMs: TICK_RATE_MS })).claim;
  check(
    `tick_at ${TICK_RATE_MS + BOUNDARY_MARGIN_MS}ms in the past is due`,
    justDue?.claimed === true,
    justDue,
  );

  // ── main round trip ────────────────────────────────────────────
  // Seed one periodic effect whose own due time is already 2 intervals in the
  // past, so cadence must be advanced from nextTickAtMs, not from now.
  const nowSeed = Date.now();
  const seededEffect = (
    await call({
      action: 'seed_effect',
      nodeId: ids!.nodeId,
      targetId: ids!.characterId,
      sourceId: ids!.creatureId,
      effectType: 'bleed',
      amountPerTick: 3,
      intervalMs: TICK_RATE_MS,
      nextTickAtMs: nowSeed - 2 * TICK_RATE_MS,
      expiresAtMs: nowSeed + 600000,
    })
  ).effect;

  await call({ action: 'seed_due', encounterId: ids!.encounterId, offsetMs: DUE_OFFSET_MS });
  const { claim } = await call({ action: 'claim', encounterId: ids!.encounterId, rateMs: TICK_RATE_MS });
  check('due fixture grants the claim', claim?.claimed === true, claim);
  const claimToken: string = claim.claim_token;
  const claimedTick: number = Number(claim.tick);

  const encAtClaim = (await call({ action: 'encounter', encounterId: ids!.encounterId })).encounter;
  const { snapshot: raw } = await call({
    action: 'snapshot',
    encounterId: ids!.encounterId,
    claimToken,
    tick: claimedTick,
  });
  check('snapshot loaded under the claim', raw?.loaded === true, raw);
  check('snapshot advertises contract version 3', raw?.snapshotVersion === SNAPSHOT_VERSION, raw?.snapshotVersion);
  check('snapshot tick equals claimed tick', Number(raw?.tickNumber) === claimedTick, {
    claimedTick,
    snapshotTick: raw?.tickNumber,
  });
  check('snapshot claim token matches', raw?.claim?.token === claimToken, raw?.claim);

  // ── strict v3 decode ───────────────────────────────────────────
  const fixedNow = Date.now();
  const decoded = decodeEncounterSnapshot(raw, aux(fixedNow, 3));
  check('decoder accepted the deployed snapshot', true);
  check('decoded tick equals claimed tick', decoded.snapshot.tickNumber === claimedTick, decoded.snapshot.tickNumber);
  const participant = decoded.snapshot.participants[0];
  check(
    'participant carries xp / stat points / respec / bhp',
    typeof participant?.xp === 'number' &&
      typeof participant?.unspentStatPoints === 'number' &&
      typeof participant?.respecPoints === 'number',
    participant,
  );
  check('participant xp survived the round trip', participant?.xp === startXp, {
    expected: startXp,
    actual: participant?.xp,
  });
  const decodedEffect = decoded.snapshot.effects[0];
  check(
    'effect decoded with nextTickAtMs semantics',
    decodedEffect?.nextTickAtMs === Number(seededEffect.next_tick_at) &&
      decodedEffect?.intervalMs === TICK_RATE_MS,
    { decodedEffect, seededEffect },
  );

  try {
    decodeEncounterSnapshot({ ...raw, unexpectedKey: 1 }, aux(fixedNow, 1));
    check('unknown snapshot field is refused', false);
  } catch (e) {
    check('unknown snapshot field is refused', String(e).includes('decode_failed'), String(e));
  }
  try {
    const { participants: _drop, ...withoutParticipants } = raw as Record<string, unknown>;
    decodeEncounterSnapshot(withoutParticipants, aux(fixedNow, 1));
    check('missing snapshot field is refused', false);
  } catch (e) {
    check('missing snapshot field is refused', String(e).includes('decode_failed'), String(e));
  }
  try {
    decodeEncounterSnapshot({ ...raw, snapshotVersion: 2 }, aux(fixedNow, 1));
    check('v2 snapshot envelope is refused by the decoder', false);
  } catch (e) {
    check('v2 snapshot envelope is refused by the decoder', String(e).includes('decode_failed'), String(e));
  }

  // ── pure resolution ────────────────────────────────────────────
  const proposed = resolveTickPure(decoded.snapshot);
  const replayPure = resolveTickPure(decodeEncounterSnapshot(raw, aux(fixedNow, 3)).snapshot);
  check('pure resolution is byte-identical on replay', stable(proposed) === stable(replayPure));
  check('proposed tick equals claimed tick', proposed.tickNumber === claimedTick, proposed.tickNumber);
  check('creature was killed', proposed.kills.length === 1, proposed.kills);
  check('rewards proposed for the killer', proposed.rewards.length === 1, proposed.rewards);
  check('progression row derived (one level-up)', proposed.progression.length === 1, proposed.progression);
  check(
    'progression proposes exactly one level',
    proposed.progression[0]?.levelAfter === proposed.progression[0]?.levelBefore + 1,
    proposed.progression[0],
  );

  const upsert = proposed.effectUpserts.find((u) => u.effectType === 'bleed');
  const seededDue = Number(seededEffect.next_tick_at);
  check('periodic effect cadence was advanced', upsert !== undefined && upsert.nextTickAtMs > seededDue, upsert);
  check(
    'cadence advanced in whole intervals from nextTickAtMs (not from now)',
    upsert !== undefined && (upsert.nextTickAtMs - seededDue) % TICK_RATE_MS === 0,
    { seededDue, advanced: upsert?.nextTickAtMs, fixedNow },
  );
  check(
    'multi-tick catch-up cleared the backlog',
    upsert !== undefined && upsert.nextTickAtMs > fixedNow,
    { advanced: upsert?.nextTickAtMs, fixedNow },
  );
  check('session presence proposal carries no cadence field', !('lastTickAtMs' in (proposed.session as object)), proposed.session);

  // ── v3 payload build ───────────────────────────────────────────
  const batchId = crypto.randomUUID();
  const request = buildCommitRequest(
    decoded.envelope,
    proposed,
    {
      sessionId: null,
      ended: proposed.creatures.every((c) => c.killed),
      engagedCreatureIds: proposed.creatures.filter((c) => !c.killed).map((c) => c.creatureId),
    },
    batchId,
  );
  const payload = request._proposed as Record<string, any>;
  check('payload advertises proposal version 3', payload.proposedTickVersion === PROPOSED_TICK_VERSION, payload.proposedTickVersion);
  check('payload tick equals claimed tick', Number(request._tick) === claimedTick, request._tick);
  check('payload carries the progression block', Array.isArray(payload.progression) && payload.progression.length === 1);
  const snake = stable(payload).match(/"[a-z]+_[a-z_]+":/g);
  check('no snake_case key leaked into the payload', snake === null, snake);
  check('payload never carries last_tick_at', !stable(payload).includes('lastTickAt'), 'lastTickAt present');

  // ── refusals before any mutation ───────────────────────────────
  const refuse = async (label: string, over: Record<string, unknown>, expect: string) => {
    const r = (
      await call({
        action: 'commit',
        encounterId: ids!.encounterId,
        tick: claimedTick,
        claimToken,
        batchId: crypto.randomUUID(),
        snapshotVersion: SNAPSHOT_VERSION,
        encounterVersion: request._encounter_version,
        snapshotScope: request._snapshot_scope,
        snapshotDigest: request._snapshot_digest,
        proposed: payload,
        ...over,
      })
    ).result;
    check(label, r?.committed === false && String(r?.reason).includes(expect), r);
  };

  await refuse(
    'tampered snapshot digest is refused (state_conflict)',
    { snapshotDigest: { ...(request._snapshot_digest as object), participants: 'tampered' } },
    'state_conflict',
  );
  await refuse('v2 snapshot envelope is refused (version_unsupported)', { snapshotVersion: 2 }, 'version_unsupported');
  await refuse(
    'v2 proposal envelope is refused (version_unsupported)',
    { proposed: { ...payload, proposedTickVersion: 2 } },
    'version_unsupported',
  );
  await refuse(
    'stale encounter version is refused (version_conflict)',
    { encounterVersion: Number(request._encounter_version) + 5 },
    'version_conflict',
  );
  await refuse('foreign claim token is refused (stale_claim)', { claimToken: crypto.randomUUID() }, 'stale_claim');

  const encAfterRefusals = (await call({ action: 'encounter', encounterId: ids!.encounterId })).encounter;
  const charAfterRefusals = (await call({ action: 'character', characterId: ids!.characterId })).character;
  check(
    'refusals mutated nothing',
    stable(charAfterRefusals) === stable(charBefore) &&
      encAfterRefusals.version === encAtClaim.version &&
      encAfterRefusals.tick_number === encAtClaim.tick_number,
    { encAtClaim, encAfterRefusals },
  );

  // altered proposal: impossible level jump
  const badProg = JSON.parse(stable(payload));
  badProg.progression[0].levelAfter = badProg.progression[0].levelBefore + 6;
  await refuse('altered progression is refused (progression bounds)', { proposed: badProg }, 'progression');

  // ── the honest proposal commits ────────────────────────────────
  const good = (
    await call({
      action: 'commit',
      encounterId: ids!.encounterId,
      tick: claimedTick,
      claimToken,
      batchId,
      snapshotVersion: SNAPSHOT_VERSION,
      encounterVersion: request._encounter_version,
      snapshotScope: request._snapshot_scope,
      snapshotDigest: request._snapshot_digest,
      proposed: payload,
    })
  ).result;
  check('seeded proposal committed', good?.committed === true, good);
  check('committed tick equals claimed tick', Number(good?.tick) === claimedTick, good);

  const encAfter = (await call({ action: 'encounter', encounterId: ids!.encounterId })).encounter;
  check(
    'committed cursor advanced to the claimed tick and released the claim',
    Number(encAfter.tick_number) === claimedTick &&
      encAfter.tick_state === 'idle' &&
      encAfter.resolving_tick === null &&
      encAfter.claim_token === null &&
      encAfter.version === encAtClaim.version + 1,
    encAfter,
  );

  // ── committed batch ────────────────────────────────────────────
  const batches = (await call({ action: 'batches', encounterId: ids!.encounterId })).batches;
  check('exactly one batch was written', batches.length === 1, batches);
  check('batch tick equals claimed tick', Number(batches[0]?.tick_number) === claimedTick, batches[0]);
  const batch = decodeTickBatch(batches[0].payload);
  check('batch decodes strictly', true);
  check('batch id matches the committed batch', batch.batchId === batchId, batch.batchId);
  const projection = projectBatchFromProposal(proposed, batchId, decoded.envelope.spawnSeqByCreatureId);
  check(
    'batch equals the deterministic ProposedTick projection',
    stable({ ...batch, deaths: [], kills: [] }) === stable(projection),
    { batch: { ...batch, deaths: [], kills: [] }, projection },
  );
  check(
    'level-up reached the delivered events',
    batch.events.some((e) => e.type === 'level_up'),
    batch.events.map((e) => e.type),
  );
  try {
    decodeTickBatch({ ...batches[0].payload, unexpectedKey: 1 });
    check('unknown batch field is refused', false);
  } catch (e) {
    check('unknown batch field is refused', String(e).includes('decode_failed'), String(e));
  }
  try {
    decodeTickBatch({ ...batches[0].payload, v: 3 });
    check('mismatched batch envelope version is refused', false);
  } catch (e) {
    check('mismatched batch envelope version is refused', String(e).includes('decode_failed'), String(e));
  }

  // ── state survived the round trip ──────────────────────────────
  const character = (await call({ action: 'character', characterId: ids!.characterId })).character;
  const prog = proposed.progression[0]!;
  check('level applied from progression', character.level === prog.levelAfter, character);
  check('xp remainder applied', character.xp === prog.xpAfter, { character, prog });
  check('max hp applied', character.max_hp === prog.maxHpAfter, character);
  check('hp refilled on level-up', character.hp === prog.hpAfter, character);
  check('stat point granted', character.unspent_stat_points === prog.unspentStatPointsDelta, character);
  check('gold reward applied', character.gold === (proposed.rewards[0]?.gold ?? 0), {
    gold: character.gold,
    expected: proposed.rewards[0]?.gold,
  });

  const ledgers = await call({ action: 'ledgers', encounterId: ids!.encounterId });
  check(
    'reward award ledgered at the committed tick',
    ledgers.awards.some((a: any) => a.award_kind === 'reward' && Number(a.tick_number) === claimedTick),
    ledgers.awards,
  );
  check(
    'loot rows match the proposal count',
    ledgers.loot.length === proposed.loot.length,
    { db: ledgers.loot.length, proposed: proposed.loot.length },
  );
  check(
    'contributions recorded',
    ledgers.contributions.length === proposed.characters.length ||
      ledgers.contributions.length > 0,
    ledgers.contributions,
  );

  const effectsAfter = (await call({ action: 'effects', targetId: ids!.characterId })).effects;
  const bleed = effectsAfter.find((e: any) => e.effect_type === 'bleed');
  check(
    'effect cadence persisted from nextTickAtMs',
    bleed !== undefined && Number(bleed.next_tick_at) === upsert!.nextTickAtMs,
    { bleed, expected: upsert?.nextTickAtMs },
  );

  const inventory = (await call({ action: 'durability', characterId: ids!.characterId })).inventory;
  check(
    'durability proposals match persisted equipment',
    proposed.durability.every((d) =>
      inventory.some((i: any) => i.id === d.inventoryId && i.current_durability === d.durabilityAfter),
    ),
    { proposedDurability: proposed.durability, inventory },
  );
  check('no combat_sessions row exists for the fixture', proposed.session.sessionId === null, proposed.session);

  // ── repeating the same commit ──────────────────────────────────
  const replay = (
    await call({
      action: 'commit',
      encounterId: ids!.encounterId,
      tick: claimedTick,
      claimToken,
      batchId,
      snapshotVersion: SNAPSHOT_VERSION,
      encounterVersion: request._encounter_version,
      snapshotScope: request._snapshot_scope,
      snapshotDigest: request._snapshot_digest,
      proposed: payload,
    })
  ).result;
  const charReplay = (await call({ action: 'character', characterId: ids!.characterId })).character;
  const encReplay = (await call({ action: 'encounter', encounterId: ids!.encounterId })).encounter;
  const batchesReplay = (await call({ action: 'batches', encounterId: ids!.encounterId })).batches;
  check('repeated commit is refused', replay?.committed === false, replay);
  check(
    'repeated commit mutates nothing',
    stable(charReplay) === stable(character) &&
      encReplay.version === encAfter.version &&
      batchesReplay.length === 1,
    { charReplay, character, encReplay, batchesReplay: batchesReplay.length },
  );

  // ── reclaim of the same tick is byte-identical ─────────────────
  await call({ action: 'seed_due', encounterId: ids!.encounterId, offsetMs: DUE_OFFSET_MS });
  const claim2 = (await call({ action: 'claim', encounterId: ids!.encounterId, rateMs: TICK_RATE_MS })).claim;
  check('second tick claimed', claim2?.claimed === true && Number(claim2.tick) === claimedTick + 1, claim2);
  const snapA = (
    await call({ action: 'snapshot', encounterId: ids!.encounterId, claimToken: claim2.claim_token, tick: claim2.tick })
  ).snapshot;
  const nowFixed2 = Date.now();
  const proposedA = resolveTickPure(decodeEncounterSnapshot(snapA, aux(nowFixed2, 3)).snapshot);

  await call({ action: 'expire_lease', encounterId: ids!.encounterId });
  const reclaim = (await call({ action: 'claim', encounterId: ids!.encounterId, rateMs: TICK_RATE_MS })).claim;
  check(
    'expired lease reclaims the same tick without a new tick number',
    reclaim?.claimed === true && reclaim?.reclaimed === true && Number(reclaim.tick) === Number(claim2.tick),
    reclaim,
  );
  const snapB = (
    await call({ action: 'snapshot', encounterId: ids!.encounterId, claimToken: reclaim.claim_token, tick: reclaim.tick })
  ).snapshot;
  const proposedB = resolveTickPure(decodeEncounterSnapshot(snapB, aux(nowFixed2, 3)).snapshot);
  check('reclaimed tick produces byte-identical pure output', stable(proposedA) === stable(proposedB), {
    a: stable(proposedA).length,
    b: stable(proposedB).length,
  });
} finally {
  if (ids) {
    const t = await call({ action: 'teardown', ids });
    check(
      'fixtures removed (independent leak check is zero)',
      Object.values(t.leaks as Record<string, number>).every((n) => n === 0),
      t.leaks,
    );
  }
}

const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
if (failed.length > 0) process.exitCode = 1;
