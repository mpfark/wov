# Combat2 HP release and session UI log — focused review

Source baseline d78bad1db5d68b2b65bd2a5cfd56e726b2d3017d. Owner-supplied recording combat2-diagnostic-ba7da199-77d2-4637-9923-344bcb13bc93.json, SHA-256 a520a7b58d5cbe4034e122150e637a8f5a81ad37584728827a183d4883259bad, left unchanged in Downloads. No separate visible event-log transcript was supplied; the event-log review is of the implemented data flow, not attribution of a particular reported line. No hosted query or gameplay operation.

## Evidence and cause

Recording window2026-10-19 20:23:44.706–20:26:39.540UTC:66 client events,161 server phase events,200 retained resource samples and194 dropped resource samples. The retained resource window begins20:25:15.421, so earlier combat initiation/HP history is incomplete. All resource samples are browser observations, not independent database readback.

At20:26:29.394 the client receives combat tick1537 with HP0. The displayed HP is0 at29.402, jumps to7 at29.412 as session status becomes exited, then returns to0 at29.435 after character delivery. GamePage selected the combat resource model only while sessionStatus=active, discarding it immediately on release and displaying the older character props. This is a demonstrated frontend handoff defect; no server healing or resource-writing defect is inferred. Earlier3→15 and later1→3 updates also have received-row evidence; they are not proof of this same cause and are not corrected speculatively. Diagnostic repeated correlation IDs describe multiple phases per tick, not duplicate rewards.

## Small fix

[Resource handoff](../../src/features/combat2/useCombat2ResourceHandoff.ts) retains the last combat resource projection across release until a character delivery whose read began after release. Existing exit refetch/realtime/poll paths supply it; no new request, timer or resource mutation. The hook uses the terminal snapshot even if release and death arrive together, refuses to use pre-release reads as proof of freshness, and resets on node/character/entry/ownership changes. Respawn/new-node resources and later OOC regeneration can replace the old projection normally. If fresh delivery is unavailable, retain the last known projection rather than flash an older row. No combat rules/formulas, rewards, authority or server event processing changed.

## UI history disposition

The accumulated personal log used IndexedDB wov-log/events, capped100,000 events per character, via [former archive hook](../../src/features/combat/hooks/useLogArchive.ts). It hydrated an older page on every mount and appended current log lines. localStorage holds only display preferences here (font size/flavor mode), not that archive. IndexedDB is local to browser/profile/origin, not a cross-device sync mechanism. Server encounter synchronization/broadcasts are distinct potential sources of already-existing events.

GamePage now uses only its existing bounded100-line in-memory UI log and current-session Combat2 visible-log memory. The archive hook and infinite-scrollback props are disconnected: no archive read/write/prune timers run from the live page. Existing archived browser data is left inert, not deleted. [Character-keyed route](../../src/pages/GameRoute.tsx) prevents page memory crossing character sessions. Reload, sign-out/navigation away and character switch start fresh page memory; movement within the session retains recent lines. Display preferences remain persistent. Existing server sync/replay may still deliver current encounter history; this change neither filters that authoritative delivery stream nor alters its cursors/history. It removes browser-history accumulation, not server records.

Combat2 Diagnostics is unchanged: opt-in five-minute bounded recording, same-tab sessionStorage recovery, Stop and manual JSON Export/Clear. It is not a permanent gameplay-history archive. No new diagnostic framework or storage cleanup was introduced.

## Validation and delivery

Focused regressions cover0→stale7 at terminal release, living exits, fresh/old read boundaries, first terminal snapshot, respawn/node/character resets, archive disconnection and clean remount memory. Existing presentation/visible-log/Stop-export recovery tests are reused. PASS:6 focused regressions,59 existing presentation/visible-log/diagnostic-recovery cases,12 existing delivery cases and3 project-state tests (80 total). App typecheck and production build pass; existing large-chunk/jsdom download-navigation warnings remain. Corrected a pre-existing never-cast in the related diagnostic delivery test exposed by app typecheck; no runtime transport change. JSON/Markdown synchronization, references, state/source preservation and whitespace checked. SQL/Edge/migration stages N/A. Prior limitations, reward authority, server history, administrative XP grant pause and recovery stash preserved.

Next: review the pushed frontend source, then **Mik manually Publishes**. No SQL installation or Edge deployment is needed. A short manual recording can confirm the specific HP0→7→0 flash is gone; no claim of complete live resolution or all HP jumps explained.
