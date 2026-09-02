import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(process.cwd(), "supabase/migrations");
const migrationName = "20260902130000_combat2_seed_spawns.sql";
const sql = readFileSync(resolve(migrationsDir, migrationName), "utf8").replaceAll("\r\n", "\n");
const installedEnterSql = readFileSync(
  resolve(migrationsDir, "20260902123413_f5e0f14f-b91d-451a-a267-fbe6fea9665c.sql"),
  "utf8",
).replaceAll("\r\n", "\n");

describe("Combat2 spawn seeding helper migration", () => {
  it("defines the exact internal void helper once", () => {
    const definitions = readdirSync(migrationsDir).filter((name) => {
      const candidate = readFileSync(resolve(migrationsDir, name), "utf8");
      return /CREATE OR REPLACE FUNCTION public\.combat2_seed_spawns\s*\(/i.test(candidate);
    });

    expect(definitions).toEqual([migrationName]);
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.combat2_seed_spawns\s*\(\s*_encounter_id uuid,\s*_node_id uuid\s*\)\s*RETURNS void/i,
    );
    expect(installedEnterSql).toContain("PERFORM public.combat2_seed_spawns(e.id, v_node)");
  });

  it("uses definer authority with a fixed path and no direct player access", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.combat2_seed_spawns(uuid, uuid) FROM PUBLIC, anon, authenticated",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.combat2_seed_spawns(uuid, uuid) TO service_role",
    );
  });

  it("fails closed unless the encounter belongs to the supplied node", () => {
    expect(sql).toMatch(
      /SELECT e\.node_id\s+INTO v_encounter_node_id\s+FROM public\.node_encounter e\s+WHERE e\.id = _encounter_id/i,
    );
    expect(sql).toContain("IF NOT FOUND OR v_encounter_node_id IS DISTINCT FROM _node_id THEN");
    expect(sql).toContain("RAISE EXCEPTION 'combat2_seed_spawns encounter/node mismatch'");
  });

  it("inserts only the current living authoritative creature life", () => {
    expect(sql).toContain("FROM public.creatures cr");
    expect(sql).toContain("WHERE cr.node_id = _node_id");
    expect(sql).toContain("AND cr.is_alive = true");
    expect(sql).toContain("cr.id,");
    expect(sql).toContain("cr.spawn_seq,");
    expect(sql).toContain("GREATEST(1, COALESCE(NULLIF(cr.hp, 0), cr.max_hp))");
    expect(sql).toMatch(/NULL::jsonb,\s+NULL::uuid,\s+false/);
  });

  it("is idempotent while allowing a later spawn sequence", () => {
    expect(sql).toContain("ON CONFLICT (creature_id, spawn_seq) DO NOTHING");
    expect(sql).not.toMatch(/ON CONFLICT[\s\S]*DO UPDATE/i);
    expect(sql).not.toMatch(/UPDATE public\.node_creature/i);
    expect(sql).not.toMatch(/DELETE FROM public\.node_creature/i);
  });

  it("does not mutate unrelated runtime or authoritative tables", () => {
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.creatures/i);
    for (const table of [
      "node_fighter",
      "node_arrival_group",
      "node_intent",
      "node_pending_event",
      "node_participation",
      "node_reward_claim",
      "node_tick_batch",
      "node_encounter",
    ]) {
      expect(sql).not.toMatch(new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM) public\\.${table}`, "i"));
    }
  });

  it("does not restore the removed arrival migration artifact", () => {
    const removedName = ["20260902", "100000", "combat2", "arrival", "engagement", "opportunity.sql"].join("_");
    expect(readdirSync(migrationsDir)).not.toContain(removedName);
  });
});
