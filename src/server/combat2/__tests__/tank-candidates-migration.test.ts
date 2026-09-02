import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20260902203000_combat2_claim_tank_candidates.sql",
  "utf8",
).replaceAll("\r\n", "\n");

describe("Combat2 claimed tank candidates", () => {
  it("replaces only the existing claim function and preserves its authority", () => {
    expect(sql).toContain("pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid, integer) TO service_role");
    expect(sql).not.toContain("combat2_sync");
    expect(sql).not.toMatch(/CREATE TABLE|ALTER TABLE|CREATE TRIGGER/i);
  });

  it("captures every living present fallback within each active arrival group", () => {
    expect(sql).toContain("nf.arrival_group_id = g.id AND nf.present");
    expect(sql).toContain("ch.id = nf.character_id AND ch.hp > 0");
    expect(sql).toContain("g.encounter_id = e.id");
    expect(sql).toContain("AND g.active");
    expect(sql).toContain("g.party_id IS NULL OR pm.character_id IS NOT NULL");
  });

  it("encodes the installed group and designated-party ordering deterministically", () => {
    expect(sql).toContain("representative.arrival_seq DESC, representative.group_id DESC");
    expect(sql).toContain("representative.member_priority, representative.entry_seq DESC");
    expect(sql).toContain("WHEN nf.character_id = p.tank_id THEN 0");
    expect(sql).toContain("WHEN nf.character_id = p.leader_id THEN 1");
    expect(sql).toContain("representative.entry_seq DESC");
    expect(sql).toContain("representative.fighter_id DESC");
  });

  it("adds only the private claim projection and fails on an unexpected installed body", () => {
    expect(sql).toContain("'tank_candidates', COALESCE((");
    expect(sql).toContain("'fighter_id', representative.fighter_id");
    expect(sql).toContain("'character_id', representative.character_id");
    expect(sql).toContain("'entry_seq', representative.entry_seq");
    expect(sql).toContain("RAISE EXCEPTION 'unexpected node_tick_claim contract'");
  });
});
