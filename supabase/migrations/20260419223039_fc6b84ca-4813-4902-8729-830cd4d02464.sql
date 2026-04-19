-- Add illustration_url column to items
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS illustration_url text NOT NULL DEFAULT '';

-- Create public bucket for item illustrations
INSERT INTO storage.buckets (id, name, public)
VALUES ('item-illustrations', 'item-illustrations', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: public read, admin write
CREATE POLICY "Public can view item illustrations"
ON storage.objects FOR SELECT
USING (bucket_id = 'item-illustrations');

CREATE POLICY "Admins can upload item illustrations"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'item-illustrations' AND public.is_steward_or_overlord());

CREATE POLICY "Admins can update item illustrations"
ON storage.objects FOR UPDATE
USING (bucket_id = 'item-illustrations' AND public.is_steward_or_overlord());

CREATE POLICY "Admins can delete item illustrations"
ON storage.objects FOR DELETE
USING (bucket_id = 'item-illustrations' AND public.is_steward_or_overlord());