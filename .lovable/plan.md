

## Current state vs. spec

The illustration system already exists end-to-end. Audit:

| Spec requirement | Status |
|---|---|
| `IllustrationEditor` shared between Node/Area/Region | ✅ Already shared |
| URL input + helper text | ✅ Present |
| Effective background preview with source label ("From Area"/"From Region") | ✅ Present (line 76-98 of `IllustrationEditor.tsx`) |
| Dark overlay matching in-game | ✅ Present (line 94) |
| Node → Area → Region fallback in editor preview | ✅ Wired in `NodeEditorPanel.tsx` lines 994-1005 |
| Item illustration preview + Clear + AI Generate | ✅ Present (`ItemManager.tsx` lines 552-635) |
| Multiple items/nodes can reuse same URL | ✅ Plain text field, no constraints |
| No new tables / no upload system | ✅ Already URL-only |

## Real gaps (small)

Three minor polish items from the spec are missing:

1. **Local vs. effective preview distinction.** Today only the *effective* preview shows. When a node has its own URL, you can't tell at a glance whether you're looking at "this entity's image" or "an inherited one" — the source label is the only hint. Spec asks for two clearly-labeled previews: "Local illustration" and "Effective background".

2. **Clear button.** Items have one; Node/Area/Region editors don't. Admins must select-all + delete the URL text to fall back to parent.

3. **Helper text in Item editor.** Currently says "Optional picture shown in tooltips" — spec asks for the explicit "Multiple items may reuse the same image" hint so admins know reuse is fine.

4. **Broken-image fallback in IllustrationEditor preview.** Currently sets `display:none` on error, which leaves the overlay visible over a blank box. Should show a small "Image failed to load" placeholder.

## Plan

Edit only `src/components/admin/IllustrationEditor.tsx` and add a one-line helper in `src/components/admin/ItemManager.tsx`. No schema changes, no new components, no behavior changes elsewhere.

### `IllustrationEditor.tsx` changes
- Show **two** preview blocks when local URL exists *and* differs from inherited:
  - "Local illustration" (from this entity's URL, no overlay — raw)
  - "Effective Background" (resolved URL with overlay — what the player sees)
- When local URL is empty and inherited exists, show only the Effective preview labeled "From {source}" (current behavior).
- Add a small `Clear` button next to the URL input (only visible when URL is set) — sets URL to empty, falls back to parent automatically.
- On image load error, show an "Image failed to load" placeholder inside the preview frame instead of hiding the img.
- Add subtle loading state (browser-native via `loading="lazy"` already in place; add a spinner overlay using `onLoad` to flip a state flag).

### `ItemManager.tsx` change
- Update the `AdminFormSection` description on line 553 from `"Optional picture shown in tooltips"` to `"Optional. Used for tooltip illustration. Multiple items may reuse the same image."` — single-line edit.

### Out of scope
- Item illustration reuse helper text only — no other ItemManager changes (preview + clear + AI generate already work).
- No changes to `LocationBackground`, tooltips, AI prompts, schema, or storage.

