# Correction plan — player-facing node roster reconcile (amended)

Combat stays in maintenance. Soak stays off, allowlist empty. `combat-catchup` stays service-role-only. The full C5 soak does not begin under this plan.

## 1. Root-cause wiring map (current deployed flow)

```text
character.current_node_id changes (movement → preheatNode)
  → GamePage: useCreatures(current_node_id, nodeChannel, node, onCatchupRewards, softDeadIds, character.id)
  → node-change effect: setCreatures([]) + loading + fetchCreatures()
  → phase 1 (optimistic): prefetchCache hit, else direct read
       from('creatures').eq('node_id').eq('is_alive', true)
    phase 2 (authoritative): reconcileNode(node, { characterId, force: true })
       → invokeWithRetry('combat-catchup', { node_id, character_id, force, reason })
       → 403 forbidden ⇒ reconcileNode returns { creatures: [] }
       → setCreatures([])          ← roster wiped, Attack never renders
  → realtime: onCreatureUpdate / onCreatureInsert / onCreatureDelete
  → 30s safety refetch fetchCreatures(true)
```

`combat-catchup/index.ts` `internalCaller()` returns 403 for any non-service-role credential. The scope helper it wraps, `public.catchup_scope_check(_user_id, _character_id, _node_id)` (SECURITY DEFINER, STABLE), is still the right ownership/scope primitive for a player-facing read — but it returns "own or adjacent", which is not a single authority level.

### Why the client was left calling it
The hard-gate was a *combat authority* fix: effects-only progression must not be player-triggered. The audit covered tick/authority call sites but missed that `combat-catchup` was doubling as (a) the node **roster read** and (b) the **offscreen DoT wake-up** driver. Only (b) was meant to become internal.

### Client call sites broken by the gate
- `useCreatures.reconcileNode` — node entry roster; also the adjacent-node selective wake-up.
- `useOffscreenDotWakeup` — three player-invoked calls (delayed-departure catch-up, `snapshot_only` snapshot, predicted-lethal wake-up). These are authority calls and must not return as player-triggered.

### Second, separate gap (not closed here)
`cron.job` has no catch-up job and no `public.*` function references `combat-catchup`, so **no deployed internal caller currently advances effects-only/offscreen catch-up**. The player client was its only trigger. See section 7 — this is a named blocking gap for C5, not part of this migration.

### What normally supplies the roster
`public.creatures`. RLS: `Anyone can view creatures` — `SELECT` to `authenticated` with `USING (true)`; writes admin-only. Phase 1 already works with a player JWT; phase 2 fails and overwrites it with `[]`.

### Paths that can produce `setCreatures([])`
no `nodeId`; node-change clear; **phase-2 error → `{ creatures: [] }`** (the defect); genuine empty node; empty fallback read; realtime filtering out the last entry.

## 2. Authority boundary to preserve
- `combat-catchup` stays service-role-only; its 403 for player JWTs is correct and unchanged.
- Effects-only/offscreen progression stays internal authority.
- The player-facing roster path is **read-only**: no tick claim, no effect advancement, no death, rewards, loot, casts or durability writes, and **no encounter creation** (it must never call `encounter_for_node`, which inserts).
- The actionable node is resolved server-side from the authenticated caller's owned character; never accepted from the request body.

## 3. Options considered

**Option A (chosen) — dedicated authenticated read-only current-node roster RPC.** Server resolves the node from character state; explicit response envelope; ownership verified; `EXECUTE` withheld from `anon`.

**Option B — plain table read + internal scheduled catch-up.** Cheapest, but trusts a client-supplied node id, cannot express "scope refused" vs "empty", and freshness depends on cron cadence. Retained only as non-authoritative fallback (section 6).

**Option C — reuse an existing player-safe reconcile contract.** None exists. `encounter_resync_snapshot` is encounter-scoped and participation-gated; `encounter_snapshot_v2` and `encounter_reconcile` are internal/mutating (`encounter_reconcile` purges participants and resets sessions).

## 4. Contract — actionable roster is current-node only

```ts
// RPC: public.node_creature_roster(_character_id uuid)   ← no node argument
{
  node_id: string,            // server-resolved from characters.current_node_id
  realm_awake: boolean,
  respawn_pending: number,    // dead creatures at the node whose respawn time is due
  creatures: Array<{ id, name, node_id, level, rarity, hp, max_hp, ac,
                     is_alive, spawn_seq, is_aggressive, ...display fields }>
}
// refusals raise typed errors, never an empty array:
//   'not_owned' | 'no_current_node' | 'unauthorized'
```

- Only living creatures are returned. Dead creatures are represented solely by `respawn_pending` and are never part of the actionable roster.
- `realm_awake = false` or `respawn_pending > 0` **do not suppress** living creatures. An otherwise-authoritative response stays authoritative and attackable; those fields are advisory ("more may appear shortly").
- Adjacent-node prefetch does **not** use this RPC and never yields an authoritative roster (section 6).

### Response classification the client must distinguish
1. authoritative, living creatures present → `ready`, actionable
2. authoritative, empty → `empty`, actionable-empty (no error UI)
3. authoritative with `realm_awake = false` but living creatures → `ready` (+ waking notice), actionable
4. authoritative with `respawn_pending > 0` → `ready`/`empty` (+ waking notice), actionable
5. `not_owned` / `unauthorized` → `unauthorized`, non-actionable
6. server/network failure → `error`, non-actionable
7. stale response (nodeId or requestId mismatch) → **discarded entirely**, no state change

## 5. Single roster owner and movement-correct failure behaviour

One reducer owns the roster. Shape:

```ts
type RosterState = {
  nodeId: string | null;
  requestId: number;
  status: 'loading' | 'ready' | 'empty' | 'waking' | 'error' | 'unauthorized';
  creatures: Creature[];
  authoritative: boolean;   // true only after a successful RPC for this exact nodeId
  error: string | null;
};
```

Rules:
- A response may mutate state only when **both** `nodeId` and `requestId` still match the active request; otherwise it is dropped.
- **Same-node refresh failure**: keep the existing valid roster, set `error`, keep `authoritative` as-is.
- **Movement to a different node**: never carry the previous node's roster over. Reset to `loading` tagged with the new `nodeId` and a new `requestId`, `authoritative: false`. On failure → `error` for that node with no actionable roster. Cached data may be painted only when tagged with the exact new `nodeId`, and only with `authoritative: false`.
- **Attack stays disabled** until an authoritative successful response for the current node arrives (`authoritative && (status === 'ready' || status === 'empty')`).
- Authoritative RPC establishes the roster and its generation; realtime events update it afterwards; the 30s safety refetch replaces it only for the same active `nodeId`/`requestId`; prefetch/cache seeds presentation only.
- `spawn_seq` participates in reconciliation: an update/death event with a `spawn_seq` lower than the tracked one for that creature is ignored, so a stale death cannot erase a later respawn generation.
- A realtime disconnect/resubscribe ends with a fresh authoritative fetch for the current node.
- All direct `setCreatures` calls are removed or funnelled through the reducer (including `removeCreatureLocal` and the soft-dead filter, which stay presentational) so older sources cannot overwrite newer ones.

## 6. Prefetch / plain-read fallback, honestly

The direct `creatures` table read stays, strictly as: non-authoritative cached presentation, degraded/diagnostic display, and a stopgap while the RPC is unavailable. It is always tagged `authoritative: false` and **does not enable Attack** unless the approved combat contract explicitly accepts the RLS read as authoritative — it does not today.

Adjacent-node prefetch stays but is explicitly separate and non-interactive: cached per node id, never marked authoritative for the displayed node, never enabling Attack, and always revalidated by a fresh current-node RPC after movement. "Own or adjacent" scope results are never treated as one authority level.

Note on scope semantics: the new RPC protects **actionable roster scope**, not world-information secrecy. Authenticated users still have unrestricted `SELECT` on `public.creatures` under the existing global policy; that visibility decision is separate and untouched here.

## 7. Offscreen catch-up gap (named blocker, not solved here)

All player invocations of `combat-catchup` are removed, including the three in `useOffscreenDotWakeup` (rewired or removed, per the fully-wired policy). This leaves a recorded blocking gap:

> No deployed internal caller currently advances effects-only/offscreen catch-up.

Gate 3 may be retried after the roster correction, since it tests live terminal handling only. The **full C5 soak must not begin** until an internal service-role owner for catch-up is designed and deployed, with: defined cadence and scope, no player-triggerable path, advancement of approved effects-only state only, validated fled-DoT ownership plus death/reward/loot attribution, defined world sleep/wake behaviour, and idempotent duplicate invocations. That owner is **not** added as part of this migration — it comes back as a separate focused proposal after Gate 3, unless an existing intended internal owner is discovered during implementation.

## 8. Files to change

Migration (forward-only, additive):
- `public.node_creature_roster(_character_id uuid)` — SECURITY DEFINER, STABLE, `SET search_path = public`; verifies `characters.user_id = auth.uid()`; resolves `current_node_id`; returns the envelope in section 4. `REVOKE ALL ... FROM public, anon`; `GRANT EXECUTE ... TO authenticated, service_role`. STABLE is a guardrail, **not** the security guarantee — the narrowly read-only body plus permanent zero-write tests are required.

Client:
- `src/features/creatures/hooks/useCreatures.ts` — new reducer-based roster owner; RPC replaces the `combat-catchup` call; node/request tagging; spawn_seq reconciliation; resubscribe refetch; adjacent prefetch downgraded to non-authoritative.
- `src/features/combat/hooks/useOffscreenDotWakeup.ts` — remove the three player catch-up calls.
- `src/pages/GamePage.tsx`, `src/features/world/components/NodeView.tsx` — gate Attack on `authoritative`; render loading/waking/error/unauthorized states.
- `src/features/creatures/index.ts` — export `RosterState`/status types.

## 9. Regression coverage
Player JWT sees the roster and can attack; authoritative empty node; same-node failure preserves the roster and sets `error`; movement failure yields `error` with no actionable roster and never the old node's creatures; out-of-order responses across rapid movement are discarded on nodeId/requestId mismatch; cached/prefetched data never sets `authoritative`; Attack disabled while non-authoritative; `realm_awake = false` and `respawn_pending > 0` still expose living creatures as attackable; dead creatures excluded; stale `spawn_seq` death cannot erase a respawn; realtime resubscribe triggers a fresh authoritative fetch; RPC performs zero writes (permanent zero-write assertion, not just STABLE); a foreign / non-current node can never become the actionable roster; `combat-catchup` still 403s for player JWTs; write-authority audit asserts no client file invokes `combat-catchup`; maintenance + valid soak allowlist still permits the read while a non-allowlisted player still cannot start combat.

## 10. Order of work
1. Add the read-only current-node roster RPC.
2. Rework `useCreatures` around the single node-tagged roster owner.
3. Remove every client invocation of `combat-catchup`.
4. Add authority, movement-race, failure and realtime regression tests.
5. Run the full combat and application suites.
6. Validate the deployed RPC with a real player JWT; confirm a foreign/non-current node cannot become the actionable roster; confirm zero combat/runtime writes from roster reads.
7. Retry Gate 3 in a real browser.
8. Tear down fixtures, restore maintenance/off state, verify zero leakage.
9. Return the separate internal catch-up ownership proposal before restarting C5.

Rollback: step 1 alone is inert; dropping the RPC is safe once step 2 is reverted. Reverting restores creature *visibility* via the plain read, but **not necessarily a safe actionable roster** — Attack would fall back to a non-authoritative source, so a revert must also disable Attack until the RPC returns. No destructive or schema change to existing tables.
