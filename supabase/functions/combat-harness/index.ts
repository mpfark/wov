/**
 * combat-harness — TEMPORARY validation-only endpoint (run id: c5v20260817a).
 *
 * NOT PRODUCTION. This endpoint exists solely for the deployed validation of the
 * internal effects-only catch-up owner and is removed at teardown.
 *
 * Authorization is one-shot and entirely server-side:
 *   1. `POST { section: "authorize", token }` — the token is compared (sha-256)
 *      against `app_secrets.harness_token_<run>`; on success the token row is
 *      DELETED (one shot) and a short-lived session hash is stored.
 *   2. Every later call presents `{ session }`; the session expires with the run
 *      deadline (max 30 minutes) and is deleted at teardown.
 *
 * The endpoint executes ONLY named, bounded sections. There is no arbitrary SQL,
 * no arbitrary RPC and no permanent-entity targeting: every id it touches must
 * be registered in `harness_run_registry` for this run. The production
 * service-role key is read from the function environment and never returned,
 * logged or echoed.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/http.ts";

const RUN_ID = "c5v20260817a";
const TOKEN_KEY = `harness_token_${RUN_ID}`;
const SESSION_KEY = `harness_session_${RUN_ID}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const url = Deno.env.get("SUPABASE_URL")!;
const srvKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, srvKey);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function secret(key: string): Promise<string | null> {
  const { data } = await db.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

/** Run-owned ids only. Anything not registered for this run is refused. */
async function registry(): Promise<Record<string, string[]>> {
  const { data } = await db
    .from("harness_run_registry")
    .select("kind, entity_id, entity_text")
    .eq("run_id", RUN_ID);
  const out: Record<string, string[]> = {};
  for (const row of (data ?? []) as { kind: string; entity_id: string | null; entity_text: string | null }[]) {
    out[row.kind] ??= [];
    out[row.kind].push(row.entity_id ?? row.entity_text ?? "");
  }
  return out;
}

async function register(kind: string, entityId?: string, entityText?: string) {
  await db.from("harness_run_registry").insert({
    run_id: RUN_ID,
    kind,
    entity_id: entityId ?? null,
    entity_text: entityText ?? null,
  });
}

/** The fixture-scoped write surface we assert stays untouched across refusals. */
async function writeCounts(scope: { encounterIds: string[]; nodeIds: string[]; characterIds: string[] }) {
  const count = async (table: string, col: string, ids: string[]) => {
    if (ids.length === 0) return 0;
    const { count: c } = await db.from(table).select("*", { count: "exact", head: true }).in(col, ids);
    return c ?? 0;
  };
  return {
    encounter_tick_batches: await count("encounter_tick_batches", "encounter_id", scope.encounterIds),
    encounter_kill_awards: await count("encounter_kill_awards", "encounter_id", scope.encounterIds),
    encounter_death_loot: await count("encounter_death_loot", "encounter_id", scope.encounterIds),
    node_ground_loot: await count("node_ground_loot", "node_id", scope.nodeIds),
    active_effects: await count("active_effects", "node_id", scope.nodeIds),
    combat_actions: await count("combat_actions", "character_id", scope.characterIds),
    encounter_contributions: await count("encounter_contributions", "encounter_id", scope.encounterIds),
  };
}

async function callCatchup(body: Record<string, unknown>, auth?: string) {
  const res = await fetch(`${url}/functions/v1/combat-catchup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth ?? `Bearer ${srvKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 300);
  }
  return { status: res.status, body: parsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "body is not valid JSON" }, 400);
  }
  const section = typeof body?.section === "string" ? body.section : "";

  // ── one-shot authorization ──────────────────────────────────────────
  if (section === "authorize") {
    const stored = await secret(TOKEN_KEY);
    if (!stored) return json({ ok: false, reason: "token already consumed or absent" }, 403);
    const presented = typeof body?.token === "string" ? body.token : "";
    if (!presented || !safeEq(await sha256(presented), stored)) {
      return json({ ok: false, reason: "invalid token" }, 403);
    }
    await db.from("app_secrets").delete().eq("key", TOKEN_KEY); // one shot
    const session = crypto.randomUUID() + crypto.randomUUID();
    await db.from("app_secrets").upsert({ key: SESSION_KEY, value: await sha256(session) });
    return json({ ok: true, session, run_id: RUN_ID });
  }

  const sessionHash = await secret(SESSION_KEY);
  const presentedSession = typeof body?.session === "string" ? body.session : "";
  if (!sessionHash || !presentedSession || !safeEq(await sha256(presentedSession), sessionHash)) {
    return json({ ok: false, reason: "unauthorized" }, 401);
  }

  const reg = await registry();
  const deadline = reg.deadline?.[0] ? Date.parse(reg.deadline[0]) : 0;
  if (!deadline || Date.now() > deadline) {
    await db.from("app_secrets").delete().eq("key", SESSION_KEY);
    await db.rpc("harness_fail_closed", { _run_id: RUN_ID });
    return json({ ok: false, reason: "run deadline passed; access withdrawn" }, 403);
  }

  const nodeIds = reg.node_ref ?? [];
  const characterIds = reg.character ?? [];
  const creatureIds = reg.creature ?? [];

  try {
    switch (section) {
      // ── fixtures: one temporary auth user, character, creature, grants ──
      case "fixtures": {
        const nodeId = typeof body?.node_id === "string" && UUID_RE.test(body.node_id) ? body.node_id : null;
        if (!nodeId) return json({ ok: false, reason: "node_id required" }, 400);
        const { count: nodeCreatures } = await db
          .from("creatures")
          .select("*", { count: "exact", head: true })
          .eq("node_id", nodeId);
        const { count: nodeChars } = await db
          .from("characters")
          .select("*", { count: "exact", head: true })
          .eq("current_node_id", nodeId);

        const email = `${RUN_ID}@harness.invalid`;
        const password = crypto.randomUUID() + "Aa1!";
        const { data: created, error: userErr } = await db.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (userErr || !created?.user) return json({ ok: false, reason: `user create failed: ${userErr?.message}` }, 500);
        await register("auth_user", created.user.id, email);

        const { data: character, error: charErr } = await db
          .from("characters")
          .insert({
            user_id: created.user.id,
            name: "Harnessfled",
            race: "human",
            class: "warrior",
            level: 20,
            hp: 300,
            max_hp: 300,
            cp: 400,
            max_cp: 400,
            mp: 200,
            max_mp: 200,
            str: 18,
            dex: 16,
            con: 16,
            int: 10,
            wis: 10,
            cha: 10,
            ac: 14,
            current_node_id: nodeId,
          })
          .select("id")
          .single();
        if (charErr || !character) return json({ ok: false, reason: `character insert failed: ${charErr?.message}` }, 500);
        await register("character", character.id);
        await register("node_ref", nodeId);

        const { data: creature, error: creatureErr } = await db
          .from("creatures")
          .insert({
            name: "Harness Effigy",
            description: "Temporary validation fixture.",
            node_id: nodeId,
            level: 5,
            hp: 40,
            max_hp: 40,
            ac: 8,
            is_aggressive: false,
            base_aggressive: false,
            is_humanoid: false,
            respawn_seconds: 86400,
            loot_mode: "legacy_table",
          })
          .select("id, spawn_seq")
          .single();
        if (creatureErr || !creature) return json({ ok: false, reason: `creature insert failed: ${creatureErr?.message}` }, 500);
        await register("creature", creature.id);

        return json({
          ok: true,
          node_id: nodeId,
          node_pre_existing: { creatures: nodeCreatures ?? 0, characters: nodeChars ?? 0 },
          user_id: created.user.id,
          email,
          password,
          character_id: character.id,
          creature_id: creature.id,
          creature_spawn_seq: creature.spawn_seq,
        });
      }

      // ── loadout: grant the fixture character the authored DoT ability ──
      case "loadout": {
        const characterId = characterIds[0];
        if (!characterId) return json({ ok: false, reason: "no fixture character" }, 400);
        const { data: ability } = await db
          .from("abilities")
          .select("id, ability_key, mechanic_key, interval_ms, damage_type")
          .eq("ability_key", "rend")
          .maybeSingle();
        if (!ability) return json({ ok: false, reason: "rend ability missing" }, 500);
        const { data: existing } = await db
          .from("character_ability_loadout")
          .select("*")
          .eq("character_id", characterId);
        return json({ ok: true, ability, loadout: existing });
      }

      // ── access: live soak allowlist + exact full-scope internal grant ──
      case "access": {
        const expires = new Date(Math.min(deadline, Date.now() + 30 * 60 * 1000)).toISOString();
        const nodeId = nodeIds[0];
        if (!nodeId) return json({ ok: false, reason: "no fixture node" }, 400);
        const { data: access, error: accessErr } = await db
          .from("combat_soak_access")
          .insert({ character_id: characterIds[0], node_id: nodeId, expires_at: expires, note: RUN_ID })
          .select("id")
          .single();
        if (accessErr) return json({ ok: false, reason: `soak access failed: ${accessErr.message}` }, 500);
        const variant = body?.variant === "partial" ? "partial" : "full";
        const { data: scope, error: scopeErr } = await db
          .from("combat_soak_scopes")
          .insert({
            node_id: nodeId,
            encounter_id: typeof body?.encounter_id === "string" ? body.encounter_id : null,
            character_ids: variant === "partial" ? [] : characterIds,
            creature_ids: variant === "partial" ? [] : creatureIds,
            expires_at: expires,
          })
          .select("id")
          .single();
        if (scopeErr) return json({ ok: false, reason: `soak scope failed: ${scopeErr.message}` }, 500);
        await db.from("combat_config").update({ value: "on" }).eq("key", "combat_soak");
        return json({ ok: true, variant, access_id: access?.id, scope_id: scope?.id, expires_at: expires });
      }

      // ── authz: the service-role refusal matrix, with write-count proof ──
      case "authz_matrix": {
        const nodeId = nodeIds[0];
        const { data: enc } = await db
          .from("encounters")
          .select("id, node_id, status")
          .eq("node_id", nodeId)
          .in("status", ["active", "idle"])
          .maybeSingle();
        const encounterId = enc?.id ?? null;
        const scope = { encounterIds: encounterId ? [encounterId] : [], nodeIds, characterIds };
        const before = await writeCounts(scope);
        const cases: { name: string; body: Record<string, unknown>; auth?: string }[] = [
          { name: "invalid_dispatch_id", body: { scope: "encounter", encounter_id: encounterId, node_id: nodeId, dispatch_id: "not-a-uuid" } },
          { name: "dispatch_other_encounter", body: { scope: "encounter", encounter_id: crypto.randomUUID(), node_id: nodeId, dispatch_id: crypto.randomUUID() } },
          { name: "wrong_node", body: { scope: "encounter", encounter_id: encounterId, node_id: crypto.randomUUID(), dispatch_id: crypto.randomUUID() } },
          { name: "missing_encounter_id", body: { scope: "encounter", node_id: nodeId, dispatch_id: crypto.randomUUID() } },
          { name: "player_jwt_shape", body: { scope: "encounter", encounter_id: encounterId, node_id: nodeId, dispatch_id: crypto.randomUUID() }, auth: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
          { name: "no_auth", body: { scope: "encounter", encounter_id: encounterId, node_id: nodeId, dispatch_id: crypto.randomUUID() }, auth: "" },
        ];
        const results: unknown[] = [];
        for (const c of cases) {
          const r = await callCatchup(c.body, c.auth === "" ? "Bearer " : c.auth);
          results.push({ case: c.name, ...r });
        }
        const after = await writeCounts(scope);
        return json({ ok: true, encounter_id: encounterId, before, after, results });
      }

      // ── monitor: read-only run observability ──────────────────────────
      case "monitor": {
        const nodeId = nodeIds[0];
        const [{ data: encounters }, { data: effects }, { data: dispatch }, { data: log }, { data: creatures }, { data: chars }, { data: jobs }] =
          await Promise.all([
            db.from("encounters").select("*").eq("node_id", nodeId),
            db.from("active_effects").select("*").eq("node_id", nodeId),
            db.from("effects_catchup_dispatch").select("*").eq("node_id", nodeId),
            db.from("effects_catchup_log").select("*").order("id", { ascending: false }).limit(60),
            db.from("creatures").select("id, name, hp, is_alive, spawn_seq, died_at, rewards_awarded_at").in("id", creatureIds),
            db.from("characters").select("id, name, hp, xp, gold, level, current_node_id").in("id", characterIds),
            db.rpc("harness_cron_snapshot"),
          ]);
        return json({ ok: true, encounters, effects, dispatch, log, creatures, characters: chars, cron: jobs });
      }

      // ── probe: named, bounded deployed probes ────────────────────────
      case "probe": {
        const name = typeof body?.name === "string" ? body.name : "";
        const nodeId = nodeIds[0];
        const { data: enc } = await db
          .from("encounters")
          .select("id, node_id, status")
          .eq("node_id", nodeId)
          .in("status", ["active", "idle"])
          .maybeSingle();
        const encounterId = enc?.id ?? null;
        const scope = { encounterIds: encounterId ? [encounterId] : [], nodeIds, characterIds };
        const before = await writeCounts(scope);

        if (name === "duplicate_dispatch") {
          const d1 = crypto.randomUUID();
          const d2 = crypto.randomUUID();
          const [r1, r2] = await Promise.all([
            callCatchup({ scope: "encounter", encounter_id: encounterId, node_id: nodeId, dispatch_id: d1 }),
            callCatchup({ scope: "encounter", encounter_id: encounterId, node_id: nodeId, dispatch_id: d2 }),
          ]);
          return json({ ok: true, name, before, after: await writeCounts(scope), results: [r1, r2] });
        }
        if (name === "duplicate_delivery") {
          const d = crypto.randomUUID();
          const r1 = await callCatchup({ scope: "encounter", encounter_id: encounterId, node_id: nodeId, dispatch_id: d });
          const r2 = await callCatchup({ scope: "encounter", encounter_id: encounterId, node_id: nodeId, dispatch_id: d });
          return json({ ok: true, name, before, after: await writeCounts(scope), results: [r1, r2] });
        }
        if (name === "consumed_noop") {
          const r = await callCatchup({ scope: "encounter", encounter_id: encounterId, node_id: nodeId, dispatch_id: crypto.randomUUID() });
          return json({ ok: true, name, before, after: await writeCounts(scope), result: r });
        }
        if (name === "stale_generation") {
          const creatureId = creatureIds[0];
          const { data: pre } = await db.from("creatures").select("spawn_seq, hp, is_alive").eq("id", creatureId).maybeSingle();
          await db.from("creatures").update({ spawn_seq: (pre?.spawn_seq ?? 1) + 1 }).eq("id", creatureId);
          const r = await callCatchup({ scope: "encounter", encounter_id: encounterId, node_id: nodeId, dispatch_id: crypto.randomUUID() });
          const { data: post } = await db.from("creatures").select("spawn_seq, hp, is_alive").eq("id", creatureId).maybeSingle();
          return json({ ok: true, name, before, after: await writeCounts(scope), pre, post, result: r });
        }
        if (name === "pause_boundary") {
          // fixture-controlled authoritative boundary; restored by `pause_restore`
          const { data: pre } = await db.from("simulation_pause_state").select("*").eq("id", 1).maybeSingle();
          const now = Date.now();
          await db
            .from("simulation_pause_state")
            .update({
              suspended_at_ms: typeof body?.suspended_at_ms === "number" ? body.suspended_at_ms : now - 600000,
              resumed_at_ms: typeof body?.resumed_at_ms === "number" ? body.resumed_at_ms : now - 1000,
            })
            .eq("id", 1);
          const r = await callCatchup({ scope: "encounter", encounter_id: encounterId, node_id: nodeId, dispatch_id: crypto.randomUUID() });
          const { data: post } = await db.from("simulation_pause_state").select("*").eq("id", 1).maybeSingle();
          return json({ ok: true, name, before, after: await writeCounts(scope), pre, post, result: r });
        }
        if (name === "pause_restore") {
          await db
            .from("simulation_pause_state")
            .update({
              suspended_at_ms: body?.suspended_at_ms ?? null,
              resumed_at_ms: body?.resumed_at_ms ?? null,
              last_sim_at_ms: body?.last_sim_at_ms ?? null,
            })
            .eq("id", 1);
          const { data: post } = await db.from("simulation_pause_state").select("*").eq("id", 1).maybeSingle();
          return json({ ok: true, name, post });
        }
        return json({ ok: false, reason: `unknown probe: ${name}` }, 400);
      }

      // ── teardown: run-owned state only ──────────────────────────────
      case "teardown": {
        const { data: report, error } = await db.rpc("harness_teardown", { _run_id: RUN_ID });
        if (error) return json({ ok: false, reason: error.message }, 500);
        const deleted: string[] = [];
        for (const userId of reg.auth_user ?? []) {
          if (!UUID_RE.test(userId)) continue;
          const { error: delErr } = await db.auth.admin.deleteUser(userId);
          deleted.push(`${userId}:${delErr ? delErr.message : "deleted"}`);
        }
        await db.from("app_secrets").delete().eq("key", SESSION_KEY);
        await db.from("app_secrets").delete().eq("key", TOKEN_KEY);
        return json({ ok: true, report, auth_users: deleted });
      }

      default:
        return json({ ok: false, reason: `unknown section: ${section}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});
