# Unify kill-reward log into a single line

## Problem (observed)

In `supabase/functions/_shared/kill-resolver.ts`, kill resolution currently emits **two separate events** when a creature drops salvage:

1. The `creature_kill` line — XP + gold + Renown
2. A second `salvage` line — `🔩 +N salvage…`

This is why:
- **Regular non-humanoid** = 2 lines (kill line + salvage line; no gold usually).
- **Rare/Boss humanoid** = 1 line (no salvage, gold/RP fit on kill line).
- **Rare/Boss non-humanoid** would also be 2 lines, but they tend to drop gold so visually feel "richer" on line one.

Additionally:
- When **all recipients are level 42** ("allCapped" branch), the kill line says *"Your power transcends experience."* and gold/Renown get appended, but **salvage is still pushed as a separate line** — inconsistent.
- In a **mixed party** (one capped, one uncapped), the code falls into the `recipients.length > 1` branch and uses `displayReward` from the first uncapped member. That is correct for XP, but the message reads *"Rewards split N ways: +X XP each"* which is misleading because the level-42 member actually gets 0 XP. Salvage/gold/RP **are** shared evenly — only XP is excluded for capped members.

## Goal

One consolidated kill line per creature death, regardless of rarity, humanoid flag, party size, or level-42 mix. Format:

```text
☠️ <Creature> has been slain by <Killer>! +<XP> XP, +<Gold> gold, +<RP> 🏛️ Renown, +<Salvage> 🔩 salvage each. (modifiers…)
```

Rules:
- Omit any reward token whose value is 0 (e.g. no salvage clause for humanoids; no gold clause if gold roll failed).
- Append `each` only when `recipients.length > 1`.
- Modifier suffixes (level penalty, ⚡ XP boost, 🤝 party bonus) stay in parentheses at the end of the same line.
- For the level-42 case, replace the XP token with `experience transcended` (or simply omit XP and append `(XP capped)`) so the line is still single.
- Mixed party (some capped, some uncapped): keep the single line using uncapped XP value, and append `(N of M share XP)` so the message is honest about who gets XP.

## Changes

### `supabase/functions/_shared/kill-resolver.ts`

Replace the three-branch event composition (lines ~113–161) with a single builder:

```text
1. Build tokens array:
     xpToken      = uncappedCount > 0 ? `+${displayReward.xp} XP` : null
     goldToken    = goldEach > 0      ? `+${goldEach} gold`        : null
     renownToken  = rpEach > 0        ? `+${rpEach} 🏛️ Renown`     : null
     salvageToken = salvageEach > 0   ? `+${salvageEach} 🔩 salvage`: null
2. Join non-null tokens with `, `, append ` each` if recipients.length > 1.
3. Build modifier suffix:
     - level penalty %   (when xpPenaltyApplied < 1 AND uncappedCount > 0)
     - ⚡ Nx XP boost     (when xpBoostMultiplier > 1 AND uncappedCount > 0)
     - 🤝 +N% party bonus (when partyBonus > 1)
     - capped-share note  (when uncappedCount > 0 AND uncappedCount < recipients.length)
       e.g. `(XP shared by ${uncappedCount}/${recipients.length})`
     - all-capped note    (when uncappedCount === 0)
       prepend ` Power transcends experience.` before tokens, omit XP token
4. Push ONE event:
     { type: 'creature_kill',
       message: `☠️ ${name} has been slain${killerSuffix}! ${tokens}.${suffix}` }
5. DO NOT push a separate `salvage` event.
```

Keep the `renown_award` diagnostic console.log unchanged. Keep boss death-cry handling unchanged. Keep loot queue handling unchanged.

### Frontend log rendering

Search for any client code that specifically styles `type: 'salvage'` events and verify removing the standalone salvage event doesn't leave a dead branch:
- `src/features/combat/components/EventLogPanel.tsx`
- `src/features/combat/utils/combat-log-utils.ts`
- `src/features/combat/utils/combat-text.ts`

If `'salvage'` event styling exists, leave the type definition but note it is no longer emitted by `kill-resolver`. (Other code paths — e.g. salvage-only consumables — may still emit it.)

### Tests

- `src/test/combat/combat-resolver.test.ts` — no change (this tests DoT tick resolver, not kill resolver).
- If there are kill-resolver / reward-formatting tests, update expected strings. (None currently in repo per file listing.)

## Out of scope

- No change to reward **math** (XP/gold/RP/salvage values stay identical).
- No change to party split rules.
- No change to the loot-drop queue or boss death-cry broadcast.
- No change to client-side reward state application (`interpretCombatTickResult`).

## Example outcomes after change

| Scenario | Line |
|---|---|
| Solo, regular wolf (non-humanoid) | `☠️ Wolf has been slain by Aria! +12 XP, +2 🔩 salvage.` |
| Solo, rare bandit (humanoid) | `☠️ Bandit Captain has been slain by Aria! +45 XP, +18 gold, +1 🏛️ Renown.` |
| Party of 3, boss drake | `☠️ Ancient Drake has been slain by Aria! +210 XP, +40 gold, +15 🏛️ Renown, +12 🔩 salvage each. (🤝 +30% party bonus)` |
| Party of 2 (one L42), regular bear | `☠️ Cave Bear has been slain by Aria! +35 XP, +3 🔩 salvage each. (XP shared by 1/2) (🤝 +15% party bonus)` |
| Solo L42, rare elemental | `☠️ Flame Elemental has been slain by Aria! Power transcends experience. +8 gold, +1 🏛️ Renown, +6 🔩 salvage.` |
