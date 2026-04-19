/**
 * Paper Doll Rendering Contract
 *
 * Single source of truth for the paper-doll visual system.
 * Used by:
 *   - PaperDoll renderer (z-index, occlusion, sizing)
 *   - AppearanceLibrary admin tool (asset validation, preview)
 *   - External AI prompt guidance (prompt_notes auto-prepend)
 *
 * Asset authoring rules — every PNG in the appearance library must obey:
 *   - 512×768 transparent PNG, no padding crop
 *   - Identical T-pose, eye-level camera, no perspective distortion
 *   - Anchor pixel-aligned to the named anchor point on the base doll
 *   - Soft top-left key lighting, no baked ground shadows
 *   - Dark fantasy painterly style, matching Varneth illustration set
 */

export const DOLL_CANVAS = {
  width: 256,
  height: 384,
  // Assets are authored at 2x and downscaled in the browser
  authorWidth: 512,
  authorHeight: 768,
} as const;

export type DollSlot =
  | 'base_body'
  | 'hair'
  | 'cloak'
  | 'legs'
  | 'boots'
  | 'chest'
  | 'hands'
  | 'off_hand'
  | 'main_hand'
  | 'head';

export type DollSlotKind = 'base' | 'overlay' | 'back' | 'prop_left' | 'prop_right';

export interface DollSlotContract {
  z: number;
  anchor: string;
  occludes: string[];
  kind: DollSlotKind;
}

/**
 * Per-slot rendering contract.
 * Z-order is bottom-up; higher z renders on top.
 * Optional occluders are marked with `?` (e.g. 'hair?' = some helms keep hair visible).
 */
export const SLOT_CONTRACT: Record<DollSlot, DollSlotContract> = {
  base_body: { z: 10, anchor: 'center',     occludes: [],              kind: 'base' },
  cloak:     { z: 15, anchor: 'shoulders',  occludes: [],              kind: 'back' },
  hair:      { z: 20, anchor: 'head',       occludes: [],              kind: 'overlay' },
  legs:      { z: 30, anchor: 'hips',       occludes: ['base_legs'],   kind: 'overlay' },
  boots:     { z: 35, anchor: 'feet',       occludes: ['legs_feet'],   kind: 'overlay' },
  chest:     { z: 40, anchor: 'torso',      occludes: ['base_torso'],  kind: 'overlay' },
  hands:     { z: 45, anchor: 'wrists',     occludes: [],              kind: 'overlay' },
  off_hand:  { z: 50, anchor: 'left_grip',  occludes: [],              kind: 'prop_left' },
  main_hand: { z: 60, anchor: 'right_grip', occludes: [],              kind: 'prop_right' },
  head:      { z: 70, anchor: 'head',       occludes: ['hair?'],       kind: 'overlay' },
};

/**
 * Maps a game item slot to the doll slot used by the renderer.
 * Item slots not in this map (rings, amulets, trinkets, belts, shoulders, pants)
 * are not rendered on the doll in Phase 1.
 */
export const ITEM_SLOT_TO_DOLL_SLOT: Record<string, DollSlot> = {
  head: 'head',
  chest: 'chest',
  gloves: 'hands',
  pants: 'legs',
  boots: 'boots',
  main_hand: 'main_hand',
  off_hand: 'off_hand',
};

/**
 * The fixed prompt block prepended to every entry's `prompt_notes` when an
 * admin/steward generates assets externally. Guarantees alignment.
 */
export const CONTRACT_PROMPT_PREFIX = `PAPER DOLL ASSET REQUIREMENTS (must follow exactly):
- Canvas: 512x768 PNG, fully transparent background
- Pose: T-pose, arms extended slightly, eye-level camera, no perspective distortion
- Lighting: soft top-left key, no baked ground shadow
- Style: dark fantasy painterly, matching the Varneth illustration set
- Coverage: only the asset itself; no body parts other than what this layer covers
- Alignment: must register pixel-aligned to a 512x768 canvas of the base doll
`;

export function buildPromptForEntry(slot: DollSlot, material: string, tier: string, notes: string): string {
  const contract = SLOT_CONTRACT[slot];
  return `${CONTRACT_PROMPT_PREFIX}
SLOT: ${slot} (anchor: ${contract.anchor}, kind: ${contract.kind})
MATERIAL: ${material}
TIER: ${tier}
${notes ? `\nNOTES:\n${notes}` : ''}`.trim();
}
