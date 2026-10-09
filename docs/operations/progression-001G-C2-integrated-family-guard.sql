-- Activation-only approved C2-04: no family at creation, L10 founding / L1 joining.
-- Existing function signature/owner/ACL retained, no new grants. Drift aborts.
DO $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.apply_family_to_character(uuid,text)'::regprocedure
    AND proowner='postgres'::regrole AND prosecdef AND proconfig @> ARRAY['search_path=public']
    AND encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='da44f7162bd0104a77a6f3f7d2b03d2fcc7689f04f4b930d036362b4e53ee91e')
  THEN RAISE EXCEPTION 'family source drift; inspect instead of overwriting'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.apply_family_to_character(
  _character_id UUID,
  _display TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  _key TEXT;
  _family_id UUID;
  _family_display TEXT;
  _founder UUID;
  _is_member BOOLEAN;
  _char RECORD;
  _hash BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, user_id, family_name, family_changed_after_creation, level, deleted_at
    INTO _char
    FROM public.characters WHERE id = _character_id FOR UPDATE;
  IF NOT FOUND OR _char.user_id <> auth.uid() OR _char.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Character not found';
  END IF;

  -- Clearing family name
  IF _display IS NULL OR length(btrim(_display)) = 0 THEN
    UPDATE public.characters
      SET family_name = NULL, family_id = NULL
      WHERE id = _character_id;
    RETURN jsonb_build_object('ok', true, 'cleared', true);
  END IF;

  IF _display !~ '^[A-Za-z]{2,20}$' THEN
    RAISE EXCEPTION 'Family name must be 2-20 letters';
  END IF;
  _key := lower(_display);
  IF public._family_name_is_reserved(_key) THEN
    RAISE EXCEPTION 'That family name is reserved';
  END IF;

  -- advisory lock keyed on the family name to make the founder claim atomic
  _hash := abs(hashtextextended(_key, 0));
  PERFORM pg_advisory_xact_lock(_hash);

  SELECT id, display_name, founder_user_id
    INTO _family_id, _family_display, _founder
    FROM public.families WHERE key = _key;

  IF NOT FOUND THEN
    IF _char.level < 10 THEN RAISE EXCEPTION 'Family founding requires level 10'; END IF;
    INSERT INTO public.families (key, display_name, founder_user_id)
      VALUES (_key, _display, auth.uid())
      RETURNING id, display_name, founder_user_id INTO _family_id, _family_display, _founder;
  ELSE
    IF _founder <> auth.uid() THEN
      SELECT EXISTS(
        SELECT 1 FROM public.family_members
        WHERE family_id = _family_id AND user_id = auth.uid()
      ) INTO _is_member;
      IF NOT _is_member THEN
        RAISE EXCEPTION 'You are not a member of the % family', _family_display;
      END IF;
    END IF;
  END IF;

  UPDATE public.characters
    SET family_name = _family_display,
        family_id = _family_id
    WHERE id = _character_id;

  RETURN jsonb_build_object(
    'ok', true,
    'family_id', _family_id,
    'display_name', _family_display,
    'founded', (_founder = auth.uid())
  );
END;
$$;
