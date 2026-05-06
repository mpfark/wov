## Common & Uncommon Seed Rebalance

Two real issues found, plus one design clarification:

- **Imbalance is intentional**: the 50/74 split per band comes from 8 hybrid archetypes (chest+head+weapon = 24 extra uncommons). Per your decision, hybrids stay uncommon-only.
- **Non-hybrid uncommons are wasted**: today they fall back to `distributeCommon` so a "Vanguard Sword" uncommon = same stats as common. We will skip generating them.
- **Budget rounding loses points** at low levels (L1 budget=1 means 70% rounds to 1 with 0 leftover). We will raise the floor and add a spillover pass.

### Changes (single file: `supabase/functions/seed-archetype-items/index.ts`)

**1. Raise stat budget floor**
Update `statBudget()` so the minimum is 2 at L1 (instead of 1), keeping the same growth slope:
```
budget = max(2, floor(2 + (level-1) * 0.3 * rarityMult * handsMult))
```
Common L1 → 2pts, Uncommon L1 → 3pts, Common L8 → 4pts, etc. This guarantees a primary + minor stat at every level.

**2. Spillover pass — never waste a point**
After the primary/secondary/tertiary allocation, run a loop that drips any leftover budget into:
- primary (until cap), then secondary (until cap), then tertiary (hp for tank archetypes, wis otherwise) until cap.
- Always exits with `sum(allocated) === budget` (or all caps reached, which is rare at low levels).

**3. Skip non-hybrid uncommons**
In `buildCatalog()`, the armor and weapon loops currently emit both `common` and `uncommon` per primary archetype. Drop the uncommon branch for primary archetypes — keep only:
- All common armor + weapons across 6 primaries (~50/band)
- All hybrid uncommon armor (chest, head) + weapon (~24/band)

Result per band: ~50 common + ~24 uncommon = ~74 items × 9 bands ≈ **666 items total** (down from ~1,114).

**4. Update memory**
`mem://game/item-archetypes`:
- Note the new minimum-budget-2 floor.
- Note "Uncommon = hybrid-only" rule.
- Document the spillover pass.

### Out of scope
- No changes to formula files (`shared/formulas/items.ts`) — only the seed function's local `statBudget` helper. If you want the global budget formula to also have the floor of 2, that's a separate decision (it would affect AI Forge, Soulforge, blacksmith, etc.).
- No re-seed triggered automatically — you'll click **Purge & Seed Catalog** again after the deploy.

### Verification after re-seed
- Query item counts per (level, rarity) to confirm ~50 common / ~24 uncommon per band.
- Spot-check L3 common armor → should now have 2 stats summing to budget=2.
- Spot-check L8 uncommon hybrid chest → primary+secondary+tertiary summing to full uncommon budget.
