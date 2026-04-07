

# Blacksmith Panel: Tabbed Layout + Common-Only Forge

## Summary

Restructure the Blacksmith dialog into two tabs using Radix Tabs. Restrict forged items to common rarity only (server + client).

## Tab Layout

**Tab 1 — Repair**
- Column 1: Info about repair mechanics (how it works, cost formula hint, unique = unrepairable)
- Column 2: Damaged items list with repair buttons + "Repair All"

**Tab 2 — Forge**
- Column 1: Slot picker dropdown, sell salvage section, cost display
- Column 2: Browsable item pool for selected slot, forge button

Gold/salvage resource bar stays above the tabs (shared).

## Common-Only Forge Change

**Server** (`supabase/functions/blacksmith-forge/index.ts`):
- Add `.eq("rarity", "common")` to the `baseQuery` in `getItemPool` (replace existing `.neq("rarity", "unique")`)

**Client** (`BlacksmithPanel.tsx`):
- Remove `rarityOrder` grouping (only common items now)
- Simplify pool rendering to a flat list

## Files Modified

| File | Change |
|------|--------|
| `src/features/inventory/components/BlacksmithPanel.tsx` | Wrap content in `Tabs`/`TabsList`/`TabsContent` with Repair and Forge tabs, each using a 2-column grid |
| `supabase/functions/blacksmith-forge/index.ts` | Change `.neq("rarity", "unique")` to `.eq("rarity", "common")` in `getItemPool` |

## What Does NOT Change

- Repair logic, cost calculation
- Forge edge function auth/validation flow
- ScrollPanel wrapper
- Sell salvage logic

