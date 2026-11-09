# Wayfarers of Varneth — An Independent Redesign

This is a vision and proposal only. Nothing gets built until you approve a direction.

## The core diagnosis
Classic, and the 2.0 brief as well, treat the world as something that must be **ticked**: a clock fires every 2 seconds, and a worker advances everything. Most of Classic's complexity comes from this: duplicate resolvers, catch-up processing, sleep/wake, lock ordering, dispatch schedulers, stale UI and heartbeat reliability. On this infrastructure, a reliable 2-second clock is the hardest thing to guarantee. Scheduled jobs run once a minute at best, and background workers are short-lived.

My central proposal: **stop ticking the world. Compute it.**

## Big idea 1: a lazily evaluated, deterministic world
- Every fight is a sequence of fixed **rounds** (keeping your 2-second rhythm). The game can compute any round from three inputs: the moment the fight started, everyone's standing orders, and a fixed random seed.
- Nothing runs between events. Whenever a player acts, looks, moves or reconnects, the server first "catches the location up" to the present. It resolves every round that has elapsed since the last catch-up, in order, in one atomic step, and then applies the new action.
- Because rounds are deterministic and numbered, resolving the same round twice is impossible. Duplicate processing, overlapping owners and crash recovery stop being problems: they simply cannot happen.
- An empty world costs nothing. A world nobody visited for a week costs one cheap catch-up when someone arrives. Long gaps are summarized ("the wolves have healed, the corpse is gone") instead of replayed round by round.
- A once-a-minute sweep only finalizes fights where everyone left or died, and auto-logs out idle sessions. It is a janitor, not a heartbeat.

The result: authoritative, persistent and deterministic, without fighting the platform.

## Big idea 2: combat by standing orders, not button timing
Classic's combat rewards clicking at the right moment, and that falls apart under latency and disconnects. Instead:
- Each character has a **standing plan**: a primary action, a short priority list ("use Rend if CP ≥ 20, otherwise attack"), and a target rule.
- During a fight you can change the plan at any time. It takes effect from the next round.
- When you disconnect, your character keeps following the plan. "Combat continues when you close the browser" then becomes fair and meaningful rather than a death sentence.
- Cooperation becomes tactical: a group coordinates plans (taunt, heal at 50%, focus the caster) instead of racing each other's clicks. This fits a MUD's spirit and slow, deliberate progression.
- CP is the only gate on abilities. There are no cooldowns, and DoTs and shields are round-counted effects.

## Big idea 3: the location is the unit of multiplayer
- Each location has one shared state record (creatures, the active fight, ground effects and a round counter). It is the only thing that gets locked, so there are no global locks and no lock-ordering puzzles.
- Moving between locations is a single atomic step: catch up the old location, leave it, enter the new one and catch it up.
- Clients subscribe to the location they are in and receive **round summaries**, not raw row changes. The screen plays back the rounds with a short animation delay, so it feels live even though it is computed.

## Big idea 4: progression from what you actually do
- Everyone starts as a Wayfarer with a small set of universal actions.
- Every resolved round records **deeds**: damage taken for allies, healing, kills from range, songs sustained, stealth openers and so on. Deeds build quiet affinity toward each of the seven callings.
- At a threshold, a **trial** appears (an NPC, a shrine, a sign in the world). Completing it grants the class. Discovery becomes a story moment, not a menu choice.
- **Mastery** grows with the deeds of your class and unlocks new ability *variants*, not bigger numbers.
- **Bonds** grow from shared rounds and shared dangers (saving each other, long fights, deaths together). They unlock cooperative options, such as combined actions and shared plan conditions, instead of flat stat bonuses. That rewards real cooperation without inventing arbitrary numbers too early.

## What I would deliberately remove
- The heartbeat, tick dispatchers, sleep/wake logic, catch-up schedulers and separate "offscreen" combat.
- Class selection at creation, cooldowns, and client-side regeneration or prediction of HP.
- Most of the ~140 tables. Classic data stays archived, untouched, in the original backend.

## Infrastructure verdict
- **Lovable Cloud database: yes, as the single authority.** The whole engine lives in a few well-tested database commands: catch-up, act, move and plan. They run atomically, one location at a time.
- **Live updates: yes**, at the location channel level.
- **Background workers: minimal.** One for the once-a-minute janitor, plus AI features (descriptions, names) where they add flavour.
- **External game server: not needed.** A persistent external server (always-on process with WebSockets) would give a true clock, but it adds hosting, secrets, deployment and a second source of truth. The lazy model makes it unnecessary. I'd only revisit it beyond roughly hundreds of concurrent players in one location.
- **Separate project:** strongly recommended. It is a clean backend with no Classic baggage, and Classic stays playable and archived.

## How I'd build it (phases)
1. **Engine core:** the round resolver and the catch-up/act/move commands, with heavy automated tests (determinism, replay-safety, concurrency).
2. **Playable slice:** create a Wayfarer, about 8 locations, persistent creatures, an aggressive spawn, shared group fights, standing plans, a disconnect still fighting and a reconnect resuming.
3. **Sessions:** 30-minute idle and disconnect logout via the janitor, deferred during combat.
4. **Callings:** deeds, affinity, the first two class trials (Warrior, Healer), then the rest.
5. **Bonds and mastery:** recording first, unlocks later once the data shows how people play.
6. **World growth:** items and crafting rebuilt on the same model, then economy.

## Risks and honest trade-offs
- Rounds are resolved in bursts, not exactly every 2 seconds. A watcher sees them via smooth playback, but two players acting within the same round can't "react" mid-round. I consider this acceptable and MUD-like.
- Standing orders are a real design change from Classic's clickable combat. Worth playtesting early.
- Very long fights with nobody watching are bounded by a cap on rounds per catch-up, after which the fight is settled by a summary rule.

## Decision needed from you
1. Do you accept "computed, not ticked" as the core model?
2. Do you accept standing-order combat?
3. New separate project, or rebuild inside this one?
