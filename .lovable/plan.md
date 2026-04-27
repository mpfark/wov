# Refactor: Boss Hunter Points → Renown

Rename the existing `bhp` system to **Renown** (shorthand **RP**), expand it so **rare** creatures also award Renown (in addition to bosses), and add a lifetime-earned counter so a future **Renown Board** can rank characters by total Renown gained.

## Naming conventions (player-facing)

- UI name: **Renown**
- Shorthand: **RP** (only in tight spaces — status bars, table headers, variable names)
- Trainer node: **Renown Trainer**
- Future leaderboard: **Renown Board**
- Reward message: `🏛️ +N Renown`
- Use `Available Renown` and `Lifetime Renown` (not "Renown Points")
- Avoid repeated "Renown Points (RP)" in normal UI text

## Data model

Keep the existing `characters.bhp` (current spendable balance) and `characters.bhp_trained` (per-stat ranks already trained) **physically named the same in the database** to avoid a wide rename migration and a regenerated `types.ts`. Throughout the UI we expose them as Renown / `renown_trained`. Internally the storage column stays `bhp`.

Add **one new column**:

- `characters.rp_total_earned integer not null default 0` — lifetime sum of Renown gained. Never decreases. This is what the future Renown Board will rank on.

Available Renown to spend = `characters.bhp` (existing column, relabeled in UI).
Lifetime Renown = new `rp_total_earned`.
Total spent = `rp_total_earned - bhp` (derived; no column needed).

A short code comment is added near the `Character` type (and any equivalent server-side mapping) so future edits aren't confused:

```ts
// `bhp` is legacy storage for current Renown balance.
// `bhp_trained` is legacy storage for Renown training ranks.
// Only the player-facing name changed; the columns kept their original names
// to avoid a wide rename across types.ts and edge functions.
```

Migration steps:
1. `alter table characters add column rp_total_earned integer not null default 0;`
2. Backfill: `update characters set rp_total_earned = bhp;` (lifetime ≥ current balance; safe lower bound for existing players).

No rename of `bhp` / `bhp_trained` columns. (Optional cleanup pass later — not in this change.)

## Reward formula (tuned)

In `supabase/functions/_shared/reward-calculator.ts`:

```
rare:    max(1, floor(level × 0.10))   (new — small but meaningful)
boss:    floor(level × 0.50)           (existing — remains the main source)
others:  0
```

Reference values:
- Lv 10 rare → 1 Renown
- Lv 20 rare → 2 Renown
- Lv 40 rare → 4 Renown
- Lv 60 rare → 6 Renown

Internally we keep the field on `MemberReward` named `bhp` to minimize churn across `kill-resolver`, `combat-tick`, `combat-catchup`, `usePartyCombat`, `interpretCombatTickResult`, etc. A code comment marks it as legacy storage for Renown.

## Server-side awarding

In `combat-tick/index.ts` and `combat-catchup/index.ts`, wherever `updates.bhp = ... + mr.bhp` is written:
- Also increment `updates.rp_total_earned = (c.rp_total_earned || 0) + mr.bhp`.
- Mirror in the `member_states` payload so the client can update local state.

`interpretCombatTickResult.ts` adds `rp_total_earned` to the typed `myState` and forwards it into `characterUpdates`.

`usePartyCombat.ts` adds the same field when ingesting party reward broadcasts.

`useOffscreenDotWakeup.ts` and `GamePage.handleCatchupRewards` add a matching `rp_total_earned` increment alongside the existing `bhp` increment.

## Trigger guard

`restrict_party_leader_updates()` currently caps `bhp` so the client cannot raise it on its own. Extend the same protection to `rp_total_earned`:

```
if NEW.rp_total_earned > OLD.rp_total_earned then
  NEW.rp_total_earned := OLD.rp_total_earned;
end if;
```

so only trusted RPCs / server functions can grow it.

The existing `award_party_member` RPC (overload with `_bhp`) also needs to bump `rp_total_earned` by the same `_bhp` amount in the same `update characters set ...` statement. Done in the same migration.

## UI relabel

- `BossTrainerPanel.tsx` → renamed to `RenownTrainerPanel.tsx`. Title: **🏛️ Renown Trainer**. Replace "BHP" with "RP" only where compact (chips, table cells); use "Renown" everywhere else. Tooltip: `🏛️ +N Renown trained`. Footer note: *"Earn Renown by slaying rare and boss creatures."*
- `CharacterPanel.tsx` — relabel the BHP balance row. Show **Available Renown** (= `character.bhp`) and **Lifetime Renown** (= `rp_total_earned`). Visible whenever lifetime > 0 or level ≥ 30.
- `StatusBarsStrip.tsx` — change `🏋️ N BHP` to `🏛️ N RP` (compact slot, RP shorthand allowed).
- `kill-resolver.ts` event message: `🏛️ +N Renown` (was `🏋️ +N Boss Hunter Points`). Event type renamed to `renown_award` (update the one consumer in `usePartyCombat.ts` filter list — `bhp_reward` → `renown_award`).
- `useOffscreenDotWakeup.ts` and `GamePage.tsx` catchup summaries: replace `BHP` text with `Renown` (e.g. `+4 Renown`).
- `GameManual.tsx` — rewrite the BHP accordion as **🏛️ Renown**. Training unlocks at Lv 30+, but Renown is **earned from level 1**. Reward formula: `max(1, floor(level × 0.10))` for rare, `floor(level × 0.50)` for boss; split among party.
- `NodeEditorPanel.tsx` checkbox label and `MapPanel.tsx` / `NodeView.tsx` / `PlayerGraphView.tsx` tooltips: **Renown Trainer** instead of "Boss Trainer". (Underlying flag stays `is_trainer`.)
- Replace 🏋️ icon with 🏛️ wherever it referenced BHP.

## Out of scope (future work)

- The actual Renown Board UI/page.
- Renaming the physical `bhp` / `bhp_trained` columns and the `_bhp` RPC parameter — left as-is to avoid touching `types.ts` and every server function in one go.

## Files touched

Migration:
- `supabase/migrations/<new>.sql` — add `rp_total_earned`, backfill, extend `restrict_party_leader_updates`, update `award_party_member(_bhp)`.

Server:
- `supabase/functions/_shared/reward-calculator.ts` (new rare formula + legacy-name comment)
- `supabase/functions/_shared/kill-resolver.ts` (message + event type)
- `supabase/functions/combat-tick/index.ts` (write `rp_total_earned`)
- `supabase/functions/combat-catchup/index.ts` (write `rp_total_earned`)

Client:
- `src/features/character/hooks/useCharacter.ts` — `Character` type adds `rp_total_earned`; legacy-storage comment on `bhp` / `bhp_trained`
- `src/features/combat/utils/interpretCombatTickResult.ts`
- `src/features/combat/hooks/usePartyCombat.ts`
- `src/features/combat/hooks/useOffscreenDotWakeup.ts`
- `src/features/creatures/hooks/useCreatures.ts` (catchup payload type)
- `src/pages/GamePage.tsx` (handleCatchupRewards + import rename)
- `src/features/character/components/BossTrainerPanel.tsx` → renamed to `RenownTrainerPanel.tsx`
- `src/features/character/components/CharacterPanel.tsx`
- `src/features/character/components/StatusBarsStrip.tsx`
- `src/features/character/components/StatusBarsStrip.login-display.test.tsx` (add `rp_total_earned: 0`)
- `src/components/admin/GameManual.tsx`
- `src/components/admin/NodeEditorPanel.tsx`
- `src/features/world/components/MapPanel.tsx`
- `src/features/world/components/NodeView.tsx`
- `src/features/world/components/PlayerGraphView.tsx`
