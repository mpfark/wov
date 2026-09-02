import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260902093129_6e2ff6de-db65-4d4d-83e1-dadcfebaa70c.sql', 'utf8')
  .toLowerCase().replace(/\s+/g, ' ');

describe('Combat2 arrival, tank, engagement and opportunity authority migration', () => {
  it('stores one serialized encounter-scoped group generation and captured fighter membership', () => {
    expect(sql).toContain('create table public.node_arrival_group');
    expect(sql).toContain('arrival_seq bigserial');
    expect(sql).toContain('node_arrival_group_active_party_uniq');
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('combat_enter_node:'");
    expect(sql).toContain('arrival_group_id uuid references public.node_arrival_group');
    expect(sql).toContain("pm.status='accepted'");
  });

  it('uses the existing party designation with leader and newest-member fallback', () => {
    expect(sql).toContain('create or replace function public.set_party_tank');
    expect(sql).toContain('when nf.character_id = p.tank_id then 0');
    expect(sql).toContain('when nf.character_id = p.leader_id then 1');
    expect(sql).toContain('nf.entry_seq desc');
    expect(sql).toContain('create trigger combat2_party_tank_changed');
    const partyHook = readFileSync('src/features/party/hooks/useParty.ts', 'utf8');
    expect(partyHook).toContain("supabase.rpc('set_party_tank'");
    expect(partyHook).not.toContain("from('parties').update({ tank_id:");
  });

  it('queues flee, rejects ordinary pending intents, and leaves presence for tick resolution', () => {
    const flee = sql.split('create or replace function public.combat_flee')[1].split('revoke all on function public.combat_enter')[0];
    expect(flee).toContain("'fighter_exit_requested'");
    expect(flee).toContain("reject_reason='exit_pending'");
    expect(flee).not.toContain('set present=false');
    expect(flee).toContain("'kind','queued'");
  });

  it('persists engagement only from hostile participation and safely projects tank state', () => {
    expect(sql).toContain("new.qualified_by in ('damage','debuff')");
    expect(sql).toContain('set engaged = true');
    expect(sql).toContain('tankfighterid');
    expect(sql).toContain('nc.tank_fighter_id');
    expect(sql).toContain('nc.engaged');
    expect(sql).toContain('revoke all on public.node_arrival_group from public, anon, authenticated');
  });
});
