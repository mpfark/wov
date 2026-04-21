import { supabase } from '@/integrations/supabase/client';

export type IllustrationBucket = 'background-images' | 'item-illustrations';

export async function uploadIllustration(
  file: File,
  bucket: IllustrationBucket,
): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '31536000',
    upsert: false,
  });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
