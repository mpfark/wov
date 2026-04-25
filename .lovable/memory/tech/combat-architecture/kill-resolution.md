---
name: Kill resolution authority
description: combat-tick is the SOLE writer of kill rewards (XP/gold/BHP/salvage), level-ups, and loot drops for both solo and party kills.
type: feature
---

`combat-tick` (and `combat-catchup` for offscreen DoT kills) is the only code
path that awards kill rewards. Both call `resolveCreatureKill` →
`calculateCreatureRewards` (`reward-calculator.ts`), which uses
`getXpPenaltyParty` regardless of party size — solo is just `recipients.length === 1`.

Per-recipient results land in the tick response's `member_states` and are
applied to local React state by `interpretCombatTickResult`.

The client-side `awardKillRewards` and `rollLoot` functions in
`useCombatActions.ts` were removed (2026-04-25) because they double-wrote
rewards using the lenient `getXpPenaltySolo` curve, causing solo/party drift.
Do NOT reintroduce a client-side reward writer.

Curves `getXpPenaltySolo` / `getXpPenaltyParty` still both exist in
`shared/formulas/xp.ts`; only the party curve is wired into the live award
pipeline. The solo curve is effectively dead and may be removed later.
