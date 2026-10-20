# Combat2 owner observations — log delivery and engagement

Recorded 2026-10-21 from Mik's gameplay report; exact gameplay times, encounter IDs and recording are not supplied. **Operator-reported observations, not independently verified server accounting or diagnosed causes.** Documentation only; no implementation, runtime test or behavior change authorized. Source baseline: a57df3a54c80c79fdfedcd307b9f0cc391bc226f.

| Observation | Existing owner / follow-up | Evidence boundary |
|---|---|---|
| Combat feedback repeats/overlaps: death message, XP gain, gold loot, repeated “No item drops” and Killing Blow reward summary. | **ENG-UX-001**: reconcile ordinary-log presentation and reward summaries. | Correction: XP amounts were identical and Mik verified XP was **not awarded twice**. This is not confirmed duplicate XP accounting. Gold/item duplication is not established either. |
| Durability correctly decreases by 1 per round, but its ordinary-log message repeats every round. | **ENG-UX-001**: reduce repetitive ordinary-log feedback in separately authorized work. | Preserve the reported correct durability behavior. This request concerns log noise, not a durability-rule change. |
| After a kill and fighting the same creature following respawn, no new combat log entries appeared; missing entries appeared after leaving and re-entering the node. | **ENG-DELIVERY-001**, with ENG-UX-001 presentation dependency. | Cause unknown: subscription, event cursor, encounter/spawn generation or presentation remain questions for source/runtime verification. No proof of missing server events or failed rewards, and no authorization to reduce fallback polling. |
| Previously engaged passive creature did not behave aggressively after leaving and re-entering its node. | **ENG-COMBAT-001 / ENG-COMBAT-002**, cross-referenced to G4 creature lifecycle work. | Original encounter active/ended status is unknown. Engagement/lifecycle observation, not proof of a defect and not approval to make passive creatures aggressive on re-entry. |

## Follow-up boundary

Reuse [Combat2 Diagnostics and its existing Start → Stop → Export workflow](combat2-resource-diagnostics-handoff.md) in a separately authorized short recording. Correlate node, encounter, tick, creature identity/spawn generation, delivery cursor and received/rendered events where available. Client captures are not independent authoritative server state. Request only narrowly scoped, separately authorized Cloud evidence if the recording cannot distinguish delivery from committed state; no new polling or diagnostic framework is proposed.

For reward feedback, compare log event identities and summaries without assuming a repeated line means repeated accounting. For respawn delivery, compare events before/after respawn and node re-entry. For passive re-entry, establish encounter/participation/engagement state before deciding whether implementation differs from the intended contract. These are future questions, not investigations performed in this update.

Relevant existing evidence: [targeting/initiation audit](../design/combat2-targeting-initiation-audit.md), [G4 creature authority/lifecycle](legacy-001G4-creature-authority-lifecycle.md), [G4A HP ownership](legacy-001G4A-regeneration-hp-ownership.md), and [F11 awake empty-encounter observation](legacy-001F11-evidence-and-closure-assessment.md). Earlier F11 behavior does not establish the encounter state in this new session. Existing installed/source/runtime distinctions and accepted limitations remain unchanged.

Affected specification areas are Creatures, targeting and initiation; Combat resolution; Failure, diagnostics and verification. No engine rule, reward accounting, authoritative history, accepted limitation, prior closure, deployment or publication status changes. Administrative XP grants remain paused; normal gameplay XP is not intentionally paused by that policy.
