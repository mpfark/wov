-- Keep abilities.effect_config.on_hit_allowed mirrored from their base ability,
-- which is the single authoring source for the allowlist. The runtime resolver
-- reads the ability's effect_config, so the mirror must be maintained in SQL.

CREATE OR REPLACE FUNCTION public.sync_ability_on_hit_allowed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[];
BEGIN
  SELECT b.on_hit_allowed INTO v_allowed
  FROM public.base_abilities b
  WHERE b.id = NEW.base_ability_id;

  NEW.effect_config := jsonb_set(
    COALESCE(NEW.effect_config, '{}'::jsonb),
    '{on_hit_allowed}',
    to_jsonb(COALESCE(v_allowed, ARRAY[]::text[])),
    true
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ability_on_hit_allowed ON public.abilities;
CREATE TRIGGER trg_sync_ability_on_hit_allowed
BEFORE INSERT OR UPDATE OF base_ability_id, effect_config ON public.abilities
FOR EACH ROW EXECUTE FUNCTION public.sync_ability_on_hit_allowed();

CREATE OR REPLACE FUNCTION public.sync_base_on_hit_allowed_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.on_hit_allowed IS DISTINCT FROM OLD.on_hit_allowed THEN
    UPDATE public.abilities a
    SET effect_config = jsonb_set(
      COALESCE(a.effect_config, '{}'::jsonb),
      '{on_hit_allowed}',
      to_jsonb(NEW.on_hit_allowed),
      true
    )
    WHERE a.base_ability_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_base_on_hit_allowed_children ON public.base_abilities;
CREATE TRIGGER trg_sync_base_on_hit_allowed_children
AFTER UPDATE ON public.base_abilities
FOR EACH ROW EXECUTE FUNCTION public.sync_base_on_hit_allowed_children();

-- Backfill existing abilities from their base.
UPDATE public.abilities a
SET effect_config = jsonb_set(
  COALESCE(a.effect_config, '{}'::jsonb),
  '{on_hit_allowed}',
  to_jsonb(b.on_hit_allowed),
  true
)
FROM public.base_abilities b
WHERE a.base_ability_id = b.id;