
## Goal

Extend the proc-on-hit system so items can grant a **temporary self-buff** when they trigger — bonuses to AC, primary attributes (STR/DEX/CON/INT/WIS/CHA), and/or % damage reduction. Buff procs are admin/unique-only for now (not rollable by AI Forge).

## Behavior

- **Trigger sides**
  - `on_hit` (existing) — fires when the wearer lands an autoattack hit.
  - `on_taken` (new) — fires when the wearer is struck by a creature. Lets defensive items (chest, shield, rings) grant reactive buffs.
- **Stacking**: *Ignore while active.* If the same proc's buff is already on the player, a re-trigger does nothing (no refresh, no stack). Once it expires, it can proc again.
- **Duration**: per-proc `duration_sec` field (default 30s, in line with existing debuff visibility convention).
- **Scope**: buff is **self-only** on the wearer. No party-wide buffs in this pass.

## Proc shape

New proc `type` values, stored on `items.procs` JSON:

```
{ type: "buff_ac",        chance, value,            duration_sec, trigger, emoji, text }
{ type: "buff_attribute", chance, value, attribute, duration_sec, trigger, emoji, text }
{ type: "buff_resist",    chance, value,            duration_sec, trigger, emoji, text }   // value = 0.10 for 10% DR
```

Where:
- `attribute` ∈ `str | dex | con | int | wis | cha`
- `trigger` ∈ `on_hit | on_taken` (defaults to `on_hit` for back-compat with existing damage/heal procs)

## Storage & effective stats

- Buffs live in `active_effects` as a new `kind = 'item_buff'` row with `meta` carrying `{ proc_type, attribute?, value, source_item_id }` and `expires_at = now + duration_sec`.
- The shared effective-stat layer (`supabase/functions/_shared/formulas/effective.ts` + mirrored `src/shared/formulas/effective.ts`) folds active `item_buff` rows into AC, attributes, and an incoming-damage multiplier.
- Damage pipeline in combat-tick applies the resist multiplier as a new step right before final HP write (keeps the 8-step canonical pipeline intact, just parameterised).
- "Ignore while active" check: before inserting, query whether an `item_buff` row already exists for `(character_id, source_item_id, proc_type, attribute)` and is not expired.

## Combat-tick wiring

1. After the autoattack hit path resolves damage and existing on-hit procs, run a new `resolveBuffProcs(..., 'on_hit')` pass against the attacker's equipped procs (already collected from all slots).
2. In the creature-attacks-player path, after damage is applied, run `resolveBuffProcs(..., 'on_taken')` against the defender's equipped procs.
3. Both pushes a `proc` event with the formatted message so it shows in the event log.
4. New rows in `active_effects` are picked up by the existing realtime sync so the UI shows the buff icon/countdown.

## UI

- Tooltip (`ItemTooltipCard`) already renders proc text — extend the proc-line formatter in `proc-log-format.ts` so buff procs read e.g. `🛡 Aegis flares (+2 AC, 30s)` / `(+3 STR, 30s)` / `(10% DR, 30s)`.
- Buff debuff strip (existing buff/ignite/poison renderer) gets a small generic `item_buff` chip variant.

## Forge / authoring

- AI Item Forge prompt and budget tables are **not** changed — buff procs stay off the generation menu.
- Admin item editor's proc editor gets the new types in its dropdown plus the `trigger`, `duration_sec`, and (for attribute buffs) `attribute` fields. Used for unique/world-drop items hand-authored by admins.

## Files touched

```text
supabase/functions/combat-tick/index.ts            new resolveBuffProcs + on_taken hook
supabase/functions/_shared/proc-log-format.ts      buff suffix formatting
supabase/functions/_shared/formulas/effective.ts   fold item_buff into AC/attrs/DR
src/shared/formulas/effective.ts                   mirror
src/components/items/ItemTooltipCard.tsx           buff proc line rendering (via formatter)
src/components/admin/...ItemEditor                 admin proc editor: new types & fields
src/features/combat/... buff strip                 generic item_buff chip
```

No schema migration is required — `active_effects` already stores arbitrary `kind` + `meta`.

## Out of scope

- Party-wide / aura buffs
- Refresh / stacking magnitude
- AI Forge rolling buff procs
- New trigger types beyond `on_hit` / `on_taken` (e.g. on-kill, on-crit, on-low-hp)
