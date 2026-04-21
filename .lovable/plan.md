

## Remove Duplicate Admin Page Headers

The `AdminLayout` header bar displays the tab title (e.g. "Creatures"), and then each manager component renders its own `AdminEntityToolbar` with the same title plus count and controls. This creates the double headline visible in the screenshot.

### Fix

**Remove the title text from the `AdminLayout` header bar.** The sidebar trigger and global search remain, but the `<h1>` tab title is removed since the individual panels already display their own contextual header with richer information (count, filters, sort buttons).

### Changes

**`src/components/admin/AdminLayout.tsx`**
- Remove the `TAB_TITLES` map and the `<h1>` element from the header bar
- Keep the sidebar trigger, spacer, and global search in the slim top bar

### Files

| File | Action |
|------|--------|
| `src/components/admin/AdminLayout.tsx` | Remove title text from header bar |

