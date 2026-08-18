---
name: Combat reopening backlog (post C5-S2)
description: Deferred, non-blocking observations recorded when combat reopened to testers after C5 S2; also the criteria for returning combat to maintenance
type: feature
---

Combat reopened to the small tester group after C5 S2 passed (2026-08-18). Combat is an early-development tester feature, not a claim of production perfection.

## Deferred observations (backlog, NOT reopening blockers)
- Two clients retained stale dead-creature roster text after terminal combat (presentation only).
- Simultaneous multi-creature engagement and first-kill continuation were not demonstrated live.
- Multiplayer ability submission at an exact tick boundary was not demonstrated.
- Multiplayer request/refusal ratio (claim contention) may be optimized later if normal use shows meaningful cost or stalls.
- A future playtest may compare 2.0 / 2.5 / 3.0-second combat pacing. Current tick rate stays 2,000 ms.

Do not fix these proactively unless live play shows a serious product defect.

## Return combat to maintenance ONLY for
- Permanent state corruption.
- Duplicate or lost rewards/items.
- Repeated duplicate deaths or ticks.
- Persistent combat stalls that refresh/reconnect cannot recover.
- One character controlling another.
- A major mechanic consistently failing.

Presentation issues, isolated latency and recoverable irregularities go to the backlog while testers keep playing.

## Operational switches
- `combat_config.combat_mode` = `open` (fail-closed gate; anything other than `open` closes combat).
- `combat_config.combat_soak` = `off` (validation-only access; must stay off during normal play).
- Temporary `combat-harness` edge function was undeployed and removed at reopening.
