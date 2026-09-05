import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('supabase/migrations/20260905150000_combat2_authoritative_adjacent_departure.sql', 'utf8').replaceAll('\r\n', '\n');

describe('authoritative adjacent departure migration contract', () => {
  it('installs the narrow authenticated security-definer RPC', () => {
    expect(SQL).toMatch(/combat2_depart\(\s*_character_id uuid,\s*_destination_node_id uuid,\s*_request_id uuid/s);
    expect(SQL).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/);
    expect(SQL).toMatch(/NOT public\.owns_character\(_character_id\)/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.combat2_depart\(uuid,uuid,uuid\) FROM PUBLIC, anon/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.combat2_depart\(uuid,uuid,uuid\) TO authenticated, service_role/);
  });

  it('derives visible adjacency, lock/key and the retained MP cost from authoritative rows', () => {
    expect(SQL).toMatch(/jsonb_array_elements\(COALESCE\(n\.connections/);
    expect(SQL).toMatch(/conn->>'node_id'=_destination_node_id::text/);
    expect(SQL).toMatch(/v_connection->>'hidden'/);
    expect(SQL).toMatch(/v_connection->>'locked'[\s\S]*character_inventory[\s\S]*lower\(i\.name\)=lower/);
    expect(SQL).toMatch(/v_capacity := GREATEST\(12/);
    expect(SQL).toMatch(/i\.item_type='consumable' THEN 1\.0\/3\.0/);
    expect(SQL).toMatch(/v_cost := 5 \+ GREATEST\(0,CEIL\(v_bag\)::int-v_capacity\)\*3/);
    const signature = SQL.match(/combat2_depart\(([\s\S]*?)\) RETURNS jsonb/)?.[1] ?? '';
    expect(signature).not.toMatch(/_cost|_origin_node_id|_encounter_id|_fighter_id/);
  });

  it('records replay evidence and queues combat departure without moving or charging', () => {
    expect(SQL).toMatch(/request_id uuid PRIMARY KEY/);
    expect(SQL).toMatch(/request_id_conflict/);
    expect(SQL).toMatch(/already_queued/);
    expect(SQL).toMatch(/already_moved/);
    expect(SQL).toMatch(/fighter_depart_requested/);
    expect(SQL).toMatch(/UPDATE public\.node_intent SET status='rejected',reject_reason='exit_pending'/);
    expect(SQL).toMatch(/state_version=state_version\+1,claim_token=NULL,claimed_tick=NULL/);
  });

  it('fences and applies movement and cost inside node_tick_commit exactly once', () => {
    expect(SQL).toMatch(/departure proposals are locked and fully fenced before any mutation/);
    expect(SQL).toMatch(/fighter_entry_seq=.*rec->>'fighter_entry_seq'/s);
    expect(SQL).toMatch(/current_node_id=\(rec->>'destination_node_id'\)::uuid,\s*mp=mp-\(rec->>'cost'\)::integer/);
    expect(SQL).toMatch(/status='dead'/);
    expect(SQL).toMatch(/status='moved'/);
    expect(SQL).toMatch(/unexpected node_tick_commit contract/);
  });

  it('blocks ordinary authenticated location writes around an active Combat2 fighter', () => {
    expect(SQL).toMatch(/CREATE TRIGGER combat2_guard_owned_location_write/);
    expect(SQL).toMatch(/nf\.present AND e\.status = 'active'/);
    expect(SQL).toMatch(/combat2_depart_required/);
  });
});
