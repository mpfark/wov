/**
 * TEMPORARY C5 gate-2 probe: stale spawn-generation refusal.
 *
 * Deleted immediately after the probe run. It is authorised only by a one-shot
 * secret held in `public.app_secrets` (`c5_stale_probe_token`), which the probe
 * consumes on first use, and it operates only on its own hardcoded fixture ids.
 * It calls the real `commit_encounter_tick_v2` — no logic is duplicated.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const FIXTURE_CREATURE = "c5aa0000-0000-4000-8000-0000000000f1";
const TOKEN_KEY = "c5_stale_probe_token";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-probe-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ── authorisation: one-shot secret, consumed before anything else ──
  const presented = req.headers.get("x-probe-token") ?? "";
  const { data: secret } = await admin.from("app_secrets").select("value").eq("key", TOKEN_KEY).maybeSingle();
  if (!secret?.value || presented.length < 20 || presented !== secret.value) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "content-type": "application/json" },
    });
  }
  await admin.from("app_secrets").delete().eq("key", TOKEN_KEY);

  const log: Record<string, unknown> = {};
  const snap = async () => {
    const [cre, enc, batches, eng, sess, awards, loot, casts, acts, effects, grants] = await Promise.all([
      admin.from("creatures").select("id, hp, max_hp, is_alive, spawn_seq, died_at, rewards_awarded_at").eq("id", FIXTURE_CREATURE).maybeSingle(),
      admin.from("encounters").select("id, status, tick_number, version, tick_state, resolving_tick").eq("id", log.encounterId as string).maybeSingle(),
      admin.from("encounter_tick_batches").select("tick_number").eq("encounter_id", log.encounterId as string),
      admin.from("encounter_engagements").select("creature_id").eq("encounter_id", log.encounterId as string),
      admin.from("combat_sessions").select("id"),
      admin.from("encounter_kill_awards").select("death_id"),
      admin.from("encounter_death_loot").select("death_id"),
      admin.from("encounter_cast_events").select("id").eq("encounter_id", log.encounterId as string),
      admin.from("combat_actions").select("id").eq("encounter_id", log.encounterId as string),
      admin.from("active_effects").select("id"),
      admin.from("encounter_access_grants").select("character_id"),
    ]);
    return {
      creature: cre.data,
      encounter: enc.data,
      batches: batches.data?.length ?? 0,
      engagements: eng.data?.length ?? 0,
      sessions: sess.data?.length ?? 0,
      killAwards: awards.data?.length ?? 0,
      deathLoot: loot.data?.length ?? 0,
      casts: casts.data?.length ?? 0,
      actions: acts.data?.length ?? 0,
      effects: effects.data?.length ?? 0,
      accessGrants: grants.data?.length ?? 0,
    };
  };

  try {
    // ── fixture ──
    const { data: node } = await admin.from("world_nodes").select("id").limit(1).maybeSingle();
    log.nodeId = node?.id ?? null;
    await admin.from("creatures").upsert({
      id: FIXTURE_CREATURE,
      name: "C5 Stale Probe Dummy",
      node_id: node?.id ?? null,
      level: 1,
      hp: 40,
      max_hp: 40,
      is_alive: true,
      is_aggressive: false,
      base_aggressive: false,
      respawn_seconds: 60,
    });

    const { data: encId, error: encErr } = await admin.rpc("encounter_ensure_for_creature", {
      _creature_id: FIXTURE_CREATURE,
    });
    if (encErr) throw encErr;
    log.encounterId = encId;

    const before = await snap();
    log.before = before;

    const { data: claim, error: claimErr } = await admin.rpc("claim_encounter_tick", {
      _encounter_id: encId,
      _rate_ms: 0,
      _lease_ms: 60000,
      _caller: "c5-stale-generation-probe",
      _supported_modes: ["live", "effects_only"],
    });
    if (claimErr) throw claimErr;
    log.claim = claim;
    if (!claim?.claimed) {
      return new Response(JSON.stringify({ ok: false, stage: "claim", log }), {
        headers: { ...cors, "content-type": "application/json" },
      });
    }

    const { data: snapshot, error: snapErr } = await admin.rpc("encounter_snapshot_v2", {
      _encounter_id: encId,
      _claim_token: claim.claim_token,
      _tick: claim.tick,
    });
    if (snapErr) throw snapErr;
    log.snapshotLoaded = snapshot?.loaded !== false;
    const creatureSeq = (before.creature as { spawn_seq: number }).spawn_seq;
    const creatureHp = (before.creature as { hp: number }).hp;
    log.currentSpawnSeq = creatureSeq;

    const proposalFor = (spawnSeq: number) => ({
      proposedTickVersion: 3,
      creatures: [
        { creatureId: FIXTURE_CREATURE, spawnSeq, hpBefore: creatureHp, hpAfter: creatureHp, killed: false },
      ],
      characters: [],
      deaths: [],
      rewards: [],
      progression: [],
      loot: [],
      effects: [],
      engagementsJoin: [],
      engagementsLeave: [],
      durability: [],
      casts: [],
      storedPower: [],
      actionTerminal: [],
      log: [],
    });

    // ── the probe: a proposal built on the PREVIOUS generation ──
    const staleSeq = creatureSeq - 1;
    const { data: stale, error: staleErr } = await admin.rpc("commit_encounter_tick_v2", {
      _encounter_id: encId,
      _tick: claim.tick,
      _claim_token: claim.claim_token,
      _batch_id: crypto.randomUUID(),
      _snapshot_version: 3,
      _encounter_version: snapshot.encounterVersion,
      _snapshot_scope: snapshot.scope,
      _snapshot_digest: snapshot.stateDigest,
      _proposed: proposalFor(staleSeq),
    });
    log.staleProposalSpawnSeq = staleSeq;
    log.staleResult = staleErr ? { error: staleErr.message } : stale;

    log.after = await snap();

    // ── control: identical proposal on the CURRENT generation commits ──
    const { data: control, error: ctlErr } = await admin.rpc("commit_encounter_tick_v2", {
      _encounter_id: encId,
      _tick: claim.tick,
      _claim_token: claim.claim_token,
      _batch_id: crypto.randomUUID(),
      _snapshot_version: 3,
      _encounter_version: snapshot.encounterVersion,
      _snapshot_scope: snapshot.scope,
      _snapshot_digest: snapshot.stateDigest,
      _proposed: proposalFor(creatureSeq),
    });
    log.controlResult = ctlErr ? { error: ctlErr.message } : control;
    log.afterControl = await snap();

    // ── teardown of runtime rows created by the probe ──
    await admin.rpc("release_encounter_tick", {
      _encounter_id: encId,
      _tick: claim.tick,
      _claim_token: claim.claim_token,
      _reason: "probe_teardown",
    });
    await admin.from("encounter_tick_batches").delete().eq("encounter_id", encId);
    await admin.from("encounter_engagements").delete().eq("encounter_id", encId);
    await admin.from("encounter_creatures").delete().eq("encounter_id", encId);
    await admin.from("encounter_participants").delete().eq("encounter_id", encId);
    await admin.from("combat_actions").delete().eq("encounter_id", encId);
    await admin.from("encounter_cast_events").delete().eq("encounter_id", encId);
    await admin.from("encounters").delete().eq("id", encId);
    await admin.from("creatures").delete().eq("id", FIXTURE_CREATURE);
    log.teardown = {
      encounters: (await admin.from("encounters").select("id").eq("id", encId)).data?.length ?? 0,
      creature: (await admin.from("creatures").select("id").eq("id", FIXTURE_CREATURE)).data?.length ?? 0,
    };

    return new Response(JSON.stringify({ ok: true, log }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e), log }), {
      status: 500,
      headers: { ...cors, "content-type": "application/json" },
    });
  }
});
