## Goal

Make Templar's **Shield Wall** stance scale off both class primaries (WIS + CON) instead of being a flat +50% block chance.

## Stat split

- **WIS → bonus block chance** (replaces the flat +50%)
- **CON → bonus block amount** (new — Shield Wall now also hardens the block, not just makes it more frequent)

Base block formulas (DEX → chance, STR → amount) are unchanged. Shield Wall stacks additively on top.

## Proposed formulas

Using the same `diminishingFloat` / `diminishing` pattern already used for WIS anti-crit and STR block:

- **Block-chance bonus** = `0.30 + diminishingFloat(wisMod, 0.05, 0.25)`
  → floor +30%, scaling up to +55% at high WIS. Final block chance still clamped to 95%.
- **Block-amount bonus** = `5 + diminishing(conMod, 6)`
  → floor +5, scaling up to +11 flat damage absorbed per block at high CON. Added to `getShieldBlockAmount(STR)` only while the stance is active.

(Numbers are tuning dials — easy to nudge after playtest. The +30% floor keeps low-WIS templars roughly on parity with today's +50% flat once you account for WIS contribution.)

## Technical changes

1. **`supabase/functions/combat-tick/index.ts`**
   - At the stance-hydration block (line ~472), replace the boolean `mb.shield_wall_stance = true` with a payload: `{ chance_bonus, amount_bonus }` computed from the templar's effective WIS/CON.
   - In the shield-block step (line ~869), use `mb.shield_wall_stance.chance_bonus` instead of the hardcoded `+0.5`, and add `mb.shield_wall_stance.amount_bonus` to `getShieldBlockAmount(effectiveStr)` before clamping to `dmg`.
   - Update the block log line to show the bonus amount when Shield Wall is active.

2. **`src/features/combat/utils/class-abilities.ts`**
   - Update the Shield Wall description to reflect dual scaling: "WIS adds block chance, CON adds block amount."

3. **`src/components/admin/GameManual.tsx`**
   - Update the Shield Wall manual entry with the new formulas.

4. **`src/features/character/components/CharacterPanel.tsx`** (line ~965)
   - When Shield Wall is active, show the boosted chance AND boosted amount in the Block stat tooltip (currently only chance is shown).

5. **Memory**
   - Update `mem://game/class-abilities/templar.md` to document the Shield Wall dual-primary split alongside Holy Shield and Consecrate.

## Out of scope

- No changes to base block formulas (DEX/STR).
- No change to the stance's CP-reservation tier (still T2 / 15% max CP).
- No client prediction changes — block resolution is already server-authoritative.
