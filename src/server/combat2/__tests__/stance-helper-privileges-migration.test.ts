import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261001230000_combat2_stance_helper_privileges.sql', 'utf8');
const installed = readFileSync('supabase/migrations/20261001130000_combat2_character_persistent_stances.sql', 'utf8');
describe('stance helper ACL follow-up contracts (not PostgreSQL execution)', () => {
  it('denies browser roles on exact legacy and bypass signatures, retaining server access', () => {
    for (const signature of ['drop_stance(uuid,text)', 'combat2_test_stop_without_character_stances(uuid,uuid)',
      'combat2_test_reset_without_character_stances(uuid,uuid,boolean)']) {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
    expect(sql).toContain("has_function_privilege('postgres',fn,'EXECUTE')");
    expect(sql).toContain('unexpected legacy/helper overload');
  });
  it('guards exact signature/security/path/volatility and preserves bodies and owner', () => {
    for (const guard of ['to_regprocedure(spec.signature)', "p.proowner='postgres'::regrole", 'p.prosecdef',
      "p.prorettype='jsonb'::regtype", "p.proconfig=ARRAY['search_path='||spec.path]", 'p.provolatile=']) expect(sql).toContain(guard);
    expect(sql).toContain("spec.signature='public.combat2_character_stances(uuid)' THEN 's'");
    expect(sql).toContain('IS DISTINCT FROM ROW(b.prosrc,b.proowner,b.prosecdef,b.provolatile,b.proconfig)');
    expect(sql).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION|ALTER FUNCTION|UPDATE public\.|DELETE FROM public\./i);
  });
  it('retains replacement projection/change and public Arena wrapper access and composition', () => {
    for (const signature of ['combat2_change_stance(uuid,text,text,uuid)', 'combat2_character_stances(uuid)',
      'combat2_test_stop(uuid,uuid)', 'combat2_test_reset(uuid,uuid,boolean)']) {
      expect(sql).toContain(`public.${signature}`);
      expect(sql).not.toContain(`REVOKE EXECUTE ON FUNCTION public.${signature}`);
      expect(installed).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated,service_role;`);
    }
    expect(sql).toContain('canonical access drift');
    for (const name of ['combat2_test_stop_without_character_stances', 'combat2_test_reset_without_character_stances', 'combat2_restore_arena_stances']) {
      expect(sql).toContain(`public.${name}(`);
      expect(installed).toContain(`public.${name}(`);
    }
  });
  it('checks already-hardened activation/regen siblings without reviving them', () => {
    expect(sql).toContain('sibling browser privilege drift');
    for (const signature of ['activate_stance(uuid,text,integer)', 'apply_force_shield_regen(uuid)']) {
      expect(sql).toContain(`public.${signature}`);
      expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`);
    }
    expect(installed).toContain('combat2_regenerate_force_shields(_now');
    expect(installed).toContain('_settlement_steps*2*per_tick');
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
    expect(sql.trimEnd().endsWith('END $$;')).toBe(true);
  });
});
