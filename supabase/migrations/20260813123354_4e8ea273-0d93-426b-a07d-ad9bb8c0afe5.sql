CREATE OR REPLACE FUNCTION public.c2h_fill_action_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.c2h_fill_action_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS c2h_fill_action_id ON public.combat_actions;
CREATE TRIGGER c2h_fill_action_id
BEFORE INSERT ON public.combat_actions
FOR EACH ROW EXECUTE FUNCTION public.c2h_fill_action_id();