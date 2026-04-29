## Halve Renown Training Cost

Reduce the cost of training attributes at the Renown Trainer by 50%, making the system more accessible while preserving the diminishing-returns success curve.

### Change

In `src/features/character/components/RenownTrainerPanel.tsx`, update the cost formula:

```ts
// Before
function getTrainingCost(rank: number): number {
  return 20 * (rank + 1);
}

// After
function getTrainingCost(rank: number): number {
  return 10 * (rank + 1);
}
```

### Resulting cost curve

| Rank | Old cost | New cost | Success |
|------|----------|----------|---------|
| 0→1  | 20       | **10**   | 95%     |
| 1→2  | 40       | **20**   | 80%     |
| 2→3  | 60       | **30**   | 65%     |
| 3→4  | 80       | **40**   | 50%     |
| 4→5  | 100      | **50**   | 35%     |
| 5→6  | 120      | **60**   | 20%     |
| 6→7  | 140      | **70**   | 5%      |

Effective doubling of training throughput at every rank. The success-chance curve is unchanged, so high ranks remain a long-term grind — just half as punishing on the wallet.

### Notes

- The footnote text in the panel currently reads `Cost per attempt: 20 × (rank + 1) RP.` — update it to `10 × (rank + 1) RP` so the in-game tooltip matches.
- No server-side, schema, or balance-data changes needed. RP income (boss/rare drops in `_shared/reward-calculator.ts`) stays the same.
- No memory updates required.
