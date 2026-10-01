# Combat2 ability availability and persistent stances

Status: audited design proposal; no schema or gameplay change is installed by this document. Detailed engine invariants remain owned by [game-engine.md](game-engine.md), while operational evidence remains owned by [project-state.json](../operations/project-state.json).

## Current implementation

The generated inventory in `src/shared/combat/inventory/active-abilities.json` contains 36 authored abilities. `src/shared/combat2/ability-support.ts` excludes none of them, and `src/shared/combat2/catalog.ts` derives support from authored mechanic, activation and target fields rather than labels.

The browser readiness and submission path is `action-readiness.ts` -> `routeCombat2Action.ts` -> `useCombat2IntentSession.ts` / `intent.ts`. With no active authoritative encounter, only a valid enemy-targeted action can call `combat2_hostile_action`, which atomically enters and queues that exact action. Target selection alone remains inert. Every other ability is currently refused as requiring active combat. In an encounter, `combat_intent` validates the fighter, authored ability, target, spendable CP and request identity and writes a tick-owned intent.

Stance activation currently becomes encounter-scoped `node_effect` rows: one reservation row plus one or more mechanic rows. Claim projects those rows, resolver consumes them and commit owns their changes. Immediate departure deletes character-targeted effects for the departing fighter. Therefore stance state and reservation do not survive ordinary movement or encounter completion.

The older `characters.reserved_buffs` and `characters.stance_state` JSON fields, `activate_stance`, `drop_stance` and `apply_force_shield_regen` still exist. The legacy browser also calls Force Shield regeneration on a four-second timer. Those records are not the Combat2 encounter authority and must not become a second writer during the cutover.

## Authored ability matrix

`CP` is an activation cost. `reserve` is the authored fraction of maximum CP. “Hostile entry” means the installed atomic entry-and-intent path; it never means selection alone. “Encounter” means the existing intent/resolver/commit path.

| Class | Key / label | Mechanic; target; cost | Current outside combat / owner | Proposed availability / owner | Decision or boundary |
|---|---|---|---|---|---|
| Assassin | `backstab` / Backstab | weapon attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Assassin | `cloak_of_shadows` / Cloak of Shadows | evasion buff; self; CP 60 | unavailable / encounter only | remain encounter-only | OOC timed-effect lifecycle is not designed |
| Assassin | `envenom` / Envenom | stack source stance; self; CP 50, reserve 20% | unavailable / encounter effects | OOC activate/drop / character stance transaction; hits remain encounter-resolved | mutually exclusive with Ignite |
| Assassin | `eviscerate` / Eviscerate | stack consume; enemy; CP 40 | hostile entry / entry + encounter tick | unchanged | consumes authoritative stacks at resolution |
| Assassin | `shadowstep` / Shadowstep | stealth buff; self; CP 15 | unavailable / encounter only | remain encounter-only | OOC timed-effect lifecycle unresolved |
| Bard | `crescendo` / Crescendo | party regeneration; party; CP 40 | unavailable / encounter only | remain encounter-only | periodic party eligibility needs a separate owner |
| Bard | `cutting_words` / Cutting Words | spell attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Bard | `dissonance` / Dissonance | control debuff; enemy; CP 25 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Bard | `grand_finale` / Grand Finale | burst damage; enemy; CP 60 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Bard | `inspire` / Inspire | regeneration buff; party; CP 15 | unavailable / encounter only | remain encounter-only | party and expiry lifecycle unresolved |
| Healer | `divine_aegis` / Divine Aegis | absorb buff; ally; CP 60 | unavailable / encounter only | remain encounter-only | OOC ally presence/effect owner unresolved |
| Healer | `heal` / Heal | heal; self; CP 15 | unavailable / encounter only | candidate for a later direct transaction | not part of the stance slice; combat action-slot semantics must remain explicit |
| Healer | `purifying_light` / Purifying Light | party regeneration; party; CP 40 | unavailable / encounter only | remain encounter-only | periodic party eligibility needs a separate owner |
| Healer | `smite` / Smite | spell attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Healer | `transfer_health` / Transfer Health | HP transfer; ally; CP 25 | unavailable / encounter only | remain encounter-only | OOC ally eligibility and atomic dual-resource change unresolved |
| Ranger | `aimed_shot` / Aimed Shot | weapon attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Ranger | `barrage` / Barrage | multi-attack; enemy; CP 25 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Ranger | `disengage` / Disengage | evasion buff; self; CP 60 | unavailable / encounter only | remain encounter-only | OOC timed-effect lifecycle unresolved |
| Ranger | `eagle_eye` / Eagle Eye | offense stance; self; CP 15, reserve 10% | unavailable / encounter effects | OOC activate/drop / character stance transaction | combat bonus is projected into encounter resolution |
| Ranger | `natures_snare` / Nature's Snare | control debuff; enemy; CP 40 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Templar | `consecrate` / Consecrate | aura pulse; node; CP 40 | unavailable / encounter only | remain encounter-only | node ownership and OOC pulse policy unresolved |
| Templar | `divine_challenge` / Divine Challenge | mitigation buff; self; CP 60 | unavailable / encounter only | remain encounter-only | OOC timed-effect lifecycle unresolved |
| Templar | `holy_shield` / Holy Shield | reactive stance; self; CP 15, reserve 10% | unavailable / encounter effects | OOC activate/drop / character stance transaction; retaliation encounter-resolved | one badge despite reservation + reactive projection |
| Templar | `judgment` / Judgment | spell attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Templar | `shield_wall` / Shield Wall | block stance; self; CP 25, reserve 15% | unavailable / encounter effects | OOC activate/drop / character stance transaction | encounter projects mitigation |
| Warrior | `battle_cry` / Battle Cry | mitigation stance; self; CP 25, reserve 15% | unavailable / encounter effects | OOC activate/drop / character stance transaction | encounter projects mitigation |
| Warrior | `power_strike` / Power Strike | weapon attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Warrior | `rend` / Rend | periodic damage debuff; enemy; CP 40 | hostile entry / entry + encounter tick | unchanged | pulses remain heartbeat/resolver-owned |
| Warrior | `second_wind` / Second Wind | heal; self; CP 15 | unavailable / encounter only | candidate for a later direct transaction | not part of the stance slice; combat action-slot semantics must remain explicit |
| Warrior | `sunder_armor` / Sunder Armor | control debuff; enemy; CP 60 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Wizard | `arcane_surge` / Arcane Surge | offense stance; self; CP 25, reserve 15% | unavailable / encounter effects | OOC activate/drop / character stance transaction | encounter projects offense |
| Wizard | `conflagrate` / Conflagrate | stack consume; enemy; CP 60 | hostile entry / entry + encounter tick | unchanged | consumes authoritative stacks at resolution |
| Wizard | `fireball` / Fireball | spell attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Wizard | `force_shield` / Force Shield | absorb stance; self; CP 15, reserve 10% | unavailable / encounter effects | OOC activate/drop / character stance transaction; absorb encounter-resolved | ward state needs one persistent owner; remove browser regeneration writer |
| Wizard | `frostbolt` / Frostbolt | spell attack; enemy; CP 10 | hostile entry / entry + encounter tick | unchanged | queued hostile action |
| Wizard | `ignite` / Orbs of Fire | stack source stance; self; CP 50, reserve 20% | unavailable / encounter effects | OOC activate/drop / character stance transaction; hits remain encounter-resolved | mutually exclusive with Envenom |

Periodic and reactive execution does not change activation authority: Rend and encounter auras pulse only through an encounter tick; Holy Shield reacts only inside deterministic resolution; Envenom and Ignite supply stacks only when an eligible hit resolves. No browser timer may create a pulse, absorb or stack.

## Recommended character stance authority

Use one normalized server-only `character_stance` relation keyed by `(character_id, ability_key)`. Store the authored identity, activation request, frozen reservation amount and percentage, authoritative state needed by that stance (for example Force Shield's remaining ward), activation/version timestamps and an optimistic state version. Do not copy labels or formulas as authority. RLS is enabled, browser table writes are absent, and client state comes from a bounded authenticated projection/RPC.

Do not make encounter rows co-own a stance. Claim reads the character stance rows for claim-present fighters and freezes them into the snapshot with character/stance version fences. Resolver derives the existing mechanic projections in memory. Any encounter-local rows needed for a pulse, target-specific debuff or event carry stance provenance and a uniqueness fence; they do not create another reservation. Commit validates the frozen character-stance version. The UI groups the authoritative stance plus its derived mechanics into one badge.

Activation/drop uses one idempotent authenticated RPC with a deliberate request UUID. It derives caller ownership and the authored catalogue server-side, takes the established node/encounter lock before the character and stance rows, and records a durable replay result. Activation validates class/loadout eligibility, mutual exclusion, current total CP and all active reservations, charges the authored activation cost once and creates exactly one reservation. Repeated identical requests replay; a different payload with the same request ID conflicts; already-active activation refuses. Drop removes the stance and reservation atomically, is allowed at zero spendable CP and never refunds activation cost.

When the character is in an active encounter, the transaction fences any live claim and advances the encounter state version so a stale proposal cannot commit across the stance change. The stance state changes immediately; heartbeat resolution remains the sole owner of attacks, pulses, absorbs, reactions and combat presentation. To preserve today's action-slot rule, activation/drop during combat must also create one fenced transition intent/marker that consumes that tick's player action without charging or reserving again. This is the recommended contract, pending Mik's explicit approval below.

### Lifecycle and races

- **Movement and completion:** character stance rows survive; departure removes only encounter-derived projections. Entry claims the same stance state. No activation depends on a heartbeat.
- **Tick first / departure first:** common node/encounter-before-character lock order and stance version fencing make one transaction win. A committed tick uses its frozen stance; otherwise the stale proposal refuses and retries from the new state.
- **Death and respawn:** recommended rule is atomic clearing of all active stances, reservations and stance-owned persistent state on authoritative death, with respawn observing the cleared state. This needs Mik's approval because current legacy cleanup is inconsistent.
- **Logout/reconnect:** no change; state persists and is re-projected by character identity. Late client responses are fenced by character/session/request/version.
- **Class or loadout change:** the mutation must refuse while an incompatible stance is active or explicitly drop it in the same transaction. Silent retention of an unusable stance is forbidden; which policy applies needs approval.
- **Maximum CP/equipment change:** recommended rule freezes the integer reservation calculated at activation. A lower later cap can make spendable CP zero but does not silently drop the stance. Re-activation recalculates. This needs approval.
- **Party/node eligibility:** an active character stance has no effect on absent or ineligible participants. Claim/resolver evaluates present fighter, party and node eligibility at the frozen tick. No out-of-combat aura pulse is introduced.
- **Test Arena:** snapshot/restore or arena-scoped isolation must include character stance rows and their request/version state. Reset restores the exact pre-run state; arena actions cannot leak a stance into ordinary play.
- **Existing state:** installation occurs with processing disabled. Preflight aggregates active `node_effect` stance/reservation rows and legacy JSON state. Valid active encounter pairs may be migrated once into character rows only under an explicit mapping and fingerprint; ambiguity or disagreement stops installation. Encounter rows are removed only in that same transaction. Legacy fields remain read-only compatibility data until all consumers are removed; they are not merged heuristically.

## Authority and timing

The browser can present eligibility and disabled reasons but never writes CP, reservations, ward state or effects. Pointer and keyboard submission call the same RPC. Healthy syncing retains the last identity-checked projection; stale state and late responses fail closed.

Activation/drop is an immediate authoritative transaction, like movement, not a browser timer and not a second resolver. Combat consequences remain aligned to the two-second encounter cadence. Out-of-combat settlement remains four seconds and computes spendable CP from the character stance reservations; it neither activates nor drops a stance. Existing hostile initiation, request replay, claim/commit fencing and deterministic resolver rules remain unchanged.

## Bounded implementation batches

### Batch 1 — ENG-STANCE-001 vertical slice

Add the normalized table, replay ledger, projection and activate/drop RPC; migrate only the eight authored stances; make resource/spendable-CP validation read it; project it through claim/resolver/commit; remove Combat2 and legacy browser writes/timers; adapt the UI to one semantic badge. Preserve node/encounter-before-character lock order and deploy generated mirrors only after deterministic parity. Required proof: migration guard/rollback compilation in PostgreSQL, ACL/RLS/Realtime checks, activation/drop/replay/conflict/zero-CP tests, departure-first/tick-first tests, death/respawn and cap-change tests, movement/reconnect/arena isolation, all eight mechanics and no duplicate reservation/effect/pulse. Install with processing disabled, compare protected fingerprints, deploy proven Edge consumers, then perform bounded solo live checks before multiplayer.

### Batch 2 — ENG-STANCE-002 eligibility and presentation

Expose explicit server classifications and a bounded character stance projection outside combat. Route only the eight catalogue stances through the new RPC, with shared pointer/keyboard disabled reasons and session fences. Verify activate before entry, movement, completion, reconnect, drop at zero CP, mutual exclusion and one badge. No other ability becomes OOC-capable.

### Batch 3 — non-stance ability decisions

Design a separate authoritative owner for immediate self heals and for timed self, ally, party and node effects. Decide action-slot behavior, duration clock, party/node eligibility and cancellation before enabling any one category. Deliver one coherent vertical slice rather than extending the stance table into a generic effect store.

### Batch 4 — legacy retirement

After installed and live verification, prove no runtime consumer remains, then remove or freeze `reserved_buffs`, `stance_state`, legacy stance RPCs and browser Force Shield regeneration through a separately guarded migration/source change. Preserve historical evidence and avoid data cleanup without an approved policy.

## Decisions required from Mik

1. Confirm that activation/drop during combat continues to consume the player's action slot, while the stance mutation itself becomes immediate and idempotent.
2. Confirm that authoritative death clears every stance/reservation/ward and respawn never restores them.
3. Choose class/loadout behavior: refuse the change while an incompatible stance is active (recommended), or drop incompatible stances atomically with explicit evidence.
4. Confirm frozen integer reservation at activation across later maximum-CP/equipment changes (recommended), rather than dynamically resizing or auto-dropping.

Everything else above follows existing authority, timing and replay boundaries and does not require a new gameplay rule.
