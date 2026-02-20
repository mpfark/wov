
-- Universal starting gear given to ALL new characters regardless of class
CREATE TABLE public.universal_starting_gear (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  equipped_slot TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Prevent duplicate slot assignments
CREATE UNIQUE INDEX idx_universal_starting_gear_slot ON public.universal_starting_gear(equipped_slot);

ALTER TABLE public.universal_starting_gear ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view universal starting gear"
  ON public.universal_starting_gear FOR SELECT USING (true);

CREATE POLICY "Admins can insert universal starting gear"
  ON public.universal_starting_gear FOR INSERT WITH CHECK (is_steward_or_overlord());

CREATE POLICY "Admins can update universal starting gear"
  ON public.universal_starting_gear FOR UPDATE USING (is_steward_or_overlord());

CREATE POLICY "Admins can delete universal starting gear"
  ON public.universal_starting_gear FOR DELETE USING (is_steward_or_overlord());
