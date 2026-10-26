# ENG-ABILITY-001 — Ability/build review plan

2026-10-26. Companion to the [source inventory](ability-build-inventory.md), based on current main `6d803f32a0dd14a312de395f0cfb2c03dcccf1ce`. **Proposed review order and owner questions only.** No new ability, number, build, priority change or implementation is approved by this document. Existing [engine roadmap](../roadmap/game-engine-roadmap.md), [specification](game-engine.md), project state and [publication contract](ability-publication-and-semantics.md) remain authoritative.

## Decision summary

- 36 authored abilities: Warrior 5, Assassin 5, Ranger 5, Healer 5, Wizard 6, Bard 5, Templar 5. 35 default role slots, one explicit alternative (Wizard Fireball/Frostbolt), 8 stances and 0 separate passive ability records.
- 20 authored mechanics: **17 SUPPORTED /3 PARTIAL /0 MISSING /0 UNVERIFIED** under the inventory's bounded source-contract definition. Partial: mitigation/taunt semantics, Force Shield absorb-authoring versus persistent SQL magnitude, Consecrate target eligibility. No absent whole handler blocks the current catalogue; support flags do not prove all behavior or live acceptance.
- 102 existing focused tests PASS; publication check verifies 36 records and identical committed browser/Edge catalogue bytes. Mirrors/Edge dependency containment pass. This is local source evidence, not fresh configuration, installed function parity or a 36-ability gameplay campaign.
- Best immediate build opportunity: expand alternatives within existing roles instead of making every new technique an additional always-available button. Review Wizard first because an actual alternative/loadout path already exists and source-tested fire/Chilled/stack mechanics support distinct choices without another authority system.

## Entry gate and release boundaries

Combat2 remains **CONDITIONAL GO** for bounded development using supported contracts. Owner confirms the recent Judgment/HP frontend correction manually Published; live acceptance remains pending. Persistent Aggression 6/6 is accepted only for its checklist. Before a new ability release, run the short baseline checks already planned: hostile first action/refusal, several ticks, stance CP/regen, movement/re-entry and completion. Do not repeat the Combat2 audit or demand every historical verification gap close before design work.

Design can proceed now. A code/configuration change still needs owner approval, exact costs/targets/lifetime and focused tests. New targeting/taunt/OOC ownership must be decided before implementation, not inferred from an evocative name. Recorded legacy/progression limitations and the administrative XP-grant pause remain unchanged; no Renown/Class Switching or other paused command is activated.

## Proposed seven-class review order

This is a design sequence based on mechanic reuse, not an automatically adopted roadmap priority.

| Order | Class / opportunity | Concrete owner questions | Existing foundation / risk and boundary |
|---|---|---|---|
|1| **Wizard — fire pressure versus frost amplification** | Should Signature retain mutually exclusive Fireball/Frostbolt choices? Which next role needs an alternative first? Should fire-stack burst and support amplification be distinct intended builds, or mixed at a cost? | Existing selected-role UI, spell_attack/statuses, stack source/consume and offensive stance. B work can avoid new mechanics; low/moderate risk. Defer new ward variants until P2 is dispositioned |
|2| **Assassin — opening burst versus poison buildup** | Should Shadowstep/Backstab and Envenom/Eviscerate support competing role choices or one combined default rotation? What should CHA investment buy relative to DEX? Is actual stealth/position required, or is the current next-hit buff the intended meaning? | Existing weapon/stealth/evasion/stack consumers; moderate source/spawn/stack consumption testing. Actual invisibility/flanking is D, not implicit reuse |
|3| **Ranger — precision versus same-target multi-hit and defense** | Is the intended variation crit accuracy, multi-hit pressure or defensive counterattack? Keep Barrage single-target? Should alternative techniques require a specific weapon, or retain existing unarmed/general weapon eligibility? | Existing weapon_attack/multi_attack/evasion/control; moderate risk. New range, kiting or multi-target shot rules are not established |
|4| **Warrior — strike/Bleed pressure versus mitigation and armor control** | Which role should offer damage versus control/sustain? Is Rend meant to remain a pure Bleed application or receive the separately deferred initial hit? Are shield and non-shield variants desirable? | Existing weapon/DoT/heal/mitigation/control; low/moderate risk for B. Rend first-hit formula and application trigger require a C decision before coding |
|5| **Healer — prevention versus transfer versus sustained recovery** | Keep Heal self-only, or explicitly design a separate ally variant? Which support role should present a real shield/HoT/transfer tradeoff? Must support remain encounter-only? What caster-health risk is intended for transfer? | Tested party/ally/absorb/dual-HP transactions; multiplayer/entry/party eligibility raises risk. OOC healing is D, not simply targetType editing |
|6| **Bard — CP support versus healing versus offensive disruption** | What distinct jobs should Inspire and Crescendo perform? Which role should trade party sustain for CHA offense or INT reduction? Is true silence/interrupt wanted, or are current damage-reduction semantics sufficient? | Existing party_regen/regen_buff/control/burst. Numeric role overlap needs design before adding near-duplicates. Persistent OOC song/interrupt timing is D |
|7| **Templar — reactive defender versus shield/aura support** | Is Divine Challenge mitigation-only, or should a real taunt be designed? Should Consecrate exclude untouched passive projections? Which ward/block/reactive/aura options should compete in the five roles? Keep probabilistic Shield Wall despite “guaranteed” prose? | Strong reusable mechanics but P1/P3 touch target authority and group outcomes. Resolve those scope questions before copying Challenge/Consecrate. Do not change newest-entry tank selection by implication |

## A — Design-only work that can start now

For each class, describe two intended play patterns in plain language, then map them to existing role slots, current action economy, attribute drivers and resource pressure. Identify what the player gives up by selecting an alternative. Separate thematic intent from actual implemented behavior: Fireball is not AoE; Barrage is not multi-target; Shadowstep is not movement; Nature's Snare is not a root; Purifying Light is not a cleanse. Do not infer one build's DPS, safety or mandatory status from names or raw CP costs.

Owner decisions common to all classes:

1. Keep the existing five-role, one-option-per-slot structure, or explicitly authorize a different design later? **Recommendation:** retain it for this round.
2. Which one role gets the first new alternative, and what observable tradeoff should distinguish it? **Recommendation:** Wizard review, then choose a single role; no automatic new spell/name/value is proposed.
3. Which attributes, weapon requirements, target scope, activation/stance mode, CP/reservation, duration/cadence and stack/refresh/consume rules are part of that option? Cost and unlock are independent, not a tier-derived cost rule.
4. Is it intended for ordinary combat only, hostile initiation, or OOC activation? Use the existing [availability matrix](combat2-ability-availability-and-persistent-stances.md); do not silently widen it.
5. What makes the choice meaningful without requiring every ability by default? Numerical balance and content testing follow a concrete contract; no blanket rebalance is approved here.

## B — Achievable using existing mechanics

Candidate **categories**, not new authored abilities: single-enemy spell/weapon variants using existing status/calculation parameters; same-target multi-hit variants; existing control reductions; self heal versus eligible ally transfer/absorb; presence-bound party HP/CP effects; existing next-hit/offense/evasion behaviors. Review the mechanic coverage and partials before selecting one.

Use current class role assignments/loadout selection and shared composition/publication. Define at least two behaviorally distinct options; merely renaming or changing damage type is not automatically meaningful diversity. Reuse existing scopes, not new combo counters, ranges, timers or threat tables. Source tests must cover the selected option and continued exclusion of the deselected one via server loadout authority.

**Existing mechanic does not always mean configuration-only:** a new stance key requires a forward SQL update to the eight-identity CHECK/RPC contract, plus parity of its cost/reservation and lifecycle. New ordinary options also need configured authoring and matching worker publication; SQL/data installation and deployment remain separately authorized. Frontend Publish is needed when browser code/bundled presentation changes, not asserted merely from generating JSON. New labels/parameters are not deployed by this design review.

## C — Small, bounded mechanic extension candidates

The one already tracked concrete candidate is **Rend's initial weapon strike plus existing Bleed** (ENG-ABILITY-001 / ENG-BALANCE-001). Current dot_debuff is complete for pure Bleed; adding the strike is a new combined behavior, not a missing generic weapon handler. Owner must specify hit/miss/zero-damage Bleed eligibility, initial magnitude/scaling and action/CP semantics. Then reuse offensive and status primitives in one shared result with rollback/replay/spawn tests. Do not implement it by making weapon_based metadata secretly add damage for every DoT.

No other small extension is required by the 36 current records at whole-handler level. Do not invent extensions just to populate this category. Any later narrow next-hit/status eligibility parameter requires its own concrete design, existing-consumer map and tests before classifying it as small.

## D — Unresolved architecture or authority decisions

- **True taunt/target override:** P1 conflicts with assuming the current newest-entry rule already has threat override. Define priority, duration, death/departure, multiple taunts and party interaction before implementation.
- **Hostile-only aura eligibility:** P3 must distinguish active engagement, runtime aggression and peaceful projections. Do not silently broaden Consecrate or assume a pulse itself is a valid independent provocation action.
- **Persistent OOC timed buffs, party songs, healing and aura execution:** require an explicit effect owner and eligibility across movement, sleep, absence and reconnect. Existing encounter-only support is not proof of an OOC contract; do not add client timers or another heartbeat.
- **Real stealth/flanking/range/roots/interrupts:** these names are not implemented by current stealth/control/multi_attack handlers. Only assess one if the owner actually wants it.
- **Force Shield authority/presentation parity:** P2 is a bounded design/parity decision first; copying its preview into a new ward would duplicate inconsistent authority. Preserve SQL-owned ward state and existing approved formula until explicitly changed.

## Minimal next authorized task

**Recommendation for owner review:** authorize a **Wizard design-only review**, retaining existing combat/stance/heartbeat/loadout rules, evaluating Fireball/Frostbolt and the five roles, and selecting exactly one role for a meaningful alternative. Supply desired identity/tradeoff before numbers or code. Disposition P1/P2/P3 separately when their affected mechanics enter a class design; none authorizes an automatic repair in this documentation task.

After a design is approved: pin class/role/identity/aliases and authored semantics → confirm every field has a tested existing consumer → author the smallest assignment/mechanic change → focused catalogue/loadout/refusal/resources/timing/replay and relevant multiplayer tests → review source/configured/installed parity → separately authorize required SQL/configuration → matching Edge workers → Mik manual frontend Publish where needed → bounded gameplay acceptance. Keep source implementation, installed SQL, deployed bundle, manual publication and runtime acceptance distinct.

## Validation and handoff

- Publication `node scripts/publish-abilities.mjs --check`: PASS, 36 records, no catalogue changes.
- 102 tests PASS across 11 relevant files: catalogue 17, support 4, publication semantics 18, authored defense 11, effect consumers 5, final closure 11, stack closure 13, reactive 7, status effects 8, loadout 6 and Edge packaging 2. No broad suite, runtime implementation or build was performed.
- Reports were checked for 36 exact class/key entries, correct class/mode/default/role/mechanic counts and 20 coverage rows, real source references, unchanged tracked files/state/roadmap and whitespace. No hosted/independent-session experiment was performed or implied. Runtime tests in these files use explicit snapshots/fixtures; they are not production invocations.
- Only `docs/design/ability-build-inventory.md` and this file may be committed. No project-state/roadmap/generated files are updated, per task scope. Branch: `codex/ability-build-inventory`; containing commit is the review unit. No merge or Publish.
