# Hybrid Encounter Architecture — Revised Roadmap (rev. 2)

Same overall direction as the previously approved plan. This revision closes the character-HP authority gap and folds in the eight refinements. Still planning-only.

## 1. Naming & Initial Scope (unchanged)

- Table: **`encounters`**, node-scoped initial schema.
- Identity: `UNIQUE (node_id, encounter_key) WHERE status = 'active'`.
- No `scope`/`scope_id` columns yet — added additively when a real region/world event exists.

## 2. Creature-HP Ownership Invariant (simplified)

**Invariant:** *at most one active encounter owns HP writes for any given live creature.*

Simplification per feedback — no conditional/partial index on parent status:

- `encounter_creatures` rows exist **only while the attachment is active**. Detachment = row delete.
- `UNIQUE (creature_id)` on the table (plain, not partial). Enforces the invariant directly and is queryable without joining to the parent.
- `encounter_ensure_for_creature(creature_id) → encounter_id` — atomic upsert that either returns the existing owner or creates the `default` encounter and inserts the attachment row.

### Detachment vs kill-resolver dependency

Before designing detachment, verify what `resolveCreatureKill` (and its callers) actually reads:

- `resolveCreatureKill` in `supabase/functions/_shared/kill-resolver.ts` is **pure**. Its inputs are `KillCreatureInput`, `recipients`, and `KillContext` — none of them reference `encounter_creatures`, encounter id, or attachment metadata.
- Callers in `combat-tick` / `combat-catchup` derive `recipients` from `combat_sessions` membership, not from encounter attachment.

Therefore the kill flow does **not** need the attachment row to survive the kill. Order of operations inside the kill RPC path:
1. Delta-damage RPC returns `caused_kill = true` and full creature snapshot needed for `resolveCreatureKill`.
2. Edge Function calls `resolveCreatureKill` in TypeScript.
3. Edge Function calls `encounter_detach_creature(encounter_id, creature_id)` (or the damage RPC does it in the same transaction when `caused_kill` is true — preferred, so respawn can safely re-attach immediately).

If a future feature needs post-kill attachment history, add an `encounter_creature_history` append-only table rather than keeping the primary row alive.

## 3. Delta HP RPCs — Semantics

Applies to **both** `creatures.hp` and `characters.hp`:

- Callers compute their intended delta from **their own invocation-time snapshot** (`intended_new_hp - snapshot_hp`, or a direct `amount` for abilities).
- The RPC applies that delta against **current DB HP** inside a single `UPDATE ... RETURNING` statement, clamped to `[0, max_hp]`.
- No `_expected_hp` / optimistic-version checks in the write path. This is what makes overlapping writers converge instead of clobber.
- Transition detection (`caused_kill`, `caused_downed`) uses the pre/post values from the same `UPDATE`.

### Advisory lock keys

Robust 64-bit derivation from the encounter UUID, not a hashed string prefix:

```sql
-- pseudocode helper
CREATE FUNCTION encounter_lock_key(_encounter_id uuid) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
  SELECT ('x' || substr(replace(_encounter_id::text,'-',''), 1, 16))::bit(64)::bigint
$$;
```

All encounter-scoped RPCs take `pg_advisory_xact_lock(encounter_lock_key(encounter_id))`. No string concatenation, no `hashtext` collisions across encounters.

## 4. Character HP Authority (new — resolves before M5)

**Problem:** telegraphed boss casts damage characters across many parties/solo sessions simultaneously. If a session tick writes `characters.hp` from its own stale snapshot after the cast resolves, it silently reverts the boss's damage.

**Rule:** during an active encounter, `characters.hp` for any character present at the node is written via **encounter-owned delta RPCs only**. Session ticks route their character HP writes through the same primitive.

### Two RPCs, delta-only

- `encounter_apply_character_damage(encounter_id, character_id, amount, source, source_cast_key?) → { new_hp, downed, caused_downed, version }`
- `encounter_apply_character_heal(encounter_id, character_id, amount, source) → { new_hp, version }`

Both:
- Take `pg_advisory_xact_lock(encounter_lock_key(encounter_id))`.
- Verify the character is in `encounter_participants` (see §5) — reject if not, so a departed player cannot be hit by a resolving cast.
- Apply delta against current DB HP, clamp, detect downed transition.
- Do **not** issue per-target broadcasts; the batched RPC (below) is authoritative for cast events.

### `encounter_cast_resolve` is one-shot, batched, transactional

Room-wide casts are resolved in a **single** RPC call, not fan-out:

```
encounter_cast_resolve(encounter_id, cast_key)
  ├─ advisory lock encounter
  ├─ atomically claim the cast row (UPDATE ... WHERE status='pending' RETURNING) — one caller wins
  ├─ read encounter_participants at claim time → eligible_characters
  ├─ for each eligible character: apply computed damage/heal via the same
  │   internal delta-write used by encounter_apply_character_damage
  │   (all inside this transaction, under the single advisory lock)
  ├─ if eligible_characters is empty AND cast has empty_room_heal_pct:
  │     apply healing to the boss creature via the creature delta-write
  ├─ write cast result (resolved_at, per-target outcomes) to a cast_events row
  ├─ mark cast status='resolved'
  └─ return { resolved: true, target_outcomes[], boss_heal_applied }
```

No per-target external RPC calls. The Edge Function gets one result payload it can broadcast as a single `encounter_cast_resolved` event. If the caller loses the atomic claim, the RPC returns `{ resolved: false, reason: 'already_resolved' }` and does nothing.

Session ticks that need to damage a single character (a creature's autoattack against one party member) still use `encounter_apply_character_damage` directly — same primitive, single-target case.

## 5. Presence, Observers, and Contribution (separated)

Three distinct concerns, three storage locations:

- **Node observers** — existing per-node presence (`node-<id>` channel presence / `nodes.current_occupants` derived state). Unchanged. Used for chat, "who's here," ambient UI. **Not** a source of truth for encounter targeting.
- **`encounter_participants`** — actual encounter participation. A row is written when a character:
  - performs a hostile action into the encounter (attack, ability, heal on a participant), OR
  - opts in via an explicit "join encounter" transition (future).
  Rows are removed on node-leave, death-out, disconnect timeout, or encounter end. This is the set `encounter_cast_resolve` reads for eligibility. Merely standing at the node is **not** enough.
- **`encounter_contributions`** — reward attribution ledger. Incrementally upserted by damage/heal RPCs. Used for future weighted loot / diagnostics. Never the sole source of truth for reward recipient sets; live/offscreen recipient rules stay as documented in `.lovable/memory/tech/combat-architecture/kill-resolution.md`.

## 6. Data Model

- `public.encounters` — as before (`node_id`, `encounter_key`, `status`, `state jsonb`, timestamps, `version`).
- `public.encounter_creatures (encounter_id, creature_id PK)` + `UNIQUE (creature_id)`. Row deleted on detach.
- `public.encounter_participants (encounter_id, character_id PK)` + `UNIQUE (character_id)` while active (same simple-row-delete model).
- `public.encounter_contributions (encounter_id, character_id, damage_dealt, healing_done, first_hit_at, last_hit_at)`.
- `public.encounter_cast_events (encounter_id, cast_key, resolved_at, payload jsonb)` — append-only audit + client-catchup source.
- All tables: RLS by node presence, standard GRANTs, service-role write via RPCs.

`combat_sessions` unchanged. `engaged_creature_ids` explicitly retained (not derivable from encounter participants).

## 7. Typed Transition RPCs (unchanged intent)

No unrestricted `jsonb` patching. Typed set:
- `encounter_phase_set`, `encounter_cast_start`, `encounter_cast_resolve` (see §4), `encounter_hazard_add/remove`, `encounter_summon`.
- Read helper: `encounter_snapshot(node_id)`.

## 8. Revised Incremental Milestones

Character-HP authority lands **before** the boss feature.

### M1 — Schema foundation (no behavior change)
Create all tables from §6 with FKs, RLS, GRANTs. Ship `encounter_ensure_for_creature`, `encounter_detach_creature`, `encounter_snapshot`, `encounter_end` stubs. `encounter_lock_key` helper.

### M2 — Delta creature-HP RPCs behind a feature flag
- Implement `encounter_apply_damage` / `encounter_apply_heal` for creatures.
- Rewrite `writeCreatureState` to compute deltas from its invocation snapshot and submit via the encounter RPC **when the flag is on**.
- **Flag is exclusive**: on = new path only, off = legacy path only. Never both in the same tick. Shadow comparison, if run, uses read-only parity harness (dry-run RPC returning would-be new_hp without mutating), not a second write.
- Parity tests include the two-party-same-creature race.

### M3 — combat-catchup routes through encounter creature RPCs
TypeScript effect math (`resolveEffectTicks`) and `resolveCreatureKill` stay put. Only the HP mutation call changes to the encounter path. Introduce `encounter_reconcile(node_id)` for housekeeping (stale participants, end-empty encounters, `last_activity_at`).

### M4 — Character-HP authority (**new milestone, prerequisite to M5**)
- Implement `encounter_apply_character_damage` / `encounter_apply_character_heal`.
- Implement `encounter_participants` maintenance in `combat-tick` (join on hostile action, leave on node change / death / disconnect timeout).
- Rewrite the session tick's character-HP writes to delta-only via the encounter RPC when the flag is on. Legacy absolute write remains behind the flag off.
- Parity harness: simulated overlapping "boss AoE + session tick" scenario must not lose the AoE damage under the new path and must lose it under the old path.

### M5 — Client encounter subscription
`useEncounter(nodeId)` + `encounter_snapshot` hydration. Broadcast `encounter_transition` alongside postgres_changes. Minimal display; no gameplay change.

### M6 — First consumer: Telegraphed Boss Abilities (v3 spec on new primitives)
- `encounter_cast_start` / `encounter_cast_resolve` (batched, see §4) handle the full lifecycle.
- Empty-room heal is a boss creature-HP delta applied inside `encounter_cast_resolve`, same transaction, same lock.
- No new schema; all built on M1–M4 primitives.

### M7 — Narrow session responsibilities (only what has moved)
Remove any remaining code that writes `creatures.hp` or `characters.hp` outside encounter RPCs. Update `.lovable/memory/tech/combat-architecture/*` to codify §2–§5 invariants. `engaged_creature_ids` stays.

### M8 — Optional hardening (future)
Region/world scope columns, PL/pgSQL effect ticks, `encounter_events` timeline UI, orphaned-encounter TTL sweep.

## 9. Commit / Defer

**Commit now (expensive to change later):**
- Table `encounters`, node-scoped identity.
- All shared HP writes (creature and character) go through encounter RPCs during active encounters.
- Delta-only writes computed from invocation snapshot, applied against current DB HP.
- `UNIQUE (creature_id)` on `encounter_creatures`.
- Advisory lock key derived from encounter UUID via `encounter_lock_key`.
- Room-wide cast resolution is one transactional RPC, not per-target fan-out.
- Feature flag is exclusive: never both write paths in one tick.

**Defer:**
- Region/world encounter scopes.
- Moving effect ticks / reward math into PL/pgSQL.
- Whether contributions ever drive reward attribution.
- Whether `engaged_creature_ids` eventually goes away.

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Boss AoE overwritten by session tick | M4 lands before M6; character HP is delta-only through encounter RPC |
| Cast resolves inconsistently across targets | Single transactional RPC applies all target deltas under one advisory lock |
| Stale attachment blocks respawn | Kill path detaches creature in the same transaction as the killing delta |
| Observer vs participant confusion | Presence and `encounter_participants` are separate tables; cast eligibility reads participants only |
| Silent HP drift during flag flip | Exclusive flag + dry-run parity harness; no dual-write mode |
| Advisory-lock collisions | 64-bit key derived from encounter UUID hex |

## 11. Out of Scope

Continuous server-side combat loop; rewriting `useCombatDriver` / `useCombatLifecycle`; porting effect/reward math to PL/pgSQL; dropping `engaged_creature_ids`; region/world scopes in initial schema.

## 12. Deliverables Checklist (post-approval)

- [ ] M1 schema + snapshot + attach/detach + lock-key helper
- [ ] M2 creature delta HP RPCs (exclusive flag, dry-run parity)
- [ ] M3 catch-up routed through encounter creature RPCs
- [ ] M4 character HP delta RPCs + participants maintenance + parity harness
- [ ] M5 `useEncounter` + transition broadcast
- [ ] M6 Telegraphed Boss Abilities on batched `encounter_cast_resolve`
- [ ] M7 legacy HP paths removed, memory docs updated
- [ ] M8 (deferred)
