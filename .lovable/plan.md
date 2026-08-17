# Correction plan — player-facing node roster reconcile

Combat stays in maintenance. Soak stays off, allowlist empty. `combat-catchup` stays service-role-only. Nothing below is implemented yet.

## 1. Root-cause wiring map (current deployed flow)

Node entry:

```text
character.current_node_id changes (useMovementActions → preheatNode)
  → GamePage line 213: useCreatures(character.current_node_id, nodeChannel, node, handleCatchupRewards, softDeadIds, character.id)
  → useCreatures effect (line ~305): setCreatures([]) + setCreaturesLoading(true) + fetchCreatures()
  → fetchCreatures phase 1 (optimistic): prefetchCache hit, else direct read
       supabase.from('creatures').select('*').eq('node_id').eq('is_alive', true)
    fetchCreatures phase 2 (authoritative): reconcileNode(node, { characterId, force: true })
       → invokeWithRetry('combat-catchup', { node_id, character_id, force, reason })
       → 403 forbidden  ⇒ reconcileNode returns { creatures: [] }
       → setCreatures([])          ← roster wiped, Attack control never renders
  → realtime: nodeChannel handlers (onCreatureUpdate / onCreatureInsert / onCreatureDelete)
  → NodeView line 408: Attack button renders per creature in `creatures`
```

`wake_world` is not part of the roster contract: the realm-slumber gate lives on CharacterSelect ("Awaken the Realm"), the game route mounts only afterwards. But wake is asynchronous — `tick_creatures` is re-armed on wake, so at t≈0 the roster can legitimately contain corpses whose respawn is due but not yet applied. Nothing in the client distinguishes "realm still waking" from "empty node".

Server side of the refused call: `combat-catchup/index.ts` `internalCaller()` → 403 for any non-service-role JWT; the scope derivation it wraps (`public.catchup_scope_check(_user_id, _character_id, _node_id)`, SECURITY DEFINER, STABLE) is still exactly what a player-facing read needs — it verifies ownership and allows only the character's own node or a directly connected node.

### Why the client was left calling it
The catch-up hard-gate was added as a *combat authority* fix (effects-only progression must not be player-triggered). The audit at that time covered the tick/authority call sites; it did not cover the fact that `combat-catchup` was doubling as the **roster read** for node entry and the **offscreen DoT wake-up** driver. The endpoint had two responsibilities and only one of them was supposed to become internal.

### Other client call sites broken by the same gate
- `useCreatures.reconcileNode` — node entry (roster), plus adjacent-node selective wake-up (line ~356).
- `useOffscreenDotWakeup` — three player-invoked calls: delayed departure catch-up (line 140), `snapshot_only` snapshot (line 182), predicted-lethal wake-up (line 311). These are *authority* calls and must not come back as player-triggered.

### Additional finding: no internal catch-up path exists
`cron.job` has no catch-up job, and no `public.*` function references `combat-catchup` (checked via `pg_get_functiondef`). So today effects-only/offscreen progression has **no caller at all** — the player client was its only trigger. This is a second gap, tracked separately below; it must not be closed by re-opening the endpoint to players.

### What normally supplies the roster
`public.creatures` itself. RLS: `Anyone can view creatures` — `SELECT` to `authenticated`, `USING (true)`; writes admin-only. The optimistic phase-1 read already works today with a player JWT; only phase 2 fails and then overwrites phase 1 with `[]`.

### How updates reach the client afterwards
Realtime on the unified node channel: `onCreatureUpdate` (HP, `is_alive`, respawn), `onCreatureInsert` (debounced refetch), `onCreatureDelete`. Plus a 30s `fetchCreatures(true)` safety net (skips catch-up), the 150ms reconcile lock, `removeCreatureLocal` on confirmed kills, and `softDeadIds` broadcast hints.

### Every path that can currently produce `setCreatures([])`
1. `fetchCreatures` with no `nodeId`.
2. Node-change effect — intentional clear before load.
3. Phase 2 `reconcileNode` error → `{ creatures: [] }` → `setCreatures(result.creatures)`. **This is the defect.**
4. Phase 2 success with a genuinely empty node (correct).
5. Fallback direct read returning `[]`.
6. `onCreatureUpdate`/`Delete` filtering the last entry out.

## 2. Authority boundary to preserve
- `combat-catchup` remains service-role-only; its 403 for player JWTs is correct and stays.
- Effects-only/offscreen progression remains internal authority.
- The player-facing reconcile must be **read-only**: no tick claim, no effect advancement, no death, rewards, loot, casts or durability, no encounter creation (notably it must never call `encounter_for_node`, which *creates* an encounter row).
- Node scope derived/verified server-side from the authenticated caller's character, never trusted from the body.

## 3. Options

**Option A — dedicated authenticated read-only roster RPC.**
`public.node_creature_roster(_character_id uuid, _node_id uuid default null)`, SECURITY DEFINER, **STABLE** (so it physically cannot write), reusing `catchup_scope_check` for ownership + node scope, returning the roster plus a scope/staleness envelope. Grants: `EXECUTE` to `authenticated` only. Maintenance-independent (reads only). Failure = explicit error, distinguishable from empty.
Trade-off: one new interface, but it is the only option that gives a single authoritative roster source with server-derived scope and an explicit envelope.

**Option B — plain table read + internal scheduled catch-up.**
Delete the client catch-up call, keep the existing `creatures` RLS read as the only source, let a new internal cron own catch-up.
Trade-off: cheapest, no new API — but the client then trusts a client-supplied `node_id` (no ownership/scope check on the read), cannot express "scope refused" vs "empty", and freshness right after wake/node entry depends entirely on cron cadence. It cannot guarantee a complete roster at t≈0 after wake. Acceptable as a fallback layer, not as the contract.

**Option C — restore an existing player-safe reconcile contract.**
None exists. `encounter_resync_snapshot` is encounter-scoped (requires participation/grant, returns combat state, not the node roster). `encounter_snapshot_v2` and `encounter_reconcile` are internal/mutating (`encounter_reconcile` purges participants and resets sessions). So there is nothing to restore.

### Recommendation
**Option A as the contract, with Option B's plain read kept as an explicit degraded fallback** (already present as phase 1 / the 30s net). This preserves the authority split, removes the only remaining player→catch-up dependency for rosters, and gives the client the states it needs to stop wiping rosters on failure.

## 4. Recommended contract

```ts
// RPC: public.node_creature_roster(_character_id uuid, _node_id uuid | null)
{
  scope: 'own_node' | 'adjacent',
  node_id: string,              // server-derived; echo of the resolved scope
  realm_awake: boolean,         // from world_state
  respawn_pending: number,      // dead creatures at node whose respawn is due
  creatures: Array<{
    id, name, node_id, level, rarity, hp, max_hp, ac,
    is_alive, spawn_seq, is_aggressive, respawn_at, ...display fields
  }>
}
// refusals: 'not_owned' | 'no_node' | 'out_of_scope' (SQL error / typed reason, never [])
```
Only living creatures are returned; dead ones are represented solely by `respawn_pending` so the client never has to reason about corpses.

## 5. Files / functions to change

Migration (new, forward-only):
- `public.node_creature_roster(...)` — STABLE SECURITY DEFINER, `SET search_path = public`, reuses `catchup_scope_check`; `REVOKE ALL ... FROM public/anon`, `GRANT EXECUTE ... TO authenticated, service_role`.
- Optional internal catch-up scheduling (separate migration, separate approval).

Client:
- `src/features/creatures/hooks/useCreatures.ts` — replace `reconcileNode`'s `combat-catchup` invocation with the RPC; introduce `RosterOutcome = { kind: 'ok' | 'empty' | 'error' | 'unauthorized' | 'waking' | 'stale' }`; never `setCreatures([])` on non-`ok`; keep the previous roster and surface `rosterError`; keep the `fetchTokenRef`/`currentNodeIdRef` stale guards and extend them to the RPC path; single writer for `setCreatures` per fetch; adjacent-node prefetch uses the plain read only.
- `src/features/combat/hooks/useOffscreenDotWakeup.ts` — remove the three player-invoked `combat-catchup` calls (per the fully-wired policy: rewired or removed), leaving offscreen progression to internal authority.
- `src/pages/GamePage.tsx` / `src/features/world/components/NodeView.tsx` — render Attack only from a roster whose last outcome was authoritative `ok`; show loading/error state otherwise.
- `src/features/creatures/index.ts` — export the new outcome type.

## 6. Security / RLS implications
- No RLS change to `creatures` (already `SELECT` to `authenticated`).
- New RPC is the only added surface: STABLE (write-incapable), ownership-checked, scope-checked, `EXECUTE` withheld from `anon`.
- `combat-catchup` untouched. `combat_soak_access` untouched: roster reads are allowed under maintenance for everyone, while `combat_soak_access_check` continues to gate *starting* combat, so a non-allowlisted player can see creatures and still be refused a tick.

## 7. Regression coverage (all planned, none written yet)
Unit/integration: creature appears + Attack available with a player JWT; empty node → successful empty; 403/500/network failure preserves the prior roster and sets `rosterError`; scope refusal for a non-adjacent node; RPC cannot advance effects/combat (STABLE + zero-write assertion); `combat-catchup` still 403 for player JWTs; wake-then-load convergence with `respawn_pending`; rapid movement cannot apply a stale prior-node response; death removes the creature; respawn restores it with the new `spawn_seq`; realtime resubscribe converges; maintenance + valid soak allowlist still permits the read; non-allowlisted player still cannot start combat.
Plus a write-authority audit assertion that no client file invokes `combat-catchup`.

Deployed validation (service-role probe + one temporary player character, ≤30min allowlist, maintenance kept on): RPC returns the roster for the owned node, refuses a foreign node, leaves `encounters`/`encounter_tick_batches`/`active_effects` row counts unchanged, and `combat-catchup` still 403s.

## 8. Migration / deployment order, rollback
1. Migration adding the RPC (additive; nothing calls it yet).
2. Client rewire + tests; full suite.
3. Deployed read-only validation, then teardown and leakage check.
4. Only afterwards: Gate 3 retry, then the internal-catch-up gap as its own checkpoint.

Rollback: dropping the RPC is safe once step 2 is reverted; the plain-read fallback keeps rosters visible. Step 1 alone is inert. No data migration, no destructive change, no schema change to existing tables.
