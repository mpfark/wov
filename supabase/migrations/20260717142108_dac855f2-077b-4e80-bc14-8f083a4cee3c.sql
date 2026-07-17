DROP FUNCTION IF EXISTS public.damage_creature(uuid, integer, boolean);
DROP FUNCTION IF EXISTS public.encounter_apply_damage_dry_run(uuid, int);
DROP FUNCTION IF EXISTS public.encounter_apply_character_damage_dry_run(uuid, int);
DROP FUNCTION IF EXISTS public.encounter_apply_character_heal_dry_run(uuid, int);
DROP FUNCTION IF EXISTS public.encounter_apply_character_resource_dry_run(uuid, text, int);