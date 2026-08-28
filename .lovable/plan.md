# Combat Replacement — Authoritative Plan (C-next)

Read-only planning. Nothing was changed. Evidence: installed schema (`pg_class`, `pg_proc`, `pg_policies`, `cron.job`, `information_schema.columns`) and the current repository.

## 1. Proposed architecture

One loop, one writer, one shape.

```text
client (display + intent only)
  |  POST /combat-intent  { character_id, ability_key?, target_creature_id? }   <- no state in body
  v
public.combat_intent(...)            -- validates, writes one queued intent row
  |
scheduler (pg_cron 1s: node_tick_dispatch)  -- wall clock only
  v
public.node_tick(node_id)            -- ONE function: claim -> resolve -> commit, single txn
  |    reads: node_encounter, node_creature (shared HP), node_fighter, node_effect, node_intent
  |    writes: same tables + node_tick_batch (presentation) + durable rewards
  v
realtime: node_tick_batch rows       -- client renders committed events exactly once
```

Key simplifications versus today:
- Resolution runs **in the database** as one SQL/PLPGSQL transaction per node tick. The claim/lease/digest/version/snapshot round-trip between an Edge Function and Postgres (`claim_encounter_tick` → `encounter_snapshot_v2` → `encounter_state_digest` → `commit_encounter_tick_v3`) disappears; atomicity comes from `SELECT ... FOR UPDATE` on the encounter row plus a unique `(encounter_id, tick)` batch key.
- Edge Functions keep only what needs non-SQL work: none for the core loop. `combat-tick` and `combat-catchup` are retired. (If AI-authored text is ever needed at tick time, it stays out of the loop.)
- One resolver serves solo, party, multi-party, boss and offscreen effects. No live/catch-up split: a late tick is just a tick.
- Mechanics become a **closed catalogue** implemented once, shared by player and boss abilities.

### Closed mechanic catalogue (target)
`weapon_attack`, `spell_attack`, `multi_attack`, `burst_damage`, `dot_debuff`, `heal`, `hp_transfer`, `party_regen`, `absorb_buff`, `mitigation_buff`, `block_buff`, `evasion_buff`, `offense_buff`, `regen_buff`, `stealth_buff`, `control_debuff`, `stack_apply`, `stack_consume`, `aura_pulse`, `reactive_damage`.

Twenty mechanics; every one of the 21 installed base mechanics maps in (see §6). Bosses use the same list.

### New runtime tables (all combat-runtime, all disposable)
| table | purpose |
|---|---|
| `node_encounter` | one row per node with live combat: `tick`, `next_due_at`, `status`, lock target |
| `node_creature` | shared spawn state: `creature_id`, `spawn_seq`, `hp`, `tank_fighter_id`, `pending_action` |
| `node_fighter` | participation: `character_id`, `entry_seq` (bigserial — authoritative "newest"), `present`, `party_id_at_entry` |
| `node_effect` | every persisted effect (player + creature), `expires_at_tick`, `next_tick_at_tick`, `source_character_id` |
| `node_intent` | queued player action, at most one unresolved per character |
| `node_reward_claim` | idempotency key `(creature_id, spawn_seq, character_id)` |
| `node_tick_batch` | committed presentation events, unique `(encounter_id, tick)` |

Boss telegraph = `node_creature.pending_action` (`{ability_key, resolve_at_tick}`). No cast table, no cast lifecycle RPCs, no Stored Power.

## 2. Component classification

| Component | Class |
|---|---|
| Authored content: `regions/areas/nodes/paths`, `npcs`, `creatures` (identity, stats, level, hp/max_hp, ac, respawn, loot_table_id, `boss_crit_flavors`, `boss_death_cry`), `loot_tables*`, `items`, `materials`, `classes`, `races`, `guide_*` | preserve unchanged |
| `abilities`, `base_abilities`, `class_ability_assignments`, `applied_statuses`, `character_ability_loadout` | preserve but simplify (drop dead columns, §6) |
| Character durable state: `characters` progression/inventory/renown, `character_*`, `parties`, `party_members` | preserve unchanged (HP/CP/MP written only by the tick — separate objective already logged) |
| `src/shared/formulas/*` (rolls, stats, damage types, xp, economy, bond) | preserve unchanged — reused by the new resolver |
| `src/shared/combat/resolution.ts`, `damage-types.ts`, `creature-damage-modifiers.ts`, `ability-magnitude.ts`, `tick-rng.ts` | preserve but simplify — port to SQL or keep as the single magnitude/mitigation source |
| Presentation: `src/features/combat/events/*`, `combat-text.ts`, `perspective.ts`, `fold-groups.ts`, `EventLogPanel` | preserve but simplify (drop legacy adapter + client event builders) |
| `src/shared/combat/pure/resolver.ts` (2993 lines), `types.ts`, `effect-contract*.ts`, `boss-cast-schedule.ts` | replace |
| `src/shared/combat/c2/*`, `c3/*` and the mirrored `supabase/functions/_shared/combat/**` | delete |
| Edge `combat-tick`, `combat-catchup` | delete |
| Client authority: `useCombatDriver` (1703 lines), `useBuffState`, `useGameLoop`, `combat-resolver.ts`, `combat-predictor.ts`, `stances.ts`, `tick-pacer.ts`, `tick-ack.ts`, `pending-actions.ts`, `opener-gates.ts`, `resync.ts`, `dispatch-durable-action.ts`, `mapServerEffectsToBuffState.ts`, `interpretCombatTickResult.ts`, `legacy-adapter.ts`, `useBossCasts`, `member_buffs` transport | delete |
| Runtime tables: `encounters`, `encounter_participants`, `encounter_engagements`, `encounter_creatures`, `encounter_cast_events`, `encounter_tick_batches`, `encounter_access_grants`, `encounter_kill_awards`, `encounter_death_loot`, `combat_actions`, `combat_sessions`, `active_effects`, `effects_catchup_dispatch`, `effects_catchup_log`, `combat_soak_access`, `combat_soak_scopes` | delete/reset |
| `combat_audit_log` (9k rows), `party_combat_log`, `world_slumber_log` | delete/reset (truncate; logs only) |
| `combat_config` (`combat_mode`), `world_state`, `simulation_pause_state` | preserve but simplify — keep `combat_mode`, drop `combat_soak` |
| `node_ground_loot`, `loot_pool_config`, `summon_requests`, `xp_boost`, `weapon_progression_config` | preserve unchanged |
| Uncertain — needs decision | `active_effects` for **non-combat** buffs (food/inn) if any; whether `combat_audit_log` is kept as a thin new-loop audit; whether `party_combat_log` survives now that `node_tick_batch` carries shared events |

## 3. Installed-schema inventory affected

**Tables (delete/reset, 16):** listed above; sizes 32–240 kB each except `combat_audit_log` (5 MB).

**Functions to drop (retired loop):** `claim_encounter_tick`, `commit_encounter_tick_v2`, `commit_encounter_tick_v3`, `encounter_snapshot_v2`, `encounter_state_digest`, `encounter_intake`, `encounter_engage`, `encounter_disengage`, `encounter_ensure_for_character`, `encounter_ensure_for_creature`, `encounter_end`, `encounter_end_participation`, `encounter_reconcile`, `encounter_resync_snapshot`, `encounter_detach_creature`, `encounter_for_node`, `encounter_lock_key`, `encounter_live_owner_active`, `encounter_has_pending_work`, `encounter_death_id`, `encounter_attribution_roster`, `encounter_apply_damage`, `encounter_apply_heal`, `encounter_apply_character_damage/heal/resource`, `encounter_boss_start_cast`, `encounter_boss_resolve_cast`, `encounter_boss_fizzle_cast`, `encounter_stored_power_add/consume/set_cap`, `activate_stance`, `drop_stance`, `clear_stances`, `enforce_stance_effect_lifetime`, `cancel_combat_action`, `damage_party_member`, `heal_party_member`, `update_party_member_hp`, `degrade_party_member_equipment`, `award_party_member` (both overloads), `award_class_bond_for_kill`, all `effects_*` (11), all `catchup/soak` checks, `prune_encounter_tick_batches`, `prune_encounter_access_grants`, `prune_terminal_combat_actions`, `prune_combat_audit_log`, `sweep_stranded_encounters` + their `guarded_*` wrappers.

Movement/rest callers of `damage_party_member` / `heal_party_member` / `award_class_bond_for_kill` must be re-pointed at the new equivalents in the same batch (§9 B4) — these are the only non-combat consumers found.

**Triggers:** on `encounters`, `encounter_participants`, `combat_actions`, `active_effects`, `applied_statuses`, `combat_config`, `party_combat_log` — dropped with their tables or rewritten for the new tables. `characters`' departure trigger (generation rotation) is replaced by `node_fighter.present = false`.

**Policies:** all policies on the 16 deleted tables. New tables get read-only-to-`authenticated` policies scoped by node/character, writes reserved for the tick (`service_role`/owner). No client writes.

**Scheduled jobs:** remove `prune-encounter-tick-batches`, `prune-encounter-access-grants`, `prune-terminal-combat-actions`, `prune-combat-audit`, `sweep-stranded-encounters`, `prune-effects-catchup-log`, `expire-timed-state`. Keep `world-watchdog` (respawns), `purge-ground-loot`, `return-unique-items`, `prune-logs`, `idle-shutdown-check`. Add `node-tick-dispatch` (1s) and `prune-node-tick-batch` (5 min).

## 4. Frontend combat writer/reader inventory

| file | today | after |
|---|---|---|
| `useCombatDriver.ts` | writes: intents, HP/CP/MP, buffs, casts, `member_buffs`, pacing, acks | delete; replaced by ~200-line `useCombatIntent` (send) |
| `useBuffState.ts` | owns 14 local buffs incl. Divine Challenge | delete; buffs read from `node_effect` |
| `useGameLoop.ts` | client regen, expiry, cooldowns | delete; regen/expiry are tick-owned |
| `combat-resolver.ts`, `combat-predictor.ts`, `ability-calcs.ts` | client damage math | delete (calc previews may stay read-only in tooltips) |
| `stances.ts`, `useBossCasts.ts`, `tick-pacer/ack`, `pending-actions`, `resync`, `opener-gates` | client authority | delete |
| `useEncounterBatches.ts`, `encounter-batch.ts` | sequencer/gap recovery | replace with a simple "last rendered tick" cursor over `node_tick_batch` |
| `useCreatureBroadcast`, `useMergedCreatureState` | client HP merging | replace with direct reads of `node_creature` |
| `events/*`, `EventLogPanel`, `log-archive` | render committed events | keep |
| `StatusBarsStrip`, `GamePage` buff props | read local buff objects | keep component, feed from server effects |

## 5. Contracts

**Tick.** `node_encounter.tick` is a monotone integer; identity = `(encounter_id, tick)`. Cadence 2000 ms of authoritative time. `node_tick_dispatch` runs every second and calls `node_tick` for encounters with `next_due_at <= now()`.
- *Late worker*: resolve **exactly one** tick and set `next_due_at = now() + 2s`. No burst catch-up. Periodic effects use the documented rule: **one pulse per tick maximum; missed pulses are dropped, but duration still expires in wall time** (skip-not-stack).
- *World sleep*: dispatch is disabled; on wake, every encounter's `next_due_at` is re-based to `now()` and effects whose `expires_at` passed during sleep expire without damage (Policy C, unchanged).
- *Duplicate request*: unique `(encounter_id, tick)` on `node_tick_batch` makes the second commit a no-op; the caller gets `{ok:true, kind:'already_committed'}`. Result classification is always the structured body, never HTTP status.
- *No present players*: the tick still runs while creatures are damaged or effects exist (offscreen DoTs), then the encounter ends when nothing is pending. Empty-node telegraphs produce the empty-ground result.

**Participation.** `node_fighter` row created on first intent or on being attacked; `entry_seq` from a bigserial. Leaving the node sets `present=false`; re-entry inserts a new `entry_seq`.

**Tank.** Tank = the present fighter with the highest `entry_seq`, evaluated at resolution time, per creature. Party movement inserts followers before the leader, so the leader is newest and becomes tank. Death or departure drops the fighter from selection and the next-newest present fighter takes over.

**Kill.** The source of the final damaging hit owns the kill: direct hits → attacker; DoT ticks → `node_effect.source_character_id`; reactive damage (Holy Shield) → the defender. Kill stealing allowed.

**Reward.** Solo owner → owner only. Party owner → eligible members of the owner's party at death. **Recommendation: eligibility requires one qualifying interaction** (damage dealt, damaging/controlling effect applied, heal/buff on an involved party member, or being attacked by that spawn) — party entry alone does not qualify. This includes healers and supports while preventing tag-along rewards. Eligibility is recorded per `(creature_id, spawn_seq, character_id)` and survives leaving, death and disconnect; it dies with the spawn. No damage thresholds. Rewards insert into `node_reward_claim` (unique key) in the same transaction as the death — exactly once.

**Telegraph.** Boss selects an ability by weight; if it has `windup_ticks > 0` the tick writes `pending_action` and commits an announcement event; at `resolve_at_tick` targeting is evaluated fresh (AoE → all present eligible players; single-target → current tank), the ability resolves through the ordinary mechanic, and selection resumes. Leaving before resolution avoids it; re-entering makes you eligible again. No frozen rosters, no generations, no Stored Power.

**Authoritative ability rule.** Client sends `{character_id, ability_key, target_creature_id}` only. CP costs, cooldowns, buffs, stances, DoTs, mitigation, absorb, evasion, retaliation and regeneration are all rows in `node_effect` written by `node_tick`. A buff cannot render unless a `node_effect` row exists — this structurally removes the Divine Challenge defect and the ignored `member_buffs` transport.

## 6. Ability reconciliation (36 assignments, 21 base mechanics)

| new mechanic | abilities |
|---|---|
| `weapon_attack` | power_strike, aimed_shot, backstab, weapon_attack (autoattack) |
| `spell_attack` | fireball, frost_bolt, judgment, smite, cutting_words |
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
| `reactive_damage` | holy_shield (renamed from `reactive_holy`) |

Every ability maps with no new mechanic invented. `frostbolt` is a duplicate key of `frost_bolt` — resolve by deleting the unused row (decision Q4).

Authored columns retained: `label`, `description`, `tooltip`, `damage_type`, `target_type`, `activation_mode`, `cp_cost`, `cp_reserve_pct`, `amount_calc`, `duration_calc`, `interval_ms`, `mechanic_calcs`, `combat_text`, `accuracy_stat`, `primary/secondary_attribute`, `class_scale`, status application (`status_*`, `applied_status`/`on_hit_effect` consolidated onto the single Status Application model already in place).

Columns with no real consumer in the new system (drop after mapping): `effect_config` legacy alias keys, `calc_version`, `base_abilities.capabilities`/`on_hit_allowed`/`allowed_target_types` (validation-only), `trigger_type` duplicates of `status_trigger`.

## 7. Boss reconciliation

**Survives:** `creatures.name/description/level/hp/max_hp/stats/ac/rarity/is_humanoid/is_aggressive/respawn_seconds/loot_table_id/drop_chance/loot_mode`, `boss_crit_flavors`, `boss_death_cry`, and the authored intent inside `boss_cast` (28 boss rows).

**Migrated:** `boss_cast` JSON is re-authored into `boss_ability` rows `{creature_id, ability_key, weight, windup_ticks, targeting, magnitude/calc, damage_type, effect, telegraph_text, resolution_text}`. Legacy identity ambiguity (`label` vs `ability_key`) is resolved once at authoring time — no fallback mapping.

**Retired:** `encounter_cast_events` and its whole lifecycle, `cast_key`/payload plumbing, `encounter.stored_power*`, `spawn_seq`-fenced cast recovery, participation generations, frozen target rosters, `creatures.rewards_awarded_at` / `last_damaged_at` (moved into runtime tables).

## 8. Deletion/reset migration strategy

Safeguards, in order, one migration each:
1. **Content freeze assertion.** Migration begins with `DO` blocks asserting expected row counts for `regions/areas/nodes/creatures/npcs/items/abilities/classes` and aborting on mismatch. No `DROP` in this migration.
2. **Runtime-only deletion list is explicit.** Only the 16 tables named in §3 plus the named functions; `DROP TABLE` never uses `CASCADE` across schemas, and no `DROP` touches a table with a foreign key from durable player data. `characters`, `character_inventory`, `character_materials`, `parties` are untouched.
3. **Creature reset, not delete.** Combat state on `creatures` is reset in place (`hp = max_hp`, `is_alive = true`, `died_at/rewards_awarded_at/last_damaged_at = null`, `boss_cast` retained until §7 authoring completes) — rows are never deleted.
4. **Cron off first.** Disable all combat jobs before dropping their functions, re-add the two new jobs last.
5. `combat_mode = 'maintenance'` for the entire sequence; it is the last thing flipped.
6. Every migration idempotent (`if exists` / `if not exists`), and the drop batch runs only after the new loop's tests pass.

## 9. Implementation batches (no intermediate combat required)

- **B0** Close combat: `combat_mode='maintenance'`, disable combat cron, truncate runtime tables. Content untouched.
- **B1** Schema: create the 7 new runtime tables with grants (read-only `authenticated`, `ALL service_role`), RLS, indexes, and `boss_ability`.
- **B2** Mechanic catalogue + resolver core in SQL: attack/damage/heal resolution reusing the shared formula constants; `node_tick` claim→resolve→commit with unique `(encounter_id, tick)`.
- **B3** Participation, tank, kill ownership, reward eligibility and idempotent reward commit.
- **B4** Ability mapping: map all 36 assignments onto the catalogue; re-point movement/rest callers of the old party HP RPCs; drop dead ability columns.
- **B5** Boss abilities: author `boss_ability` from `boss_cast`, wind-up telegraphs, empty-node result.
- **B6** Intent endpoint + `node_tick_dispatch` cron + world sleep/wake re-basing.
- **B7** Frontend: delete the client-authority modules, add `useCombatIntent`, batch cursor, server-effect-driven buff display; keep the presentation layer.
- **B8** Legacy drop: drop the 16 tables, ~60 functions, obsolete triggers/policies/jobs, `member_buffs`, `combat_soak`.
- **B9** Acceptance tests (§10), then reopen combat.

## 10. Acceptance tests

1. Solo: 10 ticks, one action per tick, HP monotone, no client writes.
2. Two parties + one solo on one creature: single shared HP, all three see identical committed events.
3. Kill stealing: last hit from party B while party A did 90% → only B's eligible members are rewarded.
4. Tank change: entry order A,B,C → tank C; C leaves → B; C returns → C again; party movement → leader is tank.
5. Leave/re-enter: departure removes targeting eligibility; re-entry restores it with a new entry sequence.
6. Healer eligibility: healer only heals a party member, never touches the creature → still rewarded.
7. Offscreen DoT kill: applier leaves the node, DoT kills → applier owns the kill, party rewarded once.
8. Reactive kill: Holy Shield retaliation lands the final blow → defender owns the kill.
9. Delayed boss ability: announced at tick N, resolves at N+k against the tank present at N+k; AoE hits all present; empty node → empty-ground result; no boss autoattack during wind-up.
10. Effect expiry: buff/DoT expires at its tick; across a sleep boundary it expires without damage.
11. Duplicate tick: two concurrent `node_tick` calls for the same tick → one batch, one set of effects, second returns `already_committed`.
12. Exactly-once rewards: repeated death commits and duplicate ticks produce exactly one `node_reward_claim` per member.

## 11. Unresolved questions (approval needed)

1. **Reward eligibility** — confirm the recommendation: one qualifying interaction required, party entry alone insufficient.
2. **Tick cadence** — keep 2000 ms authoritative, or change now while nothing is live?
3. **In-DB resolution** — confirm moving resolution from the Edge Function into `node_tick` (removes ~10k lines of TS but moves combat math into SQL and away from the vitest suite; mitigation: formula constants stay shared and the suite gets a SQL-fixture harness).
4. **`frostbolt` vs `frost_bolt`** — delete the duplicate ability row (which one is authored?).
5. **Logs** — truncate and retire `combat_audit_log` and `party_combat_log`, or keep a slim audit on the new loop?
6. **Wimp/flee, summon, teleport-in-combat** — carried over as intents in B6, or deliberately dropped for now?
7. **Stances** — reserve-CP stances become ordinary long-lived `node_effect` rows with a reserved-CP field; confirm no separate stance table/RPCs.
8. **Non-combat `active_effects`** (food/inn buffs) — do any exist that must survive the table drop?

## Anything unproven

The exact set of non-combat callers of `damage_party_member`/`heal_party_member`/`award_class_bond_for_kill` was read from the repo, not exercised at runtime; B4 must re-verify before dropping them. Boss `boss_cast` payload completeness across all 28 bosses was not field-by-field validated in this turn.
