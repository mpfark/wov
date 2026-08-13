/**
 * TEMPORARY C3 checkpoint-1 round-trip harness (service role).
 *
 * Creates fully isolated `c3h_` fixtures, exposes the deployed
 * `encounter_snapshot_v2` output, commits a caller-supplied proposal through
 * `commit_encounter_tick_v2`, and removes every fixture again.
 *
 * Touches no existing player, world or combat row. Deleted after validation.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

async function setup(opts: { level?: number; xp?: number } = {}) {
  const tag = `c3h_${crypto.randomUUID().slice(0, 8)}`;

  const { data: user, error: userErr } = await admin.auth.admin.createUser({
    email: `${tag}@harness.invalid`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (userErr) throw new Error(`createUser: ${userErr.message}`);

  const ins = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await admin.from(table).insert(row).select().single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as Record<string, unknown>;
  };

  const region = await ins('regions', { name: `${tag}_region` });
  const area = await ins('areas', {
    region_id: region.id,
    name: `${tag}_area`,
    area_type: 'plains',
  });
  const node = await ins('nodes', {
    region_id: region.id,
    area_id: area.id,
    name: `${tag}_node`,
  });
  const character = await ins('characters', {
    user_id: user.user!.id,
    name: `${tag.replace(/_/g, '')}`,
    race: 'human',
    class: 'warrior',
    level: opts.level ?? 11,
    xp: opts.xp ?? 0,
    current_node_id: node.id,
    hp: 80,
    max_hp: 80,
    cp: 60,
    max_cp: 60,
    mp: 40,
    max_mp: 40,
    str: 16,
    dex: 14,
    con: 15,
    int: 10,
    wis: 11,
    cha: 12,
    ac: 14,
  });
  const creature = await ins('creatures', {
    name: `${tag}_creature`,
    node_id: node.id,
    level: 11,
    hp: 1,
    max_hp: 40,
    rarity: 'regular',
    is_alive: true,
    ac: 10,
  });
  const encounter = await ins('encounters', {
    node_id: node.id,
    encounter_key: tag,
    status: 'active',
    tick_mode: 'shared',
  });
  await ins('encounter_participants', {
    encounter_id: encounter.id,
    character_id: character.id,
  });
  await ins('encounter_creatures', {
    encounter_id: encounter.id,
    creature_id: creature.id,
  });
  await ins('encounter_engagements', {
    encounter_id: encounter.id,
    creature_id: creature.id,
    character_id: character.id,
  });

  return {
    tag,
    userId: user.user!.id,
    regionId: region.id,
    areaId: area.id,
    nodeId: node.id,
    characterId: character.id,
    creatureId: creature.id,
    encounterId: encounter.id,
  };
}

async function teardown(ids: Record<string, string>) {
  const del = async (table: string, col: string, val: string) => {
    const { error } = await admin.from(table).delete().eq(col, val);
    if (error) throw new Error(`delete ${table}: ${error.message}`);
  };
  await del('encounter_engagements', 'encounter_id', ids.encounterId);
  await del('encounter_creatures', 'encounter_id', ids.encounterId);
  await del('encounter_participants', 'encounter_id', ids.encounterId);
  await del('encounter_tick_batches', 'encounter_id', ids.encounterId);
  await del('combat_actions', 'character_id', ids.characterId);
  await del('active_effects', 'node_id', ids.nodeId);
  await del('encounter_kill_awards', 'encounter_id', ids.encounterId);
  await del('encounter_contributions', 'encounter_id', ids.encounterId);
  await del('encounter_cast_events', 'encounter_id', ids.encounterId);
  await del('encounter_death_loot', 'encounter_id', ids.encounterId);
  await del('node_ground_loot', 'node_id', ids.nodeId);
  await del('encounters', 'id', ids.encounterId);
  await del('creatures', 'id', ids.creatureId);
  await del('characters', 'id', ids.characterId);
  await del('nodes', 'id', ids.nodeId);
  await del('areas', 'id', ids.areaId);
  await del('regions', 'id', ids.regionId);
  await admin.auth.admin.deleteUser(ids.userId);

  const leaks: Record<string, number> = {};
  for (const [table, col] of [
    ['regions', 'name'],
    ['areas', 'name'],
    ['nodes', 'name'],
    ['creatures', 'name'],
    ['encounters', 'encounter_key'],
  ] as const) {
    const { count, error } = await admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .like(col, `${ids.tag}%`);
    if (error) throw new Error(`leak check ${table}: ${error.message}`);
    leaks[table] = count ?? 0;
  }
  // Independent id-scoped leak checks for rows that carry no fixture name.
  for (const [table, col, val] of [
    ['active_effects', 'node_id', ids.nodeId],
    ['encounter_tick_batches', 'encounter_id', ids.encounterId],
    ['encounter_kill_awards', 'encounter_id', ids.encounterId],
    ['encounter_death_loot', 'encounter_id', ids.encounterId],
    ['encounter_contributions', 'encounter_id', ids.encounterId],
    ['characters', 'id', ids.characterId],
    ['combat_sessions', 'node_id', ids.nodeId],
  ] as const) {
    const { count, error } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(col, val);
    if (error) throw new Error(`leak check ${table}: ${error.message}`);
    leaks[table] = count ?? 0;
  }
  return { leaks };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const body = await req.json();
    switch (body.action) {
      case 'setup': {
        const ids = await setup(body.options ?? {});
        return json({ ok: true, ids });
      }
      /**
       * Fixture-only due-time seeding.
       *
       * `claim_encounter_tick` grants a tick when
       *   now_ms - encounters.tick_at >= _rate_ms
       * so a fixture is authoritatively due once tick_at is at least tickRateMs
       * in the past. This writes tick_at = now_ms - offsetMs on the isolated
       * fixture row only. The claim function itself is untouched: no mock, no
       * bypass, no relaxed comparison.
       *
       * offsetMs values used by the harness (tickRateMs = 2000):
       *   3000  -> comfortably due (1.5x rate)
       *   2000  -> exactly due     (boundary, inclusive side)
       *      0  -> not due at all  (negative case)
       */
      case 'seed_due': {
        const nowMs = Date.now();
        const tickAt = nowMs - (body.offsetMs ?? 0);
        const { error } = await admin
          .from('encounters')
          .update({ tick_at: tickAt, tick_state: 'idle', resolving_tick: null, claim_token: null, lease_until: null, attempt: 0 })
          .eq('id', body.encounterId);
        if (error) throw new Error(`seed_due: ${error.message}`);
        return json({ ok: true, seeded: { nowMs, tickAt, offsetMs: body.offsetMs ?? 0 } });
      }
      /** Fixture-only: seed one damage-over-time effect with an explicit due time. */
      /** Fixture-only: force the lease to look expired so claim takes the reclaim path. */
      case 'expire_lease': {
        const { error } = await admin
          .from('encounters')
          .update({ lease_until: Date.now() - 1 })
          .eq('id', body.encounterId);
        if (error) throw new Error(`expire_lease: ${error.message}`);
        return json({ ok: true });
      }
      case 'seed_effect': {
        const { data, error } = await admin
          .from('active_effects')
          .insert({
            node_id: body.nodeId,
            target_id: body.targetId,
            source_id: body.sourceId,
            effect_type: body.effectType ?? 'bleed',
            stacks: body.stacks ?? 1,
            damage_per_tick: body.amountPerTick ?? 3,
            next_tick_at: body.nextTickAtMs,
            expires_at: body.expiresAtMs,
            tick_rate_ms: body.intervalMs ?? 2000,
          })
          .select()
          .single();
        if (error) throw new Error(`seed_effect: ${error.message}`);
        return json({ ok: true, effect: data });
      }
      case 'effects': {
        const { data, error } = await admin
          .from('active_effects')
          .select('id, target_id, effect_type, stacks, damage_per_tick, next_tick_at, expires_at, tick_rate_ms')
          .eq('target_id', body.targetId)
          .order('id');
        if (error) throw new Error(`effects: ${error.message}`);
        return json({ ok: true, effects: data });
      }
      case 'encounter': {
        const { data, error } = await admin
          .from('encounters')
          .select('tick_number, tick_at, tick_state, resolving_tick, claim_token, lease_until, attempt, version, stored_power, stored_power_cap, tick_mode')
          .eq('id', body.encounterId)
          .single();
        if (error) throw new Error(`encounter: ${error.message}`);
        return json({ ok: true, encounter: data });
      }
      case 'batches': {
        const { data, error } = await admin
          .from('encounter_tick_batches')
          .select('tick_number, batch_id, payload')
          .eq('encounter_id', body.encounterId)
          .order('tick_number');
        if (error) throw new Error(`batches: ${error.message}`);
        return json({ ok: true, batches: data });
      }
      case 'ledgers': {
        const [awards, loot, contrib] = await Promise.all([
          admin.from('encounter_kill_awards').select('death_id, character_id, award_kind, tick_number').eq('encounter_id', body.encounterId),
          admin.from('encounter_death_loot').select('death_id, creature_id, mode, item_id, drop_chance, resolved, tick_number').eq('encounter_id', body.encounterId),
          admin.from('encounter_contributions').select('character_id, damage_dealt, healing_done').eq('encounter_id', body.encounterId),
        ]);
        for (const r of [awards, loot, contrib]) if (r.error) throw new Error(`ledgers: ${r.error.message}`);
        return json({ ok: true, awards: awards.data, loot: loot.data, contributions: contrib.data });
      }
      case 'durability': {
        const { data, error } = await admin
          .from('character_inventory')
          .select('id, item_id, equipped_slot, current_durability')
          .eq('character_id', body.characterId);
        if (error) throw new Error(`durability: ${error.message}`);
        return json({ ok: true, inventory: data });
      }
      case 'claim': {

        const claim = await rpc('claim_encounter_tick', {
          _encounter_id: body.encounterId,
          _rate_ms: body.rateMs ?? 2000,
          _lease_ms: body.leaseMs ?? 15000,
          _caller: 'c3-roundtrip',
          _supported_modes: ['shared', 'effects_only'],
        });
        return json({ ok: true, claim });
      }
      case 'snapshot': {
        const snapshot = await rpc('encounter_snapshot_v2', {
          _encounter_id: body.encounterId,
          _claim_token: body.claimToken,
          _tick: body.tick,
        });
        return json({ ok: true, snapshot });
      }
      case 'commit': {
        const result = await rpc('commit_encounter_tick_v2', {
          _encounter_id: body.encounterId,
          _tick: body.tick,
          _claim_token: body.claimToken,
          _batch_id: body.batchId,
          _snapshot_version: body.snapshotVersion,
          _encounter_version: body.encounterVersion,
          _snapshot_scope: body.snapshotScope,
          _snapshot_digest: body.snapshotDigest,
          _proposed: body.proposed,
        });
        return json({ ok: true, result });
      }
      case 'character': {
        const { data, error } = await admin
          .from('characters')
          .select('level, xp, hp, max_hp, cp, max_cp, mp, max_mp, str, dex, con, int, wis, cha, unspent_stat_points, respec_points, gold, rp_total_earned')
          .eq('id', body.characterId)
          .single();
        if (error) throw new Error(error.message);
        return json({ ok: true, character: data });
      }
      case 'teardown': {
        const out = await teardown(body.ids);
        return json({ ok: true, ...out });
      }
      default:
        return json({ ok: false, error: `unknown action: ${body.action}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
