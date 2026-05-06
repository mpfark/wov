ALTER TABLE public.weapon_progression_config REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.weapon_progression_config;