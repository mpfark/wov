
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS portrait_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS portrait_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS portrait_generated_at timestamptz NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('character-portraits', 'character-portraits', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read character portraits'
  ) THEN
    CREATE POLICY "Public read character portraits"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'character-portraits');
  END IF;
END $$;
