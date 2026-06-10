/**
 * Format a character display name combining first name and optional family name.
 * Accepts any object that has `name` and an optional `family_name` field.
 */
export function formatCharacterName(c?: {
  name?: string | null;
  family_name?: string | null;
} | null): string {
  if (!c?.name) return '';
  return c.family_name ? `${c.name} ${c.family_name}` : c.name;
}
