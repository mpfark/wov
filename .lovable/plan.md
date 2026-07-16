# M2 — Delta Creature-HP RPCs (Feature-Flagged)

Goal: route creature HP mutations through encounter-owned delta RPCs while keeping the legacy `damage_creature` path fully intact behind an exclusive flag. No character-HP changes yet (that is M4). No client changes. No behavior change when flag is off.

## 1. Scope

In scope:
- New SQL: `encounter_apply_damage`, `encounter_apply_heal`, `encounter_apply_damage_dry_run` (parity harness).
- Attach-on-first-hit inside the RPC (idempotent via `encounter_ensure_for_creature`).
- Kill-path detach in the same transaction as the killing delta.
- Rewrite of `writeCreatureState` in `supabase/functions/_shared/combat-resolver.ts` to compute per-creature deltas from its invocation snapshot and dispatch through the encounter path when the flag is on.
- Feature flag plumbing (env var, read once per tick in `combat-tick` and `combat-catchup`).
- Vitest parity harness for the two-parties-same-creature race.

Out of scope (deferred to later milestones):
- Character HP writes (M4).
- Client `useEncounter` subscription (M5).
- Cast lifecycle / boss abilities (M6).
- Removal of legacy `damage_creature` (M7).
- Effect tick or reward math moving into PL/pgSQL.

## 2. Feature Flag

Exclusive, server-only, read once per invocation:

- Env var: `ENCOUNTER_HP_WRITES` = `off` (default) | `on`.
- Read at the top of the tick handler into a local `useEncounterHpWrites: boolean`.
- Passed as a parameter into `writeCreatureState(db, creatures, cHp, cKilled, { useEncounter, nodeId })`.
- Never both paths in the same tick. When on, legacy `damage_creature` is not called for HP mutations. When off, encounter RPCs are not called.
- Rollout: off in prod → shadow parity tests → on for a single test node via a temporary `nodeId` allowlist env (`ENCOUNTER_HP_WRITES_NODE_IDS`, comma-separated) → global on → M3 begins.

## 3. SQL — New RPCs

All RPCs: `SECURITY DEFINER`, `SET search_path = public`, take `pg_advisory_xact_lock(encounter_lock_key(_encounter_id))`, all writes inside one transaction.

### 3.1 `encounter_apply_damage`

```
encounter_apply_damage(
  _creature_id uuid,
  _amount int,          -- always positive; damage
  _source_character_id uuid,
  _source_kind text     -- 'autoattack' | 'ability' | 'dot' | 'proc'
) RETURNS TABLE (
  encounter_id uuid,
  new_hp int,
  old_hp int,
  caused_kill boolean,
  turned_aggressive boolean
)
```

Steps (single transaction):
1. `encounter_id := encounter_ensure_for_creature(_creature_id)` — idempotent; creates the `default` encounter and inserts the `encounter_creatures` row on first hit.
2. Advisory lock on `encounter_lock_key(encounter_id)`.
3. `UPDATE creatures SET hp = GREATEST(hp - _amount, 0), is_aggressive = TRUE WHERE id = _creature_id AND is_alive = TRUE RETURNING hp AS new_hp, (hp + _amount) AS old_hp, (NOT is_aggressive) AS turned_aggressive_prev` — clamp at 0, transitions read from RETURNING.
4. If `new_hp = 0`: `UPDATE creatures SET is_alive = FALSE, ... WHERE id = _creature_id`; `caused_kill := TRUE`; `DELETE FROM encounter_creatures WHERE creature_id = _creature_id` (frees the `UNIQUE (creature_id)` slot for respawn — kill-resolver runs in TS after the RPC returns and does not need this row).
5. Upsert `encounter_contributions` (increment `damage_dealt`, set `first_hit_at`/`last_hit_at`).
6. Return the row.

### 3.2 `encounter_apply_heal`

Symmetric, positive `_amount`, no kill path, clamps at `max_hp`. Does not upsert contributions (no healing target for creatures in M2; kept for symmetry).

### 3.3 `encounter_apply_damage_dry_run`

Same signature as `encounter_apply_damage` but read-only:
- Computes the would-be `new_hp`, `caused_kill`, `turned_aggressive` from current DB state without any writes.
- Used by the parity harness to compare against the legacy `damage_creature` outcome. Never invoked in production.

### 3.4 `damage_creature` — unchanged

Left in place. Not deprecated in M2. M7 removes it once callers are migrated.

## 4. TypeScript — `writeCreatureState` rewrite

File: `supabase/functions/_shared/combat-resolver.ts` (lines 447–468 today).

New signature:

```ts
writeCreatureState(
  db, creatures, cHp, cKilled,
  opts: { useEncounter: boolean; sourceCharacterId: string; sourceKind: 'autoattack'|'ability'|'dot'|'proc' }
)
```

Behavior when `opts.useEncounter === false` — unchanged from today (legacy `damage_creature` + bulk `is_aggressive` update).

Behavior when `opts.useEncounter === true`:
1. For each creature in the invocation snapshot: `delta := cr.hp - (cKilled.has(cr.id) ? 0 : cHp[cr.id])`. Skip if `delta <= 0` and not killed. Negative deltas (healing) are not produced by current tick logic; assert and skip.
2. Dispatch `db.rpc('encounter_apply_damage', { _creature_id: cr.id, _amount: delta, _source_character_id, _source_kind })` in parallel via `Promise.all`.
3. Do not send `is_aggressive` writes from TS — the RPC handles it.
4. `cKilled` remains the tick's local kill set; the RPC's `caused_kill` is the authoritative truth. Log and drop the (extremely rare) case where they disagree — this only happens if another writer killed the creature between snapshot and delta apply, and the correct behavior is to accept the DB outcome.

Callers passing `sourceKind`:
- Autoattack path in `combat-tick`: `'autoattack'`, `sourceCharacterId = member.character_id`.
- Ability path: `'ability'`.
- DoT tick path (also used by `combat-catchup`): `'dot'`, `sourceCharacterId = eff.source_id`.
- Proc-on-hit path: `'proc'`, `sourceCharacterId = member.character_id`.

Note: `writeCreatureState` today is called once per tick with an aggregate `cHp` map. In M2 we keep that shape but tag the *entire batch* with a dominant `sourceKind`. Per-hit attribution granularity is a M8 concern; contributions in M2 are coarse (aggregate damage per tick per attacker) and that's fine for the ledger role we've defined.

## 5. Exact code touchpoints

### 5.1 `supabase/functions/combat-tick/index.ts`
- Top of handler (near existing env reads): add
  ```ts
  const useEncounterHpWrites = readEncounterFlag(node_id);
  ```
  `readEncounterFlag` is a small helper in `_shared/` that returns `ENCOUNTER_HP_WRITES === 'on'` AND (`ENCOUNTER_HP_WRITES_NODE_IDS` empty OR includes `node_id`).
- Line 2174 (`writeCreatureState(db, creatures, cHp, cKilled)`) becomes:
  ```ts
  writeCreatureState(db, creatures, cHp, cKilled, {
    useEncounter: useEncounterHpWrites,
    sourceCharacterId: session.character_id, // leader for party ticks
    sourceKind: 'autoattack',                // dominant; DoT-only ticks pass 'dot'
  }),
  ```
  If the tick processed only DoT damage (no autoattack/ability writes this tick), pass `'dot'`. This is trivially derivable from whether autoattack/ability code ran; a boolean tracked next to `cHp`.
- No other lines in `combat-tick` change in M2. `mHp`, effect processing, kill resolution, reward math, broadcasts — all unchanged.

### 5.2 `supabase/functions/combat-catchup/index.ts`
- Same env read at the top.
- Same signature change at the `writeCreatureState` call site (`sourceKind: 'dot'`, `sourceCharacterId = session.character_id`).
- No other changes.

### 5.3 `supabase/functions/_shared/combat-resolver.ts`
- Extend `writeCreatureState` as in §4. Keep the legacy branch verbatim.

### 5.4 `combat_sessions` table
- No schema change. `engaged_creature_ids` stays exactly as-is. The session tick still owns membership, cooldowns, mHp, and the autoattack/ability roll logic. Only the final HP write is rerouted.
- No new columns on `combat_sessions` in M2. (`encounter_id` on the session is deferred; encounter identity is derivable from `encounter_creatures` when needed.)

## 6. Parity harness (Vitest, run in CI)

New file: `src/test/combat/encounter-hp-parity.test.ts` (client-side unit test using a mocked db shim mirroring the pg RPC contracts).

Cases:
1. **Single-writer damage** — legacy `damage_creature(new_hp = old - X)` and `encounter_apply_damage(amount = X)` produce identical `new_hp`, `caused_kill`.
2. **Two-parties-same-creature race** — two ticks compute cHp against `hp=100`, each intending to apply `20` damage. Legacy path (both call `damage_creature(new_hp=80)`) results in `hp=80` (lost update). Encounter path applies both deltas → `hp=60`. Test asserts encounter path preserves total damage.
3. **Kill transition** — final blow returns `caused_kill=true` exactly once even when two callers cross zero simultaneously.
4. **Overheal clamp** on `encounter_apply_heal`.
5. **Detach on kill** — after `caused_kill`, `encounter_creatures` row is gone and a subsequent `encounter_ensure_for_creature` on the respawned creature id succeeds without unique violation.

Additionally, an integration script (Deno, `scripts/encounter-parity-shadow.ts`, not wired into CI) that iterates recent live ticks against `encounter_apply_damage_dry_run` and reports any divergence >0 HP. Used only during the shadow window.

## 7. Rollout / rollback

1. Ship SQL + code with flag `off`. Assert no production behavior change.
2. Enable dry-run shadow script on a scratch node for 24 hours. Confirm zero divergence.
3. Add test node id to `ENCOUNTER_HP_WRITES_NODE_IDS`. Play through a party fight + DoT wakeup + respawn. Confirm no stuck aggressive flags, no orphaned `encounter_creatures` rows, no lost damage.
4. Remove the allowlist (global on).
5. Rollback = set env `ENCOUNTER_HP_WRITES=off`. No data migration needed; `encounter_creatures` rows are harmless when the flag is off (nothing reads them yet).

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Lost update between snapshot and delta apply | Delta-only + advisory lock inside the RPC |
| Orphaned `encounter_creatures` row blocks respawn | Kill path deletes the row in the same transaction as the killing UPDATE |
| Aggression flag drift when RPC vs bulk update disagree | Only the RPC writes `is_aggressive` when the flag is on; bulk update is skipped |
| Contribution over-counting on retry | `encounter_apply_damage` is not idempotent by design; combat-tick already dedupes ticks by session cooldown, so retries are rare. Accepted for M2; revisit if metrics show drift. |
| Flag misconfig runs both paths | Exclusive branch in `writeCreatureState` — structurally impossible to hit both in one call |

## 9. Deliverables Checklist

- [ ] Migration: `encounter_apply_damage`, `encounter_apply_heal`, `encounter_apply_damage_dry_run`
- [ ] `_shared/combat-resolver.ts` — extended `writeCreatureState`
- [ ] `_shared/encounter-flag.ts` — `readEncounterFlag(nodeId)`
- [ ] `combat-tick/index.ts` — flag read + call-site update
- [ ] `combat-catchup/index.ts` — flag read + call-site update
- [ ] `src/test/combat/encounter-hp-parity.test.ts`
- [ ] `scripts/encounter-parity-shadow.ts` (shadow-only, not CI-wired)
- [ ] Env vars documented in project README section for backend env
- [ ] `.lovable/plan.md` M2 row marked done after rollout

## 10. Definition of Done

- Flag off: prod behavior byte-identical to today (verified by shadow script over 24h).
- Flag on: two-parties-same-creature race test passes; live party fight + solo DoT wakeup + respawn all behave correctly on the test node.
- No new client code shipped.
- No changes to `damage_creature`, `combat_sessions` schema, kill-resolver, or reward math.
