UPDATE public.combat_config SET value = 'off' WHERE key = 'combat_soak';
UPDATE public.combat_config SET value = 'maintenance' WHERE key = 'combat_mode';
DELETE FROM public.combat_soak_access;
DELETE FROM public.combat_soak_scopes;
DELETE FROM public.encounter_engagements;
DELETE FROM public.encounter_participants;