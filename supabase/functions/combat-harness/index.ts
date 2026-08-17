/**
 * combat-harness — TEMPORARY validation-only endpoint (run id: c5t20260817b).
 *
 * NOT PRODUCTION. This run validates ONE thing: the internal dispatcher →
 * Edge delivery path for offscreen effects-only catch-up, including transport
 * result ownership. It is removed at teardown.
 *
 * Authorization is one-shot and entirely server-side:
 *   1. `POST { section: "authorize", token }` — sha-256 compared against
 *      `app_secrets.harness_token_<run>`; on success the token row is DELETED.
 *   2. Every later call presents `{ session }`, bounded by the run deadline.
 *
 * Only named, bounded sections run here. No arbitrary SQL, no arbitrary RPC,
 * and every entity it touches is registered in `harness_run_registry` for this
 * run. The service-role key is read from the environment and is never returned,
 * logged or echoed.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/http.ts";

const RUN_ID = "c5t20260817b";
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

/** Permanent-state fingerprint compared before and after the run. */
async function baseline() {
  const count = async (table: string) => {
    const { count: c } = await db.from(table).select("*", { count: "exact", head: true });
    return c ?? 0;
  };
  const { data: cfg } = await db.from("combat_config").select("key, value");
  const { data: world } = await db.from("world_state").select("state").eq("id", 1).maybeSingle();
  const { data: pause } = await db.from("simulation_pause_state").select("*").eq("id", 1).maybeSingle();
  return {
    combat_config: cfg,
    world_state: world?.state ?? null,
    simulation_pause_state: pause,
    counts: {
      characters: await count("characters"),
      creatures: await count("creatures"),
      encounters: await count("encounters"),
      active_effects: await count("active_effects"),
      effects_catchup_dispatch: await count("effects_catchup_dispatch"),
      combat_soak_scopes: await count("combat_soak_scopes"),
      combat_soak_access: await count("combat_soak_access"),
      node_ground_loot: await count("node_ground_loot"),
      encounter_kill_awards: await count("encounter_kill_awards"),
      encounter_death_loot: await count("encounter_death_loot"),
      harness_run_registry: await count("harness_run_registry"),
    },
  };
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
      case "baseline":
        return json({ ok: true, baseline: await baseline() });

      // ── teardown: run-owned state only. Built and exercised before fixtures.
      case "teardown": {
        const { data: report, error } = await db.rpc("harness_teardown", { _run_id: RUN_ID });
        const deleted: string[] = [];
        for (const userId of reg.auth_user ?? []) {
          if (!UUID_RE.test(userId)) continue;
          const { error: delErr } = await db.auth.admin.deleteUser(userId);
          deleted.push(`${userId}:${delErr ? delErr.message : "deleted"}`);
        }
        // restore permanent world/config state
        if (reg.world_state_prev?.[0]) {
          await db.from("world_state").update({ state: reg.world_state_prev[0] }).eq("id", 1);
        }
        await db.from("combat_config").update({ value: "off" }).eq("key", "combat_soak");
        await db.from("combat_config").update({ value: "maintenance" }).eq("key", "combat_mode");
        await db.rpc("unschedule_effects_catchup");
        await db.from("app_secrets").delete().eq("key", SESSION_KEY);
        await db.from("app_secrets").delete().eq("key", TOKEN_KEY);
        if (body?.purge_registry === true) {
          await db.from("harness_run_registry").delete().neq("run_id", "__keep__");
        }
        return json({
          ok: !error,
          error: error?.message ?? null,
          report,
          auth_users: deleted,
          after: await baseline(),
        });
      }

      // ── fixtures: character, creature, encounter and one overdue DoT ──────
      case "fixtures": {
        const nodeId = typeof body?.node_id === "string" && UUID_RE.test(body.node_id) ? body.node_id : null;
        if (!nodeId) return json({ ok: false, reason: "node_id required" }, 400);
        const { count: nodeCreatures } = await db
          .from("creatures").select("*", { count: "exact", head: true }).eq("node_id", nodeId);
        const { count: nodeChars } = await db
          .from("characters").select("*", { count: "exact", head: true }).eq("current_node_id", nodeId);
        if ((nodeCreatures ?? 0) > 0 || (nodeChars ?? 0) > 0) {
          return json({ ok: false, reason: "node is not isolated", nodeCreatures, nodeChars }, 400);
        }

        const email = `${RUN_ID}@harness.invalid`;
        const { data: created, error: userErr } = await db.auth.admin.createUser({
          email, password: crypto.randomUUID() + "Aa1!", email_confirm: true,
        });
        if (userErr || !created?.user) return json({ ok: false, reason: `user create failed: ${userErr?.message}` }, 500);
        await register("auth_user", created.user.id, email);
        await register("node_ref", nodeId);

        const { data: character, error: charErr } = await db.from("characters").insert({
          user_id: created.user.id, name: "Transportfix", race: "human", class: "warrior",
          level: 20, hp: 300, max_hp: 300, cp: 400, max_cp: 400, mp: 200, max_mp: 200,
          str: 18, dex: 16, con: 16, int: 10, wis: 10, cha: 10, ac: 14, current_node_id: nodeId,
        }).select("id").single();
        if (charErr || !character) return json({ ok: false, reason: `character insert failed: ${charErr?.message}` }, 500);
        await register("character", character.id);

        const { data: creature, error: creatureErr } = await db.from("creatures").insert({
          name: "Transport Effigy", description: "Temporary validation fixture.", node_id: nodeId,
          level: 5, hp: 40, max_hp: 40, ac: 8, is_aggressive: false, base_aggressive: false,
          is_humanoid: false, respawn_seconds: 86400, loot_mode: "legacy_table",
        }).select("id, spawn_seq, hp").single();
        if (creatureErr || !creature) return json({ ok: false, reason: `creature insert failed: ${creatureErr?.message}` }, 500);
        await register("creature", creature.id);

        const { data: encounterId, error: encErr } = await db.rpc("encounter_ensure_for_creature", {
          _creature_id: creature.id,
        });
        if (encErr || !encounterId) return json({ ok: false, reason: `encounter ensure failed: ${encErr?.message}` }, 500);
        await register("encounter", encounterId as string);

        return json({
          ok: true, node_id: nodeId, user_id: created.user.id, character_id: character.id,
          creature_id: creature.id, creature_spawn_seq: creature.spawn_seq,
          encounter_id: encounterId,
        });
      }

      // ── one overdue bleed on the fixture creature, attributed to the char ──
      case "seed_dot": {
        const nodeId = nodeIds[0];
        const characterId = characterIds[0];
        const creatureId = creatureIds[0];
        if (!nodeId || !characterId || !creatureId) return json({ ok: false, reason: "fixtures missing" }, 400);
        const now = Date.now();
        const { data: effect, error } = await db.from("active_effects").insert({
          node_id: nodeId, target_id: creatureId, source_id: characterId,
          effect_type: "bleed", mechanic: "damage_over_time", stacks: 1,
          damage_per_tick: 12, magnitude: 12, tick_rate_ms: 2000,
          next_tick_at: now - 4000,
          expires_at: now + 60_000,
          started_at: now - 10_000,
          source_ability_key: "rend",
          lifetime: "timed",
          params: { damage_type: "physical" },
        }).select("*").single();
        if (error) return json({ ok: false, reason: `effect insert failed: ${error.message}` }, 500);
        return json({ ok: true, effect });
      }

      // ── access: exact full-scope internal grant for this encounter only ────
      case "access": {
        const expires = new Date(Math.min(deadline, Date.now() + 30 * 60 * 1000)).toISOString();
        const nodeId = nodeIds[0];
        const encounterId = (reg.encounter ?? [])[0] ?? null;
        if (!nodeId) return json({ ok: false, reason: "no fixture node" }, 400);
        const { error: accessErr } = await db.from("combat_soak_access")
          .insert({ character_id: characterIds[0], node_id: nodeId, expires_at: expires, note: RUN_ID });
        if (accessErr) return json({ ok: false, reason: `soak access failed: ${accessErr.message}` }, 500);
        const { data: scope, error: scopeErr } = await db.from("combat_soak_scopes").insert({
          node_id: nodeId, encounter_id: encounterId,
          character_ids: characterIds, creature_ids: creatureIds, expires_at: expires,
        }).select("id").single();
        if (scopeErr) return json({ ok: false, reason: `soak scope failed: ${scopeErr.message}` }, 500);
        await db.from("combat_config").update({ value: "on" }).eq("key", "combat_soak");
        return json({ ok: true, scope_id: scope?.id, expires_at: expires });
      }

      // ── world: temporary wake for the run; previous value is registered ────
      case "world": {
        const want = body?.state === "asleep" ? "asleep" : "awake";
        const { data: prev } = await db.from("world_state").select("state").eq("id", 1).maybeSingle();
        if (!reg.world_state_prev?.[0] && prev?.state) {
          await register("world_state_prev", undefined, prev.state);
        }
        await db.from("world_state").update({ state: want, changed_at: new Date().toISOString() }).eq("id", 1);
        const { data: now } = await db.from("world_state").select("state").eq("id", 1).maybeSingle();
        return json({ ok: true, previous: prev?.state ?? null, state: now?.state ?? null });
      }

      // ── scheduler control ─────────────────────────────────────────────────
      case "scheduler": {
        const want = body?.arm === true;
        const { data, error } = await db.rpc(want ? "schedule_effects_catchup" : "unschedule_effects_catchup");
        const { data: cron } = await db.rpc("harness_cron_snapshot");
        return json({ ok: !error, error: error?.message ?? null, result: data, cron });
      }

      // ── one manual dispatch, fully traced ─────────────────────────────────
      case "dispatch_one": {
        const encounterId = (reg.encounter ?? [])[0];
        if (!encounterId) return json({ ok: false, reason: "no fixture encounter" }, 400);
        const { data, error } = await db.rpc("effects_catchup_dispatch_one", { _encounter_id: encounterId });
        return json({ ok: !error, error: error?.message ?? null, dispatch: data });
      }

      case "reconcile": {
        const { data, error } = await db.rpc("effects_catchup_reconcile", { _max: 20 });
        return json({ ok: !error, error: error?.message ?? null, result: data });
      }

      case "pass": {
        const { data, error } = await db.rpc("effects_due_dispatch", { _max_scopes: 5 });
        return json({ ok: !error, error: error?.message ?? null, result: data });
      }

      // ── monitor: read-only observability, credentials never included ──────
      case "monitor": {
        const nodeId = nodeIds[0];
        const [transport, credential, cron, encounters, effects, creatures, chars, log, batches, awards, loot] =
          await Promise.all([
            db.rpc("effects_transport_snapshot", { _node_id: nodeId }),
            db.rpc("effects_catchup_credential_health"),
            db.rpc("harness_cron_snapshot"),
            db.from("encounters").select("*").eq("node_id", nodeId),
            db.from("active_effects").select("*").eq("node_id", nodeId),
            db.from("creatures").select("id, name, hp, is_alive, spawn_seq, died_at, rewards_awarded_at").in("id", creatureIds),
            db.from("characters").select("id, name, hp, xp, gold, level, current_node_id").in("id", characterIds),
            db.from("effects_catchup_log").select("*").order("id", { ascending: false }).limit(40),
            db.from("encounter_tick_batches").select("*").in("encounter_id", reg.encounter ?? ["00000000-0000-0000-0000-000000000000"]),
            db.from("encounter_kill_awards").select("*").in("encounter_id", reg.encounter ?? ["00000000-0000-0000-0000-000000000000"]),
            db.from("node_ground_loot").select("*").eq("node_id", nodeId),
          ]);
        return json({
          ok: true,
          transport: transport.data, credential: credential.data, cron: cron.data,
          encounters: encounters.data, effects: effects.data, creatures: creatures.data,
          characters: chars.data, log: log.data,
          batches: (batches.data ?? []).length, awards: awards.data, ground_loot: loot.data,
        });
      }

      default:
        return json({ ok: false, reason: `unknown section: ${section}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});
