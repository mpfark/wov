---
name: Party XP Bonus
description: Grouped play XP multiplier scaling with party size (1.15x-1.40x), calculated in reward-calculator.ts
type: feature
---

Party XP bonus provides a modest incentive for grouped play without punishing solo players.

| Members at node | XP Multiplier |
|----------------|---------------|
| 1 | 1.00x |
| 2 | 1.15x |
| 3 | 1.30x |
| 4+ | 1.40x |

Applied per-member after level penalty and XP boost, before split:
`finalXp = floor(floor(baseXp * penalty * xpBoost * partyBonus) / uncappedSplit)`

Implemented in `supabase/functions/_shared/reward-calculator.ts`.
Display: kill messages show `(🤝 +X% party bonus)` when bonus > 1.0.
