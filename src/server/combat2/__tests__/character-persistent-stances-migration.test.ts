import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import inventory from '@/shared/combat/inventory/active-abilities.json';
import { buildAbilityCatalog, type AuthoredAbilityInventory } from '@/shared/combat2/catalog';

const file = 'supabase/migrations/20261001130000_combat2_character_persistent_stances.sql';
const sql = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const stances = ['envenom','eagle_eye','holy_shield','shield_wall','battle_cry','arcane_surge','force_shield','ignite'];

function compositeIntoViolations(source: string): string[] {
  const code = source.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/'(?:''|[^'])*'/g, "''");
  const composites = new Set([...code.matchAll(/\b(\w+)\s+(?:record|public\.\w+(?:%ROWTYPE)?)\s*;/gi)]
    .map(match => match[1].toLowerCase()));
  return [...code.matchAll(/\bINTO\s+(?:STRICT\s+)?(\w+(?:\s*,\s*\w+)+)/gi)]
    .map(match => match[1]).filter(list => list.split(',').some(name => composites.has(name.trim().toLowerCase())));
}

describe('ENG-STANCE-001 persistent stance migration', () => {
  it('rejects composite multiple-target INTO throughout the complete migration', () => {
    expect(compositeIntoViolations('DECLARE ca public.class_ability_assignments; a public.abilities; ba public.base_abilities;\nSELECT caa,ab,base INTO ca,a,ba FROM catalogue;'))
      .toEqual(['ca,a,ba']);
    expect(compositeIntoViolations('DECLARE result record; cost integer; SELECT x,y INTO STRICT result,cost FROM source;'))
      .toEqual(['result,cost']);
    expect(compositeIntoViolations(sql)).toEqual([]);
    // The other multi-target assignment is the two scalar equipment bonuses.
    expect(sql).toContain('bonus_int integer; bonus_wis integer;');
    expect(sql).toContain('INTO bonus_int,bonus_wis FROM');
  });

  it('gets matched identity and scalar costs from one unchanged catalogue join', () => {
    const lookup = sql.slice(sql.indexOf(' SELECT ab.id,coalesce(ab.cp_reserve_pct'), sql.indexOf(" IF _action='activate' AND _ability_key='shield_wall'"));
    expect(sql).toContain('catalogue_ability_id public.abilities.id%TYPE; pct numeric; cost integer;');
    expect(lookup).toContain('coalesce(ab.cp_reserve_pct,base.cp_reserve_pct,0)');
    expect(lookup).toContain('greatest(0,coalesce(ab.cp_cost,base.cp_cost,0))');
    expect(lookup).toContain('INTO catalogue_ability_id,pct,cost FROM public.class_ability_assignments caa');
    expect(lookup).toContain('JOIN public.abilities ab ON ab.id=caa.ability_id LEFT JOIN public.base_abilities base ON base.id=ab.base_ability_id');
    expect(lookup).toContain("caa.class_key=c.class AND caa.status='active' AND ab.status='active'");
    expect(lookup).toContain('(caa.class_ability_key=_ability_key OR ab.ability_key=_ability_key)');
    expect(lookup).toContain("coalesce(ab.activation_mode,base.activation_mode)='stance' LIMIT 1");
    expect(lookup).toContain("IF catalogue_ability_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','ability_unavailable')");
    expect((lookup.match(/\bSELECT\b/g) ?? []).length).toBe(1);
    expect(sql).not.toContain('SELECT caa,ab,base INTO ca,a,ba');
  });
  it('derives reset identities from the current authored catalogue and historical lifetime contract', () => {
    const authored = inventory as AuthoredAbilityInventory;
    const catalog = buildAbilityCatalog(authored.abilities, authored.statuses);
    const kinds: Record<string, string> = { stack_apply: 'stack_source', offense_buff: 'offense',
      reactive_damage: 'reactive', block_buff: 'block', mitigation_buff: 'mitigation', absorb_buff: 'absorb' };
    const records = authored.abilities.filter(row => row.activationMode === 'stance');
    expect(records.map(row => row.abilityKey).sort()).toEqual([...stances].sort());
    for (const record of records) {
      const spec = catalog.specs.get(record.abilityKey)!;
      expect(spec).toBeDefined();
      expect(sql).toContain(`('${spec.abilityKey}','${kinds[spec.mechanic]}','${spec.effectType ?? spec.abilityKey}')`);
    }
    const historical = readFileSync('supabase/migrations/20260814211437_349710ba-d2f7-4ce6-b863-de46a0ad946b.sql', 'utf8');
    expect(historical).toContain('ae.lifetime = \'stance\'');
    for (const key of stances) expect(historical).toContain(`'${key}'`);
  });
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

  it('resets exact supported self-owned representations, never broad effect categories', () => {
    const manifest = [
      ['envenom','stack_source','poison'], ['eagle_eye','offense','eagle_eye'],
      ['holy_shield','reactive','holy_shield'], ['shield_wall','block','shield_wall'],
      ['battle_cry','mitigation','battle_cry'], ['arcane_surge','offense','arcane_surge'],
      ['force_shield','absorb','force_shield'], ['ignite','stack_source','ignite'],
    ];
    for (const row of manifest) expect(sql).toContain(`('${row.join("','")}')`);
    expect(sql).toContain('m.key=e.ability_key');
    expect(sql).toContain('e.source_character_id=e.target_character_id AND e.source_creature_id IS NULL');
    expect(sql).toContain('e.target_creature_id IS NULL');
    expect(sql).toContain("e.kind='reservation' AND e.effect_type='cp_reservation'");
    expect(sql).toContain('e.kind=m.kind AND e.effect_type=m.effect_type');
    expect(sql).toContain('m.key=e.effect_type');
    expect(sql).toContain('e.source_id=e.target_id');
    expect(sql).toContain("e.lifetime='stance' OR (e.lifetime='timed' AND e.source_ability_key=m.key)");
    expect(sql).toContain('unclassifiable node stance/reservation rows=%');
    expect(sql).toContain('unclassifiable legacy stance effects=%');
    expect(sql).not.toMatch(/DELETE FROM public\.(node_effect|active_effects) WHERE (kind|effect_type)/);
  });

  it('subtracts only exact stance keys/ward fields from mixed JSON, preserving resources', () => {
    expect(sql).toContain("-ARRAY(SELECT key FROM pg_temp.eng_stance_reset_manifest) AS remaining_reservations");
    expect(sql).toContain("-ARRAY['force_shield_hp','force_shield_updated_at'] AS remaining_state");
    // JSON subtraction fixtures model the SQL operators; they do not execute PostgreSQL.
    const reservations: Record<string, unknown> = { unrelated: { reserved: 3 } };
    for (const key of stances) reservations[key] = { reserved: 10, tier: 1 };
    const before = { hp: 83, cp: 17, mp: 91, reserved_buffs: reservations,
      stance_state: { force_shield_hp: 4, force_shield_updated_at: 100, unrelated: { value: 9 } } };
    const after = structuredClone(before);
    for (const key of stances) delete after.reserved_buffs[key];
    const state = after.stance_state as Record<string, unknown>;
    delete state.force_shield_hp; delete state.force_shield_updated_at;
    expect(after.reserved_buffs).toEqual({ unrelated: { reserved: 3 } });
    expect(after.stance_state).toEqual({ unrelated: { value: 9 } });
    expect([after.hp, after.cp, after.mp]).toEqual([83, 17, 91]);
    const reset = sql.slice(0, sql.indexOf('CREATE TABLE public.character_stance ('));
    expect(reset).not.toMatch(/\bSET\s+(hp|cp|mp|current_node_id)\s*=/i);
    expect(reset).toContain("'updated_at',now()");
    expect(reset).toContain('reset changed protected surface: %');
  });

  it('covers all known effect representations and preserves unrelated/offscreen fixture rows', () => {
    // Predicate fixtures complement the SQL contract assertions above, not SQL execution.
    const rows = [...sql.matchAll(/\('([^']+)','([^']+)','([^']+)'\)/g)]
      .filter(match => stances.includes(match[1]));
    const manifest = new Map(rows.map(match => [match[1], { kind: match[2], type: match[3] }]));
    expect(manifest.size).toBe(8);
    for (const key of stances) {
      const mechanic = manifest.get(key)!;
      const nodeMatch = (row: { source: string; target: string | null; creature: string | null;
        key: string; kind: string; type: string; reservation: boolean }) => {
        const entry = manifest.get(row.key);
        return !!entry && row.target !== null && row.source === row.target && row.creature === null
          && (row.reservation ? row.kind === 'reservation' && row.type === 'cp_reservation'
            : row.kind === entry.kind && row.type === entry.type);
      };
      const own = { source: 'character', target: 'character', creature: null, key,
        kind: mechanic.kind, type: mechanic.type, reservation: false };
      expect(nodeMatch(own)).toBe(true);
      expect(nodeMatch({ ...own, reservation: true, kind: 'reservation', type: 'cp_reservation' })).toBe(true);
      expect(nodeMatch({ ...own, target: null, creature: 'creature' })).toBe(false);
      expect(nodeMatch({ ...own, source: 'other-character' })).toBe(false);
      expect(nodeMatch({ ...own, key: 'unrelated' })).toBe(false);
      expect(nodeMatch({ ...own, type: 'unrelated' })).toBe(false);
      const legacyMatch = (lifetime: string, sourceKey: string | null) =>
        (sourceKey === null || sourceKey === key)
          && (lifetime === 'stance' || lifetime === 'timed' && sourceKey === key);
      expect(legacyMatch('stance', null)).toBe(true);
      expect(legacyMatch('stance', key)).toBe(true);
      expect(legacyMatch('timed', key)).toBe(true);
      expect(legacyMatch('timed', null)).toBe(false);
      expect(legacyMatch('stance', 'unrelated')).toBe(false);
    }
  });

  it('bounds and atomically guards reset with empty new authority and preserved histories', () => {
    expect(sql).toContain('node_rows+active_rows+legacy_rows>10000');
    expect(sql).toContain("set_config('lock_timeout','5s',true)");
    expect(sql).toContain('asleep/maintenance, soak off, schedules disabled, no live claims or recording runs');
    expect(sql).toContain('reset preflight: %');
    expect(sql).toContain('reset postflight: reset=%');
    expect(sql).toContain('unexpected effect deletion trigger/dependency');
    expect(sql).toContain('unexpected deferred character trigger');
    expect(sql).toContain('unexpected character update trigger');
    expect(sql).toContain('unclassifiable legacy JSON: characters=%');
    for (const surface of ['character_inventory','node_encounter','node_fighter','node_participation',
      'node_reward_claim','node_ground_loot','node_intent','node_pending_event','combat2_departure_request']) {
      expect(sql).toContain(`'${surface}'`);
    }
    expect(sql).toContain("c.relname LIKE 'combat2_test_%'");
    expect(sql.indexOf('DELETE FROM public.active_effects')).toBeLessThan(sql.indexOf('UPDATE public.characters c SET reserved_buffs'));
    expect(sql.indexOf('reset postflight mismatch')).toBeLessThan(sql.indexOf('CREATE TABLE public.character_stance ('));
    expect(sql).toContain('refusing repeated reset');
    // Reset DML and DDL share the runner transaction: no commits or exception swallowing.
    // Actual rollback on a later DDL failure is an explicit installed-schema gate.
    const reset = sql.slice(0, sql.indexOf('CREATE TABLE public.character_stance ('));
    expect(reset).not.toContain('EXCEPTION WHEN');
    expect(reset).not.toMatch(/\b(COMMIT|ROLLBACK)\s*;/);
    expect(reset).not.toContain('INSERT INTO public.character_stance');
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
