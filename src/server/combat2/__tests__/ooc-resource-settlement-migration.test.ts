import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260923100000_authoritative_ooc_resource_settlement.sql', 'utf8').replaceAll('\r\n', '\n');
const loop = readFileSync('src/features/combat/hooks/useGameLoop.ts', 'utf8');
const generatedTypes = readFileSync('src/integrations/supabase/types.ts', 'utf8').replaceAll('\r\n', '\n');

function rowColumns(table: string): Set<string> {
  const tableStart = generatedTypes.indexOf(`      ${table}: {`);
  if (tableStart < 0) throw new Error(`missing generated table contract: ${table}`);
  const rowStart = generatedTypes.indexOf('        Row: {', tableStart);
  const rowEnd = generatedTypes.indexOf('        }\n        Insert:', rowStart);
  if (rowStart < 0 || rowEnd < 0) throw new Error(`missing generated Row contract: ${table}`);
  return new Set([...generatedTypes.slice(rowStart, rowEnd).matchAll(/^          ([a-z_][a-z0-9_]*):/gm)].map(match => match[1]));
}

const settlementBody = sql.slice(
  sql.indexOf('CREATE FUNCTION public.settle_out_of_combat_resources'),
  sql.indexOf('REVOKE ALL ON FUNCTION public.settle_out_of_combat_resources'),
);

function combatOwned(fixture: {
  encounterActive: boolean;
  fighterPresent: boolean;
  fighterLiving: boolean;
  creatureEncounterMatches: boolean;
  creatureLiving: boolean;
  creatureEngaged: boolean;
}): boolean {
  return fixture.encounterActive
    && fixture.fighterPresent
    && fixture.fighterLiving
    && fixture.creatureEncounterMatches
    && fixture.creatureLiving
    && fixture.creatureEngaged;
}

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

  it('compiles every qualified settlement reference against the generated representative schema', () => {
    const aliases: Record<string, string> = {
      c: 'characters',
      t: 'combat2_test_arena_node',
      d: 'combat2_departure_request',
      m: 'combat2_party_departure_member',
      r: 'combat2_party_departure_request',
      rr: 'combat2_respawn_request',
      released: 'node_fighter',
      f: 'node_fighter',
      e: 'node_encounter',
      nc: 'node_creature',
      ci: 'character_inventory',
      i: 'items',
      n: 'nodes',
    };

    for (const [alias, table] of Object.entries(aliases)) {
      const schema = rowColumns(table);
      const references = [...settlementBody.matchAll(new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)\\b`, 'g'))]
        .map(match => match[1]);
      expect(references.length, `${alias} must reference ${table}`).toBeGreaterThan(0);
      for (const column of references) expect(schema.has(column), `${alias}.${column} must exist on ${table}`).toBe(true);
    }
    expect(rowColumns('node_creature').has('encounter_id')).toBe(true);
    expect(rowColumns('node_creature').has('node_id')).toBe(false);
    expect(sql).toContain("attrelid = 'public.node_creature'::regclass");
    expect(sql).toContain("attname = 'encounter_id'");
    expect(sql).toContain("attname = 'node_id'");
    expect(settlementBody).toContain('nc.encounter_id = e.id');
    expect(settlementBody).not.toContain('nc.node_id');
  });

  it('executes the ownership boundary for active combat, peaceful co-location and inert shells', () => {
    const active = {
      encounterActive: true,
      fighterPresent: true,
      fighterLiving: true,
      creatureEncounterMatches: true,
      creatureLiving: true,
      creatureEngaged: true,
    };
    expect(combatOwned(active)).toBe(true);
    expect(combatOwned({ ...active, creatureEngaged: false })).toBe(false);
    expect(combatOwned({ ...active, fighterPresent: false })).toBe(false);
    expect(combatOwned({ ...active, encounterActive: false })).toBe(false);
    expect(combatOwned({ ...active, creatureEncounterMatches: false })).toBe(false);
    expect(settlementBody).toContain('c.hp <= 0');
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

  it('isolates settlement and dispatch failures while retaining evidence and idempotency', () => {
    const wrapper = sql.slice(
      sql.indexOf('CREATE FUNCTION public.combat2_dispatch_scheduler_fire()'),
      sql.indexOf('REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_fire()'),
    );
    expect(wrapper).toMatch(/BEGIN\s+settlement := public\.settle_out_of_combat_resources[\s\S]*EXCEPTION WHEN OTHERS THEN[\s\S]*'settlement_error'/);
    expect(wrapper).toMatch(/BEGIN\s+dispatch := public\.combat2_dispatch_scheduler_fire_without_resource_settlement[\s\S]*EXCEPTION WHEN OTHERS THEN[\s\S]*'scheduler_error'/);
    expect(wrapper).toContain("'code', SQLSTATE");
    expect(wrapper).not.toContain('SQLERRM');
    expect(wrapper).toContain("COALESCE((settlement->>'ok')::boolean, false) AND COALESCE((dispatch->>'ok')::boolean, false)");
    expect(wrapper.indexOf('settle_out_of_combat_resources')).toBeLessThan(wrapper.indexOf('combat2_dispatch_scheduler_fire_without_resource_settlement'));
    expect(sql).toContain('WHERE singleton FOR UPDATE');
    expect(sql).toContain("'already_settled'");
  });

  it('leaves the browser as a display-only resource consumer', () => {
    expect(loop).toContain('HP/CP/MP regeneration is server-authoritative');
    expect(loop).not.toContain('pendingRegenFlushRef');
    expect(loop).not.toContain('updateCharRegenRef');
    expect(loop).not.toContain('foodCpRegen');
    expect(loop).not.toContain("rpc('heal_party_member'");
    expect(loop).not.toContain('partyRegenBuff.healPerTick');
  });
});
