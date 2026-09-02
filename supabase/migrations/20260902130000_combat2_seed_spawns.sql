-- Internal idempotent projection of authoritative living creature spawns into
-- an existing Combat2 encounter.
CREATE OR REPLACE FUNCTION public.combat2_seed_spawns(
  _encounter_id uuid,
  _node_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_encounter_node_id uuid;
BEGIN
  SELECT e.node_id
    INTO v_encounter_node_id
    FROM public.node_encounter e
   WHERE e.id = _encounter_id;

  IF NOT FOUND OR v_encounter_node_id IS DISTINCT FROM _node_id THEN
    RAISE EXCEPTION 'combat2_seed_spawns encounter/node mismatch'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.node_creature (
    encounter_id,
    creature_id,
    spawn_seq,
    hp,
    is_alive,
    pending_action,
    tank_fighter_id,
    engaged
  )
  SELECT
    _encounter_id,
    cr.id,
    cr.spawn_seq,
    GREATEST(1, COALESCE(NULLIF(cr.hp, 0), cr.max_hp)),
    true,
    NULL::jsonb,
    NULL::uuid,
    false
  FROM public.creatures cr
  WHERE cr.node_id = _node_id
    AND cr.is_alive = true
  ON CONFLICT (creature_id, spawn_seq) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.combat2_seed_spawns(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_seed_spawns(uuid, uuid) TO service_role;
