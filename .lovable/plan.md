## Problem

Force Shield currently does not regen during combat (good), but it instantly snaps to full when the next combat starts because the combat session resets `member_buffs` to `{}` and reseeds the shield at cap. The user wants the opposite: depleted shield should **stay depleted when combat ends**, then **gradually regenerate while out of combat**, so jumping into the next fight too soon means a partially-charged ward.

## Approach

Persist the Force Shield's current HP on the character row (not just in the transient combat session) so it survives between fights, and tick it up gradually while the player is out of combat.

### Storage

Add a small JSONB field on `characters` to hold the live shield value for stance-based wards:

```
characters.stance_state jsonb default '{}'::jsonb
  -> { force_shield_hp: number, force_shield_updated_at: timestamptz }
```

This avoids polluting `reserved_buffs` (which is keyed by stance metadata) and gives us a clean place for future stance-persistent values.

### Server logic

1. **`combat-tick`** (in-combat behavior):
   - On the first tick where `mb.absorb_buff` is undefined, hydrate it from `characters.stance_state.force_shield_hp` (clamped to current cap), instead of seeding to full cap. If no persisted value exists, seed to cap (first-time activation).
   - No regen during combat (already correct).
   - When combat ends / session is wiped, persist the final `mb.absorb_buff.shield_hp` back to `characters.stance_state.force_shield_hp` so OOC regen has a starting point.
   - Also persist on every tick (cheap, single column update piggy-backed on existing character writes) so disconnects mid-fight are not free full-shield resets.

2. **OOC regen** — add a Postgres function + cron, no new edge function needed:
   - Create `public.regen_force_shield()` SECURITY DEFINER (search_path=public) that:
     - Finds characters with `reserved_buffs ? 'force_shield'` AND no active combat session containing them.
     - For each, computes `cap = INT_mod + floor(level * 0.5)` and `regen = 1 + floor(INT_mod / 2)`.
     - Updates `stance_state.force_shield_hp = least(cap, coalesce(current, 0) + regen)` and stamps `force_shield_updated_at = now()`.
   - Schedule via `pg_cron` every 2 seconds (matches the in-combat tick cadence the user is already used to).
   - If pg_cron at 2s granularity is not available on the instance, fall back to computing elapsed seconds since `force_shield_updated_at` and applying the proportional regen lazily on read (in `combat-tick` hydration and in the new RPC the client polls). Prefer the cron path; lazy compute is the fallback.

### Client logic

3. **Display the persisted shield value out of combat**:
   - Extend the character payload (or add a lightweight `get_my_stance_state` RPC) to include `stance_state.force_shield_hp` so `StatusBarsStrip` / `CharacterPanel` can render the current shield HP and a fill bar (current / cap) even when the player is idle.
   - In `useCombatActions` for `absorb_buff` activation: instead of seeding `shieldHp = intMod + floor(level/2)` (full), seed from the persisted value so toggling the stance off and back on does not bypass the regen rule.
   - The existing `buff_sync` path keeps the bar live during combat; OOC the value updates from periodic character refresh (every few seconds, same channel that already updates HP/CP/MP).

### UX detail

- When the shield is at 0/cap and the player is OOC, show the bar empty (not hidden) so the regen progress is visible.
- Tooltip on the shield buff shows `current / cap` and a hint: "Regenerates 1 + INT_mod/2 HP every 2s while out of combat."

## Game Manual update

Replace the current Force Shield manual entry with text describing the new model: no in-combat regen, gradual OOC regen at `1 + floor(INT_mod / 2)` per ~2s up to `INT_mod + floor(level × 0.5)`, persisted across fights (no instant refill on next pull).

## Files touched

- `supabase/migrations/<new>.sql` — add `characters.stance_state` column, `regen_force_shield()` function, pg_cron schedule.
- `supabase/functions/combat-tick/index.ts` — hydrate `mb.absorb_buff` from `stance_state` on first tick of a session; persist back to `stance_state.force_shield_hp` on tick writes and at session wipe.
- `src/features/combat/hooks/useCombatActions.ts` — seed `setAbsorbBuff` from persisted value (not full cap) when activating the stance.
- `src/features/character/components/StatusBarsStrip.tsx` and `CharacterPanel.tsx` — render shield bar OOC from persisted value; show cap and "regenerating" hint.
- `src/integrations/supabase/types.ts` — auto-regenerated after migration.
- `src/components/admin/GameManual.tsx` — update Force Shield description.

## Memory updates

- Update the Wizard Abilities memory entry (or add a Force Shield sub-entry) to record the persistent OOC-regen model: cap formula, regen formula, no in-combat regen, persisted across fights.
