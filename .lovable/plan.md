

The user wants two refinements to the existing paper-doll plan. Both are clarifications/improvements rather than new scope. I'll integrate them and re-present the full updated plan concisely.

Refinement 1: Unify unique items into the same resolver path. So drop `appearance_override_url` on items. Instead, create unique appearance entries in the same `appearance_pools` table (or rename it to make the unification clearer). Items always resolve via `appearance_key`. Unique items just point to a unique-tier entry that happens to be one-of-a-kind.

Refinement 2: Codify a per-slot rendering contract upfront — canvas size, anchor, z-index, occlusion rules, layering behavior. This becomes the source of truth for asset creation and rendering.

I'll keep the rest of the plan as-is and present the revised version tightly.

# Paper Doll Equipment Visual System (Revised)

## Concept (unchanged)

Character = stack of transparent PNG layers on a fixed pose. Items don't carry art; they reference an entry in a single shared appearance library. Whether an item is common iron gloves or a one-of-a-kind Soulforged Crown, it resolves through **the same path**.

## Refinement 1 — Unified appearance library

Drop the idea of a separate `appearance_override_url` field on items. There is **one** library, one resolver, one rendering model.

**Single table `appearance_entries`** (replaces "appearance_pools"):
```text
id            uuid pk
slot          item_slot
material      text         -- 'cloth' | 'leather' | 'mail' | 'plate' | 'metal' | 'wood' | 'magical' | 'unique'
tier          text         -- 'common' | 'uncommon' | 'unique'
asset_url     text         -- transparent PNG in storage bucket
layer_order   smallint     -- z-index within slot (default per slot, overridable)
occludes      text[]       -- which other layers this entry hides (e.g. ['hair'] for full helms)
prompt_notes  text         -- AI generation guidance (offline use)
is_shared     boolean      -- true = pool (many items can reference); false = bespoke (one item)
created_at    timestamptz
```

**Items table** gets only one new column:
```text
items.appearance_key  text  -- references appearance_entries.id (or a stable slug)
```

**Resolver behavior** (same for all items):
1. If `items.appearance_key` is set → look up the entry directly.
2. Else → infer a default entry from `(slot, weapon_tag/material hint, rarity tier)` so legacy items still render.

Unique items simply point to an `appearance_entries` row where `is_shared = false` and `tier = 'unique'`. They live in the same library, are previewed in the same admin tool, and render through the same code path. If a unique entry is ever retired, it can be reassigned without touching item rows.

This eliminates the two-system risk. The `appearance_override_url` idea from the prior plan is dropped entirely — no transitional compromise needed because we're starting fresh.

## Refinement 2 — Per-slot rendering contract

Before any assets are produced, ship a contract document and a runtime constants file. Both the renderer and the asset pipeline read from the same source of truth.

**`src/features/character/utils/doll-contract.ts`** — exported constants:

```text
DOLL_CANVAS = { width: 256, height: 384 }   // displayed; assets authored at 2× = 512×768

SLOT_CONTRACT = {
  base_body:  { z: 10,  size: 512×768, anchor: 'center',     occludes: [],            kind: 'base' },
  hair:       { z: 20,  size: 512×768, anchor: 'head',       occludes: [],            kind: 'overlay' },
  cloak:      { z: 15,  size: 512×768, anchor: 'shoulders',  occludes: [],            kind: 'back' },
  legs:       { z: 30,  size: 512×768, anchor: 'hips',       occludes: ['base_legs'], kind: 'overlay' },
  boots:      { z: 35,  size: 512×768, anchor: 'feet',       occludes: ['legs_feet'], kind: 'overlay' },
  chest:      { z: 40,  size: 512×768, anchor: 'torso',      occludes: ['base_torso'],kind: 'overlay' },
  hands:      { z: 45,  size: 512×768, anchor: 'wrists',     occludes: [],            kind: 'overlay' },
  off_hand:   { z: 50,  size: 512×768, anchor: 'left_grip',  occludes: [],            kind: 'prop_left' },
  main_hand:  { z: 60,  size: 512×768, anchor: 'right_grip', occludes: [],            kind: 'prop_right' },
  head:       { z: 70,  size: 512×768, anchor: 'head',       occludes: ['hair?'],     kind: 'overlay' },
}
```

Rules every asset (pooled or unique) must obey:
- **Canvas:** authored at 512×768 PNG, transparent background, no padding crop.
- **Pose & framing:** identical T-pose, eye-level camera, no perspective distortion. The pose is fixed forever; new poses would require a separate doll variant.
- **Anchor:** asset is positioned so the named anchor (head, hips, wrists, etc.) lines up with the base doll's anchor at fixed pixel coordinates.
- **Z-order:** taken from `SLOT_CONTRACT[slot].z` unless the entry sets a `layer_order` override.
- **Occlusion:** if the entry's `occludes` array names another layer, that layer is hidden when this one renders (full helms hide hair; chest plates hide bare torso). Optional occluders use `?` (e.g. some hats keep hair visible).
- **Lighting:** soft top-left key, no baked cast shadows on the ground.
- **Style:** dark fantasy painterly, matching the existing Varneth illustration set.

**Where the contract is enforced:**
1. **Renderer (`PaperDoll.tsx`)** — reads `SLOT_CONTRACT` to decide z-index and occlusion at draw time.
2. **Admin authoring (`AppearanceLibrary.tsx`)** — uploaded PNGs are validated against `size` and previewed against the live doll before save.
3. **AI asset prompts** — the `prompt_notes` field on each entry auto-prepends the contract block (canvas, pose, anchor, lighting, transparent BG) so external generations stay aligned.

If the contract ever needs to evolve (e.g. add a new slot or change canvas size), it changes in one file and the asset library is re-validated against it.

## Phases (unchanged scope)

- **Phase 1:** doll-contract.ts + base bodies (M/F) + Phase-1 slots (head, chest, hands, legs, boots, main_hand, off_hand) + resolver + `PaperDoll` in Character Panel + admin appearance library.
- **Phase 2:** customization (hair style/color via tinted overlays, body type) + admin preview-equip tool.
- **Phase 3:** populate unique entries for milestone gear (Crown, Soulforged) + cloak slot + richer materials.

## Files (revised)

**New (Phase 1):**
- `src/features/character/utils/doll-contract.ts` — single source of truth
- `src/features/character/utils/appearance-resolver.ts`
- `src/features/character/components/PaperDoll.tsx`
- `src/features/character/hooks/useAppearanceEntries.ts`
- migration: `appearance_entries` table, `items.appearance_key` column, `paper-doll-assets` storage bucket

**New (Phase 2):**
- `src/components/admin/AppearanceLibrary.tsx`

**Modified across phases:**
- `CharacterPanel.tsx`, `AdminCharacterSheet.tsx`, `ItemManager.tsx` (appearance_key picker only — no override URL field), `AdminSidebar.tsx`, `CharacterCreation.tsx`
- migration (Phase 3): hair/body columns on `characters`

## What stays unchanged
- All combat, loot, equipping logic
- Item stats, rarity tiers, world drops
- Existing Equipment slot grid (doll renders above it)
- All other pages and RLS

