## Item Tooltip Redesign + Weapon Progression Fix

Two changes shipped together because they share the same code path: a **bug fix** to make the previous weapon-progression wiring actually work (the column is `level`, not `item_level`), plus the **tooltip redesign** that finally surfaces the scaled weapon damage to players.

### 1. Bug fix — wire weapon progression to the real column

`public.items` has a column called `level` (not `item_level`). The previous pass selected/read `item_level`, so progression silently never activates.

Files:

- **`supabase/functions/combat-tick/index.ts`** — change the equipment select to `item:items(stats, weapon_tag, hands, procs, level)` and read `(e.item as any)?.level` into `mhLvl` / `ohLvl`.
- **`src/features/character/components/CharacterPanel.tsx`** — read `mainHandItem?.item?.level` instead of `(item as any).item_level`.
- **`src/components/admin/loot/WeaponProgressionTab.tsx`** — preview already uses synthetic numbers, no change.

### 2. Reusable tooltip component

Create **`src/components/items/ItemTooltipCard.tsx`**:

```ts
type ItemLike = {
  name: string;
  description?: string | null;
  rarity: string;
  is_soulbound?: boolean;
  item_type: string;
  slot?: string | null;
  hands?: number | null;
  weapon_tag?: string | null;
  level?: number | null;
  stats?: Record<string, number> | null;
  value?: number | null;
  illustration_url?: string | null;
  procs?: any[] | null;
};

interface Props {
  item: ItemLike;
  durabilityPct?: number;          // omit → no durability line
  qty?: number;                    // > 1 → "Qty: ×N"
  classKey?: string;               // for affinity label
  comparison?: { label: string; diffs: { key: string; diff: number }[] };
  flavorText?: string | null;      // optional italic block
  showValue?: boolean;             // default true
  isBroken?: boolean;
}
```

Layout (top to bottom, with subtle `border-border` dividers):

1. **Illustration** (existing `<ItemIllustration>` — keep small)
2. **Identity block** (centered):
   - Name in `font-display`, rarity color, slightly larger (`text-sm` vs surrounding `text-xs`), gold glow already present via `text-glow-soulforged` for soulforged
   - Subline: `Rare One-Handed Mace` — built from `RARITY_LABEL[rarity] + handsLabel + WEAPON_TAG_LABELS[weapon_tag] || itemTypeLabel(item)`
   - `Level {level}` (muted, smaller)
3. **Weapon block** (only if `weapon_tag`):
   - Heading: `⚔ Weapon Damage`
   - Big line: `1d{die} + STR` using `getWeaponDieForItem(weapon_tag, hands === 2 ? 2 : 1, level, weaponProgression)` — reads progression from the `useWeaponProgression()` hook so the tooltip stays in sync with admin tweaks
   - Type line: `One-Handed` / `Two-Handed`
   - `Affinity: {ClassLabel}` if `weapon_tag` matches `CLASS_WEAPON_AFFINITY[classKey]` (only when `classKey` provided)
4. **Attributes block** (if `stats` non-empty):
   - Small heading `Attributes`
   - Each entry on its own row, two-column aligned: `STR` left, `+6` right (CSS grid `grid-cols-[1fr_auto] gap-x-3`)
   - Special labels: `hp_regen` → `Regen`, `hp` → `HP`
   - Color: `text-foreground` for normal, `text-elvish` only for `hp_regen`
5. **Comparison block** (only when `comparison` prop given) — same as today's diff block, but rendered with the new aligned grid and a top border
6. **Flavor block** (if `flavorText`) — `text-xs italic text-muted-foreground` with a divider above
7. **Footer line** (muted, `text-[10px]`):
   - `Durability XX%` · `Value Yg` (only if data provided)
   - Broken state: `⚒ Broken — needs repair` in `text-destructive`
   - Qty: `×N`

Interaction hints like "Click to unequip" are **removed**. They live in:

- a small fixed footer bar below the inventory list (`<p className="text-[10px] text-muted-foreground mt-2">Click an equipped item to unequip · Right-click to drop</p>` — single sentence, contextual to whichever inventory section is visible)

### 3. Helper module

Create **`src/lib/item-display.ts`**:

```ts
export const RARITY_LABEL: Record<string, string> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', unique: 'Unique', soulforged: 'Soulforged',
};

export function handsLabel(hands?: number | null): string {
  if (hands === 2) return 'Two-Handed';
  if (hands === 1) return 'One-Handed';
  return '';
}

export function itemSubtitle(item: ItemLike): string {
  // "Rare One-Handed Mace" / "Unique Greatsword" / "Uncommon Wand" / "Common Tunic"
}

export function statLabel(key: string): string { /* HP, Regen, STR, ... */ }
```

Centralizes the labels so admin pages, marketplace, blacksmith, and inventory all read the same wording.

### 4. Migrate call sites to `ItemTooltipCard`

Replace the inline `<TooltipContent>` bodies in:

- `src/features/character/components/CharacterPanel.tsx`
  - Equipped slot tooltip (~L116) — pass `comparison={undefined}`, `durabilityPct={item.current_durability}`, `classKey={character.class}`
  - Belted potion tooltip (~L451) — no weapon block
  - Consumables tooltip (~L519) — `qty={all.length}`
  - Inventory item tooltip (~L639) — keep the existing comparison logic but feed it as the `comparison` prop
- `src/features/inventory/components/BlacksmithPanel.tsx` (~L372) — use `ItemTooltipCard` with `comparison` built from the equipped item
- `src/components/game/InspectPlayerDialog.tsx` (~L76) — pass `inspect_character_equipment` row mapped to `ItemLike`

Marketplace / Vendor currently don't render a rich hover; adding `ItemTooltipCard` to them is in-scope and trivial — wrap the existing item name with `<Tooltip>` and reuse the card.

### 5. Item flavor text — non-blocking

The DB doesn't currently have a `flavor` column on `items`. The card supports it via the optional `flavorText` prop, but no migration is added in this pass — a follow-up can add `items.flavor_text TEXT` and the AI Item Forge can populate it. Today the prop is simply omitted and the section doesn't render.

### 6. Style notes

- All colors via existing semantic tokens (`text-foreground`, `text-muted-foreground`, `text-elvish`, `text-destructive`, rarity colors via `RARITY_COLORS`). No new hex values.
- Dividers: `<div className="my-1.5 h-px bg-border/60" />` (subtle, not full-contrast).
- Card max width stays `max-w-xs`; padding tightens slightly to `p-3 space-y-2`.
- No new icons beyond the existing emoji `⚔ ⛨ ✦` used in the weapon block — keeps the parchment feel.

### Files touched

- `supabase/functions/combat-tick/index.ts` (column rename: `item_level` → `level`)
- `src/features/character/components/CharacterPanel.tsx` (column rename + tooltip migration + remove "Click to unequip", add subtle inventory footer hint)
- `src/lib/item-display.ts` (new — labels)
- `src/components/items/ItemTooltipCard.tsx` (new — shared tooltip body)
- `src/features/inventory/components/BlacksmithPanel.tsx` (tooltip migration)
- `src/components/game/InspectPlayerDialog.tsx` (tooltip migration)
- `src/features/marketplace/components/MarketplacePanel.tsx` (add hover with ItemTooltipCard)
- `src/features/inventory/components/VendorPanel.tsx` (add hover with ItemTooltipCard, if not already present)

### Validation

- Equip a sword at level 1, 12, 25, 35 — character sheet and tooltip both show `1d6`, `1d7`, `1d8`, `1d9`.
- Hover an inventory weapon, equipped weapon, potion, consumable, broken item, soulforged unique — header / weapon / attributes / footer render in the right order with correct rarity color.
- Blacksmith forge preview still shows the diff against the equipped item.
- Inspect another player — same card, no comparison block.
