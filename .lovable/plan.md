

## Update Game Manual — Remove Class Balance Simulation

### Change
Remove the "⚖️ Class Balance Simulation (Lv 20 & 40)" accordion section (lines 123–223) from `src/components/admin/GameManual.tsx`. This section simulates classes with no gear, which is misleading since actual balance is gear-dependent.

### Cleanup
- Remove unused imports that were only used by the simulation: `getCarryCapacity` (check if used elsewhere in the file — it is used in the Stamina section's encumbrance, so keep it). All other imports are used by remaining sections.
- No other files affected.

### Summary
- **1 file edited** (`GameManual.tsx`) — delete ~100 lines (the balance-sim AccordionItem block)

