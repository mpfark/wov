import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const priorPath = 'supabase/migrations/20260901104835_d1bb417e-56d2-4c4b-b34b-afbad1c26d5e.sql';
const migrationPath = 'supabase/migrations/20260902003000_combat2_frozen_boss_target_sync.sql';
const prior = readFileSync(priorPath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8');
const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
const functionBody = (value: string) => normalize(value)
  .split('create or replace function public.combat2_sync(')[1]
  .split('revoke all on function public.combat2_sync')[0];

describe('Combat2 frozen-target delivery migration', () => {
  it('projects only the approved pending-action fields', () => {
    const body = functionBody(migration);
    for (const field of [
      'abilitykey', 'abilitylabel', 'startedattick', 'resolveattick',
      'targetfighterid', 'targetcharacterid', 'targetentryseq',
    ]) {
      expect(body).toContain(`'${field}'`);
    }
    expect(body).not.toContain("'pendingaction', nc.pending_action");
    expect(body).not.toContain("'pending_action'");
    expect(body).not.toContain('target_fighter_id, nc.pending_action');
  });

  it('retains signature, authorization, stability, search path and grants', () => {
    const normal = normalize(migration);
    const body = functionBody(migration);
    expect(body).toContain("language plpgsql stable security definer set search_path to 'public', 'pg_temp'");
    expect(body).toContain('not public.combat2_delivery_authorized(_character_id, _encounter_id)');
    expect(normal).toContain('revoke all on function public.combat2_sync(uuid, uuid, bigint, integer) from public, anon');
    expect(normal).toContain('grant execute on function public.combat2_sync(uuid, uuid, bigint, integer) to authenticated, service_role');
    expect(body).not.toMatch(/\b(update|delete|insert into)\b/);
  });

  it('retains cursor, gap and every unrelated safe projection verbatim', () => {
    const priorBody = functionBody(prior);
    const nextBody = functionBody(migration);
    const priorPending = "'pendingaction', case when nc.pending_action is null then null else jsonb_build_object( 'abilitykey', nc.pending_action->>'ability_key', 'resolveattick', (nc.pending_action->>'resolve_at_tick')::bigint ) end";
    const nextPending = "'pendingaction', case when nc.pending_action is null then null else jsonb_build_object( 'abilitykey', nc.pending_action->>'ability_key', 'abilitylabel', nc.pending_action->>'ability_label', 'startedattick', (nc.pending_action->>'started_at_tick')::bigint, 'resolveattick', (nc.pending_action->>'resolve_at_tick')::bigint, 'targetfighterid', nc.pending_action->>'target_fighter_id', 'targetcharacterid', nc.pending_action->>'target_character_id', 'targetentryseq', (nc.pending_action->>'target_entry_seq')::bigint ) end";
    expect(priorBody).toContain(priorPending);
    expect(nextBody).toContain(nextPending);
    expect(nextBody.replace(nextPending, priorPending)).toBe(priorBody);
    expect(nextBody).toContain('and b.tick > v_after order by b.tick asc limit v_limit');
    expect(nextBody).toContain("'kind', 'gap_detected'");
  });
});
