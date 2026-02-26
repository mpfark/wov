

# Improve Node Identification When Names Are Cleared

## Problem
When you clear node names (so they inherit from their Area), the connection picker dropdown and connection list show unhelpful labels like `#a3f2b1` -- just truncated UUIDs. This makes it nearly impossible to pick the right node to connect to.

## Solution
Replace the raw ID fallback with a rich display label that shows the Area name, any special flags, and a short ID suffix for disambiguation. This way, even unnamed nodes are easy to identify.

### Display Format Examples
- A node with area "Shadow Woods" and no flags: **Shadow Woods (#a3f2)**
- A node with area "Shadow Woods" that's an inn: **Shadow Woods (Inn) (#a3f2)**
- A node with area "Ironhold" that's a vendor + blacksmith: **Ironhold (Vendor, Blacksmith) (#a3f2)**
- A named node: **Hearthvale Square** (unchanged)

## Technical Changes

### `src/components/admin/NodeEditorPanel.tsx`

**1. Create a shared `getNodeLabel` helper** that takes a node and the areas list, and returns a human-readable label:
- If the node has a name, return it
- Otherwise, build: `[AreaName] [flags] (#shortId)`
- Flags: Inn, Vendor, Blacksmith, Teleport

**2. Update `ConnectionsManager`**
- Pass `allAreas` into the component
- Replace the `nodeName()` function (line 79-82) to use `getNodeLabel`
- Update the "Target Node" `<Select>` dropdown (line 217-221) to show the rich label

**3. Update the "Add Connection" dropdown** so admins can easily find unnamed nodes by their area and flags

### Files Modified
| File | Change |
|------|--------|
| `src/components/admin/NodeEditorPanel.tsx` | Add `getNodeLabel` helper; pass areas to `ConnectionsManager`; update node display in connection list and picker dropdown |

