import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260923100000_authoritative_ooc_resource_settlement.sql', 'utf8').replaceAll('\r\n', '\n');
const loop = readFileSync('src/features/combat/hooks/useGameLoop.ts', 'utf8');

describe('authoritative out-of-combat resource settlement', () => {
  it('uses the existing scheduler with a durable four-second cursor and bounded catch-up', () => {
    expect(sql).toContain("date_bin(interval '4 seconds'");
    expect(sql).toContain("WHEN elapsed <= 3 THEN elapsed ELSE 1");
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain("combat2_dispatch_scheduler_fire_without_resource_settlement");
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
    expect(sql).toContain('FOR c IN SELECT * FROM public.characters ORDER BY id FOR UPDATE LOOP');
    expect(sql).not.toMatch(/WHERE c\.current_node_id\s*=/);
  });

  it('uses effective equipped attributes, valid durable gear, gems and canonical caps', () => {
    expect(sql).toContain('ci.equipped_slot IS NOT NULL AND ci.current_durability > 0');
    expect(sql).toContain("(gems->>'emerald')");
    expect(sql).toContain("(gems->>'sapphire')");
    expect(sql).toContain("(gems->>'pearl')");
    expect(sql).toContain("(gems->>'topaz')");
    expect(sql).toContain('effective_con := c.con + bonus_con');
    expect(sql).toContain('effective_wis := c.wis + bonus_wis');
    expect(sql).toContain('effective_dex := c.dex + bonus_dex');
    expect(sql).toContain('hp_cap :=');
    expect(sql).toContain('cp_cap :=');
    expect(sql).toContain('mp_cap :=');
  });

  it('preserves canonical HP, CP and MP rates without browser food or Inspire', () => {
    expect(sql).toContain('2 + floor(sqrt(greatest(effective_con - 10, 0)))');
    expect(sql).toContain('2 + floor(sqrt(greatest(effective_wis - 10, 0)))');
    expect(sql).toContain('round((5 + dex_mod) * 0.67)::integer * 2');
    expect(sql).toContain('bonus_hp_regen');
    expect(sql).toContain('WHEN c.level >= 40 THEN 10');
    expect(sql).toContain('WHEN c.level >= 40 THEN 5');
    expect(sql).toContain('WHEN n.is_inn THEN 10');
    expect(sql).not.toMatch(/food|inspire/i);
  });

  it('fails closed for sleep, maintenance, death, Combat2 ownership and transition races', () => {
    expect(sql).toContain('NOT public.world_state_is_awake()');
    expect(sql).toContain('NOT public.combat_mode_is_open()');
    expect(sql).toContain('c.hp <= 0');
    expect(sql).toContain("d.status = 'queued'");
    expect(sql).toContain('d.resolved_at >= bucket');
    expect(sql).toContain("m.status IN ('waiting','queued')");
    expect(sql).toContain('m.resolved_at >= bucket');
    expect(sql).toContain('rr.created_at >= bucket');
    expect(sql).toContain('released.left_at >= bucket');
    expect(sql).toContain("e.status = 'active'");
    expect(sql).toContain('f.present');
    expect(sql).toContain('nc.engaged');
    expect(sql).toContain('e.claim_token IS NOT NULL AND e.claim_expires_at > _now');
    expect(sql).toContain('combat2_test_arena_node');
  });

  it('does not let peaceful creatures or inert/absent encounter shells suppress settlement', () => {
    expect(sql).toContain('nc.is_alive AND nc.hp > 0 AND nc.engaged');
    expect(sql).toContain('(f.present AND EXISTS');
    expect(sql).not.toContain('nc.is_aggressive');
  });

  it('is idempotent, monotonic and inaccessible to browser roles', () => {
    expect(sql).toContain("'already_settled'");
    expect(sql).toContain('WHERE singleton FOR UPDATE');
    expect(sql).toContain('CASE WHEN hp < hp_cap');
    expect(sql).toContain('CASE WHEN cp < cp_cap');
    expect(sql).toContain('CASE WHEN mp < mp_cap');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.settle_out_of_combat_resources(timestamptz) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.settle_out_of_combat_resources(timestamptz) TO service_role');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('leaves the browser as a display-only resource consumer', () => {
    expect(loop).toContain('HP/CP/MP regeneration is server-authoritative');
    expect(loop).not.toContain('pendingRegenFlushRef');
    expect(loop).not.toContain('updateCharRegenRef');
    expect(loop).not.toContain('foodCpRegen');
  });
});
