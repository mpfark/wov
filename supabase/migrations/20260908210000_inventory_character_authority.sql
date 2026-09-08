-- Close residual character and inventory-instance browser authority.
REVOKE ALL PRIVILEGES ON TABLE public.characters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.characters TO authenticated;
GRANT UPDATE(last_online, wimp_hp_threshold, wimp_direction, portrait_url, portrait_metadata, portrait_generated_at)
  ON public.characters TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.character_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.character_inventory TO authenticated;
DROP POLICY IF EXISTS "Owners can insert inventory" ON public.character_inventory;
DROP POLICY IF EXISTS "Owners can update inventory" ON public.character_inventory;
DROP POLICY IF EXISTS "Owners can delete inventory" ON public.character_inventory;

CREATE TABLE public.character_inventory_action_request (
  request_id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  action text NOT NULL,
  inventory_id uuid,
  arguments jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.character_inventory_action_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.character_inventory_action_request FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.character_inventory_action_request TO service_role;

CREATE OR REPLACE FUNCTION public.character_inventory_action(
  _character_id uuid,
  _action text,
  _inventory_id uuid,
  _slot text,
  _request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
  caller uuid := auth.uid();
  c public.characters;
  inv public.character_inventory;
  template public.items;
  prior public.character_inventory_action_request;
  args jsonb := jsonb_build_object('slot', _slot);
  desired_slot public.item_slot;
  healing integer;
  regen integer;
  v_result jsonb;
BEGIN
  IF caller IS NULL OR NOT public.owns_character(_character_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized');
  END IF;
  IF _request_id IS NULL OR _action NOT IN ('equip', 'unequip', 'pin', 'consume', 'drop') THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('character_inventory_action:' || _request_id::text, 0));
  SELECT * INTO prior FROM public.character_inventory_action_request WHERE request_id = _request_id;
  IF FOUND THEN
    IF prior.character_id <> _character_id OR prior.action <> _action
       OR prior.inventory_id IS DISTINCT FROM _inventory_id OR prior.arguments <> args THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'request_id_conflict');
    END IF;
    RETURN COALESCE(prior.result, jsonb_build_object('ok', false, 'kind', 'request_pending'));
  END IF;

  SELECT * INTO c FROM public.characters WHERE id = _character_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized'); END IF;
  IF c.hp <= 0 THEN RETURN jsonb_build_object('ok', false, 'kind', 'unavailable_while_dead'); END IF;
  IF c.movement_locked_until IS NOT NULL AND c.movement_locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'movement_pending');
  END IF;

  SELECT * INTO inv FROM public.character_inventory
    WHERE id = _inventory_id AND character_id = _character_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'kind', 'item_not_owned'); END IF;
  SELECT * INTO template FROM public.items WHERE id = inv.item_id;

  INSERT INTO public.character_inventory_action_request(request_id, character_id, action, inventory_id, arguments)
    VALUES (_request_id, _character_id, _action, _inventory_id, args);

  IF _action = 'pin' THEN
    UPDATE public.character_inventory SET is_pinned = NOT is_pinned WHERE id = inv.id;
    v_result := jsonb_build_object('ok', true, 'kind', 'updated');
  ELSIF _action = 'unequip' THEN
    UPDATE public.character_inventory SET equipped_slot = NULL WHERE id = inv.id;
    v_result := jsonb_build_object('ok', true, 'kind', 'updated');
  ELSIF _action = 'equip' THEN
    IF inv.current_durability <= 0 OR template.item_type <> 'equipment' OR _slot IS NULL THEN
      v_result := jsonb_build_object('ok', false, 'kind', 'invalid_item');
    ELSE
      BEGIN desired_slot := _slot::public.item_slot;
      EXCEPTION WHEN invalid_text_representation THEN
        v_result := jsonb_build_object('ok', false, 'kind', 'invalid_slot');
      END;
      IF v_result IS NULL AND NOT (
        desired_slot::text = template.slot::text OR
        (template.slot::text = 'ring' AND desired_slot::text IN ('ring', 'ring_2'))
      ) THEN v_result := jsonb_build_object('ok', false, 'kind', 'invalid_slot'); END IF;
      IF v_result IS NULL AND desired_slot::text = 'off_hand' AND EXISTS (
        SELECT 1 FROM public.character_inventory x JOIN public.items xi ON xi.id = x.item_id
        WHERE x.character_id = c.id AND x.equipped_slot::text = 'main_hand' AND xi.hands = 2
      ) THEN v_result := jsonb_build_object('ok', false, 'kind', 'slot_conflict'); END IF;
      IF v_result IS NULL THEN
        IF desired_slot::text = 'main_hand' AND template.hands = 2 THEN
          UPDATE public.character_inventory SET equipped_slot = NULL
            WHERE character_id = c.id AND equipped_slot::text = 'off_hand';
        END IF;
        UPDATE public.character_inventory SET equipped_slot = NULL
          WHERE character_id = c.id AND equipped_slot = desired_slot AND id <> inv.id;
        UPDATE public.character_inventory SET equipped_slot = desired_slot WHERE id = inv.id;
        v_result := jsonb_build_object('ok', true, 'kind', 'updated');
      END IF;
    END IF;
  ELSIF _action = 'consume' THEN
    IF template.item_type <> 'consumable' OR inv.equipped_slot IS NOT NULL THEN
      v_result := jsonb_build_object('ok', false, 'kind', 'invalid_item');
    ELSE
      healing := GREATEST(COALESCE((template.stats->>'hp')::integer, 0), 0);
      regen := GREATEST(COALESCE((template.stats->>'hp_regen')::integer, 0), 0);
      IF healing = 0 AND regen = 0 THEN
        v_result := jsonb_build_object('ok', false, 'kind', 'invalid_item');
      ELSE
        UPDATE public.characters SET hp = LEAST(max_hp, hp + healing) WHERE id = c.id;
        DELETE FROM public.character_inventory WHERE id = inv.id;
        v_result := jsonb_build_object('ok', true, 'kind', 'consumed', 'item_name', template.name,
          'restored', LEAST(healing, GREATEST(c.max_hp - c.hp, 0)), 'hp_regen', regen,
          'hp', LEAST(c.max_hp, c.hp + healing));
      END IF;
    END IF;
  ELSE
    IF inv.equipped_slot IS NOT NULL OR template.is_soulbound THEN
      v_result := jsonb_build_object('ok', false, 'kind', 'invalid_item');
    ELSE
      INSERT INTO public.node_ground_loot(node_id, item_id, dropped_by, applied_gems, stat_override, current_durability, crafted_level)
        VALUES(c.current_node_id, inv.item_id, c.id, inv.applied_gems, inv.stat_override, inv.current_durability, inv.crafted_level);
      DELETE FROM public.character_inventory WHERE id = inv.id;
      v_result := jsonb_build_object('ok', true, 'kind', 'dropped');
    END IF;
  END IF;

  UPDATE public.character_inventory_action_request SET result = v_result
    WHERE request_id = _request_id;
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'kind', 'action_failed');
END $$;
REVOKE ALL ON FUNCTION public.character_inventory_action(uuid,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.character_inventory_action(uuid,text,uuid,text,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.character_repair(
  _character_id uuid,
  _provider text,
  _inventory_id uuid,
  _request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
  c public.characters;
  prior public.character_inventory_action_request;
  args jsonb := jsonb_build_object('provider', _provider);
  row record;
  total integer := 0;
  repaired integer := 0;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.owns_character(_character_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized');
  END IF;
  IF _request_id IS NULL OR _provider NOT IN ('blacksmith', 'jewelcrafter') THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'wrong_provider');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('character_repair:' || _request_id::text, 0));
  SELECT * INTO prior FROM public.character_inventory_action_request WHERE request_id = _request_id;
  IF FOUND THEN
    IF prior.character_id <> _character_id OR prior.action <> 'repair'
       OR prior.inventory_id IS DISTINCT FROM _inventory_id OR prior.arguments <> args THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'request_id_conflict');
    END IF;
    RETURN COALESCE(prior.result, jsonb_build_object('ok', false, 'kind', 'request_pending'));
  END IF;
  SELECT * INTO c FROM public.characters WHERE id = _character_id FOR UPDATE;
  IF c.hp <= 0 THEN RETURN jsonb_build_object('ok', false, 'kind', 'unavailable_while_dead'); END IF;
  IF c.movement_locked_until IS NOT NULL AND c.movement_locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'movement_pending'); END IF;
  IF EXISTS(SELECT 1 FROM public.node_fighter f JOIN public.node_encounter e ON e.id=f.encounter_id
    WHERE f.character_id=c.id AND f.present AND e.status='active') THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'unavailable_while_in_combat'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.nodes n WHERE n.id=c.current_node_id AND
    ((_provider='blacksmith' AND n.is_blacksmith) OR (_provider='jewelcrafter' AND n.is_jewelcrafter))) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_at_provider'); END IF;

  INSERT INTO public.character_inventory_action_request(request_id,character_id,action,inventory_id,arguments)
    VALUES(_request_id,c.id,'repair',_inventory_id,args);
  FOR row IN
    SELECT ci.id, ci.current_durability, i.max_durability, i.value, i.rarity, i.slot
    FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
    WHERE ci.character_id=c.id AND (_inventory_id IS NULL OR ci.id=_inventory_id)
      AND ci.current_durability<i.max_durability AND i.rarity<>'unique'
      AND (_provider='blacksmith' OR i.slot::text IN ('ring','trinket'))
    ORDER BY ci.id FOR UPDATE OF ci
  LOOP
    total := total + GREATEST(1, CEIL((100-row.current_durability)*row.value*
      CASE WHEN row.rarity='uncommon' THEN 1.5 ELSE 1 END/100.0)::integer);
    repaired := repaired + 1;
  END LOOP;
  IF _inventory_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.character_inventory WHERE id=_inventory_id AND character_id=c.id) THEN
    v_result := jsonb_build_object('ok',false,'kind','item_not_owned');
  ELSIF repaired=0 THEN v_result := jsonb_build_object('ok',true,'kind','nothing_to_repair','cost',0,'repaired_count',0,'gold',c.gold);
  ELSIF c.gold<total THEN v_result := jsonb_build_object('ok',false,'kind','insufficient_gold');
  ELSE
    UPDATE public.characters SET gold=gold-total WHERE id=c.id;
    UPDATE public.character_inventory ci SET current_durability=i.max_durability
      FROM public.items i WHERE i.id=ci.item_id AND ci.character_id=c.id
      AND (_inventory_id IS NULL OR ci.id=_inventory_id) AND ci.current_durability<i.max_durability
      AND i.rarity<>'unique' AND (_provider='blacksmith' OR i.slot::text IN ('ring','trinket'));
    v_result := jsonb_build_object('ok',true,'kind','repaired','cost',total,'repaired_count',repaired,'gold',c.gold-total);
  END IF;
  UPDATE public.character_inventory_action_request SET result=v_result WHERE request_id=_request_id;
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','repair_failed');
END $$;
REVOKE ALL ON FUNCTION public.character_repair(uuid,text,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.character_repair(uuid,text,uuid,uuid) TO authenticated, service_role;

-- Old direct helpers with client-controlled economic outcomes are not browser APIs.
REVOKE EXECUTE ON FUNCTION public.buy_vendor_item(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
