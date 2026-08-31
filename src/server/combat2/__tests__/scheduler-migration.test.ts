import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCHEDULER_PATH = 'supabase/migrations/20260831133000_combat2_dispatch_scheduler_foundation.sql';
const COMMIT_PATH = 'supabase/migrations/20260829084704_518ce69a-0799-4ec1-8beb-7fb32baa3cca.sql';
const sql = readFileSync(SCHEDULER_PATH, 'utf8');
const normal = sql.toLowerCase().replace(/\s+/g, ' ');
const commit = readFileSync(COMMIT_PATH, 'utf8').toLowerCase().replace(/\s+/g, ' ');

describe('Combat2 dispatcher scheduler migration contract', () => {
  it('uses the authoritative two-second Combat2 cadence', () => {
    expect(commit).toContain("next_due_at = greatest(now(), next_due_at) + interval '2 seconds'");
    expect(normal).toContain("'combat2-dispatch-once', '2 seconds'");
  });

  it('is disabled by default and exposes explicit idempotent lifecycle controls', () => {
    expect(normal).not.toMatch(/select public\.combat2_dispatch_scheduler_enable\(\);/);
    expect(normal).toContain("where jobname = 'combat2-dispatch-once'");
    expect(normal).toContain("if v_count = 1 and v_exact = 1 then return jsonb_build_object('ok', true, 'classification', 'already_enabled')");
    expect(normal).toContain("and schedule = '2 seconds' and command = 'select public.combat2_dispatch_scheduler_fire();'");
    expect(normal).toContain('perform public.combat2_dispatch_scheduler_disable()');
    expect(normal).toContain('perform pg_advisory_xact_lock');
  });

  it('requires awake/open eligibility and removes ineligible scheduling before transport', () => {
    expect(normal).toContain('public.world_state_is_awake() and public.combat_mode_is_open()');
    const gate = normal.indexOf('if not public.combat2_dispatch_scheduler_eligible()');
    const post = normal.indexOf('select net.http_post(');
    expect(gate).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(gate);
  });

  it('uses a Vault reference and never contains a credential literal', () => {
    expect(normal).toContain("from vault.decrypted_secrets where name = 'combat2_worker_secret'");
    expect(normal).toContain("from vault.secrets where name = 'combat2_worker_secret'");
    expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(sql).not.toMatch(/service_role_key\s*[:=]/i);
    expect(normal).not.toContain("'apikey'");
    const observableLines = sql.split(/\r?\n/).filter((line) => /raise|return|log/i.test(line));
    expect(observableLines.join('\n')).not.toMatch(/v_secret/i);
  });

  it('allows only service-role lifecycle execution without using it as HTTP authorization', () => {
    expect(normal).toContain('from public, anon, authenticated');
    expect(normal.match(/grant execute on function public\.combat2_dispatch_scheduler_[a-z_]+\(\) to service_role/g)).toHaveLength(4);
    expect(normal).toContain("'authorization', 'bearer ' || v_secret");
    expect(normal).not.toContain("authorization', 'bearer ' || current_setting");
  });

  it('queues at most one dispatcher request per fire and refuses unresolved overlap', () => {
    expect(normal.match(/select net\.http_post\(/g)).toHaveLength(1);
    expect(normal).toContain("'classification', 'overlap_refused'");
    expect(normal).toContain("if not pg_try_advisory_xact_lock(hashtext('combat2-dispatch-once-fire'))");
    expect(normal).toContain('from net._http_response where id = v_state.request_id');
    expect(normal).toContain("v_state.requested_at > clock_timestamp() - interval '15 seconds'");
    expect(normal).toContain("body := '{}'::jsonb");
  });

  it('never invokes node workers or depends on a browser', () => {
    expect(normal).not.toMatch(/node_tick_(claim|commit)/);
    expect(normal).not.toContain('combat2-tick-once');
    expect(normal).not.toContain('heartbeat');
    expect(normal).not.toContain('realtime');
  });
});
