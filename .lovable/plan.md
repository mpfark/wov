

## Add Image Upload to Illustration Editors

Currently you have to manually upload images via the backend and paste URLs. This plan adds drag-and-drop / file picker upload buttons directly into both the background illustration editor (regions, areas, nodes) and the item illustration editor.

### What changes

**1. Shared upload helper** — `src/lib/upload-illustration.ts`
A small utility function that uploads a file to a specified storage bucket (`background-images` or `item-illustrations`), generates a unique filename, and returns the public URL. Used by both editors.

**2. Background IllustrationEditor** — `src/components/admin/IllustrationEditor.tsx`
- Add an **Upload** button next to the URL input
- Accepts image files (png, jpg, webp) via a hidden `<input type="file">`
- Uploads to the `background-images` bucket using the Supabase client
- On success, calls `onUrlChange(publicUrl)` to populate the URL field
- Shows a loading spinner during upload

**3. Item illustration section** — `src/components/admin/ItemManager.tsx`
- Add an **Upload** button next to the existing URL input and "Generate with AI" button
- Uploads to the `item-illustrations` bucket
- On success, sets `form.illustration_url` to the public URL
- Shows loading state during upload

### No database or RLS changes needed
Both `background-images` and `item-illustrations` buckets already exist and have admin upload/update/delete policies configured.

### Files

| File | Action |
|------|--------|
| `src/lib/upload-illustration.ts` | **Create** — shared upload helper |
| `src/components/admin/IllustrationEditor.tsx` | **Edit** — add Upload button |
| `src/components/admin/ItemManager.tsx` | **Edit** — add Upload button to item illustration section |

