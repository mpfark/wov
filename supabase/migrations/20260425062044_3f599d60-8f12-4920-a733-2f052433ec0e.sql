-- 1) Move pg_net out of public into a dedicated extensions schema.
--    pg_net does not support ALTER EXTENSION ... SET SCHEMA, so drop & recreate.
CREATE SCHEMA IF NOT EXISTS extensions;
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

-- 2) Drop broad SELECT policies on storage.objects for public buckets.
--    These buckets remain public (bucket.public = true), so files are still
--    served directly via the CDN using getPublicUrl(). Removing the broad
--    SELECT policy prevents clients from LISTING bucket contents via the
--    storage API, which is what the linter flags.
DROP POLICY IF EXISTS "Anyone can view background images" ON storage.objects;
DROP POLICY IF EXISTS "Paper doll assets are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Public can view item illustrations" ON storage.objects;
DROP POLICY IF EXISTS "Public read email-assets" ON storage.objects;