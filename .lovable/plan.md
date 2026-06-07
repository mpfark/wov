# Phase 3 — Bond Multiplier (Shipped)

Mastery (Bond 0–100, per class) is now a real combat scalar. Bond is earned per kill, scales magnitudes only (not durations), and resets on order switch.

## What landed

- **Formula** (`src/shared/formulas/bond.ts`, mirrored to edge): `bondMultiplier(bond) = 1 + bond * 0.0015` → 1.00× at 0 / 1.15× at 100. `bondGainForKill(level, isBoss) = clamp(round(level*0.5 + isBoss*5), 1, 25)`.
- **Server RPC** `award_class_bond_for_kill` — wraps the gain formula + `award_class_bond` + logs an activity entry only when crossing a 10-point milestone.
- **Switch reset** — `join_order` now deletes the prior class's `character_class_bonds` row when switching classes (joining from classless costs nothing).
- **Kill awards** — wired through `resolveCreatureKill.bondGains`; combat-tick (live) and combat-catchup (offscreen) both call the RPC per recipient.
- **Multiplier applied** — autoattacks (main + offhand), Barrage arrows, Eviscerate, Conflagrate, T0 abilities (fireball/power_strike/aimed_shot/backstab/smite/cutting_words), Grand Finale, Holy Shield retaliation, Consecrate burn+heal, Ignite orb pulse + burn DoT, Envenom poison DoT, Rend bleed DoT. **Skipped per design:** item procs, durations, cooldowns, hit chance, AC, costs.
- **UI** — Bond row in Attributes tab (live; subscribes to `character_class_bonds`); destructive switch warning in Order Recruiter dialog.
- **Tests** — `bond.test.ts` covers curve + clamps + gain formula.

## Notes & deliberate scope decisions

- Bond gains are POST-RPC; classless characters get nothing (RPC short-circuits).
- The multiplier reads the character's *active* class only. Other-class bonds sit dormant but are wiped on switch.
- Activity log throttles to one entry per 10-point milestone to avoid spam.
- DoT magnitudes bake the multiplier in at apply time (single value persisted on `active_effects.damage_per_tick`); ticking does not re-multiply.

## Future / out of scope

- Bond-gated abilities or perks.
- Bond-driven titles or cosmetics.
- Cross-class Bond synergies.
- Per-ability-use gain (currently per-kill only).
