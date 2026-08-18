/**
 * combat-harness — TEMPORARY validation-only endpoint.
 *
 * NOT PRODUCTION. Removed at teardown.
 *
 * One bounded run per staged C5 stage (S1..S6). A run id alone grants
 * nothing: `authorize` requires a matching one-shot sha-256 token row in
 * `app_secrets`, which is deleted on use, so the endpoint may stay deployed
 * between stages while holding no reusable credential.
 *
 * Authorization is one-shot and entirely server-side:
 *   1. `POST { run, section: "authorize", token }` — sha-256 compared against
 *      `app_secrets.harness_token_<run>`; on success the token row is DELETED
 *      and a 30-minute run deadline is registered.
 *   2. Every later call presents `{ run, session }`, bounded by that deadline.
 *
 * Only named, bounded sections run here. No arbitrary SQL, no arbitrary RPC.
 * The service-role key is read from the environment and is never returned,
 * logged or echoed; the authorization matrix reports HTTP status codes only.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/http.ts";

const RUNS = [
  "c5td_20260818a",
  "c5s1_20260818a",
  "c5s2_20260818a",
  "c5s3_20260818a",
  "c5s4_20260818a",
  "c5s5_20260818a",
  "c5s6_20260818a",
  // Fresh cadence confirmation on build r7-postcommit-pacer.
  "c5cad_20260819a",
] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_MINUTES = 30;

const url = Deno.env.get("SUPABASE_URL")!;
const srvKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(url, srvKey);

/** Warrior Pressure role — the authored home of Rend. */
const WARRIOR_PRESSURE_ROLE = "73f3c3cf-9a2a-455a-b158-b9e40872cb93";

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

async function registry(run: string): Promise<Record<string, string[]>> {
  const { data } = await db
    .from("harness_run_registry")
    .select("kind, entity_id, entity_text")
    .eq("run_id", run);
  const out: Record<string, string[]> = {};
  for (const row of (data ?? []) as { kind: string; entity_id: string | null; entity_text: string | null }[]) {
    out[row.kind] ??= [];
    out[row.kind].push(row.entity_id ?? row.entity_text ?? "");
  }
  return out;
}

async function register(run: string, kind: string, entityId?: string, entityText?: string) {
  await db.from("harness_run_registry").insert({
    run_id: run,
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
  const run = typeof body?.run === "string" && (RUNS as readonly string[]).includes(body.run) ? body.run : null;
  if (!run) return json({ ok: false, reason: "unknown run" }, 400);
  const TOKEN_KEY = `harness_token_${run}`;
  const SESSION_KEY = `harness_session_${run}`;
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
    const deadline = new Date(Date.now() + RUN_MINUTES * 60_000).toISOString();
    await register(run, "deadline", undefined, deadline);
    return json({ ok: true, session, run_id: run, deadline });
  }

  const sessionHash = await secret(SESSION_KEY);
  const presentedSession = typeof body?.session === "string" ? body.session : "";
  if (!sessionHash || !presentedSession || !safeEq(await sha256(presentedSession), sessionHash)) {
    return json({ ok: false, reason: "unauthorized" }, 401);
  }

  const reg = await registry(run);
  const deadline = reg.deadline?.[0] ? Date.parse(reg.deadline[0]) : 0;
  const expired = !deadline || Date.now() > deadline;
  if (expired && section !== "teardown") {
    await db.from("app_secrets").delete().eq("key", SESSION_KEY);
    await db.rpc("harness_fail_closed", { _run_id: run });
    return json({ ok: false, reason: "run deadline passed; access withdrawn" }, 403);
  }

  const nodeIds = reg.node_ref ?? [];
  const characterIds = reg.character ?? [];
  const creatureIds = reg.creature ?? [];

  try {
    switch (section) {
      case "baseline":
        return json({ ok: true, baseline: await baseline() });

      // ── teardown: run-owned state only ───────────────────────────────────
      case "teardown": {
        const { data: report, error } = await db.rpc("harness_teardown", { _run_id: run });
        const deleted: string[] = [];
        for (const userId of reg.auth_user ?? []) {
          if (!UUID_RE.test(userId)) continue;
          const { error: delErr } = await db.auth.admin.deleteUser(userId);
          deleted.push(`${userId}:${delErr ? delErr.message : "deleted"}`);
        }
        if (reg.world_state_prev?.[0]) {
          await db.from("world_state").update({ state: reg.world_state_prev[0] }).eq("id", 1);
        }
        await db.from("combat_config").update({ value: "off" }).eq("key", "combat_soak");
        await db.from("combat_config").update({ value: "maintenance" }).eq("key", "combat_mode");
        await db.from("app_secrets").delete().eq("key", SESSION_KEY);
        await db.from("app_secrets").delete().eq("key", TOKEN_KEY);
        if (body?.purge_registry === true) {
          await db.from("harness_run_registry").delete().eq("run_id", run);
        }
        return json({
          ok: !error,
          error: error?.message ?? null,
          report,
          auth_users: deleted,
          after: await baseline(),
        });
      }

      // ── fixtures: player character (real credentials), creature ───────────
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

        const email = `${run}@harness.invalid`;
        const password = `${crypto.randomUUID()}Aa1!`;
        const { data: created, error: userErr } = await db.auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (userErr || !created?.user) return json({ ok: false, reason: `user create failed: ${userErr?.message}` }, 500);
        await register(run, "auth_user", created.user.id, email);
        await register(run, "node_ref", nodeId);
        await db.from("profiles").upsert({ id: created.user.id, display_name: "Harness Fixture" });

        const name = typeof body?.character_name === "string" && /^[A-Za-z]{3,16}$/.test(body.character_name)
          ? body.character_name
          : "Soakfixture";
        const { data: character, error: charErr } = await db.from("characters").insert({
          user_id: created.user.id, name, race: "human", class: "warrior",
          level: 20, hp: 300, max_hp: 300, cp: 400, max_cp: 400, mp: 200, max_mp: 200,
          str: 18, dex: 16, con: 16, int: 10, wis: 10, cha: 10, ac: 14, current_node_id: nodeId,
        }).select("id").single();
        if (charErr || !character) return json({ ok: false, reason: `character insert failed: ${charErr?.message}` }, 500);
        await register(run, "character", character.id);

        // Authored loadout: Rend in its own Pressure role.
        const { data: rend } = await db.from("abilities").select("id").eq("ability_key", "rend").single();
        const { error: loadErr } = await db.from("character_ability_loadout").insert({
          character_id: character.id,
          role_id: WARRIOR_PRESSURE_ROLE,
          ability_id: rend!.id,
        });
        if (loadErr) return json({ ok: false, reason: `loadout insert failed: ${loadErr.message}` }, 500);

        // Durable, nonlethal fixture: high HP so live autoattacks cannot kill it
        // while the browser driver is being exercised.
        const hp = typeof body?.creature_hp === "number" ? Math.max(10, Math.min(4000, body.creature_hp)) : 2000;
        const { data: creature, error: creatureErr } = await db.from("creatures").insert({
          name: typeof body?.creature_name === "string" ? body.creature_name : "Soak Effigy",
          description: "Temporary validation fixture.", node_id: nodeId,
          level: 8, hp, max_hp: hp, ac: 8,
          is_aggressive: body?.aggressive === true, base_aggressive: body?.aggressive === true,
          is_humanoid: false, respawn_seconds: 86400, loot_mode: "legacy_table",
        }).select("id, spawn_seq, hp, max_hp").single();
        if (creatureErr || !creature) return json({ ok: false, reason: `creature insert failed: ${creatureErr?.message}` }, 500);
        await register(run, "creature", creature.id);

        const { data: loadout } = await db.from("character_ability_loadout")
          .select("role_id, ability_id").eq("character_id", character.id);

        return json({
          ok: true, node_id: nodeId, user_id: created.user.id, email, password,
          character_id: character.id, creature, loadout,
        });
      }

      /**
       * ── hp_place: documented HP placement on the isolated fixture creature ──
       * The ONLY state this run edits by hand. It sets remaining HP so that a
       * small number of authentic Bleed pulses is lethal, preventing browser
       * latency from deciding the outcome. It never inserts an effect, ages a
       * timestamp, invokes catch-up, writes rewards/contributions or marks the
       * creature dead.
       */
      case "hp_place": {
        const creatureId = creatureIds[0];
        const hp = Number(body?.hp);
        if (!creatureId) return json({ ok: false, reason: "no fixture creature" }, 400);
        if (!Number.isFinite(hp) || hp < 1 || hp > 500) return json({ ok: false, reason: "hp out of range" }, 400);
        const { data: before } = await db.from("creatures")
          .select("id, hp, max_hp, is_alive, spawn_seq").eq("id", creatureId).single();
        if (!before?.is_alive) return json({ ok: false, reason: "creature is not alive" }, 400);
        const { data: after, error } = await db.from("creatures")
          .update({ hp }).eq("id", creatureId).select("id, hp, max_hp, is_alive, spawn_seq").single();
        if (error) return json({ ok: false, reason: error.message }, 500);
        await register(run, "hp_place", creatureId, `${before.hp}->${hp}`);
        return json({ ok: true, before, after });
      }

      // ── access: exact 30-minute live + internal grants for this scope only ─
      case "access": {
        const expires = new Date(Math.min(deadline, Date.now() + RUN_MINUTES * 60 * 1000)).toISOString();
        const nodeId = nodeIds[0];
        if (!nodeId) return json({ ok: false, reason: "no fixture node" }, 400);
        const { error: accessErr } = await db.from("combat_soak_access")
          .insert({ character_id: characterIds[0], node_id: nodeId, expires_at: expires, note: run });
        if (accessErr) return json({ ok: false, reason: `soak access failed: ${accessErr.message}` }, 500);
        const { data: scope, error: scopeErr } = await db.from("combat_soak_scopes").insert({
          node_id: nodeId, encounter_id: null,
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
          await register(run, "world_state_prev", undefined, prev.state);
        }
        await db.from("world_state").update({ state: want, changed_at: new Date().toISOString() }).eq("id", 1);
        const { data: now } = await db.from("world_state").select("state").eq("id", 1).maybeSingle();
        return json({ ok: true, previous: prev?.state ?? null, state: now?.state ?? null });
      }

      // ── scheduler control (permanent infrastructure, armed for the run) ────
      case "scheduler": {
        const want = body?.arm === true;
        const { data, error } = await db.rpc(want ? "schedule_effects_catchup" : "unschedule_effects_catchup");
        const { data: cron } = await db.rpc("harness_cron_snapshot");
        return json({ ok: !error, error: error?.message ?? null, result: data, cron });
      }

      // ── authorization matrix for the internal combat-catchup endpoint ──────
      case "auth_matrix": {
        const target = `${url}/functions/v1/combat-catchup`;
        const payload = JSON.stringify({
          scope: "encounter",
          encounter_id: "00000000-0000-4000-8000-000000000000",
          node_id: "00000000-0000-4000-8000-000000000000",
          dispatch_id: "00000000-0000-4000-8000-000000000000",
        });
        const probe = async (label: string, authHeader?: string) => {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (authHeader) headers.Authorization = authHeader;
          const res = await fetch(target, { method: "POST", headers, body: payload });
          let kind: string | null = null;
          try {
            const j = await res.json();
            kind = typeof j?.kind === "string" ? j.kind : null;
          } catch { /* ignore */ }
          return { label, status: res.status, kind };
        };

        let playerToken: string | null = null;
        const email = (reg.auth_user ?? []).length ? `${run}@harness.invalid` : null;
        const password = typeof body?.password === "string" ? body.password : null;
        if (email && password) {
          const anon = createClient(url, anonKey);
          const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
          playerToken = signIn?.session?.access_token ?? null;
        }

        const results = [
          await probe("internal_service_role", `Bearer ${srvKey}`),
          await probe("anonymous_no_header"),
          await probe("malformed_bearer", "Bearer not-a-token"),
          playerToken
            ? await probe("authenticated_player", `Bearer ${playerToken}`)
            : { label: "authenticated_player", status: null, kind: "player token unavailable" },
        ];
        return json({ ok: true, results });
      }

      // ── monitor: read-only observability, credentials never included ──────
      case "monitor": {
        const nodeId = nodeIds[0];
        const encIds = (reg.encounter ?? []);
        const { data: encRows } = await db.from("encounters").select("id").eq("node_id", nodeId);
        const encounterIds = [...new Set([...encIds, ...(encRows ?? []).map((r: any) => r.id)])];
        const idFilter = encounterIds.length ? encounterIds : ["00000000-0000-0000-0000-000000000000"];
        // `encounter_contributions` was dropped: it was written as zeroes and
        // read by nothing. Participation evidence is `encounter_participants` +
        // `encounter_engagements`; reward rights are the attribution roster.
        const [transport, credential, cron, encounters, effects, creatures, chars, log, batches, awards, loot,
          participants, engagements, actions, deathLoot] =
          await Promise.all([
            db.rpc("effects_transport_snapshot", { _node_id: nodeId }),
            db.rpc("effects_catchup_credential_health"),
            db.rpc("harness_cron_snapshot"),
            db.from("encounters").select("*").eq("node_id", nodeId),
            db.from("active_effects").select("*").eq("node_id", nodeId),
            db.from("creatures").select("id, name, hp, max_hp, is_alive, spawn_seq, died_at, rewards_awarded_at").in("id", creatureIds),
            db.from("characters").select("id, name, hp, xp, gold, level, current_node_id").in("id", characterIds),
            db.from("effects_catchup_log").select("*").order("id", { ascending: false }).limit(60),
            db.from("encounter_tick_batches").select("*").in("encounter_id", idFilter),
            db.from("encounter_kill_awards").select("*").in("encounter_id", idFilter),
            db.from("node_ground_loot").select("*").eq("node_id", nodeId),
            db.from("encounter_participants").select("*").in("encounter_id", idFilter),
            db.from("encounter_engagements").select("*").in("encounter_id", idFilter),
            db.from("combat_actions").select("*").eq("node_id", nodeId),
            db.from("encounter_death_loot").select("*").in("encounter_id", idFilter),
          ]);
        const { data: dispatch } = await db.from("effects_catchup_dispatch").select("*").in("encounter_id", idFilter);
        return json({
          ok: true,
          transport: transport.data, credential: credential.data, cron: cron.data,
          encounters: encounters.data, effects: effects.data, creatures: creatures.data,
          characters: chars.data, log: log.data,
          batches: batches.data, awards: awards.data, ground_loot: loot.data,
          participants: participants.data, engagements: engagements.data,
          actions: actions.data, death_loot: deathLoot.data, dispatch,
        });
      }

      default:
        return json({ ok: false, reason: `unknown section: ${section}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});
