-- Teardown of the TEMPORARY C5 validation authorization surface.
DROP FUNCTION IF EXISTS public.combat_validation_grant_check(text, uuid, text);
DROP TABLE IF EXISTS public.combat_validation_grants;