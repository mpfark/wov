DROP TRIGGER IF EXISTS c2fix_fill_action_id ON public.combat_actions;
DROP FUNCTION IF EXISTS public.c2fix_fill_action_id();

DROP TRIGGER IF EXISTS c2h_f_creatures ON public.creatures;
DROP TRIGGER IF EXISTS c2h_f_dup ON public.creatures;
DROP TRIGGER IF EXISTS c2h_f_characters ON public.characters;
DROP TRIGGER IF EXISTS c2h_f_awards ON public.encounter_kill_awards;
DROP TRIGGER IF EXISTS c2h_f_loot ON public.encounter_death_loot;
DROP TRIGGER IF EXISTS c2h_f_inv ON public.character_inventory;
DROP TRIGGER IF EXISTS c2h_f_batch ON public.encounter_tick_batches;

DROP FUNCTION IF EXISTS public.c2_harness_run();
DROP FUNCTION IF EXISTS public.c2_harness_run_c();
DROP FUNCTION IF EXISTS public.c2h_state(uuid, uuid[], uuid[], uuid);
DROP FUNCTION IF EXISTS public.c2h_diff(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.c2h_rec(jsonb, text, text, text, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.c2h_fault();
DROP FUNCTION IF EXISTS public.c2h_dup_batch();