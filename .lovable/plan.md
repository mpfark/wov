## Goal

Boss/creature autoattack crits currently spike close to a telegraphed cast's damage. Lower creature-vs-player crit damage so telegraphed casts stay the biggest single hit, without touching player crit damage (still 1.5x) or boss cast tuning.

## Why crits spike so hard today

In `supabase/functions/combat-tick/index.ts` the creature hit pipeline is:

```text
base = 1d{damageDie} + creatureSTRmod
→ hit-quality mult (strong = 1.25x)
→ crit mult (1.5x)
→ level-gap mult (+8%/level)
→ block / absorb / DR
```

Boss STR is `round((8 + level*0.7) * 2.5)`, so the flat STR modifier alone dominates at higher levels; a strong crit stacks 1.25 x 1.5 on top of it. Lowering the crit step is the cleanest single lever.

## Changes

1. **New shared constant** in `src/shared/formulas/combat.ts` (and its byte-mirror `supabase/functions/_shared/formulas/combat.ts`):
   `CREATURE_CRIT_MULT = 1.25`, documented as a tuning dial and explicitly distinct from the player crit multiplier (1.5x, unchanged).
2. **Use it in the creature pipeline** — replace the hardcoded `dmg * 1.5` at `combat-tick/index.ts:1316` with `CREATURE_CRIT_MULT`. This is the only creature-crit damage site (`combat-catchup` only resolves DoTs), so it applies immediately to every regular, rare and boss creature, including all 16 existing bosses — no migration or per-boss data change needed.
3. **Keep everything else intact**: crit chance/threshold, WIS anti-crit deflection, shield anti-crit bonus, Battle Cry crit reduction, `CRITICAL!` log line and boss crit flavor text all stay as-is.
4. **Docs**: note the creature crit multiplier in the combat section of `src/components/admin/GameManual.tsx` so the manual reflects that creature crits are 1.25x while player crits remain 1.5x.

## Expected effect

A strong crit drops roughly 17% in damage (1.25 x 1.25 = 1.56x vs 1.25 x 1.5 = 1.875x over base), which restores clear headroom between a lucky autoattack and a telegraphed cast without making bosses feel soft.

## Follow-up (not in this change)

If crits still read too close to casts after playtesting, the next dial is per-boss `base_amount` / stored-power shares — tune those from data rather than adding another code multiplier.
