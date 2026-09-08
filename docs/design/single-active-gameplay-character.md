# Single active gameplay character

Ordinary gameplay should eventually permit only one actively controlled character per user. Enforcement belongs on the server through a lease, session, or equivalent authoritative activity boundary—not local storage or tab detection. Multiple tabs may remain safe read-only viewers, but only one ordinary character may submit gameplay, combat, or progression actions.

The Combat2 Test Arena may grant an explicit administrator-authorized exception for controlled multi-character tests. Reward and participation systems must never let one owner boost itself through multiple simultaneously controlled characters. Takeover rules, disconnect timeout, reconnect behavior, read-only tabs, and the exact administrator exception remain a separate product and implementation batch.

## Deferred authoritative party movement

Party following and coordinated movement are a separate batch. The server contract must process followers before the leader, resolve an independent exit opportunity and survivor/death outcome for every fighter, charge movement points per character, and move the leader only after the defined follower processing completes. No leader browser may write follower locations.
