import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const file = 'supabase/migrations/20261001130000_combat2_character_persistent_stances.sql';
const sql = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const stances = ['envenom','eagle_eye','holy_shield','shield_wall','battle_cry','arcane_surge','force_shield','ignite'];

describe('ENG-STANCE-001 persistent stance migration', () => {
  it('defines one private character owner and durable replay surface', () => {
    expect(sql).toContain('CREATE TABLE public.character_stance (');
    expect(sql).toContain('PRIMARY KEY(character_id,ability_key)');
    expect(sql).toContain('CREATE TABLE public.character_stance_request (');
    expect(sql).toContain('ALTER TABLE public.character_stance ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON public.character_stance FROM PUBLIC,anon,authenticated');
    for (const stance of stances) expect(sql).toContain(`'${stance}'`);
  });

  it('uses current max CP with the Combat2 floor convention everywhere', () => {
    expect(sql).toContain('floor(greatest(0,_max_cp)*reserve_pct)::integer');
    expect(sql).toContain('floor(greatest(0,c.max_cp)*pct)::integer');
    expect(sql).toContain("'spendable_cp',greatest(0,c.cp-reserved)");
    expect(sql).not.toContain('ceil(');
    expect(sql).not.toContain('greatest(5');
    expect(sql).toContain('combat_intent_without_character_stances');
    expect(sql).toContain('reserved:=public.combat2_stance_reserved_cp(c.id,c.max_cp)');
  });

  it('fails installation on ambiguous legacy or encounter stance state', () => {
    expect(sql).toContain('ambiguous existing stance state');
    expect(sql).toContain("coalesce(reserved_buffs,'{}'::jsonb) <> '{}'::jsonb");
    expect(sql).toContain('node_effect_rows=%');
    expect(sql).toContain('legacy_character_rows=%');
  });

  it('makes combat stance changes immediate while consuming exactly one intent slot', () => {
    expect(sql).toContain("EXISTS(SELECT 1 FROM public.node_intent ni");
    expect(sql).toContain("AND ni.status='pending'");
    expect(sql).toContain("INSERT INTO public.node_intent(encounter_id,character_id,intent_kind,stance_key,request_id)");
    expect(sql).toContain("state_version=state_version+1,claim_token=NULL");
    expect(sql).toContain('intent_id=ANY(_intent_ids)');
  });

  it('wraps claim and commit with version fencing and server-owned ward persistence', () => {
    expect(sql).toContain('RENAME TO node_tick_claim_without_character_stances');
    expect(sql).toContain("'{snapshot,character_stances}'");
    expect(sql).toContain('RENAME TO node_tick_commit_without_character_stances');
    expect(sql).toContain("'stale_stance'");
    expect(sql).toContain("SET state=row->'state',version=version+1");
    expect(sql).toContain("_proposed->'stance_clear_character_ids'");
  });

  it('removes legacy browser writers and isolates Test Arena state', () => {
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.activate_stance');
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.drop_stance');
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.apply_force_shield_regen');
    expect(sql).toContain('combat2_test_arena_stance_snapshot');
    expect(sql).toContain('combat2_restore_arena_stances');
    expect(sql).toContain('settle_out_of_combat_resources_without_character_stances');
    expect(sql).toContain('combat2_regenerate_force_shields');
    expect(sql).toContain('_settlement_steps*2*per_tick');
  });

  it('is migration-runner compatible', () => {
    expect(sql).not.toMatch(/^\s*BEGIN\s*;/m);
    expect(sql).not.toMatch(/^\s*COMMIT\s*;/m);
    expect((sql.match(/\$\$/g) ?? []).length % 2).toBe(0);
    expect(sql.trimEnd().endsWith(';')).toBe(true);
  });
});
