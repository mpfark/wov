/**
 * c5-soak-harness — fixture + inspection control plane for the C5 phase 4
 * controlled soak. Admin-only (Overlord). Combat stays globally in
 * `maintenance`; only the server-enforced `combat_soak_access` allowlist (one
 * node, the explicit test characters, 60-minute expiry) may resolve.
 *
 * This function creates NO second combat authority: every tick during the soak
 * is driven through the real `combat-tick` / `combat-catchup` edge functions,
 * i.e. the exact production C3/C2 path. The only resolution this harness itself
 * performs is the catch-up role, and it does so by calling the same shared
 * `orchestrateCombatResolution` with role `catchup` (no alternate resolver, no
 * relaxed rule).
 *
 * Actions: setup | state | seed_effect | move | action | catchup | resync |
 *          weaken | spawn | teardown
 *
 * Everything it creates is deleted by `teardown`, which also flips the soak
 * switch off and empties the allowlist.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3.4.4';
import { corsHeaders } from '../_shared/http.ts';
import { orchestrateCombatResolution } from '../_shared/combat/c3/orchestration.ts';
import { buildAbilityCatalog } from '../_shared/combat/c3-catalog.ts';

const NODE_NAME = 'c5-soak-proving-ground';
const NOTE = 'c5-phase4-soak';

/** The five soak characters: four-strong party plus one independent solo. */
const ROSTER = [
  { key: 'party_wizard', cls: 'wizard', race: 'human', name: 'Soakarion' },
  { key: 'party_templar', cls: 'templar', race: 'human', name: 'Soakalis' },
  { key: 'party_healer', cls: 'healer', race: 'human', name: 'Soakamira' },
  { key: 'party_warrior', cls: 'warrior', race: 'human', name: 'Soakabrand' },
  { key: 'solo_rogue', cls: 'assassin', race: 'human', name: 'Soakavel' },
] as const;

const BOSS_CAST = {
  ability_key: 'soak_cataclysm',
  cast_key: 'soak_cataclysm',
  label: 'Gathering Cataclysm',
  cast_ticks: 2,
  cooldown_ticks: 2,
  damage: 18,
  damage_aoe: 9,
  damage_type: 'fire',
  target_mode: 'tank_preferred',
  channeling: false,
  pause_autoattacks: true,
  casting_text: 'The effigy draws the air into a burning knot.',
  casted_text: 'The knot bursts.',
  stored_power: {
    cap: 60,
    primary_share: 1,
    aoe_share: 0.5,
    consume_mode: 'all',
    consume_pct: 100,
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const url = Deno.env.get('SUPABASE_URL')!;
  const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, srvKey, { auth: { persistSession: false } });

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: userData } = await admin.auth.getUser(token);
  const uid = userData?.user?.id;
  if (!uid) return json({ error: 'unauthenticated' }, 401);
  const { data: isOverlord } = await admin.rpc('has_role', { _user_id: uid, _role: 'overlord' });
  if (!isOverlord) return json({ error: 'forbidden' }, 403);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const action = String(body?.action ?? '');
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });

  try {
    switch (action) {
      // ── fixtures ──────────────────────────────────────────────────────
      case 'setup': {
        const [{ id: regionId }] = await sql<{ id: string }[]>`
          select id from public.regions order by created_at limit 1`;
        const [{ id: nodeId }] = await sql<{ id: string }[]>`
          insert into public.nodes (region_id, name, description, x, y)
          values (${regionId}, ${NODE_NAME}, ${'C5 phase 4 controlled soak fixture'}, 99997, 99997)
          returning id`;
        // A second fixture node, off the allowlist, used to prove that a DoT
        // source that leaves the node still earns catch-up rewards and that a
        // character standing there receives maintenance.
        const [{ id: offNodeId }] = await sql<{ id: string }[]>`
          insert into public.nodes (region_id, name, description, x, y)
          values (${regionId}, ${NODE_NAME + '-off'}, ${'off-node soak fixture'}, 99998, 99997)
          returning id`;

        const chars: Record<string, string> = {};
        for (const r of ROSTER) {
          const [{ id }] = await sql<{ id: string }[]>`
            insert into public.characters
              (user_id, name, race, class, level, hp, max_hp, cp, max_cp, mp, max_mp, ac,
               current_node_id, str, dex, con, "int", wis, cha)
            values (${uid}, ${r.name + Math.floor(Math.random() * 1000)}, ${r.race}, ${r.cls},
                    21, 260, 260, 240, 240, 240, 240, 16, ${nodeId}, 16, 16, 16, 16, 16, 16)
            returning id`;
          chars[r.key] = id;
        }

        // One party of four (leader + tank), solo rogue stays unpartied.
        const [{ id: partyId }] = await sql<{ id: string }[]>`
          insert into public.parties (leader_id, tank_id)
          values (${chars.party_wizard}, ${chars.party_templar})
          returning id`;
        for (const key of ['party_wizard', 'party_templar', 'party_healer', 'party_warrior']) {
          await sql`insert into public.party_members (party_id, character_id, status, is_following)
                    values (${partyId}, ${chars[key]}, 'accepted', false)`;
        }

        const creatures: Record<string, string> = {};
        const mkCreature = async (
          name: string,
          level: number,
          hp: number,
          aggressive: boolean,
          bossCast: unknown | null,
        ) => {
          const [{ id }] = await sql<{ id: string }[]>`
            insert into public.creatures
              (name, description, node_id, level, hp, max_hp, ac, is_aggressive, base_aggressive,
               is_alive, is_humanoid, loot_mode, stats, boss_cast, rarity, respawn_seconds)
            values (${name}, ${'soak fixture'}, ${nodeId}, ${level}, ${hp}, ${hp}, 12,
                    ${aggressive}, ${aggressive}, true, false, 'salvage_only',
                    ${sql.json({ str: 12, dex: 10, con: 12, int: 8, wis: 8, cha: 8 })},
                    ${bossCast ? sql.json(bossCast as Record<string, unknown>) : null},
                    'regular', 999999)
            returning id`;
          return id;
        };
        creatures.dummy_a = await mkCreature('Soak Effigy A', 18, 4000, false, null);
        creatures.dummy_b = await mkCreature('Soak Effigy B', 18, 4000, false, null);
        creatures.frail = await mkCreature('Soak Frail', 12, 14, false, null);
        creatures.boss = await mkCreature('Soak Cataclyst', 20, 6000, true, BOSS_CAST);

        // Server-enforced allowlist: these five characters, this one node, 60
        // minutes, then it expires by itself.
        for (const id of Object.values(chars)) {
          await sql`insert into public.combat_soak_access (character_id, node_id, expires_at, note)
                    values (${id}, ${nodeId}, now() + interval '60 minutes', ${NOTE})`;
        }
        await sql`
          insert into public.combat_config (key, value)
          values ('combat_soak', 'on')
          on conflict (key) do update set value = 'on'`;

        return json({ ok: true, nodeId, offNodeId, partyId, chars, creatures });
      }

      // ── inspection ────────────────────────────────────────────────────
      case 'state': {
        const nodeId = String(body.nodeId);
        const [encounters, effects, actions, creatures, chars, batches, casts, awards, loot, grants] =
          await Promise.all([
            sql`select id, node_id, status, tick_number, tick_state, tick_mode, resolving_tick,
                       stored_power, stored_power_cap, claim_token, lease_until, attempt
                  from public.encounters where node_id = ${nodeId} order by created_at`,
            sql`select id, target_id, source_id, effect_type, mechanic, magnitude, remaining,
                       stacks, damage_per_tick, next_tick_at, expires_at, params, params_version,
                       source_ability_key
                  from public.active_effects where node_id = ${nodeId} order by created_at`,
            sql`select id, character_id, ability_key, status, reject_reason, client_seq, consumed_tick,
                       eligible_after_ms
                  from public.combat_actions where node_id = ${nodeId} order by created_at`,
            sql`select id, name, hp, max_hp, is_alive, node_id from public.creatures
                  where node_id = ${nodeId} or name like 'Soak %' order by name`,
            sql`select id, name, class, level, hp, cp, mp, xp, gold, bhp, current_node_id,
                       reserved_buffs, stance_state
                  from public.characters where name like 'Soak%' order by name`,
            sql`select b.encounter_id, count(*) as batches, min(b.tick_number) as min_tick,
                       max(b.tick_number) as max_tick
                  from public.encounter_tick_batches b
                  join public.encounters e on e.id = b.encounter_id
                  where e.node_id = ${nodeId} group by b.encounter_id`,
            sql`select id, creature_id, cast_key, ability_key, started_at, resolved_at, expires_at, payload
                  from public.encounter_cast_events where node_id = ${nodeId} order by started_at`,
            sql`select a.* from public.encounter_kill_awards a
                  join public.encounters e on e.id = a.encounter_id where e.node_id = ${nodeId}`,
            sql`select * from public.node_ground_loot where node_id = ${nodeId}`,
            sql`select * from public.encounter_access_grants g
                  join public.encounters e on e.id = g.encounter_id where e.node_id = ${nodeId}`,
          ]);
        return json({
          ok: true,
          encounters,
          effects,
          actions,
          creatures,
          chars,
          batches,
          casts,
          awards,
          loot,
          grants,
        });
      }

      case 'batch_rows': {
        // Raw committed batches for gap/recovery inspection.
        const rows = await sql`
          select b.tick_number as tick, b.batch_id, b.created_at,
                 jsonb_array_length(coalesce(b.payload->'events','[]'::jsonb)) as events
            from public.encounter_tick_batches b
            where b.encounter_id = ${String(body.encounterId)}
            order by b.tick_number`;
        return json({ ok: true, rows });
      }

      // ── controlled mutations (fixtures only) ──────────────────────────
      case 'seed_effect': {
        const e = body.effect ?? {};
        const rows = await sql`
          insert into public.active_effects
            (node_id, target_id, source_id, effect_type, mechanic, magnitude, remaining, stacks,
             damage_per_tick, next_tick_at, expires_at, tick_rate_ms, params, params_version,
             source_ability_key)
          values (${body.nodeId}, ${e.target_id}, ${e.source_id}, ${e.effect_type}, ${e.mechanic},
                  ${e.magnitude ?? null}, ${e.remaining ?? null}, ${e.stacks ?? null},
                  ${e.damage_per_tick ?? null}, ${e.next_tick_at ?? null}, ${e.expires_at ?? null},
                  ${e.tick_rate_ms ?? null},
                  ${e.params ? sql.json(e.params) : null}, ${e.params_version ?? null},
                  ${e.source_ability_key ?? null})
          returning *`;
        return json({ ok: true, rows });
      }

      case 'move': {
        await sql`update public.characters set current_node_id = ${body.nodeId}
                  where id = ${body.characterId}`;
        return json({ ok: true });
      }

      case 'weaken': {
        await sql`update public.creatures set hp = ${Number(body.hp)} where id = ${body.creatureId}`;
        return json({ ok: true });
      }

      case 'spawn': {
        const [{ id }] = await sql<{ id: string }[]>`
          insert into public.creatures
            (name, description, node_id, level, hp, max_hp, ac, is_aggressive, base_aggressive,
             is_alive, is_humanoid, loot_mode, stats, rarity, respawn_seconds)
          values (${String(body.name ?? 'Soak Latecomer')}, ${'soak fixture'}, ${body.nodeId},
                  ${Number(body.level ?? 15)}, ${Number(body.hp ?? 60)}, ${Number(body.hp ?? 60)},
                  12, false, false, true, false, 'salvage_only',
                  ${sql.json({ str: 12, dex: 10, con: 12, int: 8, wis: 8, cha: 8 })},
                  'regular', 999999)
          returning id`;
        return json({ ok: true, creatureId: id });
      }

      case 'action': {
        const id = crypto.randomUUID();
        const { data, error } = await admin.rpc('submit_combat_action', {
          _id: id,
          _character_id: body.characterId,
          _ability_key: body.abilityKey,
          _target_creature_id: body.targetCreatureId ?? null,
          _target_character_id: body.targetCharacterId ?? null,
          _client_seq: Number(body.clientSeq ?? 0),
        });
        if (error) return json({ ok: false, error: error.message }, 200);
        return json({ ok: true, action: data });
      }

      case 'resync': {
        const { data, error } = await admin.rpc('encounter_resync_snapshot', {
          _encounter_id: body.encounterId,
          _character_id: body.characterId,
        });
        if (error) return json({ ok: false, error: error.message });
        return json({ ok: true, snapshot: data });
      }

      // ── catch-up: the same shared orchestration, catchup role only ────
      case 'catchup': {
        const result = await orchestrateCombatResolution(
          { role: 'catchup', nodeId: body.nodeId ?? null, characterId: body.characterId ?? null },
          {
            db: admin as unknown as Parameters<typeof orchestrateCombatResolution>[1]['db'],
            nowMs: Date.now(),
            catalog: await buildAbilityCatalog(admin),
            refreshCatalog: () => buildAbilityCatalog(admin, true),
            newBatchId: () => crypto.randomUUID(),
            caller: 'c5-soak-harness',
            log: (m, d) => console.log(m, d ?? ''),
          },
        );
        return json({ ok: true, result });
      }

      case 'soak_off': {
        await sql`update public.combat_config set value = 'off' where key = 'combat_soak'`;
        await sql`delete from public.combat_soak_access where note = ${NOTE}`;
        return json({ ok: true });
      }

      // ── teardown ──────────────────────────────────────────────────────
      case 'teardown': {
        await sql`update public.combat_config set value = 'off' where key = 'combat_soak'`;
        await sql`delete from public.combat_soak_access`;

        const nodes = await sql<{ id: string }[]>`
          select id from public.nodes where name like ${NODE_NAME + '%'}`;
        const nodeIds = nodes.map((n) => n.id);
        const chars = await sql<{ id: string }[]>`
          select id from public.characters where name like 'Soak%'`;
        const charIds = chars.map((c) => c.id);
        const encs = nodeIds.length
          ? await sql<{ id: string }[]>`select id from public.encounters where node_id = any(${nodeIds})`
          : [];
        const encIds = encs.map((e) => e.id);

        if (encIds.length) {
          await sql`delete from public.encounter_tick_batches where encounter_id = any(${encIds})`;
          await sql`delete from public.encounter_access_grants where encounter_id = any(${encIds})`;
          await sql`delete from public.encounter_participants where encounter_id = any(${encIds})`;
          await sql`delete from public.encounter_engagements where encounter_id = any(${encIds})`;
          await sql`delete from public.encounter_contributions where encounter_id = any(${encIds})`;
          await sql`delete from public.encounter_kill_awards where encounter_id = any(${encIds})`;
          await sql`delete from public.encounter_death_loot where encounter_id = any(${encIds})`;
          await sql`delete from public.encounter_cast_events where encounter_id = any(${encIds})`;
          await sql`delete from public.encounter_creatures where encounter_id = any(${encIds})`;
          
        }
        if (charIds.length) {
          await sql`delete from public.active_effects where target_id = any(${charIds}) or source_id = any(${charIds})`;
          await sql`delete from public.combat_actions where character_id = any(${charIds})`;
          await sql`delete from public.party_members where character_id = any(${charIds})`;
          await sql`delete from public.parties where leader_id = any(${charIds}) or tank_id = any(${charIds})`;
        }
        if (nodeIds.length) {
          await sql`delete from public.active_effects where node_id = any(${nodeIds})`;
          await sql`delete from public.combat_actions where node_id = any(${nodeIds})`;
          await sql`delete from public.node_ground_loot where node_id = any(${nodeIds})`;
          await sql`delete from public.combat_sessions where node_id = any(${nodeIds})`;
          await sql`delete from public.encounters where node_id = any(${nodeIds})`;
          await sql`delete from public.creatures where node_id = any(${nodeIds})`;
        }
        await sql`delete from public.creatures where name like 'Soak %'`;
        if (charIds.length) await sql`delete from public.characters where id = any(${charIds})`;
        if (nodeIds.length) await sql`delete from public.nodes where id = any(${nodeIds})`;

        const [left] = await sql`
          select
            (select count(*) from public.combat_soak_access) as allowlist,
            (select count(*) from public.encounters) as encounters,
            (select count(*) from public.active_effects) as effects,
            (select count(*) from public.combat_actions) as actions,
            (select count(*) from public.encounter_access_grants) as grants,
            (select count(*) from public.characters where name like 'Soak%') as soak_chars,
            (select count(*) from public.nodes where name like ${NODE_NAME + '%'}) as soak_nodes,
            (select value from public.combat_config where key = 'combat_mode') as combat_mode,
            (select value from public.combat_config where key = 'combat_soak') as combat_soak`;
        return json({ ok: true, removed: { nodes: nodeIds.length, chars: charIds.length, encounters: encIds.length }, left });
      }

      default:
        return json({ error: `unknown action ${action}` }, 400);
    }
  } catch (e) {
    console.error('[c5-soak-harness]', e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
