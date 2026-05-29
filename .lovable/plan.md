## Goal

Eliminate name collisions like "Runed Runed Dagger", tighten the archetype grammar to a single name per primary stat and a directional pair of names per hybrid, and align the hybrid gem catalog with the hybrid archetype pairs so forging is coherent.

## Phase 1 — New naming grammar

### Primary archetypes (1 per stat, 6 total)

Replaces the 5–7 variants per stat with a single canonical name. None of these collide with tier prefixes (Worn / Sturdy / Fine / Engraved / Runed / High / Mythic / Ancient / Astral).

| Stat | Name | Flavor |
|---|---|---|
| STR | Vanguard | Front-line bruiser |
| DEX | Shadow | Quick, evasive |
| CON | Stoneguard | Tank / endurance |
| INT | Spellwoven | Arcane caster (avoids "Runed" / "Arcane" collisions; "Arcane" sounds generic) |
| WIS | Sanctified | Divine / nature |
| CHA | Crowned | Regal / leader |

Example fix: L21–25 INT staff becomes "Runed Spellwoven Staff" instead of "Runed Runed Staff".

### Hybrid archetypes (2 directional names per pair)

For each pair the dominant stat picks the variant. Pairs are limited to the 8 currently used pairs, and (next phase) gems will map 1:1 to these.

| Pair | Dominant A → name | Dominant B → name |
|---|---|---|
| STR + CON | STR → Warlord | CON → Fortress |
| STR + DEX | STR → Blademaster | DEX → Skirmisher |
| DEX + INT | DEX → Hexrunner | INT → Spellblade |
| WIS + CON | WIS → Justicar | CON → Oathbound |
| INT + WIS | INT → Mystic | WIS → Oracle |
| CHA + WIS | CHA → Prophet | WIS → Hierophant |
| CHA + DEX | CHA → Troubadour | DEX → Duelist |
| CHA + STR | CHA → Sovereign | STR → Champion |

(Open to swaps — these all already exist in the current pool, just split by direction.)

### Generator changes

- `supabase/functions/seed-archetype-items/index.ts`
  - `PRIMARY_ARCHETYPES` collapses to 1 string per stat.
  - `HYBRID_ARCHETYPES` becomes `{ a, b, nameA, nameB }`, naming decided by which stat got the larger allocation (deterministic, not by `idx`).
  - Remove the `idx % list.length` cycling for primaries; with one name per stat we now produce far fewer rows per band. Compensate by widening the slot loop (every slot for every primary) so the catalog stays around its current size (~50 commons / ~24 uncommons per band).
- Mirror updates to memory files `.lovable/memory/game/item-archetypes.md` and `.lovable/memory/admin/ai-item-forge.md` so the AI Item Forge stays in sync.

## Phase 2 — Gem catalog realignment

Goal: every hybrid archetype pair maps 1:1 to a hybrid gem; player picks the directional variant at the forge.

### New hybrid gem set (8 gems, +2 vs today)

| Pair | Gem | Status |
|---|---|---|
| STR + DEX | Citrine | keep |
| DEX + CON | Jade → repurpose to DEX + INT *(or rename, see open question)* | repurpose / replace |
| CON + INT | Aquamarine | keep but remap to WIS + CON pair |
| INT + WIS | Opal | keep |
| WIS + CHA | Moonstone | keep, maps to CHA + WIS |
| CHA + STR | Sunstone | keep |
| STR + CON | **Bloodstone** (deep red-green) | new |
| CHA + DEX | **Heliodor** (golden yellow) | new |

Because some current gems point at archetype pairs we no longer keep (e.g. CON+INT has no archetype), I recommend a clean remap: drop Jade and Aquamarine, add three new ones — Bloodstone (STR+CON), Heliodor (CHA+DEX), and one for DEX+INT. Final count = 8, one per archetype pair. Exact gem name/color list to be finalized in this phase.

- `src/shared/formulas/gems.ts` + `supabase/functions/_shared/formulas/gems.ts`: update `GEM_CATALOG`, `HYBRID_GEM_KEYS`, `hybridForPair`, `hybridRecipe`.
- Primary gem drops stay unchanged (6 primaries, random uniform).

### Forge UX

- `supabase/functions/jewelcrafter-forge/index.ts` accepts a new optional `variant: 'A' | 'B'` parameter for uncommon hybrid forges. Validate that the chosen variant exists for the selected gem's pair; default to A if omitted (back-compat for any old client).
- `src/features/inventory/components/JewelcrafterPanel.tsx` shows two cards side-by-side when a hybrid gem is selected ("Mystic — INT heavy / Oracle — WIS heavy"), player clicks one to forge.
- Hybrid recipe (`hybridRecipe`) updates so any new gem still combines from its two matching primaries.

## Phase 3 — Rename existing items in place

A one-shot SQL migration walks the `items` table and rewrites `name` + `description` for every row with `origin_type = 'archetype_seed'`:

1. Parse current name as `<prefix> <oldArchetype> <noun>`.
2. Look up the new archetype string from the item's `stats` (dominant attribute for common; top-2 dominant for uncommon → directional name).
3. Update `name` and regenerate the templated `description`. IDs, references, inventory rows, marketplace listings, and ground loot stay intact.
4. Skip `unique` / `soulforged` / `rare` rows.

If a row's stats don't map to any allowed pair (corrupt or hand-edited), leave it untouched and log it for manual review.

After the migration, the AI Item Forge prompt + the `archetype-items` seed function can be re-run safely — they'll regenerate names matching what's now in the DB.

## Phase 4 — Verify

- Re-run the existing item parity tests (`formula-parity.test.ts`).
- Spot-query the DB before/after the rename migration:
  - count of items with duplicate words in name (should drop to 0)
  - sample 10 commons + 10 uncommons per level band for grammar check
- Manual forge test of one hybrid gem to confirm the variant picker round-trips.

## Open questions before implementation

1. Are the 6 primary names and 16 hybrid names above acceptable, or want to swap any (e.g. you originally suggested "Sage" for WIS-heavy; I moved WIS to Sanctified to free Sage. Easy to swap back — but then INT needs a different name).
2. Final hybrid gem names/colors — happy to propose a full palette once you approve the 8-pair list.
3. The 8-pair list itself: should DEX+INT stay, or drop it in favor of e.g. DEX+WIS (ranger flavor)?
