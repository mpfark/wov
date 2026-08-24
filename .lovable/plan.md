# Boss-Cast Decoder Fallback + Per-Tick Chance Gate

Goal: make the telegraphed boss casts that are already authored in the database actually fire, and restore the random per-tick trigger they were authored against — without changing any authored numbers.

## Why nothing fires today

The decoder that turns a creature's stored `boss_cast` JSON into a live cast contract refuses any row that has no `ability_key`. Every stored row identifies its cast with `label` (plus `cast_ms`, `chance`, `enabled`, `cast_flavor`, `hit_flavor`). So the decoder returns "no cast" for every boss, the resolver skips the mechanic entirely, and no cast row has ever been written.

A second gap: the stored rows carry a `chance` (e.g. 0.25 = a one-in-four attempt per tick), but the resolver only checks a cooldown. Even after the decoder is fixed, every boss would cast on a fixed metronome instead of unpredictably — a real balance change. The chance gate has to come back with the decoder fix, not after it.

## Step-by-step

### Step 1 — Extend the cast contract
Add two fields to the boss-cast snapshot type: a per-tick `chance` (0–1, default 1) and an `enabled` flag (default true). Keep every existing field and default unchanged.

### Step 2 — Decoder fallback mapping
In the boss-cast decoder:
- Identity: accept `ability_key` / `abilityKey` first; fall back to `cast_key`, then to a slug derived from `label`. Only return "no cast" when none of those exist.
- `enabled`: read `enabled` when present. When absent (legacy rows), fall back to the historical rule — bosses on, rares off — using the creature's rarity that is already in the snapshot. A disabled row decodes to "no cast".
- `chance`: read `chance`, clamp to 0–1, default 1 when absent.
- Cast duration: keep `cast_ticks` as primary; fall back to `cast_ms` converted with the snapshot's tick rate, minimum one tick.
- Flavor: keep `casting_text` / `casted_text` as primary; fall back to `cast_flavor` and `hit_flavor` respectively.
- `damage_type`: fall back to physical when absent so damage never silently resolves as zero.

No writes to the database in this step — the decoder reads whatever shape is stored.

### Step 3 — Restore the per-tick chance gate
In the resolver's cast-scheduling block, after the cooldown check and after a valid target is found, roll the chance through the existing seeded RNG with its own named stream (so determinism, replay, and parity all hold). On a failed roll: no cast row, no cooldown consumed, no event — the boss simply keeps swinging and may try again next tick. Chance 1 behaves exactly as today.

Ordering matters: cooldown → target → chance. Rolling before target selection would burn rolls on empty rooms and break replay parity.

### Step 4 — Golden tests
Add fixture-driven tests covering:
- each stored shape (modern `ability_key` row, legacy `label`-only row, legacy row missing `enabled`) decoding to a valid contract with the right identity, ticks, and flavor;
- an explicitly disabled row decoding to no cast;
- chance 1 always casting on a ready tick, chance 0 never casting, and a fixed seed producing an identical cast/no-cast sequence across two identical runs;
- a failed chance roll leaving the cooldown untouched.

### Step 5 — Data backfill (separate migration, after code is green)
Normalise the 7 legacy rows to the modern key set and fill the 16 blank flavor rows with authored `cast_flavor` / `hit_flavor` (including Aldric's "Sovereign's Reckoning"). This is cosmetic once Step 2 lands — the fallbacks already keep them working — so it ships as its own migration and can be reviewed independently.

## Out of scope
- No changes to authored damage, chance values, cooldowns, or creature AC.
- No changes to how casts resolve, consume stored power, or apply damage.
- No deploy or publish in the implementation turn; release is a separate coordinated step.

## Verification
Run the full test suite, then a scoped live check against one temporary boss fixture: confirm a cast row is written, the telegraph renders with its authored flavor, the hit lands, and repeated ticks show irregular (not metronomic) cast timing.
