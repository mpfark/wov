## Goal

Add automated tests proving:
1. `updateCharacter` clamps `hp/cp/mp` to caller-supplied `effectiveCaps` when present (regen loop case — no snap-back to base `max_hp`).
2. When `effectiveCaps` is absent, the legacy clamp to base `max_hp/max_cp/max_mp` still applies.
3. The HP display on login never shows a max lower than current HP (the "233/233 flash" can't recur in a way that would clip a 250 HP value to 233).

## Approach

`updateCharacter` lives inside the `useCharacter` hook and is closure-bound to React state and Supabase calls. Testing it through the full hook would require mocking Supabase + realtime channels — high cost, low signal for what we actually want to verify (a 6-line clamp).

Cleanest fix: **extract the clamp into a pure helper** and call it from `updateCharacter`. Then unit-test the helper directly. Behavior is unchanged.

## Changes

### 1. New pure helper — `src/features/character/utils/clampResources.ts`

```ts
import type { Character } from '../hooks/useCharacter';

export interface EffectiveCaps {
  maxHp?: number;
  maxCp?: number;
  maxMp?: number;
}

/** Clamp hp/cp/mp in `updates` to effective caps (gear-boosted) when supplied,
 *  otherwise fall back to the base maxes on the character row. */
export function clampResourceUpdates(
  updates: Partial<Character>,
  base: Pick<Character, 'max_hp' | 'max_cp' | 'max_mp'>,
  caps?: EffectiveCaps,
): Partial<Character> {
  const out = { ...updates } as any;
  const hpCap = caps?.maxHp ?? base.max_hp;
  const cpCap = caps?.maxCp ?? base.max_cp;
  const mpCap = caps?.maxMp ?? base.max_mp;
  if (out.hp != null) out.hp = Math.min(out.hp, hpCap);
  if (out.cp != null) out.cp = Math.min(out.cp, cpCap);
  if (out.mp != null) out.mp = Math.min(out.mp, mpCap);
  return out;
}
```

### 2. Refactor `useCharacter.ts`

Replace the inline clamp block in `updateCharacter` with a call to `clampResourceUpdates(updates, charForCaps, effectiveCaps)`. No behavior change.

### 3. New test — `src/features/character/utils/clampResources.test.ts`

Cases:
- **Regen above base, with caps** — `hp: 250`, base `max_hp: 233`, caps `{ maxHp: 250 }` → result `hp: 250` (no snap-back).
- **Regen above base, no caps** — same input without caps → result `hp: 233` (legacy behavior preserved).
- **CP/MP clamped to caps independently** — verify all three resources use their respective caps.
- **No clamp when field absent** — `updates` without `hp` field is untouched.
- **Over-cap value still clamped to cap** — `hp: 999` with cap `250` → `250`.
- **Other fields pass through** — `gold`, `xp`, `name` unchanged.

### 4. New test — `src/features/character/components/StatusBarsStrip.login-display.test.tsx`

Renders `StatusBarsStrip` with a character at `hp: 250, max_hp: 233` and `equipmentBonuses: { hp: 17 }` (the Cithrawiel scenario). Asserts the HP readout shows `250/250` — i.e. the bar uses `getEffectiveMaxHp` and never displays `233` as the max while HP is 250. Then re-renders with empty bonuses (the brief login frame before inventory loads) and asserts the bar doesn't crash and the percentage stays sensible (`hp/effectiveMax` ≤ 1 because `effectiveMax >= max_hp >= hp` post-clamp).

This second test requires mocking nothing — `StatusBarsStrip` is a pure component that takes `character` and `equipmentBonuses` as props.

## Files

- **New:** `src/features/character/utils/clampResources.ts`
- **New:** `src/features/character/utils/clampResources.test.ts`
- **New:** `src/features/character/components/StatusBarsStrip.login-display.test.tsx`
- **Edit:** `src/features/character/hooks/useCharacter.ts` — replace inline clamp with `clampResourceUpdates(...)` call (one import, ~6 lines replaced with 1).

## Verification

Run `bunx vitest run src/features/character` — all new tests pass; existing combat tests untouched.

## Out of scope

- Full integration test of the regen loop driving Supabase. The hook-level wiring (passing `effectiveCaps` from `useGameLoop` into `updateCharacter`) is already done; the risk surface is the clamp math, which these tests cover.
- Changing the StatusBars to default `max = Math.max(max_hp, hp)` — already noted as optional polish in the plan; not needed if the clamp is correct.
