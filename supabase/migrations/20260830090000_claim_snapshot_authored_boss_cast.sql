-- Capture the real authored boss_cast document inside the authoritative claim.
-- Combat remains closed; this changes no data and grants only service_role.
CREATE OR REPLACE FUNCTION public.node_tick_claim(
  _node_id uuid,
  _lease_ms integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e            public.node_encounter;
  v_candidate  integer;
  v_token      uuid;
  v_cutoff     bigint;
  v_snapshot   jsonb;
BEGIN
  SELECT * INTO e
  FROM public.node_encounter
  WHERE node_id = _node_id AND status = 'active'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_claim', 'reason', 'locked_or_absent');
  END IF;
  IF e.next_due_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_due', 'next_due_at', e.next_due_at);
  END IF;
  IF e.claimed_tick IS NOT NULL AND e.claim_expires_at IS NOT NULL AND e.claim_expires_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_claim', 'reason', 'in_flight');
  END IF;

  v_candidate := e.tick + 1;
  v_token := gen_random_uuid();
  SELECT max(seq) INTO v_cutoff
  FROM public.node_intent
  WHERE encounter_id = e.id AND status = 'pending';

  UPDATE public.node_encounter
  SET claimed_tick = v_candidate,
      claim_token = v_token,
      claim_expires_at = now() + make_interval(secs => _lease_ms / 1000.0),
      intent_cutoff_seq = v_cutoff
  WHERE id = e.id;

  v_snapshot := jsonb_build_object(
    'encounter', jsonb_build_object(
      'id', e.id, 'node_id', e.node_id, 'tick', e.tick,
      'candidate_tick', v_candidate, 'state_version', e.state_version,
      'now', now()
    ),
    'creatures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', nc.id, 'creature_id', nc.creature_id, 'spawn_seq', nc.spawn_seq,
        'hp', nc.hp, 'is_alive', nc.is_alive, 'pending_action', nc.pending_action,
        'tank_fighter_id', nc.tank_fighter_id,
        'name', cr.name, 'level', cr.level, 'max_hp', cr.max_hp, 'ac', cr.ac,
        'stats', cr.stats, 'rarity', cr.rarity, 'is_humanoid', cr.is_humanoid,
        'is_aggressive', cr.is_aggressive,
        'boss_crit_flavors', cr.boss_crit_flavors, 'boss_death_cry', cr.boss_death_cry
      ) ORDER BY nc.created_at)
      FROM public.node_creature nc
      JOIN public.creatures cr ON cr.id = nc.creature_id
      WHERE nc.encounter_id = e.id
    ), '[]'::jsonb),
    'fighters', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', nf.id, 'character_id', nf.character_id, 'entry_seq', nf.entry_seq,
        'present', nf.present, 'party_id_at_entry', nf.party_id_at_entry,
        'name', ch.name, 'class', ch.class, 'race', ch.race, 'level', ch.level,
        'hp', ch.hp, 'max_hp', ch.max_hp, 'cp', ch.cp, 'max_cp', ch.max_cp,
        'mp', ch.mp, 'max_mp', ch.max_mp, 'ac', ch.ac,
        'str', ch.str, 'dex', ch.dex, 'con', ch.con,
        'int', ch.int, 'wis', ch.wis, 'cha', ch.cha,
        'party_id', pm.party_id,
        'equipment', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'slot', ci.equipped_slot, 'item_id', ci.item_id,
            'inventory_id', ci.id, 'character_id', ci.character_id,
            'durability', ci.current_durability,
            'applied_gems', ci.applied_gems, 'stat_override', ci.stat_override,
            'crafted_level', ci.crafted_level, 'item_present', (it.id IS NOT NULL),
            'item_type', it.item_type, 'weapon_tag', it.weapon_tag,
            'hands', it.hands, 'item_level', it.level, 'rarity', it.rarity
          ) ORDER BY ci.equipped_slot)
          FROM public.character_inventory ci
          LEFT JOIN public.items it ON it.id = ci.item_id
          WHERE ci.character_id = ch.id AND ci.equipped_slot IS NOT NULL
        ), '[]'::jsonb)
      ) ORDER BY nf.entry_seq)
      FROM public.node_fighter nf
      JOIN public.characters ch ON ch.id = nf.character_id
      LEFT JOIN public.party_members pm ON pm.character_id = ch.id
      WHERE nf.encounter_id = e.id
    ), '[]'::jsonb),
    'effects', COALESCE((
      SELECT jsonb_agg(to_jsonb(ne) ORDER BY ne.created_at)
      FROM public.node_effect ne WHERE ne.encounter_id = e.id
    ), '[]'::jsonb),
    'intents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ni.id, 'seq', ni.seq, 'character_id', ni.character_id,
        'intent_kind', ni.intent_kind, 'ability_key', ni.ability_key,
        'stance_key', ni.stance_key, 'target_creature_id', ni.target_creature_id
      ) ORDER BY ni.seq)
      FROM public.node_intent ni
      WHERE ni.encounter_id = e.id AND ni.status = 'pending'
        AND v_cutoff IS NOT NULL AND ni.seq <= v_cutoff
    ), '[]'::jsonb),
    'participation', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', np.id, 'creature_id', np.creature_id, 'spawn_seq', np.spawn_seq,
        'character_id', np.character_id, 'qualification', np.qualification,
        'qualified_by', np.qualified_by,
        'party_id_at_qualification', np.party_id_at_qualification
      ) ORDER BY np.first_at)
      FROM public.node_participation np WHERE np.encounter_id = e.id
    ), '[]'::jsonb),
    'pending_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pe.id, 'event_type', pe.event_type,
        'actor_character_id', pe.actor_character_id,
        'actor_creature_id', pe.actor_creature_id,
        'target_character_id', pe.target_character_id,
        'target_creature_id', pe.target_creature_id,
        'payload', pe.payload, 'occurred_at', pe.occurred_at
      ) ORDER BY pe.occurred_at, pe.id)
      FROM public.node_pending_event pe
      WHERE pe.encounter_id = e.id AND pe.consumed_at IS NULL
    ), '[]'::jsonb),
    -- Preserve the field while replacing the unused boss_ability source with
    -- the real authored document captured for this exact encounter spawn.
    'boss_abilities', '[]'::jsonb,
    'boss_configurations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'encounter_id', e.id,
        'node_creature_id', nc.id,
        'creature_id', nc.creature_id,
        'spawn_seq', nc.spawn_seq,
        'boss_cast', cr.boss_cast
      ) ORDER BY nc.created_at, nc.id)
      FROM public.node_creature nc
      JOIN public.creatures cr ON cr.id = nc.creature_id
      WHERE nc.encounter_id = e.id
    ), '[]'::jsonb)
  );

  RETURN jsonb_build_object(
    'ok', true, 'kind', 'claimed', 'encounter_id', e.id,
    'last_committed_tick', e.tick, 'candidate_tick', v_candidate,
    'state_version', e.state_version, 'claim_token', v_token,
    'intent_cutoff_seq', v_cutoff, 'snapshot', v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid, integer) TO service_role;
