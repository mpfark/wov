---
name: Combat Insight (INT secondary to-hit)
description: INT grants a secondary to-hit bonus (restored getIntHitBonus, sqrt curve cap +5) on every attack whose accuracy_stat is not INT
type: feature
---

Combat Insight is an intentional addition on top of the Batch 2 accuracy formula.

Formula for every roll-based player attack:

```
totalAttack = d20
  + proficiency(2 + floor(level / 2))
  + accuracyBonus(bounded sqrt of the ability's accuracy_stat modifier, cap +8)
  + insight (accuracy_stat === 'int' ? 0 : getIntHitBonus(int))
  + affinityHit (weapon-based actions only)
```

- `getIntHitBonus(int) = diminishing(getStatModifier(int), 5)` — restored verbatim from history, cap +5.
- DEX/WIS/CHA-primary attacks receive Combat Insight; INT-primary attacks never count INT twice.
- Autoattacks: DEX accuracy + Combat Insight + weapon affinity.
- Canonical owner: `getCombatInsightBonus` in `src/shared/formulas/combat.ts` (mirrored to Deno).
- Every client hit-chance preview (CharacterPanel, StatPlannerDialog, combat-predictor) must use the identical term, and the Character panel shows Combat Insight as its own row.
- Adds no extra roll; crit rules, damage and creature AC unchanged.
