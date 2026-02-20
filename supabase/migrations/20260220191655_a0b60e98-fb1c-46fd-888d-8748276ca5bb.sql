
-- Create loot_tables table
CREATE TABLE public.loot_tables (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.loot_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage loot tables" ON public.loot_tables FOR ALL USING (is_steward_or_overlord());
CREATE POLICY "Anyone can view loot tables" ON public.loot_tables FOR SELECT USING (true);

-- Create loot_table_entries table
CREATE TABLE public.loot_table_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  loot_table_id uuid NOT NULL REFERENCES public.loot_tables(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  weight integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.loot_table_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage loot table entries" ON public.loot_table_entries FOR ALL USING (is_steward_or_overlord());
CREATE POLICY "Anyone can view loot table entries" ON public.loot_table_entries FOR SELECT USING (true);

-- Add columns to creatures
ALTER TABLE public.creatures
  ADD COLUMN loot_table_id uuid REFERENCES public.loot_tables(id) ON DELETE SET NULL,
  ADD COLUMN drop_chance numeric NOT NULL DEFAULT 0.5;

-- Enable realtime for loot tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.loot_tables;
ALTER PUBLICATION supabase_realtime ADD TABLE public.loot_table_entries;
