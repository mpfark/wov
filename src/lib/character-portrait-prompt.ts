// Frontend mirror of the prompt builder used by the
// `ai-character-portrait` edge function. The edge function is the
// source of truth at generation time; this file exists so any
// future preview/debug UI can show the same prompt.

import { RACE_LABELS, CLASS_LABELS } from '@/lib/game-data';

export type PortraitHeight = 'short' | 'average' | 'tall';
export type PortraitBodyType = 'lean' | 'average' | 'muscular' | 'heavyset';

export interface PortraitInputs {
  description: string;
  height: PortraitHeight;
  body_type: PortraitBodyType;
}

export interface EquippedGearLine {
  /** e.g. "main_hand", "chest" */
  slot: string;
  /** Item name (no rarity colors etc.). */
  name: string;
}

interface BuildArgs {
  name: string;
  race: string;
  class: string;
  gender?: 'male' | 'female';
  inputs: PortraitInputs;
  equipped: EquippedGearLine[];
}

const HEIGHT_LABEL: Record<PortraitHeight, string> = {
  short: 'short',
  average: 'average height',
  tall: 'tall',
};

const BODY_LABEL: Record<PortraitBodyType, string> = {
  lean: 'lean build',
  average: 'average build',
  muscular: 'muscular build',
  heavyset: 'heavyset build',
};

// Mirrors `RARITY_STYLE.unique` from item-illustration-prompt.ts so the
// portrait sits visually next to item illustrations.
const STYLE =
  'masterwork craftsmanship, fine materials and restrained ornamentation, faint magical character — no glowing runes, no gemstone encrustation, no radiant aura';

const SUFFIX =
  'Dark fantasy painterly art, dramatic chiaroscuro lighting against a deep neutral background, centered framing, no text, no watermark, no border, square 1:1 composition, character only — no extra figures, no background scenery.';

export function buildCharacterPortraitPrompt(args: BuildArgs): string {
  const race = RACE_LABELS[args.race] ?? args.race;
  const klass = CLASS_LABELS[args.class] ?? args.class;
  const gender = args.gender ?? 'male';

  const gearLine = args.equipped.length
    ? args.equipped
        .map((g) => `${g.name} (${g.slot.replace('_', ' ')})`)
        .join(', ')
    : 'simple traveler\'s clothing';

  const desc = args.inputs.description.trim() || 'no specific notes';

  const parts: string[] = [
    `A single hero-shot full-body portrait of a ${gender} ${race} ${klass} named "${args.name}".`,
    `Appearance: ${desc}.`,
    `Build: ${HEIGHT_LABEL[args.inputs.height]}, ${BODY_LABEL[args.inputs.body_type]}.`,
    `Equipped gear: ${gearLine}.`,
    `Style: ${STYLE}.`,
    SUFFIX,
  ];

  return parts.join(' ');
}
