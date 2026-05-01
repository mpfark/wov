## Concept

Stance-like self buffs become **CP-reservation stances**: activating one locks part of your max CP. The buff stays up indefinitely (no timer, no rebuffing) for as long as you are online. Dropping the stance frees the reservation slot but does **not** refund the CP — it has to regen back naturally. Stances do **not** survive offline/logout.

Short tactical buffs (Shield Wall, Disengage, Consecrate, Divine Aegis, party heals/regens, Sunder, Rend bleed, root debuffs, **Cloak of Shadows**) are unchanged — they keep their current duration/cooldown model.

## Stance list (final)

| Tier | Reserve % of max CP | Stances |
|------|---------------------|---------|
| T1 | 10% | Eagle Eye, Force Shield, Holy Shield |
| T2 | 15% | Arcane Surge, Battle Cry |
| T3 | 20% | Ignite, Envenom |

Cloak of Shadows is **not** a stance — it stays as the existing 50% dodge timed buff.

Reservation amount is computed at activation against current effective max CP, rounded up, minimum 5 CP. It is locked at the value paid — gear/level changes after activation do not retune it.

## Player-facing rules

- **Stack freely** as long as you have CP headroom: activation is blocked if `available CP (raw − total stance reservation − any queued ability reservation) < 0` would result.
- **Mutual exclusion stays**: Ignite and Envenom remain mutually exclusive (existing commitment-buff rule). All other stances can coexist.
- **Toggle to drop**: clicking an active stance button drops it. Reservation slot frees, **CP stays spent** until natural regen refills it.
- **Persists across**: combats, node movement, travel, panels — the entire online session.
- **Cleared on**: logout, going offline, character load/login, death, class change, respec, stat reset.
- **Out-of-combat regen** continues, regenerating against your shrunken usable pool. Reserved CP is not regenerated "into" because it's locked.

## Cleanup model (no offline persistence)

Single authoritative rule: **`reserved_buffs` is wiped to `{}` on character load.**

- On every character fetch at login / character-select → game-entry, the `load_character` path clears `reserved_buffs` server-side before returning the row. This handles logout, browser close, network drop, crashes, and any "did they really log out" ambiguity in one place.
- On `death` resolution in combat-tick / kill-resolver → also wipe `reserved_buffs`.
- On `respec`, `class change`, `stat reset` RPCs → also wipe.

There is no separate "presence-based" cleanup; the load-time wipe is the safety net.

## UI

The CP bar already supports a `reservedCp` overlay (used today for in-flight queued ability cost). We extend it with a **second** overlay segment so the player can distinguish:

```text
[████████░░░▓▓▒░░░]  35 / 60   (15 reserved by stances, 3 queued)
 usable    stance queued empty
```

- `displayedCp` = `raw − stanceReserved − queuedReserved`
- Stance segment: subtle gold/parchment shade
- Queued segment: existing in-flight shade
- Hover tooltip on the CP bar lists each active stance + its reserved amount.

Stance ability buttons:
- **Inactive**: shows "Reserves X CP while active." Disabled if activation would push usable CP below zero, with tooltip "Need Y more available CP".
- **Active**: highlighted with a glow + tooltip **"Drop stance. Reserved CP is not refunded."**
- Confirm-on-click is not required, but the destructive tooltip must be present so players understand the cost.

Combat log:
- Activation: `🔥 Ignite stance held — 12 CP reserved.`
- Drop: `🔥 Ignite dropped — 12 CP forfeit.`
- Login wipe: `Your stances faded while you were away.` (only if any were cleared)

## Server authority

Server is the sole owner of `reserved_buffs`. Client only previews. All affordability checks (abilities, CP-cost autoattacks, server regen clamps) compare against `cp − sum(reserved_buffs)`.

New character column:

```sql
alter table public.characters
  add column reserved_buffs jsonb not null default '{}'::jsonb;
```

Shape:

```json
{
  "ignite":      { "tier": 3, "reserved": 12, "activated_at": 1714560000000 },
  "holy_shield": { "tier": 1, "reserved": 6,  "activated_at": 1714560050000 }
}
```

Two RPCs (both `SECURITY DEFINER`, `set search_path = public`):

- `activate_stance(character_id, stance_key, tier)` — validates ownership, mutual-exclusion (ignite/envenom), affordability against `cp − current reserved`, computes reservation, writes to `reserved_buffs`. Returns updated character row.
- `drop_stance(character_id, stance_key)` — removes the entry. Does **not** refund CP. Returns updated character row.

Both broadcast a `buff_sync` event over the existing channel so other tabs and party members refresh.

A third helper (or extension of the existing character-load path) ensures the **login wipe**:
- Update the existing `load_character` / character-select fetch path to set `reserved_buffs = '{}'::jsonb` and return the cleaned row in one statement.
- If no centralized RPC exists today, add `clear_stances_on_load(character_id)` and call it from the client immediately on character load before the game initializes.

## combat-tick integration

At member-state hydration, `combat-tick` reads `characters.reserved_buffs` and seeds `member_buffs` so the existing engines keep working unchanged:

| `reserved_buffs` key | Seeds in `mb` |
|----------------------|---------------|
| `eagle_eye` | `crit_buff = { bonus: <stat-derived> }` |
| `force_shield` | `absorb_buff = { shield_hp: <stat-derived> }` (re-seeded each tick to its full value while held) |
| `holy_shield` | `holy_shield = { wis_mod, expires_at: now+1tick }` |
| `arcane_surge` | `damage_buff = true` |
| `battle_cry` | `battle_cry_dr = { reduction, crit_reduction }` |
| `ignite` | `ignite_buff = true` |
| `envenom` | `poison_buff = true` |

For these specific keys, the existing `expires_at` short-circuits in combat-tick are bypassed — presence in `reserved_buffs` means "active." Force Shield's per-tick re-seed becomes an effectively permanent shield while reserved, which matches the stance fantasy.

CP spending in combat-tick switches all `mCp[id] >= cost` checks to `(mCp[id] - sumReserved(id)) >= cost`. Server-side regen clamps clamp against `max_cp` as before — the reservation is a *spend* limit, not a *cap* limit, so natural regen continues to fill up to `max_cp`.

## Files touched

- `supabase/migrations/<new>.sql` — add `reserved_buffs` column, two RPCs, optional `clear_stances_on_load`.
- `supabase/functions/_shared/formulas/resources.ts` — add `sumReservedCp(reservedBuffs)` and `getAvailableCp(rawCp, reservedTotal, queued?)`.
- `supabase/functions/combat-tick/index.ts` — hydrate `member_buffs` from `reserved_buffs`; switch CP checks to use available CP; clear `reserved_buffs` on death.
- `supabase/functions/combat-catchup/index.ts` — same hydration so offline-catchup math is consistent.
- `supabase/functions/_shared/kill-resolver.ts` — wipe `reserved_buffs` on player death.
- `src/features/character/hooks/useCharacter.ts` — on first character load after login, call the clear RPC (or rely on the cleaned row from `load_character`).
- `src/features/combat/utils/cp-display.ts` — extend `CpDisplay` with `stanceReservedCp` separate from `queuedReservedCp`; add second overlay segment.
- `src/features/combat/hooks/useCombatActions.ts` — replace timed-buff branches for the six stance abilities with `activate_stance`/`drop_stance` calls. Re-click toggles. Remove the per-cast `cpCost` deduction for stances (cost = reservation, applied by RPC).
- `src/features/combat/utils/class-abilities.ts` — add `stance: true` and `tierReservePct` to the six entries; rewrite descriptions.
- `src/features/combat/hooks/useBuffState.ts` — derive ignite/poison/absorb/holyShield/critBuff/damageBuff/battleCry "active" flags from `character.reserved_buffs` rather than local `expiresAt`. Remove client expiry timers for those.
- `src/features/character/components/StatusBarsStrip.tsx` — render the stance segment of the CP bar and tooltip.
- `src/features/combat/components/EventLogPanel.tsx` — log activation/drop/login-wipe lines.
- `src/components/admin/GameManual.tsx` — rewrite the buff section: stances vs tactical buffs, reservation rules, no-refund warning, no-offline-persistence note.
- Tests:
  - `src/features/combat/utils/__tests__/cp-display.test.ts` — extend for stance + queued overlays.
  - New `src/features/combat/utils/__tests__/stance-affordability.test.ts` — stack/unstack stances, blocked activation, drop forfeits CP, ignite/envenom mutual exclusion.
  - `src/shared/formulas/__tests__/formula-parity.test.ts` — `sumReservedCp` / `getAvailableCp` parity with the server copy.
- Memory:
  - Update `mem://game/class-abilities/commitment-buffs` (Ignite/Envenom are now stances, not 5-min timed buffs).
  - Add new `mem://game/class-abilities/stance-system` describing the full stance table, no-refund rule, and login-wipe rule.

## What this plan does NOT change

- Combat formulas, damage pipeline, hit-quality bands, autoattack math.
- Short tactical buff durations and cooldowns.
- Cloak of Shadows — stays as the existing 50% dodge timed buff.
- Ability damage formulas.
- CP regen rules (rate, in-combat reduction, max cap).
- Death penalties, respawn behavior.
- Movement, party, teleport systems.
- HP authority — combat-tick remains the sole writer of HP/CP/MP during combat.

## Success criteria

- A player can hold meaningful long-term stances during an online session without rebuffing.
- A player cannot drop-and-rebuy a stance to magic CP back into existence.
- Logging out and back in reliably ends with `reserved_buffs = {}` and full available CP up to `max_cp`.
- Cloak of Shadows still feels like a tactical rogue cooldown, not a tank stance.
- Stacking two T2/T3 stances visibly reduces the usable bar by ~30–35% with both segments shown distinctly.
