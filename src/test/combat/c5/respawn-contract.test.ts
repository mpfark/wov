/**
 * Permanent respawn-lifecycle contract guard (C5 gate 1).
 *
 * The deployed respawn chain is:
 *
 *   wake_world() / world_watchdog() -> schedule_tick_creatures()
 *     -> cron `tick-creatures` -> tick_creatures()
 *       -> record_world_state() + world_is_awake() gate
 *         -> respawn_creatures() -> creatures.is_alive false -> true
 *           -> trigger bump_creature_spawn_seq() -> spawn_seq + 1
 *
 * Two properties are load-bearing and were both broken at some point:
 *
 *  1. Waking the world must re-arm the creature tick immediately. Before the
 *     forward fix, `wake_world` only re-armed the 5-minute watchdog, so due
 *     corpses stayed dead for up to a full watchdog period after a player
 *     returned.
 *  2. `spawn_seq` must advance exactly once per dead -> alive transition and
 *     never on any other update, because the death identity
 *     (encounter_death_id) is derived from it.
 *
 * This suite reads the SQL that is actually checked in (the newest definition
 * of each function across `supabase/migrations`) so a future migration that
 * regresses either property fails here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { encounterDeathId } from '@/shared/combat/c2/death-id';

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
      // Everything up to the next top-level CREATE FUNCTION / GRANT / REVOKE.
      const rest = sql.slice(m.index);
      const stop = rest.slice(1).search(/\nCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
      found = stop === -1 ? rest : rest.slice(0, stop + 1);
    }
  }
  if (!found) throw new Error(`no checked-in definition for public.${name}`);
  return found;
}

describe('respawn scheduler contract', () => {
  it('waking the world re-arms the creature tick immediately', () => {
    const wake = latestFunctionBody('wake_world');
    expect(wake).toMatch(/schedule_tick_creatures\s*\(\)/);
  });

  it('the watchdog keeps the creature tick aligned with wake state', () => {
    const watchdog = latestFunctionBody('world_watchdog');
    expect(watchdog).toMatch(/world_is_awake\s*\(\)/);
    expect(watchdog).toMatch(/schedule_tick_creatures\s*\(\)/);
    expect(watchdog).toMatch(/unschedule_tick_creatures\s*\(\)/);
  });

  it('the creature tick is gated on wake state and owns respawn', () => {
    const tick = latestFunctionBody('tick_creatures');
    expect(tick).toMatch(/IF\s+NOT\s+public\.world_is_awake\s*\(\)\s*THEN\s*RETURN/i);
    expect(tick).toMatch(/respawn_creatures\s*\(\)/);
  });

  it('respawn is the only dead -> alive path and resets lifecycle fields', () => {
    const respawn = latestFunctionBody('respawn_creatures');
    // Only corpses whose respawn timer has elapsed are revived.
    expect(respawn).toMatch(/is_alive\s*=\s*false/i);
    expect(respawn).toMatch(/died_at\s*\+\s*\(respawn_seconds/i);
    // Lifecycle reset.
    expect(respawn).toMatch(/is_alive\s*=\s*true/i);
    expect(respawn).toMatch(/hp\s*=\s*max_hp/i);
    expect(respawn).toMatch(/died_at\s*=\s*NULL/i);
    expect(respawn).toMatch(/rewards_awarded_at\s*=\s*NULL/i);
  });

  it('spawn_seq advances only on a dead -> alive transition', () => {
    const bump = latestFunctionBody('bump_creature_spawn_seq');
    expect(bump).toMatch(
      /OLD\.is_alive\s*=\s*false\s+AND\s+NEW\.is_alive\s*=\s*true/i,
    );
    expect(bump).toMatch(/NEW\.spawn_seq\s*:=\s*COALESCE\(OLD\.spawn_seq,\s*1\)\s*\+\s*1/i);
    // Every other update carries the generation forward unchanged.
    expect(bump).toMatch(/ELSE\s*NEW\.spawn_seq\s*:=\s*COALESCE\(OLD\.spawn_seq,\s*1\)/i);
  });
});

describe('death identity across generations', () => {
  const enc = '11111111-1111-4111-8111-111111111111';
  const cre = '22222222-2222-4222-8222-222222222222';

  it('a later death on a new generation is a distinct identity', () => {
    const first = encounterDeathId(enc, cre, 1, 5);
    const second = encounterDeathId(enc, cre, 2, 5);
    expect(first).not.toBe(second);
  });

  it('the old death identity is immutable and replay-stable', () => {
    expect(encounterDeathId(enc, cre, 1, 5)).toBe(encounterDeathId(enc, cre, 1, 5));
  });

  it('a duplicate scheduler pass that does not advance the generation reuses the identity', () => {
    // Idempotency of the ledger key is what makes a replayed commit a no-op.
    expect(encounterDeathId(enc, cre, 2, 43)).toBe(encounterDeathId(enc, cre, 2, 43));
    expect(encounterDeathId(enc, cre, 3, 43)).not.toBe(encounterDeathId(enc, cre, 2, 43));
  });
});
