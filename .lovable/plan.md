# WoV 2.0 Rebuild — Vertical Slice Plan

## Decision you need to make first: where it runs
Preview and the live game share one database in this project. A draft of this project would also use that live database. So "overwrite this project" means rebuilding the live game itself.

Options:
- **A. New separate project (recommended).** Remix or create a fresh Lovable project with its own backend. Classic stays fully intact, and I build WoV 2.0 there from scratch.
- **B. Overwrite this project.** I build WoV 2.0 next to Classic in this backend, in a new isolated `wov2` area. No Classic tables or characters are deleted. The site's front page switches to 2.0, and Classic data stays as read-only history. This carries more risk, because it shares the production database, its resources and its heartbeat.

The rest of this plan works for either option.

## What the first playable slice delivers
1. You sign in, create a character, and start as a Classless Wayfarer. You do not pick a class.
2. A small starter world with about 6 connected locations and persistent creatures. Some creatures are aggressive.
3. Several players can stand in the same location and see each other, the creatures and one shared fight.
4. Combat resolves every 2 seconds on the server. You choose an action (basic attack or a CP ability), and the server resolves it.
5. Effects like damage-over-time last for their full duration. There are no cooldowns, only CP costs.
6. If you close the browser, the fight goes on. Logging out is held back until the fight ends. Reopening the game puts you back in the same session.
7. After 30 minutes idle or disconnected, you are logged out automatically, once you are out of combat.
8. Classes are discovered through play: fighting in a certain style builds affinity, and at a threshold that class becomes available to you.
9. Bonds: fighting together records shared experience between two characters. No bonus numbers yet.
10. Fleeing by moving away works according to the movement rules.

## Heartbeat approach (chosen)
- One world clock, one row, owned by the database.
- A single worker runs while the world is active. Every 2 seconds it calls one database command that advances one tick atomically.
- While nothing is happening (no players online and no fights), the worker stops. The world sleeps at no cost.
- A scheduled check once a minute restarts the worker if anyone is online. If the worker crashed, the world resumes within about 1 minute.
- After downtime, the world does not replay missed ticks. It reconciles in one step: creatures regain health, expired effects are cleared, and stale sessions are closed.

## Technical details
- Schema `wov2` (or `public` in option A): world_clock, nodes, node_links, creature_templates, creatures, characters, sessions, encounters (unique per node), encounter_members, intents, effects, class_affinity, bonds, tick_log.
- Engine: one SECURITY DEFINER function `wov2_tick()` that takes an advisory lock, checks tick numbers (idempotent, so no duplicate processing) and resolves combat, effects, rewards and logout eligibility. Its randomness is seeded from tick and encounter id, so results are deterministic.
- Players write only through narrow RPCs (`move`, `submit_intent`, `request_logout`, `heartbeat_presence`). Browser roles have no direct table writes, RLS covers reads, and every new table gets explicit GRANTs.
- Live updates: Realtime on encounter/node rows. The client only displays state.
- Worker: an Edge Function `wov2-heartbeat` that loops with a lease row so only one copy runs. Each run lasts about 50s and then re-invokes itself. A pg_cron job once a minute starts it when the world is awake.
- Frontend: new pages for 2.0 (character creation, world view with location, occupants, creatures and combat panel, plus the log). This reuses the existing parchment visual theme.
- Docs: a new engine spec section and roadmap IDs for WoV 2.0, plus a project-state update. Publishing stays manual by Mik.

## Out of scope for the slice
Items, crafting, marketplace, parties UI, numeric bond and mastery bonuses, and the AI world builder.
