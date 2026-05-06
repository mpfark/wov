---
name: Item Archetypes
description: Deterministic [Tier Prefix] [Archetype] [Slot] naming grammar for common/uncommon gear; primary + hybrid archetypes per stat.
type: feature
---

Common/uncommon items use a deterministic naming grammar — never AI-randomized for these tiers. Future Forge AI must respect this grammar. Uniques and Soulforged ignore it.

## Grammar
`[Tier Prefix] [Archetype] [Slot Noun]` — e.g. "Runed Sage Hood", "Ancient Stoneguard Plate".

## Tier prefixes (capped at L42)
1–5 Worn · 6–10 Sturdy · 11–15 Fine · 16–20 Engraved · 21–25 Runed · 26–30 High · 31–35 Mythic · 36–40 Ancient · 41–42 Astral.

## Primary archetypes
- STR: Vanguard, Iron, Brutal, Warborn, Tyrant
- DEX: Shadow, Swift, Hunter, Ashen, Nightstalker
- CON: Warden, Stoneguard, Bulwark, Bastion, Stalwart, Earthshaper, Ironroot
- INT: Sage, Arcane, Spellwoven, Astral, Runed
- WIS: Devout, Sanctified, Templar, Enlightened, Dawnbringer
- CHA: Regal, Noble, Bardic, Silvertongue, Crowned, Majestic, Virtuoso

## Hybrid archetypes (uncommon only, secondary share ≥30%)
- STR+CON Warlord/Juggernaut/Fortress · STR+DEX Raider/Blademaster/Skirmisher
- DEX+INT Spellblade/Hexrunner/Arcstrider · WIS+CON Guardian/Justicar/Oathbound
- INT+WIS Mystic/Oracle/Seer · CHA+WIS Prophet/Hierophant/Luminary
- CHA+DEX Troubadour/Duelist/Shadowcourt · CHA+STR Champion/Sovereign/Lionguard

## Slot nouns (biased per primary stat)
head Helm/Hood/Circlet · chest Plate/Armor/Vest/Robe · pants Greaves/Leggings · gloves Gauntlets/Gloves · boots Sabatons/Boots · off_hand Shield/Tome/Idol · weapons Sword/Axe/Mace/Dagger/Bow/Staff/Wand.

## Stat distribution
- Common: dominant ~70% of budget, single minor stat. Common is the only rarity for primary (single-stat) archetypes.
- Uncommon: hybrid-only. Dominant ~55%, secondary ~35%, tertiary spillover (hp for tank, wis otherwise).
- Budget formula floored at 2 even at L1, so every item has at least primary + minor.
- After percentage allocation, a spillover loop drips remaining budget into priority order (primary → secondary → tertiary) until budget is fully spent or stat caps are hit. Guarantees no wasted points.
- Respects `statCap(key, level)` per stat (ac/hp_regen 2+L/10, hp 6+(L/5)·2, attribs 4+L/4).

## Generation
Deterministic seed lives in edge function `seed-archetype-items` (overlord-gated). Hard-purges existing common/uncommon items + cascade-cleans references, then inserts catalog and re-attaches starter gear. Each band starts at `band.min` level so L1 starter gear exists. Per band: ~50 commons (6 primaries × 7 slots) + ~24 uncommons (8 hybrids × 3 slots) ≈ 666 items total over 9 bands.

