CREATE UNIQUE INDEX IF NOT EXISTS caa_one_default_per_role
  ON public.class_ability_assignments (role_id)
  WHERE is_default AND status <> 'retired';

CREATE OR REPLACE FUNCTION public.set_assignment_default(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role_id uuid;
BEGIN
  IF public.get_my_admin_role() NOT IN ('steward','overlord') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT role_id INTO _role_id
  FROM public.class_ability_assignments
  WHERE id = _assignment_id;

  IF _role_id IS NULL THEN
    RAISE EXCEPTION 'assignment not found';
  END IF;

  UPDATE public.class_ability_assignments
  SET is_default = (id = _assignment_id)
  WHERE role_id = _role_id AND status <> 'retired';
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_assignment_default(uuid) TO authenticated;