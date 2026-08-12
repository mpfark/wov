GRANT SELECT ON public.encounter_tick_batches TO authenticated;
GRANT ALL ON public.encounter_tick_batches TO service_role;

ALTER TABLE public.encounter_tick_batches REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'encounter_tick_batches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.encounter_tick_batches;
  END IF;
END $$;