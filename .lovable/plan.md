

## Simplify Proc Types and Add Log Preview

### Changes

**1. Consolidate proc types**

Replace `fire_damage`, `frost_damage`, `lightning_damage` with a single `burst_damage` type. The damage type flavor (fire, frost, lightning, etc.) is already captured in the emoji and log text fields -- just like creature boss flavors work. This keeps the door open for future resistance systems by adding a `damage_type` tag later without changing the proc engine.

New proc type list:
- `lifesteal` -- steal HP from target (heals attacker)
- `burst_damage` -- bonus flat damage on hit (replaces fire/frost/lightning)
- `weaken` -- reduce target effectiveness (log-only for now)
- `heal_pulse` -- self-heal on hit

**2. Update combat-tick resolver**

In `supabase/functions/combat-tick/index.ts`, replace the three elemental cases with a single `burst_damage` case that applies flat bonus damage (same logic as before).

**3. Add log preview beneath each proc entry**

In the admin proc editor, render a small preview line below each proc row showing exactly what the combat log message will look like, using placeholder names:

```
💚 Hero's weapon drains life from Goblin! (+5 HP)
```

This is computed live from the proc's emoji, text, value, and type -- so the admin sees the final log format as they type.

**4. Update memory**

Update `mem://game/proc-on-hit-system.md` with the simplified type list.

### Files

| File | Action |
|------|--------|
| `supabase/functions/combat-tick/index.ts` | Replace 3 elemental cases with `burst_damage` |
| `src/components/admin/ItemManager.tsx` | Update type list, add log preview beneath each proc |
| `mem://game/proc-on-hit-system.md` | Update supported types |

