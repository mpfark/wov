import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE=path.resolve('supabase/migrations/20260908100000_combat2_test_party_preparation.sql');
const SQL=fs.readFileSync(FILE,'utf8');
const body=(name:string)=>{const marker=SQL.includes(`CREATE OR REPLACE FUNCTION public.${name}`)?`CREATE OR REPLACE FUNCTION public.${name}`:`CREATE FUNCTION public.${name}`;const start=SQL.indexOf(marker);return SQL.slice(start,SQL.indexOf('END $$;',start)+7);};

describe('Combat2 Test Arena party preparation migration',()=>{
  it('uses one arena-scoped lock, admin authority, exact registrations and idempotent requests',()=>{
    const prepare=body('combat2_test_party_prepare');
    expect(prepare).toContain('combat2_test_admin_allowed()');
    expect(prepare).toContain("pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0))");
    expect(prepare).toContain('combat2_test_arena_party_request WHERE request_id=_request_id');
    expect(prepare).toContain("'request_id_conflict'");
    expect(prepare).toContain('x.character_id=c.id AND x.user_id=c.user_id');
    expect(prepare).toContain('x.active AND x.revoked_at IS NULL');
    expect(prepare).toContain('n.node_id=c.current_node_id AND n.active');
    expect(prepare).toContain("'testers_not_colocated'");
  });

  it('refuses unsafe state and never rewrites an ordinary party',()=>{
    const prepare=body('combat2_test_party_prepare');
    for(const refusal of ['active_claim','active_departure','conflicting_encounter','ordinary_party_conflict','replacement_confirmation_required']) expect(prepare).toContain(`'${refusal}'`);
    expect(prepare).toContain('pm.party_id<>tracked.party_id');
    expect(prepare).toContain('p.id<>tracked.party_id');
    expect(prepare).not.toMatch(/UPDATE public\.(parties|party_members)/);
    expect(prepare.match(/DELETE FROM public\.parties/g)).toHaveLength(1);
    expect(prepare).toContain('INSERT INTO public.party_members');
    expect(prepare).toContain("(party,_character_a_id,'accepted',false)");
    expect(prepare).toContain("(party,_character_b_id,'accepted',false)");
  });

  it('allows browser entry only for no party or the tracked accepted arena party',()=>{
    const preflight=body('combat2_test_session_preflight');
    expect(preflight).toContain('auth.uid()');
    expect(preflight).toContain('combat2_test_arena_access_allowed');
    expect(preflight).toContain('public.combat_sessions');
    expect(preflight).toContain("pm.status='accepted'");
    expect(preflight).toContain('memberships<>tracked_memberships OR memberships>1');
    expect(preflight).toContain("'party_not_authorized'");
  });

  it('extends Reset with exact tracked-party cleanup while preserving evidence',()=>{
    const reset=body('combat2_test_reset');
    expect(SQL).toContain('RENAME TO combat2_test_reset_without_party_cleanup');
    expect(reset).toContain('combat2_test_reset_without_party_cleanup');
    expect(reset).toContain("outcome ? 'temporary_parties_removed'");
    expect(reset).toContain('DELETE FROM public.parties p USING public.combat2_test_arena_party tp');
    expect(reset).toContain('tp.arena_id=_arena_id AND p.id=tp.party_id');
    expect(reset).not.toMatch(/DELETE FROM public\.combat2_test_run/);
  });

  it('projects only allowlisted final-ability evidence and no internal state',()=>{
    const safe=SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public.combat2_test_safe_event'),SQL.indexOf('REVOKE ALL ON FUNCTION public.combat2_test_safe_event'));
    for(const field of ['requested','applied','wasted','hpRequested','hpApplied','hpWasted','cpRequested','cpApplied','cpWasted','removedFromCaster','remaining','depleted']) expect(safe).toContain(`'{meta,${field}}'`);
    for(const privateField of ['claim','lease','proposal','snapshot','config','sqlError']) expect(safe).not.toContain(`_event->'${privateField}'`);
  });

  it('generation-fences the authoritative ally projection to accepted party-at-entry membership',()=>{
    const sync=body('combat2_sync');
    expect(sync).toContain('nf.encounter_id=_encounter_id AND nf.present AND c.hp>0');
    expect(sync).toContain("pm.character_id=nf.character_id AND pm.status='accepted'");
    expect(sync).toContain('actor_party=actor_party_at_entry');
    expect(sync).toContain('nf.party_id_at_entry=actor_party_at_entry');
    expect(sync).toContain("'fighterId',nf.id");
    expect(sync).toContain("'entrySeq',nf.entry_seq");
  });
});
