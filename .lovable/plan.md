

# Replace Node Editor Dialog with Inline Properties Panel

## Overview
Replace the popup dialog-based node editor with a side-by-side resizable layout on the World tab: the SVG map on the left and a properties panel on the right. Clicking a node or "add node" opens the editor inline in the right column, giving admins full visibility of both the map and the node details simultaneously. The properties panel will also include a region selector and the connections manager for both new and existing nodes.

## Changes

### 1. AdminPage.tsx -- Restructure the World tab

- Remove the `NodeEditorDialog` component usage entirely
- Replace the World tab content with a `ResizablePanelGroup` (horizontal) containing:
  - **Left panel**: The existing `AdminWorldMapView`
  - **Right panel**: A new inline `NodeEditorPanel` (the same editor content, but rendered as a panel instead of a dialog)
- Pass all needed state (editing node ID, new node flag, regions list) down to the panel
- Add a region selector (`Select` dropdown) to the node editor so admins can assign/change a node's region during create or edit

### 2. New Component: NodeEditorPanel.tsx

Extract the contents of `NodeEditorDialog` into a new `NodeEditorPanel` component that:
- Renders as a scrollable panel (not a dialog) with a header showing the node name and a close button
- Contains all existing tabs: Details, Creatures, Vendor Stock, Connections
- Adds a **Region** dropdown on the Details tab, populated from the regions list, allowing the admin to set or change the node's region
- Shows the Connections tab for both new and existing nodes (not just existing ones)
- On save for new nodes, uses the selected region from the dropdown instead of a pre-set `regionId`

### 3. NodeEditorDialog.tsx -- Keep or Remove

The dialog component can be kept for backward compatibility but will no longer be used from the World tab. Alternatively, it can be removed entirely if no other page references it.

## Technical Details

### Layout Structure (AdminPage World tab)
```text
+--------------------------------------------------+
| Region controls bar                               |
+------------------------+-------------------------+
|                        |  Node Editor Panel       |
|   SVG World Map        |  - Details (+ Region)    |
|   (resizable)          |  - Creatures             |
|                        |  - Vendor Stock          |
|                        |  - Connections           |
+------------------------+-------------------------+
```

- Uses `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` from the existing `resizable.tsx` UI component
- Default split: ~65% map / ~35% properties
- When no node is selected, the right panel shows a placeholder message like "Select a node to edit"

### Region Selector on Details Tab
- A `Select` dropdown populated with all regions (passed as prop)
- For new nodes: defaults to the region of the adjacent node (if any), otherwise first region
- For existing nodes: shows the current region, allows changing it
- On save, the selected region is written to the `region_id` column

### Connections on New Nodes
- For new nodes, connections can be configured after the initial save (node needs an ID first)
- After creating a node, the panel stays open and switches to "edit mode" so the admin can immediately add connections

