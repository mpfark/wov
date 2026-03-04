

## Tab Layout for Equipment & Attributes

Replace the two collapsible sections (Attributes and Equipment+Belt Potions) with a tabbed layout using the existing `Tabs` component. Equipment tab is shown by default.

### Changes

**`src/components/game/CharacterPanel.tsx`**:

1. Replace `Collapsible` import with `Tabs, TabsList, TabsTrigger, TabsContent` from `@/components/ui/tabs`.
2. Remove `attrsOpen`/`equipOpen` state variables.
3. Wrap the Attributes section and Equipment+Belt Potions section in a `<Tabs defaultValue="equipment">` with two triggers: "Equipment" and "Attributes".
4. Keep the Name/Identity block above the tabs (unchanged).
5. Keep the Inventory section below the tabs (unchanged).
6. Move AC & Gold row out of the Attributes tab content and place it just below the tabs (always visible) since it's critical info.

### Layout structure

```text
┌─────────────────────────┐
│  Name / Title / Level   │  (unchanged)
├─────────────────────────┤
│ [Equipment] [Attributes]│  tab triggers
├─────────────────────────┤
│  AC 14  ·  Gold 230     │  always visible
├─────────────────────────┤
│  (tab content)          │  equipment grid + belt
│                         │  OR stat grid
├─────────────────────────┤
│  Inventory (15) 12/14   │  (unchanged)
└─────────────────────────┘
```

Minimal styling: small tab triggers matching the existing `font-display text-xs` aesthetic.

