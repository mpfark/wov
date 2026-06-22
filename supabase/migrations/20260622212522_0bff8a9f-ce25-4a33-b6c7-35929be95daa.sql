CREATE OR REPLACE FUNCTION public.delete_character_cascade(_character_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid;
BEGIN
    SELECT user_id INTO _user_id FROM public.characters WHERE id = _character_id;
    IF _user_id IS NULL THEN
        RAISE EXCEPTION 'Character not found';
    END IF;

    IF NOT (
        _user_id = auth.uid()
        OR public.has_role(auth.uid(), 'steward'::app_role)
        OR public.has_role(auth.uid(), 'overlord'::app_role)
    ) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    PERFORM set_config('app.trusted_rpc', 'true', true);

    DELETE FROM public.marketplace_listings
     WHERE seller_character_id = _character_id OR buyer_character_id = _character_id;

    DELETE FROM public.active_effects
     WHERE target_id = _character_id OR source_id = _character_id;

    DELETE FROM public.node_ground_loot WHERE dropped_by = _character_id;
    DELETE FROM public.character_visited_nodes WHERE character_id = _character_id;
    DELETE FROM public.character_class_bonds WHERE character_id = _character_id;
    DELETE FROM public.character_materials WHERE character_id = _character_id;
    DELETE FROM public.combat_sessions WHERE character_id = _character_id;
    DELETE FROM public.activity_log WHERE character_id = _character_id;
    DELETE FROM public.issue_reports WHERE character_id = _character_id;
    DELETE FROM public.character_inventory WHERE character_id = _character_id;
    DELETE FROM public.party_members WHERE character_id = _character_id;

    DELETE FROM public.characters WHERE id = _character_id;

    RETURN _character_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_character_cascade(uuid) TO authenticated;