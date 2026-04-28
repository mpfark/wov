ALTER TABLE public.npcs DROP CONSTRAINT IF EXISTS npcs_service_role_check;
ALTER TABLE public.npcs
  ADD CONSTRAINT npcs_service_role_check
  CHECK (service_role IS NULL OR service_role IN ('vendor', 'blacksmith', 'trainer'));