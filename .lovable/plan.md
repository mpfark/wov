# Formula Ownership Cleanup & Consolidation

Structural-only pass. No gameplay behavior changes (with one exception: a single existing **silent desync** is documented and resolved by picking one canonical version — flagged below for explicit approval).

---

## Audit findings

I mapped every formula across the four candidate locations:

| File | Lines | Role today |
|---|---|---|
| `src/lib/game-data.ts` | 464 | Mixed: static data (races/classes/labels/descriptions) + ~20 formulas |
| `src/features/combat/utils/combat-math.ts` | 501 | Combat formulas + class data |
| `supabase/functions/_shared/combat-math.ts` | 501 | **Byte-identical copy** of the client file (md5 match confirmed) |
| `supabase/functions/_shared/reward-calculator.ts` | 143 | Reward math, imports server combat-math |
| `public.sync_character_resources()` (SQL) | — | Mirrors `getMaxHp/Cp/Mp` in PL/pgSQL |

**Duplicated symbols** (defined in BOTH `game-data.ts` AND `combat-math.ts`):
`getStatModifier`, `getMaxHp`, `getMaxCp`, `getMaxMp`, `calculateAC`, `getXpPenalty`, `getXpForLevel`, `XP_RARITY_MULTIPLIER`, `getCreatureDamageDie`, `getShieldBlockChance`, `getShieldBlockAmount`, `getWisAntiCrit`, `getWisDodgeChance`, `getDexCritBonus`, `getIntHitBonus`, `getStrDamageFloor`, `getChaGoldMultiplier`, `diminishing`, `diminishingFloat`, `rollD20`, `rollDamage`, `CLASS_BASE_HP`, `CLASS_BASE_AC`, `CLASS_LEVEL_BONUSES`, `CLASS_LABELS`, `CLASS_WEAPON_AFFINITY`.

**🛑 Existing silent desync discovered (XP penalty rates):**

```
game-data.ts        →  rates 0.06 / 0.09 / 0.12  (used by client UI: useCombatActions.ts shows player tooltip)
combat-math.ts      →  rates 0.10 / 0.15 / 0.20  (used by server: reward-calculator.ts awards XP)
```

The client tells the player the penalty is one number; the server pays out a different (harsher) number. This is exactly the class of bug this cleanup pass is meant to prevent.

**Deprecated / unused:**
- `getWisDodgeChance` — still used by `CharacterPanel.tsx` (2 calls). Cannot be removed yet; leave with a deprecation note and a TODO to migrate the panel.
- `getBaseRegen`, `getCpRegenRate`, `CLASS_PRIMARY_STAT` (in `game-data.ts`) — zero references in repo. Safe to delete.
- `getDexMultiAttack` (in `combat-math.ts`) — zero references. Safe to delete.

---

## Ownership model (target)

```text
                    SHARED (zero-dep TS, imported by both sides)
                    ────────────────────────────────────────────
                    src/shared/formulas/
                      ├── stats.ts          getStatModifier, diminishing, dice
                      ├── resources.ts      getMaxHp/Cp/Mp + effective variants + regen
                      ├── combat.ts         AC, hit/crit/anti-crit, shield block,
                      │                     creature damage, level-gap, weapon affinity
                      ├── xp.ts             XP_RARITY_MULTIPLIER, getXpForLevel,
                      │                     getXpPenalty, getCreatureXp
                      ├── items.ts          getItemStatBudget, calculateItemStatCost,
                      │                     getItemStatCap, suggestItemGoldValue,
                      │                     calculateRepairCost, ITEM_RARITY_*, ITEM_STAT_*
                      ├── creatures.ts      generateCreatureStats, calculateHumanoidGold,
                      │                     getCreatureDamageDie, RARITY_MULTIPLIER
                      ├── economy.ts        getChaSell/Buy/Gold multipliers, teleport CP
                      └── classes.ts        CLASS_BASE_HP/AC, CLASS_LEVEL_BONUSES,
                                            CLASS_COMBAT_PROFILES, CLASS_WEAPON_AFFINITY,
                                            OFFHAND_*, SHIELD_*, TWO_HANDED_*

   CLIENT (re-exports + UI-only data)            SERVER (re-exports + server-only)
   ──────────────────────────────────             ────────────────────────────────
   src/lib/game-data.ts                           supabase/functions/_shared/
     - barrel re-export from shared                  combat-math.ts
     - keeps RACE_*, *_LABELS,                         - barrel re-export from shared
       *_DESCRIPTIONS, STAT_LABELS,                    - keeps server-only attack
       MILESTONE_TITLES (UI data)                       resolution helpers
     - keeps calculateStats (uses                       (resolveAttackRoll,
       RACE_STATS + CLASS_STATS)                         applyOffensiveBuffs,
                                                         applyDefensiveBuffs,
   src/features/combat/utils/combat-math.ts             rollCreatureDamage,
     - re-export from shared (for                        calculateKillRewards)
       existing test imports)
```

**Why a `src/shared/formulas/` folder rather than putting it under `supabase/functions/_shared/`?** Vite bundling can't reliably import from `supabase/functions/_shared/` into the React app, but Deno can import from anywhere via relative paths. The convention in this repo is already to keep one canonical TS file and copy-mirror it to the Deno side — this pass keeps that convention but reduces it from 1 monolithic file copy to 8 small file copies, AND makes `game-data.ts` re-export the same source instead of holding its own divergent copy.

---

## Steps

### 1. Create `src/shared/formulas/` modules
Move (don't rewrite) formula functions from `game-data.ts` into the 8 modules above. Each module has zero React/Vite/Deno deps. Each function gets a single JSDoc comment naming its canonical owner — no more "if you change this, also update X, Y, Z" hand-sync notes.

### 2. Resolve the `getXpPenalty` desync 🛑 needs decision
The two versions disagree. Picking one preserves "no behavior change" for one side and changes it for the other. Recommended: **keep the server numbers (0.10 / 0.15 / 0.20)** because that is what players are actually receiving today — changing the server would alter real reward payouts. The client UI tooltip will then show the true penalty. (If you'd rather change the server to match the lenient client display, say so before approval.)

### 3. Mirror `src/shared/formulas/*` into `supabase/functions/_shared/formulas/`
Byte-copy mirror, same as today's pattern. Add `supabase/functions/_shared/combat-math.ts` as a re-export barrel from the mirror + the server-only attack-resolution helpers.

### 4. Convert `game-data.ts` and client `combat-math.ts` to barrels
- `src/lib/game-data.ts` becomes: re-export everything from `src/shared/formulas/*` + keep `RACE_STATS`, `RACE_LABELS`, `CLASS_LABELS`, `RACE_DESCRIPTIONS`, `CLASS_DESCRIPTIONS`, `STAT_LABELS`, `WEAPON_TAGS`, `WEAPON_TAG_LABELS`, `MILESTONE_TITLES`, `getCharacterTitle`, `calculateStats`, `getCarryCapacity`, `getBagWeight`, `getMoveCost`, `CONSUMABLE_ALLOWED_STATS`, `CLASS_PRIMARY_STAT`-removal.
- `src/features/combat/utils/combat-math.ts` becomes: re-export from `src/shared/formulas/*`. (Keeps the existing test import working without touching 30+ files.)

No import-site code changes required anywhere else — every existing `import { foo } from '@/lib/game-data'` and `from '@/features/combat/utils/combat-math'` still resolves identically.

### 5. Delete unused legacy aliases
Remove (zero references): `getBaseRegen`, `getCpRegenRate`, `CLASS_PRIMARY_STAT`, `getDexMultiAttack`.
Keep with `/** @deprecated */` + 1-line migration note: `getWisDodgeChance` (still called by `CharacterPanel.tsx`).

### 6. Add a formula-parity safeguard test
New file `src/shared/formulas/__tests__/parity.test.ts` that asserts fixed numeric snapshots for each canonical formula at representative inputs:
- `getMaxHp`, `getMaxCp`, `getMaxMp` (3 classes × 3 levels)
- `calculateAC`, `getEffectiveAC`
- `getWisAntiCrit`, `getShieldBlockChance`, `getShieldBlockAmount`
- `getXpPenalty` (4 level/creature pairs)
- `getItemStatBudget` (4 rarity/level pairs)
- `generateCreatureStats` (3 rarities at L10)

This is in addition to the existing `effective-caps.test.ts` (which compares the two TS files — that test stays, but its purpose narrows to "the barrel re-exports resolve to the same source").

The SQL `sync_character_resources` mirror is left as-is (out of scope per "no DB changes"); the comment above it gets a one-line update pointing to the new shared module so future SQL edits can find the canonical TS source.

### 7. Verify
- `bunx tsc --noEmit` (type check)
- `bunx vitest run` (existing tests + new parity test)
- Spot-check a few touch points: `useCombatActions.ts`, `CharacterPanel.tsx`, `StatPlannerDialog.tsx`, `combat-tick/index.ts`.

---

## Files touched (count)

| Change | File count |
|---|---|
| New shared modules | 8 |
| New parity test | 1 |
| `game-data.ts` shrink + barrel | 1 |
| Client `combat-math.ts` → barrel | 1 |
| Server `combat-math.ts` → barrel + server helpers | 1 |
| New mirrored shared modules under `supabase/functions/_shared/formulas/` | 8 |
| `useCombatActions.ts` (only if step 2 keeps server numbers — UI shows live value, no edit needed) | 0 |
| Comment update in `sync_character_resources` (next migration) | 0 (deferred) |

No production import site changes. No gameplay logic changes (except the documented `getXpPenalty` reconciliation in step 2, pending your choice).

---

## Out of scope (explicitly NOT changed)

- Combat balance, stat scaling, durability, reward amounts, cooldowns, gameplay outcomes
- SQL `sync_character_resources()` numbers — only its comment header is updated
- Edge function deployment changes beyond the file-shape refactor

---

## Decision needed before implementation

**`getXpPenalty` reconciliation:** keep server values (0.10/0.15/0.20, harsher — what players actually get today) or adopt client values (0.06/0.09/0.12, more lenient — what the UI currently implies)? Default recommendation: **keep server**.