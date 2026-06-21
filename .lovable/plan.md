
# Smoothness & Speed Optimization Plan (with gameplay-safety guardrails)

Goal: cut backend write volume and shave first-paint time without changing any gameplay behavior. Every change below has an explicit "what could break" and a check to prove it didn't.

## Guiding rule

**Server is the source of truth for gameplay.** No change in this plan is allowed to alter:
- combat math, XP, loot, gold, durability, or any reward calculation
- HP/CP/MP/AC values or caps
- movement rules, MP cost, cooldowns, or party movement sync
- realtime broadcast payloads consumed by other clients

If a change would touch any of the above, it's out of scope and gets dropped.

## What the data shows

Top DB hotspots (live `pg_stat_statements`, ranked by total time):

| Rank | Operation | Calls | Total |
|---|---|---|---|
| 1 | `character_visited_nodes` upsert per step | 42k | 196s |
| 2 | `characters` UPDATE current_node_id + mp | 25k | 141s |
| 3 | `activity_log` INSERT (one per event) | 25k | 106s |
| 4 | `characters` UPDATE last_online (heartbeat) | 21k | 90s |
| 5 | `characters` UPDATE mp only | 28k | 81s |
| 6 | `characters` UPDATE cp only | 37k | 72s |
| 7 | `party_members` SELECT (poll) | 44k | 60s |
| 8 | `characters` UPDATE hp | 25k | 42s |
| 9 | `party_combat_log` INSERT (one per line) | 12k | 38s |

Browser profile: favicon.png is 1.47 MB and adds ~1 s to FCP. Everything else on the client is fine.

## Phase 1 — Pure cosmetic / non-gameplay wins

### 1a. Shrink favicon
- Re-export `public/favicon.png` to <20 KB (or `.svg`).
- **Gameplay risk:** none.
- **Check:** `browser--performance_profile` shows FCP improvement.

### 1b. Coalesce `last_online` heartbeat
- Write every 60 s while visible + once on `visibilitychange → hidden`, instead of per-action.
- **Gameplay risk:** "last seen" timestamps lose up to 60 s of resolution. Does not affect offline detection in combat — that path uses presence + combat session state, not `last_online`.
- **Pre-check:** grep for every read of `last_online` and confirm none gate gameplay logic (combat tick, regen, loot, party). If any do, that subsystem stays on the per-action write.
- **Check after:** offline overlay and "last seen" UI still behave correctly in manual test.

### 1c. Skip `character_visited_nodes` upsert when already visited
- Seed a client-side `Set<node_id>` from the initial fetch; only POST when the id is new.
- **Gameplay risk:** none — the table is append-only and only used for "have I seen this node" map shading.
- **Check:** visit a new node → row appears once. Revisit → no new write (verify via `slow_queries` call count drop and a single network request).

## Phase 2 — Combat-tick write coalescing (gameplay-sensitive)

### 2a. Merge hp/mp/cp into one UPDATE per tick per character
- Replace separate single-column UPDATEs with one `UPDATE characters SET hp=?, mp=?, cp=? WHERE id=?` per affected character per tick.
- **Gameplay risk:** medium. Atomic write actually *improves* correctness (no in-between states). The risk is wiring: each call site that today writes only one column must continue to send the other two unchanged values, never `null`.
- **Guardrails:**
  - Implement as a single helper `writeCharacterResources(id, { hp?, cp?, mp? }, caps)` that runs through the existing `clampResourceUpdates` path — no new clamping logic.
  - `combat-tick` is the sole writer during combat (per the `HP authority` memory). Keep it that way.
  - Add a unit test that calling the helper with partial fields does not overwrite the omitted ones.
- **Check:** `formula-parity.test.ts` and `combat-resolver.test.ts` pass unchanged. Manual fight against a creature: HP/CP/MP at end-of-fight match expectations.

### 2b. Batch `activity_log` and `party_combat_log` inserts (persistence only)
- Buffer log rows server-side for up to 250 ms or 20 entries, then one multi-row INSERT.
- **Realtime broadcast stays immediate** — only the persisted row is delayed by ≤250 ms.
- **Gameplay risk:** none for live play. Risk is "log line missing if server crashes mid-buffer" — acceptable for cosmetic logs.
- **Check:** combat log scrolls live with no perceptible delay; reloading the page within 1 s of an event still shows the line in history.

## Phase 3 — Polling reduction

### 3a. Replace `party_members` polling with Realtime + on-demand refetch
- Subscribe once per active party, refetch the embedded character list only on `INSERT/UPDATE/DELETE`.
- **Gameplay risk:** medium. Party UI accuracy depends on this. The fully-wired policy applies.
- **Guardrails:**
  - Keep one fallback refetch on tab `visibilitychange → visible` (covers missed events while backgrounded).
  - Realtime is already enabled for `party_members` in other paths; confirm publication includes it before flipping off polling.
  - Keep the existing polling code behind a feature flag for one release so we can revert without redeploying.
- **Check:** join/leave/follow toggles still update in <1 s for all members. HP overrides from `usePartyBroadcast` still render.

### 3b. Trim initial `nodes?select=*`
- Select only columns actually used by the map (`id, name, region_id, x, y, area_id, …`), drop large/optional ones until needed.
- **Gameplay risk:** any consumer that reads a dropped column will silently get `undefined`. Must be audited file-by-file.
- **Guardrails:**
  - Grep every `.nodes` consumer; build the explicit column list from the union of what's read.
  - Type the fetch result so a missing column is a compile error, not a runtime one.
- **Check:** full smoke test — movement, teleport, world map, admin node editor, summon. No `undefined` field access in console.

## Validation between phases

After each phase, in order:
1. `bunx vitest run` — formula parity + combat resolver tests pass.
2. `supabase--slow_queries` — confirm the targeted query's `calls` and `total_ms` dropped.
3. Manual smoke in preview: move 5 nodes, fight a creature, join a party member, log out / log in.
4. `browser--performance_profile` (Phase 1 only) — confirm FCP improvement.

## Rollback

Each phase is an independent PR-sized change. If any check fails, revert that phase only — earlier phases stay shipped.

## Out of scope

- Indexes (single-row PK writes can't be indexed faster).
- Compute / disk upgrades.
- Any change to combat math, XP, loot, or movement rules.
- The two pgmq `net.http_post` queries (Cloud infra, not this project).
