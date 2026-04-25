## Diagnosis

Your read of the situation is exactly right. Cithrawiel has a base `max_hp` of 233 stored in the database, plus +17 HP from gear (CON bonus / flat HP) bringing the **effective** max to 250.

Two things conspire to make HP visibly bounce 250 → 233 → regen → 250 → 233:

### 1. Stale base `max_hp` shown briefly on login

On login the character row is fetched directly. Its `hp` and `max_hp` come back as the last persisted base values (e.g. 233/233). Equipped items load a moment later, and only after `equipmentBonuses` is computed does `getEffectiveMaxHp(...)` return 250. So the bar reads "233/233" for a frame before settling to "x/250".

This is cosmetic and self-corrects. Nothing in the DB is wrong.

### 2. Snap-back from 250 → 233 (the real bug)

In `src/features/character/hooks/useCharacter.ts` (`updateCharacter`), every write to the DB clamps `hp` to the **base** `max_hp`, not the effective max:

```ts
if (dbUpdates.hp != null) dbUpdates.hp = Math.min(dbUpdates.hp, charForCaps.max_hp); // 233
```

Meanwhile `useGameLoop` regens HP up to `effectiveMaxHp` (250) and persists it via `updateCharacter`. The clamp silently writes `hp = 233` to the DB. The realtime echo then arrives and overwrites the optimistic local `hp = 250` with `233`, the regen tick fires again, repeat. Switching tabs paused the worker-timer regen, which is why the loop stopped.

The comment in that block ("gear bonuses are display-only on the client") is the root cause — it's no longer true now that effective max HP/CP/MP are the real cap used everywhere else.

## Fix

### `src/features/character/hooks/useCharacter.ts`

In `updateCharacter`, compute the effective caps using the same helpers the regen loop uses, and clamp DB writes to those instead of the base maxes:

- Import `getEffectiveMaxHp`, `getEffectiveMaxCp`, `getEffectiveMaxMp` from `@/lib/game-data`.
- Compute current `equipmentBonuses` for the character being updated (sum of equipped item `stats`, same shape used in `useGameLoop`/`StatusBarsStrip`). Easiest: lift the small bonus aggregator into a shared util, or accept that `updateCharacter` already has access to `selectedCharacter` and re-derive bonuses from `useInventory` results — but to avoid coupling the hook to inventory, add an optional `effectiveCaps` parameter:

  ```ts
  updateCharacter(updates, { maxHp?, maxCp?, maxMp? })
  ```

- The single caller that needs this is the regen loop in `useGameLoop` — it already computes `effectiveMaxHp`, `effectiveMaxCp`, `effectiveMaxMp`. Pass them through.
- Default behavior (no caps passed) keeps clamping to base, preserving safety for any other caller.

### `src/features/combat/hooks/useGameLoop.ts`

When the regen interval calls `updateCharRegenRef.current(updates)`, also pass the three effective maxes it just computed. No other logic changes.

### Optional polish: avoid the brief "233/233" flash on login

Once the fix above lands, the bar still shows base max for ~1 frame until inventory loads. Acceptable as-is, but if you want it cleaner, gate the StatusBars render on `inventoryLoaded` or default the displayed max to `Math.max(character.max_hp, character.hp)` so it never displays a max lower than current HP.

## Technical Details

- Files touched: `src/features/character/hooks/useCharacter.ts`, `src/features/combat/hooks/useGameLoop.ts`.
- No DB migration. No schema change. The server-side trigger already locks `max_hp` so it cannot be tampered with — we're only changing the client clamp on `hp` writes.
- `heal_party_member` RPC already accepts an `_effective_max_hp` arg, so this aligns the solo path with the party path.

## Acceptance

- Logging in with Cithrawiel shows 250/250 (or whatever current HP / 250) and stays there.
- HP no longer drops from 250 to 233 every few seconds.
- CP and MP behave the same way (no snap-back to base max when gear pushes effective max above base).
- After a server restart / refetch, the persisted `hp` value can equal the effective max (e.g. 250) without the trigger reverting it.
