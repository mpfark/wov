# Migrate `multi_attack`, `execute_attack`, and `ignite_consume` Off `CLASS_ATK`

Finishes the Basic Combat Rework v2 transitional work. Three ability handlers in `combat-tick` still read class dice from `CLASS_ATK`. We will move them onto **ability-specific, stat-scaling formulas** — *not* onto the autoattack weapon-die path. Each ability keeps a clear identity tied to its primary stat (DEX for Ranger/Rogue, INT for Wizard) and is independent of what weapon the player is holding.

## Design Principle

- Autoattacks: weapon-die + STR (already shipped).
- Abilities: **stat-derived base power + level scaling**, independent of weapon die.
- Each ability has its own formula. No shared "ability damage" helper — three abilities, three formulas, kept inline and obvious.
- Crits use `getClassCritRange` (Rogue 19 keeps its edge).

## New Per-Ability Formulas

### 1. `multi_attack` — Ranger Barrage (DEX)

```text
arrowCount = (dexMod >= 3) ? 3 : 2          // unchanged
perArrowBase = 2 + dexMod + floor(level / 4)
hit roll: d20 + dexMod   vs creature AC      // unchanged DEX-based hit
on hit:  damage = perArrowBase   (clamped >= 1)
on crit (roll >= classCritRange): damage *= 2
```

Rationale: Barrage stays a multi-shot DEX finisher. Replacing `1d8 + DEX` (avg ~5 + DEX) with `2 + DEX + level/4` gives smooth scaling without weapon dependence. At L1 dexMod=3 → ~5/arrow (parity). At L20 → ~10/arrow. Crit-on-hit added (currently absent) so per-arrow d20s feel consistent with autoattacks.

### 2. `execute_attack` — Rogue Eviscerate (DEX, finisher)

```text
dexMod = getStatModifier(effDex)
baseDmg = 4 + 2 * dexMod + floor(level / 3)
multiplier = 1 + 0.5 * stacks                 // stacks 0–5, unchanged
finalDmg = max(floor(baseDmg * multiplier), 1)
// Guaranteed-hit (no d20), as today. No crit roll.
```

Rationale: Today's `1d6 + DEX` (avg 3.5 + DEX) becomes `4 + 2·DEX + level/3`. At L1 dex=14 (mod=2) → 8 base × stacks-mult (parity-ish at low levels, scales better). Pure-DEX rogues still favored. Stack consumption preserved.

### 3. `ignite_consume` — Wizard Conflagrate (INT, detonator)

```text
intMod = getStatModifier(effInt)
baseDmg = 4 + 2 * intMod + floor(level / 3)
multiplier = 1 + 0.5 * stacks                 // stacks 0–5, unchanged
finalDmg = max(floor(baseDmg * multiplier), 1)
// Guaranteed-hit (no d20), as today. No crit roll.
```

Rationale: Mirrors Eviscerate but on INT. Critically, **wizards now keep INT-scaling on their detonator** — they don't get punished for not equipping a melee weapon. Stack consumption preserved.

## Files to Change

1. **`supabase/functions/combat-tick/index.ts`**
   - Replace the three `rollDmg(CLASS_ATK.X.min, CLASS_ATK.X.max) + statMod` lines with the new formulas above (inline, ~3–6 lines each).
   - For Barrage: add `getClassCritRange(c.class)` import and apply per-arrow crit doubling.
   - Update inline log messages to drop class-dice flavor and reflect the new math (e.g., Barrage: `Rolled X+DEX=Y vs AC Z — N dmg`; Eviscerate/Conflagrate: drop the implicit dice mention, just show stacks + final damage).
   - Remove the three `⚠️ TRANSITIONAL LEGACY` comment blocks.
   - Remove the `CLASS_ATK` shim (lines ~109–118) and verify no other references remain. Keep `rollDmg` import only if still used elsewhere in the file (a quick grep confirms the call sites before deleting).

2. **`src/features/combat/utils/combat-predictor.ts`** — audit only.
   - Predictor only models autoattacks today. No changes expected. Confirm with grep.

3. **No DB / RLS / migration / client UI changes.** Tooltips for these abilities currently describe behavior in flavor terms ("a flurry of arrows", "detonate burn stacks") and don't quote dice — verify with a grep of `multi_attack` / `execute_attack` / `ignite_consume` in `src/`. If any tooltip cites dice, update copy.

## Risks

- **Wizard Conflagrate at L1 with no INT investment**: `4 + 2·intMod` with intMod=0 → 4 base → 4·(1+0.5·5)=14 with 5 stacks. Old formula: `(1d8 + 0) × 3.5 ≈ 16`. Comparable. INT-built wizards (mod=4) → 12 base → 42 fully-stacked. Old: ~18. **Slight buff for invested wizards**, parity for uninvested. Acceptable.
- **Barrage adds per-arrow crits**: minor power bump, but fixes the inconsistency where autoattacks crit and Barrage doesn't. Rogue is the only class with class crit edge (19), and Rogue isn't a Ranger ability — so this only matters at very high DEX (dexCritBonus). Tunable.
- **No weapon dependency**: a Wizard with a 1H sword will Conflagrate the same as one with a wand. This is intended by the new design — abilities express class identity, weapons express autoattack identity.
- **Tooltip copy drift**: handled by the grep step above.

## Implementation Order

1. Grep for all references to the three ability types in `src/` and `supabase/` to surface tooltips, predictors, or tests.
2. Edit the three handlers in `combat-tick/index.ts`: new formulas, updated logs, crit on Barrage shots.
3. Remove the `CLASS_ATK` shim and `TRANSITIONAL LEGACY` comments. Verify `rollDmg` usage before touching imports.
4. Update any tooltip copy that cited the old dice.
5. Smoke-test (handled by harness on deploy): trigger each ability solo against a test creature, confirm logs render and damage is in the documented range.

## Follow-ups (out of scope)

- Future T0 ability rewrite may introduce a unified spell-power / ranged-power scalar (e.g., `INT + level` as a "spell power" stat) so all caster abilities scale through one term. Until then, each ability keeps its own inline formula.
- Once T0s land, the legacy `CLASS_COMBAT_PROFILES.{diceMin,diceMax,stat,verb}` fields can be deleted entirely (currently only `critRange` and `emoji` are still useful, and those have already moved to `CLASS_CRIT_RANGE` and `WEAPON_EMOJI`).
