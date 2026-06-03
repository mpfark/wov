
-- Phase 1: Class Bond plumbing (dark-launched, no gameplay impact)

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS is_classless boolean NOT NULL DEFAULT false;

ALTER TABLE public.nodes
  ADD COLUMN IF NOT EXISTS class_hall public.character_class NULL;

CREATE TABLE IF NOT EXISTS public.character_class_bonds (
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  class public.character_class NOT NULL,
  bond integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, class),
  CONSTRAINT bond_range CHECK (bond >= 0 AND bond <= 100)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.character_class_bonds TO authenticated;
GRANT ALL ON public.character_class_bonds TO service_role;

ALTER TABLE public.character_class_bonds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their bonds"
  ON public.character_class_bonds FOR SELECT
  TO authenticated
  USING (public.owns_character(character_id));

CREATE POLICY "Owners write their bonds"
  ON public.character_class_bonds FOR ALL
  TO authenticated
  USING (public.owns_character(character_id))
  WITH CHECK (public.owns_character(character_id));

CREATE POLICY "Admins read all bonds"
  ON public.character_class_bonds FOR SELECT
  TO authenticated
  USING (public.is_steward_or_overlord());

-- Bond award helper (server-side, called from edge functions / RPCs)
CREATE OR REPLACE FUNCTION public.award_class_bond(
  _character_id uuid,
  _class public.character_class,
  _amount integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new integer;
BEGIN
  IF _amount IS NULL OR _amount = 0 THEN RETURN 0; END IF;
  IF _amount < 0 OR _amount > 100 THEN
    RAISE EXCEPTION 'Invalid bond delta: %', _amount;
  END IF;

  INSERT INTO public.character_class_bonds (character_id, class, bond, updated_at)
  VALUES (_character_id, _class, LEAST(100, _amount), now())
  ON CONFLICT (character_id, class)
  DO UPDATE SET bond = LEAST(100, public.character_class_bonds.bond + EXCLUDED.bond),
                updated_at = now()
  RETURNING bond INTO _new;

  RETURN _new;
END;
$$;

-- Join an order (sets the character's class & resets resources)
CREATE OR REPLACE FUNCTION public.join_order(
  _character_id uuid,
  _class public.character_class
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _char RECORD;
BEGIN
  IF NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM public.characters WHERE id = _character_id FOR UPDATE;
  IF _char IS NULL THEN RAISE EXCEPTION 'Character not found'; END IF;

  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE public.characters
     SET class = _class,
         is_classless = false,
         reserved_buffs = '{}'::jsonb
   WHERE id = _character_id;

  INSERT INTO public.character_class_bonds (character_id, class, bond)
  VALUES (_character_id, _class, 0)
  ON CONFLICT (character_id, class) DO NOTHING;

  PERFORM public.sync_character_resources(_character_id);

  INSERT INTO public.activity_log (user_id, character_id, event_type, message, metadata)
  VALUES (auth.uid(), _character_id, 'general',
          'Joined ' || _class::text || ' order', jsonb_build_object('class', _class));

  RETURN jsonb_build_object('class', _class, 'bond', COALESCE(
    (SELECT bond FROM public.character_class_bonds WHERE character_id = _character_id AND class = _class), 0));
END;
$$;

-- Switch order (preserves bond on the prior class)
CREATE OR REPLACE FUNCTION public.switch_order(
  _character_id uuid,
  _class public.character_class
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.join_order(_character_id, _class);
END;
$$;

-- Seed bond 100 for existing characters in their current class (no nerf on launch)
INSERT INTO public.character_class_bonds (character_id, class, bond)
SELECT id, class, 100 FROM public.characters
ON CONFLICT (character_id, class) DO NOTHING;
