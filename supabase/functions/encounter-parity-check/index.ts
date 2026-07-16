/**
 * encounter-parity-check
 * ----------------------
 * Automated shadow-parity harness for M2. Runs four scenarios against a
 * real creature row using the service role, compares the legacy
 * `damage_creature` path with the encounter delta RPCs, and restores
 * state after each scenario. Reports any HP / kill / aggression
 * divergence.
 *
 * Scenarios:
 *   1. solo           — single writer, single delta
 *   2. party_race     — two writers from the same snapshot (lost-update test)
 *   3. dot_wakeup     — DoT damage that exceeds current HP (overkill clamp)
 *   4. kill_respawn   — killing blow detaches the encounter row cleanly
 *
 * Auth: caller must be signed in as an Overlord (admin). Never expose to
 * end users — this mutates real creature rows.
 *
 * Trigger:
 *   supabase.functions.invoke('encounter-parity-check', {
 *     body: { creature_id?: string; damage?: number }
 *   })
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

type Scenario =
  | 'solo' | 'party_race' | 'dot_wakeup' | 'kill_respawn'
  | 'char_solo' | 'char_party_race' | 'char_dot_heal_interleave' | 'char_death_clamp';

interface Divergence {
  scenario: Scenario;
  field: string;
  legacy: unknown;
  encounter: unknown;
  note?: string;
}

interface ScenarioReport {
  scenario: Scenario;
  ok: boolean;
  details: Record<string, unknown>;
  divergences: Divergence[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // ── AuthN + AuthZ: overlord only ────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'missing bearer token' }, 401);

    const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userRes, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userRes.user) return json({ error: 'invalid token' }, 401);

    const db = createClient(url, service);
    const { data: isOverlord, error: roleErr } = await db.rpc('has_role', {
      _user_id: userRes.user.id,
      _role: 'overlord',
    });
    if (roleErr) return json({ error: 'role check failed', detail: roleErr.message }, 500);
    if (!isOverlord) return json({ error: 'forbidden: overlord role required' }, 403);

    // ── Parse input ─────────────────────────────────────────
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const damage = Math.max(1, Math.min(50, Number(body?.damage) || 5));
    let creatureId: string | null = body?.creature_id ?? null;

    if (!creatureId) {
      // Pick any alive creature with hp > damage*3 so we have headroom.
      const { data: pick } = await db
        .from('creatures')
        .select('id')
        .eq('is_alive', true)
        .gt('hp', damage * 3)
        .limit(1);
      creatureId = pick?.[0]?.id ?? null;
    }
    if (!creatureId) return json({ error: 'no live creature available; pass creature_id' }, 400);

    // ── Snapshot for restore ────────────────────────────────
    const { data: snap, error: snapErr } = await db
      .from('creatures')
      .select('id, hp, max_hp, is_alive, is_aggressive, base_aggressive, died_at')
      .eq('id', creatureId)
      .maybeSingle();
    if (snapErr || !snap) return json({ error: 'creature not found', detail: snapErr?.message }, 404);
    if (!snap.is_alive) return json({ error: 'creature must be alive for parity run' }, 400);

    const restore = async () => {
      await db
        .from('creatures')
        .update({
          hp: snap.hp,
          is_alive: snap.is_alive,
          is_aggressive: snap.is_aggressive,
          died_at: snap.died_at,
        })
        .eq('id', creatureId);
      await db.from('encounter_creatures').delete().eq('creature_id', creatureId);
    };

    const setHp = async (hp: number, alive = true) => {
      await db
        .from('creatures')
        .update({ hp, is_alive: alive, died_at: alive ? null : new Date().toISOString() })
        .eq('id', creatureId);
      await db.from('encounter_creatures').delete().eq('creature_id', creatureId);
    };

    const readCreature = async () => {
      const { data } = await db
        .from('creatures')
        .select('hp, is_alive, is_aggressive')
        .eq('id', creatureId)
        .maybeSingle();
      return data!;
    };

    const encounterAttached = async () => {
      const { data } = await db
        .from('encounter_creatures')
        .select('creature_id')
        .eq('creature_id', creatureId)
        .maybeSingle();
      return !!data;
    };

    const sourceCharId = userRes.user.id; // any uuid; contributions ledger only
    const reports: ScenarioReport[] = [];

    // ── 1. SOLO ─────────────────────────────────────────────
    {
      const divergences: Divergence[] = [];
      await setHp(snap.hp);
      // Legacy
      await db.rpc('damage_creature', { _creature_id: creatureId, _new_hp: snap.hp - damage, _killed: false });
      const afterLegacy = await readCreature();

      await setHp(snap.hp);
      // Encounter
      const encRes = await db.rpc('encounter_apply_damage', {
        _creature_id: creatureId, _amount: damage, _source_character_id: sourceCharId, _source_kind: 'autoattack',
      });
      const encRow = encRes.data?.[0];
      const afterEnc = await readCreature();

      if (afterLegacy.hp !== afterEnc.hp) divergences.push({ scenario: 'solo', field: 'hp', legacy: afterLegacy.hp, encounter: afterEnc.hp });
      if (encRow?.caused_kill) divergences.push({ scenario: 'solo', field: 'caused_kill', legacy: false, encounter: true });

      reports.push({
        scenario: 'solo',
        ok: divergences.length === 0,
        details: { damage, legacy_hp: afterLegacy.hp, encounter_hp: afterEnc.hp, encounter_row: encRow },
        divergences,
      });
      await restore();
    }

    // ── 2. PARTY RACE (lost-update demonstration) ───────────
    {
      const divergences: Divergence[] = [];
      const startHp = snap.hp;

      // Legacy: both writers see startHp, both write startHp-damage → lost update
      await setHp(startHp);
      await db.rpc('damage_creature', { _creature_id: creatureId, _new_hp: startHp - damage, _killed: false });
      await db.rpc('damage_creature', { _creature_id: creatureId, _new_hp: startHp - damage, _killed: false });
      const afterLegacy = await readCreature();

      // Encounter: two deltas of `damage` stack
      await setHp(startHp);
      await Promise.all([
        db.rpc('encounter_apply_damage', { _creature_id: creatureId, _amount: damage, _source_character_id: sourceCharId, _source_kind: 'autoattack' }),
        db.rpc('encounter_apply_damage', { _creature_id: creatureId, _amount: damage, _source_character_id: sourceCharId, _source_kind: 'autoattack' }),
      ]);
      const afterEnc = await readCreature();

      const expectedLegacy = startHp - damage;        // lost one write
      const expectedEnc = Math.max(startHp - 2 * damage, 0); // both writes preserved

      if (afterLegacy.hp !== expectedLegacy) divergences.push({ scenario: 'party_race', field: 'legacy_hp', legacy: afterLegacy.hp, encounter: expectedLegacy, note: 'legacy path did not lose update as expected' });
      if (afterEnc.hp !== expectedEnc) divergences.push({ scenario: 'party_race', field: 'encounter_hp', legacy: expectedEnc, encounter: afterEnc.hp, note: 'encounter path did not preserve both deltas' });

      reports.push({
        scenario: 'party_race',
        ok: divergences.length === 0,
        details: {
          start_hp: startHp, damage,
          legacy_final: afterLegacy.hp, legacy_expected: expectedLegacy,
          encounter_final: afterEnc.hp, encounter_expected: expectedEnc,
          damage_preserved_by_encounter: startHp - afterEnc.hp,
          damage_preserved_by_legacy: startHp - afterLegacy.hp,
        },
        divergences,
      });
      await restore();
    }

    // ── 3. DOT WAKEUP (overkill clamp) ──────────────────────
    {
      const divergences: Divergence[] = [];
      const lowHp = Math.max(1, Math.min(damage - 1, snap.hp));
      const overkill = damage * 3;

      await setHp(lowHp);
      const dry = await db.rpc('encounter_apply_damage_dry_run', { _creature_id: creatureId, _amount: overkill });
      const dryRow = dry.data?.[0];

      await setHp(lowHp);
      const encRes = await db.rpc('encounter_apply_damage', {
        _creature_id: creatureId, _amount: overkill, _source_character_id: sourceCharId, _source_kind: 'dot',
      });
      const encRow = encRes.data?.[0];
      const afterEnc = await readCreature();

      if (dryRow?.new_hp !== encRow?.new_hp) divergences.push({ scenario: 'dot_wakeup', field: 'new_hp', legacy: dryRow?.new_hp, encounter: encRow?.new_hp, note: 'dry_run vs live differ' });
      if (dryRow?.caused_kill !== encRow?.caused_kill) divergences.push({ scenario: 'dot_wakeup', field: 'caused_kill', legacy: dryRow?.caused_kill, encounter: encRow?.caused_kill });
      if (afterEnc.hp !== 0) divergences.push({ scenario: 'dot_wakeup', field: 'clamp_hp', legacy: 0, encounter: afterEnc.hp, note: 'overkill did not clamp to 0' });
      if (afterEnc.is_alive) divergences.push({ scenario: 'dot_wakeup', field: 'is_alive', legacy: false, encounter: true });

      reports.push({
        scenario: 'dot_wakeup',
        ok: divergences.length === 0,
        details: { low_hp: lowHp, overkill, dry_run: dryRow, live: encRow, final_hp: afterEnc.hp, final_alive: afterEnc.is_alive },
        divergences,
      });
      await restore();
    }

    // ── 4. KILL + RESPAWN (detach on kill) ──────────────────
    {
      const divergences: Divergence[] = [];
      const startHp = snap.hp;
      await setHp(startHp);

      const killRes = await db.rpc('encounter_apply_damage', {
        _creature_id: creatureId, _amount: startHp, _source_character_id: sourceCharId, _source_kind: 'autoattack',
      });
      const killRow = killRes.data?.[0];
      const afterKill = await readCreature();
      const attachedAfterKill = await encounterAttached();

      // Second call on dead creature should be a safe no-op.
      const noopRes = await db.rpc('encounter_apply_damage', {
        _creature_id: creatureId, _amount: 1, _source_character_id: sourceCharId, _source_kind: 'autoattack',
      });
      const noopRow = noopRes.data?.[0];

      if (!killRow?.caused_kill) divergences.push({ scenario: 'kill_respawn', field: 'caused_kill', legacy: true, encounter: killRow?.caused_kill });
      if (afterKill.hp !== 0) divergences.push({ scenario: 'kill_respawn', field: 'hp_after_kill', legacy: 0, encounter: afterKill.hp });
      if (afterKill.is_alive) divergences.push({ scenario: 'kill_respawn', field: 'is_alive_after_kill', legacy: false, encounter: true });
      if (attachedAfterKill) divergences.push({ scenario: 'kill_respawn', field: 'encounter_row_detached', legacy: false, encounter: true, note: 'encounter_creatures row should be gone after kill' });
      if (noopRow?.caused_kill) divergences.push({ scenario: 'kill_respawn', field: 'second_call_caused_kill', legacy: false, encounter: true });

      reports.push({
        scenario: 'kill_respawn',
        ok: divergences.length === 0,
        details: { start_hp: startHp, kill_row: killRow, after_kill: afterKill, encounter_attached_after_kill: attachedAfterKill, noop_row: noopRow },
        divergences,
      });
      await restore();
    }

    // ── Character-resource scenarios (M3) ───────────────────
    let charId: string | null = body?.character_id ?? null;
    if (!charId) {
      const { data: pickChar } = await db
        .from('characters')
        .select('id, hp, max_hp')
        .gt('hp', damage * 4)
        .limit(1);
      charId = pickChar?.[0]?.id ?? null;
    }

    if (charId) {
      const { data: cSnap, error: cSnapErr } = await db
        .from('characters')
        .select('id, hp, max_hp, cp, max_cp, mp, max_mp, active_effects, current_node_id')
        .eq('id', charId)
        .maybeSingle();

      if (!cSnapErr && cSnap) {
        const cRestore = async () => {
          await db
            .from('characters')
            .update({
              hp: cSnap.hp,
              cp: cSnap.cp,
              mp: cSnap.mp,
              active_effects: cSnap.active_effects,
            })
            .eq('id', charId);
          await db.from('encounter_participants').delete().eq('character_id', charId);
        };
        const cSetHp = async (hp: number) => {
          await db.from('characters').update({ hp }).eq('id', charId);
          await db.from('encounter_participants').delete().eq('character_id', charId);
        };
        const readChar = async () => {
          const { data } = await db
            .from('characters')
            .select('hp, cp, mp')
            .eq('id', charId)
            .maybeSingle();
          return data!;
        };

        // 5. CHAR_SOLO — dry_run vs live parity on one damage
        {
          const divergences: Divergence[] = [];
          const startHp = cSnap.hp;
          await cSetHp(startHp);
          const dry = await db.rpc('encounter_apply_character_damage_dry_run', {
            _character_id: charId, _amount: damage,
          });
          const dryRow = Array.isArray(dry.data) ? dry.data[0] : dry.data;

          await cSetHp(startHp);
          const live = await db.rpc('encounter_apply_character_damage', {
            _character_id: charId, _amount: damage,
            _source_kind: 'creature', _source_creature_id: null,
          });
          const liveRow = Array.isArray(live.data) ? live.data[0] : live.data;
          const after = await readChar();

          if (dryRow?.new_hp !== liveRow?.new_hp)
            divergences.push({ scenario: 'char_solo', field: 'new_hp', legacy: dryRow?.new_hp, encounter: liveRow?.new_hp });
          if (after.hp !== startHp - damage)
            divergences.push({ scenario: 'char_solo', field: 'persisted_hp', legacy: startHp - damage, encounter: after.hp });

          reports.push({
            scenario: 'char_solo', ok: divergences.length === 0,
            details: { start_hp: startHp, damage, dry: dryRow, live: liveRow, final_hp: after.hp },
            divergences,
          });
          await cRestore();
        }

        // 6. CHAR_PARTY_RACE — two concurrent damages, both preserved
        {
          const divergences: Divergence[] = [];
          const startHp = cSnap.hp;
          await cSetHp(startHp);
          await Promise.all([
            db.rpc('encounter_apply_character_damage', {
              _character_id: charId, _amount: damage,
              _source_kind: 'creature', _source_creature_id: null,
            }),
            db.rpc('encounter_apply_character_damage', {
              _character_id: charId, _amount: damage,
              _source_kind: 'creature', _source_creature_id: null,
            }),
          ]);
          const after = await readChar();
          const expected = Math.max(startHp - 2 * damage, 0);
          if (after.hp !== expected)
            divergences.push({ scenario: 'char_party_race', field: 'hp', legacy: expected, encounter: after.hp, note: 'concurrent damages did not stack' });

          reports.push({
            scenario: 'char_party_race', ok: divergences.length === 0,
            details: { start_hp: startHp, damage, expected_hp: expected, final_hp: after.hp },
            divergences,
          });
          await cRestore();
        }

        // 7. CHAR_DOT_HEAL_INTERLEAVE — dot + heal in same tick window
        {
          const divergences: Divergence[] = [];
          const startHp = Math.max(damage * 2, Math.min(cSnap.hp, cSnap.max_hp - damage));
          await cSetHp(startHp);
          await Promise.all([
            db.rpc('encounter_apply_character_damage', {
              _character_id: charId, _amount: damage,
              _source_kind: 'dot', _source_creature_id: null,
            }),
            db.rpc('encounter_apply_character_heal', {
              _character_id: charId, _amount: damage, _source_kind: 'potion',
            }),
          ]);
          const after = await readChar();
          if (after.hp !== startHp)
            divergences.push({ scenario: 'char_dot_heal_interleave', field: 'hp', legacy: startHp, encounter: after.hp, note: 'dot + equal heal should net zero' });

          reports.push({
            scenario: 'char_dot_heal_interleave', ok: divergences.length === 0,
            details: { start_hp: startHp, damage, final_hp: after.hp },
            divergences,
          });
          await cRestore();
        }

        // 8. CHAR_DEATH_CLAMP — overkill clamps at 0, second call no-op
        {
          const divergences: Divergence[] = [];
          const lowHp = Math.max(1, Math.min(damage - 1, cSnap.hp));
          const overkill = damage * 5;
          await cSetHp(lowHp);
          const killRes = await db.rpc('encounter_apply_character_damage', {
            _character_id: charId, _amount: overkill,
            _source_kind: 'creature', _source_creature_id: null,
          });
          const killRow = Array.isArray(killRes.data) ? killRes.data[0] : killRes.data;
          const afterKill = await readChar();

          const noopRes = await db.rpc('encounter_apply_character_damage', {
            _character_id: charId, _amount: 1,
            _source_kind: 'creature', _source_creature_id: null,
          });
          const noopRow = Array.isArray(noopRes.data) ? noopRes.data[0] : noopRes.data;

          if (afterKill.hp !== 0)
            divergences.push({ scenario: 'char_death_clamp', field: 'hp', legacy: 0, encounter: afterKill.hp });
          if (!killRow?.caused_death)
            divergences.push({ scenario: 'char_death_clamp', field: 'caused_death', legacy: true, encounter: killRow?.caused_death });
          if (noopRow?.caused_death)
            divergences.push({ scenario: 'char_death_clamp', field: 'second_call_caused_death', legacy: false, encounter: true });

          reports.push({
            scenario: 'char_death_clamp', ok: divergences.length === 0,
            details: { low_hp: lowHp, overkill, kill_row: killRow, after_kill_hp: afterKill.hp, noop_row: noopRow },
            divergences,
          });
          await cRestore();
        }
      }
    }

    const allDivergences = reports.flatMap((r) => r.divergences);
    return json({
      ok: allDivergences.length === 0,
      creature_id: creatureId,
      damage,
      reports,
      divergence_count: allDivergences.length,
      divergences: allDivergences,
    }, 200);
  } catch (err) {
    console.error('[encounter-parity-check] fatal', err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
