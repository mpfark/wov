## Proc Damage Readout — Item Editor

Add a small, read-only "Proc Expectancy" panel on the Item editor so you can see at a glance what each chance-on-hit entry contributes to a weapon, without leaving the form.

### What it shows
For each entry in the item's `procs` array, one row:

- **Emoji + type** (e.g. 🩸 lifesteal)
- **Chance** as a percentage (`chance × 100`)
- **Value** (raw number, or % for `weaken`)
- **EV per hit** = `chance × value`, rounded to 2 decimals
  - For `weaken`, EV is shown as `chance × value × 100%` mitigation (labelled differently so it isn't confused with damage)
  - For `lifesteal` / `heal_pulse`, EV is labelled "HP/hit" not "dmg/hit"
  - For `burst_damage`, EV is labelled "dmg/hit"

Plus a footer total: **Σ EV damage per hit** and **Σ EV healing per hit** (weaken excluded from both sums; shown separately).

No attacker context, no DPS conversion — pure item math, matching the resolution in `combat-tick` (`Math.random() >= proc.chance` gate, then `value` applied).

### Where it lives
Inline in `src/components/admin/ItemManager.tsx`, in the same area as the existing item-editor fields. Renders only when `item.procs` is a non-empty array. Collapsible header so it doesn't clutter non-proc items.

### Implementation

```text
src/components/admin/ItemManager.tsx
  └── <ProcExpectancyPanel procs={item.procs} />   ← new

src/components/admin/ProcExpectancyPanel.tsx       ← new, ~60 lines
  - Pure presentational component
  - Imports formatProcMessage type if useful, but does its own labelling
  - No data fetching, no edits — reads procs prop only
```

Reuses the proc-type taxonomy already defined in `supabase/functions/_shared/proc-log-format.ts` (`lifesteal`, `heal_pulse`, `burst_damage`, `weaken`) so labels stay in sync with the resolver. If a new proc type is added later, the panel falls back to a generic "EV: chance × value" row.

### Out of scope
- DPS / per-second math (would need weapon speed assumptions)
- Attacker level/stat scaling
- Standalone Admin → Tools page
- Editing procs from this panel (read-only readout only)

### Verification
Open Item editor on a known proc weapon (e.g. a lifesteal unique). Confirm the row matches `chance × value` by hand for at least one item. Confirm the panel is hidden for items with no procs.
