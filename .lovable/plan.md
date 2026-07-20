## Root cause of the "cast starts but never lands" bug

Every telegraph resolution has been failing silently. Edge function logs confirm it:

```
[boss-cast] resolve failed 7f3bdda7-… column ep.left_at does not exist
```

The `encounter_boss_resolve_cast` SQL function filters `encounter_participants ep` on `ep.left_at IS NULL`, but that table only has `encounter_id, character_id, joined_at, last_action_at` — there is no `left_at` column. So every resolve attempt errors, no damage/lock/broadcast is applied, and the cast row stays with `resolved_at = NULL` forever. That matches what's in the DB right now: 8 open cast rows going back two days (Khar-Zul, Ithrak, Thrum, Rot-King, Rell Vane, Maelor, Aelthir, Ser Caldris), zero `boss_cast_hit` entries in the audit log. Not specific to Cithrawiel / Calikon — it's every boss, every player.

Note: your two names came through as `cithrawiel` and `calikon`; the character on file is `Cithrawiel` and I couldn't find `Calikon`. Same fix applies regardless — this is systemic.

## Fix plan

### 1. Repair the resolve RPC (migration)

Rewrite `public.encounter_boss_resolve_cast` to select participants using the columns that actually exist. Replace the `ep.left_at IS NULL` filter with the presence check we really want: character is still in the encounter and still on the node.

```sql
FROM public.encounter_participants ep
JOIN public.characters c ON c.id = ep.character_id
WHERE ep.encounter_id = v_enc
  AND c.current_node_id = v_node
  AND c.hp > 0
```

Everything else in the function stays the same (advisory lock, `resolved_at = now()`, optional `movement_locked_until`, damage via `encounter_apply_character_damage`).

### 2. Clean up the 8 stranded cast rows

One-shot data update in the same migration: mark all currently-unresolved cast rows as `resolved_at = now()` so they don't get picked up and "resolve into the past" the next time each boss's node ticks.

### 3. Redeploy `combat-tick`

No code change needed there — the JS already calls the RPC correctly. Just needs a redeploy to make sure it's on the current bundle after the migration lands.

### 4. Replace the cast progress bar with a glow

Right now `BossCastTelegraph` renders a second bar under the HP bar. You want the creature's existing HP bar to glow instead while a telegraph is active.

- Delete `src/features/world/components/BossCastTelegraph.tsx` and its import in `NodeView.tsx`.
- In the creature row in `NodeView.tsx` (around lines 388–426), when `activeCast` is set:
  - Add a pulsing destructive-colored ring/glow around the HP bar container (`ring-2 ring-destructive/70 shadow-[0_0_12px_hsl(var(--destructive)/0.6)] animate-pulse`).
  - Keep a compact inline tag above/right of the HP bar: `☄️ Cataclysm · 3.2s · FLEE` — emoji, label, live countdown, and the "flee" hint. No progress bar.
  - Countdown ticks via a lightweight `useEffect` + `requestAnimationFrame` (same pattern the current component used) but only updates the seconds text, not a width.

The `useBossCasts` hook and its `activeCast` shape are unchanged.

## Verification

- After migration + redeploy: enter combat with any configured boss, wait for a telegraph. Expect a `boss_cast_hit` event in the combat log, `resolved_at` populated on the cast row, and `movement_locked_until` bumped if the boss has `lock_ms > 0`.
- Visually: HP bar glows red and shows `emoji label · Xs · FLEE` while the cast is in flight; glow disappears the moment the cast resolves or the player leaves the node.
- Check edge-function logs: no more `column ep.left_at does not exist`.

## Out of scope

- No changes to boss cast tuning (amounts, chances, cooldowns) or to the admin editor.
- No changes to combat balance or to how movement lock is computed.
