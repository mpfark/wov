## Weapon Dice Progression by Item Level

Add a soft, item-level-based weapon die upgrade so a level 40 sword hits noticeably harder than a level 1 sword — without touching abilities, crit, procs, or the offhand multiplier.

### Progression curve

Per item (using `items.item_level`):

```text
1–10   → +0 die size
11–20  → +1
21–30  → +2
31–40  → +3
41+    → +3   (reserved for future 2dX upgrade, NOT in this pass)
```

Family base dice (`WEAPON_DAMAGE_DIE`) stay unchanged — daggers/wands keep their lighter feel; bows still start higher; staves still cap lower in 2H. The progression is a flat add to the chosen die size, applied identically to oneHand and twoHand variants.

### Helper API

In `src/shared/formulas/combat.ts` (and mirrored to `supabase/functions/_shared/formulas/combat.ts`):

```ts
export function getWeaponDieProgression(itemLevel: number | null | undefined): number {
  const lvl = itemLevel ?? 1;
  if (lvl <= 10) return 0;
  if (lvl <= 20) return 1;
  if (lvl <= 30) return 2;
  return 3;
}

export function getWeaponDieForItem(
  weaponTag: string | null | undefined,
  hands: 1 | 2,
  itemLevel: number | null | undefined,
): number {
  return getWeaponDie(weaponTag, hands) + getWeaponDieProgression(itemLevel);
}
```

`getWeaponDie` keeps its current signature so legacy/UI fallbacks (no item context, e.g. unarmed) still work. `rollWeaponAttackDamage` gains an optional `itemLevel` parameter and calls `getWeaponDieForItem`.

### Wire-through (call sites)

1. **`supabase/functions/combat-tick/index.ts`**
   - When loading equipment (line ~307), also select `item_level`: `item:items(stats, weapon_tag, hands, procs, item_level)`.
   - Track `mainHandLevel[cid]` and `offHandLevel[cid]` alongside the existing `mainHandTag` / `offHandTag` maps.
   - Replace `getWeaponDie(wTag, wHands)` (line ~982) with `getWeaponDieForItem(wTag, wHands, mainHandLevel[m.id])`.
   - Replace offhand `getWeaponDie(ohTag, 1)` (line ~1127) with `getWeaponDieForItem(ohTag, 1, offHandLevel[m.id])`.

2. **`src/features/combat/utils/combat-predictor.ts`**
   - Add optional `weaponItemLevel` to `PredictionContext`.
   - Use `getWeaponDieForItem(ctx.weaponTag, hands, ctx.weaponItemLevel)`.
   - Update the call site that builds the prediction context (search `predictConservativeDamage`) to pass the equipped main-hand item level.

3. **`src/shared/formulas/combat.ts` — `resolveAttackRoll`**
   - Extend `AttackContext` with optional `weaponItemLevel`.
   - Use `getWeaponDieForItem(...)` so any client-side resolver sharing this helper stays consistent. (Mirror to Deno copy.)

4. **`src/features/character/components/CharacterPanel.tsx`** (line ~893)
   - Read the equipped main-hand `item_level` from the same source already used for `mainHandTag` / `isTwoHanded` and call `getWeaponDieForItem(...)` so the character sheet shows the actual progressed die (e.g. `Weapon Damage: 1d9 + STR`).

5. **Item tooltips / weapon display** (search for any `getWeaponDie(` usage in inventory/marketplace tooltip components — there are no other callers today, but verify with `rg "getWeaponDie"` after the change). When an item context is available, switch to `getWeaponDieForItem(tag, hands, item.item_level)`.

6. **Game Manual / combat docs** — if a weapon-dice table is documented in markdown or a help panel, add a brief note: "Weapon dice grow by item level: +1 at 11, +2 at 21, +3 at 31."

### What stays unchanged

- Family base dice and 2H die selection (no reintroduction of the 1.25× 2H multiplier).
- Offhand: still its own die + the existing 30% multiplier — only the die size benefits from progression.
- STR damage scaling, INT hit bonus, DEX crit, WIS anti-crit, shield block, procs, mitigation, T0/class abilities, crit multiplier — none touched.
- `UNARMED_DIE` — unarmed has no item, so it never progresses.

### Mirror & test discipline

- Edit `src/shared/formulas/combat.ts` first, then byte-mirror to `supabase/functions/_shared/formulas/combat.ts` (only difference: `.ts` import suffixes), per the formula-ownership rule.
- Add a small case to `src/shared/formulas/__tests__/formula-parity.test.ts` snapshotting `getWeaponDieForItem('sword', 1, [1,11,21,31,41])` so future tweaks are intentional.
- Manual validation: low vs high level sword, dagger, bow; 1H vs 2H; offhand dagger; marketplace tooltip; CharacterPanel weapon line; verify combat-tick logs show the larger die in damage breakdown.

### Files touched

- `src/shared/formulas/combat.ts`
- `supabase/functions/_shared/formulas/combat.ts` (mirror)
- `supabase/functions/combat-tick/index.ts`
- `src/features/combat/utils/combat-predictor.ts` (+ caller)
- `src/features/character/components/CharacterPanel.tsx`
- `src/shared/formulas/__tests__/formula-parity.test.ts`
- Any tooltip component still calling raw `getWeaponDie` with item context (verify post-change)
