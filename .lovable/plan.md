

## Illustration Gallery Page

A new public-facing gallery page at `/gallery` that showcases all illustrations from regions and areas (and nodes if any get added later). Accessible via a new icon in the Map panel toolbar.

### Layout
- Responsive grid of illustration cards (1 col mobile / 2 tablet / 3-4 desktop)
- Each card: image, title (region/area name), small badge (Region / Area / Node), and short description snippet
- Click a card → opens a lightbox dialog with the full-size image, name, description, level range, and source type
- Top of page: title "Gallery of Varneth", filter chips (All / Regions / Areas / Nodes), and a Back-to-game link
- Same parchment/dark-fantasy theme as the rest of the app
- Skeleton placeholders while loading; empty state if no illustrations exist for the selected filter

### Data
- One client-side query on mount: select `id, name, description, illustration_url, min_level, max_level` from each of `regions`, `areas`, `nodes` where `illustration_url IS NOT NULL AND illustration_url <> ''`
- These tables are already publicly readable (players see them in the world view), so no new RLS work is needed
- Merge into a single typed array tagged with `source: 'region' | 'area' | 'node'`, sort alphabetically by name
- Lazy-load images with native `loading="lazy"` and a soft fade-in (reuse the pattern from `LocationBackground`)

### Routing
- New route `/gallery` in `src/App.tsx` (lazy-loaded like `GameRoute`)
- Public — no auth required (the illustrations are content showcase, not gameplay state)
- Add a small back-link in the gallery header that returns to `/game` if signed in, otherwise `/`

### Map panel toolbar entry
- Add an `ImageIcon` (lucide `Image`) button next to the existing toolbar icons in `MapPanel.tsx`
- Tooltip: "Illustration Gallery"
- Click → `window.open('/gallery', '_blank')` so players don't lose their game session

### Files

**New:**
- `src/pages/GalleryPage.tsx` — main page (data fetch, filter state, grid, lightbox)

**Modified:**
- `src/App.tsx` — add lazy `GalleryPage` import + `/gallery` route
- `src/features/world/components/MapPanel.tsx` — add Image icon button in toolbar opening `/gallery` in new tab

### What stays unchanged
- All existing pages, routes, dialogs
- Database schema and RLS (read-only public selects)
- Top toolbar layout otherwise

### Edge cases
- No illustrations for a filter → friendly empty state ("No illustrations yet — keep exploring!")
- Broken/404 image URL → `onError` hides the card
- Mobile lightbox → image scales to viewport with `max-h-[90vh] object-contain`
- Long descriptions → clamp to 2 lines on the card, full text in lightbox

