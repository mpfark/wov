# Combat Replacement — Authoritative Plan (C-next, revision 3)

Read-only planning revision. Nothing was changed. Evidence: the original audit (installed schema via `pg_class`, `pg_proc`, `pg_policies`, `cron.job`, `information_schema.columns`, plus the current repository) and three narrow corrective read-only checks recorded in §7.1, §8 and §6b.

**Changed from revision 2:** §1 (claim lifecycle now separates last-committed tick from claimed candidate tick, with pseudocode), §4 (`node_encounter` gains `claimed_tick`; new §4a state-version and intent-cutoff contract), §6b (Battle Cry secondary effects approved and specified), §8 (conditional `character_effects` boundary approved; single authoritative `combat_flee` RPC approved), §9 (B2/B3/B4/B5/B7/B9/B11/B12/B13 updated), §10 (tests 30–53 added), §12 (previous questions 1–3 now decided). Everything else in revision 2 is retained.

Retained direction (unchanged): replacement rather than compatibility-preserving refactor; combat may stay unavailable throughout; authored world/NPC/creature/loot/item/class/ability content preserved; transient combat runtime state disposable; legacy compatibility paths, dual reads/writes, client combat authority and ignored `member_buffs` deleted; one node encounter owning shared creature state; solo players and multiple parties on the same spawn; newest present participant tanks; final damaging source owns the kill; the killer's eligible party shares the reward; bosses use the shared mechanic catalogue; telegraphs are simple delayed boss actions; frozen rosters, participation generations and general Stored Power retired; two-second authoritative cadence; no burst catch-up; committed events and rewards exactly-once.

## 1. Corrected architecture — hybrid: TypeScript rules, Postgres safety

The previous revision's single in-database `node_tick` PLPGSQL resolver is **replaced**. Combat math is not ported to SQL.

```text
client (display + intent only)
  |  POST /combat-intent  { character_id, ability_key?, target_creature_id? }   <- no state in body
  v
public.combat_intent(...)                  -- validates, writes one queued intent row (server seq)

dispatcher (pg_cron 1s wall clock) -> thin worker (Edge fn `node-tick`, TypeScript)
  1. public.node_tick_claim(node_id)       -- FOR UPDATE SKIP LOCKED; candidate_tick = tick + 1
                                           --   returns { encounter_id, last_committed_tick,
                                           --     candidate_tick, state_version, claim_token,
                                           --     intent_cutoff_seq, snapshot }
                                           --   DOES NOT advance node_encounter.tick
  2. resolveNodeTick(snapshot, seed)       -- PURE TypeScript. No IO. seed = (encounter_id,
                                           --   candidate_tick, stream). Returns ProposedTick.
  3. public.node_tick_commit(...)          -- atomic; applies only if claim + lease + last
                                           --   committed tick + state_version all still valid
  v
realtime: node_tick_batch rows             -- client renders committed events exactly once
```

**TypeScript owns game-rule resolution.** A new, substantially smaller pure resolver (`src/shared/combat2/`) owns: deterministic RNG; player and boss ability calculations; mechanic handlers; hit/crit/dodge/block decisions; damage and healing pipelines; mitigation and absorb ordering; target and tank selection; DoTs and periodic effects; reactive effects (Holy Shield); boss ability selection; delayed boss-action resolution; kill-source attribution; proposed reward eligibility; correctly ordered structured presentation events. It takes an immutable snapshot plus a seed and returns a proposed state transition. It performs no database writes.

Mechanics are small typed handlers (`mechanics/<key>.ts`, one file per catalogue entry, each `(ctx, ability, actor, target) => MechanicOutcome`) registered in a closed map — explicitly *not* another 3,000-line monolith. The existing shared formulas are imported directly (§3).

**Postgres owns state safety and atomicity**: authoritative `node_encounter`/`node_creature`/`node_fighter`/`node_intent`/`node_effect` rows; tick claim and locking; committed-tick identity; snapshot loading; narrow optimistic `state_version` validation; one atomic commit of HP, CP, MP, effects, participation, kills, rewards and event batches; unique tick/batch constraints; idempotent final rewards; rejection of stale or duplicate commits; durable committed presentation events.

### 1a. Tick claim and commit lifecycle (corrected)

Two distinct numbers, never conflated:

- `node_encounter.tick` — the **last successfully committed tick**. It advances only inside a successful commit.
- `node_encounter.claimed_tick` — the **currently claimed candidate tick** (`tick + 1`), non-null only while a claim is outstanding. An explicit column is used rather than inferring the candidate from `tick + 1` at commit time, so a stale proposal can be compared against the claim that is actually outstanding.

```text
node_tick_claim(node_id):
  SELECT ... FROM node_encounter WHERE node_id = $1 AND next_due_at <= now()
    FOR UPDATE SKIP LOCKED;                        -- locked/absent -> { ok:false, kind:'no_claim' }
  IF claimed_tick IS NOT NULL AND claim_expires_at > now()
      -> { ok:false, kind:'no_claim', reason:'in_flight' }   -- no lease captured, nothing written
  candidate_tick    := tick + 1;                   -- same value on a reclaim after lease expiry
  claim_token       := gen_random_uuid();
  claimed_tick      := candidate_tick;
  claim_expires_at  := now() + lease;
  intent_cutoff_seq := max(node_intent.seq) among pending intents for this encounter;
  RETURN { encounter_id, last_committed_tick: tick, candidate_tick, state_version,
           claim_token, intent_cutoff_seq, snapshot }   -- tick is NOT advanced

resolver: proposed := resolveNodeTick(snapshot, seed(encounter_id, candidate_tick))

node_tick_commit(encounter_id, claim_token, candidate_tick, expected_last_tick,
                 expected_state_version, intent_ids, proposed):
  SELECT ... FOR UPDATE;
  IF tick >= candidate_tick                        -> { ok:true,  kind:'already_committed' }
  IF claim_token <> stored OR claimed_tick <> candidate_tick
     OR claim_expires_at <= now()                  -> { ok:false, kind:'stale_claim' }
  IF tick <> expected_last_tick
     OR state_version <> expected_state_version    -> { ok:false, kind:'stale_snapshot' }
  -- single transaction from here: HP/CP/MP, effects, participation, deaths, rewards
  INSERT INTO node_tick_batch(encounter_id, tick=candidate_tick, events)  -- unique (enc, tick)
  INSERT rewards ON CONFLICT DO NOTHING            -- node_reward_claim idempotency
  UPDATE node_intent SET status='consumed' WHERE id = ANY(intent_ids)     -- exact ids only
  UPDATE node_encounter SET tick = candidate_tick,
         state_version = state_version + 1,
         claimed_tick = NULL, claim_token = NULL, claim_expires_at = NULL,
         next_due_at = greatest(now(), next_due_at) + interval '2 seconds';
  RETURN { ok:true, kind:'committed', tick: candidate_tick }
```

Worked example: last committed tick 10, claimed candidate 11. Successful commit → committed tick 11. Crash or stale commit → committed tick stays 10, nothing partially applied, and the next worker reclaims candidate tick 11 with the same `(encounter_id, 11)` seed, so no tick is skipped and the reclaimed resolution is identical for an identical snapshot.

**Result classifications** (always read from the structured body, never HTTP 200): claim → `committed`-eligible grant, `no_claim` (row locked, absent, or actively leased), `not_due`. Commit → `committed`, `already_committed`, `stale_claim`, `stale_snapshot`. Only `committed` writes anything.

**Why two workers cannot corrupt state.** The claim row lock with `SKIP LOCKED` means only one worker can even read a claim for an encounter at a time, and an actively leased claim yields `no_claim` without capturing a lease. After lease expiry a second worker may reclaim the *same* candidate tick with a *new* token; the first worker's late proposal then fails `stale_claim`. Independently, `state_version` fences any authoritative mutation that happened after the snapshot (§4a), and the unique `(encounter_id, tick)` on `node_tick_batch` makes a duplicated request a no-op. Every check and every write is in one transaction, so a rejected proposal writes nothing at all.

The claim → snapshot → resolve → commit sequence is retained but stripped of everything that existed for legacy compatibility: no digest recomputation round-trip, no live/catch-up duality, no `encounter_snapshot_v2` participation generations, no frozen cast state, no Stored Power, no migration of live encounters. The worker is thin: claim, call the resolver, commit, log one diagnostic line. It contains no alternate combat logic and no fallback path.

### Closed mechanic catalogue
`weapon_attack`, `spell_attack`, `multi_attack`, `burst_damage`, `dot_debuff`, `heal`, `hp_transfer`, `party_regen`, `absorb_buff`, `mitigation_buff`, `block_buff`, `evasion_buff`, `offense_buff`, `regen_buff`, `stealth_buff`, `control_debuff`, `stack_apply`, `stack_consume`, `aura_pulse`, `reactive_damage`. Twenty handlers; bosses use the same list.

## 2. Component classification (corrected)

| Component | Class |
|---|---|
| Authored content: `regions/areas/nodes/paths`, `npcs`, `creatures` (identity, stats, level, hp/max_hp, ac, respawn, loot, `boss_crit_flavors`, `boss_death_cry`), `loot_tables*`, `items`, `materials`, `classes`, `races`, `guide_*` | preserve unchanged |
| `abilities`, `base_abilities`, `class_ability_assignments`, `applied_statuses`, `character_ability_loadout` | preserve but simplify (drop dead columns, §7) |
| Character durable state: `characters`, `character_*`, `parties`, `party_members` | preserve unchanged (HP/CP/MP written only by the commit) |
| `src/shared/formulas/*` | **retained and imported by the new resolver** (per-file classification in §3) |
| `src/shared/combat/resolution.ts`, `damage-types.ts`, `creature-damage-modifiers.ts`, `ability-magnitude.ts`, `tick-rng.ts` | retained, imported directly — **not** ported to SQL |
| `src/shared/config/compose-ability.ts`, `effective-ability.ts`, `status-contract.ts` | preserve but simplify (drop legacy alias keys) |
| Presentation: `src/features/combat/events/*`, `combat-text.ts`, `perspective.ts`, `fold-groups.ts`, `EventLogPanel` | preserve but simplify (drop legacy adapter + client event builders) |
| `src/shared/combat/pure/resolver.ts` (2993 lines), `types.ts`, `effect-contract*.ts`, `boss-cast-schedule.ts` | replace (new small resolver + typed handlers) |
| `src/shared/combat/c2/*`, `c3/*`, mirrored `supabase/functions/_shared/combat/**` | delete |
| Edge `combat-tick`, `combat-catchup` | delete; replaced by thin `node-tick` worker + `combat-intent` |
| Client authority: `useCombatDriver`, `useBuffState`, `useGameLoop`, `combat-resolver.ts`, `combat-predictor.ts`, `stances.ts`, `tick-pacer.ts`, `tick-ack.ts`, `pending-actions.ts`, `opener-gates.ts`, `resync.ts`, `dispatch-durable-action.ts`, `mapServerEffectsToBuffState.ts`, `interpretCombatTickResult.ts`, `legacy-adapter.ts`, `useBossCasts`, `member_buffs` transport | delete |
| Runtime tables: `encounters`, `encounter_participants`, `encounter_engagements`, `encounter_creatures`, `encounter_cast_events`, `encounter_tick_batches`, `encounter_access_grants`, `encounter_kill_awards`, `encounter_death_loot`, `combat_actions`, `combat_sessions`, `active_effects`, `effects_catchup_dispatch`, `effects_catchup_log`, `combat_soak_access`, `combat_soak_scopes` | delete — **only in the final legacy-removal batch** (§9), kept read-only until then |
| `combat_audit_log`, `party_combat_log` | retire in the legacy batch; replaced by one slim structured diagnostic log (§8) |
| `combat_config` (`combat_mode`), `world_state`, `simulation_pause_state` | preserve but simplify — keep `combat_mode`, drop `combat_soak` |
| `node_ground_loot`, `loot_pool_config`, `xp_boost`, `weapon_progression_config` | preserve unchanged |
| `summon_requests` | preserve unchanged; summon deferred from the replacement (§8) |
| Uncertain | none of the previously listed items remain open except those in §12 |

## 3. One authoritative implementation of formulas

The earlier contradiction ("preserve `src/shared/formulas/*` unchanged" **and** "port formula constants into SQL") is resolved in favour of TypeScript. Postgres validates stored values and commit boundaries; it keeps no second copy of any combat calculation.

| formula module | class | note |
|---|---|---|
| `stats.ts` (modifiers, dice, diminishing) | retained | imported by resolver + handlers |
| `combat.ts` (hit/crit bands, AC, mitigation) | retained | single hit-quality authority |
| `resources.ts`, `cp/cp-math.ts` | retained | CP reservation and stance math |
| `ability-calc.ts` (v2 calc engine) | retained | drives authored `amount_calc`/`duration_calc` |
| `effective.ts`, `bond.ts`, `xp.ts`, `economy.ts`, `creatures.ts`, `items.ts`, `gems.ts`, `classes.ts`, `races.ts` | retained | unchanged consumers |
| `src/shared/combat/resolution.ts`, `creature-damage-modifiers.ts`, `damage-types.ts`, `ability-magnitude.ts` | retained | damage/heal/ward/amp primitives |
| `tick-rng.ts` | simplified | one seeded stream API `(encounterId, tick, stream, ...parts)`; drop per-call helper sprawl |
| `src/shared/combat/pure/*` (resolver, types, ordering, effect-contract, boss-cast-schedule) | replaced | superseded by the new resolver + handlers |
| `src/features/combat/utils/combat-resolver.ts`, `combat-predictor.ts`, `ability-calcs.ts` | deleted | client mirrors of server math |
| `supabase/functions/_shared/formulas/*` (byte-mirrors) | retained as mirrors | mirror script stays; no divergent logic |

No module is labelled "preserved unchanged" unless the new resolver imports it.

## 4. Runtime schema (corrected timing model)

| table | columns of note |
|---|---|
| `node_encounter` | `node_id` unique, `tick int not null` (**last committed tick**), `claimed_tick int null` (**candidate tick while claimed**), `state_version bigint`, `claim_token uuid`, `claim_expires_at timestamptz`, `intent_cutoff_seq bigint`, `next_due_at timestamptz`, `status` |
| `node_creature` | `creature_id`, `spawn_seq`, `hp`, `pending_action jsonb` (`{ability_key, resolve_at_tick}`), `tank_fighter_id` |
| `node_fighter` | `character_id`, `entry_seq bigserial` (authoritative "newest"), `present bool`, `party_id_at_entry` |
| `node_effect` | `kind`, `effect_type`, `target_character_id`/`target_creature_id`, `source_character_id`, `stacks`, `magnitude`, **`expires_at timestamptz`**, **`next_due_at timestamptz`**, `interval_ms`, `last_pulse_tick int`, `is_reservation bool` |
| `node_intent` | `id`, **`seq bigserial`** (server-assigned ordering identity), `character_id`, `ability_key`, `target_creature_id`, `status` (`pending`/`consumed`/`rejected`), `created_at`; at most one pending per character |
| `node_reward_claim` | unique `(creature_id, spawn_seq, character_id)` |
| `node_tick_batch` | unique `(encounter_id, tick)`, `events jsonb`, `created_at` |
| `boss_ability` | `creature_id`, `ability_key`, `weight`, `windup_ticks`, `targeting`, `magnitude/calc`, `damage_type`, `effect`, `telegraph_text`, `resolution_text` |
| `node_tick_log` | slim diagnostics (§8) |

### Tick and effect timing contract

- Lifetimes are **wall clock** (`expires_at`, `next_due_at`, both `timestamptz`). The integer `tick` exists for ordering, RNG seeding and commit identity only. `expires_at_tick`/`next_tick_at_tick` from revision 1 are removed.
- Authoritative cadence stays **2000 ms**. The dispatcher may poll more often (1 s) but must never create two authoritative ticks for one encounter less than 2 s apart (`next_due_at` guard inside `node_tick_claim`).
- A periodic effect pulses **at most once per authoritative tick**: the resolver pulses only if `next_due_at <= now` and `last_pulse_tick < tick`, then sets `next_due_at = max(now, next_due_at) + interval_ms`. Missed pulses are discarded, never accumulated. No burst catch-up.
- Duration continues in wall time regardless of pulses. Effects whose `expires_at` passed while the world slept are removed on wake **without** applying missed damage or healing.
- Late worker: one tick resolves, `next_due_at` re-bases to now; no simulated backlog.
- World sleep: dispatch disabled; on wake every encounter's `next_due_at` re-bases to `now()`.
- No present players: ticks continue while creatures are damaged or effects pend (offscreen DoTs); the encounter ends when nothing is pending. Empty-node telegraphs give the empty-ground result.
- **Stances are the documented exception**: their lifetime is controlled by activation/reservation/drop/death, not an expiry timestamp (`is_reservation = true`, `expires_at null`).

### 4a. State-version and intent-cutoff contract

`node_encounter.state_version` is the single optimistic fence. The rule: **any authoritative mutation that changes state included in a claimed snapshot must increment `state_version`**; anything that does not increment it must be provably excluded from the snapshot and deferred to the next tick.

Mutations that increment `state_version` (each performed by an authoritative RPC or the commit, never by a client):

| state | writer |
|---|---|
| fighter presence, entry/re-entry, departure, movement out of the node | `combat_intake`, `combat_flee` (§8), node-change trigger |
| character HP/CP/MP used by combat | commit; `combat_flee` opportunity damage |
| creature HP, death | commit |
| effect creation, mutation, deletion, expiry sweep | commit; stance intents |
| stance activation/drop (reservation) | stance intent RPC |
| creature spawn/respawn (`spawn_seq` bump) | respawn job |
| pending boss action | commit |
| tank-relevant entry order | presence writers above |
| party membership changes affecting reward eligibility | party RPCs (`node_encounter` bump for the encounters the character participates in) |
| anything else the resolver reads | by construction: if the resolver reads it, its writer bumps the version |

**Intent cutoff.** Intents are the one deliberate exception, so ordinary play never invalidates an in-flight tick. `node_intent.seq` is a server-assigned `bigserial` — client timestamps are never used for ordering. `node_tick_claim` records `intent_cutoff_seq = max(seq)` over pending intents and the snapshot contains only intents with `seq <= intent_cutoff_seq`, ordered by `seq`. Inserting an intent therefore does **not** bump `state_version`; a later intent stays `pending` and is picked up by the next tick. The commit consumes exactly the intent ids carried in the proposal (`WHERE id = ANY(intent_ids)`), never a range or a "all pending" predicate, so an intent submitted after the cutoff can never be marked consumed.

No digest system is reintroduced. One narrow exception is acknowledged: equipment changes read by the resolver (weapon dice, shield for Battle Cry's shield bonus — §6b) are not encounter-scoped writes. They are handled by including the equipment fields the resolver reads in the snapshot **and** bumping the encounter `state_version` from the equip/unequip path for encounters the character participates in; equipping is already blocked in combat, so the bump is cheap and rare. If that proves insufficient in B2, the fallback is to make equipment changes a combat intent — not to restore a digest.

## 5. Participation, tank, kill

**Participation.** `node_fighter` row on first intent or on being attacked; `entry_seq` from a bigserial. Leaving sets `present=false`; re-entry inserts a new `entry_seq`.

**Tank.** Highest `entry_seq` among present fighters, evaluated at resolution time, per creature. Party movement inserts followers before the leader, so the leader is newest and tanks by default. Death or departure drops a fighter from selection; the next-newest present fighter takes over.

**Kill.** Final damaging source owns it: direct hit → attacker; DoT tick → `node_effect.source_character_id`; reactive damage (Holy Shield) → the defender. Kill stealing allowed.

## 6. Reward rules (approved)

Party entry alone is **insufficient**. A party member becomes eligible for that exact spawn through at least one qualifying interaction: dealing damage; applying a damaging or controlling effect; healing or buffing a party member actively involved with that spawn; being attacked by the creature.

Eligibility belongs to `(creature_id, spawn_seq, character_id)`; survives leaving the node, death and disconnection; does not survive the creature's death/respawn; requires the character to still be in the killer's party when the creature dies; uses no contribution percentage or damage threshold. Solo final hit → that player only. Rewards insert into `node_reward_claim` in the same transaction as the death — exactly once.

**Telegraph.** Boss selects by weight; `windup_ticks > 0` writes `pending_action` and commits an announcement; at `resolve_at_tick` targeting is evaluated fresh (AoE → all present eligible players; single-target → current tank), resolves through the ordinary mechanic handler, then selection resumes. Leaving before resolution avoids it; re-entering restores eligibility. No frozen rosters, no generations, no Stored Power.

**Authoritative ability rule.** The client sends `{character_id, ability_key, target_creature_id}` only. CP costs, cooldowns, buffs, stances, DoTs, mitigation, absorb, evasion, retaliation and regeneration are all `node_effect` rows written by the commit. Nothing renders as active without an effect row — structurally removing the Divine Challenge local-state defect and the ignored `member_buffs` transport.

## 6b. Battle Cry secondary effects (approved) — authored parameters of `mitigation_buff`

Both authored secondary effects are implemented. Nothing is removed from the ability description or configuration, and the resolver contains **no Battle Cry identity check** — these are ordinary authored parameters of the shared `mitigation_buff` handler, equally available to any future ability or boss ability.

Narrow read-only evidence (installed rows): `battle_cry` is `mitigation_buff`, `amount_calc` = `0.10 + diminishing_float(STR, 0.02/pt, cap 0.12)` as `percent`, note "STR magnitude; +0.05 DR with a shield equipped", `effect_config` = `{mitigation_mode: percent, shield_dr_bonus: 0.05, applies_crit_reduction: true, resolved_by: combat-tick}`. `divine_challenge` is the same handler with `{mitigation_mode: flat, is_taunt: true}` and a WIS flat calc. So the shield bonus **already has an authored magnitude** (`shield_dr_bonus = 0.05`); crit softening is currently **only the boolean** `applies_crit_reduction`.

Handler parameters (authored, no hardcoding, no hidden fallback):

| parameter | meaning |
|---|---|
| `mitigation_mode` | `percent` or `flat` |
| `shield_dr_bonus` | additive percentage mitigation, applied only when the snapshot confirms an equipped shield |
| `crit_softening_pct` | **new authored field**; fraction of the critical *bonus* removed |
| `mitigation_ceiling_pct` | documented ceiling on total percentage mitigation |
| `is_taunt` | unchanged (Divine Challenge) |

**Shield bonus.** Applies only when the authoritative equipment snapshot shows an equipped off-hand shield (never from client state). Magnitude comes from `shield_dr_bonus`, is added to the resolved percentage mitigation, and the sum is clamped to `mitigation_ceiling_pct`.

**Critical-hit softening.** It reduces the *additional* damage a critical hit contributed. It never changes the attacker's crit chance and never rewrites hit quality after the roll. `softened = normal + critBonus * (1 - crit_softening_pct)`; with normal 40, critical 60 (bonus 20) and 50 % softening → 50, then ordinary mitigation applies.

**Damage-pipeline order** (single documented order for every incoming hit):
1. attack roll and hit quality (unchanged; softening does not touch it);
2. raw damage roll, including the critical bonus;
3. **crit softening** — reduce only the critical bonus;
4. attacker-side and target-side amplification (e.g. Chilled);
5. percentage mitigation: `mitigation_buff` percent contributions + `shield_dr_bonus`, clamped to the ceiling;
6. flat mitigation (Divine Challenge);
7. block reduction (`block_buff`);
8. absorb pool (`absorb_buff` — Force Shield, Divine Aegis) via `absorbFromShield`;
9. glancing/graded caps and floors;
10. HP resolution via `resolveDamage`.

**Authoring gate.** `crit_softening_pct` must be authored before the ability is published: the ability-mapping batch (B7) either adds it to `battle_cry`'s configuration or fails the batch. No default is invented in code; a missing magnitude means "no softening applied" **and** a failed authoring assertion, never a silent fallback percentage.

Every mitigation step emits structured metadata on the combat event (`percentMitigated`, `shieldBonusApplied`, `critSoftened`, `flatMitigated`, `blocked`, `absorbed`) so the log can explain the number without recomputing it.

## 7. Ability reconciliation (36 assignments → 20 handlers)

| handler | abilities |
|---|---|
| `weapon_attack` | power_strike, aimed_shot, backstab, weapon_attack (autoattack) |
| `spell_attack` | fireball, frost identity (§7.1), judgment, smite, cutting_words |
| `multi_attack` | barrage |
| `burst_damage` | grand_finale |
| `dot_debuff` | rend |
| `heal` | heal, second_wind |
| `hp_transfer` | transfer_health |
| `party_regen` | purifying_light, crescendo |
| `absorb_buff` | force_shield, divine_aegis |
| `mitigation_buff` | battle_cry, divine_challenge |
| `block_buff` | shield_wall |
| `evasion_buff` | cloak_of_shadows, disengage |
| `offense_buff` | arcane_surge, eagle_eye |
| `regen_buff` | inspire |
| `stealth_buff` | shadowstep |
| `control_debuff` | dissonance, natures_snare, sunder_armor |
| `stack_apply` | ignite, envenom |
| `stack_consume` | conflagrate, eviscerate |
| `aura_pulse` | consecrate |
| `reactive_damage` | holy_shield |

Authored columns retained: `label`, `description`, `tooltip`, `damage_type`, `target_type`, `activation_mode`, `cp_cost`, `cp_reserve_pct`, `amount_calc`, `duration_calc`, `interval_ms`, `mechanic_calcs`, `combat_text`, `accuracy_stat`, primary/secondary attribute, `class_scale`, and the consolidated Status Application fields. Dropped after mapping (no consumer): `effect_config` legacy alias keys, `calc_version`, `base_abilities.capabilities`/`on_hit_allowed`/`allowed_target_types`, `trigger_type` duplicates of `status_trigger`.

### 7.1 `frostbolt` vs `frost_bolt` — evidence

Narrow installed check (read-only) of both rows against assignments, loadouts, base-ability references and authored text:

| key | label | mechanic | class assignments | loadout rows | base_ability_id | description |
|---|---|---|---|---|---|---|
| `frostbolt` | Frostbolt | `spell_attack` | **1** | 0 | `bdf214f8…` | "A bolt of frost that damages and chills the enemy…" |
| `frost_bolt` | Frost Bolt | `spell_attack` | 0 | 0 | `7d59f353…` | "A lance of splintering ice, slower to shape than flame…" |

Both are authored and both reference distinct base abilities, so neither is deleted on the basis of its name. `frostbolt` is the **active authored identity** (it carries the only class assignment). During ability mapping: keep `frostbolt` as the live identity, compare the two authored descriptions/calculations and merge any better authored wording into it, then delete `frost_bolt` plus its now-unreferenced base ability if that base ability has no other referencing row. If the check at mapping time shows `frost_bolt`'s base ability is shared, it is retained and only the duplicate ability row is removed.

## 8. Boss reconciliation, logging, and the deferred/parked decisions

**Boss data survives:** `creatures.name/description/level/hp/max_hp/stats/ac/rarity/is_humanoid/is_aggressive/respawn_seconds/loot_table_id/drop_chance/loot_mode`, `boss_crit_flavors`, `boss_death_cry`, and the authored intent inside `boss_cast` (28 boss rows), re-authored into `boss_ability` rows. The `label` vs `ability_key` identity ambiguity is resolved once at authoring time — no fallback mapping.

**Boss runtime retired:** `encounter_cast_events` and its lifecycle, `cast_key`/payload plumbing, `encounter.stored_power*`, `spawn_seq`-fenced cast recovery, participation generations, frozen target rosters, `creatures.rewards_awarded_at`/`last_damaged_at` (moved into runtime tables).

**Logs.** `combat_audit_log` and `party_combat_log` are retired. The new system has one slim structured diagnostic log (`node_tick_log`): encounter id, tick number, claim/result classification, resolver/build version, elapsed ms, failure code. No duplicated player-facing prose. Player-facing history comes from committed `node_tick_batch` events (plus the existing client log archive).

**Wimp / flee / summon / teleport (approved contract).** Fleeing is **one authoritative `combat_flee(character_id, direction)` RPC**, not an asynchronous intent-to-movement handoff. In a single coordinated authoritative operation it: verifies ownership and current combat/node state; validates the requested direction/path against the existing authored movement rules; validates movement locks (locked connections, key items) and resource requirements (MP cost, cooldown); resolves any authored flee/opportunity damage; applies that damage; **prevents movement if the character dies**; moves the surviving character; sets their `node_fighter.present = false`; removes them from tank eligibility; **preserves reward eligibility already earned** for the current `(creature_id, spawn_seq)`; emits the authoritative structured flee/damage result into the node's committed event stream; and increments the encounter `state_version` so any in-flight proposal that assumed their presence is fenced (§4a). Wimp uses the same contract with its configured direction. Summon is deferred from the first replacement unless a retained ability requires it (`summon_requests` untouched). Ordinary teleport is unavailable during combat unless an explicitly authored ability permits it. Ordinary out-of-combat movement and the parked general movement-security work stay **outside** this replacement; the RPC reuses the existing authored movement/path/lock/cost rules rather than redesigning them.

**Stances.** Same authoritative action/effect framework: activation and dropping are server intents; reservation and available CP are authoritative; the semantic state is a `node_effect` row with `is_reservation = true`; no client stance authority; no client renders a stance active without authoritative confirmation; lifetime is controlled by reservation/drop/death. The existing `activate_stance`/`drop_stance`/`clear_stances`/`enforce_stance_effect_lifetime` RPCs are replaced by the intent/effect route, not preserved for compatibility.

**Non-combat effects.** Narrow reconciliation before `active_effects` is removed. A read-only check of current contents shows only combat rows (`battle_cry`, `holy_shield`, `shield_wall`, one row each), i.e. no food/inn/consumable rows are live today. Before deletion, batch B12 must additionally grep every writer (consumable hooks, inn/rest paths, edge functions) for non-combat `effect_type` values; any found are moved to a character-level home (`character_effects`, keyed by `character_id` with wall-clock `expires_at`) rather than into the node combat table, and nothing durable is silently deleted. This is not permission for a general consumable/progression redesign.

## 9. Implementation batches (dependency-ordered, no intermediate combat, no shims)

- **B0 Maintenance boundary.** `combat_mode='maintenance'`; disable existing combat workers and scheduled combat jobs; stop old handlers accepting new combat work. **No truncation and no drops.** Old runtime tables stay intact, read-only, as reconciliation and rollback evidence.
- **B1 New schema.** Create the isolated replacement tables of §4 with grants (`SELECT` to `authenticated` scoped by node/character, `ALL` to `service_role`), RLS, indexes and constraints. Nothing shares a name with a legacy table.
- **B2 Snapshot + atomic commit contract.** `node_tick_claim` (SKIP LOCKED, monotonic tick, `next_due_at` 2 s guard, snapshot + `state_version`) and `node_tick_commit` (claim/version validated, single transaction, unique `(encounter_id, tick)`, idempotent rewards). No game mechanics yet.
- **B3 Resolver foundation.** Typed `NodeSnapshot`/`ProposedTick`, seeded RNG, deterministic ordering, ordered structured events, retained formulas imported. Golden-snapshot tests.
- **B4 Core mechanics.** Attacks, damage, healing, effects, CP, death.
- **B5 Shared-node participation.** Multiple parties, newest-present tank, presence transitions.
- **B6 Kill and reward authority.** Final-hit ownership, qualifying participation, exactly-once rewards.
- **B7 Retained player abilities.** All 36 assignments mapped through the closed catalogue; frost identity resolved per §7.1; dead ability columns dropped; movement/rest callers of the old party HP RPCs re-pointed.
- **B8 Simplified boss abilities.** Author `boss_ability` from `boss_cast`; delayed actions; empty-node result.
- **B9 World clock and dispatcher.** 1 s dispatcher, 2 s authoritative cadence, late-worker behaviour, sleep/wake re-basing, `combat-intent` endpoint.
- **B10 Frontend replacement.** Intent-only client, server-effect-driven buff display, `node_tick_batch` cursor; presentation layer kept.
- **B11 Acceptance and parity verification** (§10) while combat stays in maintenance.
- **B12 Cutover.** Reset creature combat state in place (`hp=max_hp`, `is_alive=true`, death/reward timestamps null — rows never deleted), activate the new loop, `combat_mode='open'`. Non-combat-effect reconciliation completed here.
- **B13 Legacy deletion.** Only after successful cutover evidence: drop the 16 legacy runtime tables, the ~60 retired functions, obsolete triggers/policies/jobs, `member_buffs`, `combat_soak`, `combat_audit_log`, `party_combat_log`, and the deleted frontend modules.

### Migration safeguards (corrected)
1. Content-freeze assertion first: `DO` blocks asserting expected row counts for `regions/areas/nodes/creatures/npcs/items/abilities/classes`, aborting on mismatch. No `DROP` in that migration.
2. Deletion is an explicit named list; `DROP TABLE` never uses `CASCADE` across schemas; nothing with a foreign key from durable player data is dropped. `characters`, `character_inventory`, `character_materials`, `parties` untouched.
3. Creature combat state is reset in place, never deleted.
4. Cron off before functions are dropped; new jobs added last.
5. `combat_mode='maintenance'` for the whole sequence; flipped last.
6. Every migration idempotent; the drop batch runs only in B13.

## 10. Acceptance tests

Retained (1–12): solo ten-tick sanity with no client writes; two parties + one solo on one shared HP pool with identical committed events; kill stealing rewards only the killer's eligible party; tank order A,B,C → C, C leaves → B, C returns → C, party movement → leader; leave/re-entry targeting eligibility; healer-only eligibility; offscreen DoT kill attribution; reactive (Holy Shield) kill attribution; delayed boss ability resolving at N+k with AoE/tank/empty-node variants and no boss autoattack during wind-up; effect expiry including across a sleep boundary; duplicate tick → one batch; exactly-once rewards.

Added (13–29):
13. Two workers attempt the same tick → one claim, one batch, the other returns `no_claim`.
14. Stale snapshot version rejected before any partial state write (HP, effects, rewards all unchanged).
15. Resolver determinism: identical snapshot + seed → byte-identical `ProposedTick`.
16. Delayed worker: each periodic effect pulses at most once.
17. Effect expiring during sleep is removed on wake with no pulse.
18. Divine Challenge creates an authoritative `node_effect` row and measurably reduces damage.
19. Battle Cry percentage reduction applies from the effect row.
20. Battle Cry shield bonus and crit-softening: implemented and tested, or explicitly removed from authored wording/configuration (decision recorded in the mapping batch).
21. Instant defensive abilities (Divine Aegis, Disengage) enter the authoritative action/effect system — no instant client-only application.
22. Holy Shield event ordering: retaliation event precedes death and reward events.
23. Holy Shield final-hit ownership with exactly-once rewards.
24. Boss telegraph resolves against the node/tank current at resolution.
25. Leaving before resolution avoids the delayed action.
26. Re-entering before resolution restores eligibility.
27. No stale "gathers force" event addressed to an ineligible historical target.
28. Player-facing committed batches render exactly once (replay/duplicate delivery safe).
29. No ability can appear active in the UI without an authoritative effect row.

## 11. Parts of the original plan that cannot support these corrections

- §1 "resolution runs in the database as one SQL/PLPGSQL transaction" and "no Edge Function required for the core loop" — replaced by §1 hybrid.
- §2 row classifying `resolution.ts`/`tick-rng.ts` as "port to SQL" — replaced by §3 retained-and-imported.
- §4 `node_effect` `expires_at_tick`/`next_tick_at_tick` — replaced by wall-clock `expires_at`/`next_due_at` in §4.
- §9 **B0** "truncate runtime tables" — replaced by the non-destructive maintenance boundary; deletion moves to B13.
- §9 **B2** "mechanic catalogue + resolver core in SQL" — replaced by B2/B3/B4.
- §11 unresolved questions 1–8 — now decided in §3, §4, §6, §7.1 and §8.

## 12. Genuinely unresolved questions

1. **Battle Cry secondary effects** — the authored wording implies a shield bonus and crit softening that the current implementation does not apply. Implement both, or amend the authored text? (Test 20 covers either outcome; the decision is authoring, not architecture.)
2. **Non-combat effect home** — if B12's writer grep finds live food/inn/consumable effects, confirm the proposed `character_effects` table as their home rather than extending `node_effect`.
3. **Flee coordination** — flee touches both combat presence and movement. Confirm the preferred contract: a single authoritative `combat_flee` RPC that also performs the move, or a combat intent that emits an authoritative move request.

---

This turn was read-only planning. No repository file other than this plan document was written, and no schema, data, migration, job, grant, policy, Edge Function, configuration, combat mode or world state was changed. The only database access was two narrow read-only `SELECT` queries (the frost-identity check in §7.1 and the `active_effects` contents check in §8).
