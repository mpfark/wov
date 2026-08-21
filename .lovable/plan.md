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

## Phase 2 gate: the repeated Ignite `[2/5]`

Before any presentation change, prove the cause with authoritative data: the applier reads `stacksOf()` from the snapshot (`resolver.ts:790`) and writes `stacks: next` into `effectUpserts`; cap 5 matches the deployed `max_stacks`. Steps: dump one target's `active_effects` ignite row (id, stacks, expires) alongside consecutive committed batches for the same encounter, and read the effect-upsert branch of `commit_encounter_tick_v2` to confirm whether `stacks` is actually updated on conflict and whether `encounter_snapshot_v2` returns the creature's stack row into the resolver scope.

If the authoritative stacks genuinely stall at 2, work stops there and it is reported as a mechanics/persistence defect — no coalescing, no client-side incrementing, no mechanic change under this task.

## Phase 3 implementation (presentation only)

1. **Canonical flavor keys + compatibility map** — new `src/shared/combat/flavor/flavor-text.ts`: canonical `cast, hit, miss, activate, pulse, apply, tick, mitigate, retaliate`, with an alias table (`cast_text`, `hit_text`, `hit_verb`, `miss_text`, `miss_verb`, `activate_text`, `pulse_text`, `stack_text`, `tick_text`, `retaliate_text`, `mitigate_text`, `proc_text`, `self_text`, `ally_text`) so all deployed values keep working. Resolution: authored for exact `abilityKey` -> ability-specific compiled fallback -> mechanic fallback -> generic. Placeholder substitution stays structured (`{attacker} {target} {damage} {stacks} {max_stacks} {ability}`), never parsed back out of prose.
2. **Resolver consumes it** — the C3 catalog decode carries each ability's `combat_text` and `label` into the resolver snapshot, and the emit sites above render authored templates instead of raw keys. Damage/hit/stack numbers are unchanged; only the string and new metadata change.
3. **Structured metadata on `PresentationEvent`** — add `abilityLabel`, `effectType`, `effectLabel`, `stacks`, `maxStacks`, and a per-resolution `groupId` (attack/proc identity within a tick), threaded through the batch payload and `decode-batch`/`encounter-batch`. This is presentation metadata only; the commit SQL stores the payload verbatim, so no SQL change is expected.
4. **Orbs of Fire single line** — the client folds `stance_pulse` + its matching `stack_applied` (same `groupId`) into one line using the authored `pulse_text`: `A flaming orb sears Granite Outlaw! [23, Ignite 2/5]`. The later `dot_tick` stays its own line (`Ignite scorches Granite Outlaw. [9]`). Labels "Orbs of Fire"/"Ignite" come from metadata; the raw key never reaches prose.
5. **Full-mitigation folding** — fold a mitigation event with its zero-damage attack only when they share `groupId` and the mitigated amount covers the whole incoming hit. Both events stay in the batch; only the redundant `[0]` line is suppressed. Never fold misses, dodges, immunity, natural zero, partial mitigation, or a different attack in the same tick. Authored `mitigate`/`retaliate` template preferred, generic fallback otherwise.
6. **Fireball identity** — resolve cast/hit/miss by exact `abilityKey` before the `spell_attack` mechanic fallback; add Fireball cast flavor so the generic "You shape the spell..." line no longer appears. Miss behavior and the T0 opener path untouched.
7. **Stance wording** — remove the false fixed durations from Orbs of Fire and Envenom activate text (and any `{seconds}s` on stances that persist until dropped/logout). Mechanics unchanged.
8. **Verb repetition** — ensure the attack verb and the damage fragment in `combat-text.ts` don't reuse the same verb (`strikes you, striking you firmly`). Secondary to the above.
9. **Admin editor** — expose only slots with a real runtime consumer, writing canonical keys while preserving existing stored values (read alias, write canonical, never drop unknown keys).

## Tests

All 17 listed cases, as deterministic unit/integration tests: exact-key precedence, legacy `_text` compatibility, Fireball cast/hit/miss, Orbs proc folding, separate DoT tick line, labels instead of raw keys, structured stacks, no client-side stack fabrication, absorbed-attack folding, absent `[0]`, natural-zero not called blocked, partial mitigation not folded, two attacks in one tick correlating correctly, all three perspectives grammatical, no double amounts, Holy Shield unchanged, stance text without false duration. Then the full suite, typecheck and build.

## Guardrails honored

No changes to combat math, hit chance, damage, Ignite/stack behavior, costs, cadence, encounter authority, rewards or DB state. No deploy until unit/integration results are green; the Phase 2 gate must pass first, and any stack defect is reported rather than papered over.
