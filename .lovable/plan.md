## Goal

Stop auto-equipping the 6 universal armor pieces. Instead give a new character exactly the resources needed to walk into a blacksmith and forge one common item per armor slot themselves. The class weapon (from `class_starting_gear`) is still granted as today.

## Cost math (per current blacksmith-forge logic at level 1)

Per slot at L1:
- salvage = `5 + level*2` = **7**
- gold = `level*5` = **5**
- gem = 1 matching primary gem

6 armor slots (head, chest, shoulders, gloves, pants, boots — `off_hand`/`belt` are intentionally excluded since they aren't part of "fill out 6 slots"):
- **42 salvage**
- **30 gold** for forging
- **1 of each primary gem** (garnet, topaz, emerald, sapphire, pearl, amethyst) → covers any single-attribute common in any slot

Existing default 10 starting gold stays, so new characters spawn with **40 gold** total (10 walking-around + 30 forge budget).

Note: which armor slots count as the "6" is the one question worth confirming — see Open question below. The math is the same either way (any 6 of the armor slots cost 42 salvage / 30 gold).

## Changes

### 1. Database — update `grant_starting_gear` (migration)

Rewrite the SECURITY DEFINER function to:
- Keep the auth check.
- **Skip** the `universal_starting_gear` loop entirely.
- Keep the `class_starting_gear` loop (weapon grant) unchanged.
- Top up character gold by **+30** (so 10 default + 30 = 40).
- Upsert into `character_materials`:
  - `salvage` → +42
  - each of `garnet, topaz, emerald, sapphire, pearl, amethyst` → +1

Implemented with simple `INSERT … ON CONFLICT (character_id, material_key) DO UPDATE SET count = character_materials.count + EXCLUDED.count` so it's idempotent-safe against the existing unique constraint.

### 2. Character creation UI (`src/pages/CharacterCreation.tsx`)

- Update the sticky preview footer to show the new starting kit: `Gold 40`, `Salvage 42`, `Gems ×6` instead of the current `Gold 10` line, so players see what they'll spawn with.
- No logic change beyond the label — the RPC still does the granting.

### 3. Admin panel note

`RaceClassManager` still manages `universal_starting_gear` rows. We leave the table and admin UI in place (in case it's wanted again later) — the rows simply stop being applied. No code change needed there. Worth mentioning in the closing message so it isn't surprising.

## Files touched

- New migration: rewrite `public.grant_starting_gear(uuid)`.
- `src/pages/CharacterCreation.tsx` — preview text only.

## Open question

The blacksmith treats 9 slots as forgeable (`main_hand, off_hand, head, chest, gloves, belt, pants, boots, shoulders`). "Fill out 6 slots" most naturally means the 6 armor pieces **head, chest, shoulders, gloves, pants, boots** (excluding `off_hand` and `belt`, since off-hand depends on class/weapon choice and belt is a potion holder). If you'd rather the budget also cover `belt` and/or `off_hand`, say which and I'll bump the salvage/gold accordingly (each extra slot = +7 salvage, +5 gold).
