

## Prevent Map Shift When Editor Panel Opens

### Problem
The map uses a `ResizablePanelGroup` where the map panel shrinks from 100% to 65% when the editor panel opens. This causes the SVG canvas to resize, shifting the visible content.

### Solution
Replace the resizable layout with an **overlay approach**: the editor panel will be absolutely positioned over the right side of the map instead of shrinking the map's container. The map always stays at full width.

### Changes

**`src/pages/AdminPage.tsx`**
- Replace `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle` with a simple `relative` container.
- The map (`AdminWorldMapView`) renders at full width always.
- The editor panels (NodeEditor, RegionEditor, AreaEditor, PopulatePanel, BatchNodeEditPanel) render inside an absolutely positioned `div` on the right side (e.g. `absolute top-0 right-0 h-full w-[35%] min-w-[360px]`) with a background and border.
- Remove the `panelOpen` prop usage that controls `defaultSize` on the map panel.
- Each panel gets a semi-opaque background (`bg-card`) so map content is still partially visible underneath, or fully opaque if preferred.

This ensures the map SVG container never changes dimensions, so pan/zoom state remains stable.

