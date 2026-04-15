export interface IllustrationMetadata {
  visual_theme?: string;
  environment_description?: string;
  architectural_style?: string;
  mood?: string;
  time_of_day?: string;
  weather?: string;
  color_palette?: string;
  notable_features?: string;
  prompt_override?: string;
}

export function buildIllustrationPrompt(metadata: IllustrationMetadata): string {
  if (metadata.prompt_override?.trim()) return metadata.prompt_override.trim();

  const parts: string[] = [];

  if (metadata.visual_theme) {
    parts.push(`High-fantasy environment of a ${metadata.visual_theme}.`);
  } else {
    parts.push('High-fantasy environment.');
  }

  if (metadata.environment_description) parts.push(metadata.environment_description);
  if (metadata.architectural_style) parts.push(`Architectural style: ${metadata.architectural_style}.`);
  if (metadata.mood) parts.push(`Mood: ${metadata.mood}.`);
  if (metadata.time_of_day) parts.push(`Time of day: ${metadata.time_of_day}.`);
  if (metadata.weather) parts.push(`Weather: ${metadata.weather}.`);
  if (metadata.color_palette) parts.push(`Color palette: ${metadata.color_palette}.`);
  if (metadata.notable_features) parts.push(`Notable features include ${metadata.notable_features}.`);

  parts.push('Richly detailed, atmospheric lighting, cinematic composition, digital painting, 16:9.');

  return parts.join(' ');
}
