# M3 — Character Resource Authority (Feature-Flagged)

Creature HP writes now go through `encounter_apply_damage` globally (`ENCOUNTER_HP_WRITES=on`). M3 does the same for **character** HP/CP/MP so that all in-combat resource mutations are atomic, delta-based, and encounter-scoped — closing the last lost-update surface in party combat.

## 1. Scope

In scope
- New RPCs: `encounter_apply_character_damage`, `encounter_apply_character_heal`, `encounter_apply_character_resource` (CP/MP spend + regen).
- Delta semantics under `pg_advisory_xact_lock(encounter_lock_key(encounter_id))`, clamped to `[0, max_*]`.
- Encounter attach on first character write (mirrors creature attach), participant upsert.
- Rewrite of character-resource writes in `combat-tick` (autoattack damage taken, ability CP/MP spend, class regen ticks, hp-drain procs, force-shield damage-absorb).
- New flag `ENCOUNTER_CHAR_WRITES` = `off | shadow | on` with the same rollout model as M2.
- Client-side write suppression during combat is already in place (see memory index — "HP Authority"). Confirm and extend it so client PATCHes of `characters.hp/cp/mp` are blocked whenever the combat driver is engaged, regardless of flag state.
- Parity harness extension: two-writer character-HP race, DoT + heal interleave, overkill clamp, dead-target no-op.

Out of scope
- Cast lifecycle / telegraphed boss abilities (M6).
- Removing legacy character PATCH writes from non-combat paths (rest, level-up, teleport cost).
- Removing legacy `damage_creature` (M7).
- Effect ticks or reward math moving into PL/pgSQL.

## 2. Flag

`ENCOUNTER_CHAR_WRITES` — server-only, read once per tick invocation.
- `off` (default): character resources continue to be written via the existing PATCH/UPDATE path.
- `shadow`: legacy path is authoritative; RPC dry-run runs in parallel and any HP/CP/MP divergence is logged as `[encounter-char-shadow] divergence …`.
- `on`: RPCs are authoritative; legacy PATCH path is skipped.

Rollout: off → shadow (≥ 15 min real play across solo, party, DoT, death, revive, class regen) → on (global) → M4 planning.

## 3. SQL — new RPCs

All `SECURITY DEFINER`, `SET search_path = public`, single transaction, `pg_advisory_xact_lock(encounter_lock_key(encounter_id))`.

```
encounter_apply_character_damage(
  _character_id uuid,
  _amount int,             -- positive
  _source_kind text,       -- 'creature' | 'dot' | 'proc' | 'environment'
  _source_creature_id uuid -- nullable
) RETURNS TABLE (encounter_id uuid, new_hp int, old_hp int, caused_death boolean)

encounter_apply_character_heal(
  _character_id uuid,
  _amount int,
  _source_kind text        -- 'regen' | 'potion' | 'ability' | 'lifesteal'
) RETURNS TABLE (encounter_id uuid, new_hp int, old_hp int, hit_max boolean)

encounter_apply_character_resource(
  _character_id uuid,
  _resource text,          -- 'cp' | 'mp'
  _delta int,              -- signed; negative = spend, positive = regen
  _source_kind text
) RETURNS TABLE (encounter_id uuid, new_value int, old_value int, hit_max boolean, hit_zero boolean)
```

Behavior
- Attach the character to the current node's encounter (`encounter_ensure_for_node`) and upsert `encounter_participants` on first write.
- Damage clamps at 0 and sets `caused_death := TRUE` on the crossing edge only. Death write also clears `active_effects` for the character (mirrors current tick logic) inside the same transaction.
- Heal clamps at `max_hp` from `characters` row (read within the lock).
- Resource RPC handles both directions; `hit_zero` flag lets callers block ability casts atomically ("insufficient CP" is now server-truth).

Dry-run twin for each RPC (`*_dry_run`) — read-only, used by shadow-mode divergence logger.

## 4. TypeScript touchpoints

`supabase/functions/combat-tick/index.ts`
- Replace direct `characters` UPDATEs for HP/CP/MP with `writeCharacterResource(db, characterId, {hp?, cp?, mp?}, meta)` helper.
- Helper reads `ENCOUNTER_CHAR_WRITES` once per invocation (passed down) and dispatches: legacy PATCH, shadow (PATCH + dry-run + diff log), or RPC-only.
- Class regen tick, autoattack damage taken, ability CP/MP spend, HP-drain proc, and force-shield damage-absorb are the five call sites.

`supabase/functions/combat-catchup/index.ts`
- Same helper; offscreen DoT damage to characters (party members standing on the node with an active bleed) routes through `encounter_apply_character_damage` with `_source_kind = 'dot'`.

`supabase/functions/_shared/encounter-flag.ts`
- Add `getEncounterCharWritesMode()` mirroring existing `getEncounterHpWritesMode()`.

Client
- Audit `useCharacter`, `useCombatDriver`, and force-shield regen paths to confirm no client-side HP/CP/MP PATCH fires while `combatEngaged === true`. Any offender is either removed or gated behind `!combatEngaged`.

## 5. Parity harness extension

`encounter-parity-check` gains four scenarios, snapshot/restore around a real character row (admin-selectable):
1. `char_solo` — one hit, legacy vs delta HP match.
2. `char_party_race` — two simultaneous damage sources on the same character, delta preserves both.
3. `char_dot_heal_interleave` — DoT tick + potion heal in the same tick window; final HP matches sum of deltas.
4. `char_death_clamp` — overkill clamps at 0, `caused_death = true`, second call is a no-op.

Restore restores hp/cp/mp/active_effects and removes any test-only participant row.

## 6. Rollout checklist

1. Ship SQL + helper + parity extension, flag `off`. Prod behavior unchanged.
2. Flip `shadow`. Play the five call sites. Query `function_edge_logs` for `[encounter-char-shadow] divergence`. Zero divergences for ≥ 15 minutes = ready.
3. Flip `on`. Watch a live party fight for a few minutes for anomalies.
4. Declare M3 done and start M4 (participant lifecycle: presence, disengage, node departure) planning.

## Technical notes

- Character death currently triggers side effects in TS (buff clear, boss-hunter/party reward suppression). Those stay in TS; the RPC only reports `caused_death` so the caller decides.
- `force_shield_hp` is a wizard-only column that already regenerates via `apply_force_shield_regen` RPC — leave it out of M3; it will be folded into a later "wizard resources" pass.
- `sync_character_resources` (cap enforcement on gear/level change) is untouched; it writes absolute values outside combat and remains the correct authority for max-value changes.
- Character participants get their own `encounter_lock_key` bucket via the shared encounter id, so a party fight serializes all character + creature writes on one lock — this is intentional and matches the M2 model.
