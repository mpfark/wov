# Combat Responsiveness Audit and Staged Plan

Audited against repo HEAD `10b2e3c` (same commit as your static audit — nothing has moved since) and the **deployed** backend (schema, functions, migration ledger, live rows).

## Current end-to-end flow

1. Player clicks ability → `useCombatDriver.ts:276` stores `pendingAbilityRef = { readyAt: Date.now() + 2000 }`.
2. A fixed-phase 2s worker interval (`useCombatDriver.ts:281/331/396/647`) calls `doTick`; the pending ability is only picked up when `Date.now() >= readyAt` (`:706`).
3. `submit_combat_action` RPC is fired **unawaited** (`:743-754`) and the same action is *also* embedded in the tick body as `pending_abilities` (`:780`, `:829/836`).
4. `combat-tick` reserves the legacy mutex `combat_sessions.last_tick_at` via CAS (`combat-tick/index.ts:441-447`), simulates up to `TICK_CAP = 3` ticks, writes creature HP (`:3195`), member state (`:3416/3503`), rewards (`:3568`), session (`:3635`).
5. **After** all writes, it calls `claim_encounter_tick` (`:3878`) and `commit_encounter_tick` (`:3891`) purely to publish a replay batch.
6. Response returns over HTTP to solo/leader; followers get it via `party-combat-<id>` broadcast. `processTickResult` (`:352-614`) applies ~20 separate state mutations with **no dedupe by tick_number/batch_id**.

### Scope of the displayed milliseconds
There is no numeric ms in the combat HUD. `HeartbeatIndicator` renders only `Date.now() - lastTickTime` (time since the *previous applied* tick). The real number (`tickLatency`, `useCombatDriver.ts:841-867`) is console-only and covers **only** the `supabase.functions.invoke` round trip — excluding readyAt gating, cadence wait, in-flight queueing, broadcast delivery, reconciliation, React commit and paint. The one visible "ms" (`BroadcastDebugOverlay`) is an unrelated 5s realtime ping.

## Verdicts

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | +2s ability gate | **Confirmed** | `readyAt: Date.now()+2000` (`:276`) checked by a non-rephased 2s interval (`:706`) → 2000ms floor, ~3000ms typical, ~4000ms worst button-to-request |
| 2 | Timer measures only part | **Confirmed** | see scope above |
| 3 | Shared ownership too late | **Confirmed** | claim/commit at `:3878/3891`, *after* HP, character, reward and session writes; legacy CAS at `:441` is the real mutex |
| 4 | Durable actions not authoritative | **Confirmed** | no `combat_actions` SELECT in `combat-tick` (only `.update` at `:3942`); deployed `combat_actions` has **0 rows**; execution comes from request payload |
| 5 | Batches not connected to clients | **Confirmed** | `encounter_tick_batches` is **not** in `supabase_realtime`; zero client subscriptions or recovery fetches; only `commit_encounter_tick` writes it (224 rows, last 2026-08-08) |
| 6 | Nondeterministic rolls | **Confirmed** | `tick-rng.ts` has zero call sites in `combat-tick`/`combat-catchup`; `Math.random()` for d20, damage, crit/dodge/block, on-hit, procs, boss cast, durability, loot |
| 7 | Recovery vs disengage race | **Confirmed** | both thresholds exactly 6000ms on independent intervals (`useCombatDriver.ts:51,683` vs `useCombatLifecycle.ts:88-96`) |
| 8 | Redundant follow-up request | **Confirmed** | `tickPendingRef` set at `:695`, cleared in `finally` with `setTimeout(doTick, 0)` (`:944-946`) |
| 9 | Fragmented client updates | **Confirmed** | ~20 setState/callback/invalidations per response, plus a deferred 250ms re-aggro pass (`:576-600`) |
| 10 | Stale-engagement hardening | **Partially confirmed** | `alive_creature_ids` (`:3658`) is a hybrid: post-write for creatures touched this tick, tick-start snapshot otherwise; no regression test |

### Additional issues discovered (not in your audit)
- **The shared-tick safety switch no longer exists.** Migration `20260807105912` created `shared_encounter_tick_enabled()` + `encounters.tick_owner` (default off), and migration `20260807143727` **dropped both** (lines 102-104). Both are applied in production. So the shared claim/commit path runs unconditionally today — but harmlessly, because it only publishes after the fact. There is no flag to flip for Stage B; ownership must be introduced explicitly.
- `party_members` is read twice per tick (`:207-211`, `:217-221`); `join_encounter_engagement` (`:3827`) and `purge_creature_engagements` (`:3835`) are N+1 RPC loops.
- Follower auxiliary timers use plain `setInterval` (background-throttled) while the main loop uses the unthrottled worker timer — an inconsistency that produces foreground bursts.

## Pause-then-burst: explanation

Ranked by confidence × player impact:

1. **Delayed presentation + client pre-request delay (B).** The +2s `readyAt` on a non-rephased interval means an ability commonly waits 3-4s while autoattacks keep resolving; the accumulated result lands as one visible clump. Highest impact, highest confidence.
2. **Legitimate catch-up (A).** A slow or skipped interval lets `ticksToProcess` reach 2-3 (`TICK_CAP = 3`), so one response carries several rounds of events with no UI marker distinguishing them.
3. **Redundant immediate follow-up (B).** `tickPendingRef` fires a second request at `setTimeout(…, 0)` after a slow one, so two responses render back-to-back inside one frame.
4. **Fragmented reconciliation (B).** ~20 state writes plus a 250ms deferred aggro pass per response mean React often paints once for two responses.
5. **Duplicate delivery (C).** Real but unproven: broadcast-received results apply with no seq/batch check (`:626-630`), so a leader who also holds HTTP state can double-apply. Instrumentation will settle this.
6. **Multiple ownership (D).** Not currently reachable for one session (legacy CAS serialises it), but two parties on one creature can each simulate against their own snapshot — a correctness risk, not the main cause of the burst.

## Instrumentation (development-only)

A single `combat-trace.ts` ring buffer (dev flag, no production logging) recording per action/tick: `action_id, encounter_id, tick_number, batch_id, claim_token, ticks_processed, server_tick_due_at, server_resolution_started_at, server_committed_at, delivery_method (http | encounter_realtime | party_broadcast | recovery | catchup | legacy), client_received_at, client_applied_at, browser_presented_at` (paint via `requestAnimationFrame` + `PerformanceObserver` long-task marks). The `combat-tick` response echoes its three server timestamps and the claim identifiers.

This replaces the console-only `tickLatency` log with a **development-only breakdown panel** (`CombatTimingPanel`, mounted like `BroadcastDebugOverlay`, same dev flag) showing per action and rolling p50/p95:

- button-to-submission
- cadence wait
- lock / ownership wait
- server round trip (with server execution split out)
- result delivery (by delivery method)
- reconciliation
- paint

Each visible group is classified A (legitimate catch-up) / B (delayed delivery) / C (delayed rendering or duplicate application) / D (multiple resolution), and every `ticks_processed > 1` response is flagged. The existing `console.log` stays temporarily behind the same dev flag and is removed once the panel is trusted.


## Staged plan

### Stage A — measurement + safe responsiveness (no backend authority change)
- `src/features/combat/trace/combat-trace.ts` (new) + dev overlay; timestamp echo added to the `combat-tick` response only.
- Remove the accidental second cadence: replace the `+2000` `readyAt` with "eligible on the next authoritative tick" and re-phase/immediately wake the interval on queue (`useCombatDriver.ts:276,280,706`). Server still gates execution, so nothing resolves early.
- Coalesce stale wake-ups: check the latest known authoritative tick before the `finally` follow-up (`:944-946`).
- Split the follower timers: expected-result deadline (6s) → gap detection → bounded recovery attempt → 4s retry grace → participation check → disengage only then; move disengage/wake to the worker timer (`useCombatLifecycle.ts:88-96`).
- Batch `processTickResult` into one interpret → one log append → one creature merge → one character/effect/engagement reconcile; fold the 250ms re-aggro into the same transaction; add dedupe by `encounter_id + tick_number + batch_id` for both HTTP and broadcast paths; bounded in-memory log window (archive already persists history).
- Stage-A hardening of Finding 10: derive `alive_creature_ids` from a committed post-write read, emit it only on authoritative snapshots, and never infer an empty roster from `roster_unavailable` / `tick_reserved_elsewhere`.
- Tests: `src/test/combat/` — stale-engagement lifecycle (single- and multi-creature), ability queued just before/after an interval boundary, `ticks_processed > 1` presentation, duplicate HTTP + broadcast delivery, slow-response no-burst.

### Stage B — shared encounter authority (single atomic cutover)
Forward migrations only. Reintroduce an explicit ownership latch (`encounters.tick_owner` + a flag function, since both were dropped), then in one release: claim before simulation → encounter-wide roster (all parties + solo) → durable `combat_actions` as the *only* execution source → deterministic `tick-rng.ts` everywhere authoritative → atomic commit → one shared batch → `encounter_tick_batches` added to `supabase_realtime` with RLS-scoped subscription + ordered gap recovery on the client. Order: migrations → Edge Functions → frontend; rollback = flip the latch back to `legacy`. Legacy stays authoritative until the latch flips; no hybrid subset.

### Stage C — cleanup after verified cutover
Remove request-carried abilities, party-leader-only resolution, `combat_sessions` tick ownership, dual delivery, and temporary instrumentation — each only once its replacement is proven.

## Decisions I need from you
1. Stage A only for now, or authorise Stage B design work in parallel?
2. Optional bounded log pacing (~120ms per caught-up tick, state applied immediately, catch-up visibly marked) — yes or no?
3. Keep the console `tickLatency` log, or replace it with a proper dev-only breakdown panel?
