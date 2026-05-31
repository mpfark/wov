---
name: AI Item Forge
description: Gemini rules for batch item generation — archetype naming grammar (mirrors seed catalog), 3-attribute distribution (no HP filler on commons/uncommons), budget floor 2
type: feature
---

The AI Item Forge (admin tool, Google Gemini Flash) generates batches of common/uncommon items that mirror the deterministic seed catalog (`seed-archetype-items`). Same grammar, same budget formula, same rarity rules.

## Naming Grammar (strict — mirrors seed catalog)

`[Tier Prefix] [Archetype] [Slot Noun]` — e.g. "Worn Vanguard Sword", "Fine Spellblade Dagger".

**Tier prefix by level band:** 1–5 Worn · 6–10 Sturdy · 11–15 Fine · 16–20 Engraved · 21–25 Runed · 26–30 High · 31–35 Mythic · 36–40 Ancient · 41–42 Astral.

**Common = primary archetype** (single dominant stat):
- STR Vanguard · DEX Shadow · CON Stoneguard · INT Spellwoven · WIS Sanctified · CHA Crowned

**Uncommon = HYBRID archetype only** (two stats, 8 pairs):
- STR+CON Warlord/Fortress · STR+DEX Blademaster/Skirmisher · DEX+WIS Stalker/Pathfinder · WIS+CON Justicar/Oathbound · INT+WIS Mystic/Oracle · CHA+WIS Prophet/Hierophant · CHA+DEX Troubadour/Duelist · CHA+STR Sovereign/Champion

Forbidden in common/uncommon: proper nouns, place names, factions, "of the X" titles, lyrical names. Those belong to Unique/Soulforged tiers only.

## Stat Budget

`max(2, floor((2 + (level − 1) × 0.24 × rarity_mult × hands_mult) × taper) + hybrid_bonus)`
- Rarity: common=1.0, uncommon=1.5 · Hands: 1.0 (1H) / 1.5 (2H, main_hand)
- Late-game taper: 1.0 (L≤30) / 0.90 / 0.80 / 0.72
- Hybrid bonus: +1 to uncommon budget at L30+
- Consumables: budget × 3, hp/hp_regen only.

## Stat Distribution (3 attributes, no HP filler)

Every common/uncommon equipment item carries 3 real attribute stats — never `hp` or `hp_regen`.

- **Common (70 / 20 / 10)** — primary / secondary / tertiary triplet:
  - STR → str/con/dex · DEX → dex/str/wis · CON → con/str/wis
  - INT → int/wis/cha · WIS → wis/con/int · CHA → cha/wis/dex
- **Uncommon (50 / 30 / 20)** — primary / secondary / tertiary per hybrid pair:
  - STR+CON→dex · STR+DEX→con · DEX+WIS→con · WIS+CON→int
  - INT+WIS→cha · CHA+WIS→int · CHA+DEX→wis · CHA+STR→wis

After AI returns, server-side spillover loop tops up any leftover budget into the same three attribute keys (primary first), respecting caps. `hp`/`hp_regen` are stripped from common/uncommon equipment before spillover.

## Stat Costs and Caps

- Costs: str/dex/con/int/wis/cha = 1pt, ac = 3pts, hp = 0.5pts, hp_regen = 2pts
- Primary cap: linear `4 + floor(level/4)` to L28, then `11 + floor((level − 28)/6)` to L40, ceilings at 13.
- AC: `2 + floor(level/10)` · HP: `6 + floor(level/5)*2` · hp_regen: `2 + floor(level/10)`

## Source of Truth

`seed-archetype-items` is canonical. `ai-item-forge` and `rebuild-archetype-stats` mirror its `COMMON_TRIPLE` / `UNCOMMON_TERTIARY` tables. Any change happens in all three.
