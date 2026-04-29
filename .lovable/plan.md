## Goal

Change the **autoattack hit roll** to use **DEX modifier** instead of STR modifier. Damage continues to scale from STR. T0 abilities are unchanged.

Result: Warriors (high STR / moderate DEX) hit hard but miss more. Rogues/Rangers (high DEX) land more reliably. Ranged "shoot" attacks already use DEX, so this also unifies melee and ranged under one accuracy stat.

---

## New autoattack formula

```text
Hit roll:  d20 + DEX mod + INT hit bonus + weapon affinity bonus
Damage:    1d{weaponDie} + STR mod   (STR damage floor on non-crits)
Crit:      same as today (class crit range, reduced by DEX, etc.)
```

Everything except the hit-roll stat stays the same. The INT hit bonus, weapon affinity bonus, hit-quality bands, crit math, STR damage floor, glancing/weak caps, and 2H weapon die all remain untouched.

---

## Files to change

### 1. Edge function — `supabase/functions/combat-tick/index.ts`
The actual autoattack hit roll is inlined here (not via `resolveAttackRoll`).

- **Main-hand attack (~line 760-790)**: replace `sMod` (STR) in the to-hit `roll + sMod + ihb + affinity.hitBonus` with the **DEX modifier**. Keep `sMod` for the damage line (`rollDmg + sMod`) and for the STR floor.
- **Off-hand attack (~line 909-927)**: same swap — to-hit uses DEX mod, damage keeps STR mod.
- **Combat-log strings**: rename the `STR` label in the to-hit breakdown to `DEX` (e.g. `Rolled 14 + 3 DEX + 1 INT = 18 vs AC 15`). Damage breakdown stays `+ STR`.

Ranged "shoot" path (line 483) already uses DEX — no change.

### 2. Shared formula — `src/shared/formulas/combat.ts` and mirror `supabase/functions/_shared/formulas/combat.ts`
`resolveAttackRoll` is currently exported but unused at runtime. Keep it consistent with the live combat-tick math:

- Rename the `attackerStat` field comment in `AttackContext` — it now represents **effective DEX** for the to-hit roll (damage uses the existing `str` field).
- In `resolveAttackRoll`: keep `getStatModifier(ctx.attackerStat)` for the to-hit total, but the inner damage roll switches to `getStatModifier(ctx.str)` so damage = `1d{die} + STR`. (Today the function reuses `sMod` for both.)
- Update the JSDoc on `resolveAttackRoll` to reflect the split: hit = DEX + INT, damage = STR.

### 3. Client predictor — `src/features/combat/utils/combat-predictor.ts`
Mirror the same split:
- `attackerStat` → represents effective DEX (used in `threshold` calculation only).
- Damage line uses `getStatModifier(ctx.str)` instead of reusing `sMod`.
- Update JSDoc + interface comments.

### 4. Character panel — `src/features/character/components/CharacterPanel.tsx`
The Offense rows currently show `1d{weaponDie} +{strMod}` and label the bonus as STR. Update so the player can see the split:

- **Attack row**: show damage as `1d{weaponDie} + {strMod}` (unchanged).
- **Hit row** (or a new hit-bonus stat line): show `+{dexMod} DEX + {intHitBonus} INT (+1 Prof)` if not already there.
- Tooltip: explain "To-hit uses DEX. Damage uses STR. INT adds a small accuracy bonus."

If the panel currently only shows a single combined "Attack" line, split it into "To-hit" and "Damage" rows for clarity.

### 5. Game manual — `src/components/admin/GameManual.tsx`
Update the Combat section:
- Autoattack to-hit: `d20 + DEX mod + INT hit bonus (+ weapon affinity)` vs creature AC.
- Autoattack damage: `1d{weaponDie} + STR mod`, with STR damage floor on non-crits.
- One-line note explaining the design intent ("DEX governs accuracy for both melee and ranged; STR governs raw damage and minimum-damage floor").

### 6. Memory updates
- Update `mem://game/combat-system/weapon-mechanics` (or create a new `mem://game/combat-system/hit-vs-damage-stats` memory) to record: **autoattacks use DEX for to-hit and STR for damage**. INT remains a small secondary hit bonus. T0 abilities unchanged.

---

## Out of scope (Phase 2 candidates)

- Rebalancing creature AC for the new hit-rate distribution.
- Changing INT's secondary hit bonus or its cap.
- T0 ability hit rolls (still class-stat-driven; user confirmed).
- Stat planner / stat budget changes.
- Rebalancing Warrior class progression to compensate.

---

## Risk and verification

- **Risk**: DEX now governs to-hit, crit range, shield block chance, *and* AC. This could make DEX overly dominant. Mitigation: STR retains damage, damage floor, shield block amount, and is the primary stat for T0 Warrior abilities. Watch playtest data; if DEX feels mandatory for everyone, future tuning can move INT's hit-bonus cap upward to give casters an alternative accuracy source.
- **Verification**: Existing combat-resolver tests should pass unchanged for damage. If any tests assert hit-roll totals using STR, update them to expect DEX. Spot-check a Warrior at level 1 with 16 STR / 10 DEX vs a Rogue at 10 STR / 16 DEX against a level-1 creature to confirm the asymmetry feels right in combat logs.
