# C2 Design Checkpoint — Atomic Commit Contract (design only, no implementation)

Combat stays in maintenance. Nothing below is built until you approve it.

Everything is versioned: `SNAPSHOT_VERSION = 2`, `PROPOSED_TICK_VERSION = 2`. The commit refuses any payload whose version is not exactly 2.

---

## 1. Final versioned EncounterSnapshot (v2)

Additions on top of the approved C1 `EncounterSnapshot` (`src/shared/combat/pure/types.ts`); nothing is removed:

```text
snapshotVersion: 2
loadedAtMs                 authoritative clock read, loader only
claim: { token, tick, attempt, leaseUntilMs, mode, callerId }
encounterVersion           encounters.version at load
cursor: { tickNumber, tickAtMs, tickState, resolvingTick }
node: { id, tickRateMs }
storedPower: { current, effectiveCap }      <- single resolved cap
participants[].rowVersion  ( joined_at epoch ms, stable tiebreak )
participants[].equipment[] { inventoryId, slot, currentDurability, itemLevel, rarity, isUniqueWorldItem }
creatures[].effectiveDropChance             <- resolved number, never null
creatures[].rowVersion     ( last_damaged_at epoch ms | 0 )
actions[].rowVersion       ( submitted_at epoch ms )
actions[].clientSeq
effects[].rowVersion       ( created_at epoch ms )
```

Refinements you asked for, resolved in the loader:

**Loot probability precedence** (first non-null wins, result is always a finite 0..1 number):
1. `creatures.drop_chance`
2. `loot_pool_config` row matching `(loot_mode, rarity)`
3. rarity default from `loot_pool_config` global row
4. hard constant `0`

`CreatureSnapshot.dropChance` is deleted and replaced by `effectiveDropChance: number`. `-1`, `null` and "implicit fallback" cease to exist past the loader. Per-entry `lootTable[].chance` gets the same treatment (entry chance, else table default, else 0).

**Stored Power cap precedence** (single `effectiveStoredPowerCap`):
1. `encounters.stored_power_cap` when not null and > 0
2. boss `creatures.boss_cast->>'stored_power_cap'` of the highest-ordered living boss (`orderCreatures`)
3. `0` = feature inactive

`CreatureSnapshot.storedPowerCap` is removed; only `snapshot.storedPower.effectiveCap` exists.

**Session is not in the snapshot** as an authority input. Only `combat_sessions.id` + membership is carried, for presence bookkeeping.

## 2. Final versioned ProposedTick (v2)

C1 shape plus:

```text
proposedTickVersion: 2
snapshotVersion, encounterVersion, claimToken, tickNumber
effectiveNowMs
deaths: readonly CharacterDeathProposal[]
session: SessionPresenceProposal            <- derived UI/presence only
```

```text
CharacterDeathProposal {
  characterId
  tickNumber
  sourceKind: 'creature'|'boss_cast'|'dot'|'proc'|'stored_power'|'unknown'
  sourceCreatureId: string|null
  sourceCharacterId: string|null            (DoT applier attribution)
  sourceAbilityKey: string|null
  finalDamage: number
  overkill: number
}
```

Death rules (no duplicates): the resolver emits exactly one `CharacterDeathProposal` and exactly one `character_death` entry in `events` per character per tick, at the first transition `hpBefore > 0 → hpAfter <= 0`. Later damage in the same tick against an already-dead character is dropped, never re-emitted. `CharacterMutation.died` stays as the state flag; `deaths[]` is the attribution record; `events[]` is presentation. A golden test asserts one-death-per-character across direct, DoT and boss/Stored Power kill paths, including the same tick.

```text
SessionPresenceProposal {
  sessionId: string|null
  ended: boolean
  engagedCreatureIds: string[]
  memberIds: string[]
}
```
`last_tick_at` is **not** in the proposal and the commit never writes it. Cadence and ownership stay solely on `encounters.tick_number` / `tick_at` / `claim_token`.

## 3. Snapshot loader

One read RPC, `SECURITY DEFINER`, read-only, `SET search_path = public`:

```sql
public.encounter_snapshot_v2(_encounter_id uuid, _claim_token uuid, _tick bigint) returns jsonb
```

It refuses (`{"loaded": false, "reason": ...}`) unless the claim token, `resolving_tick` and unexpired lease all match — so the resolver can never simulate from a snapshot it does not own. It reads in one statement set: encounter, participants + characters + equipped inventory + items, attached creatures, engagements, pending `combat_actions` (`status = 'pending'` and `eligible_after_ms <= now`), `active_effects` for all targets, `applied_statuses`, procs from unique equipped items, `xp_boost`, `weapon_progression_config`, `loot_pool_config`, `loot_tables` + `loot_table_entries`, `combat_config`. Returns `snapshot_version`, `encounter_version`, `loaded_at_ms`, and the resolved loot/Stored Power values above. No writes, no `Math.random`, no client-supplied ids.

## 4. Ordering rules

Reuse `pure/ordering.ts` verbatim (participants by `joinedAtMs,id`; creatures boss→rare→regular then level desc then id; actions by `sequence` = `(submitted_at, client_seq, id)` rank; effects by targetKind,targetId,effectType,id; engagements by creature,character; procs by character,kind,id). The loader emits every array already sorted with the same comparators, so snapshot bytes are stable for a given DB state. Output arrays in `ProposedTick` are sorted with `sortIds` / `sortBy`.

## 5. Concurrency / version markers captured

`claim.token`, `claim.tick`, `claim.attempt`, `claim.leaseUntilMs`, `encounterVersion`, `cursor.tickNumber`, per-row `rowVersion` for participants, creatures, actions and effects. Commit compares: token, tick, `encounters.version`, and each creature/character HP-before against current row values.

## 6. Atomic commit RPC signature

```sql
public.commit_encounter_tick_v2(
  _encounter_id      uuid,
  _tick              bigint,
  _claim_token       uuid,
  _batch_id          uuid,
  _snapshot_version  integer,
  _encounter_version integer,
  _proposed          jsonb
) returns jsonb   -- { committed, reason?, tick, batch_id, committed_at, applied }
```

Single plpgsql function, `SECURITY DEFINER`, `SET search_path = public`, opens with `pg_advisory_xact_lock(encounter_lock_key(_encounter_id))`. Transaction order is exactly your required sequence: validate claim/snapshot → validate whole proposal → apply creature, character, effect, engagement, durability, loot, reward, cast, Stored Power mutations → consume/reject durable actions → advance cursor → insert one ordered batch → commit. Any validation failure `RAISE`s or returns `committed=false` **before** the first write; there is no partial path and `applyTickStateFallback` is deleted.

## 7. Field-by-field mapping

| ProposedTick field | Target |
| --- | --- |
| `characters[].hpAfter` | `characters.hp` (clamped 0..max_hp) |
| `characters[].cpAfter` | `characters.cp` (0..max_cp) |
| `characters[].mpAfter` | `characters.mp` (0..max_mp) |
| `characters[].absorbShieldAfter` | `characters.reserved_buffs -> absorb_shield` (single key write) |
| `characters[].stanceState` | `characters.stance_state` (whole typed object) |
| `rewards[].xp / .gold / .renown` | `characters.xp`, `.gold`, `.rp_total_earned` (+= ) |
| `rewards[].levelAfter`, `.maxHpAfter`, `.unspentStatPoints`, `.bhp` | `characters.level`, `max_hp`, `unspent_stat_points`, `bhp` |
| `deaths[]` | `characters.last_death_at`, `characters.last_death_log` |
| `creatures[].hpAfter`, `.killed` | `creatures.hp`, `is_alive`, `died_at`, `last_damaged_at`, `rewards_awarded_at` |
| `effectUpserts[]` | `active_effects` upsert on `(source_id,target_id,effect_type)` |
| `effectDeleteIds` / `effectDeleteTargetIds` | `active_effects` delete by `id` / `target_id` |
| `engagementsJoin[]` | `encounter_engagements` insert/refresh `last_action_at` |
| `engagementsPurgeCreatureIds` | `encounter_engagements` delete by creature |
| `durability[]` | `character_inventory.current_durability` (-1, floor 0) |
| `loot[]` | `node_ground_loot` insert |
| `materials[]` / `gems[]` | `character_materials.count` via `add_material` semantics inlined |
| `bonds[]` | `character_class_bonds` (via `award_class_bond_for_kill`) |
| `casts[]` | `encounter_cast_events` (`started_at`, `resolved_at`, `payload`, `expires_at`) |
| `storedPower[]` | `encounters.stored_power`, `stored_power_cap`, `stored_power_source_id` |
| `consumedActionIds` / `rejectedActions` | `combat_actions.status`, `consumed_tick`, `reject_reason` |
| `kills[]` | `encounter_kill_awards` (new idempotency ledger) |
| `session` | `combat_sessions.engaged_creature_ids`, `recent_member_ids`, or delete when `ended` — never `last_tick_at` |
| `events[]` | `encounter_tick_batches.payload.events` (one row) |
| `contributions` | `encounter_contributions.damage_dealt`, `healing_done`, `first_hit_at`, `last_hit_at` |

## 8. Database validation

Refused (nothing written) when: claim token mismatch; `tick_state <> 'resolving'`; `resolving_tick <> _tick`; `lease_until <= now`; `encounters.version <> _encounter_version`; `tick_number >= _tick` (already committed); `_snapshot_version <> 2` or proposal version `<> 2`; a batch row already exists for `(encounter_id, _tick)`.

Per-entity: every `characterId` must be an `encounter_participants` row of this encounter; every `creatureId` an `encounter_creatures` row attached to this encounter and at the encounter's node; every engagement pair must reference validated ids; every action id must be `pending` for this encounter and appear exactly once across `consumedActionIds ∪ rejectedActions`; every ability target must be a validated participant/creature; every `inventoryId` must belong to the named character and be equipped; loot `itemId` must exist and, for unique rarity, must not already exist in `character_inventory`, `node_ground_loot`, `marketplace_listings` or `vendor_inventory`; rewards only for characters listed in the matching `kills[].recipientCharacterIds`; effect upserts must reference validated target and source; cast events must reference an attached living boss and a target participant; Stored Power deltas must keep `0 <= stored_power <= effective cap`.

## 9. Bounds

HP `0..max_hp`, CP `0..max_cp`, MP `0..max_mp` — clamped in SQL with `least/greatest`, and the proposal is rejected if `hpBefore` disagrees with the stored row (lost-update guard). Durability `0..100`, one point per proposal entry, at most one entry per `(character, inventoryId)` per tick. XP/gold/renown deltas must be `>= 0`. Levels bounded `1..42`.

## 10. Idempotency

New table:

```sql
public.encounter_kill_awards (
  encounter_id uuid, creature_id uuid, character_id uuid,
  tick_number bigint, created_at timestamptz default now(),
  primary key (encounter_id, creature_id, character_id)
)
```
Rewards, materials, gems, bonds and loot for a kill insert `ON CONFLICT DO NOTHING`; when the insert reports no new row the whole reward group for that pair is skipped. `creatures.rewards_awarded_at` is set once and re-checked. Unique-item drops re-run the world-exclusivity check inside the transaction and are dropped silently (with an `events` note) if the item became taken. `encounter_tick_batches (encounter_id, tick_number)` uniqueness is the outer commit fence.

## 11. Durable action semantics

Every pending action in the snapshot must be terminal after the commit: `consumed` (applied) or `rejected` with one of `no_target | target_dead | caster_dead | insufficient_cp | not_eligible | stale_snapshot`. Actions that appeared after the snapshot load stay `pending` and are picked up by the next tick. `UPDATE ... WHERE status = 'pending'` makes replay a no-op.

## 12. Cursor and batch semantics

Cursor advances once, last: `tick_number = _tick`, `tick_at = commit clock read`, `tick_state = 'idle'`, `resolving_tick/claim_token/resolver_id/lease_until = NULL`, `attempt = 0`, `version = version + 1`, `last_activity_at = now()`. Exactly one `encounter_tick_batches` row per tick, payload `{ v: 2, tick, batch_id, events: [...ordered by seq], characters, creatures, deaths }`, with `ON CONFLICT (encounter_id, tick_number) DO NOTHING` plus a post-check that turns a conflict into `already_committed`. Batches older than 60s are pruned in the same statement set.

## 13. Stale / expired / duplicate

| Situation | Result |
| --- | --- |
| stale claim token | `committed=false, reason=stale_claim`, nothing written |
| expired lease | `reason=lease_expired`, nothing written; the tick is re-claimable |
| `tick_number >= _tick` | `reason=already_committed` |
| batch row exists | `reason=duplicate_batch` |
| encounter version drift | `reason=version_conflict` |
| HP-before mismatch | `reason=row_conflict` |
| unknown/invalid entity | `reason=invalid_proposal` + failing field |

In every case the resolver discards the tick and waits for the next claim. No retry loop re-applies partial state.

## 14. No arbitrary JSON column updates

The dynamic `EXECUTE format('UPDATE public.characters SET %s ...')` path from `commit_encounter_tick` is removed. v2 uses fixed, hand-written `UPDATE ... SET hp = ..., cp = ...` statements over a typed projection (`jsonb_to_recordset` with an explicit column list). Any key in the payload that is not in the declared list is ignored, and a strict-mode check rejects the commit if unknown keys are present. `reserved_buffs` and `stance_state` are written with `jsonb_set` on named keys only.

## 15. Post-commit publication (outbox)

The batch row *is* the outbox: written inside the transaction, so subscribers can only ever see committed ticks. After `COMMIT`, the edge function publishes a Realtime notification carrying `{ encounter_id, tick, batch_id }` only; clients read the ordered payload from `encounter_tick_batches` (existing `EncounterBatchSequencer` consumes it). Publication failure is a presentation-only issue — state is already durable and the next tick's batch closes the gap.

## 16. Transaction failure behaviour

Any exception inside the RPC aborts the whole transaction: no characters, creatures, effects, loot, rewards, actions, cursor or batch changes. The edge function logs, does not retry the same tick, and returns `{ committed: false, reason }`. Ownership self-heals when the lease expires.

## 17. Migrations and tests C2 will need

Forward migrations: create `encounter_kill_awards` (+ GRANTs, RLS, service_role policy); unique index `encounter_tick_batches (encounter_id, tick_number)` if absent; `encounters.version` bump trigger removal/confirmation; `encounter_snapshot_v2`; `commit_encounter_tick_v2`. Old `commit_encounter_tick` stays untouched until C5 cutover, then is dropped.

Tests: snapshot loader determinism and claim refusal; commit refusal matrix (all rows in §13) asserting zero writes; idempotent double-commit; unique-drop race; durable-action exhaustiveness; HP/CP/MP/durability clamping; death-event uniqueness across kill paths; loot/Stored Power precedence; "no unknown key" strict-mode rejection; end-to-end resolver→commit round trip on a seeded snapshot.

## 18. Decisions needing your approval

1. `encounter_kill_awards` as a permanent ledger (rows pruned with the encounter) vs. relying only on `creatures.rewards_awarded_at`. Recommended: the ledger, because party rewards are per-character.
2. Reject-on-`hpBefore`-mismatch (strict, may drop occasional ticks under out-of-band writes) vs. clamp-and-continue. Recommended: strict, since C3 makes the resolver the only writer.
3. `contributions` accumulation inside the commit (kept, as mapped) vs. dropping the table.
4. Boss cast rows: keep `encounter_cast_events` as the durable cast record (recommended) vs. folding casts into `encounters.state`.
5. Batch retention: keep 60s pruning (recommended) vs. a fixed row cap per encounter.
