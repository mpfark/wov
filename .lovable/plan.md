# Normalize panel spacing with rhythm tokens

Replace ad-hoc Tailwind spacing (`space-y-*`, `gap-1/1.5/2/3/4`, mixed `p-2/3/4`) across gameplay panels with the four semantic rhythm utilities already defined in `src/index.css`, so all major panels share the same vertical cadence and padding.

## Token contract (already in index.css)

| Class | Gap | Use |
|---|---|---|
| `gap-row`     | 4px  | Tight list items (stat rows, log lines, slot rows) |
| `gap-group`   | 8px  | Between groups inside a section (identity/stats/flavor) |
| `gap-section` | 16px | Between sections inside a panel |
| `gap-panel`   | 24px | Between top-level panel blocks |

Panel padding standard: `p-3` for compact side panels, `p-4` for service/dialog panels. Dividers: `divider-hairline` (already defined) instead of `border-t`/`<hr>`.

## Mapping rules

Apply these substitutions per container, choosing the bucket by *what the children mean*, not by the previous pixel value:

- Vertical stack of tight rows (stat lines, log lines, slot list rows) → `gap-row`
- Stack of label+value groups, form field groups, or small clusters → `gap-group`
- Stack of distinct sections inside one panel (header / body / footer-of-section) → `gap-section`
- Stack of top-level panel blocks (e.g. character → status → portrait inside a tab) → `gap-panel`
- Horizontal `flex gap-1/1.5` chip rows → keep as `gap-1.5` (rhythm tokens are vertical-only); only swap if the row is a vertical stack rendered with flex-col.
- Panel root padding: `p-2` / `p-3` / `p-4` ad-hoc → `p-3` (side panels) or `p-4` (ServicePanelShell body slots / dialogs).
- Replace `space-y-N` with the matching rhythm class on the same element (rhythm utilities use the same `> * + *` selector).

Do NOT touch: button internal padding, badge padding, icon sizes, `event-log-*` classes, grid `gap-*` for true grids (inventory slot grids, gem grids), or any horizontal flex `gap-*`.

## Scope (files)

Pass 1 — high-density panels (most replacements):
- `src/features/inventory/components/JewelcrafterPanel.tsx`
- `src/features/marketplace/components/MarketplacePanel.tsx`
- `src/features/inventory/components/BlacksmithPanel.tsx`
- `src/features/character/components/CharacterPanel.tsx`
- `src/features/inventory/components/VendorPanel.tsx`
- `src/features/inventory/components/SoulforgeTabContent.tsx`
- `src/features/inventory/components/SoulforgeDialog.tsx`
- `src/features/character/components/TrainerPanel.tsx`

Pass 2 — supporting panels:
- `src/features/character/components/StatPlannerDialog.tsx`
- `src/features/character/components/PortraitTab.tsx`
- `src/features/character/components/StatusBarsStrip.tsx`
- `src/features/party/components/PartyPanel.tsx`
- `src/features/inventory/components/StonebinderPanel.tsx`
- `src/features/inventory/components/GemPouch.tsx`
- `src/features/inventory/components/MaterialsSection.tsx`
- `src/features/combat/components/EventLogPanel.tsx` (header strip only; preserve `event-log-*`)
- `src/features/chat/components/ChatPanel.tsx`

## Process per file

1. Read the file.
2. For each container, classify children (row/group/section/panel) and swap to the matching rhythm class.
3. Normalize root/body padding to `p-3` (side panel) or `p-4` (ServicePanelShell slots).
4. Replace `border-t border-border` section separators with `divider-hairline` where the intent is a visual section break (not a structural panel edge).
5. Leave grids, horizontal flex rows, button/badge/icon internals untouched.

## Out of scope

- No color, font, or component-API changes.
- No new tokens — only consume what's already in `index.css`.
- No behavior or layout-structure changes (same containers, same children, just different spacing classes).
- Admin panels, auth/gateway, world map, and NPC dialog are out of scope for this pass.

## Verification

- TypeScript build passes.
- Visual check in preview: Character, Inventory tab, Vendor, Blacksmith, Jewelcrafter, Marketplace, Combat log all show consistent vertical rhythm; no collapsed/overlapping rows, no doubled spacing where `space-y-*` got duplicated.
