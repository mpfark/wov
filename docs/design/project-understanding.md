# Wayfarers of Varneth — project understanding

This is the approved project-level entry point and document map for contributors. It explains the product and its architecture without duplicating detailed rules, operational evidence or backlog ownership. The engine specification, project state and engine roadmap remain authoritative for those respective concerns.

## What WoV is

Wayfarers of Varneth (WoV) is a **browser-based fantasy MUD with a visual user interface**. A player creates a persistent character, enters an interconnected world of regions, areas and nodes, meets creatures and other characters, fights, explores, gathers rewards, improves equipment and develops through class-based progression. The browser supplies a visual interface around a world whose durable outcomes are intended to remain server-authoritative.

The experience combines the spatial and social structure of a MUD—named places, movement between connected locations, text-rich events, chat and shared encounters—with a modern browser interface. Its long-term primary focus is cooperative PvE: parties, shared node presence and coordinated movement let players explore and overcome the world together. PvP is not established here as an equal product goal.

## The main player loop

At project level, the loop is:

1. Select or create a character with a class, race, attributes and persistent resources.
2. Explore the node graph, read location content, search and move through visible connections.
3. Encounter peaceful or aggressive creatures, choose targets and submit combat actions when an authoritative encounter permits them.
4. Resolve ordinary attacks, abilities, creature actions, effects, resources and encounter completion through Combat2.
5. Receive authoritative event, resource and reward projections in the browser.
6. Equip, repair, craft, trade or otherwise manage items, then continue exploration and progression.
7. Cooperate through parties, chat, shared presence and shared encounters where those boundaries are supported.

HP, CP and MP are distinct resources. Equipment, attributes, effects, stances and authored ability/creature catalogues influence play. The detailed formulas and ordering rules belong in the [engine specification](game-engine.md), not here.

## Time and authority

The intended timed-work model is one shared server heartbeat with a two-second base cadence. The durable global heartbeat identity is implemented and installed. One bounded ordinary-flow window is live-correlated; failure and recovery branches remain unverified.

- A scheduled server invocation opens an opportunity to process due work.
- Each encounter advances its own committed tick sequence. An encounter tick is not a global world tick.
- Out-of-combat resource settlement has a separate durable four-second bucket cursor.
- Movement, encounter entry and other explicitly immediate authoritative transactions do not wait for a heartbeat; they serialize against encounter work.
- Request UUIDs, claim tokens, encounter ticks, settlement buckets and delivery cursors serve different replay and ordering purposes.

The correlation contract and installed implementation are described in [World heartbeat identity](world-heartbeat-identity.md). Installation, deployment and bounded observation evidence lives in project state; unobserved failure/recovery branches must not be inferred from that ordinary-flow window.

## System responsibilities

| Component | Responsibility |
|---|---|
| Browser application | Authentication flow, character selection, input, local presentation, accessibility, optimistic/queued wording where allowed, retained character-local logs and stale-state fencing. It must not invent authoritative combat, resource, reward or movement outcomes. |
| Supabase PostgreSQL | Durable world and character state, Auth-linked ownership, row security, authoritative RPC validation, request replay, movement/entry transactions, encounter claims and atomic commits, settlement cursors and delivery records. |
| Edge Functions | Privileged service boundaries for dispatcher/worker execution and other server tasks. Combat2 Edge code discovers bounded due work and runs the shared deterministic resolver through claim/decode/resolve/commit; it does not make the browser authoritative. |
| Supabase Realtime | Low-latency notification that committed state is available. Realtime is an accelerator, not the durable source of truth; bounded sync/reconnect recovery fills gaps. |
| Lovable hosting and Cloud workflow | Hosts the published application and managed Supabase environment. When explicitly authorized, Lovable installs migrations, regenerates Cloud-derived types and deploys Edge Functions. Git presence alone does not prove any of those actions. |

## From player input to visible result

For a timed combat action, the browser validates only presentation-level readiness, creates or reuses the action's request UUID and calls an authoritative RPC. The database validates identity, encounter membership, target/action shape, resources and replay semantics, then records an accepted intent or structured refusal. A later eligible dispatcher run selects the node. The worker claims one encounter-local candidate tick, strictly decodes the captured snapshot, resolves it deterministically and atomically commits or refuses it. A committed notification wakes the delivery client; the client synchronizes consecutive encounter batches, projects the new state and appends visible events without treating HTTP success or Realtime arrival alone as gameplay success.

Immediate paths are shorter. For example, authoritative departure validates and serializes the request, changes participation/position/resources in its transaction and returns a structured result. It may occur between scheduler invocations. Entry and hostile initiation similarly have authoritative transaction boundaries. The [engine specification](game-engine.md) owns their exact semantics.

## World and gameplay relationships

- **World:** global operating state, content hierarchy and scheduler eligibility.
- **Region / area / node:** the navigable location hierarchy. A node contains or references local content, connections, creatures and co-located characters.
- **Encounter:** node-local Combat2 authority containing fighters, creature instances, intents, effects, participation, claims and a local committed tick.
- **Character:** the player's persistent identity, position, attributes, equipment, inventory and resources. Encounter projections temporarily describe combat-owned state but do not replace the durable character identity.
- **Party:** durable social membership and following/coordination metadata. Party movement and shared encounters must still obey per-character authority and deterministic ordering.
- **Combat2 Test Arena:** an admin-controlled, isolated proving environment for bounded fixtures, recording, reports and lifecycle controls. It belongs to developer and administrator documentation rather than the public game introduction, and it is not a second gameplay rules engine.

## Development and release workflow

The normal evidence chain is deliberately split:

1. Codex changes and verifies repository source locally.
2. A normal commit is pushed to GitHub `origin/main`, which is authoritative for source history.
3. Lovable may, only when authorized, install forward migrations, regenerate official Supabase types or deploy affected Edge Functions and commit its ledger/type evidence back to GitHub.
4. Mik manually publishes frontend changes. Neither a push nor a successful build proves frontend publication.
5. Installed definitions and live behavior require their own evidence. Source tests, Cloud inspection, operator reports and bounded live verification are never interchangeable.

The current committed [project state](../operations/project-state.md) records installation, deployment and publication evidence. It reports ENG-COMBAT-002 and ENG-MOVE-001 installed, with Mik's frontend publication recorded as operator-reported rather than directly verified. Live movement, arrival, hostile initiation and multiplayer tank ordering remain unverified.

## How to use the project documents

- [Game engine specification](game-engine.md): canonical engine rules and approved design boundaries.
- [Project state](../operations/project-state.md): generated view of what repository evidence says is authored, installed, deployed, published or live-verified. Edit its JSON source, not the generated Markdown.
- [Engine roadmap](../roadmap/game-engine-roadmap.md): stable ENG work items, dependencies and acceptance boundaries; it does not replace the rules.
- [`AGENTS.md`](../../AGENTS.md): mandatory repository operating constraints for AI contributors.
- [AI operating guide](../operations/ai-operating-guide.md): evidence, release and handoff discipline.

This project description summarizes those layers. It must not become a parallel rules document, operational ledger or backlog. The Admin Roadmap and Game Manual remain separate presentation surfaces.

## Current maturity

### Implemented and repository-backed

- The React/TypeScript application, Supabase integration, role-gated admin application and feature modules for world, character, inventory, party, chat, creatures and Combat2.
- Combat2 claim/decode/resolve/commit source, authoritative delivery/reconnect handling, typed intent/entry/departure adapters and browser fences against stale or legacy writes while Combat2 owns a session.
- Bounded diagnostics and a permanent Test Arena control/reporting surface.
- Immediate authoritative departure and authoritative arrival/hostile-initiation source.

### Installed or published, with remaining live proof

- Project state records the relevant Combat2 lifecycle, resource-settlement, spendable-CP, arrival/initiation and immediate-departure database work installed.
- Affected Edge deployments and regenerated Supabase types are recorded where applicable.
- Mik reports the dependent frontend manually published.
- Ordinary live movement, authoritative arrival, hostile first action and multiplayer tank order still require bounded live verification. “Installed” or “published” is not promoted to “live verified.”

### Design intent or incomplete boundaries

- A durable shared `heartbeat_id` is installed and its dispatcher consumer is deployed; a bounded ordinary-flow window is live-correlated, while ineligible, retry, failure and catch-up branches remain unverified.
- Stances are encounter-scoped; character-scoped persistence and appropriate out-of-combat activation remain decisions/work.
- Some ability behavior outside active combat remains intentionally constrained by current encounter authority.
- Food effects are not yet authoritative durable effects used consistently by settlement and combat.
- Combat1 remains temporary compatibility during the transition to Combat2, not a long-term alternative combat engine. Removal of legacy gameplay writers and obsolete runtime surfaces remains an evidence-led future task.
- ADM-025B authoritative reward-channel completion remains blocked/pending; existing reward data and legacy mechanisms must not be casually consolidated.
- Broader multiplayer, party movement and immediate-transition behavior still needs installed/live verification even where source contracts and focused tests exist.

See the [engine roadmap](../roadmap/game-engine-roadmap.md) for the maintained status and dependencies rather than extending this list here.
