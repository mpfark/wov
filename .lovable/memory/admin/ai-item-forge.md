---
name: AI Item Forge
description: Gemini rules for batch item generation — archetype naming grammar (mirrors seed catalog), budget floor 2, common=primary uncommon=hybrid only
type: feature
---

The AI Item Forge (admin tool, Google Gemini Flash) generates batches of common/uncommon items that mirror the deterministic seed catalog (`seed-archetype-items`). Same grammar, same budget formula, same rarity rules.

## Naming Grammar (strict — mirrors seed catalog)

`[Tier Prefix] [Archetype] [Slot Noun]` — e.g. "Worn Vanguard Sword", "Fine Spellblade Dagger".

**Tier prefix by level band:** 1–5 Worn · 6–10 Sturdy · 11–15 Fine · 16–20 Engraved · 21–25 Runed · 26–30 High · 31–35 Mythic · 36–40 Ancient · 41–42 Astral.

**Common = primary archetype** (single dominant stat):
- STR Vanguard/Iron/Brutal/Warborn/Tyrant · DEX Shadow/Swift/Hunter/Ashen/Nightstalker
- CON Warden/Stoneguard/Bulwark/Bastion/Stalwart/Earthshaper/Ironroot · INT Sage/Arcane/Spellwoven/Astral/Runed
- WIS Devout/Sanctified/Templar/Enlightened/Dawnbringer · CHA Regal/Noble/Bardic/Silvertongue/Crowned/Majestic/Virtuoso

**Uncommon = HYBRID archetype only** (two stats):
- STR+CON Warlord/Juggernaut/Fortress · STR+DEX Raider/Blademaster/Skirmisher · DEX+INT Spellblade/Hexrunner/Arcstrider
- WIS+CON Guardian/Justicar/Oathbound · INT+WIS Mystic/Oracle/Seer · CHA+WIS Prophet/Hierophant/Luminary
- CHA+DEX Troubadour/Duelist/Shadowcourt · CHA+STR Champion/Sovereign/Lionguard

Forbidden in common/uncommon: proper nouns, place names, factions, "of the X" titles, lyrical names. Those belong to Unique/Soulforged tiers only.

## Stat Budget

`max(2, floor(2 + (level - 1) × 0.3 × rarity_mult × hands_mult))` — minimum 2 even at L1 so every item has primary + minor.
- Rarity: common=1.0, uncommon=1.5 · Hands: 1.0 (1H) / 1.5 (2H, main_hand)
- Consumables: budget × 3, hp/hp_regen only.

## Stat Distribution

- **Common**: ~70% to single primary stat, remainder spillover into a minor stat.
- **Uncommon**: ~55% primary / ~35% secondary / ~10% tertiary spillover (hp for tank-leaning hybrids, wis otherwise). Both archetype stats must appear.
- After AI returns, server-side spillover loop tops up any leftover budget into existing stats (primary first), respecting caps. Guarantees full budget spend.

## Stat Costs and Caps

- Costs: str/dex/con/int/wis/cha = 1pt, ac = 3pts, hp = 0.5pts, hp_regen = 2pts
- Primary cap: `4 + floor(level/4)` · AC: `2 + floor(level/10)` · HP: `6 + floor(level/5)*2` · hp_regen: `2 + floor(level/10)`

## Source of Truth

The deterministic seed function `seed-archetype-items` defines the canonical grammar/budget. This forge mirrors it for AI top-ups; any rule change should be made in both places.
