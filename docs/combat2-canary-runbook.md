# Combat2 canary activation and rollback

This runbook never authorizes activation by itself. The repository gate is `npm run combat2:readiness`. Cloud preflight must additionally prove the migration ledger, deployed Edge SHA, active ability/boss/item catalogues, maintenance mode, sleeping world, disabled scheduler, and an empty ordinary-node canary allowlist.

## Control contract

Ordinary nodes are eligible only while `combat2_canary_node.enabled` is true and `expires_at` is in the future. The table is service-role only and not published through Realtime. Test Arena nodes retain their separate authorization. Browser access, entry, discovery, claims, ordinary/party destinations, and the configured respawn destination share the eligibility predicate. Removing, disabling, or expiring a row stops discovery, entry, and new claims. It does not reverse a committed tick and does not interrupt commit of an already valid lease.

For every stage below: begin in maintenance/asleep with scheduling disabled; inspect structured classifications and authoritative delivery; enable only the named node(s); use manual single dispatches before scheduling; stop on any invariant violation; then disable the scope, stop scheduling, return to maintenance/asleep, wait for leases to expire, and verify no new claims. Never reverse legitimate committed damage, movement, XP, gold, loot, or durability.

| Stage | Preconditions and permitted operation | Success evidence | Stop / cleanup |
|---|---|---|---|
| 1. Installation | Repository gate green; ledger/deployed SHA match; no active claims. Read-only status checks. | Functions exist, scope empty, maintenance/asleep, scheduler absent. | Correct installation only; do not activate. |
| 2. Isolated proof | Authorized Test Arena tester and reset fixture. Manual dispatcher only. | One claim/commit, ordered delivery, zero residue after Reset. | Close arena and reset fixture. |
| 3. Solo ordinary | One unoccupied non-boss node, one character, expiring node scope. | Entry, intents, ticks and exit affect only that character/node. | Disable scope; preserve committed results. |
| 4. Independent players | Same ordinary node, two non-party characters. | Both receive authoritative results; no cross-character mutation. | Disable scope and observe lease expiry. |
| 5. Party movement | Eligible party and adjacent destination also explicitly scoped. | Coordinated departure/movement occurs once; follower positions agree. | Any split or delayed missing delivery stops the canary. |
| 6. Ability/status | One supported ability and one supported status. | Intent consumed once; resources/effects match one committed tick. | Decode/refusal ambiguity is a stop. |
| 7. Kill/rewards | Disposable ordinary creature with known loot contract. | Death, XP, gold and loot each commit/deliver once. | Duplicate or missing reward stops rollout. |
| 8. Durability | Equipped non-unique item above zero durability. | One eligible weapon-hit tick causes at most one fenced decrement. | Out-of-range/stale overwrite stops rollout. |
| 9. Death/respawn | Character can safely die and has a configured destination. | Death locks intent; authoritative respawn moves once and preserves server resources. | Missing death/respawn delivery stops rollout. |
| 10. Boss | Prior stages green; boss config passes strict Cloud decode. | Telegraph/cast survives reconnect and leave/return rules; one commit per tick. | Any unsupported cast mode or stale telegraph stops. |
| 11. Scheduler | One expiring ordinary scope; bounded scheduler window. | Backlog drains, latency is bounded, no repeated node failure or stuck lease. | Kill scheduler and scope immediately on anomaly. |
| 12. Wider rollout | All earlier evidence archived; active Cloud catalogue compatible. | Success/error/latency remain within approved thresholds. | Narrow or clear scope; do not roll back committed state. |

Hard stops: duplicate commit/reward; impossible HP/MP/CP; durability outside bounds; stale equipment overwrite; any legacy write to a Combat2-owned encounter; dual-engine processing; strict decode failure; repeated failure for one node; claim beyond lease/reclaim expectations; unexplained backlog; cross-node/character mutation; or missing death, reward, movement, intent, effect, telegraph, or reconnect delivery.

Existing structured dispatcher/worker results prove discovery outcome, claim/commit classification and bounded backlog (`candidateCount`, `processedCount`, `summary`, `moreMayRemain`). Encounter claims expose lease/reclaim state; committed batches and event/intent/reward/durability tables provide exactly-once evidence. Persistent player-data logging is neither required nor permitted.
