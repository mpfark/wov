# Late-Game Item Budget Compression — Audit & Plan

## 1. How budgets are calculated today

**Canonical formula** (`src/shared/formulas/items.ts` + `_shared/formulas/items.ts`):

```text
budget = max(2, floor(2 + (level - 1) * 0.3 * rarity_mult * hands_mult))

rarity_mult: common 1.0 · uncommon 1.5 · soulforged 2.0 · unique 3.0
hands_mult:  1H 1.0 · 2H 1.5
primary cap: 4 + floor(level / 4)
ac / hp_regen cap: 2 + floor(level / 10)
hp cap: 6 + floor(level / 5) * 2
```

Same numbers are mirrored in the `seed-archetype-items` seeder, the AI Forge prompt, and the rebalance edge function.

### Computed end-points

| Tier | L1 | L20 | L30 | L35 | L40 | L42 |
|---|---|---|---|---|---|---|
| Common 1H | 2 | 7 | 10 | 12 | 13 | **14** |
| Common 2H | 2 | 10 | 15 | 17 | 19 | **20** |
| Uncommon 1H | 2 | 10 | 15 | 17 | 19 | **20** |
| Uncommon 2H | 2 | 14 | 21 | 25 | 28 | **29** |
| Soulforged 1H | 2 | 13 | 19 | 22 | 25 | **26** |
| Unique 1H | 2 | 19 | 28 | 33 | 37 | **38** |
| Unique 2H | 2 | 28 | 42 | 49 | 55 | **57** |
| Primary stat cap | 4 | 9 | 11 | 12 | 14 | 14 |

The curve is **purely linear**. Each tier adds the same delta per level forever, so the *gap* between rarities widens at high level instead of compressing.

## 2. Observed inflation in live data

Database snapshot (avg across all generated items per band):

| Rarity | L1 | L21 | L31 | L41 | Max single primary |
|---|---|---|---|---|---|
| Common | 2.0 attr | 8.1 | 11.2 | 13.7 | 14 |
| Uncommon | 2.0 attr | 11.1 | 15.1 | 18.8 | 14 |

Live high-level characters already show the symptom:
- Wizard L42 Puffin: **INT 64**, WIS 24
- Wizard L40 Cithra: **INT 54**, WIS 30
- Warrior L42 Cithrawiel: STR 30, DEX 38, **CON 46**

Hand-crafted uniques compound it: Staff of the Last Path (L35, 2H) carries cha 12 / int 12 / wis 12 + 5 regen. Turning Stones grant **+14 in a single primary** from a *trinket* slot, and Ascended Stones (L47) grant **+10/+10** in two primaries from a single trinket — essentially a free second amulet.

## 3. Where the runaway scaling comes from

Ranked by contribution to top-end stat totals:

1. **Pure-primary common items at level cap.** With budget 14 and primary cap 14, the 70/30 split + spillover loop dumps nearly the whole budget into one stat. 11 archetype-aligned armor slots × 14 = **154 single-stat points** is structurally reachable.
2. **`hands_mult` stacking multiplicatively with `rarity_mult` on weapons.** A 2H unique gets `3.0 × 1.5 = 4.5×` a common's budget — by far the steepest curve in the system.
3. **Unique rarity multiplier (3.0).** It is 2× soulforged and 6× the pure-stat baseline. Most existing unique stat sheets exceed even that, since they are author-tuned (see Severance: con 15 + four 5s at L45).
4. **Turning Stones / Ascended Stones in a trinket slot.** They behave like a second weapon-grade attribute source. The Ascended at L47 with 10+10 attributes is the single most efficient endgame slot in the game.
5. **Primary cap scaling linearly forever** (`4 + L/4`). Nothing tapers at level 30+, so the cap and the budget both keep climbing in lockstep, and the cap is exactly the budget at L42.
6. **`soulforge-item` budget mismatch.** It hard-codes `1.5` (uncommon multiplier), but the canonical multiplier for `soulforged` is `2.0` — currently a *bug* favouring the player slightly less than designed. Worth fixing alongside the compression so the formula is true. (See `supabase/functions/soulforge-item/index.ts` lines 17-21.)

## 4. Proposed direction (audit, no changes yet)

A **soft taper above L30** in three coordinated places, plus a small structural change to weapon multipliers and unique tuning. Magnitudes are starting estimates for discussion — final numbers should be tuned against live characters.

### 4a. Budget curve — soft taper

Keep the L1–L30 curve identical. Add a diminishing factor above L30:

```text
raw = 2 + (L - 1) * 0.3 * rarity_mult * hands_mult
taper = L <= 30 ? 1.0
      : L <= 35 ? 0.90
      : L <= 40 ? 0.80
      : 0.72   // L41-42
budget = max(2, floor(raw * taper))
```

Result at L42 (rounded):

| Tier | Now | Proposed | Δ |
|---|---|---|---|
| Common 1H | 14 | 11 | −21% |
| Common 2H | 20 | 15 | −25% |
| Uncommon 1H | 20 | 15 | −25% |
| Uncommon 2H | 29 | 22 | −24% |
| Soulforged 1H | 26 | 20 | −23% |
| Unique 1H | 38 | 28 | −26% |
| Unique 2H | 57 | 42 | −26% |

This trims ~25% off only the very top end without touching L1–L30 progression.

### 4b. Hybrid efficiency bonus

Give uncommon items a small per-point efficiency credit at high level so hybrids remain attractive vs pure-stat:

```text
hybrid_bonus = L >= 30 ? +1 budget point : 0  (uncommon only)
```

Cheap to implement, swings a single attribute point in the hybrid's favour, signals the design intent without re-tuning rarities.

### 4c. De-couple weapon multiplier

Change `hands_mult` from `1.5` to `1.35` on rare tiers only (or apply only up to uncommon) so 2H uniques stop being the runaway outlier. A 2H unique at L42 would land near 38 budget instead of 57.

### 4d. Primary cap taper

Currently `4 + floor(L/4)` — at L42 = 14, which is exactly the common budget. Replace with:

```text
primaryCap(L) = L <= 28 ? 4 + floor(L / 4)
              : L <= 40 ? 11 + floor((L - 28) / 6)   // +1 every 6 levels
              : 13                                    // hard ceiling
```

That keeps the cap at 11 at L28, 12 at L34, 13 at L40+. Forces pure-stat items to spread points into a minor stat at the very top end.

### 4e. Unique catalog touch-up

Most uniques live with author-set stat sheets that already exceed even the unique multiplier. Two options:

1. **One-pass manual re-tune** of the ~30 existing uniques to match a target budget (e.g. unique 1H ≈ 28 at L42 after taper). Lowest risk to identity if done by hand.
2. **Scripted compression**: scale every primary stat > primary cap down to the new cap, leave secondaries (hp / hp_regen) and unique procs intact. Faster, blunter.

Recommendation: option 1, surfaced as an admin review panel that proposes new stat lines and the user can accept/skip per item.

### 4f. Turning Stones

These are uniques with primary stat = old cap (14). With the new cap of 13, lower the primary to 13 and the Ascended pair from 10/10 → 9/9. Modest but they are the worst single-slot offender so the change matters.

### 4g. Fix soulforge budget mismatch

Replace the hard-coded `mult = 1.5` in `supabase/functions/soulforge-item/index.ts` with the real soulforged multiplier (2.0), then apply the same taper. Player-facing budget stays approximately the same (since the taper offsets the bug fix) but the formula becomes consistent.

## 5. Risk-ordered rollout

Do these in order, ship each as its own migration + edge-function deploy, and watch the data between steps.

1. **Soulforge formula fix** — invisible cleanup, no player impact.
2. **Budget taper above L30** in `src/shared/formulas/items.ts`, `_shared/formulas/items.ts`, `seed-archetype-items`, and the AI Forge prompt. Re-seed common/uncommon catalog — they regenerate deterministically, so this is a single overlord click.
3. **Primary cap taper** — same files; affects only newly generated items until step 4.
4. **Rebalance pass on existing items** using the AI rebalance edge function (already exists, just runs over the new budget). It safely brings legacy items down to budget without changing names or identities.
5. **Hybrid efficiency bonus** — small uncommon-only adjustment, easy to add after the seed reruns.
6. **Hands multiplier reduction** — affects weapons; do last so weapon balance can be observed in isolation.
7. **Unique catalog touch-up** — manual review using a small admin tool that previews old → new for each unique.

Existing player-owned items: the rebalance edge function (`ai-item-rebalance`) already exists for this exact purpose and respects soulbound. Soulbound soulforged + crown items should be **grandfathered** rather than re-tuned, since each character only gets one.

## 6. Expected endgame totals after compression

Pure-INT wizard, fully gear-stacked, post-compression:

```text
Before:  base + class growth + ~154 from 11 common archetype slots
         + 14 from staff + 14 from turning stone  ≈  200+ INT

After:   base + class growth + ~110 from 11 archetype slots (cap 13, spillover forced)
         + 11 from 2H staff + 13 from turning stone   ≈  150 INT
```

A drop of roughly 25% on the most stackable build. Hybrids gain a relative ~5% efficiency on top.

## 7. Out of scope for this plan

- No changes to gem system, stat formulas (HP/CP/MP regen curves), or ability scaling math.
- No change to the deterministic archetype grammar or naming.
- No change to drop rates, vendor pricing, or repair costs.
- Soulforged + Crown stat budgets remain player-defined within the new caps.

## 8. Open questions for confirmation

1. Confirm the **−25% target** at L42 is the desired magnitude (vs e.g. −15% or −35%).
2. Confirm uniques should be re-tuned (option 1: hand) vs scripted compression (option 2).
3. Should the **hands multiplier change** apply to all rarities or only unique?
4. Should the **soulforge formula fix** preserve current player budgets (apply bug-equivalent factor) or move strictly to the canonical 2.0 × taper?
