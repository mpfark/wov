REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.encounter_kill_awards, public.encounter_death_loot, public.encounter_tick_batches
  FROM anon, authenticated;

REVOKE SELECT ON public.encounter_kill_awards, public.encounter_death_loot, public.encounter_tick_batches
  FROM anon;

GRANT SELECT ON public.encounter_kill_awards, public.encounter_death_loot, public.encounter_tick_batches
  TO authenticated;

GRANT ALL ON public.encounter_kill_awards, public.encounter_death_loot, public.encounter_tick_batches
  TO service_role;