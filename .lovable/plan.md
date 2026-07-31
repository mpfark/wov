# Revised plan v4 — configurable classes & abilities

Two corrections vs v3: bonds are **not** preserved (existing wipe-on-leave behaviour stays and becomes explicit in the UI), and `duration_calc` stays in **milliseconds**. Framing:

- **Wiping the bond on leaving a class is the intentional switching penalty** — verified existing behaviour, now made explicit and test-covered rather than changed.
- **Duration and autoattack migrations must be balance-neutral** — every number reaching combat stays byte-identical; parity tests are the gate.

---

## Decision 1 — `duration_calc` in milliseconds (confirmed)

Audit confirmed: no player-ability duration is tick-counted. `useCombatActions` computes `durationMs` inline and writes `expires_at = Date.now() + durationMs`; `combat-tick` writes `expires_at: nowMs + durSec * 1000` / `now + durationMs`; `active_effects.expires_at` is an epoch-ms bigint. Cadence is a separate concept (`tick_rate_ms` / `next_tick_at`, per-ability `intervalMs`).

Therefore:
- `duration_calc.unit = 'ms'` for **every** existing ability. No conversion to combat ticks in this migration — that would change tick delays, catch-up processing and possibly world-sleep behaviour.
- `'ticks'` remains a legal value in the schema and evaluator for future mechanics, but nothing seeds it.
- These are **effect lifetimes, not cooldowns**. Conventional cooldowns stay out of the system entirely — no `cooldown_ms` column, no cooldown admin, validation or persistence.
- Server-backed `expires_at` timestamps remain the runtime representation; only the *curve* moves into config.
- Pulse cadence becomes a separate `interval_ms` field (Rend 5000, party regen 3000, Ignite pulse) — never folded into duration.
- Admin displays durations as readable seconds/minutes while storing ms, e.g. `Duration = 20.0s + max(0, DEX mod) × 1.0s, capped 30.0s`.
- There is one duration representation only: `duration_calc`. A fixed duration is `{ base: 300000, terms: [] }` (Ignite/Envenom).

```text
duration_calc: { base, terms:[{stat, mult, effective}], floor, cap, rounding, unit }
```

Curves that must be reproduced exactly (all via `getEffectiveCombatMod`, all clamped):

| Ability | Current expression | duration_calc |
|---|---|---|
| Crescendo | `min(180000, max(60000, 60000 + intMod*8000))` | base 60000, INT ×8000, floor 60000, cap 180000 |
| Shadowstep | `min(15000 + dexMod*1000, 25000)` | base 15000, DEX ×1000, cap 25000 |
| Snare / Dissonance | `min(15000, 8000 + max(0,mod)*1000)`, WIS (ranger) / INT (bard) | base 8000, stat ×1000 ≥0, cap 15000, per-assignment stat |
| Rend | `min(30000, 20000 + max(0,dexMod)*1000)` | base 20000, DEX ×1000 ≥0, cap 30000; `interval_ms` 5000 |
| Cloak of Shadows | `min(15000, 10000 + dexMod*500)` | base 10000, DEX ×500, cap 15000 |
| Disengage | dodge `min(8000, 5000 + dexMod*500)`; next-hit flat 15000 | two duration_calcs (primary / secondary) |
| Force Shield | `min(15000, 8000 + intMod*1000)` | base 8000, INT ×1000, cap 15000 |
| Party regen | `min(30000, 15000 + max(0,mod)*1000)`, WIS (healer) / INT (bard) | base 15000, stat ×1000 ≥0, cap 30000; `interval_ms` 3000 |
| Divine Aegis | `min(60000, 30000 + max(0,conMod)*2000)` | base 30000, CON ×2000 ≥0, cap 60000 |
| Ignite / Envenom | flat 300000 | base 300000, no terms |
| Battle Cry, Sunder, Consecrate, Holy Shield, Divine Challenge, Purifying Light | curves in `formulas/abilities.ts` | transcribed one-for-one during Phase 1 seeding |

Parity gate: for every ability × every stat mod in −5..+15, `evaluateDurationCalc(config)` must equal the current inline expression exactly, including clamp order and rounding. Mechanic handlers keep owning *what* an effect does.

---

## Decision 2 — Leaving a class wipes its bond (existing rule, made explicit)

Verified current `join_order`: it deletes the departing class's bond row, then `INSERT … ON CONFLICT (character_id, class) DO NOTHING`. This is retained. One hardening change: because a stale row for the *target* class could survive from legacy data, the insert becomes an explicit upsert that **forces the new class's bond to 0** (`ON CONFLICT … DO UPDATE SET bond = 0, updated_at = now()`), so a re-joined class can never resume old progress. Live data (16 rows) is consistent with this; a one-off cleanup deletes any row whose class ≠ the character's active class.

Enforcement and UI:
- `award_class_bond` / `award_class_bond_for_kill` assert the awarded class equals the character's active `class_key`, so only the active class can gain bond.
- `ClassBondRow` shows **only** the active class bond. No dormant rows, no dormant styling, no decay, no history retention.
- `OrderRecruiterDialog`: the "Your other bonds" disclosure is removed (it can only ever be empty), and the destructive warning is made explicit before confirmation: *"Leaving the {current order} will permanently erase your bond of N. If you return later, your bond will begin again at zero."* Cancelling changes nothing.
- Switching still clears only temporary class combat state — `reserved_buffs = '{}'` (stances/reserved CP), class-sourced `active_effects` where the character is the source, queued abilities not belonging to the new class. Level, attributes, XP, inventory, equipment untouched. Loadout rows keyed by `role_id` are retained so a returning character keeps its ability picks (bond still restarts at zero).
- Memory `game/bond-multiplier.md`: the "Switch cost" line is confirmed and expanded, not rewritten.

**Acceptance tests** (`__tests__/class-bond-switching`):
1. A→B deletes A's row and creates B at 0.
2. B→A deletes B's row and creates A at 0 (no resumption).
3. A bond at the 100 cap is permanently lost on leaving.
4. Cancelling the recruiter confirmation performs no writes.
5. Wayfarer→first class creates the bond at 0, deletes nothing.
6. A kill while active in B credits only B; no other bond row exists to credit.
7. Switching clears stances / class effects / queued abilities but leaves level, attributes, XP, inventory and equipment unchanged.
8. Legacy stale target-class row is forced to 0 by the upsert.

---

## Decision 3 — Wayfarer as a protected system row

`classes` keeps a `classless` row with `is_pre_class = true`, purely for uniform FKs and lookups:
- Hidden from the ordinary Classes admin list; shown separately as a read-only **System States** entry.
- Not creatable, duplicable, publishable, unpublishable, retireable or deletable — lifecycle RPCs and a DB trigger reject `is_pre_class` rows.
- `selectable_in_class_hall = false`, additionally guarded inside `join_order`.
- Zero rows permitted in `class_ability_roles`, `class_ability_assignments`, `character_ability_loadout` (constraint-enforced).
- Excluded from publish validation (no five-role or default-ability requirement).
- Keeps its live values (`base_hp` 18, `base_ac` 10, empty level bonuses / weapon affinity) since pre-order characters use them.
- Remains the state of every newly created character until they join an order.

---

## Decision 4 — Finish class-constant migration in Phase 2

Audit correction: **`CLASS_COMBAT_PROFILES` has zero live reads.** It appears only in its two definition files and a stale `combat-tick` comment that itself states it is no longer referenced; the "three handlers read dice from here" note in its doc comment is out of date (`multi_attack`, `execute_attack`, `ignite_consume` use ability-specific inline formulas; autoattacks use `WEAPON_DAMAGE_DIE` + STR). So no live dice value needs migrating from it — removal is genuine cleanup.

What *is* live and migrates in Phase 2:
- `CLASS_COMBAT` (label/verb/emoji) — read by `combat-text.ts`, `StatPlannerDialog`, `RaceClassManager` → `classes.autoattack {emoji, verb, label}`.
- `CLASS_CRIT_RANGE` / `getClassCritRange` (assassin 19) → `classes.crit_range`.
- `CLASS_WEAPON_AFFINITY` via `getWeaponAffinityBonus` → `classes.weapon_affinity TEXT[]`; the +1 hit / ×1.10 damage constants stay code-owned.
- `CLASS_BASE_HP`, `CLASS_BASE_AC`, `CLASS_LEVEL_BONUSES`, `CLASS_LABELS` → `classes` columns.
- The three handlers' inline dice/formulas → ability `calc` blocks, parity-tested.

Sequence, all inside Phase 2: enumerate live reads → represent each in structured config → repoint consumers → parity tests against the old constants → only then delete `CLASS_COMBAT_PROFILES`, `TWO_HANDED_DAMAGE_MULT` and the stale comment. Phase 2 ends with no playable-class combat number in a hardcoded table. Phase 5 stays narrowly scoped to the shared player-ability/boss-cast foundation.

---

## Carried forward (unchanged)

- **Phase 1 drops the `character_class` enum** in five stages (add `class_key` → backfill + mirror triggers → switch all reads/writes/functions/types with enum-signature shims → verify live data → drop shims, columns, `DROP TYPE`). Verified surface: 3 columns (`characters.class`, `character_class_bonds.class`, `nodes.class_hall`) and 6 functions (`join_order`, `switch_order`, `get_order_roster`, `award_class_bond`, `award_class_bond_for_kill`, `delete_character_cascade`). Afterwards a new class is a single row insert.
- **No cooldowns anywhere.** Economy = CP spend, CP reservation (stances), queue-to-next-tick, effect durations.
- **No starting equipment** in scope; weapon proficiency/affinity retained. Admin Characters pages: Overview, Classes, Races, Abilities, Progression.
- **Class switching stays enabled** and safe, per Decision 2.
- **Abilities split from assignments**: `abilities` (identity, mechanic_key, targeting, CP behaviour, `calc`, `duration_calc`, `interval_ms`, event text) + `class_ability_assignments` (class_key, ability_id, role_id, unlock_level, is_default, status), `UNIQUE (role_id, ability_id)` plus a partial unique index for one default per role. Reuse across classes happens via `mechanic_key`, not shared ability rows.
- **Roles identified by record**: `class_ability_roles.id` is identity; `slot_index` (1–5, unique per class) is display/hotkey order only.
- **Phases:** 1 enum removal + data model + evaluator + parity harness · 2 combat reads config behind `USE_CONFIG_ABILITIES`, all live class constants migrated, deprecated tables deleted · 3 class lifecycle + validation in admin · 4 alternatives, per-character loadouts, Frost Bolt POC · 5 narrow shared foundation (damage types, damage/heal resolution, targeting primitives, status application, event generation) + one boss-cast POC.
- **Party tank finding (documented, not a blocker):** `combat-tick` uses `tankId = party.tank_id ?? party.leader_id`, scoped per `party_id` per tick, so two parties on one node each redirect to their own tank and a solo player is never covered by another party's tank. No threat/taunt model exists; the migration keeps reading `parties.tank_id` unchanged.

---

## Remaining question

Only one left: when a character switches class, should their **retained ability loadout rows** for the old class survive (my plan: yes, keyed by `role_id`, so returning restores prior picks even though bond restarts at zero), or should leaving a class also clear its loadout to match the "abandon the relationship" framing?
