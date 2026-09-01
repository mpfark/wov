import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'supabase/migrations/20260901104835_d1bb417e-56d2-4c4b-b34b-afbad1c26d5e.sql';
const sql = readFileSync(path, 'utf8');
const normal = sql.toLowerCase().replace(/\s+/g, ' ');
const syncBody = normal.split('create or replace function public.combat2_sync(')[1]
  .split('revoke all on function public.combat2_sync')[0];

describe('Combat2 durable delivery migration', () => {
  it('uses ownership plus durable encounter participation, never party or node proximity', () => {
    expect(normal).toContain('public.owns_character(_character_id)');
    expect(normal).toContain('from public.node_fighter nf where nf.encounter_id = _encounter_id and nf.character_id = _character_id');
    expect(normal).not.toMatch(/nf\.present\s*=\s*true/);
    expect(normal).toContain("np.qualification = 'qualified'");
    expect(normal).not.toContain('party_members');
    expect(normal).not.toContain('current_node_id');
  });

  it('is read-only, bounded, stable, ascending and strictly cursor-based', () => {
    expect(syncBody).toContain('language plpgsql stable security definer');
    expect(syncBody).toContain('least(coalesce(_limit, 25), 50)');
    expect(syncBody).toContain('and b.tick > v_after order by b.tick asc limit v_limit');
    expect(syncBody).not.toMatch(/\b(update|delete|insert into)\b/);
    expect(normal).toContain("'kind', 'gap_detected'");
    expect(normal).toContain("'latest_tick', v_encounter.tick");
    expect(normal).toContain("'returned_through_tick', v_returned");
    expect(normal).toContain("'has_more', v_returned < v_encounter.tick");
  });

  it('returns current own authority and durable offscreen reward recovery', () => {
    expect(syncBody).toContain("'hp', c.hp, 'maxhp', c.max_hp");
    expect(syncBody).toContain("'xp', c.xp, 'gold', c.gold");
    expect(syncBody).toContain("'present', nf.present");
    expect(syncBody).toContain('from public.node_reward_claim rc');
    expect(syncBody).toContain('from public.node_creature nc where nc.encounter_id = _encounter_id');
    expect(syncBody).toContain("'pendingaction'");
    expect(syncBody).toContain("'effects', v_effects");
  });

  it('projects events explicitly and closes raw server-owned table reads', () => {
    for (const table of ['node_encounter', 'node_creature', 'node_fighter', 'node_effect', 'node_tick_batch', 'node_participation']) {
      expect(normal).toContain(`revoke select on public.${table} from authenticated`);
    }
    expect(syncBody).toContain("'events', projected.events");
    expect(syncBody).not.toContain("'payload', ev.value->'payload'");
    for (const forbidden of ['claim_token', 'claim_expires_at', 'claimed_tick', 'intent_cutoff_seq', 'snapshot', 'service_role_key']) {
      expect(syncBody).not.toContain(forbidden);
    }
  });

  it('grants RPC execution only to authenticated and service role', () => {
    expect(normal).toContain('revoke all on function public.combat2_sync(uuid, uuid, bigint, integer) from public, anon');
    expect(normal).toContain('grant execute on function public.combat2_sync(uuid, uuid, bigint, integer) to authenticated, service_role');
  });
});

describe('Combat2 Realtime wake-up notification', () => {
  it('is emitted only after a committed batch insert with identifiers only', () => {
    expect(normal).toContain('after insert on public.node_tick_batch');
    expect(normal).toContain('insert into public.combat2_tick_notification (batch_id, encounter_id, tick)');
    const table = normal.split('create table public.combat2_tick_notification')[1].split(');')[0];
    expect(table).not.toContain('events');
    expect(table).not.toContain('payload');
    expect(table).not.toContain('token');
    expect(table).not.toContain('snapshot');
  });

  it('uses the supported Postgres Changes publication with participant RLS', () => {
    expect(normal).toContain('alter publication supabase_realtime add table public.combat2_tick_notification');
    expect(normal).toContain('using (public.combat2_delivery_visible(encounter_id))');
    expect(normal).toContain('revoke all on table public.combat2_tick_notification from public, anon');
    expect(normal).not.toContain('realtime.broadcast');
    expect(normal).not.toContain('channel_name');
  });
});
