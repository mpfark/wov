/**
 * c4-delivery-harness — controlled C4 delivery validation runner.
 *
 * Runs the batch/RLS/retention scenarios against isolated fixtures inside a
 * single transaction that is always ROLLED BACK, so live data is untouched.
 * RLS is exercised for real by switching to the `authenticated` role with the
 * claims of three distinct real users, exactly as PostgREST would.
 *
 * Admin-only: requires an Overlord bearer token.
 */
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3.4.4';

interface CaseResult { case: string; pass: boolean; detail?: unknown }

const claims = (userId: string) =>
  JSON.stringify({ sub: userId, role: 'authenticated' });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  // ── Admin gate ────────────────────────────────────────────────────────────
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const { data: userData } = await admin.auth.getUser(token);
  const uid = userData?.user?.id;
  if (!uid) return json({ error: 'unauthenticated' }, 401);
  const { data: isOverlord } = await admin.rpc('has_role', { _user_id: uid, _role: 'overlord' });
  if (!isOverlord) return json({ error: 'forbidden' }, 403);

  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
  const cases: CaseResult[] = [];
  const push = (name: string, pass: boolean, detail?: unknown) =>
    cases.push({ case: name, pass, detail });

  try {
    await sql.begin(async (tx) => {
      const users = await tx<{ id: string; user_id: string }[]>`
        select distinct on (user_id) id, user_id from public.characters c
        where not exists (select 1 from public.encounter_participants p where p.character_id = c.id)
        order by user_id, created_at limit 3`;
      if (users.length < 3) throw new Error('need three distinct users for isolation');
      const [owner, left, other] = users;
      const [{ id: nodeId }] = await tx<{ id: string }[]>`select id from public.nodes limit 1`;
      const [{ id: encId }] = await tx<{ id: string }[]>`
        insert into public.encounters (node_id, encounter_key, status, tick_number, tick_at, tick_state, tick_owner)
        values (${nodeId}, ${'c4-harness:' + crypto.randomUUID()}, 'active', 100, 0, 'idle', 'shared')
        returning id`;

      await tx`insert into public.encounter_participants (encounter_id, character_id)
               values (${encId}, ${owner.id}), (${encId}, ${left.id})`;
      // Contiguous committed batches with a deliberate hole at tick 96.
      await tx`insert into public.encounter_tick_batches (encounter_id, tick_number, batch_id, payload)
               select ${encId}, t, gen_random_uuid(), jsonb_build_object('v', 3, 'tick', t)
               from generate_series(93, 100) t where t <> 96`;

      const asUser = async (userId: string) => {
        await tx.unsafe(`set local role authenticated`);
        await tx`select set_config('request.jwt.claims', ${claims(userId)}, true)`;
      };
      const asServer = async () => {
        await tx.unsafe(`reset role`);
        await tx`select set_config('request.jwt.claims', NULL, true)`;
      };
      const visibleTicks = async () => {
        const rows = await tx<{ tick_number: number }[]>`
          select tick_number from public.encounter_tick_batches
          where encounter_id = ${encId} order by tick_number`;
        return rows.map(r => Number(r.tick_number));
      };
      // Savepoint-scoped: a denied resync raises, which would otherwise poison
      // the surrounding transaction and abort the remaining scenarios.
      const resync = async (charId: string) => {
        try {
          let snap: unknown;
          await tx.savepoint(async (sp) => {
            const [row] = await sp<{ encounter_resync_snapshot: unknown }[]>`
              select public.encounter_resync_snapshot(${encId}::uuid, ${charId}::uuid)`;
            snap = row.encounter_resync_snapshot;
          });
          return { ok: true, snap } as const;
        } catch (e) {
          return { ok: false, error: (e as Error).message } as const;
        }
      };

      // 1. Current participant.
      await asUser(owner.user_id);
      let ticks = await visibleTicks();
      push('current_participant_reads_batches', ticks.length === 7, ticks);

      // 2. Missing tick recovery: the hole is genuinely absent, neighbours are not.
      push('missing_tick_detectable', !ticks.includes(96) && ticks.includes(95) && ticks.includes(97), ticks);

      // 3. Ordering and duplicate-freedom at the source of delivery.
      const ordered = ticks.every((t, i) => i === 0 || t > ticks[i - 1]);
      push('ordered_and_duplicate_free', ordered && new Set(ticks).size === ticks.length, ticks);

      // 4. Authoritative resynchronisation for a participant.
      const r1 = await resync(owner.id);
      const snap = (r1.ok ? r1.snap : null) as Record<string, unknown> | null;
      push('resync_snapshot_participant',
        r1.ok && !!snap && 'tick' in snap && 'character' in snap && 'creatures' in snap && 'engaged_creature_ids' in snap,
        r1.ok ? { tick: snap?.tick, retained_from_tick: snap?.retained_from_tick } : r1);

      // 5. Unrelated user denied on both paths.
      await asUser(other.user_id);
      ticks = await visibleTicks();
      push('unrelated_user_denied_batches', ticks.length === 0, ticks);
      const r2 = await resync(owner.id);
      push('unrelated_user_denied_resync', !r2.ok && /not_authorized/.test(r2.ok ? '' : r2.error), r2);

      // 6. Access grant minted when participation is deleted.
      await asServer();
      await tx`delete from public.encounter_participants
               where encounter_id = ${encId} and character_id = ${left.id}`;
      const grants = await tx<{ expires_at: string }[]>`
        select expires_at from public.encounter_access_grants
        where encounter_id = ${encId} and character_id = ${left.id}`;
      const graceSeconds = grants.length
        ? Math.round((new Date(grants[0].expires_at).getTime() - Date.now()) / 1000)
        : null;
      push('grant_minted_on_participation_delete',
        grants.length === 1 && (graceSeconds ?? 0) > 240, { graceSeconds });

      // 7. Recently departed participant reads under the grant.
      await asUser(left.user_id);
      ticks = await visibleTicks();
      push('departed_participant_reads_under_grant', ticks.length === 7, ticks);
      const r3 = await resync(left.id);
      push('departed_participant_resync_under_grant', r3.ok, r3.ok ? 'ok' : r3);

      // 8. Expired grant closes access again.
      await asServer();
      await tx`update public.encounter_access_grants set expires_at = now() - interval '1 second'
               where encounter_id = ${encId} and character_id = ${left.id}`;
      await asUser(left.user_id);
      ticks = await visibleTicks();
      push('expired_grant_denied_batches', ticks.length === 0, ticks);
      const r4 = await resync(left.id);
      push('expired_grant_denied_resync', !r4.ok && /not_a_participant/.test(r4.ok ? '' : r4.error), r4);

      // 9. Batch pruned before return, then authoritative resynchronisation.
      await asServer();
      await tx`update public.encounter_tick_batches set created_at = now() - interval '10 minutes'
               where encounter_id = ${encId} and tick_number < 97`;
      await tx`select public.prune_encounter_tick_batches(180, 2000)`;
      const remaining = await tx<{ n: number }[]>`
        select count(*)::int as n from public.encounter_tick_batches
        where encounter_id = ${encId} and tick_number < 97`;
      await asUser(owner.user_id);
      const r5 = await resync(owner.id);
      const snap5 = (r5.ok ? r5.snap : null) as Record<string, unknown> | null;
      push('batch_pruned_then_resync',
        remaining[0].n === 0 && r5.ok && snap5?.tick !== undefined,
        { pruned_old_batches: 7 - Number(remaining[0].n), retained_from_tick: snap5?.retained_from_tick });

      // 10. Grant pruning is bounded, lagged by 60s, and only removes stale rows.
      await asServer();
      await tx`select public.prune_encounter_access_grants(2000)`;
      const justExpired = await tx<{ n: number }[]>`
        select count(*)::int as n from public.encounter_access_grants
        where encounter_id = ${encId} and character_id = ${left.id}`;
      // A grant that expired one second ago is intentionally kept (60s lag), so
      // an in-flight recovery is never cut off mid-request.
      push('recently_expired_grant_kept_by_prune_lag', justExpired[0].n === 1, justExpired[0].n);

      await tx`update public.encounter_access_grants set expires_at = now() - interval '5 minutes'
               where encounter_id = ${encId} and character_id = ${left.id}`;
      await tx`select public.prune_encounter_access_grants(2000)`;
      const stale = await tx<{ n: number }[]>`
        select count(*)::int as n from public.encounter_access_grants
        where encounter_id = ${encId} and expires_at < now() - interval '60 seconds'`;
      push('stale_grants_pruned', stale[0].n === 0, stale[0].n);

      // Always roll back: the fixtures never touch live data.
      throw new RollbackSignal();
    }).catch((e) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });

    push('fixtures_rolled_back', true);
    return json({ all_pass: cases.every(c => c.pass), cases });
  } catch (e) {
    return json({ error: (e as Error).message, cases }, 500);
  } finally {
    await sql.end();
  }
});

class RollbackSignal extends Error {}
