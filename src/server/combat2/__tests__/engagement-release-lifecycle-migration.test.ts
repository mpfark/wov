import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260922140000_combat2_engagement_release_lifecycle.sql', 'utf8').replaceAll('\r\n', '\n');
const resolver = readFileSync('src/shared/combat2/resolver.ts', 'utf8');

describe('authoritative Combat2 engagement and release lifecycle', () => {
  it('does not enter combat for peaceful co-location or an inert encounter shell', () => {
    const enter = sql.split('CREATE FUNCTION public.combat_enter(')[1].split('CREATE FUNCTION public.combat2_engage(')[0];
    expect(enter).toContain('c.is_aggressive');
    expect(enter).toContain("e.status = 'active'");
    expect(enter).toContain('nc.is_alive');
    expect(enter).toContain('nc.engaged');
    expect(enter).toContain("'kind', 'no_engagement'");
  });

  it('preserves shared active encounter entry and explicit aggressive entry', () => {
    expect(sql).toContain('RETURN public.combat_enter_without_engagement_gate(_character_id, _request_id)');
    expect(sql).toContain('JOIN public.node_creature nc ON nc.encounter_id = e.id');
  });

  it('makes deliberate peaceful engagement one atomic, replay-safe entry plus intent', () => {
    const engage = sql.split('CREATE FUNCTION public.combat2_engage(')[1];
    expect(engage).toContain('v_entry := public.combat_enter_without_engagement_gate');
    expect(engage).toContain("'basic_attack'");
    expect(engage).toContain('_target_creature_id');
    expect(engage).toContain('_request_id');
    expect(engage).toContain("EXCEPTION WHEN SQLSTATE 'P0001'");
  });

  it('ends an encounter when no living engaged creature or durable effect remains', () => {
    expect(resolver).toContain('c.hp > 0 && c.row.is_alive && c.engaged');
    expect(resolver).toContain("if (!anythingPending) proposed.status = 'ended'");
  });

  it('keeps browser authority narrow and underlying entry server-only', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.combat_enter_without_engagement_gate(uuid, uuid)');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.combat2_engage(uuid, uuid, uuid) TO authenticated, service_role');
  });
});
