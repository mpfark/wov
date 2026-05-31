# Fix Archetype Attribute Distribution

## Problem

Audit of `items` confirms two distinct issues:

1. **Stale rows.** L21 "Runed Sanctified" commons hold `{int:4, wis:1, hp:2}` — the current `distributeCommon` cannot produce that shape for a wis primary. These rows were never rewritten by the previous rebuild pass (or were skipped). Old AI-forge INT spillover is still sitting on wis archetypes.
2. **Wrong shape even when rewritten.** Current commons land 2 attributes + HP flavor (e.g. `wis=3, con=1, hp=2`). You want 3 real attributes. Uncommons already produce 3 keys but use `hp` as tertiary for str/con-leaning hybrids — same problem.

## Fix

### 1. Common distribution: 3 attributes, no HP flavor

Change `distributeCommon` to spread budget across `primary / secondary / tertiary` attributes with the existing 70 / 20 / 10 point shares (floor 1 each). HP stops appearing on commons.

Tertiary lookup per primary (deterministic, mirrors the existing minor rule + adds a third):

```text
str  → con, dex
dex  → str, wis
con  → str, wis
int  → wis, cha
wis  → con, int
cha  → wis, dex
```

So a wis-primary common always lands `wis / con / int` (user's "wis, con, and one more"). Sage (int) lands `int / wis / cha`. Caps and the existing `rebalance` + `spillover` helpers still apply; spillover targets become the 3 attribute keys.

### 2. Uncommon distribution: 3 attributes, no HP filler

In `distributeUncommon`, replace the `tertiary = 'hp'` branch with an attribute pick:

- If both primary and secondary are physical (`str/dex/con`), tertiary = `wis`.
- If both are mental (`int/wis/cha`), tertiary = `con`.
- Mixed pairs use the unused stat from `{str, dex, con, int, wis, cha}` that best complements (deterministic table keyed on the pair). Concrete map mirrors the existing `HYBRID_BY_NAME` archetypes so every hybrid has one canonical tertiary.

Point shares stay 50 / 30 / 20.

### 3. Inference: name first, drop stat fallback

In `rebuild-archetype-stats`:

- Use `inferFromName` as the **only** source of truth for primary (and secondary on uncommons). No more "highest existing stat" fallback — that's what let old INT bleed forward and become the new "primary."
- If a row's name doesn't match `PRIMARY_BY_NAME` or `HYBRID_BY_NAME`, push it onto an `unmatched` list returned in the response (with id, name, level) and `skipped++`. No write.
- Add `force: true` body flag (default true) so rewrites run unconditionally on every common/uncommon equipment row, not gated by whether stats "look" already correct.

### 4. Mirror the rules

Apply the new 3-attribute distribution in all four spots so seed + AI forge + rebuild stay consistent:

1. `supabase/functions/seed-archetype-items/index.ts` — `distributeCommon`, `distributeUncommon`.
2. `supabase/functions/rebuild-archetype-stats/index.ts` — same helpers + new inference rules.
3. `supabase/functions/ai-item-forge/index.ts` — system prompt distribution rules (70/20/10 across 3 attributes, 50/30/20 across 3 attributes, no HP flavor) + worked example.
4. `.lovable/memory/admin/ai-item-forge.md` and `mem://game/item-stat-budget` — updated text.

### 5. Re-run rewrite + report

Admin "Rewrite Existing Stats" button stays. After deploy:

1. Click it once. Response now includes `{processed, updated, skipped, unmatched: [{id,name,level}]}`.
2. Spot-check ~5 rows per primary archetype (str/dex/con/int/wis/cha) to confirm 3 attributes and correct primary.
3. Any rows in `unmatched` get hand-renamed or hand-edited in the items admin — they're not safe to auto-rewrite without a known archetype.

## Validation

- Unit asserts in `src/shared/formulas/__tests__/items.test.ts`:
  - L20 common wis primary → keys `{wis, con, int}`, no `hp`.
  - L20 common int primary → keys `{int, wis, cha}`.
  - L30 uncommon str+con primary → keys `{str, con, wis}` (no `hp`).
- DB spot-check query after rewrite:
  ```sql
  select name, level, stats from items
  where rarity='common' and name ilike '%Sanctified%' and level in (1,6,16,21,26,36)
  order by level;
  ```
  Expect `wis ≥ con ≥ int`, no `hp` key on L≥6 rows.

## Out of scope

- Budget formula stays (slope 0.24, taper, hybrid +1 bonus all unchanged).
- Caps unchanged.
- Uniques, soulforged, consumables untouched.
- No name or description rewrites.
