# Combat server memory cache (safe version)

## What this changes for players
Each fight round should spend less time waiting on the database, so rounds land closer to the steady 2-second rhythm. Fights play out exactly as they do today.

## Important boundary
The live fight itself (who has how much HP, whose turn it is, which round is due) must stay in the database. The combat server runs as several short-lived copies that can start or stop at any time. If each copy kept its own memory of the fight, two copies could disagree, a restart could lose a round, and the game's rule of one authoritative world heartbeat would be broken. So the cache holds only things that rarely change, and every round still locks and saves the fight in the database in one step.

## What gets cached in memory
- Creature, ability, base-ability, status and class definitions the round needs to work out results.
- Each cached set carries a version stamp. The server checks the stamp cheaply (inside the existing round lock request) and reloads only when an admin has changed something.
- Lifetime limit (for example 5 minutes) as a backstop, so edits always reach fights quickly even if a stamp is missed.

## What gets fewer database trips
- Fold the catalog reads that currently happen per round into the cache.
- Return the fight snapshot together with the lock, so there is one trip to start a round and one to save it.
- Skip the "anything due?" lookup when the cache already knows no fight is due before the next heartbeat (still confirmed by the database before any write).

## Steps
1. Measure first: add per-trip timing to one live test fight to confirm which trips the cache can remove.
2. Add a small version-stamp table or column for combat definitions, bumped whenever admins edit them (database change, needs your go-ahead in the normal handoff).
3. Build the in-memory catalog cache in the combat server's shared code, with stamp check and time limit.
4. Return the catalog stamp and fight snapshot from the round lock, and use the cache in the round step.
5. Tests: cache hit/miss, reload on stamp change, reload after time limit, two server copies never disagree on fight results, existing golden-master fight tests unchanged.
6. Deploy both combat workers, run one live test fight, and report per-round times against the earlier median of about 200 ms.

## Technical details
- Cache lives at module scope in `supabase/functions/_shared/` next to the existing pooled RPC client; edge-mirror and import-graph guards extended to allow it.
- Claim RPC returns `catalog_version`; worker reloads catalogs via one RPC when the version differs. Commit stays one atomic SQL call; no game state is written from memory.
- Engine stays pure: cached catalogs are passed into `engine.prepareTick`, no engine rule changes. Spec and roadmap get a short note under the worker/runtime section.
- Realistic expectation: saves one to three trips per round (roughly 70 ms each), likely bringing typical rounds near 100–150 ms; claim and commit trips remain.
