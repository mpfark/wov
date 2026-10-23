# WoV — evening gameplay integration checklist

Prepared2026-10-23. **All boxes are unexecuted manual checks, not PASS evidence.** Existing IDs: ENG-COMBAT-001/002, ENG-MOVE-001, ENG-UX-001 and ENG-DELIVERY-001. Ordinary teleport works per owner report; waymarks remain untested.

## Before playing

- [ ] Note character/class/level, starting node, approximate local time/timezone and frontend revision if known. Screenshot HP/CP/MP and maxima, XP and gold.
- [ ] Choose a familiar, low-risk route/creature. Do not change world/scheduler settings, progression controls or administrative permissions. Stop on unexpected danger or persistent uncertainty.
- [ ] Optional Diagnostics: administrator-only bottom-right radio/status button → **Start → reproduce briefly → Stop → Export** before Clear. Use the [existing workflow](combat2-resource-diagnostics-handoff.md); no Lovable request needed. Start/Stop use existing diagnostic metadata calls. Without access, screenshots/timestamps suffice. Client/UI snapshots are not independently verified server state.

## Main solo pass (about15 minutes)

- [ ] **Aggressive arrival:** walk into a node with a living aggressive creature. Expect authoritative arrival/combat synchronization without leaving/re-entering or manually attacking first. Note arrival-to-first-event delay; do not require instant damage before the next eligible heartbeat.
- [ ] **Hostile first action:** on a passive creature, use an available enemy-target ability. Expect initiation with normal cast/cost behavior, or useful refusal—not permanently unexplained “Waiting for authoritative state.” Skip without a suitable ability.
- [ ] **Basic Attack:** use the creature's Attack control. Separately try the existing keyboard/attack-command entry point from idle. Expect consistent initiation/refusal. Record exact input if paths differ; avoid repeated clicks.
- [ ] **Passive entry/re-entry:** untouched passive creatures should not attack merely because you entered. After the separately authorized [persistent-aggression SQL](combat2-persistent-aggression-handoff.md) is installed, a passive creature surviving a direct damaging hit should remain hostile on re-entry until death. Before that installation, record existing behavior only. Capture pending effects/encounter state independently; aggression must not require a permanent encounter.
- [ ] **Combat departure:** choose one valid adjacent exit while fighting safely. Expect immediate authoritative departure/refusal, normal MP cost once and consistent position. Old-node combat must not appear as the current fight; departure need not instantly resolve all pending effects.
- [ ] **Resources:** compare HP/CP/MP and maxima before/after an ability, departure and short idle interval; distinguish reserved from spendable CP if using a stance. Expect confirmed costs/regeneration and converging displays. Capture unexplained jumps, stale dead/alive state or panel-dependent values.
- [ ] **Defeat/rewards:** kill one suitable creature; compare actual XP/gold and note drops. Expect one eligible award. Repeated XP/death/“No item drops” text is not proof of duplicate accounting. Note noisy durability text without assuming the durability rule is wrong.
- [ ] **Respawn:** remain through ordinary respawn, then fight the new life. Expect living HP and fresh events without exit/re-entry. If entries appear only after moving away/back, record that sequence; subscription/cursor/generation/backend cause remains unknown.
- [ ] **City teleport regression:** from a designated point, travel to a valid destination with enough CP. Expect one move, displayed existing CP cost and consistent arrival/resources. If uncertain, use pending retry rather than a new request.

## Optional — personal teleport, level22+ and enough CP

- [ ] Teleport from a **non-teleport node** to an allowed destination. Expect a departure waymark. Return, travel away, return again: reusable unchanged mark, normal CP cost each time.
- [ ] Make another qualifying off-point teleport elsewhere. Expect replacement with that departure mark. City-point departure/waymark return must not replace it.
- [ ] Longer check: leave a mark genuinely idle20 minutes without input. Expect unavailable despite visible-tab heartbeat. Input throttling may conservatively expire it up to5seconds earlier than final local input; network/background delivery is not guaranteed.
- [ ] Create a mark, complete Logout, log back in. Expect no inherited mark. Failed/offline logout is not confirmed server revocation; record errors.

## Optional — progression-ready character

- [ ] **First Join:** if eligible and wanted, preview/join at the correct location. Expect class/bond/cost and available ability UI to refresh under existing rules.
- [ ] **Allocation:** if unspent points exist, intentionally allocate a small amount. Expect one point/stat update or meaningful refusal.
- [ ] **Respec:** only with an existing token/proven investment **and willingness to spend it**. Preview/confirm; expect canonical token/investment handling and refreshed attributes. Otherwise SKIP. Switching/Renown remain disabled; administrative XP grants remain paused.

## Optional — second controlled character/session

- [ ] Party up normally and enter a safe node. Record leader/follower order, targets and resources. Shared-node combat does not imply equal rewards/kill credit.
- [ ] Try coordinated departure. Expect each successful mover's position/cost once. Avoid recreating uncertain requests; deferred F1 retry-UUID weakness remains OPEN.
- [ ] Have one character enter an existing fight. Observe tank/target behavior and both logs. Sequential smoke does **not** prove independent-session concurrency.

## Bug report (copy per issue)

- Action / exact input:
- Expected / actual result, including refusal:
- Character / node / creature; after respawn or re-entry?:
- Approximate time/timezone; frontend revision if known:
- Relevant before → after resources/XP/gold:
- Screenshot / log / optional exported Diagnostics JSON:

Never include credentials/tokens. Request minimal separately authorized Lovable evidence only if needed; no broad audit.

## Local evidence and release

Based on `1568d41d28e9bff6124e7904bcc12b422a17849e`, branch `codex/gameplay-integration-evening`; containing commit identifies the reviewed unit. One reproduced frontend defect: ID-only creature-resource overlay let an old dead-life snapshot hide a new respawn. Require matching spawn generation; preserve unmatched roster rows and existing same-generation projection. Two regressions failed first;73 affected tests, typecheck/build and documentation/state checks passed. No claim this explains a live incident; no second speculative fix.

Owner review/merge → **Mik manual frontend Publish once** → checklist. **No SQL or Edge deployment**, install hashes not applicable;0029/history/teleport implementation unchanged. No manual case has passed here. Existing limitations persist; stop on unexpected drift rather than changing permissions/controls.
