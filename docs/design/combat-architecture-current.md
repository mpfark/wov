# Combat Architecture — Current State (Reference)

Factual snapshot of how live combat works today. No opinions. Citations are `file:line` at time of writing.

## TL;DR

Combat is **server-authoritative and request-driven**. A `combat_sessions` row (unique per `character_id` XOR `party_id`) tracks only timing/engagement metadata; the row is created and deleted lazily by the `combat-tick` edge function itself on every invocation. There is no cron for live combat — only `combat-catchup`, invoked on node entry, reconciles DoTs that ticked while offscreen. Ticks are driven by a 2s client-side worker-timer heartbeat owned by the solo player or the party **leader only**; non-leaders relay/receive via a Supabase Realtime broadcast channel. Creature HP is the single source of truth (`creatures.hp`), always written through the `damage_creature` SECURITY DEFINER RPC — there is no explicit row lock. The architecture implicitly assumes one active session per creature; multi-party overlap on the same creature is an unhandled race, not a designed scenario. Kill resolution (`resolveCreatureKill`) is centralized in `_shared/kill-resolver.ts` and is the sole writer of XP/gold/loot/level-ups. Sessions vanish the instant a party has zero alive members at the node, the node changes, or the character is deleted; there is no idle timeout or cron sweep, and no explicit interaction with `wake_world` / world slumber beyond combat implicitly stopping when clients stop calling.

## 1. `combat_sessions` schema and lifecycle

### Schema
Original migration `supabase/migrations/20260330000758_a3fc7560-6fdd-4494-901d-253903e4d91a.sql:3-18`:
```
CREATE TABLE public.combat_sessions (
  id uuid PRIMARY KEY,
  character_id uuid UNIQUE ...,
  party_id uuid UNIQUE ...,
  node_id uuid NOT NULL,
  engaged_creature_ids uuid[],
  last_tick_at bigint,
  tick_rate_ms integer DEFAULT 2000,
  dots jsonb,
  member_buffs jsonb,
  CONSTRAINT session_owner CHECK (exactly one of character_id/party_id set)
)
```
Service-role-only RLS at creation (`:20-27`).

### Later changes
- `dots` column dropped: `supabase/migrations/20260330004545...sql:32-33`. DoT state now lives in `active_effects` (see `_shared/combat-resolver.ts:13-16`: *"Combat sessions track only timing and engagement — never effect data."*).
- `recent_member_ids jsonb` added: `supabase/migrations/20260627000047_cf2a1486...sql:1-4`. Rolling cache of `{character_id: {last_at_node_ms}}` used only for the 3s XP-grace window (`combat-tick/index.ts:405-420`).
- Client SELECT policy added: `supabase/migrations/20260625111031...sql:119-124` (`Players read their own combat sessions`, gated by `owns_character`). Writes remain service-role only.

### Authoritative vs cached columns
- Authoritative (written only by `combat-tick`): `node_id`, `character_id`/`party_id`, `last_tick_at`, `tick_rate_ms`, `engaged_creature_ids`.
- `member_buffs` is written once at insert (`{}`) and never updated afterward. Live buff data flows through the party broadcast channel via `memberBuffsRef`, not persisted here.
- `recent_member_ids` is a grace-window heuristic cache, not gameplay truth.

### Creator
`combat-tick/index.ts:363-377` — inserts a row when no session exists AND (`action === 'start'` OR engaged creatures OR pending abilities).

### Deleters (all in `combat-tick/index.ts`)
- No alive members at node → delete (`:343-348`, `session_deleted_reason: 'no_members_at_node'`).
- Node mismatch → delete stale session (`:357-361`, `session_deleted_reason: 'node_changed'`).
- `delete_character_cascade` RPC deletes by `character_id` on character deletion (`supabase/migrations/20260622212522...sql:35`).

### Read (not written) elsewhere
`combat_sessions` is queried by unrelated RPCs to gate OOC regen and Force Shield freeze while "in combat":
- `20260501232050...sql:53-58`
- `20260502133107...sql:44-48`
- `20260502133807...sql:47-53`
- `20260516222140...sql:148-154`

## 2. Ownership of time

- **Request-driven, not cron.** `combat-tick/index.ts:1-12` docstring: "server-authoritative combat simulation tick" driven by client requests. No `pg_cron` job schedules per-combat ticks; only unrelated world-lifecycle jobs exist (`tick-creatures`, `idle-shutdown-check`, migration `20260714104534...sql:38-40`).
- **Client cadence.** `src/features/combat/hooks/useCombatDriver.ts:244-246, 281-283` — `setWorkerInterval(() => doTickRef.current(), 2000)`. Fixed 2s heartbeat, started on `startCombatCore` or ability queue; cleared after 2 idle polls (`:751-760`) or via `useCombatLifecycle`.
- **Server tick math.** `TICK_RATE = 2000`, `TICK_CAP = 3` (`combat-tick/index.ts:248-249`). Per invocation: `ticksToProcess = min(floor((now - last_tick_at) / TICK_RATE), TICK_CAP)`. A single request catches up at most 3 rounds — the comment notes sessions end on node change so backlogs shouldn't occur.
- **Per-invocation work** (`combat-tick/index.ts`): local JWT auth (`:229-246`), resolve party/solo members at node (`:290-332`), load-or-create session (`:335-384`), merge `engaged_creature_ids` (`:386-388`), simulate 1–3 rounds, call `resolveCreatureKill`, `writeCreatureState`, `cleanupEffects`, return `{events, creature_states, member_states, ticks_processed, active_effects}`.
- **Only the driver calls the edge function.** `useCombatDriver.ts:636-690` (`driver = solo || p.isLeader`). Non-leaders never call `combat-tick`; they receive results via the party broadcast channel (`:737-738`, `:490-495`).
- **Regen** is a separate `useGameLoop` heartbeat, suppressed server-side by DB triggers checking `EXISTS (combat_sessions ...)`, not by client coordination.
- **Non-timing lifecycle** owned by `useCombatLifecycle.ts`: node change stops combat + resets aggro (`:59-70`), death stops combat (`:77-84`), non-leader "no tick in 6s" timeout stops local combat only (`:88-96`, does not delete the server session).

## 3. `creatures.hp` write paths

- Written exclusively through `damage_creature(_creature_id, _new_hp, _killed)` SECURITY DEFINER RPC. Current definition: `supabase/migrations/20260618125241_e34bed7c...sql:1-19`. On kill: `hp=0, is_alive=false, died_at=now(), is_aggressive=base_aggressive`. Otherwise: plain `SET hp=_new_hp`.
- Sole caller: `writeCreatureState()` in `supabase/functions/_shared/combat-resolver.ts:443-468`. Invoked from both `combat-tick` and `combat-catchup`. Batches `Promise.all` of per-creature `damage_creature` calls plus `is_aggressive` flip.
- **No row lock, no optimistic-concurrency check, no `SELECT ... FOR UPDATE`.** Each call is a blind last-writer-wins `UPDATE ... WHERE id = _creature_id`.

## 4. Multi-party same-node handling

- Session key is `character_id` XOR `party_id` (`session_owner` CHECK, `20260330000758:14-17`). No uniqueness on `node_id` alone — each solo player and each party gets their own `combat_sessions` row, all potentially pointing at the same `node_id` and same `engaged_creature_ids`.
- Each session independently snapshots `creatures.hp` at request start, computes damage against that snapshot, and writes back via `damage_creature`. **No session-to-session coordination** on `engaged_creature_ids`. Two parties can both "own" a fight against the same creature; the code does not detect or prevent this.
- `useCombatDriver.ts` has no knowledge of other parties; `engagedCreatureIds` is party-scoped.
- Cross-party visibility is display-only via the node Realtime broadcast: `useCreatureBroadcast.ts:14-15, 91-97, 111-136` (`broadcastOverrides`, `softDeadIds` with 8s TTL). Server truth from `creatures` postgres_changes eventually overrides it (`useNodeChannel.ts:141-164`).
- **Effective assumption:** one active combat driver per creature at a time. Overlap is an unhandled race.

## 5. Realtime surface

### `node-<id>` — one shared channel per node (`useNodeChannel.ts:93-185`)
- Presence: `playersHere` track/sync (`:99-111, 167-179`).
- Broadcasts: `creature_damage` (`:114-116` → `useCreatureBroadcast.ts:85-108`), `loot_picked_up`, `loot_dropped`, `say`, `unlock_path` (`:117-128`).
- Postgres changes: `node_ground_loot` (`:131-138`), `creatures` INSERT/UPDATE/DELETE filtered by `node_id` (`:140-164`).

### `party-combat-<partyId>` — one per party (`useCombatDriver.ts:487-531`)
- `combat_tick_result`: leader → members, full tick response (`:490-495, 738`).
- `engage_request`: member → leader when non-leader initiates (`:496-514, 255-261`).
- `member_buff_state`: member → leader every 1800ms (`:534-547`).
- `member_pending_ability`: member → leader queued ability (`:520-524, 603-608`).

### Polled (not Realtime)
- `active_effects` and `creatures` fetched via direct `select` in `combat-tick`'s idle path (`combat-tick/index.ts:396-403`) and in `combat-catchup` (`combat-catchup/index.ts:149-153, 173-180`). DoT/effect state arrives as poll responses on the 2s cadence, not pushed.
- Character HP inside combat: returned in the `combat-tick` HTTP response as `member_states`, applied locally via `updateCharacterLocal` (`useCombatDriver.ts:396-427`). Any additional `characters` postgres_changes subscription (party/character hooks) not reviewed here.

## 6. `combat-catchup` role

- Docstring `combat-catchup/index.ts:1-24`: sole owner of **offscreen persistent-effect** resolution (poison/bleed/ignite). Sessions don't persist offscreen — only `active_effects` do.
- Trigger: client sends `{ node_id, force?, reason?, snapshot_only? }` on node entry / adjacency — *"Clients send only node_id — no damage, timing, or tick data"* (`:14-16`).
- Authorization: caller must have a character at, or adjacent to, `node_id` (`:92-145`).
- Reconciles: reads `active_effects` + `creatures` for the node (`:173-180`) and **resets `last_tick_at = now()` on any stale `combat_sessions` for that node** in parallel (`:176-179`) to prevent backlog processing.
- Writes: calls `resolveEffectTicks`, then `writeCreatureState` (HP writes via `damage_creature`, same path as `combat-tick`), then `cleanupEffects` (`:219, 234-237`). **Yes, it writes HP.**
- Awards offscreen DoT kills via `resolveCreatureKill`, idempotent via `creatures.rewards_awarded_at IS NULL` claim (`:251-273, 351-366`).
- Best-effort 10s in-memory throttle per isolate and a 3s wall-clock cap with `partial: true` fallback (`:47-59, 156-169, 221-231`).

## 7. Party membership + session lifecycle

- **Leader authority server-side.** `combat-tick/index.ts:298-302`: for party requests, fetches `party.leader_id` and verifies the caller owns that character (`if (!userChars?.some(c => c.id === party.leader_id)) throw new Error('Not the party leader')`). Only the leader's HTTP call is trusted.
- **Leader authority client-side.** `useCombatDriver.ts:636-637` (`driver = solo || p.isLeader`) gates who fires ticks; non-leaders relay via `engage_request` / `member_buff_state` / `member_pending_ability`.
- **Party dissolution.** `useCombatLifecycle.ts:53-56`: `if (!party && channelRef.current) stopCombat()`.
- **Server session on leader-leaves-node.** `combat-tick` re-derives `members` by filtering `party_members` where `current_node_id === node_id` (`:314-319`). If none remain, session is deleted (`:343-348`). A stranded non-leader's `useCombatLifecycle` 6s-no-tick timeout stops its local combat only (`:88-96`) — the server session simply stops advancing until the leader's next call or a node-change/no-members deletion fires.
- Character deletion cascades `combat_sessions` deletion by `character_id` (`20260622212522...sql:35`).

## 8. Kill resolution ownership

- Shared module `supabase/functions/_shared/kill-resolver.ts` exports `resolveCreatureKill`.
- Sole callers: `combat-tick/index.ts:14` and `combat-catchup/index.ts:32`.
- Enforced by memory doc `.lovable/memory/tech/combat-architecture/kill-resolution.md`: a former client-side `awardKillRewards`/`rollLoot` in `useCombatActions.ts` was removed 2026-04-25 because it double-wrote rewards. Do not reintroduce.

## 9. Existing per-node-keyed state (precedent)

- `node_ground_loot` — keyed by `node_id`, not by session/party. Any player at the node sees/picks up loot regardless of who killed the creature or which party session existed (`useGroundLoot.ts` + migrations `20260220110012`, `20260317101118/101224`, `20260609112516`, `20260611091420`, `20260612100032/101142`, `20260714103613/104534`). Working precedent for multi-party-safe node-keyed state.
- `active_effects` rows carry `node_id` and are node-scoped for catchup queries (`combat-catchup/index.ts:174`). Individual rows tag `source_id`/`target_id`/`session_id`, and item-proc buffs set `session_id: null` (`combat-tick/index.ts:176-188`) — effects aren't strictly session-bound.
- By contrast, `combat_sessions` is **not** node-keyed. `node_id` is an attribute of the session, not the partition key. This is the structural root of the "multiple sessions per node" ambiguity in §4.

## 10. World slumber interaction

- `world_state` singleton + `shutdown_world()` / `wake_world()` RPCs (`supabase/migrations/20260714104534_acb858ff...sql:1-60+`). `shutdown_world()` unschedules cron jobs (`world-watchdog`, `expire-timed-state`, `prune-logs`, `return-unique-items`, `tick-creatures`, `process-email-queue`, `idle-shutdown-check`), disables `characters_wake_world` and email-queue wake triggers, and drops `characters, creatures, marketplace_listings, node_ground_loot, parties, party_members, summon_requests` from `supabase_realtime`.
- `useWorldState.ts:29-37` calls `wake_world` to resume.
- **No direct interaction between the slumber system and `combat_sessions` / `combat-tick` / `combat-catchup`** in the inspected code. Combat implicitly stops when clients stop calling. Asleep mode's realtime-publication drop additionally breaks node/creature postgres_changes for anyone still connected. No evidence `combat_sessions` is purged on sleep, nor that `wake_world` does anything combat-specific.

## Known open items in the current model

- No dedicated `creatures.hp` locking → lost-update race between concurrent sessions.
- No node-scoped combat state → shared boss/hazard effects have nowhere to live.
- No TTL/cron sweep for orphaned `combat_sessions` rows if the leader's tab dies mid-fight (relies on next node-change/no-member deletion).
- Whether `characters` HP updates during combat are also pushed via a separate `postgres_changes` subscription elsewhere is not confirmed here.
