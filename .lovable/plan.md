# Per-Rarity World Drop Chance

Right now the "world drop chance" for a creature comes from `creatures.drop_chance` and, when that is null, a hardcoded `0.5` fallback in the loot resolver. There's no way to tune the default from the admin UI, and every rarity (regular / rare / boss) shares the same fallback.

This change moves the fallback into `loot_pool_config` and splits it by creature rarity, editable from the existing Pool Rules tab. Per-creature `drop_chance` overrides continue to win when set.

## Scope

- World drop pool (item_pool mode) only. Legacy per-creature loot tables are untouched.
- Rarities: `regular`, `rare`, `boss` (the three values actually used by `creatures.rarity`).
- Per-creature `drop_chance` remains an optional override; nothing about the Creature Manager UI changes.

## Changes

### 1. Schema — `loot_pool_config`
Add three columns with sensible defaults:

- `drop_chance_regular numeric NOT NULL DEFAULT 0.35`
- `drop_chance_rare numeric NOT NULL DEFAULT 0.60`
- `drop_chance_boss numeric NOT NULL DEFAULT 1.00`

Single-row table (id = 1), no RLS/grant changes needed.

### 2. Resolver fallback
In `supabase/functions/_shared/combat-resolver.ts` (`pushCreatureLoot`) and `supabase/functions/_shared/kill-resolver.ts`, replace the hardcoded `?? 0.5` with a helper that picks the pool-config default matching `creature.rarity`:

```text
effectiveDropChance =
  creature.drop_chance
  ?? poolConfig.drop_chance_{rarity}
  ?? 0.5   // safety net if config row missing
```

`pushCreatureLoot` currently doesn't have `poolConfig` in scope — it only stores `dropChance` on the queue entry. Two options; I'll take (a):

  a. Pass the rarity through on the queue entry (`creatureRarity`) and compute the effective drop chance in `processLootDrops`, where `poolConfig` is already lazy-loaded. Same behavior, one place to change.
  b. Load pool config earlier. More churn, no benefit.

`kill-resolver.ts` already loads its own pool config path — extend it the same way.

Update the inline `poolConfig` default object (line 259) and the corresponding one in `kill-resolver.ts` to include the three new fields so old rows keep working.

### 3. Admin UI — `src/components/admin/loot/PoolRulesTab.tsx`
Add a new "World Drop Chance by Rarity" section above the Equipment Pool section, with three number inputs (0–1, step 0.01) for regular / rare / boss, each showing the `%` in the helper text. Include the new fields in `PoolConfig`, `DEFAULT_CONFIG`, load, and save.

Copy line under the section: "Default drop chance when a creature has no per-creature override. Applies to item_pool creatures only."

### 4. Docs
Update `WorldBuilderRulebook.tsx` / `GameManual.tsx` drop-chance references to note the rarity-tiered defaults (short paragraph, no math changes).

## Out of scope

- No changes to per-creature `drop_chance` editing, rarity assignment, consumable drop chance, level offsets, or common/uncommon split.
- No changes to legacy loot tables, salvage rules, or unique-item dedup.
- No migration of existing `creatures.drop_chance` values.

## Verification

- Set regular = 0.1, rare = 0.5, boss = 1.0 in the UI, save, reload — values persist.
- Kill a regular creature with `drop_chance = null` in DB → drop rate matches ~10%.
- Kill a boss with `drop_chance = null` → item always drops (subject to pool having a matching item).
- Kill a creature with an explicit per-creature `drop_chance` → override still wins, rarity default ignored.
- Legacy-table creatures unaffected (regression check).
