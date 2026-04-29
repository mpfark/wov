## Fix: Center panel creature action label

The attack button next to creatures in the center node panel currently shows the class-specific label from `CLASS_COMBAT` (e.g. "Smite" for Healer, "Cast Fireball" for Wizard, "Backstab" for Rogue). Since this button only initiates a basic weapon autoattack — not a class T0 ability — the label is misleading.

### Change

**File:** `src/features/world/components/NodeView.tsx` (line 325)

Replace:
```tsx
{CLASS_COMBAT[character.class]?.label || 'Atk'}
```
with:
```tsx
Attack
```

Also remove the now-unused `CLASS_COMBAT` import on line 8.

### Out of scope

- `CLASS_COMBAT` itself stays defined for now — it's still referenced by `StatPlannerDialog`, `RaceClassManager`, and `combat-text.ts`. A broader cleanup of that map can be a separate pass.
- No combat/server logic changes; this is a label-only fix.
