CREATE POLICY "Owners can view their active effects"
ON public.active_effects
FOR SELECT
TO authenticated
USING (
  public.owns_character(target_id)
  OR public.owns_character(source_id)
  OR public.is_steward_or_overlord()
);

GRANT SELECT ON public.active_effects TO authenticated;