CREATE TABLE public.combat_soak_access (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id)
);

GRANT SELECT ON public.combat_soak_access TO authenticated;
GRANT ALL ON public.combat_soak_access TO service_role;

ALTER TABLE public.combat_soak_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Overlords manage combat soak access"
ON public.combat_soak_access FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'overlord'))
WITH CHECK (public.has_role(auth.uid(), 'overlord'));

CREATE OR REPLACE FUNCTION public.combat_soak_access_check(_character_id uuid, _node_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.combat_config cc
    WHERE cc.key = 'combat_soak' AND cc.value = 'on'
  )
  AND EXISTS (
    SELECT 1
    FROM public.combat_soak_access s
    JOIN public.characters c ON c.id = s.character_id
    WHERE s.expires_at > now()
      AND c.current_node_id = s.node_id
      AND (_character_id IS NULL OR s.character_id = _character_id)
      AND (_node_id IS NULL OR s.node_id = _node_id)
  );
$$;

REVOKE ALL ON FUNCTION public.combat_soak_access_check(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.combat_soak_access_check(uuid, uuid) TO service_role;