import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = resolve(process.cwd(), "supabase/migrations");
const canonicalPath = resolve(
  migrations,
  "20260902093129_6e2ff6de-db65-4d4d-83e1-dadcfebaa70c.sql",
);
const removedPath = resolve(
  migrations,
  ["20260902100000", "combat2", "arrival", "engagement", "opportunity.sql"].join("_"),
);
const forwardName = "20260902110000_combat2_reactivation_fencing.sql";
const forwardSql = readFileSync(resolve(migrations, forwardName), "utf8").replaceAll("\r\n", "\n");

describe("Combat2 reactivation fencing migration", () => {
  it("keeps the ledger-recorded migration exact and removes the duplicate", () => {
    const canonical = readFileSync(canonicalPath, "utf8").replaceAll("\r\n", "\n");
    expect(createHash("md5").update(canonical).digest("hex")).toBe(
      "06328d69001db8fe9fc0b2eb8836c3a2",
    );
    expect(existsSync(removedPath)).toBe(false);
  });

  it("is a narrow combat_enter replacement with preserved authority", () => {
    expect(forwardSql.match(/CREATE OR REPLACE FUNCTION public\.combat_enter/g)).toHaveLength(1);
    expect(forwardSql).toContain("SECURITY DEFINER SET search_path = public, pg_temp");
    expect(forwardSql).toContain("REVOKE ALL ON FUNCTION public.combat_enter(uuid,uuid) FROM PUBLIC, anon");
    expect(forwardSql).toContain("GRANT EXECUTE ON FUNCTION public.combat_enter(uuid,uuid) TO authenticated, service_role");
    expect(forwardSql).not.toMatch(/CREATE\s+(TABLE|INDEX|TRIGGER)/i);
    expect(forwardSql).not.toContain("public.combat_flee");
  });

  it("fences stale reactivation state without rewriting dead creature history", () => {
    expect(forwardSql).toContain("SET status='rejected',reject_reason='stale_generation'");
    expect(forwardSql).toContain("SET consumed_at=now(),consumed_tick=e.tick");
    expect(forwardSql).toContain("claim_token=NULL,claimed_tick=NULL");
    expect(forwardSql).toContain("claim_expires_at=NULL,intent_cutoff_seq=NULL");
    expect(forwardSql).toContain("WHERE encounter_id=e.id AND is_alive");
    expect(forwardSql).toContain("PERFORM public.combat2_seed_spawns(e.id, v_node)");
    expect(forwardSql).not.toMatch(/DELETE FROM public\.(node_reward|node_participation|node_tick)/);
  });

  it("fails closed on ambiguous party membership under the node lock", () => {
    const requestLookup = forwardSql.indexOf("WHERE request_id = _request_id");
    const nodeLock = forwardSql.indexOf("pg_advisory_xact_lock");
    const partyLookup = forwardSql.indexOf("SELECT array_agg(pm.party_id) INTO v_parties");
    const encounterMutation = forwardSql.indexOf("SELECT * INTO e FROM public.node_encounter");
    expect(requestLookup).toBeGreaterThan(-1);
    expect(nodeLock).toBeGreaterThan(requestLookup);
    expect(partyLookup).toBeGreaterThan(nodeLock);
    expect(encounterMutation).toBeGreaterThan(partyLookup);
    expect(forwardSql).toContain("IF cardinality(v_parties) > 1 THEN");
    expect(forwardSql).toContain("'kind','ambiguous_party_membership'");
  });

  it("has exactly one forward migration implementing this correction", () => {
    const matches = readdirSync(migrations).filter((name) => {
      const sql = readFileSync(resolve(migrations, name), "utf8");
      return sql.includes("reject_reason='stale_generation'") && sql.includes("intent_cutoff_seq=NULL");
    });
    expect(matches).toEqual([forwardName]);
  });
});
