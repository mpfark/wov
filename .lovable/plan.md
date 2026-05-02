# Divine Aegis — drop the timer, render on the HP bar like Force Shield

Divine Aegis stays a castable buff (not a stance — it can be applied to allies). Two changes:

1. **No expiration timer** — the ward persists until the shielded HP is fully absorbed.
2. **HP-bar overlay** — the caster's bar shows the absorb ward as a colored segment + numeric readout, reusing the same overlay pattern as Force Shield (cap ghost + live shield).

Cross-target shielding (casting on an ally) already works through the existing `setAbsorbBuff` setter and server `absorb_buff` consumer — no protocol changes required.

## Changes

### 1. Remove the timer in `useCombatActions.ts`
Replace the `ally_absorb` branch (~line 467):
- Drop the `durationMs` calculation.
- Set `expiresAt: Number.MAX_SAFE_INTEGER` so all `now < expiresAt` gates stay true forever; the ward only goes away when `handleAbsorbDamage` reduces `shieldHp` to 0 (then it's set to `null` — that path already exists).
- Pass `shieldCap: shieldHp` so the overlay can render the cap ghost.
- Update log lines to `"… until absorbed"`.

### 2. Carry `shieldCap` through `AbsorbBuff`
- `src/features/combat/hooks/useGameLoop.ts`: extend `AbsorbBuff` with optional `shieldCap?: number`.
- `useBuffState.ts`: no logic change needed (`handleAbsorbDamage` already preserves spread fields).

### 3. HP-bar overlay in `StatusBarsStrip.tsx`
Today the bar only renders the Force Shield stance overlay. Generalize to also handle Divine Aegis from `absorbBuff`:
- Add a derivation `aegisWard` parallel to `forceShieldStance`:
  ```
  aegisWard = absorbBuff && shieldHp > 0 && !forceShieldStance
    ? { shieldHp, shieldCap: absorbBuff.shieldCap ?? shieldHp }
    : null
  ```
  (Force Shield takes precedence when both are active so we don't draw two stacks of overlay.)
- Reuse the existing JSX block that renders cap ghost + live shield + the inline `🛡 current/max` readout, but driven by either `forceShieldStance` or `aegisWard`. Use a small local `wardOverlay` variable so the markup stays a single block.
- Tooltip text: "Divine Aegis — absorbs damage before HP. Lasts until depleted."
- Always-on (no `inCombat` regen pulse — Aegis doesn't regenerate).

### 4. ActiveBuffs row de-duplication
The "Force Shield" entry in `ActiveBuffs` currently falls back to `absorbActive` and labels it "Force Shield". Now that Divine Aegis is the only path producing `absorbBuff` (Force Shield is purely stance-driven), rename the fallback chip:
- When `absorbActive` and no `forceShieldStance`, push a chip labeled `'Divine Aegis'` with detail `${shieldHp} HP` and `pct = shieldHp / shieldCap * 100` (no countdown).

### 5. GameManual copy
`src/components/admin/GameManual.tsx` line 714: drop the duration formula, replace with `Lasts until absorbed`.

## Files touched
- `src/features/combat/hooks/useGameLoop.ts` — add `shieldCap?` to `AbsorbBuff`.
- `src/features/combat/hooks/useCombatActions.ts` — Divine Aegis branch: no timer, set `shieldCap`, updated log text.
- `src/features/character/components/StatusBarsStrip.tsx` — add `aegisWard` derivation, share overlay JSX, rename fallback chip.
- `src/components/admin/GameManual.tsx` — duration line.

## Out of scope
- No server changes — `combat-tick` already consumes `absorb_buff.shield_hp` via the canonical damage pipeline.
- No stance-system changes — Aegis remains a castable buff.
- No DB/migration changes.
