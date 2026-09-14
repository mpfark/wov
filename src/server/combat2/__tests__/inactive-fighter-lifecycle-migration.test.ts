import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lifecycle = readFileSync('supabase/migrations/20260915120000_combat2_inactive_fighter_lifecycle.sql', 'utf8')
  .replaceAll('\r\n', '\n');
const resolver = readFileSync('src/shared/combat2/resolver.ts', 'utf8');
const entry = readFileSync('supabase/migrations/20260902123413_f5e0f14f-b91d-451a-a267-fbe6fea9665c.sql', 'utf8');
const arena = readFileSync('supabase/migrations/20260906001238_8c52869c-2e3d-4602-aa5a-96ea750f63d6.sql', 'utf8');
const respawn = readFileSync('supabase/migrations/20260907105429_656d5fe4-3405-40f5-8ece-66802dd61dd2.sql', 'utf8');
const special = readFileSync('supabase/migrations/20260915100000_combat2_special_transition_fences.sql', 'utf8');

describe('inactive Combat2 fighter lifecycle', () => {
  it('closes all present fighters exactly when an active encounter becomes inactive', () => {
    expect(lifecycle).toContain("IF OLD.status = 'active' AND NEW.status <> 'active' THEN");
    expect(lifecycle).toContain('AFTER UPDATE OF status ON public.node_encounter');
    expect(lifecycle).toContain('WHEN (OLD.status IS DISTINCT FROM NEW.status)');
    expect(lifecycle).toMatch(/UPDATE public\.node_fighter[\s\S]*SET present = false,[\s\S]*left_at = COALESCE\(left_at, clock_timestamp\(\)\)[\s\S]*WHERE encounter_id = NEW\.id[\s\S]*AND present;/);
  });

  it('preserves historical rows and is replay-safe without backfilling existing data', () => {
    expect(lifecycle).not.toMatch(/DELETE FROM public\.node_fighter/i);
    expect(lifecycle).not.toMatch(/UPDATE public\.node_fighter[\s\S]*JOIN public\.node_encounter/i);
    expect(lifecycle).toContain('COALESCE(left_at, clock_timestamp())');
    expect(lifecycle).toContain('DROP TRIGGER IF EXISTS combat2_close_inactive_encounter_fighters');
  });

  it('covers ordinary completion and creature death through the resolver/commit status boundary', () => {
    expect(resolver).toContain("if (!anythingPending) proposed.status = 'ended'");
    expect(resolver).toContain('proposed.fighters.push({ id: character.fighter.id, present: false })');
  });

  it('retains neighboring explicit cleanup for reactivation, respawn, and Test Arena stop/reset', () => {
    for (const sql of [entry, arena, respawn]) {
      expect(sql).toMatch(/UPDATE public\.node_fighter SET present=false/);
    }
    expect(entry).toContain("ELSIF e.status <> 'active' THEN");
    expect(arena).toContain("status='ended',stop_reason='test_stop'");
    expect(respawn).toContain('WHERE character_id=_character_id');
  });

  it('keeps active-encounter filtering on movement and special-transition readers', () => {
    expect(special).toMatch(/f\.character_id=_character_id AND f\.present AND e\.status='active'/);
    expect(special).toMatch(/e\.node_id=_node_id AND e\.status='active'/);
  });

  it('does not grant browser roles authority to mutate fighter lifecycle state', () => {
    expect(lifecycle).toContain('SECURITY DEFINER');
    expect(lifecycle).toContain('REVOKE ALL ON FUNCTION public.combat2_close_inactive_encounter_fighters() FROM PUBLIC, anon, authenticated');
    expect(lifecycle).toContain('GRANT EXECUTE ON FUNCTION public.combat2_close_inactive_encounter_fighters() TO service_role');
  });
});
