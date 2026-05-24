## Simplify Ability Tooltips in Center Panel

The ability tooltips in the center-panel action bar are too wordy. Replace them with concise one-liners that say what the ability does and which attribute(s) it scales with.

### Files to change

1. **src/features/combat/utils/class-abilities.ts**
   - Add `tooltip: string` to `ClassAbility` interface.
   - Populate a short tooltip for every ability (35 entries across 7 classes).
   - Keep existing `description` untouched for admin/game manual use.
   - Pattern: "[Brief verb phrase]. Scales with STAT." For stances: "[Effect]. Scales with STAT. Stance."

2. **src/features/world/components/NodeView.tsx**
   - In the ability button tooltip (lines 535-544), replace `ability.description` with `ability.tooltip`.
   - Keep the level-locked / stance-active / pending / CP-cost suffixes as-is.

### Verification
- TypeScript build passes.
- Hovering ability buttons in the center panel shows the new concise tooltip.