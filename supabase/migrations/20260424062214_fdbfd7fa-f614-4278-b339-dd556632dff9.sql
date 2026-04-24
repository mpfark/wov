ALTER PUBLICATION supabase_realtime ADD TABLE public.marketplace_listings;
ALTER TABLE public.marketplace_listings REPLICA IDENTITY FULL;