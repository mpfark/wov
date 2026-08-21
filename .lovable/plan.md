# Combat log flavor contract: findings and the smallest coherent correction

## Phase 1 findings (verified against repo + deployed data)

Traced one event end to end: `abilities.combat_text` (DB) -> C3 catalog decode -> pure resolver `emit()` -> `commit_encounter_tick_v3` batch payload -> client `decode-batch`/`encounter-batch` -> presentation-event builders -> `EventLogLine`.

**Root cause: the authoritative resolver never reads `combat_text` at all.** No file under `src/shared/combat/` references `combat_text`/`combatText`; every line is built inline from the raw `abilityKey`:

- `resolver.ts:780` `emit('stance_pulse', "${ap.abilityKey} sears ${creature.name} for ${sparked}.")` -> live `ignite sears Stair-Runner Thug for 19.`
- `resolver.ts:820` `emit('stack_applied', "${attacker.name}'s ${ap.abilityKey} afflicts ${creature.name} [${next}/${cap}].")`
- `resolver.ts:2186` `emit('holy_shield_return', "${target.name}'s ward burns ...")` while the DB authors `retaliate_text` = `{caster}'s Holy Shield burns {target}! [{damage}]` (currently only patched up client-side in `tick-event-builder.ts`).
- `resolver.ts:2154` `emit('block', "${target.name} blocks 18 of ${c.name}'s blow.")` plus a separate `creature_hit` with `amount: 0`.

Flavor-key status:

| Status | Keys / evidence |
| --- | --- |
| Actively consumed | `combat_text.cast` only, and only on the non-authoritative client cast-flavor path (`ability-text.ts:69`). In the deployed DB just `frost_bolt` has `cast`. |
| Editable but unused | Admin editors expose exactly `cast` + `hit` (`AbilityConfigManager.tsx:120-123`, mirrored in `class/ClassAbilityConfig.tsx`); `hit` has no consumer anywhere. |
| Present in deployed data but unreachable | `cast_text`, `hit_text`, `hit_verb`, `miss_text`, `miss_verb`, `activate_text`, `pulse_text`, `stack_text`, `retaliate_text`, `mitigate_text`, `tick_text`, `self_text`, `ally_text`, `apply_text`, `burn_text`, `heal_text`, `proc_text`, `hit_no_stacks_text` — 70 authored values across ~35 abilities, none read by the authoritative path. |
| Hardcoded elsewhere | MUD flavor pools and verbs in `src/features/combat/utils/combat-text.ts`; ability/mechanic cast fallbacks in `cast-flavor.ts`. |

Deployed `combat_text` confirmed for Orbs of Fire (`ability_key = ignite`, label "Orbs of Fire", already has the intended combined `pulse_text`), Fireball (`hit_verb`/`miss_verb` only — no `cast`, so it falls through to the generic `spell_attack` line), Force Shield, Holy Shield, Envenom, Eagle Eye. Envenom and Orbs of Fire both still claim "for 5 minutes"; `{seconds}s` appears in stance text at `ability-seed.ts:255, 371, 405, 418, 451, 520, 592, 635, 772`.

**Transport gap:** `PresentationEvent` (`pure/types.ts:714`) carries no `abilityLabel`, `stacks`, `maxStacks`, `effectType` and no per-attack correlation id — confirmed in live batch payloads. So the client cannot render structured stacks or safely fold mitigation today.

**Full-mitigation evidence** (real committed batch, encounter `99a8e14b`, tick 7): `seq 1 block amount 18` then `seq 2 creature_hit amount 0`. Same tick/attacker/target, no identifier tying them together.

## Orbs of Fire: current Ignite application condition (reported, unchanged)

Verified in `resolver.ts:1829-1839` and `752-828`: the applier runs as a **heartbeat pulse, not a weapon trigger**. Once per tick, per engaged target, it fires **regardless of the hit outcome** — no swing, no to-hit roll and no damage requirement gate it. The only gates are: caster alive and present, target alive, the configured proc `chance`, and target still alive after the orb's own pulse damage. The Ignite stack is written even when the orb's pulse damage is 0.

That behavior is preserved exactly in this task. Any future change to the condition is a separate decision.

## Phase 2 gate: the repeated Ignite `[2/5]`

Evidence order: historical authoritative batches (`encounter_tick_batches`) plus any surviving `active_effects` ignite row for the same encounter/target. If the effect row has expired, reproduce with a deterministic resolver + `commit_encounter_tick_v3` test built from the same deployed configuration and two consecutive snapshots. No production fixture is created for the investigation.

What to isolate: the applier reads `stacksOf()` from the snapshot (`resolver.ts:790`) and writes `stacks: next` into `effectUpserts` (cap 5 matches the deployed `max_stacks`). So the value can be lost in three places — the resolver's snapshot read, `encounter_snapshot_v2`'s creature effect scope, or the commit's effect upsert (`stacks` not updated on conflict).

If stacks genuinely remain at two, all flavor implementation stops and the report states: expected transition, actual transition, which of the three layers lost the value, and the smallest proposed mechanics correction. Nothing is changed without approval, and no coalescing or client-side stack fabrication is used to hide it.

## Phase 3 implementation (presentation only)

### One presentation owner

Strict division, no duplicated rendering:

- **Resolver**: authoritative mechanics plus structured semantic presentation events. It selects and attaches the applicable authored **template identifier** and the structured values (never a finalized sentence, never first/second person). The existing generic string stays only as a compatibility fallback for older clients.
- **Catalog/snapshot**: carries `combat_text`, canonical ability label and effect label into the resolver so template selection is authoritative and deterministic.
- **Client presentation builder**: the single renderer — correlates and folds related events, applies viewer perspective (self / party / observer) and produces the final sentence.
- **EventLogLine**: styling and amount-token display only.

### Steps

1. **Canonical flavor keys + typed compatibility adapters** — new shared flavor module with canonical keys `cast, hit, miss, activate, pulse, apply, tick, mitigate, retaliate`. Legacy fields are adapted by value shape, not aliased blindly:
   - complete templates (`cast_text`, `hit_text`, `miss_text`, `pulse_text`, `stack_text`, `tick_text`, `activate_text`, `mitigate_text`, `retaliate_text`) map directly;
   - verb fragments (`hit_verb`, `miss_verb`) are composed into a sentence frame and never rendered as standalone prose;
   - target-specific templates (`self_text`, `ally_text`) keep their targeting context and are selected by resolved target relationship;
   - mechanic-specific templates (`proc_text`, `burn_text`, `heal_text`, `hit_no_stacks_text`) are bound to their own mechanic slot only.
   Canonical values win when both canonical and legacy exist. Unknown stored keys are preserved untouched. Resolution order: exact `abilityKey` -> ability fallback -> mechanic fallback -> generic.
2. **Resolver attaches templates, not prose** — the emit sites at `resolver.ts:780`, `820`, `2154`, `2186` and the ability hit/miss sites stop interpolating raw `abilityKey` and instead stamp `templateId` + structured values. Damage, hit and stack numbers unchanged.
3. **Structured metadata on `PresentationEvent`** — add `templateId`, `abilityKey`, `abilityLabel`, `effectType`, `effectLabel`, `stacks`, `maxStacks`, and for every resolved incoming attack: deterministic `groupId`, `attemptedAmount`, `mitigatedAmount`, `appliedAmount`, attacker id, defender id, mitigation source ability/effect, and attack outcome. `groupId` is derived deterministically in the resolver from tick + attacker + defender + attack ordinal (RNG-free, stable under replay); the client never invents or reconstructs it. Threaded through the batch payload and `decode-batch`/`encounter-batch`; commit SQL stores the payload verbatim, so no SQL change is expected.
4. **Orbs of Fire single line** — the client folds `stance_pulse` with its matching `stack_applied` (same `groupId`) and renders the authored `pulse_text`: `A flaming orb sears Granite Outlaw! [23, Ignite 2/5]`. Presentation metadata keeps the two identities separate — ability "Orbs of Fire", effect "Ignite". The later `dot_tick` remains its own line. Application condition untouched.
5. **Full-mitigation folding** — fold only when all hold: same deterministic `groupId`; `appliedAmount === 0`; `mitigatedAmount >= attemptedAmount`; and the outcome was a landed attack (never a miss, dodge, immunity or naturally zero result). Partial mitigation stays two lines in this pass. Both events remain in the batch; only the redundant `[0]` line is suppressed. Authored `mitigate`/`retaliate` template preferred, generic fallback otherwise.
6. **Fireball identity** — resolve cast/hit/miss by exact `abilityKey` before the `spell_attack` mechanic fallback, and author Fireball cast flavor so the generic "You shape the spell..." line disappears. Miss behavior and the T0 opener path untouched.
7. **Stance wording** — remove false fixed durations from Orbs of Fire and Envenom activate text and any `{seconds}s` on stances that persist until dropped or logout. Mechanics unchanged.
8. **Verb repetition** — stop the attack verb and damage fragment in `combat-text.ts` reusing the same verb (`strikes you, striking you firmly`). Secondary.
9. **Admin editor** — expose only slots with a real runtime consumer; write canonical keys, read legacy through the adapters, never drop unknown keys.

## Tests

All 17 listed cases as deterministic unit/integration tests: exact-key precedence, canonical-over-legacy precedence, each legacy shape adapted correctly (verb fragment never standalone, self/ally targeting retained), Fireball cast/hit/miss, Orbs pulse folding, separate DoT tick line, labels instead of raw keys, structured stacks, no client-side stack fabrication, fully-absorbed attack folded, no `[0]` line, naturally-zero not reported as blocked, partial mitigation not folded, miss/dodge/immunity not folded, two attacks in one tick correlating by distinct `groupId`, `groupId` stable across replay, all three perspectives grammatical, no double amounts, Holy Shield unchanged, stance text without false duration. Then full suite, typecheck and build.

## Scope boundary

Flavor and presentation contract only. No mechanic-authoring registry in this pass. On completion the report will state exactly what remains necessary for admin-created abilities to safely reuse absorb shield, block mitigation, stance pulse, stacking DoT and attached On-Hit Effect — as a separately approved follow-up.

## Guardrails honored

No changes to combat math, hit chance, damage, Ignite application condition, stack rules, costs, cadence, encounter authority, rewards or DB state. Phase 2 gate must pass first; nothing deploys until unit/integration results, typecheck and build are green.

