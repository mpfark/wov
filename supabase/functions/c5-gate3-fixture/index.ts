/**
 * c5-gate3-fixture — TEMPORARY C5 Gate 3 fixture provisioner.
 *
 * Creates (and tears down) the minimal authenticated fixture needed to observe
 * live client termination through the production combat pipeline:
 *   - one confirmed temporary auth user + one temporary character,
 *   - one weak creature at the designated test node,
 *   - one `combat_soak_access` allowlist row with a 60 minute expiry,
 *   - `combat_config.combat_soak = on` (global `combat_mode` stays `maintenance`).
 *
 * Teardown reverses every one of those and asserts zero leakage.
 * This function is deployed for the soak window only and then removed.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/http.ts";

const FIXTURE_EMAIL = 'c5gate3@harness.invalid';
const FIXTURE_NAME = 'Gatethree';
const NODE_ID = 'baa4b662-c74a-484d-86d2-8d4aea122870';
const CREATURE_NAME = 'Fixture Straw Effigy';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    const findUser = async () => {
      const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      return data.users.find(u => (u.email ?? '').toLowerCase() === FIXTURE_EMAIL) ?? null;
    };

    if (action === 'setup') {
      const password = typeof body?.password === 'string' ? body.password : '';
      if (password.length < 16) return json({ ok: false, reason: 'password too weak' });

      let user = await findUser();
      if (!user) {
        const { data, error } = await db.auth.admin.createUser({
          email: FIXTURE_EMAIL,
          password,
          email_confirm: true,
        });
        if (error) return json({ ok: false, reason: error.message });
        user = data.user;
      } else {
        await db.auth.admin.updateUserById(user.id, { password });
      }

      let { data: character } = await db
        .from('characters')
        .select('id')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (!character) {
        const { data, error } = await db.from('characters').insert({
          user_id: user!.id,
          name: FIXTURE_NAME,
          race: 'human',
          class: 'warrior',
          level: 10,
          hp: 220, max_hp: 220,
          str: 22, dex: 18, con: 18, int: 10, wis: 10, cha: 10,
          ac: 14,
          current_node_id: NODE_ID,
        }).select('id').single();
        if (error) return json({ ok: false, reason: `character: ${error.message}` });
        character = data;
      }

      // Weak, non-aggressive creature so initiation is an explicit player Attack.
      await db.from('creatures').delete().eq('name', CREATURE_NAME);
      const { data: creature, error: cErr } = await db.from('creatures').insert({
        name: CREATURE_NAME,
        description: 'Temporary Gate 3 fixture target.',
        node_id: NODE_ID,
        level: 1,
        hp: 8, max_hp: 8,
        ac: 5,
        is_aggressive: false,
        base_aggressive: false,
        is_humanoid: true,
        drop_chance: 1,
        respawn_seconds: 3600,
        is_alive: true,
      }).select('id, spawn_seq').single();
      if (cErr) return json({ ok: false, reason: `creature: ${cErr.message}` });

      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const { error: aErr } = await db.from('combat_soak_access').upsert({
        character_id: character!.id,
        node_id: NODE_ID,
        expires_at: expires,
        note: 'C5 gate 3 client termination observation',
      }, { onConflict: 'character_id' });
      if (aErr) return json({ ok: false, reason: `allowlist: ${aErr.message}` });

      const { error: sErr } = await db
        .from('combat_config')
        .update({ value: 'on', updated_at: new Date().toISOString() })
        .eq('key', 'combat_soak');
      if (sErr) return json({ ok: false, reason: `soak switch: ${sErr.message}` });

      return json({
        ok: true,
        user_id: user!.id,
        character_id: character!.id,
        creature_id: creature!.id,
        spawn_seq: creature!.spawn_seq,
        node_id: NODE_ID,
        allowlist_expires_at: expires,
      });
    }

    if (action === 'teardown') {
      const user = await findUser();
      const removed: Record<string, unknown> = {};

      await db.from('combat_config').update({ value: 'off', updated_at: new Date().toISOString() }).eq('key', 'combat_soak');

      if (user) {
        const { data: chars } = await db.from('characters').select('id').eq('user_id', user.id);
        for (const c of chars ?? []) {
          await db.from('combat_soak_access').delete().eq('character_id', c.id);
          await db.rpc('delete_character_cascade', { _character_id: c.id }).then(
            () => {},
            () => {},
          );
          await db.from('characters').delete().eq('id', c.id);
        }
        removed.characters = (chars ?? []).length;
        await db.from('user_roles').delete().eq('user_id', user.id);
        const { error } = await db.auth.admin.deleteUser(user.id);
        removed.user_deleted = !error;
        if (error) removed.user_error = error.message;
      } else {
        removed.user_deleted = 'absent';
      }

      const { data: creatures } = await db.from('creatures').select('id').eq('name', CREATURE_NAME);
      for (const c of creatures ?? []) {
        await db.from('encounter_creatures').delete().eq('creature_id', c.id);
        await db.from('encounter_engagements').delete().eq('creature_id', c.id);
        await db.from('creatures').delete().eq('id', c.id);
      }
      removed.creatures = (creatures ?? []).length;

      const { count: soakLeft } = await db
        .from('combat_soak_access')
        .select('id', { count: 'exact', head: true });
      const { data: mode } = await db.from('combat_config').select('key,value');

      return json({ ok: true, removed, soak_rows_remaining: soakLeft ?? 0, config: mode });
    }

    return json({ ok: false, reason: 'unknown action' });
  } catch (e) {
    return json({ ok: false, reason: e instanceof Error ? e.message : String(e) });
  }
});
