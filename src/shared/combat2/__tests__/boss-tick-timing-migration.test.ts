import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260914110000_combat2_boss_tick_timing.sql', 'utf8')
  .replaceAll('\r\n', '\n').toLowerCase();

describe('boss tick timing migration contract', () => {
  it('adds one server-owned spawn-fenced cooldown row per ability', () => {
    expect(sql).toContain('create table public.node_boss_ability_cooldown');
    expect(sql).toContain('primary key(encounter_id,node_creature_id,spawn_seq,ability_key)');
    expect(sql).toContain('alter table public.node_boss_ability_cooldown enable row level security');
    expect(sql).toContain('revoke all on table public.node_boss_ability_cooldown from public,anon,authenticated');
    expect(sql).toContain('grant select,insert,update,delete on table public.node_boss_ability_cooldown to service_role');
  });

  it('captures cooldowns in claims and fences their atomic commit', () => {
    expect(sql).toContain("'{snapshot,boss_cooldowns}'");
    expect(sql).toContain("r->>'encounter_id'<>_encounter_id::text");
    expect(sql).toContain("nc.spawn_seq=(r->>'spawn_seq')::bigint");
    expect(sql).toContain("expected_next_available_tick");
    expect(sql).toContain("result->>'kind'='committed'");
    expect(sql).toContain('on conflict(encounter_id,node_creature_id,spawn_seq,ability_key) do update');
  });

  it('projects only bounded dynamic cast state and preserves Drowning Toll 24 plus 10', () => {
    expect(sql).toContain("'targetmode',nc.pending_action->>'target_mode'");
    expect(sql).toContain("'targetcharacterid',null");
    expect(sql).not.toContain("'rng");
    const syncProjection = sql.slice(sql.indexOf("'pendingaction'"));
    expect(syncProjection).not.toContain('claim_token');
    expect(sql).toContain("boss_cast->>'base_amount')::numeric=24");
    expect(sql).toContain("boss_cast->>'base_aoe_amount')::numeric=10");
  });
});
