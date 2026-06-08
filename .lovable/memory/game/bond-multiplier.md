---
name: Bond Multiplier System
description: Per-class mastery scalar 1.00×→1.15× applied to damage/DoT/utility; per-kill gain, reset on order switch
type: feature
---
Bond (0–100, per (character, class) in `character_class_bonds`) acts as a gentle mastery scalar.

Curve: `bondMultiplier(b) = 1 + b * 0.0015` → 1.00× at 0, 1.15× at 100. Lives in `src/shared/formulas/bond.ts` and is mirrored to `supabase/functions/_shared/formulas/bond.ts`.

Applies to: direct damage (autoattacks main+offhand, ability hits), DoT/HoT magnitudes (Rend/Ignite burn/Envenom/Consecrate burn+heal/Ignite pulse), and utility magnitudes (Holy Shield retaliation, Sunder AC reduction, Battle Cry DR, Divine Challenge DR, Shield Wall block-amount bonus, Force Shield pool cap). Applied AFTER `getEffectiveCombatMod`, as the final magnitude step at server consumption sites. DR-based utilities are clamped to 0.95 to never produce 0 damage.

Does NOT apply to: durations, cooldowns, hit chance, AC, CP/MP costs, item procs, weapon-proc magnitudes.

Gain: per kill via SQL function `award_class_bond_for_kill(_character_id, _creature_level, _is_boss)` — formula `clamp(round(level*0.5 + isBoss*5), 1, 25)`. Classless characters earn nothing. Activity log fires only when bond crosses a 10-point milestone.

Switch cost: `join_order` deletes the prior class's bond row when switching. Joining from classless is free.

Wiring sites:
- Live awards: `combat-tick` `bondGainQueue` → batched `award_class_bond_for_kill` RPC after loot.
- Offscreen awards: `combat-catchup` per-recipient RPC alongside gem drops.
- Both flow through `resolveCreatureKill.bondGains` in `_shared/kill-resolver.ts`.

UI: `ClassBondRow` component in CharacterPanel Attributes tab (live via realtime subscription). OrderRecruiterDialog shows a destructive warning + button variant when switching.
