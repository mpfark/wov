## Goal

Make weapon **rarity** raise the autoattack damage **die size**, on top of the existing level-tier progression. An uncommon sword will roll a bigger die than a common sword of the same level; a unique/soulforged even bigger.

## Proposed rarity → die bonus

| Rarity | Die bonus |
|---|---|
| common | +0 |
| uncommon | **+1** |
| unique | **+2** |
| soulforged | **+3** |

Stacks **additively** with the existing level-tier bonus (0/+1/+2/+3 at L1/11/21/31). Example, sword (1H base d8):

- L1 common → d8
- L1 uncommon → d9
- L21 common → d10
- L21 uncommon → d11
- L31 unique → d13
- L31 soulforged → d14

This keeps weapon-family identity (a dagger stays smaller than a sword at the same rarity/level) but a higher rarity is now visibly stronger in the damage roll, not just in stat budget.

## Scope of changes

### 1. Canonical formula — `src/shared/formulas/combat.ts`

- Add a `RARITY_DIE_BONUS: Record<string, number>` constant (`common: 0, uncommon: 1, unique: 2, soulforged: 3`, anything else 0).
- Add new helper `getRarityDieBonus(rarity: string | null | undefined): number`.
- Extend `getWeaponDieForItem(weaponTag, hands, itemLevel, cfg, rarity?)` with an optional `rarity` parameter and add it to the returned die.
- Extend `rollWeaponAttackDamage(...)` and the `AttackContext` (`weaponItemRarity?`) used by `resolveAutoattack` so the live combat path picks up the rarity bonus.
- Mirror the entire change byte-for-byte to `supabase/functions/_shared/formulas/combat.ts` (mirror rule from `formula-ownership.md`).

### 2. Live combat — `supabase/functions/combat-tick/index.ts`

- When building per-member weapon context, capture `mainHandRarity[m.id]` and `offHandRarity[m.id]` alongside the existing `mainHandLevel` / `offHandLevel` lookups.
- Pass rarity into both `getWeaponDieForItem` calls (main-hand at line ~1006, off-hand at line ~1151) and into `resolveAutoattack` via the new `weaponItemRarity` field.

### 3. Predictor — `src/features/combat/utils/combat-predictor.ts`

- Add `weaponItemRarity` to the predictor context and forward it to `getWeaponDieForItem` so the client-side preview matches the server.

### 4. UI surfaces

- **`src/components/items/ItemTooltipCard.tsx`** — pass `item.rarity` to `getWeaponDieForItem` so the tooltip shows the correct `1d{N}`.
- **`src/features/character/components/CharacterPanel.tsx`** — pass equipped main-hand rarity into the displayed weapon die (line ~866).
- **`src/components/admin/loot/WeaponProgressionTab.tsx`** — extend the level-vs-die preview table with a column or selector for rarity so admins can see the full matrix.

### 5. Tests / parity

- Add a case to `src/shared/formulas/__tests__/formula-parity.test.ts` snapshot covering the new `getRarityDieBonus` plus a couple of `getWeaponDieForItem` results across rarities.

## Things explicitly NOT changed

- **Stat budget** stays as-is — rarity still grants more STR/HP/etc. via `getItemStatBudget`. The die bonus is purely additive on top.
- **Existing items** need no migration. Rarity is already stored on every row in `items`; the formula simply starts reading it.
- **Crit math, hit bonuses, AC** — untouched.
- **Creature damage** — unaffected (creatures don't have rarity-tagged weapons).

## Open question

The proposed bonuses are `+0 / +1 / +2 / +3`. If you'd rather make soulforged feel only marginally above unique (e.g. `+0 / +1 / +2 / +2`) or push uncommon harder (`+0 / +2 / +3 / +4`), say the word and I'll swap the table before implementing.
