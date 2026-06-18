# Fix: Non-aggressive creatures stay flagged "aggressive" after combat

## What's happening

Yes — the creature itself gets flipped to aggressive by combat, not by how we engage it. The culprit is the `damage_creature` SQL RPC. Every non-lethal damage tick runs:

```sql
UPDATE creatures SET hp = _new_hp, is_aggressive = true WHERE id = _creature_id;
```

It unconditionally sets `is_aggressive = true` on any hit. The kill branch only writes `hp = 0, is_alive = false` and never resets the flag. The only place `is_aggressive` is restored to its baseline (`base_aggressive`) is inside `respawn_creatures()`.

So for King Aldric (created with `base_aggressive = false`, likely no/long respawn as a unique boss):
1. First hit → DB sets `is_aggressive = true`
2. Kill tick → leaves the flag `true`
3. Admin Creature panel reads the live row → shows the ⚔️ icon

The client-side "You start attacking …" log is just text; it doesn't write state.

## Fix

Two small changes, both server-side, no UI work.

### 1. Migration: stop damage from persisting an aggression flip; reset on kill

Rewrite `public.damage_creature` so:
- Non-lethal branch updates `hp` only. Aggro is already handled live in `combat-tick` via `useCombatAggroEffects` / engagement logic — we don't need to persist a permanent flag just because a creature took a hit.
- Kill branch additionally resets `is_aggressive = base_aggressive` so the corpse/respawn-pending row reflects the designer's baseline.

```sql
CREATE OR REPLACE FUNCTION public.damage_creature(
  _creature_id uuid, _new_hp integer, _killed boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _killed THEN
    UPDATE creatures
       SET hp = 0,
           is_alive = false,
           died_at = now(),
           is_aggressive = base_aggressive
     WHERE id = _creature_id;
  ELSE
    UPDATE creatures
       SET hp = _new_hp
     WHERE id = _creature_id;
  END IF;
END;
$$;
```

### 2. One-time data cleanup

For existing rows that were corrupted by the old behavior (King Aldric and any other named/unique creatures that got stuck aggressive), reset to baseline:

```sql
UPDATE public.creatures
   SET is_aggressive = base_aggressive
 WHERE is_aggressive <> base_aggressive;
```

(Safe — `base_aggressive` was seeded from `is_aggressive` at the time that column was added, and is the designer-authored truth thereafter.)

## Why this is safe

- Live aggro behavior during a fight is driven by the in-memory `is_aggressive` value `combat-tick` already loaded, plus `useCombatAggroEffects` (initial / mid-fight / re-engage). It doesn't depend on persisting `true` back to the DB mid-fight.
- `respawn_creatures()` still resets to `base_aggressive` on respawn — unchanged.
- Admin Creature panel will now reflect the designer's intent for dead/respawning creatures.

## Out of scope

- No changes to `useCombatAggroEffects`, `combat-tick` engagement logic, client UI, or the `base_aggressive` column.
- No rename or schema additions.

## Verification

1. Apply migration.
2. Confirm King Aldric: `SELECT name, is_aggressive, base_aggressive, is_alive FROM creatures WHERE name ILIKE '%aldric%';` → `is_aggressive = false`.
3. Spawn/find a non-aggressive creature, hit it once (don't kill), check DB row → `is_aggressive` stays `false`. Admin panel no longer shows ⚔️.
4. Kill an aggressive (base_aggressive=true) creature → row shows `is_aggressive = true` (matches baseline), then after respawn still `true`. ✓
5. Kill a non-aggressive creature → row shows `is_aggressive = false`. ✓
