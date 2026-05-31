# Stat Budget Squish v2 + 3-Stat Distribution + Existing Gear Rewrite

Two formula changes, plus a one-shot rewrite of every existing common/uncommon item so old loot matches the new curve.

## 1. Global ~20% budget squish

Canonical formula in `src/shared/formulas/items.ts`:

```text
raw    = 2 + (level - 1) × 0.3 × rarity_mult × hands_mult     ← slope 0.3
taper  = 1.0 (L≤30) / 0.90 / 0.80 / 0.72
budget = max(2, floor(raw × taper) + hybrid_bonus)
```

Change: slope `0.3 → 0.24` (flat 20% cut to per-level growth, stacks with the existing late-game taper). Floor of 2 stays. Hybrid +1 bonus at L30+ stays.

Indicative impact:
- L20 common 1H: 6 → 5
- L40 uncommon 2H: 24 → 20

## 2. Three-stat distribution

Replace the current 2-stat split so a single attribute can never own the whole item.

- **Common (70 / 20 / 10)** — primary archetype stat / minor stat (existing pairing rule: con for melee, dex for caster, wis for INT/WIS, etc.) / 10% flavor sprinkle in `hp` or `hp_regen`. Floor each to 1.
- **Uncommon (50 / 30 / 20)** — primary archetype stat / secondary archetype stat / tertiary spillover (`hp` for tank-leaning hybrids, `wis` otherwise). All three ≥1; steal from primary if caps clipped them.

Single-stat concentration drops from ~70% → 50% on uncommons and ~100% → 70% on commons.

## 3. Caps (no change)

Primary cap taper already ceilings primary at 13. Combined with the 50% share, max primary on an L40 uncommon drops from 13 → ~10. Intended.

## 4. Where to change

All four formula mirrors stay in lockstep:

1. `src/shared/formulas/items.ts` — `getItemStatBudget` slope.
2. `supabase/functions/_shared/formulas/items.ts` — Deno mirror.
3. `supabase/functions/seed-archetype-items/index.ts` — `statBudget`, `distributeCommon` (70/20/10), `distributeUncommon` (50/30/20).
4. `supabase/functions/ai-item-forge/index.ts` — `calcBudget` + system-prompt distribution rules and the worked example.

Memory `mem://game/item-stat-budget` updated with new slope, 3-stat distribution, and the anti-stacking rationale.

## 5. Rewrite existing common/uncommon gear

One-shot migration of every existing common and uncommon row in `items` so they match the new budget and 3-stat split. Run as a new admin-only edge function `rebuild-archetype-stats` (steward/overlord gated, same auth pattern as `seed-archetype-items`).

Algorithm per row:
1. Read `level`, `rarity`, `hands`, current `stats`.
2. Infer **primary** stat = the highest existing attribute stat. For uncommons, infer **secondary** = the second-highest attribute stat (skip if it equals primary; fall back to the archetype pair lookup by parsing the item name against the `HYBRID_ARCHETYPES` table when no clear second exists).
3. Recompute budget with the new slope.
4. Re-run `distributeCommon(level, primary, hands)` or `distributeUncommon(level, primary, secondary, hands)` to produce the new stat block.
5. Write back `stats` and refreshed `value` via `suggestGold(level, rarity)`. Leave `name`, `description`, `slot`, `weapon_tag`, `hands`, `level`, and `origin_type` untouched.

Scope and safety rails:
- Only rows where `rarity IN ('common','uncommon')` AND `item_type = 'equipment'`. Consumables, uniques, and soulforged items are untouched.
- Process in batches of 200 with a server-side cursor; return a `{processed, updated, skipped}` summary so the admin run is observable.
- Idempotent — re-running produces the same output for the same inputs.
- Player-equipped and player-owned instances: this updates the `items` row only. Since equipped items reference the same `items.id`, the new stats apply on next character-resource sync (`sync_character_resources`); no `inventory` row changes needed.
- After the rewrite completes, the admin button can optionally trigger a project-wide `sync_character_resources` pass for online characters so HP/CP/MP maxes refresh immediately instead of on next login.

Trigger UX: add a "Rebuild archetype stats" button in the admin Items panel alongside the existing seed button, with a confirm dialog that shows the row count that will be touched.

## 6. Validation

- New unit test `src/shared/formulas/__tests__/items.test.ts`:
  - L1 common 1H budget = 2 (floor preserved).
  - L20 common 1H budget = 5.
  - L40 uncommon 2H budget = 20.
  - `distributeCommon` produces 3 stat keys; `distributeUncommon` produces 3 keys with primary ≥ secondary ≥ tertiary.
- After deploy:
  - Spot-check 5 commons and 5 uncommons in the DB to confirm the new distribution.
  - Spot-check AI Item Forge with an L20 and an L35 batch.
  - Run the rewrite function once on the live DB and verify counts.

## 7. Out of scope

- No changes to base character stats, class level bonuses, or gem/forging math.
- Uniques and Soulforged keep their current rarities and aren't rewritten.
- No name/description changes during the rewrite.
