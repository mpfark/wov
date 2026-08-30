import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260830064542_10f5dc3d-4931-4a0d-8fd9-2c7faa7bb412.sql', 'utf8',
);

describe('boss claim migration contract (offline)', () => {
  it('keeps the installed signature, fencing, refusal vocabulary and grants', () => {
    expect(sql).toContain('node_tick_claim(');
    expect(sql).toContain('_node_id uuid');
    expect(sql).toContain('_lease_ms integer DEFAULT 5000');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("'reason', 'locked_or_absent'");
    expect(sql).toContain("'kind', 'not_due'");
    expect(sql).toContain("'reason', 'in_flight'");
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid, integer) TO service_role');
  });

  it('captures authored boss_cast only through the claimed encounter roster', () => {
    expect(sql).toContain("'boss_cast', cr.boss_cast");
    expect(sql).toContain("'node_creature_id', nc.id");
    expect(sql).toContain("'spawn_seq', nc.spawn_seq");
    expect(sql).toContain('WHERE nc.encounter_id = e.id');
    expect(sql).not.toContain('FROM public.boss_ability');
  });

  it('contains no scheduler, deployment, or direct content mutation', () => {
    expect(sql).not.toMatch(/cron|pg_net|UPDATE public\.creatures|INSERT INTO public\.creatures/i);
  });
});
