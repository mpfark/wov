# Boss cast damage + solo kill grace

Investigation of Calikon vs. Aureth turned up two real bugs plus one confirmation.

## Findings

**1. Cast damage varies too wildly (56 / 86) — Stored Power cap is not enforced.**

The `boss_cast.stored_power.cap` (Aureth = 111) is only used to compute the client's *visual max* for the fill bar. The server never writes that number into `encounters.stored_power_cap`, so `encounter_stored_power_add` clamps against a NULL cap — i.e. no cap. The pool can grow well past 111, and `primary_dmg = round(used * 0.45)` can produce numbers like 56 and 86 that "shouldn't be possible" with cap 111 (max primary should be ~50).

**2. Cast damage does NOT scale with player-vs-boss level gap — and per your answer, we keep it that way.** No change required, but I'll add a code comment so this stays intentional.

**3. Solo character got no XP/RP from Aureth's kill.**

`combat-tick` has a 3-second "just-left-the-node" grace window that keeps you eligible for a kill's XP/RP/salvage even if you moved a second before the boss died. Today that grace only runs inside `if (party_id) { ... }`, so a solo character who steps off the node right before the killing tick gets nothing. Loot still drops on the node (that's independent of recipients), which matches exactly what you saw.

## Changes

### A. Enforce Stored Power cap server-side
`supabase/functions/combat-tick/index.ts` — at cast start (around line 2213, right after `encounter_boss_start_cast` succeeds): write the configured `cfg.stored_power?.cap` onto the encounter row via a small RPC (see below), and clear it back to NULL on resolve.

New migration adds:
- `encounter_stored_power_set_cap(_encounter_id uuid, _cap int)` — sets `encounters.stored_power_cap` to the passed value (or NULL), also clamps existing `stored_power` down to the new cap. `SECURITY DEFINER`, `search_path = public`, granted to `service_role`.
- `encounter_boss_resolve_cast` gets a one-line addition: after consumption, set `stored_power_cap = NULL` so a subsequent (uncapped) legacy cast on the same encounter isn't accidentally throttled.

Result: with Aureth cap = 111, primary_dmg is deterministically bounded to `base_amount + round(111 * 0.45) = 50`, aoe_dmg to `round(111 * 0.75) = 83`. Cast start also resets `stored_power` to 0 to guarantee a fresh channel (defensive — should already be 0 after a prior `all` consume).

### B. Extend the 3s kill-grace to solo characters
`supabase/functions/combat-tick/index.ts` around lines 434-445: lift the `if (party_id)` gate. The `recent_member_ids` map on the session is already populated for solo sessions (the leader-broadcast path is a no-op for solo, but the recent-at-node timestamp is written by the same code path). Only requirement is `now - last_at_node_ms <= KILL_GRACE_MS` and `ch.hp > 0`.

Also add a small comment noting that cast damage is intentionally flat (no level scaling) per this decision.

### C. No UI changes
Cast bar / glow behaviour is unchanged. Visual max already uses the cap correctly, so the client display stays identical — only the server-side pool now respects it.

## Verification

- Re-query Aureth (and one non-capped boss for comparison) after the change; fight to a cast and confirm resolved damage lines never exceed the configured cap × share + base.
- Simulate a solo leave-then-kill: start combat with a boss at ~5% HP, walk off, let bleed/ally finish it within 3s → confirm the leaving character receives XP/RP in the tick response's `member_states`.
- `combat_audit_log` traces for the traced character should show the same reward line as before but now populated for solo departures.

## Technical details (out-of-scope reference)

- Files touched:
  - `supabase/functions/combat-tick/index.ts` (kill-grace gate + cap set/clear + comment)
  - New migration: `encounter_stored_power_set_cap` + `encounter_boss_resolve_cast` amend
- No client changes; no schema changes beyond the new RPC.
- Grace still requires `ch.hp > 0`, so dead-and-released characters don't get free kills.
