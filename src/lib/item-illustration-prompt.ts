export interface ItemIllustrationMetadata {
  visual_theme?: string;
  material?: string;
  silhouette?: string;
  ornamentation?: string;
  color_palette?: string;
  mood?: string;
  notable_features?: string;
  prompt_override?: string;
}

const RARITY_STYLE: Record<string, string> = {
  common: 'weathered, simple craftsmanship, plain materials',
  uncommon: 'well-crafted, refined details, subtle ornamentation, hints of magical sheen',
  unique: 'ornate, jeweled, glowing arcane runes, masterwork, legendary aura',
};

interface BuildArgs {
  name: string;
  description?: string;
  rarity: string;
  slot?: string | null;
  item_type: string;
  metadata?: ItemIllustrationMetadata;
}

export function buildItemIllustrationPrompt(args: BuildArgs): string {
  const meta = args.metadata ?? {};
  if (meta.prompt_override?.trim()) return meta.prompt_override.trim();

  const style = RARITY_STYLE[args.rarity] || RARITY_STYLE.common;
  const subject =
    args.item_type === 'consumable'
      ? `a fantasy potion or consumable called "${args.name}"`
      : args.slot
        ? `a fantasy ${args.slot.replace('_', ' ')} item called "${args.name}"`
        : `a fantasy item called "${args.name}"`;

  const parts: string[] = [`A single hero-shot illustration of ${subject}.`];
  if (args.description) parts.push(`Lore: ${args.description}`);
  if (meta.visual_theme) parts.push(`Theme: ${meta.visual_theme}.`);
  if (meta.material) parts.push(`Material: ${meta.material}.`);
  if (meta.silhouette) parts.push(`Silhouette: ${meta.silhouette}.`);
  if (meta.ornamentation) parts.push(`Ornamentation: ${meta.ornamentation}.`);
  if (meta.color_palette) parts.push(`Color palette: ${meta.color_palette}.`);
  if (meta.mood) parts.push(`Mood: ${meta.mood}.`);
  if (meta.notable_features) parts.push(`Notable features: ${meta.notable_features}.`);
  parts.push(`Style: ${style}.`);
  parts.push(
    'Dark fantasy painterly art, dramatic chiaroscuro lighting against a deep neutral background, centered framing, no text, no watermark, no border, square 1:1 composition, item only — no character, no hands.',
  );
  return parts.join(' ');
}
