import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql=readFileSync('supabase/migrations/20260929100000_combat2_immediate_authoritative_departure.sql','utf8');

describe('ENG-MOVE-001 immediate authoritative departure migration',()=>{
  it('reuses installed validation and completes present-fighter movement in one call',()=>{
    expect(sql).toContain('combat2_depart_without_immediate_transition');
    expect(sql).toContain("result->>'kind' IN('queued','already_queued')");
    expect(sql).toContain('combat2_finish_immediate_departure(_request_id)');
    expect(sql).not.toContain("VALUES(e.id,'fighter_depart_requested'");
  });
  it('performs only non-damage cleanup and preserves participation and creature-targeted effects',()=>{
    expect(sql).toContain("reject_reason='departed'");
    expect(sql).toContain('(character_id=d.character_id OR target_character_id=d.character_id)');
    expect(sql).toContain('target_character_id=d.character_id');
    expect(sql).toContain('SET present=false');
    expect(sql).toContain('combat2_refresh_tanks(e.id)');
    expect(sql).not.toMatch(/node_participation\s+(?:delete|update)/i);
    expect(sql).not.toMatch(/damage|durability|reward|regeneration/i);
  });
  it('fences claims, consumes the legacy event, and charges/moves exactly once',()=>{
    expect(sql).toContain('party claim predecessor drift');
    expect(sql).not.toContain("THEN RETURN jsonb_build_object('ok',false,'kind','live_claim')");
    expect(sql).toContain('claim_token=NULL');
    expect(sql).toContain('consumed_at=clock_timestamp(),consumed_tick=e.tick');
    expect(sql.match(/UPDATE public\.characters SET current_node_id=d\.destination_node_id,mp=mp-d\.cost/g)).toHaveLength(1);
    expect(sql).toContain("WHERE request_id=d.request_id AND status='queued'");
  });
  it('uses one ordered party owner and deprecates destination-less flee safely',()=>{
    expect(sql).toContain('ORDER BY movement_order FOR UPDATE');
    expect(sql).toContain('combat2_finish_immediate_party_departure(_request_id)');
    expect(sql).toContain("'kind','destination_required'");
    expect(sql).toContain('DROP TRIGGER IF EXISTS combat2_party_departure_member_finalized');
  });
  it('maps referenced columns to their installed table contracts',()=>{
    expect(sql).toContain("table_name='node_encounter' AND column_name='claim_expires_at'");
    expect(sql).toContain("table_name='node_pending_event' AND column_name='consumed_at'");
    expect(sql).toContain("table_name='node_pending_event' AND column_name='consumed_tick'");
    expect(sql).toContain("table_name='node_intent' AND column_name='target_character_id'");
    expect(sql).toContain("table_name='node_effect' AND column_name='target_character_id'");
  });
});
