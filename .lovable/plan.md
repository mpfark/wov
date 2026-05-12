## Stonebinder — Mystical Stone Fusion Service (v1, hardened)

Add a new world service that lets a player sacrifice **two different primary Turning Stones** to forge a single **Ascended Turning Stone** that combines both stat affinities.

All 21 items (6 primary + 15 ascended) already exist in `items` at level 42/47, slot `trinket`, rarity `unique`, not soulbound. No new items are created. Recipes are fully deterministic and **driven by stat identity**, not item names.

---

### Item-side data touch-ups

Two existing item rows need cleanup so the recipe lookup is unambiguous (cosmetic only — recipe logic does not rely on names):

- `Ascended Turning Stone of Shadows and  Roots` — double space; rename to `… Shadows and Roots`.
- `Ascended Turning Stone of Tides and Echoes` — `value` is `0`; align with the other 14 ascendeds (`1058`).

---

### Database migration

1. **`nodes.is_stonebinder boolean NOT NULL DEFAULT false`** — mirrors `is_jewelcrafter` / `is_blacksmith`.
2. **Seed one Stonebinder location** — flip `is_stonebinder = true` on the Hearthvale (0,0) hub node.

No new tables. No RLS changes.

---

### Edge function: `stonebinder-fuse`

Two modes (mirror `jewelcrafter-gemcutter`):

- **`mode: "preview"`** → returns the resulting ascended item snapshot, no mutation.
- **`mode: "fuse"`** → performs the fusion atomically.

Body shape (both modes): `{ character_id, stone_a_inv_id, stone_b_inv_id }`.

#### Stat-identity validation (canonical recipe source)

A row qualifies as a **primary Turning Stone** iff **all** of:

- `items.rarity = 'unique'`
- `items.slot = 'trinket'`
- `items.item_type = 'equipment'`
- `items.name ILIKE 'Turning Stone of %'` **and** `items.name NOT ILIKE 'Ascended%'` (secondary confirmation only)
- After dropping `hp` and `hp_regen` from `items.stats`, exactly **one** key remains, and it is one of `str | dex | con | int | wis | cha`.

That single remaining stat key is the stone's **identity**. The recipe map is built once at boot:

```
SELECT id, name, stats FROM items
 WHERE name ILIKE 'Ascended Turning Stone of %'
   AND rarity = 'unique' AND slot = 'trinket';
```

For each ascended row, drop `hp` / `hp_regen` from `stats` → must yield exactly **two** distinct primary stat keys. Map: `sortedPair("str","wis") → ascendedItemId`. Result: a deterministic 15-entry recipe map keyed purely by stat shape.

#### Per-fuse validation (rejects with a friendly error)

- Both inventory rows belong to the caller's character.
- Both rows pass the primary-stone identity check above.
- Both rows are **unequipped** (`equipped_slot IS NULL`) — same UX as Soulforge.
- The two stones have **different** identity stats (no Iron+Iron).
- The matching ascended exists in the recipe map.
- **Unique-ownership check** — the target ascended `item_id` must not currently exist in any of:
  - `character_inventory.item_id`
  - `marketplace_listings.item_id` where `status = 'active'`
  - `node_ground_loot.item_id`
  - any other unique-holding surface introduced before implementation (audit at build time and include them all under the fully-wired policy)
  - If found anywhere → return: `"That ascended stone already exists in the world."`

#### Fusion (single transactional batch via service-role client)

1. Resolve target ascended `item_id` from the stat-pair recipe map.
2. Delete both `character_inventory` rows.
3. Insert one new `character_inventory` row: `{ character_id, item_id: ascendedId, equipped_slot: null, current_durability: ascendedItem.max_durability ?? 100 }`.
4. Write `activity_log` entry (deterministic, ritual flavor):
   `"⚜ The Stonebinder binds {Stone A name} and {Stone B name} into {Ascended Stone name}."`
5. Return `{ item: <ascended snapshot>, consumed: [<a>, <b>] }`.

Standard CORS + service-role client pattern (matches `jewelcrafter-gemcutter`).

---

### Frontend

**`src/features/inventory/components/StonebinderPanel.tsx`** — built on `ServicePanelShell`, two-column:

- **Header**: `⚜ Stonebinder` + ritual subtitle ("Two stones, one bound essence").
- **Left**: list of unequipped primary Turning Stones in the character's inventory (filtered using the same stat-identity rule the server uses, so the UI stays in sync). Click to assign Stone A, click another to assign Stone B; same-row click deselects.
- **Right ("The Binding")**:
  - 0 / 1 selected → instructional empty state.
  - 2 valid different stones → server `preview` response renders an `ItemTooltipCard` of the ascended, plus a destructive-color "The originals will be consumed forever." line.
  - 2 selected but invalid (same stat, ascended already exists in the world, etc.) → red explanation echoed from the server, fuse button disabled.
- **Footer**: single `Bind Stones` button. On success: `addLog`, refresh inventory, clear selection.

No gold / salvage / gem cost. Sacrifice is the cost.

**Wiring into the world**: the existing node-services bar that opens Jewelcrafter / Blacksmith / Soulforge / Marketplace based on `node.is_*` flags also gets a Stonebinder button when `node.is_stonebinder === true`. Same pattern, one entry added.

`src/integrations/supabase/types.ts` regenerates after the migration; the new `is_stonebinder` column lands automatically.

---

### Memory note (post-ship)

Add `mem://game/stonebinder`: stat-identity-driven 15-recipe map (no name-based logic), two different primaries only, no recursive ascension, items pre-seeded at L42/L47, sacrifice-only cost, world-unique exclusivity enforced across inventory + marketplace + ground loot, durability uses `max_durability`. Update index Core line listing crafting services.

---

### Out of scope (v1, explicitly)

No extra costs, no soulbinding, no random rolls, no recursive ascension, no same-stat fusion, no new item generation, no multiple Stonebinder nodes in the seed (more can be flipped on later via admin).
