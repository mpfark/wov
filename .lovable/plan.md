
## The concern is real, but small — here's what actually happens today

Combat runs on a fixed **2000ms tick** (`TICK_RATE` in `combat-tick`). Boss casts are configured in **milliseconds** (`cast_ms`, `lock_ms`). Nothing forces `cast_ms` to be a multiple of the tick rate, and that mismatch causes three visible artifacts:

1. **Resolution snaps to the next tick.** A cast expires at `started_at + cast_ms`, but it only resolves inside a tick where `now >= resolves_at`. A 5500ms cast resolves on the tick at 6000ms; a 3000ms cast resolves at 4000ms. Effective cast length is always `ceil(cast_ms / 2000) * 2000`.
2. **Accumulation count depends on rounding.** Stored Power adds one "expected mitigated hit" per tick that fires during the channel. A 4000ms cast usually gets 2 ticks; a 5000ms cast may get 2 or 3 depending on where the cast starts inside the tick window. The visual bar denominator uses `Math.round(castMs / TICK_RATE)` (`combat-tick` line 2229), so the fill and the actual growth can disagree by one tick.
3. **Player-facing cast time is a lie for odd values.** The client counts down to `resolves_at`, then the bar sits at "0.0s" for up to 2s while waiting for the next tick to resolve.

None of this is broken — resolution is still atomic and idempotent — but "4000ms" and "5000ms" behave identically in practice, and admins can't tell why.

## Proposed change: admins configure ticks, engine keeps ms internally

Make the admin-facing unit **ticks**, keep the storage/runtime unit **milliseconds** so nothing downstream changes.

### Admin UI (`CreatureManager.tsx`)
- Replace the `Cast time (ms)` and `Lock time (ms)` number inputs with `Cast ticks` and `Lock ticks` integer inputs (min 1 / min 0).
- Show a small helper: `= 4000 ms at 2s/tick`.
- On save, write `cast_ms = ticks * TICK_RATE_MS` into the existing `boss_cast` JSONB. No schema change.

### Shared constant
- Add `TICK_RATE_MS = 2000` to `src/shared/formulas/combat.ts` (and mirror in `supabase/functions/_shared/formulas/combat.ts`) so admin UI, `combat-tick`, and `useBossCasts` all read the same number. Today `combat-tick` has a local `const TICK_RATE = 2000` — leave the runtime alone but import the shared value where it's used for conversions.

### One-time backfill migration
For every creature with `boss_cast.cast_ms` set:
```
cast_ms  := round(cast_ms  / 2000) * 2000
lock_ms  := round(lock_ms  / 2000) * 2000   -- when present
```
Minimum `cast_ms = 2000`. This snaps existing bosses (4000, 5500, 6000, etc.) onto the tick grid so the "counts down to 0 then waits" gap disappears. Cast payloads that already sit on the grid (most of the 16 bosses use 4000/6000) are unchanged.

### Engine (`combat-tick`)
No behavioural change. `castMs` and `lockMs` continue to be read from the payload; because they're now always multiples of 2000, `Math.round(castMs / TICK_RATE)` becomes exact and Stored Power accumulation is deterministic (`totalTicks` == actual accumulation ticks). Keep the current `resolves_at`/status-guarded resolve; the sub-tick edge cases are eliminated by the input, not by new code.

### Client (`useBossCasts.ts`, `NodeView.tsx`)
No change. `castMs` still comes from the payload, the pulsing glow still uses `expiresAt`. Because `cast_ms` is now grid-aligned, the visible timer bottoms out on the same tick that resolves the cast.

## What this deliberately does NOT do

- Does not change `TICK_RATE` from 2000ms.
- Does not touch storage columns or RPC signatures (`_cast_ms` stays ms).
- Does not remove the ms fields from `boss_cast`; ticks are just the admin input.
- Does not resample or re-tune damage — Stored Power caps and shares stay exactly as configured; only the number of accumulation ticks becomes predictable.

## Files touched

- `src/components/admin/CreatureManager.tsx` — swap ms inputs for tick inputs + conversion on save/load.
- `src/shared/formulas/combat.ts` + `supabase/functions/_shared/formulas/combat.ts` — export `TICK_RATE_MS`.
- One SQL migration — snap existing `boss_cast.cast_ms` / `lock_ms` to the tick grid.

## Open decision before I build

Should `lock_ms` (the movement-lock after a failed telegraph) also be ticks, or stay free-form ms since it's not gated on the tick loop? My default is **ticks, for consistency in the admin UI** — but happy to leave it as ms if you'd rather keep fine-grained lock durations.
