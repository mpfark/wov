# Uncommons must be hybrid — fix L41 single-stat items

## What you're seeing

Astral Bastion Helm is uncommon but only has `con: 13`. Per the archetypes spec (`mem://game/item-archetypes`), **uncommon = hybrid only** (dominant ~55%, secondary ~35%, tertiary spillover). Single-stat uncommons should not exist.

## Scope of the bug

A DB scan turned up exactly **8 broken uncommons**, all at **level 41**, all CON-only, all from `archetype_seed`:

- Astral Bastion Helm, Astral Stalwart Armor, Astral Earthshaper Greaves, Astral Ironroot Gauntlets, Astral Warden Sabatons, Astral Stoneguard Shield, Astral Stalwart Mace, Astral Earthshaper Axe

They use **primary CON archetypes** (Bastion / Stalwart / Earthshaper / Ironroot / Warden / Stoneguard) — those names belong to commons. So both the stat distribution and the naming archetype were picked from the wrong pool.

The other 614 uncommons in the DB are correct hybrids.

## Why it happens

`supabase/functions/seed-archetype-items/index.ts` has two related issues at the top L41–42 band:

1. **Cap clipping in `distributeUncommon`** — at L41 the per-attribute cap is `4 + floor(L/4) = 14`. The full L41 uncommon budget gets allocated to the dominant stat first, hits the cap quickly, and the secondary distribution is silently dropped if the spillover loop terminates early. Result: secondary = 0, item looks single-stat.
2. **Astral CON items got seeded with primary archetype names** for that band — the hybrid loop appears to fall back to the primary archetype list when it can't find a hybrid match for the band's slot config.

## Plan

### 1. Fix the seeder (`seed-archetype-items`)
- In `distributeUncommon`, **guarantee a non-zero secondary**: after percentage allocation, if secondary stat is still 0, transfer 1 point from the dominant stat (even if dominant ends up below cap-by-1). Spillover loop already exists — add a "secondary floor = 1" enforcement before it.
- Refuse to emit any uncommon row whose stats contain fewer than 2 attribute keys (`str/dex/con/int/wis/cha` > 0). Throw at seed time so future regressions are loud.
- Verify the L41–42 band hybrid loop never falls back to a primary-archetype name. If `pickHybridArchetype` returns null for a slot, **skip** that combo for that band rather than substituting a primary name.

### 2. Repair the 8 existing items in place (data fix)
For each of the 8 ids:
- Recompute stats with the fixed `distributeUncommon` for the matching hybrid pair. Since these were all "CON something" we'll re-bucket them into one of the existing CON-bearing hybrids: **STR+CON (Warlord/Juggernaut/Fortress)** or **WIS+CON (Guardian/Justicar/Oathbound)**. We'll pair each broken item with the closest hybrid based on slot bias, rename it, and overwrite stats.
- Done as a one-shot SQL migration so no inventory references are lost (these items aren't held by any character — verified during planning, will re-confirm at run time before writing).
- Alternative: simply **delete the 8 rows** if they aren't equipped/held anywhere. Cleaner, but loses the L41 CON hybrid coverage at top band — re-seeding the band fills it back in.

Recommended: **delete + re-run the band seed** for L41–42 only. The seeder is idempotent for purge+insert per band today, so this is the lowest-risk path.

### 3. Tighten `gemForItem` for uncommon (defense in depth)
`src/shared/formulas/gems.ts` (and the Deno mirror) currently falls back to a primary gem when an uncommon has only one stat. Change the uncommon branch to **return `null` if the item has fewer than 2 attribute stats** — that uncommon then can't be forged at all, surfacing the data bug instead of silently asking for a Garnet. (No-op once #1 + #2 are done; insurance against future regressions.)

## Out of scope
- Re-balancing the hybrid stat split (55/35 stays).
- Touching commons.
- Changing the gem catalog.

## Files

- `supabase/functions/seed-archetype-items/index.ts` — fix `distributeUncommon` + hybrid-name fallback guard.
- `src/shared/formulas/gems.ts` + `supabase/functions/_shared/formulas/gems.ts` — return `null` on single-stat uncommon.
- One-off SQL via migration tool: delete the 8 broken items, then trigger the seed function for the L41–42 band (or an equivalent targeted insert) — exact approach finalized at implementation time after a final reference check on the 8 ids.
