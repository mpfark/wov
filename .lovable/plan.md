The repo currently has 9 test failures and 1 error. I will fix those and then audit the live preview.

## 1. Fix the test suite

### 1.1 Missing `@shared` alias in Vitest config
`vite.config.ts` defines `@shared` → `./supabase/functions/_shared`, but `vitest.config.ts` only has `@`. This causes:

```
Cannot find module '@shared/proc-log-format' from 'src/features/combat/utils/combat-text.ts'
```

**Fix:** add the same `@shared` alias to `vitest.config.ts`.

### 1.2 Outdated HP snapshots after CON buffs
`getMaxHp` currently uses `getStatModifier(con) * 2`, so warrior L10 con=14 is 73, not 71. The stale snapshots are in:

- `src/lib/__tests__/effective-caps.test.ts` (warrior L10 con=14)
- `src/shared/formulas/__tests__/formula-parity.test.ts` (same value)
- `effective-caps.test.ts` also asserts +4 con gear raises HP by `+2`; with the current formula the delta is `+4`.

**Fix:** update the expected numbers to match the current, intended formula.

### 1.3 Outdated item stat budget snapshots
The item budget formula now uses slope `0.24` and unique 2H hands multiplier `1.35`:

- uncommon L10: `2 + 9*0.24*1.5 = 5.24 → 5` (test expects 6)
- unique L20 2H: `2 + 19*0.24*3.0*1.35 = 20.468 → 20` (test expects 25)

Both snapshots are in `src/shared/formulas/__tests__/formula-parity.test.ts`.

**Fix:** update expected values to 5 and 20, and refresh the comment for the unique 2H calculation.

### 1.4 Investigate `StatusBarsStrip.login-display.test.tsx`
When the full suite runs, the three tests in this file fail with `document is not defined`. Running the file alone passes. This is likely a side effect of the `@shared` resolution failure or a Vitest environment isolation quirk. After fixing the alias and snapshot drift, I will re-run the full suite. If it still fails, I will inspect the Vitest environment setup and the file naming pattern.

## 2. Audit the live app

After the test suite is green, I will drive the preview to check for runtime/UX issues:

- Login / character select / character creation flow
- Entering the world (the "Your journey begins..." transition area)
- Combat (solo and party), event log rendering, and boss telegraphs
- Inventory, blacksmith, jewelcrafter, and teleport UI
- Party, summon, and wimp/auto-flee behavior
- Console and network errors

Any issues found will be documented and fixed in follow-up edits, with the test suite re-run after each change.

## Verification

- `bun test` must pass with 0 failures.
- `bun run build` must still pass (it already does).
- Any live-audit findings must be confirmed with a screenshot or console trace before being claimed fixed.