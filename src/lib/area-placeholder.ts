// Computes the area-type placeholder illustration URL.
// Mirrors public.area_type_placeholder_url() in the database.
// Used as a last-resort fallback for backgrounds when no real illustration exists
// on the node, area, or region. Never persisted to the database.

const BASE_URL =
  'https://gpclaklkaolyzfnooajt.supabase.co/storage/v1/object/public/background-images/placeholders';

// Bump this when placeholder images are re-uploaded to bust the CDN/browser cache.
const PLACEHOLDER_VERSION = '20260531-2';

export function areaTypePlaceholderUrl(areaType?: string | null): string {
  const type = (areaType || '').trim() || 'other';
  return `${BASE_URL}/area-type-${type}.jpg?v=${PLACEHOLDER_VERSION}`;
}
