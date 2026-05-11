# Materials System Refactor

Bring back a "Material" concept as a unified, extensible resource type. Salvage and gems become entries in a single `character_materials` table and get displayed together in the Equipment tab. Designed so marketplace trading can be added later without another data migration.

## Goals

- One API for all stackable, non-equippable resources (salvage, gems, future crafting mats).
- Remove `characters.salvage` from the XP/RP bar — it doesn't belong there.
- Keep the change additive; no gameplay balance changes.

## Phase 1 — Data model

New table `character_materials`:
- `character_id uuid`, `material_key text`, `count int`, `updated_at timestamptz`
- PK `(character_id, material_key)`, RLS: owner read + service role full access.

New table `materials` (catalog):
- `key text PK` (e.g. `salvage`, `gem_ruby`, `gem_emerald`, …)
- `name`, `description`, `icon` (emoji or url), `rarity`, `category` (`scrap` | `gem` | future), `tradeable bool default true`, `stack_max int null`, `value int` (vendor floor for later), `sort_order int`.

Seed catalog with: `salvage` + the 12 existing gem keys (6 primary + 6 hybrid), reusing current names/colors/descriptions from `GEM_CATALOG`.

Helper SQL functions (SECURITY DEFINER, `set search_path = public`):
- `add_material(character_id, key, delta)` — **positive deltas only**. Raises if `delta <= 0`. Upserts the row.
- `consume_material(character_id, key, delta)` — **only writer for reductions**. Atomic, decrements with row lock, raises (or returns false) if balance would go negative. `delta` must be positive.
- **Invariant:** no caller anywhere passes a negative value to `add_material`. Reductions always go through `consume_material`. Enforced by the `delta <= 0` guard plus a code review pass during cutover.

Migration also backfills `character_materials` from `characters.salvage` and `character_gems`. Legacy columns/table remain temporarily as a read-only fallback and are dropped after Phase 2 cuts over.

## Phase 2 — Server cutover

Replace direct reads/writes with the helpers in:
- `combat-tick`, `combat-catchup`, `_shared/kill-resolver`, `_shared/reward-calculator`, `_shared/combat-resolver` — salvage rewards become `add_material(char, 'salvage', n)` (n > 0).
- `blacksmith-forge`, `jewelcrafter-forge` — salvage cost + gem consumption use `consume_material`.
- `jewelcrafter-gemcutter` — `trade_gem` uses `consume_material('salvage', cost)` + `add_material(gem_key, 1)`. `combine_gem` uses `consume_material` for each primary + `add_material` for the hybrid.
- `gemForItem` / `loadOwnedGems` swap to material lookups by `material_key` (gem keys map 1:1).
- `admin-users` — salvage grants go through `add_material`; deductions/sets go through `consume_material` (or a dedicated admin setter that bypasses the positive-delta rule explicitly, if needed for corrections).

Then drop `characters.salvage` and `character_gems` in a follow-up migration.

## Phase 3 — UI

`StatusBarsStrip`: remove the 🔩 salvage chip from the XP/RP line.

`CharacterPanel` Equipment tab — add a **Materials** section under Gem Pouch:
- Salvage row at the top with current count and tooltip.
- Existing gem grid kept as a subsection within Materials.
- Future material types appear automatically by category/sort_order.

New hook `useMaterials(characterId)` (subscribes to `character_materials` realtime). `useOwnedGems` becomes a thin wrapper that filters `category = 'gem'` for one release, then is removed.

`GameManual`: update Items & Economy section to introduce the unified Materials concept.

## Out of scope

- Marketplace listings for materials (deliberately deferred — `tradeable` flag is reserved for it).
- Direct player-to-player trade.
- Balance changes to drop rates, costs, or formulas.
- New material types beyond salvage and the existing 12 gems.

## Technical notes

- `material_key` is a stable string (not UUID) to keep edge functions simple and migrations readable.
- Counts stay integers; `add_material` is the only writer for increases, `consume_material` is the only writer for decreases.
- `add_material` raises on non-positive `delta`; this is a hard contract, not a soft clamp — surfaces buggy callers loudly.
- `useMaterials` follows the same realtime pattern as `useOwnedGems` today.
- Memory updates after Phase 2: revise `mem://game/gem-system` and `mem://game/economy-system` to reference the unified material model and the add/consume contract.

## Rollout order

1. Migration: `materials` catalog + `character_materials` + `add_material` (positive-only) + `consume_material` (atomic) + backfill.
2. Server cutover (forges, combat, gemcutter, admin) — audit each call site to confirm no negative `add_material` usage.
3. Drop legacy `characters.salvage` and `character_gems`.
4. UI: remove salvage chip, add Materials section in Equipment tab, update manual.
