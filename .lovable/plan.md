

## Redesign Creature & Player Bars in NodeView

### Current State
- **Creature bar**: Name, level, debuff icons on left → HP bar + numbers → status label with text (⚔️ TARGET / ⚔️ ENGAGED / 🎯 SELECTED) or Attack button
- **Player bar**: Title + name, level → HP bar + numbers (party only), no attack button
- Layout differs between the two

### Proposed Layout (unified for both)

```text
┌──────────────────────────────────────────────────────────┐
│ [Name] [Lvl] [debuffs...]   [⚔️] [████████] 45/80 [Atk]│
└──────────────────────────────────────────────────────────┘
```

**Left side**: Name (+ title for players), Level badge, debuff icons (creatures only)  
**Right side (ml-auto)**: Combat icon (⚔️ no text, only when engaged/targeted), HP bar, HP numbers, Attack button (creatures only)

### Changes — `src/components/game/NodeView.tsx`

**Creature bars (lines ~141–227)**:
1. Move the combat status icon (⚔️) to the LEFT of the HP bar, icon only — no "TARGET"/"ENGAGED"/"SELECTED" text
2. Keep red border for active target, orange (dwarvish) for engaged, primary for selected
3. HP bar + numbers remain right-aligned
4. Attack button stays to the far right of HP numbers

**Player bars (lines ~241–268)**:
1. Always show HP bar + numbers (not just for party mates) — use level-based estimate if no party HP data
2. Title displayed to the left of their name (already done, keep as-is)
3. Match the same row structure as creatures: `[Title Name] [Lvl] ... [HP bar] [HP numbers]`
4. For non-party players without HP data, show just the name/level without HP bar (since we have no data)

### Border Colors (kept as-is)
- **Red** (`border-destructive`): creature actively fighting the player
- **Orange** (`border-dwarvish`): creature engaged  
- **Primary** (`border-primary`): selected target
- **Elvish**: party mate player
- **Primary/30**: other player

