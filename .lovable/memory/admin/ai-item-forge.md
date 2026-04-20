---
name: AI Item Forge
description: Gemini rules for batch item generation — naming policy by rarity, stat budget weights, name-stat alignment
type: feature
---

The AI Item Forge (admin tool, Google Gemini Flash) generates batches of common/uncommon items for loot tables.

## Naming Policy by Rarity (strict)

**Common** — boring, generic, material-based: `[Tier Adjective] [Material] [Slot Noun]`
- Tier adjectives by level: L1-9 (Crude/Worn/Rough/Simple or none), L10-19 (Sturdy/Hardened/Reinforced), L20-29 (Heavy/Tempered/Banded), L30-42 (Masterwork/Riveted/Honed)
- Materials cycle by level: Cloth → Leather → Studded Leather → Iron → Steel → Banded Steel → Reinforced Steel
- Examples: "Sturdy Iron Helm", "Heavy Bone Amulet", "Masterwork Steel Pauldrons"
- NO proper nouns, place names, factions, or "of the X" titles

**Uncommon** — slightly evocative archetypes: `[Quality Adjective] [Material/Style] [Slot Noun]`
- Allowed quality words ONLY: Fine, Engraved, Etched, Reinforced, Plated, Banded, Polished, Runed, Gilded, Enchanted, Greater
- Examples: "Gilded Circlet", "Runed Kite Shield", "Engraved Greatsword"
- NO proper nouns. Lyrical names ("Dawnbreaker", "Stormsplitter") are reserved for the unique tier.

**Unique / Soulforged** — generated outside this tool. Lyrical proper-noun names are correct only here.

## Stat Budget Formula

`floor(1 + (level - 1) * 0.3 * rarity_multiplier * hands_multiplier)`
- Rarity: common=1.0, uncommon=1.5
- Hands: 1.0 (1H), 1.5 (2H, main_hand only)
- Consumables: budget × 3, stats limited to hp + hp_regen

## Stat Costs and Caps

- Costs: str/dex/con/int/wis/cha = 1pt, ac = 3pts, hp = 0.5pts, hp_regen = 2pts
- Primary stat cap: `4 + floor(level/4)`; AC cap: `2 + floor(level/10)`; HP cap: `6 + floor(level/5)*2`; hp_regen cap: 2

## Name-Stat Alignment

Quality/material adjective must reflect dominant stat: Heavy/Iron/Banded → STR/CON, Polished/Fine/Light → DEX, Runed/Engraved → INT/WIS, Gilded → CHA. Equipment must have ≥2 different stats and spend the FULL budget across them.
