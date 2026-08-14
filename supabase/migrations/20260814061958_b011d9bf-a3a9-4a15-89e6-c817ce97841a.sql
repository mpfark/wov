CREATE OR REPLACE FUNCTION public.encounter_resync_snapshot(_encounter_id uuid, _character_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_allowed boolean;
  v_enc record;
  v_result jsonb;
BEGIN
  SELECT user_id INTO v_owner FROM public.characters WHERE id = _character_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.encounter_participants p
    WHERE p.encounter_id = _encounter_id AND p.character_id = _character_id
  ) OR EXISTS (
    SELECT 1 FROM public.encounter_access_grants g
    WHERE g.encounter_id = _encounter_id AND g.character_id = _character_id AND g.expires_at > now()
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;

  SELECT * INTO v_enc FROM public.encounters e WHERE e.id = _encounter_id;
  IF v_enc IS NULL THEN
    RAISE EXCEPTION 'encounter_not_found';
  END IF;

  SELECT jsonb_build_object(
    'encounter_id', v_enc.id,
    'node_id', v_enc.node_id,
    'status', v_enc.status,
    'ended', (v_enc.status <> 'active'),
    'tick', COALESCE(v_enc.tick_number, 0),
    'retained_from_tick', (
      SELECT MIN(b.tick_number) FROM public.encounter_tick_batches b WHERE b.encounter_id = _encounter_id
    ),
    'character', (
      SELECT jsonb_build_object(
        'id', c.id, 'hp', c.hp, 'max_hp', c.max_hp, 'cp', c.cp, 'max_cp', c.max_cp,
        'mp', c.mp, 'max_mp', c.max_mp, 'xp', c.xp, 'gold', c.gold, 'level', c.level,
        'bhp', c.bhp, 'rp_total_earned', c.rp_total_earned,
        'unspent_stat_points', c.unspent_stat_points, 'respec_points', c.respec_points,
        'current_node_id', c.current_node_id
      )
      FROM public.characters c WHERE c.id = _character_id
    ),
    'creatures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cr.id, 'name', cr.name, 'hp', cr.hp, 'max_hp', cr.max_hp,
        'alive', (cr.hp > 0), 'is_aggressive', cr.is_aggressive
      ))
      FROM public.encounter_creatures ec
      JOIN public.creatures cr ON cr.id = ec.creature_id
      WHERE ec.encounter_id = _encounter_id
    ), '[]'::jsonb),
    'engaged_creature_ids', COALESCE((
      SELECT jsonb_agg(DISTINCT en.creature_id)
      FROM public.encounter_engagements en
      WHERE en.encounter_id = _encounter_id AND en.character_id = _character_id
    ), '[]'::jsonb),
    'effects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'target_id', ae.target_id, 'source_id', ae.source_id, 'effect_type', ae.effect_type,
        'stacks', ae.stacks, 'damage_per_tick', ae.damage_per_tick,
        'expires_at', ae.expires_at, 'next_tick_at', ae.next_tick_at, 'tick_rate_ms', ae.tick_rate_ms,
        'source_ability_key', ae.source_ability_key
      ))
      FROM public.active_effects ae
      WHERE ae.node_id = v_enc.node_id
    ), '[]'::jsonb),
    'pending_actions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ca.id, 'ability_key', ca.ability_key, 'status', ca.status))
      FROM public.combat_actions ca
      WHERE ca.character_id = _character_id AND ca.status = 'pending'
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_resync_snapshot(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_resync_snapshot(uuid, uuid) TO authenticated;