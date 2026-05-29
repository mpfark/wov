---
name: Item Archetypes
description: Deterministic [Tier Prefix] [Archetype] [Slot] naming grammar; 1 name per primary stat, 2 directional names per hybrid pair.
type: feature
---

Common/uncommon items use a deterministic naming grammar — never AI-randomized for these tiers. Uniques and Soulforged ignore it.

## Grammar
`[Tier Prefix] [Archetype] [Slot Noun]` — e.g. "Runed Spellwoven Hood", "Ancient Stoneguard Plate".

## Tier prefixes (capped at L42)
1–5 Worn · 6–10 Sturdy · 11–15 Fine · 16–20 Engraved · 21–25 Runed · 26–30 High · 31–35 Mythic · 36–40 Ancient · 41–42 Astral.

## Primary archetypes (1 per stat — common only)
- STR Vanguard · DEX Shadow · CON Stoneguard · INT Spellwoven · WIS Sanctified · CHA Crowned.

## Hybrid archetypes (uncommon only — 2 directional names per pair)
The dominant attribute (the higher of the two) picks the variant. 8 pairs total — these match the 8 hybrid gems 1:1.

- STR+CON: STR→Warlord · CON→Fortress
- STR+DEX: STR→Blademaster · DEX→Skirmisher
- DEX+WIS: DEX→Stalker · WIS→Pathfinder
- WIS+CON: WIS→Justicar · CON→Oathbound
- INT+WIS: INT→Mystic · WIS→Oracle
- CHA+WIS: CHA→Prophet · WIS→Hierophant
- CHA+DEX: CHA→Troubadour · DEX→Duelist
- CHA+STR: CHA→Sovereign · STR→Champion

Both directional variants are seeded as separate items per (pair, slot, band). The forge browse list shows them side-by-side once the player owns the matching hybrid gem; the player picks which they want — no extra forge UI parameter, the item_id encodes the choice.

## Slot nouns
head Helm/Hood/Circlet · chest Plate/Armor/Vest/Robe · pants Greaves/Leggings · gloves Gauntlets/Gloves · boots Sabatons/Boots · off_hand Shield/Tome/Idol · weapons Sword/Axe/Mace/Dagger/Bow/Staff/Wand.

## Stat distribution
- Common: dominant ~70% of budget, single minor stat.
- Uncommon: hybrid-only. Dominant ~55%, secondary ~35%, tertiary spillover (hp for tank, wis otherwise).
- Spillover loop drips remaining budget into priority order until budget is fully spent or caps are hit.
- Respects `statCap(key, level)` per stat.

## Generation & class starters
Deterministic seed lives in edge function `seed-archetype-items` (overlord-gated). Per band: ~84 commons (6 primaries × ~14 slots/weapons) + 48 uncommons (8 pairs × 2 directions × 3 slots).

Class starting weapons use the new primary archetype names: warrior→Vanguard, rogue/ranger→Shadow, wizard→Spellwoven, healer/templar→Sanctified, bard→Crowned.

## Rename policy
Names are renamed in place when grammar evolves — IDs stay stable so player inventory, marketplace listings, and ground loot all survive. Stat-pair rows that fall outside the 8 hybrid pairs are left untouched.
