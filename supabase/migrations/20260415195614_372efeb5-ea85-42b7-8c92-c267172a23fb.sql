
-- Allow public reads (bucket is already public, but explicit policy)
CREATE POLICY "Anyone can view background images"
ON storage.objects FOR SELECT
USING (bucket_id = 'background-images');

-- Only admins can upload
CREATE POLICY "Admins can upload background images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'background-images' AND public.is_steward_or_overlord());

-- Only admins can update
CREATE POLICY "Admins can update background images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'background-images' AND public.is_steward_or_overlord());

-- Only admins can delete
CREATE POLICY "Admins can delete background images"
ON storage.objects FOR DELETE
USING (bucket_id = 'background-images' AND public.is_steward_or_overlord());
