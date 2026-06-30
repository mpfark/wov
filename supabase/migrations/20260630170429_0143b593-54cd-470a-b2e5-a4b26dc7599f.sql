
-- 1) Add map fields to items
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS map_target_node_id uuid REFERENCES public.nodes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS map_region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS map_flavor text;

-- 2) Ledger for once-per-character NPC gifts
CREATE TABLE IF NOT EXISTS public.character_npc_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  npc_id uuid NOT NULL REFERENCES public.npcs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, npc_id, item_id)
);

GRANT SELECT ON public.character_npc_gifts TO authenticated;
GRANT ALL ON public.character_npc_gifts TO service_role;

ALTER TABLE public.character_npc_gifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their gift ledger"
ON public.character_npc_gifts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.id = character_npc_gifts.character_id AND c.user_id = auth.uid()
  )
);

-- 3) Grant gift RPC — adds an item to inventory, respecting once_per_character.
CREATE OR REPLACE FUNCTION public.grant_npc_gift(
  _character_id uuid,
  _npc_id uuid,
  _item_id uuid,
  _once_per_character boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_owner uuid;
  v_already_in_inv boolean;
  v_already_gifted boolean;
BEGIN
  v_user := auth.uid();
  SELECT user_id INTO v_owner FROM public.characters WHERE id = _character_id;
  IF v_owner IS NULL OR v_owner <> v_user THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;

  IF _once_per_character THEN
    SELECT EXISTS (
      SELECT 1 FROM public.character_npc_gifts
      WHERE character_id = _character_id AND npc_id = _npc_id AND item_id = _item_id
    ) INTO v_already_gifted;
    IF v_already_gifted THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_gifted');
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.character_inventory
    WHERE character_id = _character_id AND item_id = _item_id
  ) INTO v_already_in_inv;

  IF NOT v_already_in_inv THEN
    INSERT INTO public.character_inventory (character_id, item_id, current_durability)
    VALUES (_character_id, _item_id, 100);
  END IF;

  INSERT INTO public.character_npc_gifts (character_id, npc_id, item_id)
  VALUES (_character_id, _npc_id, _item_id)
  ON CONFLICT (character_id, npc_id, item_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'already_in_inventory', v_already_in_inv);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_npc_gift(uuid, uuid, uuid, boolean) TO authenticated;

-- 4) Consume map items targeting a node when the player arrives.
CREATE OR REPLACE FUNCTION public.consume_maps_for_node(
  _character_id uuid,
  _node_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_owner uuid;
  v_count integer := 0;
BEGIN
  v_user := auth.uid();
  SELECT user_id INTO v_owner FROM public.characters WHERE id = _character_id;
  IF v_owner IS NULL OR v_owner <> v_user THEN
    RETURN 0;
  END IF;

  WITH del AS (
    DELETE FROM public.character_inventory ci
    USING public.items i
    WHERE ci.item_id = i.id
      AND ci.character_id = _character_id
      AND i.item_type = 'quest'
      AND i.map_target_node_id = _node_id
    RETURNING ci.id
  )
  SELECT count(*) INTO v_count FROM del;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_maps_for_node(uuid, uuid) TO authenticated;
