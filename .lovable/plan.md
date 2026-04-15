

# Illustration Metadata JSONB and Inheritance Preview

## Summary

Implement the full hierarchical background illustration system using a simplified two-column schema (`illustration_url` + `illustration_metadata` JSONB) instead of 10 individual text columns. Includes admin UI with inheritance preview and prompt generation.

## Database Migration

Single migration adding 2 columns to each of `regions`, `areas`, and `nodes`:

```sql
ALTER TABLE regions ADD COLUMN illustration_url text DEFAULT '';
ALTER TABLE regions ADD COLUMN illustration_metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE areas ADD COLUMN illustration_url text DEFAULT '';
ALTER TABLE areas ADD COLUMN illustration_metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE nodes ADD COLUMN illustration_url text DEFAULT '';
ALTER TABLE nodes ADD COLUMN illustration_metadata jsonb DEFAULT '{}'::jsonb;
```

No RLS changes needed — columns inherit existing table policies.

## New Files

### `src/lib/illustration-prompt.ts`
`buildIllustrationPrompt(metadata: Record<string, string>)` — returns `prompt_override` if present, otherwise assembles from `visual_theme`, `environment_description`, `mood`, `time_of_day`, `weather`, `architectural_style`, `color_palette`, `notable_features`.

### `src/features/world/components/LocationBackground.tsx`
- Props: `node`, `area`, `region` (with `illustration_url` fields)
- Resolves: node → area → region → null
- Renders absolutely positioned `<img>` with `object-cover`, dark gradient overlay, 300ms fade transition
- Preloads adjacent node illustrations via `requestIdleCallback`

### `src/components/admin/IllustrationEditor.tsx`
Reusable admin section. Props:
- `illustrationUrl`, `onUrlChange` — for the URL field
- `metadata`, `onMetadataChange` — for the JSONB object
- `inheritedUrl?`, `inheritedSource?` — for the "Effective Background" preview

Features:
- URL input with helper text: "Leave empty to inherit from parent Area or Region"
- Image preview of the local URL
- "Effective Background" preview showing the resolved image with a source label ("From Node" / "From Area" / "From Region")
- Collapsible metadata fields (visual_theme, mood, weather, etc.)
- "Generate Prompt" button with copyable output textarea

## Modified Files

### `src/features/world/hooks/useNodes.ts`
Add `illustration_url` and `illustration_metadata` to `GameNode`, `Area`, and `Region` interfaces.

### `src/features/world/components/NodeView.tsx`
Wrap content in `relative` container, insert `<LocationBackground>` as background layer (z-0).

### `src/components/admin/RegionEditorPanel.tsx`
- Add `illustration_url` and `illustration_metadata` to form state
- Include `<IllustrationEditor>` section (no inherited preview since regions are top-level)
- Save both fields on update

### `src/components/admin/AreaEditorPanel.tsx`
- Add fields to form state
- Pass parent region's `illustration_url` as `inheritedUrl` to `IllustrationEditor`
- Save both fields on insert/update

### `src/components/admin/NodeEditorPanel.tsx`
- Add fields to node form state (Details tab)
- Pass resolved area/region `illustration_url` as `inheritedUrl`
- Save both fields in existing `saveNode`

## Not Changed
- Combat, movement, loot, party systems
- Existing RLS policies
- LocationBackground preloading strategy (as originally planned)
- Game logic, edge functions, storage buckets

## Files Summary

| File | Action |
|------|--------|
| Migration SQL | Add 2 columns to regions, areas, nodes |
| `src/lib/illustration-prompt.ts` | Create |
| `src/features/world/components/LocationBackground.tsx` | Create |
| `src/components/admin/IllustrationEditor.tsx` | Create |
| `src/features/world/hooks/useNodes.ts` | Add illustration fields to interfaces |
| `src/features/world/components/NodeView.tsx` | Insert LocationBackground |
| `src/components/admin/RegionEditorPanel.tsx` | Add illustration section |
| `src/components/admin/AreaEditorPanel.tsx` | Add illustration section |
| `src/components/admin/NodeEditorPanel.tsx` | Add illustration section |

