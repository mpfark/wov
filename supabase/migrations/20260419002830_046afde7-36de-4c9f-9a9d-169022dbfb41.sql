-- Appearance entries table: single library for both shared (pool) and bespoke (unique) visuals
CREATE TABLE public.appearance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot text NOT NULL,
  material text NOT NULL DEFAULT 'cloth',
  tier text NOT NULL DEFAULT 'common',
  asset_url text NOT NULL DEFAULT '',
  layer_order smallint,
  occludes text[] NOT NULL DEFAULT ARRAY[]::text[],
  prompt_notes text NOT NULL DEFAULT '',
  is_shared boolean NOT NULL DEFAULT true,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_appearance_entries_slot ON public.appearance_entries(slot);
CREATE INDEX idx_appearance_entries_lookup ON public.appearance_entries(slot, material, tier);

ALTER TABLE public.appearance_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view appearance entries"
  ON public.appearance_entries FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert appearance entries"
  ON public.appearance_entries FOR INSERT
  WITH CHECK (is_steward_or_overlord());

CREATE POLICY "Admins can update appearance entries"
  ON public.appearance_entries FOR UPDATE
  USING (is_steward_or_overlord());

CREATE POLICY "Admins can delete appearance entries"
  ON public.appearance_entries FOR DELETE
  USING (is_steward_or_overlord());

CREATE TRIGGER update_appearance_entries_updated_at
  BEFORE UPDATE ON public.appearance_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Items: single appearance_key pointer (used for both pool entries and unique entries)
ALTER TABLE public.items
  ADD COLUMN appearance_key uuid REFERENCES public.appearance_entries(id) ON DELETE SET NULL;

CREATE INDEX idx_items_appearance_key ON public.items(appearance_key);

-- Storage bucket for paper doll assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('paper-doll-assets', 'paper-doll-assets', true);

CREATE POLICY "Paper doll assets are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'paper-doll-assets');

CREATE POLICY "Admins can upload paper doll assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'paper-doll-assets' AND is_steward_or_overlord());

CREATE POLICY "Admins can update paper doll assets"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'paper-doll-assets' AND is_steward_or_overlord());

CREATE POLICY "Admins can delete paper doll assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'paper-doll-assets' AND is_steward_or_overlord());