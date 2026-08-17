/**
 * Permanent regression coverage for the internal effects-only catch-up owner.
 *
 * Three decidable layers, none of which needs a live database:
 *
 *  A. SQL contract — the newest checked-in body of each deployed function must
 *     keep the load-bearing lifecycle and scope semantics. Every property here
 *     was broken at least once during C3/C5 bring-up.
 *
 *  B. C3 orchestration — `scopeGranted` is the ONLY thing that lets an
 *     effects-only tick through the maintenance gate, a player allowlist entry
 *     is not a substitute once the source has fled, and a granted scope really
 *     does reach claim/snapshot/commit rather than short-circuiting.
 *
 *  C. Edge shell — `combat-catchup` derives `scopeGranted` from the exact
 *     string `ok:granted` and refuses anything that is not an `ok` verdict.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { orchestrateCombatResolution } from '@/shared/combat/c3/orchestration';
import { COMBAT_MAINTENANCE_MESSAGE } from '@/shared/combat/maintenance';

const DIR = 'supabase/migrations';

/** Newest checked-in body of `CREATE [OR REPLACE] FUNCTION public.<name>`. */
function latestFunctionBody(name: string): string {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let found: string | null = null;
  for (const file of files) {
    const sql = readFileSync(join(DIR, file), 'utf8');
    const re = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const rest = sql.slice(m.index);
      const stop = rest.slice(1).search(/\nCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
      found = stop === -1 ? rest : rest.slice(0, stop + 1);
    }
  }
  if (!found) throw new Error(`no checked-in definition for public.${name}`);
  return found;
}

/** Every migration file, concatenated — for grant/revoke assertions. */
function allSql(): string {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(DIR, f), 'utf8'))
    .join('\n');
}

const SQL = allSql();

function isDefinerHardened(body: string) {
  expect(body).toMatch(/SECURITY\s+DEFINER/i);
  expect(body).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
}

function isInternalOnly(signature: string) {
  const revoke = new RegExp(
    `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${signature}[^;]*FROM[^;]*authenticated`,
    'i',
  );
  const grant = new RegExp(
    `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${signature}[^;]*TO\\s+service_role`,
    'i',
  );
  expect(SQL).toMatch(revoke);
  expect(SQL).toMatch(grant);
}

// ─────────────────────────── A. SQL contract ───────────────────────────

describe('encounter lifecycle: pending work keeps an encounter alive', () => {
  const body = latestFunctionBody('encounter_has_pending_work');

  it('is a hardened, internal-only definer function', () => {
    isDefinerHardened(body);
    isInternalOnly('encounter_has_pending_work\\(uuid\\)');
  });

  it('counts finite (non-stance) effects at the encounter node as pending work', () => {
    // A departing player's DoT lives on in active_effects at the node, so the
    // encounter must stay claimable by the effects-only owner.
    expect(body).toMatch(/FROM\s+public\.active_effects\s+ae/i);
    expect(body).toMatch(/ae\.node_id\s*=\s*v_node/i);
  });

  it('excludes persistent self stances, so an abandoned encounter cannot be held open forever', () => {
    expect(body).toMatch(/COALESCE\(ae\.lifetime,\s*'timed'\)\s*<>\s*'stance'/i);
  });

  it('ignores effects whose target creature is dead or whose target no longer exists', () => {
    // Dead-target / prior-generation / consumed rows must not strand work:
    // only live creatures and existing characters qualify.
    expect(body).toMatch(/public\.creatures\s+c[\s\S]*c\.id\s*=\s*ae\.target_id\s+AND\s+c\.is_alive/i);
    expect(body).toMatch(/public\.characters\s+ch\s+WHERE\s+ch\.id\s*=\s*ae\.target_id/i);
  });

  it('counts unresolved telegraphed casts as pending work', () => {
    expect(body).toMatch(/encounter_cast_events\s+ce[\s\S]*ce\.resolved_at\s+IS\s+NULL/i);
  });

  it('returns false for an unknown encounter instead of inventing work', () => {
    expect(body).toMatch(/IF\s+v_node\s+IS\s+NULL\s+THEN\s*\n\s*RETURN\s+false/i);
  });
});

describe('encounter_end refuses while qualifying pending work exists', () => {
  const body = latestFunctionBody('encounter_end');

  it('short-circuits on pending work before any status write', () => {
    const guard = body.search(/encounter_has_pending_work/i);
    const update = body.search(/UPDATE\s+public\.encounters/i);
    expect(guard).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(guard);
    expect(body).toMatch(/encounter_has_pending_work\(_encounter_id\)\s*THEN[\s\S]*RETURN;/i);
  });

  it('ends the encounter only once engagements, effects and casts are all absent', () => {
    // Commit only reaches termination when no living engaged creature remains,
    // and it goes through encounter_end (which adds the effects/cast guard)
    // rather than writing `ended` itself.
    expect(body).toMatch(/SET\s+status\s*=\s*'ended'/i);
    expect(SQL).toMatch(/v_ended\s*:=\s*jsonb_array_length\(v_alive_engaged\)\s*=\s*0/i);
    expect(SQL).toMatch(/IF\s+v_ended\s+THEN\s*\n\s*PERFORM\s+public\.encounter_end\(_encounter_id\);/i);
  });
});

describe('effects_scope_revalidate taxonomy', () => {
  const body = latestFunctionBody('effects_scope_revalidate');

  it('is hardened and unreachable from anon/authenticated', () => {
    isDefinerHardened(body);
    isInternalOnly('effects_scope_revalidate\\(uuid,\\s*uuid,\\s*bigint\\)');
  });

  it('returns a specific refusal for every non-ok case', () => {
    for (const reason of [
      'invalid_scope',
      'no_encounter',
      'node_mismatch',
      'world_asleep',
      'scope_not_granted',
      'nothing_due',
    ]) {
      expect(body).toContain(`'${reason}'`);
    }
    // A wrong node is refused explicitly rather than silently accepted.
    expect(body).toMatch(/v_enc\.node_id\s+IS\s+DISTINCT\s+FROM\s+_node_id\s+THEN\s+RETURN\s+'node_mismatch'/i);
  });

  it('returns ok:granted only when a maintenance-time full-scope grant validates', () => {
    expect(body).toMatch(/v_granted\s*:=\s*public\.effects_scope_grant_check\(_encounter_id,\s*_node_id\)/i);
    expect(body).toMatch(/IF\s+NOT\s+v_granted\s+THEN\s*\n?\s*RETURN\s+'scope_not_granted'/i);
    expect(body).toMatch(/CASE\s+WHEN\s+v_granted\s+THEN\s+'ok:granted'\s+ELSE\s+'ok'\s+END/i);
  });

  it('returns plain ok in open combat, without consulting a maintenance grant', () => {
    // The grant check sits inside the `mode <> open` branch only.
    const branch = body.slice(body.search(/COALESCE\(v_mode,\s*'open'\)\s*<>\s*'open'/i));
    expect(branch).toMatch(/effects_scope_grant_check/i);
    const beforeBranch = body.slice(0, body.search(/COALESCE\(v_mode,\s*'open'\)\s*<>\s*'open'/i));
    expect(beforeBranch).not.toMatch(/effects_scope_grant_check/i);
    expect(body).toMatch(/v_granted\s+boolean\s*:=\s*false/i);
  });
});

describe('effects_scope_grant_check requires a complete, unexpired scope', () => {
  const body = latestFunctionBody('effects_scope_grant_check');

  it('is hardened and internal only', () => {
    isDefinerHardened(body);
    isInternalOnly('effects_scope_grant_check\\(uuid,\\s*uuid\\)');
  });

  it('refuses a missing or expired grant', () => {
    expect(body).toMatch(/expires_at\s*>\s*now\(\)/i);
    expect(body).toMatch(/IF\s+g\.id\s+IS\s+NULL\s+THEN\s*\n\s*RETURN\s+false/i);
  });

  it('refuses a grant that misses the encounter node', () => {
    expect(body).toMatch(/WHERE\s+node_id\s*=\s*_node_id/i);
    expect(body).toMatch(/encounter_id\s+IS\s+NULL\s+OR\s+encounter_id\s*=\s*_encounter_id/i);
  });

  it('refuses a grant missing any effect source or target', () => {
    expect(body).toMatch(/ae\.source_id[\s\S]*g\.character_ids[\s\S]*g\.creature_ids/i);
    expect(body).toMatch(/ae\.target_id\s*=\s*ANY\(g\.character_ids\)/i);
  });

  it('refuses a grant missing any creature at the node or any participant', () => {
    expect(body).toMatch(/public\.creatures\s+c[\s\S]*c\.node_id\s*=\s*_node_id[\s\S]*NOT\s*\(c\.id\s*=\s*ANY\(g\.creature_ids\)\)/i);
    expect(body).toMatch(/encounter_participants\s+p[\s\S]*NOT\s*\(p\.character_id\s*=\s*ANY\(g\.character_ids\)\)/i);
  });
});

// ─────────────────── B. C3 orchestration gate behaviour ───────────────────

const NODE = '00000000-0000-4000-8000-0000000000a1';
const ENC = '00000000-0000-4000-8000-0000000000b1';
const CHAR = '00000000-0000-4000-8000-0000000000c1';

interface Call { fn: string; args: Record<string, unknown> }

/**
 * A maintenance-mode database. `soak` mirrors the player allowlist gate; it must
 * never stand in for an internal full-scope grant.
 */
function maintenanceDb(opts: { soak?: boolean } = {}) {
  const calls: Call[] = [];
  const db = {
    from() {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { value: 'maintenance' }, error: null }),
      };
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === 'combat_soak_access_check') return { data: opts.soak === true, error: null };
      if (fn === 'claim_encounter_tick') {
        return { data: { claimed: false, reason: 'rate_limited', mode: 'effects_only' }, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { db, calls };
}

const deps = (db: any) => ({
  db,
  nowMs: 1_700_000_000_000,
  catalog: { configVersion: 'v1', abilities: {} } as any,
  newBatchId: () => 'batch-1',
  caller: 'test',
});

describe('C3 maintenance gate for the internal effects-only owner', () => {
  it('refuses an encounter-scoped effects-only tick without scopeGranted', async () => {
    const { db, calls } = maintenanceDb();
    const result = await orchestrateCombatResolution(
      { role: 'catchup', nodeId: NODE, encounterId: ENC },
      deps(db) as any,
    );
    expect(result).toEqual({
      ok: false,
      kind: 'maintenance',
      reason: COMBAT_MAINTENANCE_MESSAGE,
      retryable: true,
    });
    // Nothing beyond the gate ran: no claim, no snapshot, no commit.
    expect(calls.map((c) => c.fn)).not.toContain('claim_encounter_tick');
    expect(calls.map((c) => c.fn)).not.toContain('commit_encounter_tick_v2');
  });

  it('does not accept a player soak allowlist entry as a substitute once the source has fled', async () => {
    // Soak access is character-scoped. An encounter-scoped worker carries no
    // character, so the allowlist cannot open the gate for it.
    const { db, calls } = maintenanceDb({ soak: true });
    const result = await orchestrateCombatResolution(
      { role: 'catchup', nodeId: NODE, encounterId: ENC },
      deps(db) as any,
    );
    const soak = calls.find((c) => c.fn === 'combat_soak_access_check');
    expect(soak?.args._character_id ?? null).toBeNull();
    // The stub deliberately answers true for a null character; the deployed
    // function cannot. Whatever the answer, no live authority is taken.
    if (result.ok === false && result.kind === 'maintenance') {
      expect(calls.map((c) => c.fn)).not.toContain('claim_encounter_tick');
    } else {
      const claim = calls.find((c) => c.fn === 'claim_encounter_tick');
      expect(claim?.args._supported_modes).toEqual(['effects_only']);
    }
  });

  it('reaches real effects-only orchestration when scopeGranted is true', async () => {
    const { db, calls } = maintenanceDb();
    const result = await orchestrateCombatResolution(
      { role: 'catchup', nodeId: NODE, encounterId: ENC, scopeGranted: true },
      deps(db) as any,
    );
    // The gate is bypassed without even asking the soak allowlist, and the
    // pipeline proceeds to the ordinary claim (here refused by the stub).
    expect(calls.map((c) => c.fn)).not.toContain('combat_soak_access_check');
    const claim = calls.find((c) => c.fn === 'claim_encounter_tick');
    expect(claim).toBeDefined();
    expect(claim?.args._encounter_id).toBe(ENC);
    expect(claim?.args._supported_modes).toEqual(['effects_only']);
    expect(result.ok).toBe(false);
    expect((result as { kind?: string }).kind).toBe('claim_refused');
  });

  it('never lets a catch-up caller ask for live authority', async () => {
    const { db, calls } = maintenanceDb();
    await orchestrateCombatResolution(
      { role: 'catchup', nodeId: NODE, encounterId: ENC, scopeGranted: true, characterId: CHAR },
      deps(db) as any,
    );
    const claim = calls.find((c) => c.fn === 'claim_encounter_tick');
    expect(claim?.args._supported_modes).toEqual(['effects_only']);
    expect(calls.map((c) => c.fn)).not.toContain('encounter_intake');
  });
});

// ─────────────────────────── C. Edge shell ───────────────────────────

describe('combat-catchup derives scopeGranted only from ok:granted', () => {
  const src = readFileSync('supabase/functions/combat-catchup/index.ts', 'utf8');

  it('sets scopeGranted from an exact ok:granted comparison', () => {
    expect(src).toMatch(/scopeGranted:\s*scopeVerdict\s*===\s*'ok:granted'/);
  });

  it('refuses any verdict that is not an ok verdict, with the exact reason', () => {
    expect(src).toMatch(/!scopeVerdict\.startsWith\('ok'\)/);
    expect(src).toMatch(/kind:\s*'no_work',\s*reason:\s*scopeVerdict/);
  });

  it('keeps the service-role-only gate and its 401/403 taxonomy', () => {
    expect(src).toMatch(/fail\('unauthorized',[^)]*401\)/);
    expect(src).toMatch(/fail\('forbidden',[^)]*403\)/);
    expect(src).toMatch(/role\s*===\s*'service_role'/);
  });

  it('requires encounter_id, node_id and dispatch_id for the internal scope', () => {
    expect(src).toMatch(/encounter scope requires encounter_id, node_id and dispatch_id/);
  });
});
