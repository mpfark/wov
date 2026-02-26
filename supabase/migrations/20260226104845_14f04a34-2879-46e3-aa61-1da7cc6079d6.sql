
-- Single-row table for global XP boost
CREATE TABLE public.xp_boost (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  multiplier numeric NOT NULL DEFAULT 1,
  expires_at timestamp with time zone,
  activated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Insert the single config row
INSERT INTO public.xp_boost (multiplier, expires_at) VALUES (1, NULL);

-- Enable RLS
ALTER TABLE public.xp_boost ENABLE ROW LEVEL SECURITY;

-- Everyone can read (players need to check boost status)
CREATE POLICY "Anyone can view xp boost" ON public.xp_boost
  FOR SELECT USING (true);

-- Only admins can update
CREATE POLICY "Admins can update xp boost" ON public.xp_boost
  FOR UPDATE USING (is_steward_or_overlord());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.xp_boost;
