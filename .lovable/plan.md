# Boss-Cast Compatibility Contract, Chance Gate, and Reviewed Backfill

Goal: make the telegraphed boss casts that are already authored in the database fire with their **authored** mechanics intact — damage, AoE, timing, cooldown, chance, channeling, autoattack pause, Stored Power and flavor — and restore the deterministic per-tick chance gate. Nothing may start casting with zero damage, no cooldown, or broken channeling.

## Confirmed diagnosis (retained)

The decoder that converts a creature's stored `boss_cast` JSON into a runtime cast contract returns "no cast" for any row without `ability_key`. Verified against production data: **not one of the 28 configured rows has `ability_key` or `cast_key`** — they identify the cast by `label`. So the resolver skips the mechanic for every boss, and no cast row has ever been written.

The resolver also has no per-tick `chance` check any more, only a cooldown, even though all 28 rows store a `chance`. Fixing identity without restoring the gate would turn every boss into a fixed metronome — a real balance change. Both land together.

## Verified state of the 28 configured rows

| Stored key | Rows with it |
|---|---|
| `label`, `amount`, `base_amount`, `cast_ms`, `cooldown_ms`, `chance`, `lock_ms`, `stored_power` | 28 |
| `enabled`, `accumulate`, `base_aoe_amount` | 21 (7 missing) |
| `damage_type` | 20 (8 missing) |
| `cast_flavor`, `hit_flavor` | 12 non-null each (16 missing) |
| `ability_key` / `cast_key` | 0 |

`accumulate` sub-keys in use: `enabled`, `pause_autoattacks`, `method`, `source`, `crit_during_cast`.
Stored `damage_type` values: physical (11), nature (2), necrotic (2), arcane, fire, frost, holy, poison (1 each), null (8).

## Step 1 — One shared, typed boss-cast contract

Create a single normalizer module that owns the boss-cast vocabulary, used by **both** the C3 decoder and the admin editor's validation. No second vocabulary. It maps the full stored shape:

| Stored / admin field | Runtime field |
|---|---|
| `ability_key` / `abilityKey` | `abilityKey` (primary) |
| `cast_key` | legacy fallback identity |
| `label` | display label; deterministic slug is a *temporary* identity fallback only |
| `cast_ms` | `castTicks` |
| `cooldown_ms` | `cooldownTicks` |
| `amount` / `base_amount` | `damage` |
| `base_aoe_amount` | `damageAoe` |
| `damage_type` | `damageType` (no invented default — see Step 4) |
| `chance` | `chance` |
| `enabled` | enabled/disabled decoding |
| `accumulate.enabled` | `channeling` |
| `accumulate.pause_autoattacks` | `pauseAutoattacks` |
| `accumulate.method` / `.source` / `.crit_during_cast` | mapped if the legacy handler read them; otherwise preserved verbatim and reported as unread |
| `lock_ms` | `lockMs` |
| `casting_text` (primary) / `cast_flavor` (legacy) | `castingText` |
| `casted_text` (primary) / `hit_flavor` (legacy) | `castedText` |
| `stored_power.*` | existing Stored Power contract (cap, shares, consume mode/pct/fixed) |

Before writing the mapping, re-inspect the complete stored shape and the deleted legacy handler from Git history, and enumerate every field either side reads. **No stored mechanical value may be left silently unread** — anything unmapped is listed explicitly in the report.

Flavor tests must cover canonical form, legacy form, and both present at once (canonical wins). An empty canonical string must not suppress a valid legacy value unless "empty means intentional override" is explicitly established from history and documented.

Acceptance: a decoded cast preserves authored damage, AoE, timing, cooldown, chance, channeling, autoattack behavior, Stored Power and flavor. Creating an `encounter_cast_events` row is not sufficient.

## Step 1b — Precedence table for every dual-source field

Establish precedence from the deleted legacy handler and the current contract **before** implementing the normalizer, and report the resolved table with the reason each winner wins. Minimum coverage:

- `ability_key` → `abilityKey` → `cast_key` → temporary label slug;
- `amount` vs `base_amount`;
- `cast_ticks` vs converted `cast_ms`;
- `cooldown_ticks` vs converted `cooldown_ms`;
- `casting_text` vs `cast_flavor`;
- `casted_text` vs `hit_flavor`;
- canonical channeling fields vs `accumulate.*`;
- canonical Stored Power values vs legacy aliases.

Conflict tests are required: both keys present with **different** values, not only absence cases. Where history cannot establish the intended precedence, stop and report that specific ambiguity before choosing.

## Step 2 — Stable cast identity

- Accept `ability_key` / `abilityKey` first, `cast_key` as legacy compatibility.
- A deterministic `label` slug is a temporary fallback for unmigrated rows only; an editable human-readable label is never the permanent production identity.
- Prepare a migration giving **all 28** rows an explicit, stable, unique canonical `ability_key` — chosen so it equals exactly what the decoder's slug fallback would derive, so no pending or historical interpretation shifts at release.
- Identity survives label and flavor edits.

Collision handling (the "equals derived slug" and "unique" rules can conflict): before preparing the migration, derive proposed keys for all 28 casts, assert non-empty and unique, and report the complete 28-row mapping for review. On a collision, do **not** append an order-dependent suffix — use a deterministic, stable disambiguation rule anchored to immutable creature identity (creature id), and use the identical rule in both the fallback decoder and the migration.

Tests: punctuation/case variants collapsing to the same base slug; two different labels colliding; label rename after backfill leaving identity unchanged; migration rerun producing identical keys; duplicate canonical keys failing validation.

## Step 2b — The missing-`enabled` rule

Confirm from the deleted handler whether an absent `enabled` historically meant bosses enabled and rares disabled. If confirmed, reproduce that rule exactly. Creature rarity (or an equivalent classification) is passed to the normalizer as **explicit context** — never inferred from the cast label, and never blanket-defaulted to true.

Tests: boss with missing `enabled`; rare with missing `enabled`; explicit `true`; explicit `false`; missing rarity context failing closed rather than defaulting. If the historical rule cannot be proven, report it for approval before implementation.

## Step 2c — One canonical persisted JSON shape

Specify concretely, and report before migrating, the exact keys the database and admin editor write after normalization — choosing exactly one authoritative representation per value:

- milliseconds or ticks for `cast_*` / `cooldown_*`;
- `amount` or `damage`;
- `base_aoe_amount` or `damage_aoe`;
- top-level channeling fields or `accumulate.*`;
- `cast_flavor` / `hit_flavor` or `casting_text` / `casted_text`;
- current or normalized Stored Power vocabulary.

Compatibility aliases stay **readable** during transition, but the admin writes only the canonical form while preserving genuinely unknown keys. Canonical and legacy copies are never persisted together indefinitely — two sources of truth would reintroduce precedence bugs.

Round-trip tests: a legacy row normalizes to the canonical shape; saving again is idempotent; a second load/save produces no further changes; runtime decoding before and after normalization yields the same mechanical contract.



## Step 3 — Timing and chance semantics from history, not invention

Trace the deleted legacy handler in Git history and document, in the implementation report:

- when eligibility was checked;
- whether cooldown started at cast start or at resolution;
- whether the chance roll ran before or after target selection;
- behavior when no valid target existed;
- how `cast_ms` / `cooldown_ms` aligned with the 2-second cadence;
- whether a failed chance roll consumed cooldown or mutated cast state;
- whether channeling paused ordinary autoattacks during the warning window.

Implement those historical semantics. Any place where history cannot be proven is called out as unproven, with the chosen behavior flagged for approval rather than silently defaulted.

Millisecond-to-tick conversion:
- explicit, documented rounding rule;
- driven by the encounter/snapshot tick rate, never a client constant;
- minimum one tick for casting where appropriate;
- tests for exact boundaries, non-divisible durations, and a tick rate other than 2000 ms.

Chance gate:
- its own named deterministic seeded stream (the RNG surface is address-keyed, so a new stream is additive);
- a proof test that attack rolls, damage rolls, target selection and Stored Power randomness are byte-identical with the gate added;
- chance 0 and chance 1 consume no unrelated stream.

## Step 4 — No invented physical damage fallback

Do not default a missing `damage_type` to physical unless Git history proves physical was the exact legacy runtime default. Otherwise a missing or invalid damage type is an **incomplete configuration that fails closed** — the cast does not run.

The 8 rows without `damage_type` are reported individually with a proposed reviewed damage type for approval; no guessing from the boss's name. Backfill happens only after review, before that cast is enabled in production. Tests cover null, empty, unknown, and valid damage types in both the decoder and admin validation.

## Step 5 — Repair the admin round-trip first

The admin editor replaces the whole `boss_cast` object and can erase fields it does not expose, so it is fixed **before** any canonical-key or mechanical migration is applied. The admin contract must:

- load both legacy and canonical shapes;
- preserve a stable `ability_key`;
- preserve unknown fields rather than dropping them;
- expose or safely preserve every runtime-owned mechanical field;
- validate required fields before saving;
- reject an enabled cast that cannot decode into a valid runtime contract;
- distinguish optional flavor from required mechanical data;
- never convert missing values to null just because an old row was opened and saved.

Round-trip test: load King Aldric's legacy shape, edit an unrelated creature field, save, and assert no boss-cast field is lost or rewritten.

## Step 6 — Mechanical backfill separated from flavor authoring

Prepared (not blindly applied) mechanical migration normalizing all 28 casts: stable `ability_key`, explicit `enabled`, canonical timing, damage and AoE damage, reviewed damage type, chance, channeling and autoattack-pause behavior, existing Stored Power config. The 7 rows missing `enabled` / `accumulate` / `base_aoe_amount` get those control fields resolved; all 28 get stable identity.

The 16 missing `cast_flavor` / `hit_flavor` entries are **not** described as restored historical text. King Aldric's original prose is not present in surviving evidence, which does not prove it never existed — only that it cannot currently be recovered. Missing prose becomes a separate content proposal for review; generic fallback prose may remain temporarily where flavor is optional. No invented flavor ships inside the mechanical migration.

## Step 7 — Golden tests

Decoder shapes: modern key row, legacy `label`-only row, row missing `enabled`, explicitly disabled row, disabled rares staying disabled, missing required mechanical fields failing closed, and all 28 production cast objects decoding successfully after the proposed migration.

Resolved behavior (asserting damage and timing, not merely that a start event exists):
- `amount` / `base_amount` producing the expected single-target damage;
- `base_aoe_amount` producing the expected AoE damage;
- `cooldown_ms` conversion and exact cooldown spacing;
- warning start followed by resolution exactly once;
- no duplicate resolution on claim retry or batch replay;
- `accumulate.enabled` channeling behavior;
- `pause_autoattacks` suppressing only the intended boss attacks;
- Stored Power accumulation and consumption unchanged;
- chance 1 always casting on a ready tick, chance 0 never casting, fixed seed replaying an identical cast/no-cast sequence;
- failed chance roll leaving cooldown and cast persistence untouched;
- no valid target producing no chance-side effect;
- creature death during a pending cast;
- target death or departure before resolution;
- encounter termination clearing or safely ignoring pending casts;
- multiple bosses casting independently;
- catch-up and ordinary combat producing equivalent outcomes.

## Step 8 — Implementation turn ends before release

The implementation turn ends after: code and admin corrections; migrations **prepared, not applied**; focused tests; full suite; typecheck; production build; shared Edge mirror verification. No deploy, no publish, no production boss-data change, no live fixture.

Because the live admin can still erase fields it does not understand, the corrected admin round-trip is published and verified **before** the mechanical backfill is applied:

1. Review the code, canonical schema and complete 28-row migration.
2. Confirm full tests, typecheck, build and mirror sync.
3. Publish the frontend/admin bundle containing the preservation and validation correction.
4. Verify the live build identifier and admin contract without saving production boss data.
5. Enter combat maintenance.
6. Apply the reviewed mechanical migration.
7. Verify all 28 stored objects satisfy the canonical contract and decode successfully.
8. Deploy `combat-tick` and `combat-catchup` together from the same committed shared mirror.
9. Run the scoped controlled boss-cast verification (warning, resolution, damage, cooldown, later irregular chance timing).
10. Tear down fixtures and reopen only if warning, resolution, damage, cooldown, chance, channeling and cleanup checks all pass.

If frontend-first compatibility cannot be guaranteed, stop and report the incompatibility rather than silently changing this order.

Before any code or data change, report: the resolved precedence table, the canonical stored schema, the 28-key identity mapping, and the historical `enabled` rule.


## Out of scope
- No changes to authored damage numbers, chance values, cooldowns, creature AC, or crit thresholds.
- No changes to how a resolved cast applies damage or consumes Stored Power beyond restoring authored configuration.
