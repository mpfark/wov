# Controlled Combat2 frontend (Batch 1)

Disabled by default. Build configuration requires only
`VITE_COMBAT2_CLIENT_ENABLED=true`. A character is eligible only while its authoritative
location is one of the five permanent proving-ground nodes and the self-access RPC
confirms current ownership plus an active exact arena registration. Arena location
reserves the legacy fence before that asynchronous decision. Frontend node metadata is
a rollout control, not authorization; database registration remains authoritative.

Start only from a fresh, idle browser page for that character in the proving ground, without
another tab/session driving legacy combat. Authoritative relocation into any registered
arena node reserves Combat2 execution before effects run, then performs the read-only
solo/legacy-session preflight. Ambiguous
or refused preflight stays locked. No already-sent server mutation can be undone
by frontend cancellation.

Ownership precedes combat_enter and is not tied to encounter readiness. It persists
through synchronization, refusal, gaps, errors, pending flee, death and exit, and
across movement among all five proving-ground nodes. Leaving the arena releases the
frontend gate and restores the legacy/default path. Party membership still locks input.
Parent entry resource sync/stance clearing and Force Shield regeneration are suppressed
only while the configured tester is authoritatively located inside the arena.

Only supported authored ability/stance intents are usable when delivery is live and
the own authoritative fighter is present and alive. Targets are fenced by encounter,
node-creature identity and spawn sequence. Basic attack and attack-first are deliberately
unavailable: “Basic attack is not connected to Combat2 yet.”

Movement, teleport, waymark, search, summon acceptance, party creation/join/follow,
legacy equipment/resource actions and respawn are unavailable. Flee cannot execute
a movement continuation. Death is terminal for this page and retains committed
presentation. Chat, informational UI, inventory reads and presence remain available.

The status panel shows entry/sync/reconnect/readiness, pending flee, exit, death,
refusal, gaps and decoding/transport errors. Retained data is marked stale whenever
input is not ready. Diagnostics do not display raw responses or snapshots.

Limitations: this frontend cannot prevent external server relocation, another browser
from mutating a character, or scheduling changes. Those are operational preconditions,
not guarantees made by the allowlist. Movement/party-follow/respawn integration and
basic attack remain deferred. Do not activate without a separate controlled-test plan.
