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
| `stored_power.*` | existing Stored Power contract (cap, shares, consume mode/pct/fixed) |

Before writing the mapping, re-inspect the complete stored shape and the deleted legacy handler from Git history, and enumerate every field either side reads. **No stored mechanical value may be left silently unread** — anything unmapped is listed explicitly in the report.

Acceptance: a decoded cast preserves authored damage, AoE, timing, cooldown, chance, channeling, autoattack behavior, Stored Power and flavor. Creating an `encounter_cast_events` row is not sufficient.

## Step 2 — Stable cast identity

- Accept `ability_key` / `abilityKey` first, `cast_key` as legacy compatibility.
- A deterministic `label` slug is a temporary fallback for unmigrated rows only; an editable human-readable label is never the permanent production identity.
- Prepare a migration giving **all 28** rows an explicit, stable, unique canonical `ability_key` — chosen so it equals exactly what the decoder's slug fallback would derive, so no pending or historical interpretation shifts at release.
- Identity survives label and flavor edits.
- Tests: slug collision between two similar labels, rename-after-backfill stability, and canonical-key-equals-derived-key parity across all 28 stored labels.

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

Scoped live verification is a later coordinated release:
1. Review the complete 28-boss mechanical migration.
2. Enter maintenance.
3. Apply the reviewed migration.
4. Deploy `combat-tick` and `combat-catchup` together from the same committed mirror.
5. Publish the admin/frontend bundle if the admin contract changed.
6. Verify one controlled boss cast from warning through committed damage, cooldown, and later irregular chance timing.
7. Confirm Stored Power and autoattack behavior where applicable.
8. Tear down the fixture and reopen only if every check passes.

## Out of scope
- No changes to authored damage numbers, chance values, cooldowns, creature AC, or crit thresholds.
- No changes to how a resolved cast applies damage or consumes Stored Power beyond restoring authored configuration.
