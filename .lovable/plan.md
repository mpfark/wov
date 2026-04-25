## Analysis: how reward/kill handling works today

There are **two execution paths** that can kill a creature and grant rewards. They follow the *same conceptual order* but live in different files, with subtle drift.

### Path 1 — Live combat (`combat-tick`)
Runs while ≥1 player is actively attacking on the node.

- A single `handleCreatureKill(creature, killerLabel, chaForGold)` closure handles every kill source: weapon hit, off-hand, ability, proc, or DoT tick (DoT-from-resolver kills are routed through it explicitly to avoid duplicate loot).
- It calls `calculateCreatureRewards()` from `_shared/reward-calculator.ts` — the single source of truth for math.
- **Recipients = `members[]`**, which is everyone in the active `combat_session` (party at node, or just the solo player). There is no branching "if party else solo"; solo is just `members.length === 1`.
- Per-member XP/gold/salvage/BHP is accumulated into `mXp/mGold/mBhp/mSalvage` maps and applied during the post-tick character `UPDATE` along with level-up logic.

### Path 2 — Offscreen reconciliation (`combat-catchup`)
Runs when a player wakes up an adjacent/leader node where DoTs (poison/bleed/ignite) were ticking after everyone walked away.

- Resolves all elapsed effect ticks via `resolveEffectTicks`, gets `cKilled` set.
- Atomically claims `creatures.rewards_awarded_at` (idempotency guard you just added).
- For each claimed kill: looks up the **DoT source character**, fetches their accepted party, decides recipients = party-mates if in a party, else just the source.
- Calls `award_party_member` RPC per recipient (does XP + level-up + gold + salvage in one DB function), then a separate `bhp` update.
- Broadcasts `party_combat_msg` (third-person) + per-recipient `party_reward` (with `nonce` + `source_character_id` for client dedup), plus `world-global` boss death cry.
- **Does NOT use `calculateCreatureRewards`** — it open-codes the same formulas inline (baseXp, gold roll, CHA mult, salvage, BHP, party XP bonus is *missing* here).

### Standards / order of operations (what the code actually does)

There is no "party-first then solo-fallback" branch. The order, in both paths, is:

```text
1. Determine recipients
   - combat-tick: every member in the combat_session at the kill node
   - combat-catchup: party of the DoT-source character, or just the source if soloing
2. Compute totals once (baseXp, gold roll, BHP, salvage)  ← party-aware (CHA from best member, party XP bonus)
3. Split per recipient
   - XP: per-recipient level penalty, then divide by uncapped count
   - Gold/BHP/salvage: floor-divide by recipient count
4. Apply per recipient (XP triggers level-up, max_hp/cp/mp recalc)
5. Side-effects: loot drops, boss death cry, broadcasts
```

Solo is just party-size-1. There is no separate solo code path conceptually — it diverges only because catchup re-implements step 2/3 by hand.

## Problems this causes

1. **Two implementations of the same math.** `combat-catchup` is missing the party XP bonus (1.0 / 1.15 / 1.30 / 1.40), so killing a level-30 boss with DoTs while offscreen pays *less* than killing it live with the same party. It also picks the "primary" CHA (DoT source) rather than the best CHA in the party.
2. **Inconsistent display vs. award math.** Live path produces `displayReward` from the chosen uncapped member; catchup uses `primaryChar` (the DoT source) which may be capped → mismatched log message vs. actual XP for other members.
3. **Reward-message generation is duplicated** in two unrelated string-builders → already caused the recent "Cithrawiel's power…" / "Your power…" duplication.
4. **No catchup-time loot for `item_pool` mode.** `processLootDrops` runs on `result.lootQueue`, but `resolveEffectTicks` only emits `lootQueue` entries based on `creature.loot_table` legacy entries — `item_pool`/`salvage_only` aren't honored offscreen.
5. **BHP grant in catchup bypasses any future bhp logic** because it does a raw `UPDATE characters SET bhp = ...` instead of going through `award_party_member` (which already accepts xp/gold/salvage but not bhp).
6. **No "killer label" recorded for catchup kills.** Live path uses the killing player's name (or `'DoT'`); catchup just uses the DoT source's name as both killer and reward primary, which is fine but undocumented.

## Proposed standardization

**One shared kill-resolution module** that both edge functions call. Each path stays responsible for *gathering inputs* and *applying outputs*; the shared module owns the rules.

### New shared module: `supabase/functions/_shared/kill-resolver.ts`

Pure functions, no DB. Responsibilities:

- `resolveCreatureKill(creature, killer, recipients, ctx) → KillOutcome`
  - Calls existing `calculateCreatureRewards` (already correct).
  - Builds the canonical event messages (the "☠️ … slain …" line, BHP line, salvage line, transcend variant, party-bonus note).
  - Builds the loot-queue entries based on `loot_mode` (`item_pool` / `legacy_table` / `salvage_only`) — the live path's logic, lifted out.
  - Returns `{ memberRewards, events, lootQueue, bossDeathCry, displayMember }`.

This is the single place that defines "what happens when a creature dies". Solo and party are the same code path with `recipients.length === 1` vs `> 1`.

### `combat-tick` changes

- Replace the body of `handleCreatureKill` with: build `recipients` from `members`, call `resolveCreatureKill`, accumulate `mXp/mGold/mBhp/mSalvage` from `memberRewards`, push returned `events` and `lootQueue` entries.
- Keep the post-tick character-update / level-up / equipment-degrade code untouched.

### `combat-catchup` changes

- Build `recipients` from the party (or solo source) as today.
- Call `resolveCreatureKill` instead of the inline math block (lines ~347–404).
- Apply `memberRewards` via `award_party_member` for XP/gold/salvage, and either:
  - extend `award_party_member` to take `_bhp`, OR
  - keep the separate `bhp` update but route it through a tiny `award_bhp` RPC for consistency.
- Use the shared `events[0]` text as the broadcast `party_combat_msg` body (kills the duplicate-message divergence permanently).
- Honor `lootQueue` properly so `item_pool` creatures drop offscreen too.

### Recipient-set rules (documented in the new module's header)

```text
Live combat (combat-tick):
  recipients = combat_session.members at the kill node
  → solo player OR full party-at-node

Offscreen catchup (combat-catchup):
  recipients = accepted party of the DoT source character
                if source is in a party (regardless of where members are);
              otherwise [source] only.
  Rationale: DoT damage is "remote labor" by the source — they share with their
  party the same way live kills do, but solo kills only pay the source.
```

This matches today's behavior; the plan just makes it explicit and documented in one place.

### Migration

- Optional: `award_party_member(_character_id, _xp, _gold, _salvage, _bhp DEFAULT 0)` overload so catchup can do one RPC per recipient instead of two writes.
- `respawn_creatures()` already clears `rewards_awarded_at` — no change needed.

### Files touched

- New: `supabase/functions/_shared/kill-resolver.ts`
- Edit: `supabase/functions/combat-tick/index.ts` (replace `handleCreatureKill` body, ~80 lines net deletion)
- Edit: `supabase/functions/combat-catchup/index.ts` (replace inline reward block, ~70 lines net deletion)
- Optional migration: extend `award_party_member` with `_bhp`

## Out of scope

- Changing the actual reward formulas (XP, gold, CHA, BHP, salvage, party bonus) — math stays identical, just relocated.
- Changing the offscreen wakeup trigger logic in `useOffscreenDotWakeup`.
- Changing the idempotency guard (`rewards_awarded_at`) — it stays.

## Expected wins

- One place to read when answering "how does a kill pay out?"
- Catchup gets the missing party XP bonus and best-CHA gold automatically.
- Duplicate / divergent log strings become impossible.
- `item_pool` creatures finally drop loot when killed offscreen.
- Future tweaks (e.g. boss-only multipliers, new currencies) land in one file.
