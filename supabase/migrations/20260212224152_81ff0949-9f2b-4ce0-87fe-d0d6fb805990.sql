
-- Table mapping each character_class to a starting item (weapon)
CREATE TABLE public.class_starting_gear (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class public.character_class NOT NULL UNIQUE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.class_starting_gear ENABLE ROW LEVEL SECURITY;

-- Anyone can read (needed during character creation)
CREATE POLICY "Anyone can view starting gear"
  ON public.class_starting_gear FOR SELECT
  USING (true);

-- Only admins can manage
CREATE POLICY "Admins can insert starting gear"
  ON public.class_starting_gear FOR INSERT
  WITH CHECK (is_maiar_or_valar());

CREATE POLICY "Admins can update starting gear"
  ON public.class_starting_gear FOR UPDATE
  USING (is_maiar_or_valar());

CREATE POLICY "Admins can delete starting gear"
  ON public.class_starting_gear FOR DELETE
  USING (is_maiar_or_valar());
