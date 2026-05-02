## Goal

Make the player's active Force Shield (and any future absorb-style ward) visible directly on the **HP bar**, so a Wizard can see at a glance:

1. How much damage will be absorbed before HP starts dropping.
2. The current shield value vs. its cap.
3. That the shield is regenerating while out of combat (and roughly how fast).

Today the shield only shows as a small buff pip in the buff strip. The HP bar itself gives no signal that incoming damage will hit the ward first.

## Visual design

On the HP bar in `StatusBarsStrip`:

```text
HP                                                   42 / 60   🛡 7/8
[██████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
[░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▓▓▓▓▓▓▓░░]   <- shield overlay
```

- **Shield overlay**: a translucent cyan/primary segment layered on top of the HP fill, sized as `shieldHp / effectiveMaxHp` of the bar width, anchored to the **right edge of the current HP fill**. This visually communicates "this much extra damage gets eaten before HP drops."
- **Cap ghost**: a faint outline segment showing `shieldCap / effectiveMaxHp` worth of width behind the live overlay, so the player can see how much of the cap is currently filled.
- **Regen pulse**: when OOC and `shieldHp < shieldCap`, the overlay gently pulses (slow opacity animation) and a small `+` icon appears next to the shield readout, mirroring the existing HP regen `+` style.
- **Inline readout**: next to `42/60` HP we add `🛡 7/8` in primary color. Tooltip on hover shows:
  - `Force Shield — 7 / 8 ward HP`
  - `Absorbs damage before HP. Regenerates 1 + INT_mod/2 every 2s while out of combat. Does not regen during combat.`

When no shield stance is active, nothing changes on the HP bar.

If the shield amount exceeds remaining HP-bar room (e.g. HP nearly full), the overlay just clamps to the bar's right edge — visually it reads as "fully buffered."

## Where the data comes from

`StatusBarsStrip` already computes `forceShieldStance = { shieldHp, shieldCap, inCombat }` from `reservedBuffs.force_shield` + `character.stance_state.force_shield_hp` + the live `absorbBuff` during combat. We reuse that exact value — no new data sources, no new RPCs. The OOC regen RPC `apply_force_shield_regen` is already polled every 4s by `useCharacter`, so the overlay will visibly tick up on its own.

## Files touched

- `src/features/character/components/StatusBarsStrip.tsx`
  - Lift `forceShieldStance` calculation slightly so the HP-bar block can read it.
  - Add the inline `🛡 x/y` readout next to `{character.hp}/{effectiveMaxHp}`.
  - Render two extra absolutely-positioned segments inside the HP bar container (cap ghost + live overlay), styled with `hsl(var(--primary))` at low opacity, with a slow pulse animation (Tailwind `animate-pulse` gated on `!inCombat && shieldHp < shieldCap`).
  - Keep the existing buff-pip rendering for Force Shield as-is (it stays as a redundant secondary indicator).

No backend, migration, or hook changes. No changes to combat logic. Purely a presentational addition to the existing HP bar.

## Out of scope

- Other absorb effects (Holy Shield reflects, Shield Wall block) — those are damage-reduction, not ward HP, so they stay as buff pips.
- Showing party members' shields on their portraits — can be a follow-up if desired.
