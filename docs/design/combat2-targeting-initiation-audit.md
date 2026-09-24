# Combat2 targeting and initiation audit

Status: source audit and narrow source correction, 2026-09-24. Repository source is not proof of Cloud installation or live behaviour.

## Source-of-truth matrix

| Transition | Client presentation | Authoritative owner / immediate preflight | Heartbeat validation | Identity and slot | Replay / resulting state |
|---|---|---|---|---|---|
| Select peaceful creature | local `selected` immediately | none; `useCombat2Targets` only | none | creature definition ID is local selection only | freely replaceable; no encounter/fighter/engagement |
| Automatic aggressive entry | `entering`, then delivery attach | `combat_enter`; mode, owner, node and aggression/active-engagement gate | `fighter_entered` is consumed with the next claim | character + node + request; fresh `entry_seq` | request replay returns prior event; one node encounter, present fighter |
| Join active shared encounter | same as entry | node advisory lock and existing node encounter row | newcomer participates on next eligible claim | fresh fighter entry generation | no second node encounter |
| Basic Attack first engagement | `engaging` / prepare feedback | `combat2_engage`; target at node/living, then entry + `combat_intent` in one subtransaction | frozen target revalidated | request + encounter + character + target; captured intent owns slot | uncertain retry reuses request; refusal rolls entry back |
| Hostile ability first engagement | local refusal because no ready session | no generic authoritative RPC exists | not reached | not applicable | blocked by `ENG-COMBAT-002`; never fabricate Basic Attack |
| Non-hostile/stance outside combat | local not-ready refusal | no entry RPC | not reached | none | no encounter residue; character-scoped stance is separate work |
| Ability/stance in encounter | prepare/pending only | `combat_intent`; ownership, presence, authored availability, target and spendable CP | resolver repeats catalogue, target and frozen spendable-CP checks | submitted target is immutable; every captured intent owns slot | exact request replay stable; changed payload with same request refuses |
| Manual target dies | selected UI may move independently | queued row remains unchanged | resolver returns `target_dead`/invalid target | no redirection; slot consumed | no cost and no replacement autoattack |
| Continued autoattack target dies | projected after commit | server-owned effect | resolver selects first engaged living row by row UUID, spawn sequence, definition UUID | server-derived only | next eligible target persisted; resumes next slot |
| Fighter departure/death | input locked | existing departure/death contracts | resolver/commit makes fighter absent | fighter ID + entry generation | candidate invalid; fallback tank selected (immediate departure remains `ENG-MOVE-001`) |
| Delivery/reconnect | bounded live/sync/stale states | `combat2_sync` projection | no alternate gameplay authority | character + node + encounter + tick/state version | old identity/generation responses discarded |
| Reward qualification | authoritative result only | no co-location qualification | damage/debuff/explicit interaction creates per-spawn qualification | character + creature + spawn | peaceful observer receives none; commit is exactly once |

## Production path and evidence

- `GamePage.tsx` owns the feature boundary. `NodeView.tsx` selects locally; `useCombat2Targets.ts` resolves only against the current authoritative encounter roster.
- `useCombat2EntrySession.ts` calls `combat_enter` after the browser roster reports a living creature. Character/node generations discard late entry results. `combat_enter` serializes per node, reuses/reactivates the one node encounter, assigns a new `node_fighter.entry_seq`, engages aggressive spawns and emits `fighter_entered`.
- `combat2_engage` is transactional and idempotent for Basic Attack. Its exception subtransaction rolls entry back if the attack cannot queue.
- `useCombat2IntentSession.ts` owns one stable request UUID per deliberate submission and fences character/node/encounter/tick delivery identity. The SQL queue uses a per-character advisory lock and latest-valid-intent-wins.
- `node_tick_claim` freezes fighters, creatures, intents, effects, pending events, participation and ordered tank candidates. `processNodeTickOnce` strictly decodes, builds the authored catalogues, resolves once and commits the unchanged proposal.
- `resolver.ts` makes `occupiedActionSlots` from every captured intent before validation. CP uses snapshot total less reservation effects; manual targets never redirect; autoattack ordering is runtime row UUID, spawn sequence, then creature definition UUID.
- `node_participation` is created only by explicit qualifying interaction. Co-location and peaceful selection do not grant rewards.
- Test Arena dispatch reaches the same claim/decode/catalogue/resolver/commit path; arena controls prepare fixtures but do not define alternate targeting rules.

## Proven gaps and narrow correction

The browser previously displayed and gated abilities with total CP while the resolver used total minus reservations. Keyboard submission shared the router but the router had no CP check, so it could bypass the disabled button. The source now passes authoritative spendable CP through the shared pointer/keyboard router, shows required/available CP and permits a zero-CP stance drop.

The public intent RPC previously queued an already-known unaffordable request and treated request UUID replay as equivalent after checking only character identity (plus the outer ally target check). The unapplied forward migration adds payload-exact replay validation and an authoritative reservation-aware CP preflight. Heartbeat validation remains unchanged and authoritative.

Movement RPCs do not call `combat_enter`; entry is currently browser-driven after roster delivery. This explains why a newcomer can temporarily fail to join, and means an offline party follower is not authoritatively entered merely because party movement relocated it. Moreover, `combat2_engage` hard-codes Basic Attack, and tank candidates prioritize a configured party tank/leader within the newest arrival group instead of pure newest entry. These coupled changes require transaction/lock and catalogue decisions and are tracked together as `ENG-COMBAT-002`; no speculative migration is authored here.

## Evidence boundary

Project-state entries distinguish source-authored migrations from installed ledger evidence. The CP preflight migration and frontend correction require later installation/publication and bounded verification. `ENG-MOVE-001` and the future shared `heartbeat_id`/explicit intent-cutoff work are unchanged.
