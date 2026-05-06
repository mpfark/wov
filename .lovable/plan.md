## Goal
Bring the AI Item Forge (`supabase/functions/ai-item-forge/index.ts`) in sync with the deterministic seed catalog so AI-generated common/uncommon items follow the same grammar, budget floor, and rarity rules.

## Changes

### 1. Naming grammar → archetype-based
Replace the current "boring material + slot noun" common rule and "quality adjective" uncommon rule with the seed grammar:

`[Tier Prefix] [Archetype] [Slot Noun]`

- **Tier prefix by level band**: 1–5 Worn, 6–10 Sturdy, 11–15 Fine, 16–20 Engraved, 21–25 Runed, 26–30 High, 31–35 Mythic, 36–40 Ancient, 41–42 Astral.
- **Common archetypes** (single primary stat): Vanguard/Iron/Brutal (STR), Shadow/Swift/Hunter (DEX), Warden/Stoneguard/Bulwark (CON), Sage/Arcane/Spellwoven (INT), Devout/Sanctified/Templar (WIS), Regal/Noble/Bardic (CHA).
- **Uncommon archetypes** (hybrid only): Warlord (STR+CON), Raider (STR+DEX), Spellblade (DEX+INT), Guardian (WIS+CON), Mystic (INT+WIS), Prophet (CHA+WIS), Troubadour (CHA+DEX), Champion (CHA+STR), etc.
- Slot nouns: Helm/Hood/Circlet, Plate/Robe/Vest, Gauntlets, Greaves, Sabatons, Shield/Tome/Idol, Sword/Axe/Bow/Staff/Wand…

Drop the "Crude/Worn/Masterwork" material-based examples entirely.

### 2. Rarity rules
- **Common = primary archetype only** (single dominant stat + small minor stat).
- **Uncommon = hybrid archetype only** (primary ~55%, secondary ~35%, tertiary spillover). The forge must NOT generate non-hybrid uncommons.
- If user picks `rarity = uncommon`, system prompt forces a hybrid name.

### 3. Stat budget alignment with seed
- **Floor at 2 even at L1**: change `calcBudget` to `Math.max(2, Math.floor(2 + (level-1) * 0.3 * mult * handsMult))` to match the seed function.
- **Spillover top-up**: keep the existing post-AI top-up loop but make it spend leftover budget into primary→secondary→tertiary in the item's archetype order (not random) so distributions match the seed.
- Update the budget formula text in the system prompt accordingly.

### 4. Memory refresh
Rewrite `.lovable/memory/admin/ai-item-forge.md` to document:
- Archetype naming grammar (mirror of `item-archetypes.md`)
- Min budget 2 floor, spillover pass
- Common = primary, Uncommon = hybrid only

## Out of scope
- No changes to `shared/formulas/items.ts` (used by Soulforge / Blacksmith / etc.).
- No changes to the seed function — it's the source of truth now.
- Unique and Soulforged forges remain untouched (lyrical names still allowed there).

## Files touched
- `supabase/functions/ai-item-forge/index.ts` — rewrite system prompt, update `calcBudget`, refine top-up to follow archetype order.
- `.lovable/memory/admin/ai-item-forge.md` — refresh to match new rules.

## Verification
- Generate a batch of 10 common L5 → names like "Worn Vanguard Sword", "Worn Sage Robe"; each item has primary stat + minor.
- Generate a batch of 10 uncommon L15 → names like "Fine Spellblade Dagger" with DEX+INT split.
- Confirm no "Dawnbreaker"/"of the X" leaks and no single-stat uncommons.
