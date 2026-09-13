import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260913100000_combat2_production_cutover.sql', 'utf8')
  .replaceAll('\r\n', '\n').toLowerCase().replace(/\s+/g, ' ');
const movement = readFileSync('supabase/migrations/20260912140000_combat2_departure_state_projection.sql', 'utf8')
  .replaceAll('\r\n', '\n').toLowerCase();

describe('Combat2 production cutover migration', () => {
  it('makes ordinary nodes eligible without deleting the historical canary schema', () => {
    expect(sql).toContain('exists(select 1 from public.nodes n where n.id=_node_id)');
    expect(sql).not.toContain('combat2_node_canary');
    expect(sql).toContain('combat2_test_arena_node');
    expect(sql).toContain('t.active and a.active');
    expect(sql).not.toContain('drop table');
  });

  it('derives identity, verifies character ownership/location, and isolates arena authorization', () => {
    expect(sql).toContain('caller uuid:=auth.uid()');
    expect(sql).toContain('c.id=_character_id and c.user_id=caller and c.current_node_id=_node_id');
    expect(sql).toContain('combat2_test_arena_access_allowed(caller,_character_id,_node_id)');
    expect(sql).toContain("case when arena is null then 'ordinary_world' else 'test_arena' end");
  });

  it('wakes atomically and fails closed if scheduler activation fails', () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('combat2-production-activation'))");
    expect(sql).toContain("update public.combat_config set value='open'");
    expect(sql).toContain('perform public.wake_world()');
    expect(sql).toContain('scheduler:=public.combat2_dispatch_scheduler_enable()');
    expect(sql).toContain('perform public.combat2_dispatch_scheduler_disable()');
    expect(sql).toContain("update public.combat_config set value='maintenance'");
    expect(sql).toContain('perform public.shutdown_world()');
  });

  it('uses server-timestamped expiring presence and protects live claims', () => {
    expect(sql).toContain('seen_at timestamptz not null default clock_timestamp()');
    expect(sql).toContain('seen_at=clock_timestamp()');
    expect(sql).toContain("p.seen_at>now()-interval '30 minutes'");
    expect(sql).toContain("p.seen_at>now()-interval '5 minutes'");
    expect(sql).toContain('claim_token is not null and claim_expires_at>now()');
    expect(sql).toContain('perform public.return_unique_items()');
    expect(sql).not.toContain('last_online');
    expect(sql).toContain('revoke all on table public.combat2_player_presence from public,anon,authenticated');
  });

  it('preserves the authoritative departure-state repair', () => {
    expect(movement).toContain('combat2_departure_state');
    expect(movement).toContain('combat2_departure_request');
    expect(movement).toContain("'request_id',d.request_id");
    expect(movement).toContain("'status',d.status");
  });
});
