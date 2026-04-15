

# Generate Placeholder Illustrations for Area Types

## Confirmation

Yes — the `background-images` public storage bucket is exactly the right place to store these. You can reference images via:
```
https://gpclaklkaolyzfnooajt.supabase.co/storage/v1/object/public/background-images/<filename>
```

## Area Types (14 total)

| Type | Emoji | Prompt Theme |
|------|-------|-------------|
| camp | 🏕️ | Adventurer's campsite in a forest clearing |
| cave | 🕳️ | Dark cavern entrance with stalactites |
| coast | 🌊 | Rocky shoreline with crashing waves |
| desert | 🏜️ | Vast sand dunes under a blazing sun |
| dungeon | ⚔️ | Stone dungeon corridor with torchlight |
| forest | 🌲 | Dense old-growth forest with dappled light |
| hideout | 🏕️ | Hidden outlaw camp in a ravine |
| mountain | ⛰️ | Rugged mountain pass with snow-capped peaks |
| other | 📍 | Generic fantasy waypoint, misty crossroads |
| plains | 🌾 | Rolling grasslands under open sky |
| ruins | 🏚️ | Crumbling ancient stone ruins overgrown with vines |
| swamp | 🌿 | Murky marshland with twisted trees |
| town | 🏘️ | Medieval fantasy village with cobblestone streets |
| trail | 🏃 | Winding dirt path through wilderness |

## Implementation

1. **Generate 14 images** using the AI image generation skill (`google/gemini-3-pro-image-preview` for high quality). Each prompt will follow the style: *"High-fantasy environment, [theme]. Richly detailed, atmospheric lighting, cinematic composition, digital painting, 16:9 aspect ratio, no text, no characters."*

2. **Upload each image** to the `background-images` bucket with filenames like `area-type-forest.png`, `area-type-cave.png`, etc.

3. **Output a reference list** mapping each area type to its public URL so you can assign them to areas in the admin panel.

## Technical Notes

- Images generated one at a time due to rate limits (~1-2 min each, ~20-25 min total)
- Output as PNG, stored in the existing public `background-images` bucket
- No code changes needed — these are just assets you assign via the admin IllustrationEditor

