
# Telegraphed Casts v2 — Stored Power (Final, Approved)

Defaults locked in per approval:
- `consume_mode: all`, `primary_share: 1.0`, `aoe_share: 0.4`
- `method: expected`, `pause_autoattacks: true`, `crit_during_cast: disabled`
- `stored_power_cap: NULL` (uncapped) by default
- `sampled` method remains opt-in, unused in the initial backfill
- UI acceptance checks enforce zero meaningful layout shift with sub-pixel tolerance allowed

---

## 1. Data model — dedicated encounter field, no generic framework

### `encounters` — added columns

- `stored_power` int NOT NULL DEFAULT 0
- `stored_power_cap` int NULL (NULL = uncapped)
- `stored_power_source_id` uuid NULL — character currently sampled/targeted

No `stored_power_expiry_ms`. Lifecycle is driven entirely by the encounter row.

Code is written cleanly enough that these three columns could later be extracted into a generic encounter-resource system, but no such abstraction is built now.

### `encounter_cast_events.payload` — declarative per-cast contract

```jsonc
{
  "label": "Cataclysm",
  "emoji": "☄️",
  "cast_ms": 4000,
  "lock_ms": 1500,

  "stored_power": {
    "consume_mode": "all",   // all | percent | fixed | preserve | reset | ignore
    "consume_pct": 100,
    "consume_amount": 0,
    "primary_share": 1.0,
    "aoe_share": 0.4
  },

  "accumulate": {
    "enabled": true,
    "source": "primary_target",   // primary_target | all_engaged | none
    "method": "expected",         // expected | sampled  (sampled = opt-in)
    "pause_autoattacks": true,
    "crit_during_cast": "disabled"
  },

  "base_amount": 30,
  "base_aoe_amount": 8
}
```

Resolve math applied inside `encounter_boss_resolve_cast`:

| mode | at resolve |
|---|---|
| `all` | `used = stored_power; stored_power = 0` |
| `percent` | `used = round(stored_power * consume_pct/100); stored_power -= used` |
| `fixed` | `used = min(stored_power, consume_amount); stored_power -= used` |
| `preserve` | `used = stored_power` for damage math, do not decrement |
| `reset` | `used = 0; stored_power = 0` (vent, no hit) |
| `ignore` | `used = 0` (cast pretends the pool isn't there) |

Damage:

```
primary_damage   = base_amount     + round(used * primary_share)
secondary_damage = base_aoe_amount + round(used * aoe_share)
```

## 2. RPCs — two, not three

- `encounter_stored_power_add(encounter_id, delta, reason, source_id) → int` — clamps to `[0, coalesce(stored_power_cap, 2^31-1)]`, logs to combat audit, returns new value.
- `encounter_stored_power_consume(encounter_id, mode, pct, fixed) → int` — returns consumed amount.

Both `SECURITY DEFINER`, `SET search_path = public`, granted to `authenticated` and `service_role`.

**No `_snapshot` RPC.** Late joiners hydrate through the existing encounter read the same way `useBossCasts` already fetches cast rows — a single `SELECT id, creature_id, stored_power, stored_power_cap FROM encounters WHERE id = ANY(active_ids)` alongside the current `encounter_cast_events` fetch. Adding a snapshot RPC would only be justified by a real consistency/permission gap; none is anticipated. It's a trivial two-line addition later if one emerges.

## 3. Accumulation — expected mitigated damage (default)

Each tick, per channeling boss with `accumulate.enabled`, add one expected mitigated hit:

```
expected = round(
    expected_raw_hit(boss)
  * (1 - miss_chance(boss, tank))
  * (1 - block_chance(tank))
  * (1 - flat_mitigation_pct(tank))
) - flat_armor_reduction(tank)
```

Deterministic, monotonic, cheap. `method: "sampled"` remains opt-in (uses existing `simulateCreatureHit`) but no boss uses it in the initial backfill. Reactive damage (Holy Shield, thorns) never contributes — the boss isn't swinging.

Autoattack gate, crit-during-cast, and `source: all_engaged` behave as designed in the refined plan; unchanged.

## 4. Lifecycle — driven by encounter row, no separate expiry timer

Stored Power lives with the encounter and dies with it:

- Encounter created → `stored_power = 0`.
- Encounter alive (`ended_at IS NULL`, participants present) → Stored Power persists across casts per each cast's `consume_mode`.
- Encounter closed via existing paths (`encounter_close_on_death`, `encounter_disengage`, combat-catchup sweep, respawn cleanup) → Stored Power discarded with the row.

Cast-time edges:
- Empty room at resolve → cast fizzles; boss heals `on_empty_room_heal_pct`; encounter still open → Stored Power **not** discarded merely because a cast fizzled.
- Boss killed mid-channel → encounter closes → cast + Stored Power discarded together.
- Tank leaves/dies mid-channel → accumulation switches to next primary target on next tick; existing pool untouched.
- Mid-channel target switch → visible bar does **not** rescale (see §7).

## 5. Future extensibility

Rename `creatures.boss_cast` → `creatures.cast_config` (compatibility view for the current admin UI). Gate cast start on `cast_config.enabled === true` rather than rarity, so elites/rares can opt in without architectural work. Bosses backfill to `enabled: true`; elites/rares stay `false`.

## 6. UI — restrained, MUD-inspired, zero meaningful layout shift

### Placement

A thin, **always-mounted, fixed-height** Stored Power track directly below the boss HP bar in `NodeView`'s creature card. Present at `stored_power = 0`, present between casts, present mid-cast, present after resolve — the element is never conditionally mounted/unmounted.

### Fixed dimensions

- Track height: exactly `4px` (Tailwind `h-1`, not `min-h-`).
- Track width: equal to the HP bar width, same horizontal padding.
- No numeric readout in the player-facing UI. Numeric value shown only in the Overlord Combat Audit panel for tuning.
- No wrapper conditionally inserted between HP bar and rest of the card — flex column gap is fixed.

### Visual states — opacity + fill only, never dimensions

| State | Appearance |
|---|---|
| Encounter inactive / `stored_power = 0`, no cast | Track present, opacity ~0.15, empty fill — nearly invisible |
| `stored_power > 0`, no active cast | Static muted-amber fill, opacity ~0.55, no animation |
| Active cast accumulating or consuming | Same fill colour, opacity ~0.9, smooth fill-width transition |
| Resolve | Fill width transitions to post-consume value over ~250ms — no drain flash, no shake |

### Motion

- Only `transition: width 250ms linear` on the inner bar. Nothing else animates.
- Colour: single muted amber by default. Optional quiet amber→muted-red interpolation above ~75% of visual max — CSS `transition` only, no keyframes, no pulse.
- Explicitly excluded: pulsing, bouncing, shaking, expanding, flashing, particles, animated gradients, screen shake, floating combat text, repeated warning icons, per-tick text mount/unmount, additional cast bar.

### Visual scale — frozen per cast

Denominator chosen once at cast start and held in a client `ref`:

```
visual_max_for_cast = coalesce(
  stored_power_cap,
  expected_full_channel_growth(boss, tank_at_cast_start, cast_ms)
)
```

Mid-cast target switches, tank swaps, mitigation changes never rescale the bar. Between casts, the resting fill uses `stored_power_cap ?? last_frozen_max ?? sensible_fallback` for stability.

### Accessibility & reduced motion

- `@media (prefers-reduced-motion: reduce)` — width transition disabled; fill updates jump directly.
- Fill length carries the primary signal; colour secondary. Legible with animation off.
- `role="progressbar"`, `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=visual_max_for_cast`, `aria-label="Boss stored power"`.

## 7. Broadcast & hydration

- `combat-tick` emits `cast_tick` at ≤1 Hz per channeling boss: `{ encounter_id, creature_id, stored_power, visual_max }`. `visual_max` piggybacks so late joiners don't recompute the expected full-channel growth.
- `useBossCasts` refactor:
  - State: `Record<encounterId, { cast, storedPower, visualMax }>`.
  - Hydration: on node change, one `SELECT id, creature_id, stored_power, stored_power_cap FROM encounters WHERE id = ANY(active_ids)` plus the existing `encounter_cast_events` fetch.
  - `visualMax` frozen when a `cast_started` row appears; cleared on resolve.
- Encounter realtime UPDATEs (already subscribed elsewhere) cover between-cast Stored Power changes without a second channel.

## 8. Files & migration order

1. **Migration** — add `stored_power`, `stored_power_cap`, `stored_power_source_id` on `encounters`. Create `encounter_stored_power_add` + `_consume`. Update `encounter_boss_resolve_cast` to read `payload.stored_power`, call `_consume`, apply primary/AoE damage. Backfill existing boss cast payloads with the approved defaults (`consume_mode: all`, `primary_share: 1.0`, `aoe_share: 0.4`, `method: expected`, `pause_autoattacks: true`, `crit_during_cast: disabled`).
2. **`supabase/functions/combat-tick/index.ts`** — per channeling boss: compute expected mitigated hit (or dry-run for `sampled`), call `_add`, gate autoattacks on `pause_autoattacks`, emit throttled `cast_tick`.
3. **`supabase/functions/_shared/combat-resolver.ts`** — extract `expectedMitigatedHit(boss, tank)`, keep `simulateCreatureHit` for `sampled`.
4. **`src/features/combat/hooks/useBossCasts.ts`** — rekey by encounter; add `storedPower`/`visualMax`; hydrate via one `encounters` select; freeze `visualMax` on cast start.
5. **`src/features/world/components/NodeView.tsx`** — always render the fixed 4px Stored Power track under the boss HP bar per §6.
6. **`src/components/admin/CreatureManager.tsx`** — payload editors for `stored_power` and `accumulate`; `enabled` checkbox for future elite/rare opt-in.
7. **Docs** — replace `docs/design/phase-2-stored-power.md` with this final plan; mark Phase 1 doc superseded.

## 9. UI acceptance checks — sub-pixel tolerance permitted

Verified with a Playwright pass on a live boss encounter, screenshots captured. `epsilon = 0.5px` allowed on all bounding-box comparisons to absorb browser sub-pixel rounding; anything above is a failure.

1. **No layout shift on cast start** — boss card outer rect and every sibling card rect stable to within ±0.5px across the frame boundary.
2. **No layout shift on resolve** — same check across `cast_resolved`.
3. **No horizontal reflow** — no numeric text ever added/removed on the player card; DOM diff asserted.
4. **No mount/unmount of the track** — stable `data-testid` present in the DOM at `stored_power = 0`, mid-cast, and post-resolve.
5. **Target switch does not rescale** — tank swap mid-cast in a scripted encounter; `visualMax` unchanged, fill width monotonic within the cast.
6. **All six consume modes** — `all`, `percent`, `fixed`, `preserve`, `reset`, `ignore` each pass end-to-end with surrounding UI dimensions stable across resolve.
7. **Late-join hydration** — reload mid-cast; track appears already at correct fill without a visible zero → value snap (render gated on hydration; skeleton is a same-size empty track).
8. **Reduced motion** — with `prefers-reduced-motion: reduce`, width transition disabled and state remains legible.
9. **Encounter close discards Stored Power** — kill, full disengagement, and combat-catchup abandonment each end with the encounter row closed and no orphan client state.

Implementation starts on approval to switch to build mode.
